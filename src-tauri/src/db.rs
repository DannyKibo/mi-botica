use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct DbState(pub Mutex<Connection>);

/// Ruta absoluta del archivo botica.sqlite en disco. Se guarda por separado (no dentro del
/// Mutex) porque comandos como backup/restaurar necesitan el path del archivo sin tener que
/// bloquear la conexión.
pub struct DbPathState(pub PathBuf);

const SCHEMA_SQL: &str = include_str!("../migrations/schema.sql");
const SEED_SQL: &str = include_str!("../migrations/seed.sql");

/// Abre (o crea) la base de datos SQLite local de la aplicación.
/// Vive en el directorio de datos de la app en la PC del usuario, por ejemplo:
///   Windows: C:\Users\<usuario>\AppData\Roaming\com.mibotica.desktop\botica.sqlite
pub fn init_db(app_data_dir: PathBuf) -> (Connection, PathBuf) {
    std::fs::create_dir_all(&app_data_dir).expect("no se pudo crear el directorio de datos");
    let db_path = app_data_dir.join("botica.sqlite");
    let is_new = !db_path.exists();

    let conn = Connection::open(&db_path).expect("no se pudo abrir la base de datos SQLite");
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    conn.execute_batch(SCHEMA_SQL).expect("error aplicando el esquema");

    if is_new {
        conn.execute_batch(SEED_SQL).expect("error aplicando los datos iniciales");
    }

    (conn, db_path)
}
