mod db;
mod auth;
mod auditoria;
mod backup;
mod catalogo;
mod productos;
mod usuarios;
mod inventario;
mod compras;
mod clientes;
mod configuracion;
mod caja;
mod ventas;
mod reportes;

use auth::SessionState;
use db::{DbPathState, DbState};
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("no se pudo resolver el directorio de datos de la app");
            let (conn, db_path) = db::init_db(app_data_dir);
            app.manage(DbState(Mutex::new(conn)));
            app.manage(DbPathState(db_path));
            app.manage(SessionState(Mutex::new(None)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Autenticación
            auth::login,
            auth::logout,
            auth::current_user,
            auth::cambiar_password,
            // Catálogo: categorías, laboratorios, proveedores
            catalogo::listar_categorias,
            catalogo::guardar_categoria,
            catalogo::eliminar_categoria,
            catalogo::listar_laboratorios,
            catalogo::guardar_laboratorio,
            catalogo::eliminar_laboratorio,
            catalogo::listar_proveedores,
            catalogo::guardar_proveedor,
            catalogo::eliminar_proveedor,
            catalogo::crear_proveedor_rapido,
            // Productos e inventario básico
            productos::listar_productos,
            productos::guardar_producto,
            productos::eliminar_producto,
            productos::productos_stock_bajo,
            productos::productos_por_vencer,
            productos::exportar_plantilla_codigos,
            productos::importar_codigos_barras,
            // Usuarios y roles
            usuarios::listar_roles,
            usuarios::listar_usuarios,
            usuarios::guardar_usuario,
            usuarios::eliminar_usuario,
            // Inventario: lotes, kardex, inventario físico
            inventario::listar_lotes_activos,
            inventario::registrar_entrada_manual,
            inventario::listar_kardex,
            inventario::listar_auditorias,
            inventario::iniciar_auditoria,
            inventario::detalles_auditoria,
            inventario::guardar_conteo_parcial,
            inventario::finalizar_auditoria,
            inventario::cancelar_auditoria,
            inventario::iniciar_auditoria_aleatoria,
            inventario::agregar_lote_encontrado,
            inventario::exportar_detalle_auditoria,
            inventario::exportar_conteo_auditoria,
            // Compras
            compras::listar_compras,
            compras::detalles_compra,
            compras::crear_compra,
            compras::procesar_recepcion,
            compras::registrar_devolucion,
            // Clientes
            clientes::listar_clientes,
            clientes::guardar_cliente,
            clientes::eliminar_cliente,
            clientes::crear_cliente_rapido,
            // Configuración
            configuracion::obtener_configuracion,
            configuracion::guardar_configuracion,
            configuracion::subir_logo,
            configuracion::quitar_logo,
            // Auditoría
            auditoria::listar_accesos,
            auditoria::listar_acciones,
            // Backups
            backup::listar_backups,
            backup::generar_backup,
            backup::carpeta_backups_ruta,
            backup::restaurar_backup,
            backup::vaciar_sistema,
            // Reportes (exportación de archivos a disco)
            reportes::guardar_archivo_exportado,
            // Caja
            caja::caja_abierta,
            caja::abrir_caja,
            caja::resumen_caja,
            caja::cerrar_caja,
            caja::historial_cajas,
            caja::movimientos_caja,
            caja::registrar_movimiento_caja,
            // Ventas (POS)
            ventas::listar_ventas,
            ventas::detalles_venta,
            ventas::registrar_venta,
            ventas::anular_venta,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
