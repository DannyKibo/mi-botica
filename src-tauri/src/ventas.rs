use crate::auditoria::registrar_accion;
use crate::auth::SessionState;
use crate::db::DbState;
use rusqlite::{params, Transaction};
use serde::{Deserialize, Serialize};
use tauri::State;

fn sesion_actual(session: &State<SessionState>) -> Result<i64, String> {
    session.0.lock().unwrap().as_ref().map(|u| u.id).ok_or_else(|| "No hay sesión activa".to_string())
}

fn config_valor(tx: &Transaction, clave: &str) -> Option<String> {
    tx.query_row("SELECT valor FROM configuracion WHERE clave = ?1", params![clave], |r| r.get::<_, Option<String>>(0))
        .ok()
        .flatten()
}

// ---------------- Listado / detalle ----------------

#[derive(Serialize)]
pub struct VentaResumen {
    pub id: i64,
    pub cliente: String,
    pub cajero: String,
    pub tipo_comprobante: String,
    pub serie_comprobante: Option<String>,
    pub num_comprobante: String,
    pub fecha_venta: String,
    pub total: f64,
    pub metodo_pago: String,
    pub estado: String,
}

#[tauri::command]
pub fn listar_ventas(db: State<DbState>) -> Result<Vec<VentaResumen>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT v.id, COALESCE(c.nombres,'Cliente no encontrado'), COALESCE(u.nombres,'Usuario no encontrado'),
                    v.tipo_comprobante, v.serie_comprobante, v.num_comprobante, v.fecha_venta, v.total, v.metodo_pago, v.estado
             FROM ventas v
             LEFT JOIN clientes c ON v.id_cliente = c.id
             LEFT JOIN usuarios u ON v.id_usuario = u.id
             ORDER BY v.id DESC LIMIT 1000",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(VentaResumen {
                id: r.get(0)?,
                cliente: r.get(1)?,
                cajero: r.get(2)?,
                tipo_comprobante: r.get(3)?,
                serie_comprobante: r.get(4)?,
                num_comprobante: r.get(5)?,
                fecha_venta: r.get(6)?,
                total: r.get(7)?,
                metodo_pago: r.get(8)?,
                estado: r.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct DetalleVenta {
    pub id: i64,
    pub id_producto: i64,
    pub nombre_comercial: String,
    pub cantidad: i64,
    pub precio_unitario: f64,
    pub subtotal: f64,
    pub id_lote: Option<i64>,
    pub codigo_lote: Option<String>,
    pub tipo_unidad: Option<String>,
}

#[tauri::command]
pub fn detalles_venta(db: State<DbState>, id_venta: i64) -> Result<Vec<DetalleVenta>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT vd.id, vd.id_producto, COALESCE(p.nombre_comercial,'Producto no encontrado'), vd.cantidad,
                    vd.precio_unitario, vd.subtotal, vd.id_lote, l.codigo_lote, vd.tipo_unidad
             FROM venta_detalles vd
             LEFT JOIN productos p ON vd.id_producto = p.id
             LEFT JOIN inventario_lotes l ON vd.id_lote = l.id
             WHERE vd.id_venta = ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![id_venta], |r| {
            Ok(DetalleVenta {
                id: r.get(0)?,
                id_producto: r.get(1)?,
                nombre_comercial: r.get(2)?,
                cantidad: r.get(3)?,
                precio_unitario: r.get(4)?,
                subtotal: r.get(5)?,
                id_lote: r.get(6)?,
                codigo_lote: r.get(7)?,
                tipo_unidad: r.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

// ---------------- Registrar venta (motor FEFO) ----------------

#[derive(Deserialize)]
pub struct CabeceraVenta {
    pub id_cliente: i64,
    pub tipo_comprobante: String,
    pub subtotal: f64,
    pub descuento: f64,
    pub igv: f64,
    pub total: f64,
    pub metodo_pago: String,
    pub pago_recibido: Option<f64>,
    pub vuelto: Option<f64>,
    pub puntos_usados: i64,
    pub medico_cmp: Option<String>,
}

#[derive(Deserialize)]
pub struct DetalleVentaInput {
    pub id_producto: i64,
    pub cantidad: i64,
    pub precio_unitario: f64,
    pub tipo_unidad: String, // "CAJA" o el nombre de la fracción (ej. "Pastilla")
    pub id_lote: Option<i64>,
}

/// Replica Venta::registrarVenta: motor FEFO (First Expired, First Out). Si el usuario eligió
/// un lote específico en el POS, vende solo de ese lote; si no, recorre los lotes activos del
/// producto ordenados por fecha de vencimiento y va descontando hasta cubrir la cantidad.
#[tauri::command]
pub fn registrar_venta(
    db: State<DbState>,
    session: State<SessionState>,
    cabecera: CabeceraVenta,
    detalles: Vec<DetalleVentaInput>,
) -> Result<i64, String> {
    if detalles.is_empty() {
        return Err("Carrito de compras vacío.".into());
    }
    let id_usuario = sesion_actual(&session)?;

    let mut conn = db.0.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let caja_id: i64 = tx
        .query_row("SELECT id FROM cajas WHERE usuario_id = ?1 AND estado = 1 LIMIT 1", params![id_usuario], |r| r.get(0))
        .map_err(|_| "Debe aperturar su caja antes de poder realizar ventas.".to_string())?;

    let puntos_habilitado = config_valor(&tx, "puntos_habilitado").as_deref() == Some("1");
    let puntos_por_sol: f64 = config_valor(&tx, "puntos_por_sol").and_then(|v| v.parse().ok()).unwrap_or(1.0);

    let mut puntos_ganados = 0i64;
    let mut puntos_usados = 0i64;
    if puntos_habilitado && cabecera.id_cliente != 1 {
        puntos_ganados = (cabecera.total * puntos_por_sol).floor() as i64;
        puntos_usados = cabecera.puntos_usados.max(0);

        if puntos_usados > 0 {
            let saldo_real: i64 = tx
                .query_row("SELECT puntos_acumulados FROM clientes WHERE id = ?1", params![cabecera.id_cliente], |r| r.get(0))
                .map_err(|_| "Cliente no encontrado.".to_string())?;
            if puntos_usados > saldo_real {
                return Err(format!(
                    "Los puntos que se intentaron usar ({}) superan el saldo real del cliente ({}).",
                    puntos_usados, saldo_real
                ));
            }
        }
    }

    // Número de ticket correlativo (en el PHP original era aleatorio; aquí usamos un
    // correlativo real basado en el conteo de ventas, que es más consistente para trazabilidad).
    let correlativo: i64 = tx.query_row("SELECT COUNT(*) FROM ventas", [], |r| r.get::<_, i64>(0)).map_err(|e| e.to_string())? + 1;
    let num_comprobante = format!("{:06}", correlativo);

    tx.execute(
        "INSERT INTO ventas (caja_id, id_cliente, id_usuario, tipo_comprobante, serie_comprobante, num_comprobante,
         subtotal, descuento, igv, total, metodo_pago, pago_recibido, vuelto, puntos_ganados, puntos_usados, medico_cmp)
         VALUES (?1,?2,?3,?4,'T001',?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
        params![
            caja_id, cabecera.id_cliente, id_usuario, cabecera.tipo_comprobante, num_comprobante,
            cabecera.subtotal, cabecera.descuento, cabecera.igv, cabecera.total, cabecera.metodo_pago,
            cabecera.pago_recibido.unwrap_or(cabecera.total), cabecera.vuelto.unwrap_or(0.0),
            puntos_ganados, puntos_usados, cabecera.medico_cmp
        ],
    ).map_err(|e| e.to_string())?;
    let id_venta = tx.last_insert_rowid();
    let motivo_kardex = format!("Venta {} T001-{}", cabecera.tipo_comprobante, num_comprobante);

    for det in &detalles {
        let (unidades_por_caja, fraccionable): (i64, i64) = tx
            .query_row(
                "SELECT unidades_por_caja, fraccionable FROM productos WHERE id = ?1",
                params![det.id_producto],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|e| e.to_string())?;
        let factor = if fraccionable == 1 && unidades_por_caja > 0 { unidades_por_caja } else { 1 };

        let (cant_requerida, precio_unitario_minimo) = if det.tipo_unidad == "CAJA" {
            (det.cantidad * factor, det.precio_unitario / factor as f64)
        } else {
            (det.cantidad, det.precio_unitario)
        };

        struct LoteCandidato {
            id: i64,
            disponible: i64,
        }
        let lotes: Vec<LoteCandidato> = if let Some(id_lote) = det.id_lote {
            let mut stmt = tx
                .prepare("SELECT id, cantidad_disponible FROM inventario_lotes WHERE id = ?1 AND id_producto = ?2 AND cantidad_disponible > 0 AND estado = 1")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![id_lote, det.id_producto], |r| Ok(LoteCandidato { id: r.get(0)?, disponible: r.get(1)? }))
                .map_err(|e| e.to_string())?;
            let out = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
            out
        } else {
            let mut stmt = tx
                .prepare("SELECT id, cantidad_disponible FROM inventario_lotes WHERE id_producto = ?1 AND cantidad_disponible > 0 AND estado = 1 ORDER BY fecha_vencimiento ASC")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![det.id_producto], |r| Ok(LoteCandidato { id: r.get(0)?, disponible: r.get(1)? }))
                .map_err(|e| e.to_string())?;
            let out = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
            out
        };

        let mut cant_restante = cant_requerida;
        for lote in &lotes {
            if cant_restante <= 0 {
                break;
            }
            let descuento = cant_restante.min(lote.disponible);
            cant_restante -= descuento;
            let nuevo_saldo_lote = lote.disponible - descuento;

            tx.execute("UPDATE inventario_lotes SET cantidad_disponible = ?1 WHERE id = ?2", params![nuevo_saldo_lote, lote.id])
                .map_err(|e| e.to_string())?;

            let subtotal_fraccion = descuento as f64 * precio_unitario_minimo;
            tx.execute(
                "INSERT INTO venta_detalles (id_venta, id_producto, cantidad, precio_unitario, subtotal, id_lote, tipo_unidad) VALUES (?1,?2,?3,?4,?5,?6,?7)",
                params![id_venta, det.id_producto, descuento, precio_unitario_minimo, subtotal_fraccion, lote.id, det.tipo_unidad],
            ).map_err(|e| e.to_string())?;
        }

        if cant_restante > 0 {
            let origen = if det.id_lote.is_some() { "el lote seleccionado" } else { "el motor FEFO automático" };
            return Err(format!("Stock insuficiente en {} para el producto ID {}.", origen, det.id_producto));
        }

        let stock_ant: i64 = tx
            .query_row("SELECT stock_actual FROM productos WHERE id = ?1", params![det.id_producto], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        let nuevo_stock = stock_ant - cant_requerida;
        tx.execute("UPDATE productos SET stock_actual = ?1 WHERE id = ?2", params![nuevo_stock, det.id_producto])
            .map_err(|e| e.to_string())?;

        tx.execute(
            "INSERT INTO kardex (id_producto, id_usuario, tipo_movimiento, motivo, cantidad, saldo_actual) VALUES (?1,?2,'SALIDA',?3,?4,?5)",
            params![det.id_producto, id_usuario, motivo_kardex, cant_requerida, nuevo_stock],
        ).map_err(|e| e.to_string())?;
    }

    if puntos_habilitado && cabecera.id_cliente != 1 {
        let delta = puntos_ganados - puntos_usados;
        if delta != 0 {
            let actual: i64 = tx
                .query_row("SELECT puntos_acumulados FROM clientes WHERE id = ?1", params![cabecera.id_cliente], |r| r.get(0))
                .map_err(|e| e.to_string())?;
            let nuevo = (actual + delta).max(0);
            tx.execute("UPDATE clientes SET puntos_acumulados = ?1 WHERE id = ?2", params![nuevo, cabecera.id_cliente])
                .map_err(|e| e.to_string())?;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(id_venta)
}

/// Replica Venta::anularVenta: devuelve el stock a cada lote de origen y al stock general,
/// escribe la entrada en kardex, marca la venta como Anulada y revierte los puntos de
/// fidelización que hubiera generado o consumido.
#[tauri::command]
pub fn anular_venta(db: State<DbState>, session: State<SessionState>, id_venta: i64) -> Result<(), String> {
    let id_usuario = sesion_actual(&session)?;
    let mut conn = db.0.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let (estado, tipo_comp, serie, num, id_cliente, puntos_ganados, puntos_usados): (String, String, Option<String>, String, i64, i64, i64) = tx
        .query_row(
            "SELECT estado, tipo_comprobante, serie_comprobante, num_comprobante, id_cliente, puntos_ganados, puntos_usados FROM ventas WHERE id = ?1",
            params![id_venta],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)),
        )
        .map_err(|_| "La venta no existe.".to_string())?;

    if estado == "Anulada" {
        return Err("Esta venta ya está anulada.".into());
    }

    let motivo_kardex = format!("Anulación {} {}-{}", tipo_comp, serie.unwrap_or_default(), num);

    struct Det {
        id_producto: i64,
        cantidad: i64,
        id_lote: Option<i64>,
    }
    let mut stmt = tx
        .prepare("SELECT id_producto, cantidad, id_lote FROM venta_detalles WHERE id_venta = ?1")
        .map_err(|e| e.to_string())?;
    let detalles: Vec<Det> = stmt
        .query_map(params![id_venta], |r| Ok(Det { id_producto: r.get(0)?, cantidad: r.get(1)?, id_lote: r.get(2)? }))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(stmt);

    for det in &detalles {
        // La cantidad guardada en venta_detalles ya está en unidades reales (mínimas) — es
        // exactamente lo que se descontó del lote al vender, así que se restaura tal cual.
        if let Some(id_lote) = det.id_lote {
            tx.execute("UPDATE inventario_lotes SET cantidad_disponible = cantidad_disponible + ?1 WHERE id = ?2", params![det.cantidad, id_lote])
                .map_err(|e| e.to_string())?;
        }

        let stock_ant: i64 = tx
            .query_row("SELECT stock_actual FROM productos WHERE id = ?1", params![det.id_producto], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        let nuevo_stock = stock_ant + det.cantidad;
        tx.execute("UPDATE productos SET stock_actual = ?1 WHERE id = ?2", params![nuevo_stock, det.id_producto])
            .map_err(|e| e.to_string())?;

        tx.execute(
            "INSERT INTO kardex (id_producto, id_usuario, tipo_movimiento, motivo, cantidad, saldo_actual) VALUES (?1,?2,'ENTRADA',?3,?4,?5)",
            params![det.id_producto, id_usuario, motivo_kardex, det.cantidad, nuevo_stock],
        ).map_err(|e| e.to_string())?;
    }

    tx.execute("UPDATE ventas SET estado = 'Anulada' WHERE id = ?1", params![id_venta])
        .map_err(|e| e.to_string())?;

    if id_cliente != 1 {
        let delta = puntos_usados - puntos_ganados;
        if delta != 0 {
            let actual: i64 = tx
                .query_row("SELECT puntos_acumulados FROM clientes WHERE id = ?1", params![id_cliente], |r| r.get(0))
                .map_err(|e| e.to_string())?;
            let nuevo = (actual + delta).max(0);
            tx.execute("UPDATE clientes SET puntos_acumulados = ?1 WHERE id = ?2", params![nuevo, id_cliente])
                .map_err(|e| e.to_string())?;
        }
    }

    registrar_accion(&tx, id_usuario, "Ventas", "ANULAR", &format!("Anulación de venta ID #{} por el usuario.", id_venta), 0.0)?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}
