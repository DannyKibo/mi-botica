use crate::auth::{self, SessionState};
use crate::db::DbState;
use rusqlite::params;
use serde::Serialize;
use tauri::State;

fn usuario_actual(session: &State<SessionState>) -> Result<i64, String> {
    session.0.lock().unwrap().as_ref().map(|u| u.id).ok_or_else(|| "No hay sesión activa".to_string())
}

#[derive(Serialize)]
pub struct Caja {
    pub id: i64,
    pub usuario_id: i64,
    pub fecha_apertura: String,
    pub fecha_cierre: Option<String>,
    pub monto_inicial: f64,
    pub ingresos_efectivo: f64,
    pub ingresos_transferencia: f64,
    pub monto_final_esperado: Option<f64>,
    pub monto_final_real: Option<f64>,
    pub diferencia: Option<f64>,
    pub observacion: Option<String>,
    pub estado: i64,
}

fn row_to_caja(r: &rusqlite::Row) -> rusqlite::Result<Caja> {
    Ok(Caja {
        id: r.get(0)?,
        usuario_id: r.get(1)?,
        fecha_apertura: r.get(2)?,
        fecha_cierre: r.get(3)?,
        monto_inicial: r.get(4)?,
        ingresos_efectivo: r.get(5)?,
        ingresos_transferencia: r.get(6)?,
        monto_final_esperado: r.get(7)?,
        monto_final_real: r.get(8)?,
        diferencia: r.get(9)?,
        observacion: r.get(10)?,
        estado: r.get(11)?,
    })
}

const SELECT_CAJA: &str = "SELECT id, usuario_id, fecha_apertura, fecha_cierre, monto_inicial, ingresos_efectivo, ingresos_transferencia, monto_final_esperado, monto_final_real, diferencia, observacion, estado FROM cajas";

#[tauri::command]
pub fn caja_abierta(db: State<DbState>, session: State<SessionState>) -> Result<Option<Caja>, String> {
    let id_usuario = usuario_actual(&session)?;
    let conn = db.0.lock().unwrap();
    let sql = format!("{} WHERE usuario_id = ?1 AND estado = 1 LIMIT 1", SELECT_CAJA);
    conn.query_row(&sql, params![id_usuario], row_to_caja).map(Some).or_else(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        _ => Err(e.to_string()),
    })
}

#[tauri::command]
pub fn abrir_caja(db: State<DbState>, session: State<SessionState>, monto_inicial: f64) -> Result<i64, String> {
    let id_usuario = usuario_actual(&session)?;
    let conn = db.0.lock().unwrap();

    let existe: Option<i64> = conn
        .query_row("SELECT id FROM cajas WHERE usuario_id = ?1 AND estado = 1 LIMIT 1", params![id_usuario], |r| r.get(0))
        .ok();
    if existe.is_some() {
        return Err("Ya tienes una caja abierta.".into());
    }

    conn.execute(
        "INSERT INTO cajas (usuario_id, fecha_apertura, monto_inicial, estado) VALUES (?1, CURRENT_TIMESTAMP, ?2, 1)",
        params![id_usuario, monto_inicial],
    ).map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[derive(Serialize)]
pub struct ResumenCaja {
    pub ingresos_efectivo: f64,
    pub ingresos_transferencia: f64,
    pub ingresos_extras: f64,
    pub egresos: f64,
}

#[tauri::command]
pub fn resumen_caja(db: State<DbState>, id_caja: i64) -> Result<ResumenCaja, String> {
    let conn = db.0.lock().unwrap();
    let (efectivo, transferencias): (f64, f64) = conn
        .query_row(
            "SELECT COALESCE(SUM(CASE WHEN metodo_pago='Efectivo' THEN total ELSE 0 END),0),
                    COALESCE(SUM(CASE WHEN metodo_pago!='Efectivo' THEN total ELSE 0 END),0)
             FROM ventas WHERE caja_id = ?1 AND estado != 'Anulada'",
            params![id_caja],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    let (ingresos_extras, egresos): (f64, f64) = conn
        .query_row(
            "SELECT COALESCE(SUM(CASE WHEN tipo='INGRESO' THEN monto ELSE 0 END),0),
                    COALESCE(SUM(CASE WHEN tipo='EGRESO' THEN monto ELSE 0 END),0)
             FROM caja_movimientos WHERE caja_id = ?1",
            params![id_caja],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    Ok(ResumenCaja { ingresos_efectivo: efectivo, ingresos_transferencia: transferencias, ingresos_extras, egresos })
}

#[tauri::command]
pub fn cerrar_caja(db: State<DbState>, id_caja: i64, monto_final_real: f64, observacion: Option<String>) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    let resumen = {
        let (efectivo, transferencias): (f64, f64) = conn
            .query_row(
                "SELECT COALESCE(SUM(CASE WHEN metodo_pago='Efectivo' THEN total ELSE 0 END),0),
                        COALESCE(SUM(CASE WHEN metodo_pago!='Efectivo' THEN total ELSE 0 END),0)
                 FROM ventas WHERE caja_id = ?1 AND estado != 'Anulada'",
                params![id_caja],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|e| e.to_string())?;
        let (ingresos_extras, egresos): (f64, f64) = conn
            .query_row(
                "SELECT COALESCE(SUM(CASE WHEN tipo='INGRESO' THEN monto ELSE 0 END),0),
                        COALESCE(SUM(CASE WHEN tipo='EGRESO' THEN monto ELSE 0 END),0)
                 FROM caja_movimientos WHERE caja_id = ?1",
                params![id_caja],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|e| e.to_string())?;
        (efectivo, transferencias, ingresos_extras, egresos)
    };
    let (ingresos_efectivo, ingresos_transferencia, ingresos_extras, egresos) = resumen;

    let monto_inicial: f64 = conn
        .query_row("SELECT monto_inicial FROM cajas WHERE id = ?1", params![id_caja], |r| r.get(0))
        .map_err(|e| e.to_string())?;

    let monto_final_esperado = monto_inicial + ingresos_efectivo + ingresos_extras - egresos;
    let diferencia = monto_final_real - monto_final_esperado;

    conn.execute(
        "UPDATE cajas SET fecha_cierre = CURRENT_TIMESTAMP, ingresos_efectivo=?1, ingresos_transferencia=?2,
         monto_final_esperado=?3, monto_final_real=?4, diferencia=?5, observacion=?6, estado=0 WHERE id=?7",
        params![ingresos_efectivo, ingresos_transferencia, monto_final_esperado, monto_final_real, diferencia, observacion, id_caja],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

/// Replica `CajaController::index`: el Historial de Cajas es supervisión (ve las cajas de
/// TODOS los usuarios), por eso está bloqueado para el Técnico en Farmacia — que solo necesita
/// abrir/cerrar SU PROPIA caja para vender (esas operaciones sí siguen abiertas a todos).
#[tauri::command]
pub fn historial_cajas(db: State<DbState>, session: State<SessionState>, fecha_inicio: String, fecha_fin: String) -> Result<Vec<Caja>, String> {
    auth::exigir_no_tecnico(&session)?;
    let conn = db.0.lock().unwrap();
    let sql = format!("{} WHERE date(fecha_apertura) >= ?1 AND date(fecha_apertura) <= ?2 ORDER BY id DESC", SELECT_CAJA);
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![fecha_inicio, fecha_fin], row_to_caja).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct MovimientoCaja {
    pub id: i64,
    pub tipo: String,
    pub monto: f64,
    pub motivo: String,
    pub fecha_movimiento: String,
}

#[tauri::command]
pub fn movimientos_caja(db: State<DbState>, id_caja: i64) -> Result<Vec<MovimientoCaja>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, tipo, monto, motivo, fecha_movimiento FROM caja_movimientos WHERE caja_id = ?1 ORDER BY id DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![id_caja], |r| {
            Ok(MovimientoCaja { id: r.get(0)?, tipo: r.get(1)?, monto: r.get(2)?, motivo: r.get(3)?, fecha_movimiento: r.get(4)? })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn registrar_movimiento_caja(db: State<DbState>, id_caja: i64, tipo: String, monto: f64, motivo: String) -> Result<(), String> {
    if monto <= 0.0 {
        return Err("El monto debe ser mayor a cero.".into());
    }
    let conn = db.0.lock().unwrap();
    conn.execute(
        "INSERT INTO caja_movimientos (caja_id, tipo, monto, motivo) VALUES (?1,?2,?3,?4)",
        params![id_caja, tipo, monto, motivo],
    ).map_err(|e| e.to_string())?;
    Ok(())
}
