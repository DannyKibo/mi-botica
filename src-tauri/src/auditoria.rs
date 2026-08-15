use crate::auth::{self, SessionState};
use crate::db::DbState;
use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::State;

/// Inserta una fila en audit_acciones. Acepta `&Connection` o `&Transaction` (Transaction
/// hace deref a Connection), así que se puede llamar tanto dentro de una transacción ya
/// abierta en otro módulo como con una conexión suelta.
pub fn registrar_accion(conn: &Connection, id_usuario: i64, modulo: &str, accion: &str, descripcion: &str, monto: f64) -> Result<(), String> {
    conn.execute(
        "INSERT INTO audit_acciones (id_usuario, modulo, accion, descripcion, monto_afectado) VALUES (?1,?2,?3,?4,?5)",
        params![id_usuario, modulo, accion, descripcion, monto],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize)]
pub struct AuditAcceso {
    pub id: i64,
    pub usuario: String,
    pub nombres: String,
    pub accion: String,
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
    pub fecha: String,
}

/// Replica `AuditoriaController::index`: el Panel de Auditoría y Seguridad es exclusivo del
/// Administrador (soloAdministrador), no basta con ser un rol "elevado".
#[tauri::command]
pub fn listar_accesos(db: State<DbState>, session: State<SessionState>, limite: i64) -> Result<Vec<AuditAcceso>, String> {
    auth::exigir_admin(&session)?;
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT a.id, u.usuario, u.nombres, a.accion, a.ip_address, a.user_agent, a.fecha
             FROM audit_accesos a INNER JOIN usuarios u ON a.id_usuario = u.id
             ORDER BY a.fecha DESC LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![limite], |r| {
            Ok(AuditAcceso {
                id: r.get(0)?,
                usuario: r.get(1)?,
                nombres: r.get(2)?,
                accion: r.get(3)?,
                ip_address: r.get(4)?,
                user_agent: r.get(5)?,
                fecha: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct AuditAccion {
    pub id: i64,
    pub usuario: String,
    pub nombres: String,
    pub modulo: String,
    pub accion: String,
    pub descripcion: String,
    pub monto_afectado: f64,
    pub fecha: String,
}

#[tauri::command]
pub fn listar_acciones(db: State<DbState>, session: State<SessionState>, limite: i64) -> Result<Vec<AuditAccion>, String> {
    auth::exigir_admin(&session)?;
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT a.id, u.usuario, u.nombres, a.modulo, a.accion, a.descripcion, a.monto_afectado, a.fecha
             FROM audit_acciones a INNER JOIN usuarios u ON a.id_usuario = u.id
             ORDER BY a.fecha DESC LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![limite], |r| {
            Ok(AuditAccion {
                id: r.get(0)?,
                usuario: r.get(1)?,
                nombres: r.get(2)?,
                modulo: r.get(3)?,
                accion: r.get(4)?,
                descripcion: r.get(5)?,
                monto_afectado: r.get(6)?,
                fecha: r.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}
