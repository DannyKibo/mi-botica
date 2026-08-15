use crate::auditoria::registrar_accion;
use crate::auth::{self, SessionState};
use crate::db::DbState;
use crate::reportes::guardar_texto_en_documentos;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

/// Prefijos del Registro Sanitario que DIGEMID clasifica como "Producto Farmacéutico" (el
/// resto se considera "Producto Sanitario"). Replica
/// `Inventario::prefijosFarmaceuticos`/`condicionTipoInventario` del sistema PHP original: se
/// usa para filtrar qué lotes entran en un inventario físico según el tipo elegido
/// (total/farmacéuticos/sanitarios), y también para el inventario aleatorio, que siempre
/// muestrea únicamente productos farmacéuticos.
const PREFIJOS_FARMACEUTICOS: [&str; 17] = [
    "EE", "EN", "ADE", "GME", "GMN", "BE", "DE", "GR", "GN", "EDE", "EDN", "DM", "HE", "PNE", "PNN", "RE", "RN",
];

/// Construye la condición SQL equivalente a `condicionTipoInventario($tipo)`. Usa el Registro
/// Sanitario del lote si lo tiene, y si no el del producto (mismo criterio de "RS efectivo" que
/// ya usa `detalles_para_exportar` más abajo). Los prefijos son constantes fijas del código (no
/// vienen del usuario), así que se pueden insertar directo en el SQL sin riesgo de inyección.
fn condicion_tipo_inventario(tipo: &str) -> String {
    let expr = "COALESCE(l.registro_sanitario, p.registro_sanitario)";
    let condiciones: Vec<String> = PREFIJOS_FARMACEUTICOS
        .iter()
        .map(|pref| format!("UPPER({}) LIKE '{}%'", expr, pref))
        .collect();
    let es_farmaceutico = format!("({})", condiciones.join(" OR "));
    match tipo {
        "farmaceuticos" => format!("{} IS NOT NULL AND {}", expr, es_farmaceutico),
        "sanitarios" => format!("{} IS NOT NULL AND NOT {}", expr, es_farmaceutico),
        _ => "1=1".to_string(),
    }
}

// ---------------- Lotes (FEFO: First Expired, First Out) ----------------

#[derive(Serialize)]
pub struct Lote {
    pub id: i64,
    pub id_producto: i64,
    pub nombre_comercial: String,
    pub forma_farmaceutica: Option<String>,
    pub codigo_lote: String,
    pub fecha_vencimiento: String,
    pub cantidad_inicial: i64,
    pub cantidad_disponible: i64,
    pub categoria: Option<String>,
}

/// Replica `InventarioController::lotes`: bloqueado para el Técnico en Farmacia.
#[tauri::command]
pub fn listar_lotes_activos(db: State<DbState>, session: State<SessionState>) -> Result<Vec<Lote>, String> {
    auth::exigir_no_tecnico(&session)?;
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT l.id, l.id_producto, p.nombre_comercial, p.forma_farmaceutica, l.codigo_lote,
                    l.fecha_vencimiento, l.cantidad_inicial, l.cantidad_disponible, c.nombre
             FROM inventario_lotes l
             INNER JOIN productos p ON l.id_producto = p.id
             LEFT JOIN categorias c ON p.id_categoria = c.id
             WHERE l.cantidad_disponible > 0 AND l.estado = 1
             ORDER BY l.fecha_vencimiento ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Lote {
                id: r.get(0)?,
                id_producto: r.get(1)?,
                nombre_comercial: r.get(2)?,
                forma_farmaceutica: r.get(3)?,
                codigo_lote: r.get(4)?,
                fecha_vencimiento: r.get(5)?,
                cantidad_inicial: r.get(6)?,
                cantidad_disponible: r.get(7)?,
                categoria: r.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Replica InventarioController::entrada_manual + Inventario::registrarEntrada del sistema PHP:
/// crea el lote, escribe el movimiento en el kardex y actualiza el stock del producto, todo
/// dentro de una misma transacción.
#[tauri::command]
pub fn registrar_entrada_manual(
    db: State<DbState>,
    session: State<SessionState>,
    id_producto: i64,
    cantidad: i64,
    codigo_lote: String,
    fecha_vencimiento: String,
    motivo: String,
) -> Result<(), String> {
    let (id_usuario, _rol_id) = auth::exigir_no_tecnico(&session)?;
    if cantidad <= 0 {
        return Err("La cantidad debe ser mayor a cero".into());
    }
    let lote = if codigo_lote.trim().is_empty() { "SIN-LOTE".to_string() } else { codigo_lote };
    let motivo_completo = format!("Ajuste/Ingreso Manual: {}", motivo);

    let mut conn = db.0.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let saldo_anterior: i64 = tx
        .query_row("SELECT stock_actual FROM productos WHERE id = ?1", params![id_producto], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let nuevo_saldo = saldo_anterior + cantidad;

    tx.execute(
        "INSERT INTO inventario_lotes (id_producto, codigo_lote, fecha_vencimiento, cantidad_inicial, cantidad_disponible, documento_ingreso)
         VALUES (?1,?2,?3,?4,?4,?5)",
        params![id_producto, lote, fecha_vencimiento, cantidad, motivo_completo],
    ).map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO kardex (id_producto, id_usuario, tipo_movimiento, motivo, cantidad, saldo_actual)
         VALUES (?1,?2,'ENTRADA',?3,?4,?5)",
        params![id_producto, id_usuario, motivo_completo, cantidad, nuevo_saldo],
    ).map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE productos SET stock_actual = ?1 WHERE id = ?2",
        params![nuevo_saldo, id_producto],
    ).map_err(|e| e.to_string())?;

    registrar_accion(&tx, id_usuario, "Inventario", "AJUSTE_STOCK", &format!("Ajuste manual de stock: {}, Cant: {}, Prod ID: {}", motivo_completo, cantidad, id_producto), 0.0)?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------- Kardex ----------------

#[derive(Serialize)]
pub struct MovimientoKardex {
    pub id: i64,
    pub id_producto: i64,
    pub nombre_comercial: String,
    pub usuario: String,
    pub tipo_movimiento: String,
    pub motivo: String,
    pub cantidad: i64,
    pub saldo_actual: i64,
    pub fecha: String,
}

#[tauri::command]
pub fn listar_kardex(db: State<DbState>, session: State<SessionState>, id_producto: Option<i64>) -> Result<Vec<MovimientoKardex>, String> {
    auth::exigir_no_tecnico(&session)?;
    let conn = db.0.lock().unwrap();
    let sql = "SELECT k.id, k.id_producto, p.nombre_comercial, u.nombres, k.tipo_movimiento, k.motivo, k.cantidad, k.saldo_actual, k.fecha
               FROM kardex k
               INNER JOIN productos p ON k.id_producto = p.id
               INNER JOIN usuarios u ON k.id_usuario = u.id
               WHERE (?1 IS NULL OR k.id_producto = ?1)
               ORDER BY k.id DESC LIMIT 500";
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![id_producto], |r| {
            Ok(MovimientoKardex {
                id: r.get(0)?,
                id_producto: r.get(1)?,
                nombre_comercial: r.get(2)?,
                usuario: r.get(3)?,
                tipo_movimiento: r.get(4)?,
                motivo: r.get(5)?,
                cantidad: r.get(6)?,
                saldo_actual: r.get(7)?,
                fecha: r.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

// ---------------- Inventario físico (auditorías) ----------------

#[derive(Serialize)]
pub struct Auditoria {
    pub id: i64,
    pub usuario: String,
    pub fecha_inicio: String,
    pub fecha_fin: Option<String>,
    pub estado: String,
    pub observaciones: Option<String>,
}

#[tauri::command]
pub fn listar_auditorias(db: State<DbState>, session: State<SessionState>) -> Result<Vec<Auditoria>, String> {
    auth::exigir_no_tecnico(&session)?;
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT a.id, u.nombres, a.fecha_inicio, a.fecha_fin, a.estado, a.observaciones
             FROM inventario_auditorias a JOIN usuarios u ON u.id = a.id_usuario
             ORDER BY a.id DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Auditoria {
                id: r.get(0)?,
                usuario: r.get(1)?,
                fecha_inicio: r.get(2)?,
                fecha_fin: r.get(3)?,
                estado: r.get(4)?,
                observaciones: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Replica `Inventario::iniciarAuditoria` + `InventarioFisicoController::iniciar`: toma una
/// "foto" de los lotes activos con stock y arranca la auditoría en estado Abierta. `tipo` puede
/// ser "total" (todo el inventario), "farmaceuticos" o "sanitarios" — filtrado según el prefijo
/// DIGEMID del Registro Sanitario (ver `condicion_tipo_inventario`). Cualquier valor no
/// reconocido cae a "total", igual que el original.
#[tauri::command]
pub fn iniciar_auditoria(db: State<DbState>, session: State<SessionState>, tipo: String, observaciones: String) -> Result<i64, String> {
    let (id_usuario, _rol_id) = auth::exigir_no_tecnico(&session)?;
    let tipo_norm = match tipo.as_str() {
        "farmaceuticos" => "farmaceuticos",
        "sanitarios" => "sanitarios",
        _ => "total",
    };
    let obs_final = match tipo_norm {
        "farmaceuticos" => format!("[FARMACÉUTICOS] {}", observaciones.trim()),
        "sanitarios" => format!("[SANITARIOS] {}", observaciones.trim()),
        _ => observaciones.trim().to_string(),
    };

    let mut conn = db.0.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO inventario_auditorias (id_usuario, observaciones) VALUES (?1, ?2)",
        params![id_usuario, obs_final],
    ).map_err(|e| e.to_string())?;
    let id_audit = tx.last_insert_rowid();

    let condicion = condicion_tipo_inventario(tipo_norm);
    let sql = format!(
        "INSERT INTO inventario_auditoria_detalles (id_auditoria, id_lote, stock_sistema)
         SELECT ?1, l.id, l.cantidad_disponible FROM inventario_lotes l
         INNER JOIN productos p ON p.id = l.id_producto
         WHERE l.cantidad_disponible > 0 AND l.estado = 1 AND ({})",
        condicion
    );
    tx.execute(&sql, params![id_audit]).map_err(|e| e.to_string())?;

    registrar_accion(&tx, id_usuario, "Inventario", "CREAR", &format!("Inicio de auditoría de inventario físico ID #{} (tipo: {})", id_audit, tipo_norm), 0.0)?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(id_audit)
}

#[derive(Serialize)]
pub struct DetalleAuditoria {
    pub id: i64,
    pub id_lote: i64,
    pub nombre_comercial: String,
    pub codigo_lote: String,
    pub fecha_vencimiento: String,
    pub stock_sistema: i64,
    pub stock_fisico: i64,
    pub contado: i64,
    pub diferencia: i64,
}

#[tauri::command]
pub fn detalles_auditoria(db: State<DbState>, session: State<SessionState>, id_auditoria: i64) -> Result<Vec<DetalleAuditoria>, String> {
    auth::exigir_no_tecnico(&session)?;
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT d.id, d.id_lote, p.nombre_comercial, l.codigo_lote, l.fecha_vencimiento,
                    d.stock_sistema, d.stock_fisico, d.contado, d.diferencia
             FROM inventario_auditoria_detalles d
             INNER JOIN inventario_lotes l ON d.id_lote = l.id
             INNER JOIN productos p ON l.id_producto = p.id
             WHERE d.id_auditoria = ?1
             ORDER BY p.nombre_comercial ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![id_auditoria], |r| {
            Ok(DetalleAuditoria {
                id: r.get(0)?,
                id_lote: r.get(1)?,
                nombre_comercial: r.get(2)?,
                codigo_lote: r.get(3)?,
                fecha_vencimiento: r.get(4)?,
                stock_sistema: r.get(5)?,
                stock_fisico: r.get(6)?,
                contado: r.get(7)?,
                diferencia: r.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn guardar_conteo_parcial(db: State<DbState>, session: State<SessionState>, id_auditoria: i64, id_lote: i64, stock_fisico: i64) -> Result<(), String> {
    auth::exigir_no_tecnico(&session)?;
    let conn = db.0.lock().unwrap();
    conn.execute(
        "UPDATE inventario_auditoria_detalles SET stock_fisico = ?1, contado = 1 WHERE id_auditoria = ?2 AND id_lote = ?3",
        params![stock_fisico, id_auditoria, id_lote],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

/// Replica Inventario::finalizarAuditoria: por cada lote contado, calcula la diferencia
/// (físico - sistema), y si hay diferencia, ajusta el lote, escribe el movimiento AJUSTE en
/// el kardex, y actualiza el stock del producto. Protegido contra reprocesar una auditoría
/// que ya fue finalizada (igual que el original).
#[tauri::command]
pub fn finalizar_auditoria(db: State<DbState>, session: State<SessionState>, id_auditoria: i64) -> Result<(), String> {
    let (id_usuario, _rol_id) = auth::exigir_no_tecnico(&session)?;
    let mut conn = db.0.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let estado: String = tx
        .query_row("SELECT estado FROM inventario_auditorias WHERE id = ?1", params![id_auditoria], |r| r.get(0))
        .map_err(|_| "La auditoría no existe.".to_string())?;
    if estado != "Abierta" {
        return Err(format!("Esta auditoría ya fue finalizada anteriormente (estado actual: {}).", estado));
    }

    struct Detalle {
        id: i64,
        id_lote: i64,
        id_producto: i64,
        stock_sistema: i64,
        stock_fisico: i64,
    }

    let mut stmt = tx
        .prepare(
            "SELECT d.id, d.id_lote, l.id_producto, d.stock_sistema, d.stock_fisico
             FROM inventario_auditoria_detalles d
             INNER JOIN inventario_lotes l ON d.id_lote = l.id
             WHERE d.id_auditoria = ?1 AND d.contado = 1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![id_auditoria], |r| {
            Ok(Detalle {
                id: r.get(0)?,
                id_lote: r.get(1)?,
                id_producto: r.get(2)?,
                stock_sistema: r.get(3)?,
                stock_fisico: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let detalles: Vec<Detalle> = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    drop(stmt);

    for det in detalles {
        let dif = det.stock_fisico - det.stock_sistema;
        tx.execute(
            "UPDATE inventario_auditoria_detalles SET diferencia = ?1 WHERE id = ?2",
            params![dif, det.id],
        ).map_err(|e| e.to_string())?;

        if dif != 0 {
            tx.execute(
                "UPDATE inventario_lotes SET cantidad_disponible = ?1 WHERE id = ?2",
                params![det.stock_fisico, det.id_lote],
            ).map_err(|e| e.to_string())?;

            let stock_anterior: i64 = tx
                .query_row("SELECT stock_actual FROM productos WHERE id = ?1", params![det.id_producto], |r| r.get(0))
                .map_err(|e| e.to_string())?;
            let nuevo_saldo = stock_anterior + dif;
            let motivo = format!("Ajuste por Inventario Físico #{}", id_auditoria);

            tx.execute(
                "INSERT INTO kardex (id_producto, id_usuario, tipo_movimiento, motivo, cantidad, saldo_actual)
                 VALUES (?1,?2,'AJUSTE',?3,?4,?5)",
                params![det.id_producto, id_usuario, motivo, dif, nuevo_saldo],
            ).map_err(|e| e.to_string())?;

            tx.execute(
                "UPDATE productos SET stock_actual = ?1 WHERE id = ?2",
                params![nuevo_saldo, det.id_producto],
            ).map_err(|e| e.to_string())?;
        }
    }

    tx.execute(
        "UPDATE inventario_auditorias SET estado = 'Finalizada', fecha_fin = CURRENT_TIMESTAMP WHERE id = ?1",
        params![id_auditoria],
    ).map_err(|e| e.to_string())?;

    registrar_accion(&tx, id_usuario, "Inventario", "FINALIZAR", &format!("Cierre y ajuste automático de stock por Auditoría ID #{}", id_auditoria), 0.0)?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn cancelar_auditoria(db: State<DbState>, session: State<SessionState>, id_auditoria: i64) -> Result<(), String> {
    auth::exigir_no_tecnico(&session)?;
    let conn = db.0.lock().unwrap();
    conn.execute(
        "UPDATE inventario_auditorias SET estado = 'Cancelada', fecha_fin = CURRENT_TIMESTAMP WHERE id = ?1 AND estado = 'Abierta'",
        params![id_auditoria],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------- Auditoría aleatoria (muestreo) ----------------

/// Replica `Inventario::iniciarAuditoriaAleatoria`: toma una muestra aleatoria de productos
/// activos con stock disponible, filtrando SOLO productos "Farmacéuticos" según el prefijo
/// DIGEMID de su Registro Sanitario (mismo criterio que `condicion_tipo_inventario`,
/// hardcodeado a "farmaceuticos" — el original nunca deja elegir el tipo para el muestreo
/// aleatorio). Reutiliza exactamente el mismo motor de conteo/ajuste/kardex que la auditoría
/// completa, solo cambia qué lotes se "fotografían" al inicio.
#[tauri::command]
pub fn iniciar_auditoria_aleatoria(
    db: State<DbState>,
    session: State<SessionState>,
    cantidad: i64,
    observaciones: String,
) -> Result<i64, String> {
    let (id_usuario, _rol_id) = auth::exigir_no_tecnico(&session)?;
    let cant = if cantidad <= 0 { 30 } else { cantidad };
    let mut conn = db.0.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let condicion = condicion_tipo_inventario("farmaceuticos");
    let ids: Vec<i64> = {
        let sql = format!(
            "SELECT DISTINCT p.id FROM productos p
             INNER JOIN inventario_lotes l ON l.id_producto = p.id AND l.cantidad_disponible > 0 AND l.estado = 1
             WHERE p.estado = 1 AND ({})
             ORDER BY RANDOM() LIMIT ?1",
            condicion
        );
        let mut stmt = tx.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![cant], |r| r.get::<_, i64>(0)).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
    };

    if ids.is_empty() {
        return Err("No se encontraron productos activos con stock disponible.".into());
    }

    let obs_final = format!("[ALEATORIO] {}", observaciones.trim());
    tx.execute(
        "INSERT INTO inventario_auditorias (id_usuario, observaciones) VALUES (?1, ?2)",
        params![id_usuario, obs_final],
    )
    .map_err(|e| e.to_string())?;
    let id_audit = tx.last_insert_rowid();

    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "INSERT INTO inventario_auditoria_detalles (id_auditoria, id_lote, stock_sistema)
         SELECT ?, id, cantidad_disponible FROM inventario_lotes
         WHERE cantidad_disponible > 0 AND estado = 1 AND id_producto IN ({})",
        placeholders
    );
    let mut todos_params: Vec<i64> = vec![id_audit];
    todos_params.extend(ids.iter().copied());
    tx.execute(&sql, rusqlite::params_from_iter(todos_params.iter()))
        .map_err(|e| e.to_string())?;

    registrar_accion(
        &tx,
        id_usuario,
        "Inventario",
        "CREAR",
        &format!("Inicio de inventario aleatorio ID #{} — {} producto(s)", id_audit, ids.len()),
        0.0,
    )?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(id_audit)
}

// ---------------- Agregar producto/lote encontrado durante el conteo ----------------

#[derive(Deserialize)]
pub struct AgregarEncontradoInput {
    pub id_auditoria: i64,
    pub id_producto: Option<i64>,
    pub nombre_producto: Option<String>,
    pub laboratorio: Option<String>,
    pub codigo_lote: String,
    pub fecha_vencimiento: String,
    pub cantidad: i64,
    pub registro_sanitario: Option<String>,
}

#[derive(Serialize)]
pub struct AgregarEncontradoResultado {
    pub id_lote: i64,
    pub stock_sistema: i64,
}

/// Replica Inventario::agregarLoteEncontradoEnAuditoria: permite anotar, en plena toma de
/// inventario, un lote que apareció físicamente pero no estaba en la "foto" inicial de la
/// auditoría (porque el producto es nuevo, o el lote no estaba registrado). Si no se elige un
/// producto existente, crea uno nuevo con el nombre escrito libremente (reutilizando uno ya
/// existente con el mismo nombre en vez de duplicar).
#[tauri::command]
pub fn agregar_lote_encontrado(db: State<DbState>, session: State<SessionState>, input: AgregarEncontradoInput) -> Result<AgregarEncontradoResultado, String> {
    let (id_usuario, _rol_id) = auth::exigir_no_tecnico(&session)?;
    if input.codigo_lote.trim().is_empty() || input.fecha_vencimiento.trim().is_empty() {
        return Err("Lote y fecha de vencimiento son obligatorios.".into());
    }
    if input.cantidad < 0 {
        return Err("La cantidad no puede ser negativa.".into());
    }
    if input.id_producto.is_none() && input.nombre_producto.as_deref().unwrap_or("").trim().is_empty() {
        return Err("Escribe el nombre del producto.".into());
    }

    let mut conn = db.0.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let estado: String = tx
        .query_row("SELECT estado FROM inventario_auditorias WHERE id = ?1", params![input.id_auditoria], |r| r.get(0))
        .map_err(|_| "La auditoría no existe.".to_string())?;
    if estado != "Abierta" {
        return Err("Esta auditoría ya no está abierta.".into());
    }

    let id_producto: i64 = match input.id_producto {
        Some(id) => id,
        None => {
            let nombre = input.nombre_producto.unwrap_or_default().trim().to_string();
            let existente: Option<i64> = tx
                .query_row("SELECT id FROM productos WHERE nombre_comercial = ?1 LIMIT 1", params![nombre], |r| r.get(0))
                .optional()
                .map_err(|e| e.to_string())?;
            match existente {
                Some(id) => id,
                None => {
                    let id_laboratorio: Option<i64> = match input.laboratorio.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
                        Some(nombre_lab) => {
                            let existe_lab: Option<i64> = tx
                                .query_row("SELECT id FROM laboratorios WHERE nombre = ?1 LIMIT 1", params![nombre_lab], |r| r.get(0))
                                .optional()
                                .map_err(|e| e.to_string())?;
                            match existe_lab {
                                Some(idl) => Some(idl),
                                None => {
                                    tx.execute("INSERT INTO laboratorios (nombre) VALUES (?1)", params![nombre_lab])
                                        .map_err(|e| e.to_string())?;
                                    Some(tx.last_insert_rowid())
                                }
                            }
                        }
                        None => None,
                    };
                    let rs = input.registro_sanitario.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty());
                    tx.execute(
                        "INSERT INTO productos (nombre_generico, nombre_comercial, id_laboratorio, registro_sanitario,
                         precio_compra, precio_venta, margen_ganancia, unidad_medida, requiere_receta, stock_actual, stock_minimo, fraccionable, estado)
                         VALUES (?1,?1,?2,?3,0,0,40,'Unidad',0,0,10,0,1)",
                        params![nombre, id_laboratorio, rs],
                    )
                    .map_err(|e| e.to_string())?;
                    tx.last_insert_rowid()
                }
            }
        }
    };

    let lote_existente: Option<(i64, i64)> = tx
        .query_row(
            "SELECT id, cantidad_disponible FROM inventario_lotes WHERE id_producto = ?1 AND codigo_lote = ?2 LIMIT 1",
            params![id_producto, input.codigo_lote],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let (id_lote, stock_sistema) = match lote_existente {
        Some((idl, cant)) => {
            if let Some(rs) = input.registro_sanitario.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
                tx.execute("UPDATE inventario_lotes SET registro_sanitario = ?1 WHERE id = ?2", params![rs, idl])
                    .map_err(|e| e.to_string())?;
            }
            (idl, cant)
        }
        None => {
            let rs = input.registro_sanitario.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty());
            tx.execute(
                "INSERT INTO inventario_lotes (id_producto, codigo_lote, fecha_vencimiento, cantidad_inicial, cantidad_disponible, documento_ingreso, registro_sanitario, estado)
                 VALUES (?1,?2,?3,0,0,'Encontrado durante Inventario Físico',?4,1)",
                params![id_producto, input.codigo_lote, input.fecha_vencimiento, rs],
            )
            .map_err(|e| e.to_string())?;
            (tx.last_insert_rowid(), 0)
        }
    };

    let ya_en_auditoria: Option<i64> = tx
        .query_row(
            "SELECT id FROM inventario_auditoria_detalles WHERE id_auditoria = ?1 AND id_lote = ?2",
            params![input.id_auditoria, id_lote],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if ya_en_auditoria.is_some() {
        return Err("Ese lote ya está en esta auditoría — busca la fila y edita la cantidad ahí directamente.".into());
    }

    tx.execute(
        "INSERT INTO inventario_auditoria_detalles (id_auditoria, id_lote, stock_sistema, stock_fisico, contado)
         VALUES (?1,?2,?3,?4,1)",
        params![input.id_auditoria, id_lote, stock_sistema, input.cantidad],
    )
    .map_err(|e| e.to_string())?;

    registrar_accion(
        &tx,
        id_usuario,
        "Inventario",
        "CREAR",
        &format!(
            "Producto agregado durante conteo físico #{}: producto #{}, lote '{}', {} unidades encontradas",
            input.id_auditoria, id_producto, input.codigo_lote, input.cantidad
        ),
        0.0,
    )?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(AgregarEncontradoResultado { id_lote, stock_sistema })
}

// ---------------- Exportar detalle / hoja de conteo de una auditoría ----------------

fn csv_campo(v: &str) -> String {
    if v.contains(';') || v.contains('"') || v.contains('\n') {
        format!("\"{}\"", v.replace('"', "\"\""))
    } else {
        v.to_string()
    }
}

/// Replica Inventario::getDetallesAuditoria (columnas usadas en las exportaciones): incluye
/// el Registro Sanitario efectivo (del lote si lo tiene, si no el del producto) y el costo
/// unitario real (el de la compra con la que ingresó ese lote, o el precio de compra actual
/// del producto si el lote fue un ingreso manual).
fn detalles_para_exportar(conn: &rusqlite::Connection, id_auditoria: i64) -> Result<Vec<(String, Option<String>, String, String, i64, i64, f64)>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT p.nombre_comercial, COALESCE(l.registro_sanitario, p.registro_sanitario), l.codigo_lote,
                    l.fecha_vencimiento, d.stock_sistema, d.stock_fisico, COALESCE(cd.precio_unitario, p.precio_compra)
             FROM inventario_auditoria_detalles d
             INNER JOIN inventario_lotes l ON d.id_lote = l.id
             INNER JOIN productos p ON l.id_producto = p.id
             LEFT JOIN compra_detalles cd ON l.id_compra_detalle = cd.id
             WHERE d.id_auditoria = ?1
             ORDER BY p.nombre_comercial ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![id_auditoria], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, i64>(5)?,
                r.get::<_, f64>(6)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Replica InventarioFisicoController::exportarDetalle: hoja con el detalle completo
/// (sistema, físico, diferencia y valorización) más un resumen de sobrantes/faltantes.
#[tauri::command]
pub fn exportar_detalle_auditoria(app: tauri::AppHandle, db: State<DbState>, session: State<SessionState>, id_auditoria: i64) -> Result<String, String> {
    auth::exigir_no_tecnico(&session)?;
    let conn = db.0.lock().unwrap();
    let (id, fecha_inicio, fecha_fin, usuario, observaciones): (i64, String, Option<String>, String, Option<String>) = conn
        .query_row(
            "SELECT a.id, a.fecha_inicio, a.fecha_fin, u.nombres, a.observaciones
             FROM inventario_auditorias a INNER JOIN usuarios u ON a.id_usuario = u.id WHERE a.id = ?1",
            params![id_auditoria],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .map_err(|_| "La auditoría no existe.".to_string())?;

    let detalles = detalles_para_exportar(&conn, id_auditoria)?;
    drop(conn);

    let mut lineas: Vec<String> = vec![
        format!("Auditoria #{}", id),
        format!("Iniciada;{}", fecha_inicio),
        format!("Finalizada;{}", fecha_fin.unwrap_or_default()),
        format!("Usuario;{}", usuario),
        format!("Observaciones;{}", csv_campo(&observaciones.unwrap_or_default())),
        String::new(),
        "Producto;Reg. Sanitario;Lote;Vencimiento;Stock Sistema;Stock Fisico;Diferencia;Costo Unitario (S/);Valorizado (S/)".to_string(),
    ];

    let mut total_valorizado = 0.0f64;
    let mut total_sobrantes = 0i64;
    let mut total_faltantes = 0i64;
    let mut valorizado_sobrante = 0.0f64;
    let mut valorizado_faltante = 0.0f64;

    for (nombre, rs, lote, venc, sistema, fisico, costo) in &detalles {
        let diferencia = fisico - sistema;
        let valorizado = diferencia as f64 * costo;
        total_valorizado += valorizado;
        if diferencia > 0 {
            total_sobrantes += diferencia;
            valorizado_sobrante += valorizado;
        }
        if diferencia < 0 {
            total_faltantes += diferencia;
            valorizado_faltante += valorizado;
        }
        lineas.push(format!(
            "{};{};{};{};{};{};{};{:.2};{:.2}",
            csv_campo(nombre),
            csv_campo(rs.as_deref().unwrap_or("")),
            csv_campo(lote),
            venc,
            sistema,
            fisico,
            diferencia,
            costo,
            valorizado
        ));
    }

    lineas.push(String::new());
    lineas.push(format!(";;;;;;Sobrantes (unid.);{};{:.2}", total_sobrantes, valorizado_sobrante));
    lineas.push(format!(";;;;;;Faltantes (unid.);{};{:.2}", total_faltantes, valorizado_faltante));
    lineas.push(format!(";;;;;;;TOTAL VALORIZADO NETO (S/);{:.2}", total_valorizado));

    let contenido = lineas.join("\r\n");
    guardar_texto_en_documentos(&app, &format!("Detalle_Auditoria_{}.csv", id_auditoria), &contenido)
}

/// Replica InventarioFisicoController::exportarConteo: hoja en blanco (Producto, R.S., Lote,
/// Vencimiento, Stock vacío) para llenar a mano mientras se recorre físicamente la botica.
#[tauri::command]
pub fn exportar_conteo_auditoria(app: tauri::AppHandle, db: State<DbState>, session: State<SessionState>, id_auditoria: i64) -> Result<String, String> {
    auth::exigir_no_tecnico(&session)?;
    let conn = db.0.lock().unwrap();
    let detalles = detalles_para_exportar(&conn, id_auditoria)?;
    drop(conn);

    let mut lineas: Vec<String> = vec!["Producto;Reg. Sanitario;Lote;Vencimiento;Stock".to_string()];
    for (nombre, rs, lote, venc, _sistema, _fisico, _costo) in &detalles {
        lineas.push(format!("{};{};{};{};", csv_campo(nombre), csv_campo(rs.as_deref().unwrap_or("")), csv_campo(lote), venc));
    }
    let contenido = lineas.join("\r\n");
    guardar_texto_en_documentos(&app, &format!("Hoja_Conteo_Auditoria_{}.csv", id_auditoria), &contenido)
}
