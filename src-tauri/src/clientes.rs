use crate::auth::{self, SessionState};
use crate::db::DbState;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Serialize, Deserialize, Debug)]
pub struct Cliente {
    pub id: Option<i64>,
    pub tipo_documento: String,
    pub num_documento: String,
    pub nombres: String,
    pub telefono: Option<String>,
    pub direccion: Option<String>,
    pub puntos_acumulados: i64,
    pub estado: i64,
}

#[tauri::command]
pub fn listar_clientes(db: State<DbState>) -> Result<Vec<Cliente>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, tipo_documento, num_documento, nombres, telefono, direccion, puntos_acumulados, estado FROM clientes WHERE estado = 1 ORDER BY nombres")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Cliente {
                id: r.get(0)?,
                tipo_documento: r.get(1)?,
                num_documento: r.get(2)?,
                nombres: r.get(3)?,
                telefono: r.get(4)?,
                direccion: r.get(5)?,
                puntos_acumulados: r.get(6)?,
                estado: r.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Replica `ClienteController::save`: bloqueado para el Técnico en Farmacia. Para vender a un
/// cliente nuevo desde el POS sin acceso al directorio completo, existe el comando aparte
/// `crear_cliente_rapido` (equivalente a `ClienteController::crearRapido`, sin esta restricción).
#[tauri::command]
pub fn guardar_cliente(db: State<DbState>, session: State<SessionState>, cliente: Cliente) -> Result<i64, String> {
    auth::exigir_no_tecnico(&session)?;
    let conn = db.0.lock().unwrap();
    match cliente.id {
        Some(id) => {
            conn.execute(
                "UPDATE clientes SET tipo_documento=?1, num_documento=?2, nombres=?3, telefono=?4, direccion=?5 WHERE id=?6",
                params![cliente.tipo_documento, cliente.num_documento, cliente.nombres, cliente.telefono, cliente.direccion, id],
            ).map_err(|e| e.to_string())?;
            Ok(id)
        }
        None => {
            conn.execute(
                "INSERT INTO clientes (tipo_documento, num_documento, nombres, telefono, direccion) VALUES (?1,?2,?3,?4,?5)",
                params![cliente.tipo_documento, cliente.num_documento, cliente.nombres, cliente.telefono, cliente.direccion],
            ).map_err(|e| e.to_string())?;
            Ok(conn.last_insert_rowid())
        }
    }
}

#[tauri::command]
pub fn eliminar_cliente(db: State<DbState>, session: State<SessionState>, id: i64) -> Result<(), String> {
    auth::exigir_no_tecnico(&session)?;
    if id == 1 {
        return Err("El cliente 'Público en General' no se puede eliminar.".into());
    }
    let conn = db.0.lock().unwrap();
    conn.execute("UPDATE clientes SET estado = 0 WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Replica `ClienteController::crearRapido`: alta rápida de un cliente nuevo, disponible para
/// TODOS los roles (incluido el Técnico en Farmacia) — se usa desde el Punto de Venta cuando el
/// cliente todavía no existe en el directorio, sin necesitar acceso al módulo completo de
/// Clientes.
#[derive(Deserialize)]
pub struct ClienteRapido {
    pub tipo_documento: String,
    pub num_documento: String,
    pub nombres: String,
    pub telefono: Option<String>,
    pub direccion: Option<String>,
}

#[tauri::command]
pub fn crear_cliente_rapido(db: State<DbState>, session: State<SessionState>, datos: ClienteRapido) -> Result<i64, String> {
    auth::sesion_actual(&session)?; // solo exige sesión activa, cualquier rol
    let num_documento = datos.num_documento.trim().to_string();
    let nombres = datos.nombres.trim().to_string();
    if num_documento.is_empty() || nombres.is_empty() {
        return Err("Documento y Nombres son obligatorios.".into());
    }
    let conn = db.0.lock().unwrap();
    conn.execute(
        "INSERT INTO clientes (tipo_documento, num_documento, nombres, telefono, direccion, estado) VALUES (?1,?2,?3,?4,?5,1)",
        params![
            if datos.tipo_documento.trim().is_empty() { "DNI".to_string() } else { datos.tipo_documento },
            num_documento,
            nombres,
            datos.telefono,
            datos.direccion
        ],
    )
    .map_err(|_| "No se pudo guardar (¿documento duplicado?).".to_string())?;
    Ok(conn.last_insert_rowid())
}
