use crate::auth::{self, SessionState};
use crate::db::DbState;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Serialize, Deserialize, Debug)]
pub struct Categoria {
    pub id: Option<i64>,
    pub nombre: String,
    pub descripcion: Option<String>,
    pub estado: i64,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Laboratorio {
    pub id: Option<i64>,
    pub nombre: String,
    pub descripcion: Option<String>,
    pub estado: i64,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Proveedor {
    pub id: Option<i64>,
    pub ruc: String,
    pub razon_social: String,
    pub representante: Option<String>,
    pub telefono: Option<String>,
    pub direccion: Option<String>,
    pub estado: i64,
}

// ---------- Categorías ----------

#[tauri::command]
pub fn listar_categorias(db: State<DbState>) -> Result<Vec<Categoria>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, nombre, descripcion, estado FROM categorias ORDER BY nombre")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Categoria {
                id: r.get(0)?,
                nombre: r.get(1)?,
                descripcion: r.get(2)?,
                estado: r.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Replica `CategoriaController::save`: bloqueado para el Técnico en Farmacia (bloquearTecnico
/// en el constructor del controlador original).
#[tauri::command]
pub fn guardar_categoria(db: State<DbState>, session: State<SessionState>, categoria: Categoria) -> Result<i64, String> {
    auth::exigir_no_tecnico(&session)?;
    let conn = db.0.lock().unwrap();
    match categoria.id {
        Some(id) => {
            conn.execute(
                "UPDATE categorias SET nombre = ?1, descripcion = ?2, estado = ?3 WHERE id = ?4",
                params![categoria.nombre, categoria.descripcion, categoria.estado, id],
            )
            .map_err(|e| e.to_string())?;
            Ok(id)
        }
        None => {
            conn.execute(
                "INSERT INTO categorias (nombre, descripcion, estado) VALUES (?1, ?2, ?3)",
                params![categoria.nombre, categoria.descripcion, categoria.estado],
            )
            .map_err(|e| e.to_string())?;
            Ok(conn.last_insert_rowid())
        }
    }
}

#[tauri::command]
pub fn eliminar_categoria(db: State<DbState>, session: State<SessionState>, id: i64) -> Result<(), String> {
    auth::exigir_no_tecnico(&session)?;
    let conn = db.0.lock().unwrap();
    conn.execute("UPDATE categorias SET estado = 0 WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------- Laboratorios ----------

#[tauri::command]
pub fn listar_laboratorios(db: State<DbState>) -> Result<Vec<Laboratorio>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, nombre, descripcion, estado FROM laboratorios ORDER BY nombre")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Laboratorio {
                id: r.get(0)?,
                nombre: r.get(1)?,
                descripcion: r.get(2)?,
                estado: r.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Replica `LaboratorioController::save`: mismo criterio que categorías (bloquearTecnico).
#[tauri::command]
pub fn guardar_laboratorio(db: State<DbState>, session: State<SessionState>, laboratorio: Laboratorio) -> Result<i64, String> {
    auth::exigir_no_tecnico(&session)?;
    let conn = db.0.lock().unwrap();
    match laboratorio.id {
        Some(id) => {
            conn.execute(
                "UPDATE laboratorios SET nombre = ?1, descripcion = ?2, estado = ?3 WHERE id = ?4",
                params![laboratorio.nombre, laboratorio.descripcion, laboratorio.estado, id],
            )
            .map_err(|e| e.to_string())?;
            Ok(id)
        }
        None => {
            conn.execute(
                "INSERT INTO laboratorios (nombre, descripcion, estado) VALUES (?1, ?2, ?3)",
                params![laboratorio.nombre, laboratorio.descripcion, laboratorio.estado],
            )
            .map_err(|e| e.to_string())?;
            Ok(conn.last_insert_rowid())
        }
    }
}

#[tauri::command]
pub fn eliminar_laboratorio(db: State<DbState>, session: State<SessionState>, id: i64) -> Result<(), String> {
    auth::exigir_no_tecnico(&session)?;
    let conn = db.0.lock().unwrap();
    conn.execute("UPDATE laboratorios SET estado = 0 WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------- Proveedores ----------

#[tauri::command]
pub fn listar_proveedores(db: State<DbState>) -> Result<Vec<Proveedor>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, ruc, razon_social, representante, telefono, direccion, estado FROM proveedores ORDER BY razon_social")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Proveedor {
                id: r.get(0)?,
                ruc: r.get(1)?,
                razon_social: r.get(2)?,
                representante: r.get(3)?,
                telefono: r.get(4)?,
                direccion: r.get(5)?,
                estado: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Replica `ProveedorController::save`: bloqueado para el Técnico en Farmacia. Para que el
/// Técnico pueda igual dar de alta un proveedor nuevo rápido al registrar una compra, existe el
/// comando aparte `crear_proveedor_rapido` (equivalente a `ProveedorController::crearRapido`,
/// exento de esta restricción).
#[tauri::command]
pub fn guardar_proveedor(db: State<DbState>, session: State<SessionState>, proveedor: Proveedor) -> Result<i64, String> {
    auth::exigir_no_tecnico(&session)?;
    let conn = db.0.lock().unwrap();
    match proveedor.id {
        Some(id) => {
            conn.execute(
                "UPDATE proveedores SET ruc=?1, razon_social=?2, representante=?3, telefono=?4, direccion=?5, estado=?6 WHERE id=?7",
                params![proveedor.ruc, proveedor.razon_social, proveedor.representante, proveedor.telefono, proveedor.direccion, proveedor.estado, id],
            ).map_err(|e| e.to_string())?;
            Ok(id)
        }
        None => {
            conn.execute(
                "INSERT INTO proveedores (ruc, razon_social, representante, telefono, direccion, estado) VALUES (?1,?2,?3,?4,?5,?6)",
                params![proveedor.ruc, proveedor.razon_social, proveedor.representante, proveedor.telefono, proveedor.direccion, proveedor.estado],
            ).map_err(|e| e.to_string())?;
            Ok(conn.last_insert_rowid())
        }
    }
}

#[tauri::command]
pub fn eliminar_proveedor(db: State<DbState>, session: State<SessionState>, id: i64) -> Result<(), String> {
    auth::exigir_no_tecnico(&session)?;
    let conn = db.0.lock().unwrap();
    conn.execute("UPDATE proveedores SET estado = 0 WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Replica `ProveedorController::crearRapido`: alta rápida de un proveedor nuevo, disponible
/// para TODOS los roles (incluido el Técnico en Farmacia) — se usa desde el formulario de
/// Compras cuando el proveedor todavía no existe en el catálogo, sin necesitar acceso al
/// módulo completo de Proveedores.
#[derive(Deserialize)]
pub struct ProveedorRapido {
    pub ruc: String,
    pub razon_social: String,
    pub representante: Option<String>,
    pub telefono: Option<String>,
    pub direccion: Option<String>,
}

#[tauri::command]
pub fn crear_proveedor_rapido(db: State<DbState>, session: State<SessionState>, datos: ProveedorRapido) -> Result<i64, String> {
    auth::sesion_actual(&session)?; // solo exige sesión activa, cualquier rol
    let ruc = datos.ruc.trim().to_string();
    let razon_social = datos.razon_social.trim().to_string();
    if ruc.is_empty() || razon_social.is_empty() {
        return Err("RUC y Razón Social son obligatorios.".into());
    }
    let conn = db.0.lock().unwrap();
    conn.execute(
        "INSERT INTO proveedores (ruc, razon_social, representante, telefono, direccion, estado) VALUES (?1,?2,?3,?4,?5,1)",
        params![ruc, razon_social, datos.representante, datos.telefono, datos.direccion],
    )
    .map_err(|_| "No se pudo guardar (¿RUC duplicado?).".to_string())?;
    Ok(conn.last_insert_rowid())
}
