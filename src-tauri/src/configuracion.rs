use crate::auditoria::registrar_accion;
use crate::auth::{self, SessionState};
use crate::db::DbState;
use rusqlite::params;
use std::collections::HashMap;
use tauri::State;

/// Devuelve toda la tabla `configuracion` como un mapa clave -> valor (igv, moneda,
/// puntos_habilitado, puntos_por_sol, nombre_botica, etc.), tal como el sistema PHP la
/// consulta en varios módulos (Configuracion::get / Configuracion::getAll).
#[tauri::command]
pub fn obtener_configuracion(db: State<DbState>) -> Result<HashMap<String, String>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn.prepare("SELECT clave, valor FROM configuracion").map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?.unwrap_or_default())))
        .map_err(|e| e.to_string())?;
    let mut map = HashMap::new();
    for row in rows {
        let (k, v) = row.map_err(|e| e.to_string())?;
        map.insert(k, v);
    }
    Ok(map)
}

/// Guarda un lote de claves de configuración (equivalente a `ConfiguracionController::save`).
/// Todo el controlador está bloqueado para el Técnico en Farmacia (bloquearTecnico en el
/// constructor original). Además, `puntos_habilitado`/`puntos_por_sol` son exclusivos del
/// Administrador — se filtran aquí server-side aunque el formulario ya los oculte para
/// cualquier otro rol, por si alguien arma la llamada a mano. Hace UPSERT clave por clave y
/// deja registro en auditoría.
#[tauri::command]
pub fn guardar_configuracion(
    db: State<DbState>,
    session: State<SessionState>,
    mut valores: HashMap<String, String>,
) -> Result<(), String> {
    let (id_usuario, rol_id) = auth::exigir_no_tecnico(&session)?;
    if rol_id != 1 {
        valores.remove("puntos_habilitado");
        valores.remove("puntos_por_sol");
    }
    let mut conn = db.0.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for (clave, valor) in valores.iter() {
        tx.execute(
            "INSERT INTO configuracion (clave, valor) VALUES (?1, ?2)
             ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor",
            params![clave, valor],
        )
        .map_err(|e| e.to_string())?;
    }
    registrar_accion(&tx, id_usuario, "Configuración", "EDITAR", "Se actualizaron los parámetros de configuración del sistema", 0.0)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Replica la subida de logo de ConfiguracionController::save ($_FILES['logo']). En vez de
/// copiar el archivo a una carpeta pública servida por un servidor web (no aplica aquí: no
/// hay servidor), la imagen se guarda directo como data-URL base64 dentro de la propia clave
/// `logo` de configuración — así el logo queda embebido en el archivo .sqlite y viaja con los
/// backups, sin depender de una ruta externa que podría perderse. `ruta_origen` es la ruta ya
/// elegida por el usuario en el diálogo nativo de archivos del frontend.
#[tauri::command]
pub fn subir_logo(db: State<DbState>, session: State<SessionState>, ruta_origen: String) -> Result<String, String> {
    let (id_usuario, _rol_id) = auth::exigir_no_tecnico(&session)?;

    let ext = std::path::Path::new(&ruta_origen)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        _ => return Err("Formato no soportado. Usa una imagen PNG, JPG o GIF.".into()),
    };

    let bytes = std::fs::read(&ruta_origen).map_err(|e| format!("No se pudo leer el archivo: {}", e))?;
    if bytes.len() > 2 * 1024 * 1024 {
        return Err("La imagen es muy grande (máximo 2 MB). Elige una más liviana.".into());
    }

    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    let data_url = format!("data:{};base64,{}", mime, b64);

    let conn = db.0.lock().unwrap();
    conn.execute(
        "INSERT INTO configuracion (clave, valor) VALUES ('logo', ?1)
         ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor",
        params![data_url],
    )
    .map_err(|e| e.to_string())?;
    registrar_accion(&conn, id_usuario, "Configuración", "EDITAR", "Se actualizó el logo de la botica", 0.0)?;

    Ok(data_url)
}

/// Quita el logo configurado (vuelve a mostrarse el ícono por defecto en el sidebar).
#[tauri::command]
pub fn quitar_logo(db: State<DbState>, session: State<SessionState>) -> Result<(), String> {
    let (id_usuario, _rol_id) = auth::exigir_no_tecnico(&session)?;
    let conn = db.0.lock().unwrap();
    conn.execute("UPDATE configuracion SET valor = '' WHERE clave = 'logo'", [])
        .map_err(|e| e.to_string())?;
    registrar_accion(&conn, id_usuario, "Configuración", "EDITAR", "Se quitó el logo de la botica", 0.0)?;
    Ok(())
}
