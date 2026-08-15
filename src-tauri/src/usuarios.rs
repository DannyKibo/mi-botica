use crate::auth::{self, SessionState};
use crate::db::DbState;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Serialize, Deserialize, Debug)]
pub struct Usuario {
    pub id: Option<i64>,
    pub nombres: String,
    pub apellidos: String,
    pub usuario: String,
    pub email: Option<String>,
    pub rol_id: i64,
    pub estado: i64,
    // Solo se usa al crear/resetear; nunca se devuelve al listar.
    pub password: Option<String>,
    pub rol_nombre: Option<String>,
}

#[derive(Serialize)]
pub struct Rol {
    pub id: i64,
    pub nombre: String,
    pub descripcion: Option<String>,
}

#[tauri::command]
pub fn listar_roles(db: State<DbState>, session: State<SessionState>) -> Result<Vec<Rol>, String> {
    // UsuarioController entero está protegido con bloquearTecnico() en su constructor.
    auth::exigir_no_tecnico(&session)?;
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, nombre, descripcion FROM roles ORDER BY id")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Rol {
                id: r.get(0)?,
                nombre: r.get(1)?,
                descripcion: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn listar_usuarios(db: State<DbState>, session: State<SessionState>) -> Result<Vec<Usuario>, String> {
    auth::exigir_no_tecnico(&session)?;
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT u.id, u.nombres, u.apellidos, u.usuario, u.email, u.rol_id, u.estado, r.nombre
             FROM usuarios u JOIN roles r ON r.id = u.rol_id ORDER BY u.nombres",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Usuario {
                id: r.get(0)?,
                nombres: r.get(1)?,
                apellidos: r.get(2)?,
                usuario: r.get(3)?,
                email: r.get(4)?,
                rol_id: r.get(5)?,
                estado: r.get(6)?,
                password: None,
                rol_nombre: r.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Qué roles puede asignar cada rol al crear o editar un usuario. Replica
/// `UsuarioController::rolesQuePuedeAsignar`: el Administrador no tiene restricción (se maneja
/// aparte), y el Técnico en Farmacia ni siquiera llega aquí (bloqueado más abajo).
fn roles_que_puede_asignar(rol_actual: i64) -> &'static [i64] {
    match rol_actual {
        3 => &[2, 4], // Propietario: Químico Farmacéutico y Técnico en Farmacia
        2 => &[4],    // Químico Farmacéutico: solo Técnico en Farmacia
        _ => &[],
    }
}

/// Crea o actualiza un usuario. Si viene con `password`, se hashea y, en el caso de
/// una creación nueva, se marca `debe_cambiar_password=1` (igual que en el sistema PHP:
/// el usuario debe cambiar la clave asignada por el admin en su primer ingreso).
///
/// Replica la matriz de permisos de `UsuarioController::save`: el Administrador (rol 1) no
/// tiene restricciones. Propietario y Químico Farmacéutico, al CREAR, solo pueden asignar los
/// roles permitidos por `roles_que_puede_asignar`; al EDITAR, solo pueden tocar su propio
/// registro (nunca el de otro miembro del personal) y nunca pueden cambiarse su propio rol. El
/// Técnico en Farmacia queda bloqueado de plano (todo el módulo de Usuarios).
#[tauri::command]
pub fn guardar_usuario(db: State<DbState>, session: State<SessionState>, usuario: Usuario) -> Result<i64, String> {
    let (mi_id, mi_rol) = auth::exigir_no_tecnico(&session)?;
    let es_nuevo = usuario.id.is_none();

    if mi_rol != 1 {
        if es_nuevo {
            if !roles_que_puede_asignar(mi_rol).contains(&usuario.rol_id) {
                return Err("No tienes permiso para asignar ese rol.".into());
            }
        } else {
            let id_editado = usuario.id.unwrap();
            if id_editado != mi_id {
                return Err("No puedes editar los datos de otro miembro del personal.".into());
            }
            if usuario.rol_id != mi_rol {
                return Err("No puedes cambiar tu propio rol.".into());
            }
        }
    }

    let conn = db.0.lock().unwrap();
    match usuario.id {
        Some(id) => {
            conn.execute(
                "UPDATE usuarios SET nombres=?1, apellidos=?2, usuario=?3, email=?4, rol_id=?5, estado=?6 WHERE id=?7",
                params![usuario.nombres, usuario.apellidos, usuario.usuario, usuario.email, usuario.rol_id, usuario.estado, id],
            ).map_err(|e| e.to_string())?;

            if let Some(pw) = usuario.password.filter(|p| !p.is_empty()) {
                let hash = bcrypt::hash(&pw, bcrypt::DEFAULT_COST).map_err(|e| e.to_string())?;
                conn.execute(
                    "UPDATE usuarios SET password=?1, debe_cambiar_password=1 WHERE id=?2",
                    params![hash, id],
                ).map_err(|e| e.to_string())?;
            }
            Ok(id)
        }
        None => {
            let pw = usuario.password.filter(|p| !p.is_empty()).ok_or("La contraseña inicial es obligatoria")?;
            let hash = bcrypt::hash(&pw, bcrypt::DEFAULT_COST).map_err(|e| e.to_string())?;
            conn.execute(
                "INSERT INTO usuarios (nombres, apellidos, usuario, password, debe_cambiar_password, email, rol_id, estado)
                 VALUES (?1,?2,?3,?4,1,?5,?6,?7)",
                params![usuario.nombres, usuario.apellidos, usuario.usuario, hash, usuario.email, usuario.rol_id, usuario.estado],
            ).map_err(|e| e.to_string())?;
            Ok(conn.last_insert_rowid())
        }
    }
}

/// Replica `UsuarioController::toggle`: activar/desactivar personal es exclusivo del
/// Administrador (evita que Propietario/Químico Farmacéutico desactiven a otros, o se
/// desactiven a sí mismos por error), y el usuario id=1 (Administrador principal) nunca se
/// puede desactivar.
#[tauri::command]
pub fn eliminar_usuario(db: State<DbState>, session: State<SessionState>, id: i64) -> Result<(), String> {
    auth::exigir_admin(&session)?;
    if id == 1 {
        return Err("No se puede desactivar al Administrador principal.".into());
    }
    let conn = db.0.lock().unwrap();
    conn.execute("UPDATE usuarios SET estado = 0 WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
