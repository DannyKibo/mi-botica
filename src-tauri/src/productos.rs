use crate::auditoria::registrar_accion;
use crate::auth::{self, SessionState};
use crate::db::DbState;
use crate::reportes::carpeta_documentos_mi_botica;
use calamine::Reader;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Serialize, Deserialize, Debug)]
pub struct Producto {
    pub id: Option<i64>,
    pub codigo_barras: Option<String>,
    pub registro_sanitario: Option<String>,
    pub nombre_generico: String,
    pub nombre_comercial: String,
    pub concentracion: Option<String>,
    pub forma_farmaceutica: Option<String>,
    pub presentacion: Option<String>,
    pub id_laboratorio: Option<i64>,
    pub id_categoria: Option<i64>,
    pub precio_compra: f64,
    pub precio_venta: f64,
    pub unidad_medida: Option<String>,
    pub requiere_receta: i64,
    pub stock_actual: i64,
    pub stock_minimo: i64,
    pub estado: i64,
    pub fraccionable: i64,
    pub unidades_por_caja: i64,
    pub unidad_fraccion: Option<String>,
    pub precio_fraccion: f64,
    // Campos calculados de solo lectura (join), no se insertan directamente
    pub categoria_nombre: Option<String>,
    pub laboratorio_nombre: Option<String>,
}

/// Replica la fórmula del sistema PHP original (ProductoController):
/// margen_ganancia = ((precio_venta - precio_compra) / precio_compra) * 100
fn calcular_margen(precio_compra: f64, precio_venta: f64) -> f64 {
    if precio_compra <= 0.0 {
        return 0.0;
    }
    ((precio_venta - precio_compra) / precio_compra) * 100.0
}

#[tauri::command]
pub fn listar_productos(db: State<DbState>, solo_activos: bool) -> Result<Vec<Producto>, String> {
    let conn = db.0.lock().unwrap();
    let sql = format!(
        "SELECT p.id, p.codigo_barras, p.registro_sanitario, p.nombre_generico, p.nombre_comercial,
                p.concentracion, p.forma_farmaceutica, p.presentacion, p.id_laboratorio, p.id_categoria,
                p.precio_compra, p.precio_venta, p.unidad_medida, p.requiere_receta, p.stock_actual,
                p.stock_minimo, p.estado, p.fraccionable, p.unidades_por_caja, p.unidad_fraccion, p.precio_fraccion,
                c.nombre, l.nombre
         FROM productos p
         LEFT JOIN categorias c ON c.id = p.id_categoria
         LEFT JOIN laboratorios l ON l.id = p.id_laboratorio
         {} ORDER BY p.nombre_comercial",
        if solo_activos { "WHERE p.estado = 1" } else { "" }
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Producto {
                id: r.get(0)?,
                codigo_barras: r.get(1)?,
                registro_sanitario: r.get(2)?,
                nombre_generico: r.get(3)?,
                nombre_comercial: r.get(4)?,
                concentracion: r.get(5)?,
                forma_farmaceutica: r.get(6)?,
                presentacion: r.get(7)?,
                id_laboratorio: r.get(8)?,
                id_categoria: r.get(9)?,
                precio_compra: r.get(10)?,
                precio_venta: r.get(11)?,
                unidad_medida: r.get(12)?,
                requiere_receta: r.get(13)?,
                stock_actual: r.get(14)?,
                stock_minimo: r.get(15)?,
                estado: r.get(16)?,
                fraccionable: r.get(17)?,
                unidades_por_caja: r.get(18)?,
                unidad_fraccion: r.get(19)?,
                precio_fraccion: r.get(20)?,
                categoria_nombre: r.get(21)?,
                laboratorio_nombre: r.get(22)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Replica `ProductoController::save`: el Técnico en Farmacia solo puede CREAR productos
/// nuevos, nunca editar uno existente (`$esEdicion && rol_id == 4` en el original).
#[tauri::command]
pub fn guardar_producto(db: State<DbState>, session: State<SessionState>, producto: Producto) -> Result<i64, String> {
    let (id_usuario, rol_id) = auth::sesion_actual(&session)?;
    if producto.id.is_some() && rol_id == 4 {
        return Err("No tienes permiso para editar productos existentes.".into());
    }
    let margen = calcular_margen(producto.precio_compra, producto.precio_venta);
    let conn = db.0.lock().unwrap();
    match producto.id {
        Some(id) => {
            conn.execute(
                "UPDATE productos SET codigo_barras=?1, registro_sanitario=?2, nombre_generico=?3, nombre_comercial=?4,
                 concentracion=?5, forma_farmaceutica=?6, presentacion=?7, id_laboratorio=?8, id_categoria=?9,
                 precio_compra=?10, precio_venta=?11, margen_ganancia=?12, unidad_medida=?13, requiere_receta=?14,
                 stock_minimo=?15, estado=?16, fraccionable=?17, unidades_por_caja=?18, unidad_fraccion=?19, precio_fraccion=?20
                 WHERE id=?21",
                params![
                    producto.codigo_barras, producto.registro_sanitario, producto.nombre_generico, producto.nombre_comercial,
                    producto.concentracion, producto.forma_farmaceutica, producto.presentacion, producto.id_laboratorio, producto.id_categoria,
                    producto.precio_compra, producto.precio_venta, margen, producto.unidad_medida, producto.requiere_receta,
                    producto.stock_minimo, producto.estado, producto.fraccionable, producto.unidades_por_caja, producto.unidad_fraccion, producto.precio_fraccion,
                    id
                ],
            ).map_err(|e| e.to_string())?;
            registrar_accion(
                &conn, id_usuario, "Productos", "EDITAR",
                &format!("Producto ID #{} editado. Precios: S/ {:.2} (Caja) / S/ {:.2} (Frac)", id, producto.precio_venta, producto.precio_fraccion),
                0.0,
            )?;
            Ok(id)
        }
        None => {
            conn.execute(
                "INSERT INTO productos (codigo_barras, registro_sanitario, nombre_generico, nombre_comercial, concentracion,
                 forma_farmaceutica, presentacion, id_laboratorio, id_categoria, precio_compra, precio_venta, margen_ganancia,
                 unidad_medida, requiere_receta, stock_actual, stock_minimo, estado, fraccionable, unidades_por_caja, unidad_fraccion, precio_fraccion)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,0,?15,?16,?17,?18,?19,?20)",
                params![
                    producto.codigo_barras, producto.registro_sanitario, producto.nombre_generico, producto.nombre_comercial,
                    producto.concentracion, producto.forma_farmaceutica, producto.presentacion, producto.id_laboratorio, producto.id_categoria,
                    producto.precio_compra, producto.precio_venta, margen, producto.unidad_medida, producto.requiere_receta,
                    producto.stock_minimo, producto.estado, producto.fraccionable, producto.unidades_por_caja, producto.unidad_fraccion, producto.precio_fraccion
                ],
            ).map_err(|e| e.to_string())?;
            let nuevo_id = conn.last_insert_rowid();
            registrar_accion(&conn, id_usuario, "Productos", "CREAR", &format!("Nuevo producto creado: {}", producto.nombre_comercial), 0.0)?;
            Ok(nuevo_id)
        }
    }
}

/// Replica `ProductoController::toggle`: activar/desactivar es, en la práctica, editar un
/// producto existente — mismo criterio que la edición (bloquearTecnico).
#[tauri::command]
pub fn eliminar_producto(db: State<DbState>, session: State<SessionState>, id: i64) -> Result<(), String> {
    let (id_usuario, _rol_id) = auth::exigir_no_tecnico(&session)?;
    let conn = db.0.lock().unwrap();
    conn.execute("UPDATE productos SET estado = 0 WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    registrar_accion(&conn, id_usuario, "Productos", "ESTADO", &format!("Se cambió el estado (Activo/Inactivo) del producto ID #{}", id), 0.0)?;
    Ok(())
}

#[derive(Serialize)]
pub struct AlertaStock {
    pub id: i64,
    pub nombre_comercial: String,
    pub stock_actual: i64,
    pub stock_minimo: i64,
}

#[tauri::command]
pub fn productos_stock_bajo(db: State<DbState>) -> Result<Vec<AlertaStock>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT id, nombre_comercial, stock_actual, stock_minimo FROM productos
             WHERE estado = 1 AND stock_actual <= stock_minimo ORDER BY stock_actual ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(AlertaStock {
                id: r.get(0)?,
                nombre_comercial: r.get(1)?,
                stock_actual: r.get(2)?,
                stock_minimo: r.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct AlertaVencimiento {
    pub lote_id: i64,
    pub producto: String,
    pub codigo_lote: String,
    pub fecha_vencimiento: String,
    pub cantidad_disponible: i64,
    pub dias_restantes: i64,
}

#[tauri::command]
pub fn productos_por_vencer(db: State<DbState>, dias: i64) -> Result<Vec<AlertaVencimiento>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT l.id, p.nombre_comercial, l.codigo_lote, l.fecha_vencimiento, l.cantidad_disponible,
                    CAST(julianday(l.fecha_vencimiento) - julianday('now') AS INTEGER) as dias
             FROM inventario_lotes l JOIN productos p ON p.id = l.id_producto
             WHERE l.estado = 1 AND l.cantidad_disponible > 0
               AND julianday(l.fecha_vencimiento) - julianday('now') <= ?1
             ORDER BY l.fecha_vencimiento ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![dias], |r| {
            Ok(AlertaVencimiento {
                lote_id: r.get(0)?,
                producto: r.get(1)?,
                codigo_lote: r.get(2)?,
                fecha_vencimiento: r.get(3)?,
                cantidad_disponible: r.get(4)?,
                dias_restantes: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

// ---------------- Importación/exportación masiva de códigos de barra ----------------
//
// Replica ProductoController::exportarPlantillaCodigos / importarCodigos: se exporta un
// Excel con todos los productos activos (para escanear el código de barras físico directo
// sobre cada celda con la pistola lectora) y luego se vuelve a importar ese mismo archivo
// para cargar todos los códigos de una sola vez.

/// Genera la plantilla .xlsx (ID, Producto, Registro Sanitario, Código de Barras) con todos
/// los productos activos, y la guarda en la carpeta "Mi Botica" de Documentos.
#[tauri::command]
pub fn exportar_plantilla_codigos(app: tauri::AppHandle, db: State<DbState>, session: State<SessionState>) -> Result<String, String> {
    auth::exigir_no_tecnico(&session)?;
    let productos: Vec<(i64, String, Option<String>, Option<String>)> = {
        let conn = db.0.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT id, nombre_comercial, registro_sanitario, codigo_barras FROM productos WHERE estado = 1 ORDER BY nombre_comercial")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<String>>(2)?, r.get::<_, Option<String>>(3)?))
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
    };

    let mut workbook = rust_xlsxwriter::Workbook::new();
    let sheet = workbook.add_worksheet();
    sheet.set_name("Codigos de Barra").map_err(|e| e.to_string())?;
    sheet.write_string(0, 0, "ID (no editar)").map_err(|e| e.to_string())?;
    sheet.write_string(0, 1, "Producto").map_err(|e| e.to_string())?;
    sheet.write_string(0, 2, "Registro Sanitario").map_err(|e| e.to_string())?;
    sheet.write_string(0, 3, "Código de Barras").map_err(|e| e.to_string())?;
    sheet.write_string(1, 0, "—").map_err(|e| e.to_string())?;
    sheet
        .write_string(1, 1, "EJEMPLO: haz clic en la celda de abajo y escanea el código físico del producto")
        .map_err(|e| e.to_string())?;
    sheet.write_string(1, 3, "7501234567890").map_err(|e| e.to_string())?;

    let mut fila = 2u32;
    for (id, nombre, rs, cb) in productos {
        sheet.write_number(fila, 0, id as f64).map_err(|e| e.to_string())?;
        sheet.write_string(fila, 1, &nombre).map_err(|e| e.to_string())?;
        sheet.write_string(fila, 2, rs.as_deref().unwrap_or("")).map_err(|e| e.to_string())?;
        sheet.write_string(fila, 3, cb.as_deref().unwrap_or("")).map_err(|e| e.to_string())?;
        fila += 1;
    }

    let carpeta = carpeta_documentos_mi_botica(&app)?;
    let destino = carpeta.join(format!("codigos_de_barra_{}.xlsx", chrono::Local::now().format("%Y-%m-%d")));
    workbook.save(&destino).map_err(|e| e.to_string())?;
    Ok(destino.to_string_lossy().to_string())
}

#[derive(Serialize)]
pub struct ResumenImportacionCodigos {
    pub actualizados: i64,
    pub sin_cambios: i64,
    pub conflictos: Vec<String>,
}

/// Replica Producto::actualizarCodigoBarrasSiLibre: solo actualiza el código si el producto
/// existe, es distinto al que ya tenía, y ningún OTRO producto lo tiene ya asignado.
fn actualizar_codigo_si_libre(conn: &rusqlite::Connection, id: i64, codigo_nuevo: &str) -> Result<&'static str, String> {
    let actual: Option<String> = match conn.query_row("SELECT codigo_barras FROM productos WHERE id = ?1", params![id], |r| r.get(0)) {
        Ok(v) => v,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok("no_encontrado"),
        Err(e) => return Err(e.to_string()),
    };
    if actual.as_deref() == Some(codigo_nuevo) {
        return Ok("sin_cambios");
    }
    let conflicto: Option<i64> = conn
        .query_row("SELECT id FROM productos WHERE codigo_barras = ?1 AND id != ?2", params![codigo_nuevo, id], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    if conflicto.is_some() {
        return Ok("conflicto");
    }
    conn.execute("UPDATE productos SET codigo_barras = ?1 WHERE id = ?2", params![codigo_nuevo, id])
        .map_err(|e| e.to_string())?;
    Ok("actualizado")
}

fn celda_como_texto(cell: Option<&calamine::Data>) -> String {
    use calamine::Data;
    match cell {
        None | Some(Data::Empty) => String::new(),
        Some(Data::String(s)) => s.trim().to_string(),
        Some(Data::Int(i)) => i.to_string(),
        Some(Data::Float(f)) => {
            if f.fract() == 0.0 {
                format!("{}", *f as i64)
            } else {
                f.to_string()
            }
        }
        Some(other) => other.to_string().trim().to_string(),
    }
}

/// Lee el .xlsx que el usuario eligió (ruta ya resuelta desde el diálogo nativo en el
/// frontend) y aplica los códigos de barra de la columna D fila por fila. Cualquier fila
/// cuya primera celda no sea un número entero se ignora en silencio — así el encabezado y la
/// fila de ejemplo de la plantilla se saltan solas.
#[tauri::command]
pub fn importar_codigos_barras(db: State<DbState>, session: State<SessionState>, ruta: String) -> Result<ResumenImportacionCodigos, String> {
    let (id_usuario, _rol_id) = auth::exigir_no_tecnico(&session)?;

    let mut workbook: calamine::Sheets<_> =
        calamine::open_workbook_auto(&ruta).map_err(|e| format!("No se pudo leer el archivo: {}", e))?;
    let nombre_hoja = workbook.sheet_names().get(0).cloned().ok_or("El archivo no tiene hojas.")?;
    let rango = workbook
        .worksheet_range(&nombre_hoja)
        .map_err(|e| format!("No se pudo leer la hoja: {}", e))?;

    let conn = db.0.lock().unwrap();
    let mut actualizados = 0i64;
    let mut sin_cambios = 0i64;
    let mut conflictos: Vec<String> = vec![];

    for fila in rango.rows() {
        let id_celda = celda_como_texto(fila.get(0));
        let id: i64 = match id_celda.parse() {
            Ok(v) => v,
            Err(_) => continue, // encabezado, fila de ejemplo, o fila vacía: se ignora
        };
        let codigo_nuevo = celda_como_texto(fila.get(3));
        if codigo_nuevo.is_empty() {
            continue;
        }

        match actualizar_codigo_si_libre(&conn, id, &codigo_nuevo)? {
            "actualizado" => actualizados += 1,
            "sin_cambios" => sin_cambios += 1,
            "conflicto" => conflictos.push(codigo_nuevo),
            _ => {} // "no_encontrado": el ID de la planilla ya no existe, se ignora
        }
    }

    registrar_accion(
        &conn,
        id_usuario,
        "Productos",
        "EDITAR",
        &format!("Importación masiva de códigos de barra: {} actualizados, {} en conflicto", actualizados, conflictos.len()),
        0.0,
    )?;

    Ok(ResumenImportacionCodigos { actualizados, sin_cambios, conflictos })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn_de_prueba() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE productos (id INTEGER PRIMARY KEY, codigo_barras TEXT);").unwrap();
        conn.execute("INSERT INTO productos (id, codigo_barras) VALUES (1, '111'), (2, '222'), (3, NULL)", [])
            .unwrap();
        conn
    }

    #[test]
    fn actualiza_cuando_el_codigo_esta_libre() {
        let conn = conn_de_prueba();
        assert_eq!(actualizar_codigo_si_libre(&conn, 3, "999").unwrap(), "actualizado");
        let guardado: String = conn.query_row("SELECT codigo_barras FROM productos WHERE id = 3", [], |r| r.get(0)).unwrap();
        assert_eq!(guardado, "999");
    }

    #[test]
    fn no_hace_nada_si_el_codigo_ya_es_el_mismo() {
        let conn = conn_de_prueba();
        assert_eq!(actualizar_codigo_si_libre(&conn, 1, "111").unwrap(), "sin_cambios");
    }

    #[test]
    fn detecta_conflicto_con_otro_producto() {
        let conn = conn_de_prueba();
        // El producto 1 intenta tomar el código que ya tiene el producto 2 — no debe permitirlo.
        assert_eq!(actualizar_codigo_si_libre(&conn, 1, "222").unwrap(), "conflicto");
        let intacto: String = conn.query_row("SELECT codigo_barras FROM productos WHERE id = 1", [], |r| r.get(0)).unwrap();
        assert_eq!(intacto, "111", "el código original no debe tocarse si hay conflicto");
    }

    #[test]
    fn ignora_silenciosamente_un_id_que_ya_no_existe() {
        let conn = conn_de_prueba();
        assert_eq!(actualizar_codigo_si_libre(&conn, 999, "888").unwrap(), "no_encontrado");
    }

    #[test]
    fn celda_texto_normaliza_numeros_enteros_sin_decimales() {
        // Un ID exportado como número en Excel vuelve como Float al leerlo con calamine —
        // debe verse como "5", no "5.0", para que el `.parse::<i64>()` de la importación funcione.
        assert_eq!(celda_como_texto(Some(&calamine::Data::Float(5.0))), "5");
        assert_eq!(celda_como_texto(Some(&calamine::Data::Int(7))), "7");
        assert_eq!(celda_como_texto(Some(&calamine::Data::String("  7501234567890  ".to_string()))), "7501234567890");
        assert_eq!(celda_como_texto(None), "");
        assert_eq!(celda_como_texto(Some(&calamine::Data::Empty)), "");
    }

    #[test]
    fn plantilla_exportada_se_puede_releer_con_calamine() {
        // Roundtrip real: escribe un .xlsx con rust_xlsxwriter (lo mismo que usa
        // exportar_plantilla_codigos) y lo vuelve a leer con calamine (lo mismo que usa
        // importar_codigos_barras), para detectar cualquier incompatibilidad entre ambas
        // librerías antes de que la sufra un usuario real.
        let dir = std::env::temp_dir();
        let ruta = dir.join(format!("test_plantilla_{}.xlsx", std::process::id()));

        let mut workbook = rust_xlsxwriter::Workbook::new();
        let sheet = workbook.add_worksheet();
        sheet.write_string(0, 0, "ID (no editar)").unwrap();
        sheet.write_string(0, 3, "Código de Barras").unwrap();
        sheet.write_number(1, 0, 42.0).unwrap();
        sheet.write_string(1, 3, "7501234567890").unwrap();
        workbook.save(&ruta).unwrap();

        let mut leido: calamine::Sheets<_> = calamine::open_workbook_auto(&ruta).unwrap();
        let nombre_hoja = leido.sheet_names()[0].clone();
        let rango = leido.worksheet_range(&nombre_hoja).unwrap();
        let filas: Vec<_> = rango.rows().collect();

        assert_eq!(celda_como_texto(filas[0].first()), "ID (no editar)");
        assert_eq!(celda_como_texto(filas[1].first()), "42");
        assert_eq!(celda_como_texto(filas[1].get(3)), "7501234567890");

        let _ = std::fs::remove_file(&ruta);
    }
}
