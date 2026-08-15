use crate::auth::{self, SessionState};
use std::path::PathBuf;
use tauri::{Manager, State};

/// Resuelve (y crea si hace falta) la carpeta "Mi Botica" dentro de Documentos, donde se
/// guardan todos los archivos exportados por la app (CSV, Excel). La reutilizan tanto el
/// exportador genérico de este módulo como los de auditoría (inventario.rs) y de códigos de
/// barra (productos.rs).
pub(crate) fn carpeta_documentos_mi_botica(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .document_dir()
        .or_else(|_| app.path().app_data_dir())
        .map_err(|e| e.to_string())?;
    let carpeta = base.join("Mi Botica");
    std::fs::create_dir_all(&carpeta).map_err(|e| e.to_string())?;
    Ok(carpeta)
}

fn nombre_seguro(nombre_archivo: &str) -> Result<String, String> {
    Ok(std::path::Path::new(nombre_archivo)
        .file_name()
        .ok_or("Nombre de archivo inválido")?
        .to_string_lossy()
        .to_string())
}

/// Guarda contenido de texto (CSV) dentro de la carpeta "Mi Botica" en Documentos. Devuelve
/// la ruta completa del archivo escrito. Reemplaza al enfoque PHP de descarga por HTTP (aquí
/// no hay navegador ni servidor: se escribe directo en disco).
pub(crate) fn guardar_texto_en_documentos(app: &tauri::AppHandle, nombre_archivo: &str, contenido: &str) -> Result<String, String> {
    let carpeta = carpeta_documentos_mi_botica(app)?;
    let destino = carpeta.join(nombre_seguro(nombre_archivo)?);
    // Antepone el BOM UTF-8 para que Excel abra bien los acentos del CSV en Windows.
    let mut bytes: Vec<u8> = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice(contenido.as_bytes());
    std::fs::write(&destino, bytes).map_err(|e| e.to_string())?;
    Ok(destino.to_string_lossy().to_string())
}

/// Replica `ReporteController`: todo el controlador está bloqueado para el Técnico en Farmacia
/// (bloquearTecnico en el constructor original).
#[tauri::command]
pub fn guardar_archivo_exportado(session: State<SessionState>, app: tauri::AppHandle, nombre_archivo: String, contenido: String) -> Result<String, String> {
    auth::exigir_no_tecnico(&session)?;
    guardar_texto_en_documentos(&app, &nombre_archivo, &contenido)
}
