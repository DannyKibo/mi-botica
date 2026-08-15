use crate::backup;
use crate::db::{DbPathState, DbState};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct SessionUser {
    pub id: i64,
    pub usuario: String,
    pub nombre_completo: String,
    pub rol_id: i64,
    pub rol_nombre: String,
    pub debe_cambiar_password: bool,
}

/// Estado en memoria de la sesión activa. Al ser una app de escritorio de un solo
/// usuario por instancia, no necesitamos cookies/tokens como en la versión web:
/// basta con guardar quién inició sesión mientras el proceso está vivo.
pub struct SessionState(pub Mutex<Option<SessionUser>>);

#[tauri::command]
pub fn login(
    db: State<DbState>,
    session: State<SessionState>,
    usuario: String,
    password: String,
) -> Result<SessionUser, String> {
    let conn = db.0.lock().unwrap();

    let result = conn.query_row(
        "SELECT u.id, u.nombres, u.apellidos, u.usuario, u.password, u.rol_id, u.debe_cambiar_password, r.nombre
         FROM usuarios u JOIN roles r ON r.id = u.rol_id
         WHERE u.usuario = ?1 AND u.estado = 1",
        params![usuario],
        |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, String>(7)?,
            ))
        },
    );

    let (id, nombres, apellidos, usuario_db, hash, rol_id, debe_cambiar, rol_nombre) = match result {
        Ok(row) => row,
        Err(_) => return Err("Usuario o contraseña incorrectos".into()),
    };

    let valido = bcrypt::verify(&password, &hash).map_err(|e| e.to_string())?;
    if !valido {
        return Err("Usuario o contraseña incorrectos".into());
    }

    conn.execute(
        "UPDATE usuarios SET ultimo_login = CURRENT_TIMESTAMP WHERE id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO audit_accesos (id_usuario, accion, ip_address, user_agent) VALUES (?1, 'LOGIN', '127.0.0.1', 'App Escritorio')",
        params![id],
    )
    .map_err(|e| e.to_string())?;

    let session_user = SessionUser {
        id,
        usuario: usuario_db,
        nombre_completo: format!("{} {}", nombres, apellidos),
        rol_id,
        rol_nombre,
        debe_cambiar_password: debe_cambiar != 0,
    };

    *session.0.lock().unwrap() = Some(session_user.clone());

    Ok(session_user)
}

#[tauri::command]
pub fn logout(db: State<DbState>, db_path: State<DbPathState>, session: State<SessionState>) -> Result<(), String> {
    let mut guard = session.0.lock().unwrap();
    if let Some(user) = guard.as_ref() {
        {
            let conn = db.0.lock().unwrap();
            conn.execute(
                "INSERT INTO audit_accesos (id_usuario, accion, ip_address, user_agent) VALUES (?1, 'LOGOUT', '127.0.0.1', 'App Escritorio')",
                params![user.id],
            )
            .map_err(|e| e.to_string())?;
        }

        // Backup automático al cerrar sesión. Es un "mejor esfuerzo": si falla por cualquier
        // motivo, no debe impedir que el usuario cierre sesión normalmente (igual que
        // AuthController::logout del sistema original, que lo envuelve en un try/catch mudo).
        if backup::generar_backup_interno(&db, &db_path.0).is_ok() {
            let _ = backup::limpiar_antiguos(&db_path.0);
        }
    }
    *guard = None;
    Ok(())
}

#[tauri::command]
pub fn current_user(session: State<SessionState>) -> Option<SessionUser> {
    session.0.lock().unwrap().clone()
}

// ---------------- Helpers de autorización compartidos ----------------
//
// El sistema PHP original protege cada controlador con `bloquearTecnico()` (rechaza al rol
// Técnico en Farmacia, rol_id 4) o `soloAdministrador()` (exige rol_id 1) en el constructor o
// al inicio de cada método. Aquí replicamos ambos como funciones reutilizables desde cualquier
// comando de Tauri, para no repetir la misma verificación de sesión en cada módulo. Son
// defensa en profundidad: el menú del sidebar ya oculta estas secciones según el rol
// (`views/layout.ts`), pero la capa de comandos de Rust también debe rechazar la operación
// aunque alguien intente invocarla sin pasar por la UI.

/// Devuelve (id_usuario, rol_id) de la sesión activa, o error si no hay sesión.
pub fn sesion_actual(session: &State<SessionState>) -> Result<(i64, i64), String> {
    let guard = session.0.lock().unwrap();
    let u = guard.as_ref().ok_or("No hay sesión activa")?;
    Ok((u.id, u.rol_id))
}

/// Replica `Controller::bloquearTecnico()`: rechaza al rol Técnico en Farmacia (rol_id 4).
/// Administrador, Químico Farmacéutico y Propietario pasan sin restricción.
pub fn exigir_no_tecnico(session: &State<SessionState>) -> Result<(i64, i64), String> {
    let (id, rol) = sesion_actual(session)?;
    if rol == 4 {
        return Err("No tienes permiso para acceder a esta sección.".into());
    }
    Ok((id, rol))
}

/// Replica `Controller::soloAdministrador()`: exige exactamente el rol Administrador (rol_id 1).
pub fn exigir_admin(session: &State<SessionState>) -> Result<(i64, i64), String> {
    let (id, rol) = sesion_actual(session)?;
    if rol != 1 {
        return Err("Esta acción es exclusiva del Administrador.".into());
    }
    Ok((id, rol))
}

#[tauri::command]
pub fn cambiar_password(
    db: State<DbState>,
    session: State<SessionState>,
    password_nueva: String,
    password_confirmar: String,
) -> Result<(), String> {
    if password_nueva.len() < 6 {
        return Err("La contraseña debe tener al menos 6 caracteres.".into());
    }
    if password_nueva != password_confirmar {
        return Err("Las contraseñas no coinciden.".into());
    }

    let user_id = {
        let guard = session.0.lock().unwrap();
        guard.as_ref().ok_or("No hay sesión activa")?.id
    };

    let hash = bcrypt::hash(&password_nueva, bcrypt::DEFAULT_COST).map_err(|e| e.to_string())?;

    let conn = db.0.lock().unwrap();
    conn.execute(
        "UPDATE usuarios SET password = ?1, debe_cambiar_password = 0 WHERE id = ?2",
        params![hash, user_id],
    )
    .map_err(|e| e.to_string())?;

    drop(conn);
    let mut guard = session.0.lock().unwrap();
    if let Some(u) = guard.as_mut() {
        u.debe_cambiar_password = false;
    }

    Ok(())
}
