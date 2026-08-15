use crate::auditoria::registrar_accion;
use crate::auth::SessionState;
use crate::db::{DbPathState, DbState};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use tauri::State;

/// Replica BackupController::checkAuth (bloquearTecnico): cualquier rol excepto Técnico (4).
fn sesion_no_tecnico(session: &State<SessionState>) -> Result<(i64, i64), String> {
    let guard = session.0.lock().unwrap();
    let user = guard.as_ref().ok_or("No hay sesión activa")?;
    if user.rol_id == 4 {
        return Err("No tienes permiso para administrar copias de seguridad.".into());
    }
    Ok((user.id, user.rol_id))
}

fn carpeta_backups(db_path: &PathBuf) -> PathBuf {
    db_path.parent().unwrap().join("backups")
}

#[derive(Serialize)]
pub struct BackupInfo {
    pub nombre: String,
    pub fecha: String,
    pub tamano_kb: f64,
}

#[tauri::command]
pub fn listar_backups(db_path: State<DbPathState>) -> Result<Vec<BackupInfo>, String> {
    let carpeta = carpeta_backups(&db_path.0);
    if !carpeta.exists() {
        return Ok(vec![]);
    }
    let mut items: Vec<(BackupInfo, std::time::SystemTime)> = vec![];
    for entry in fs::read_dir(&carpeta).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let nombre = entry.file_name().to_string_lossy().to_string();
        if !nombre.starts_with("backup_") || !nombre.ends_with(".sqlite") {
            continue;
        }
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        let modified = meta.modified().map_err(|e| e.to_string())?;
        let fecha: chrono::DateTime<chrono::Local> = modified.into();
        items.push((
            BackupInfo {
                nombre,
                fecha: fecha.format("%d/%m/%Y %H:%M:%S").to_string(),
                tamano_kb: (meta.len() as f64 / 1024.0 * 10.0).round() / 10.0,
            },
            modified,
        ));
    }
    items.sort_by(|a, b| b.1.cmp(&a.1));
    Ok(items.into_iter().map(|(info, _)| info).collect())
}

/// Genera una copia consistente del archivo .sqlite usando `VACUUM INTO`, que SQLite
/// garantiza atómica (no requiere cerrar la conexión activa, a diferencia de una copia
/// de archivo directa que podría capturar el .sqlite a medio escribir).
pub(crate) fn generar_backup_interno(db: &State<DbState>, db_path: &PathBuf) -> Result<String, String> {
    let carpeta = carpeta_backups(db_path);
    fs::create_dir_all(&carpeta).map_err(|e| e.to_string())?;
    let nombre = format!("backup_{}.sqlite", chrono::Local::now().format("%Y-%m-%d_%H%M%S"));
    let destino = carpeta.join(&nombre);
    let conn = db.0.lock().unwrap();
    conn.execute("VACUUM INTO ?1", params![destino.to_string_lossy().to_string()])
        .map_err(|e| e.to_string())?;
    Ok(nombre)
}

/// Deja como máximo los 5 backups más recientes intactos; de ahí en adelante, borra los
/// que tengan más de 30 días (igual que Backup::limpiarAntiguos del sistema original).
pub(crate) fn limpiar_antiguos(db_path: &PathBuf) -> Result<(), String> {
    let carpeta = carpeta_backups(db_path);
    let mut entries: Vec<(PathBuf, std::time::SystemTime)> = fs::read_dir(&carpeta)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().starts_with("backup_"))
        .filter_map(|e| e.metadata().ok().and_then(|m| m.modified().ok()).map(|t| (e.path(), t)))
        .collect();
    if entries.len() <= 5 {
        return Ok(());
    }
    entries.sort_by(|a, b| b.1.cmp(&a.1));
    let limite = std::time::SystemTime::now()
        .checked_sub(std::time::Duration::from_secs(30 * 86400))
        .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
    for (path, modified) in entries.into_iter().skip(5) {
        if modified < limite {
            let _ = fs::remove_file(path);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn generar_backup(db: State<DbState>, db_path: State<DbPathState>, session: State<SessionState>) -> Result<String, String> {
    let (id_usuario, _rol_id) = sesion_no_tecnico(&session)?;
    let nombre = generar_backup_interno(&db, &db_path.0)?;
    limpiar_antiguos(&db_path.0)?;
    {
        let conn = db.0.lock().unwrap();
        registrar_accion(&conn, id_usuario, "Backup", "GENERAR", &format!("Backup generado manualmente: {}", nombre), 0.0)?;
    }
    Ok(nombre)
}

#[tauri::command]
pub fn carpeta_backups_ruta(db_path: State<DbPathState>) -> Result<String, String> {
    Ok(carpeta_backups(&db_path.0).to_string_lossy().to_string())
}

/// Restaura la base de datos completa desde uno de los backups .sqlite generados por este
/// mismo sistema. Antes de tocar nada, genera un respaldo automático del estado actual (por
/// si la restauración fue un error). Cierra la sesión activa al terminar porque la tabla de
/// usuarios pudo haber cambiado por completo.
#[tauri::command]
pub fn restaurar_backup(
    db: State<DbState>,
    db_path: State<DbPathState>,
    session: State<SessionState>,
    nombre: String,
    confirmacion: String,
) -> Result<(), String> {
    sesion_no_tecnico(&session)?;
    if confirmacion != "RESTAURAR" {
        return Err("Debes escribir exactamente RESTAURAR para confirmar. No se hizo ningún cambio.".into());
    }

    // Evita path traversal: solo se acepta un nombre de archivo suelto, no una ruta.
    let nombre_seguro = PathBuf::from(&nombre)
        .file_name()
        .ok_or("Nombre de archivo inválido")?
        .to_string_lossy()
        .to_string();
    if !nombre_seguro.starts_with("backup_") || !nombre_seguro.ends_with(".sqlite") {
        return Err("Nombre de archivo de backup inválido.".into());
    }
    let origen = carpeta_backups(&db_path.0).join(&nombre_seguro);
    if !origen.exists() {
        return Err("El archivo de backup no existe.".into());
    }

    // Respaldo de seguridad obligatorio del estado ACTUAL antes de restaurar.
    generar_backup_interno(&db, &db_path.0)?;

    {
        let mut guard = db.0.lock().unwrap();
        // Reemplaza temporalmente la conexión activa por una en memoria para soltar
        // cualquier bloqueo sobre el archivo físico antes de sobrescribirlo.
        let vieja = std::mem::replace(&mut *guard, Connection::open_in_memory().map_err(|e| e.to_string())?);
        drop(vieja);
        fs::copy(&origen, &db_path.0).map_err(|e| e.to_string())?;
        let nueva = Connection::open(&db_path.0).map_err(|e| e.to_string())?;
        nueva.execute_batch("PRAGMA foreign_keys = ON;").map_err(|e| e.to_string())?;
        *guard = nueva;
    }

    // La restauración pudo haber cambiado por completo la tabla de usuarios: forzamos un
    // login limpio, igual que el sistema original (session_destroy tras restaurar).
    *session.0.lock().unwrap() = None;
    Ok(())
}

/// Deja el sistema listo para entregar a un cliente nuevo: vacía todo el contenido propio de
/// ESTA botica (productos, ventas, compras, clientes de prueba, usuarios de prueba, etc.) pero
/// conserva la estructura funcionando y las cuentas Administrador intactas. Exclusivo del rol
/// Administrador, y requiere escribir la frase de confirmación exacta.
#[tauri::command]
pub fn vaciar_sistema(
    db: State<DbState>,
    db_path: State<DbPathState>,
    session: State<SessionState>,
    confirmacion: String,
) -> Result<(), String> {
    {
        let guard = session.0.lock().unwrap();
        let user = guard.as_ref().ok_or("No hay sesión activa")?;
        if user.rol_id != 1 {
            return Err("Solo el Administrador puede preparar el sistema para entrega.".into());
        }
    }
    if confirmacion != "VACIAR SISTEMA" {
        return Err("Debes escribir exactamente VACIAR SISTEMA para confirmar. No se hizo ningún cambio.".into());
    }

    // Respaldo de seguridad obligatorio antes de vaciar nada.
    generar_backup_interno(&db, &db_path.0)?;

    let mut conn = db.0.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let tablas = [
        "audit_accesos",
        "audit_acciones",
        "caja_movimientos",
        "cajas",
        "categorias",
        "laboratorios",
        "compra_detalles",
        "compras",
        "compras_devolucion_detalles",
        "compras_devoluciones",
        "inventario_auditoria_detalles",
        "inventario_auditorias",
        "inventario_lotes",
        "kardex",
        "opm_catalogo",
        "venta_detalles",
        "ventas",
        "productos",
        "proveedores",
    ];
    for tabla in tablas {
        tx.execute(&format!("DELETE FROM {}", tabla), []).map_err(|e| e.to_string())?;
    }
    // Clientes: se conserva el registro #1 "Público en General" (usado internamente).
    tx.execute("DELETE FROM clientes WHERE id != 1", []).map_err(|e| e.to_string())?;
    // Usuarios: solo se conservan las cuentas Administrador (rol_id = 1).
    tx.execute("DELETE FROM usuarios WHERE rol_id != 1", []).map_err(|e| e.to_string())?;
    // Configuración propia de esta botica se limpia; moneda e IGV se mantienen (genéricos).
    tx.execute("UPDATE configuracion SET valor = '' WHERE clave NOT IN ('moneda', 'igv')", [])
        .map_err(|e| e.to_string())?;
    // Reinicia los autoincrementales de las tablas vaciadas por completo.
    let placeholders = tablas.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    tx.execute(
        &format!("DELETE FROM sqlite_sequence WHERE name IN ({})", placeholders),
        rusqlite::params_from_iter(tablas.iter()),
    )
    .map_err(|e| e.to_string())?;
    // Clientes: el próximo id insertado debe ser el 2 (se conservó el id 1).
    tx.execute("UPDATE sqlite_sequence SET seq = 1 WHERE name = 'clientes'", [])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    drop(conn);

    // Fuerza un login limpio: el sistema queda listo para el nuevo cliente.
    *session.0.lock().unwrap() = None;
    Ok(())
}
