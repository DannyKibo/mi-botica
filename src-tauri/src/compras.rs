use crate::auditoria::registrar_accion;
use crate::auth::{self, SessionState};
use crate::db::DbState;
use rusqlite::{params, Transaction};
use serde::{Deserialize, Serialize};
use tauri::State;

// ---------------- Listado / detalle ----------------

#[derive(Serialize)]
pub struct CompraResumen {
    pub id: i64,
    pub proveedor: String,
    pub tipo_comprobante: String,
    pub serie_comprobante: Option<String>,
    pub num_comprobante: String,
    pub fecha_compra: String,
    pub total: f64,
    pub estado: String,
}

#[tauri::command]
pub fn listar_compras(db: State<DbState>) -> Result<Vec<CompraResumen>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT c.id, COALESCE(p.razon_social,'Proveedor no encontrado'), c.tipo_comprobante, c.serie_comprobante,
                    c.num_comprobante, c.fecha_compra, c.total, c.estado
             FROM compras c LEFT JOIN proveedores p ON c.id_proveedor = p.id
             ORDER BY c.fecha_compra DESC, c.id DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(CompraResumen {
                id: r.get(0)?,
                proveedor: r.get(1)?,
                tipo_comprobante: r.get(2)?,
                serie_comprobante: r.get(3)?,
                num_comprobante: r.get(4)?,
                fecha_compra: r.get(5)?,
                total: r.get(6)?,
                estado: r.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct DetalleCompra {
    pub id: i64,
    pub id_producto: i64,
    pub nombre_comercial: String,
    pub cantidad: i64,
    pub precio_unitario: f64,
    pub subtotal: f64,
    pub id_lote: Option<i64>,
    pub codigo_lote: Option<String>,
    pub fecha_vencimiento: Option<String>,
}

#[tauri::command]
pub fn detalles_compra(db: State<DbState>, id_compra: i64) -> Result<Vec<DetalleCompra>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT cd.id, cd.id_producto, COALESCE(p.nombre_comercial,'Producto no encontrado'), cd.cantidad,
                    cd.precio_unitario, cd.subtotal, l.id, l.codigo_lote, l.fecha_vencimiento
             FROM compra_detalles cd
             LEFT JOIN productos p ON cd.id_producto = p.id
             LEFT JOIN inventario_lotes l ON l.id_compra_detalle = cd.id
             WHERE cd.id_compra = ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![id_compra], |r| {
            Ok(DetalleCompra {
                id: r.get(0)?,
                id_producto: r.get(1)?,
                nombre_comercial: r.get(2)?,
                cantidad: r.get(3)?,
                precio_unitario: r.get(4)?,
                subtotal: r.get(5)?,
                id_lote: r.get(6)?,
                codigo_lote: r.get(7)?,
                fecha_vencimiento: r.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

// ---------------- Registrar compra ----------------

#[derive(Deserialize)]
pub struct CabeceraCompra {
    pub id_proveedor: i64,
    pub tipo_comprobante: String,
    pub serie_comprobante: Option<String>,
    pub num_comprobante: String,
    pub fecha_compra: String,
    pub impuesto: f64,
    pub total: f64,
    pub estado: String, // 'Completada' | 'Pendiente'
}

#[derive(Deserialize)]
pub struct DetalleCompraInput {
    pub id_producto: i64,
    pub cantidad: i64,
    pub precio_unitario: f64,
    pub precio_venta: f64,
    pub precio_fraccion: f64,
    pub subtotal: f64,
    pub lote: String,
    pub vencimiento: String,
    pub registro_sanitario: Option<String>,
    pub actualizar_precio: bool,
    pub actualizar_rs: bool,
}

/// Inserta una entrada de inventario (lote + kardex + stock) dentro de una transacción ya
/// abierta. Es el mismo procedimiento que Inventario::registrarEntrada del sistema PHP.
fn registrar_entrada_tx(
    tx: &Transaction,
    id_producto: i64,
    id_usuario: i64,
    cantidad: i64,
    motivo: &str,
    lote: &str,
    vencimiento: &str,
    id_compra_detalle: Option<i64>,
    registro_sanitario: Option<&str>,
) -> Result<(), String> {
    let saldo_anterior: i64 = tx
        .query_row("SELECT stock_actual FROM productos WHERE id = ?1", params![id_producto], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let nuevo_saldo = saldo_anterior + cantidad;

    tx.execute(
        "INSERT INTO inventario_lotes (id_producto, id_compra_detalle, codigo_lote, fecha_vencimiento, cantidad_inicial, cantidad_disponible, documento_ingreso, registro_sanitario)
         VALUES (?1,?2,?3,?4,?5,?5,?6,?7)",
        params![id_producto, id_compra_detalle, lote, vencimiento, cantidad, motivo, registro_sanitario],
    ).map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO kardex (id_producto, id_usuario, tipo_movimiento, motivo, cantidad, saldo_actual) VALUES (?1,?2,'ENTRADA',?3,?4,?5)",
        params![id_producto, id_usuario, motivo, cantidad, nuevo_saldo],
    ).map_err(|e| e.to_string())?;

    tx.execute("UPDATE productos SET stock_actual = ?1 WHERE id = ?2", params![nuevo_saldo, id_producto])
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Replica Compra::registrarCompra: inserta la cabecera, y por cada línea inserta el detalle;
/// si la compra está "Completada" además da entrada al inventario de una vez (lote + kardex +
/// stock), y opcionalmente actualiza precio de compra/venta/margen y/o registro sanitario del
/// producto, según lo que el usuario haya marcado línea por línea. Si está "Pendiente", queda
/// como orden de compra a la espera de `procesar_recepcion`.
#[tauri::command]
pub fn crear_compra(
    db: State<DbState>,
    session: State<SessionState>,
    cabecera: CabeceraCompra,
    detalles: Vec<DetalleCompraInput>,
) -> Result<i64, String> {
    if detalles.is_empty() {
        return Err("Debe agregar al menos un producto.".into());
    }
    let (id_usuario, rol_id) = auth::sesion_actual(&session)?;

    let mut conn = db.0.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO compras (id_proveedor, id_usuario, tipo_comprobante, serie_comprobante, num_comprobante, fecha_compra, impuesto, total, estado)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![
            cabecera.id_proveedor, id_usuario, cabecera.tipo_comprobante, cabecera.serie_comprobante,
            cabecera.num_comprobante, cabecera.fecha_compra, cabecera.impuesto, cabecera.total, cabecera.estado
        ],
    ).map_err(|e| e.to_string())?;
    let id_compra = tx.last_insert_rowid();

    let motivo = format!(
        "Compra {} {}-{}",
        cabecera.tipo_comprobante,
        cabecera.serie_comprobante.clone().unwrap_or_default(),
        cabecera.num_comprobante
    );

    for det in &detalles {
        tx.execute(
            "INSERT INTO compra_detalles (id_compra, id_producto, cantidad, precio_unitario, subtotal) VALUES (?1,?2,?3,?4,?5)",
            params![id_compra, det.id_producto, det.cantidad, det.precio_unitario, det.subtotal],
        ).map_err(|e| e.to_string())?;
        let id_detalle = tx.last_insert_rowid();

        if cabecera.estado == "Completada" {
            let (unidades_por_caja, fraccionable): (i64, i64) = tx
                .query_row(
                    "SELECT unidades_por_caja, fraccionable FROM productos WHERE id = ?1",
                    params![det.id_producto],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .map_err(|e| e.to_string())?;

            if det.actualizar_precio {
                let nuevo_precio_compra = det.precio_unitario;
                let nuevo_precio_venta = if rol_id == 4 {
                    // El Técnico en Farmacia puede registrar compras pero nunca cambia el precio de venta.
                    tx.query_row("SELECT precio_venta FROM productos WHERE id = ?1", params![det.id_producto], |r| r.get::<_, f64>(0))
                        .map_err(|e| e.to_string())?
                } else if det.precio_venta > 0.0 {
                    det.precio_venta
                } else {
                    nuevo_precio_compra
                };
                let nuevo_margen = if nuevo_precio_compra > 0.0 {
                    ((nuevo_precio_venta / nuevo_precio_compra) - 1.0) * 100.0
                } else {
                    0.0
                };

                if fraccionable == 1 && det.precio_fraccion > 0.0 {
                    tx.execute(
                        "UPDATE productos SET precio_compra=?1, precio_venta=?2, margen_ganancia=?3, precio_fraccion=?4 WHERE id=?5",
                        params![nuevo_precio_compra, nuevo_precio_venta, nuevo_margen, det.precio_fraccion, det.id_producto],
                    ).map_err(|e| e.to_string())?;
                } else {
                    tx.execute(
                        "UPDATE productos SET precio_compra=?1, precio_venta=?2, margen_ganancia=?3 WHERE id=?4",
                        params![nuevo_precio_compra, nuevo_precio_venta, nuevo_margen, det.id_producto],
                    ).map_err(|e| e.to_string())?;
                }
            }

            if det.actualizar_rs {
                if let Some(rs) = det.registro_sanitario.as_ref().filter(|s| !s.trim().is_empty()) {
                    tx.execute("UPDATE productos SET registro_sanitario = ?1 WHERE id = ?2", params![rs, det.id_producto])
                        .map_err(|e| e.to_string())?;
                }
            }

            let factor = if fraccionable == 1 && unidades_por_caja > 0 { unidades_por_caja } else { 1 };
            let cantidad_real = det.cantidad * factor;

            registrar_entrada_tx(
                &tx,
                det.id_producto,
                id_usuario,
                cantidad_real,
                &motivo,
                &det.lote,
                &det.vencimiento,
                Some(id_detalle),
                det.registro_sanitario.as_deref(),
            )?;
        }
    }

    let log_msg = if cabecera.estado == "Pendiente" { "Registro de Orden de Compra Pendiente" } else { "Registro de Compra con Ingreso Directo" };
    registrar_accion(
        &tx, id_usuario, "Compras", "CREAR",
        &format!("{}. Prov: {}, Total: {:.2}", log_msg, cabecera.id_proveedor, cabecera.total),
        cabecera.total,
    )?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(id_compra)
}

// ---------------- Recepción de órdenes pendientes ----------------

#[derive(Deserialize)]
pub struct LoteRecepcion {
    pub id_detalle: i64,
    pub lote: String,
    pub vencimiento: String,
}

#[tauri::command]
pub fn procesar_recepcion(
    db: State<DbState>,
    session: State<SessionState>,
    id_compra: i64,
    lotes: Vec<LoteRecepcion>,
) -> Result<(), String> {
    let (id_usuario, _rol_id) = auth::sesion_actual(&session)?;
    let mut conn = db.0.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let (estado, tipo_comp, serie, num): (String, String, Option<String>, String) = tx
        .query_row(
            "SELECT estado, tipo_comprobante, serie_comprobante, num_comprobante FROM compras WHERE id = ?1",
            params![id_compra],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .map_err(|_| "La compra no existe.".to_string())?;
    if estado != "Pendiente" {
        return Err("La compra no está pendiente de recepción.".into());
    }
    let motivo = format!("Recepción de Orden {} {}-{}", tipo_comp, serie.unwrap_or_default(), num);

    struct Det {
        id: i64,
        id_producto: i64,
        cantidad: i64,
    }
    let mut stmt = tx
        .prepare("SELECT id, id_producto, cantidad FROM compra_detalles WHERE id_compra = ?1")
        .map_err(|e| e.to_string())?;
    let detalles: Vec<Det> = stmt
        .query_map(params![id_compra], |r| Ok(Det { id: r.get(0)?, id_producto: r.get(1)?, cantidad: r.get(2)? }))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(stmt);

    for det in &detalles {
        let lote_info = lotes
            .iter()
            .find(|l| l.id_detalle == det.id)
            .ok_or_else(|| format!("Faltan datos de lote para el detalle #{}", det.id))?;

        let (unidades_por_caja, fraccionable): (i64, i64) = tx
            .query_row(
                "SELECT unidades_por_caja, fraccionable FROM productos WHERE id = ?1",
                params![det.id_producto],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|e| e.to_string())?;
        let factor = if fraccionable == 1 && unidades_por_caja > 0 { unidades_por_caja } else { 1 };
        let cantidad_real = det.cantidad * factor;

        registrar_entrada_tx(
            &tx,
            det.id_producto,
            id_usuario,
            cantidad_real,
            &motivo,
            &lote_info.lote,
            &lote_info.vencimiento,
            Some(det.id),
            None,
        )?;
    }

    tx.execute("UPDATE compras SET estado = 'Completada' WHERE id = ?1", params![id_compra])
        .map_err(|e| e.to_string())?;

    registrar_accion(&tx, id_usuario, "Compras", "RECEPCION", &format!("Recepción física de productos de la Orden ID #{}", id_compra), 0.0)?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------- Devolución a proveedor ----------------

#[derive(Deserialize)]
pub struct CabeceraDevolucion {
    pub id_compra: i64,
    pub num_documento_prov: String,
    pub motivo: Option<String>,
    pub total_devuelto: f64,
    pub fecha_devolucion: String,
}

#[derive(Deserialize)]
pub struct DetalleDevolucionInput {
    pub id_producto: i64,
    pub id_lote: i64,
    pub cantidad: i64,
    pub precio_costo: f64,
    pub subtotal: f64,
}

/// Replica `CompraController::devolver` / `save_devolucion`: bloqueado para el Técnico en
/// Farmacia (a diferencia de registrar/recibir compras, que sí están abiertas a todos los
/// roles con sesión).
#[tauri::command]
pub fn registrar_devolucion(
    db: State<DbState>,
    session: State<SessionState>,
    cabecera: CabeceraDevolucion,
    detalles: Vec<DetalleDevolucionInput>,
) -> Result<(), String> {
    if detalles.is_empty() {
        return Err("No se marcó ningún producto para devolver.".into());
    }
    let (id_usuario, _rol_id) = auth::exigir_no_tecnico(&session)?;
    let mut conn = db.0.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO compras_devoluciones (id_compra, id_usuario, num_documento_prov, motivo, total_devuelto, fecha_devolucion)
         VALUES (?1,?2,?3,?4,?5,?6)",
        params![cabecera.id_compra, id_usuario, cabecera.num_documento_prov, cabecera.motivo, cabecera.total_devuelto, cabecera.fecha_devolucion],
    ).map_err(|e| e.to_string())?;
    let id_devolucion = tx.last_insert_rowid();
    let motivo_kardex = format!("Devolución NC {} de Compra ID {}", cabecera.num_documento_prov, cabecera.id_compra);

    for det in &detalles {
        let disponible: i64 = tx
            .query_row("SELECT cantidad_disponible FROM inventario_lotes WHERE id = ?1", params![det.id_lote], |r| r.get(0))
            .map_err(|_| "El lote indicado no existe.".to_string())?;
        if disponible < det.cantidad {
            return Err(format!("Stock insuficiente en el lote para devolver {} unidades.", det.cantidad));
        }

        tx.execute(
            "INSERT INTO compras_devolucion_detalles (id_devolucion, id_producto, id_lote, cantidad, precio_costo, subtotal) VALUES (?1,?2,?3,?4,?5,?6)",
            params![id_devolucion, det.id_producto, det.id_lote, det.cantidad, det.precio_costo, det.subtotal],
        ).map_err(|e| e.to_string())?;

        tx.execute(
            "UPDATE inventario_lotes SET cantidad_disponible = cantidad_disponible - ?1 WHERE id = ?2",
            params![det.cantidad, det.id_lote],
        ).map_err(|e| e.to_string())?;

        let stock_actual: i64 = tx
            .query_row("SELECT stock_actual FROM productos WHERE id = ?1", params![det.id_producto], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        let nuevo_stock = stock_actual - det.cantidad;

        tx.execute("UPDATE productos SET stock_actual = ?1 WHERE id = ?2", params![nuevo_stock, det.id_producto])
            .map_err(|e| e.to_string())?;

        tx.execute(
            "INSERT INTO kardex (id_producto, id_usuario, tipo_movimiento, motivo, cantidad, saldo_actual) VALUES (?1,?2,'SALIDA',?3,?4,?5)",
            params![det.id_producto, id_usuario, motivo_kardex, det.cantidad, nuevo_stock],
        ).map_err(|e| e.to_string())?;
    }

    registrar_accion(
        &tx, id_usuario, "Compras", "DEVOLUCION",
        &format!("Nota de Crédito/Devolución de Compra ID #{}, NC: {}", cabecera.id_compra, cabecera.num_documento_prov),
        cabecera.total_devuelto,
    )?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}
