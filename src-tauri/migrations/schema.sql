-- ============================================================
-- Mi Botica Desktop - Esquema SQLite (migrado desde MySQL)
-- Adaptado de database/botica_db_completo.sql del sistema PHP original.
-- Cambios respecto al original: AUTO_INCREMENT -> INTEGER PRIMARY KEY,
-- ENUM -> TEXT + CHECK, decimal -> REAL, timestamp/datetime/date -> TEXT (ISO8601).
-- ============================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  descripcion TEXT
);

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombres TEXT NOT NULL,
  apellidos TEXT NOT NULL,
  usuario TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  debe_cambiar_password INTEGER NOT NULL DEFAULT 0,
  email TEXT,
  rol_id INTEGER NOT NULL REFERENCES roles(id),
  estado INTEGER DEFAULT 1,
  ultimo_login TEXT,
  creado_en TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_accesos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  id_usuario INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  accion TEXT NOT NULL CHECK(accion IN ('LOGIN','LOGOUT')),
  ip_address TEXT,
  user_agent TEXT,
  fecha TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_acciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  id_usuario INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  modulo TEXT NOT NULL,
  accion TEXT NOT NULL,
  descripcion TEXT NOT NULL,
  monto_afectado REAL DEFAULT 0,
  fecha TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cajas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  fecha_apertura TEXT NOT NULL,
  fecha_cierre TEXT,
  monto_inicial REAL NOT NULL,
  ingresos_efectivo REAL DEFAULT 0,
  ingresos_transferencia REAL DEFAULT 0,
  monto_final_esperado REAL,
  monto_final_real REAL,
  diferencia REAL,
  observacion TEXT,
  estado INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS caja_movimientos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  caja_id INTEGER NOT NULL REFERENCES cajas(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK(tipo IN ('INGRESO','EGRESO')),
  monto REAL NOT NULL,
  motivo TEXT NOT NULL,
  fecha_movimiento TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS categorias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  estado INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS clientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo_documento TEXT NOT NULL DEFAULT 'DNI',
  num_documento TEXT NOT NULL,
  nombres TEXT NOT NULL,
  telefono TEXT,
  direccion TEXT,
  puntos_acumulados INTEGER DEFAULT 0,
  estado INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS laboratorios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  estado INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS proveedores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ruc TEXT NOT NULL UNIQUE,
  razon_social TEXT NOT NULL,
  representante TEXT,
  telefono TEXT,
  direccion TEXT,
  estado INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS productos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo_barras TEXT UNIQUE,
  codigo_opm TEXT,
  registro_sanitario TEXT,
  nombre_generico TEXT NOT NULL,
  nombre_comercial TEXT NOT NULL,
  concentracion TEXT,
  forma_farmaceutica TEXT,
  presentacion TEXT,
  id_laboratorio INTEGER REFERENCES laboratorios(id) ON DELETE SET NULL,
  id_categoria INTEGER REFERENCES categorias(id) ON DELETE SET NULL,
  precio_compra REAL NOT NULL DEFAULT 0,
  precio_venta REAL NOT NULL DEFAULT 0,
  margen_ganancia REAL NOT NULL DEFAULT 0,
  unidad_medida TEXT,
  requiere_receta INTEGER DEFAULT 0,
  stock_actual INTEGER NOT NULL DEFAULT 0,
  stock_minimo INTEGER NOT NULL DEFAULT 10,
  estado INTEGER DEFAULT 1,
  fraccionable INTEGER DEFAULT 0,
  unidades_por_caja INTEGER DEFAULT 1,
  unidad_fraccion TEXT,
  precio_fraccion REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS opm_catalogo (
  cod_prod TEXT PRIMARY KEY,
  nom_prod TEXT,
  concent TEXT,
  forma_farm TEXT,
  presentac TEXT,
  fraccion TEXT,
  num_regsan TEXT,
  titular TEXT,
  situacion TEXT
);

CREATE TABLE IF NOT EXISTS compras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  id_proveedor INTEGER NOT NULL REFERENCES proveedores(id),
  id_usuario INTEGER NOT NULL REFERENCES usuarios(id),
  tipo_comprobante TEXT NOT NULL,
  serie_comprobante TEXT,
  num_comprobante TEXT NOT NULL,
  fecha_compra TEXT NOT NULL,
  fecha_registro TEXT DEFAULT CURRENT_TIMESTAMP,
  impuesto REAL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  estado TEXT DEFAULT 'Completada'
);

CREATE TABLE IF NOT EXISTS compra_detalles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  id_compra INTEGER NOT NULL REFERENCES compras(id) ON DELETE CASCADE,
  id_producto INTEGER NOT NULL REFERENCES productos(id),
  cantidad INTEGER NOT NULL,
  precio_unitario REAL NOT NULL,
  subtotal REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS inventario_lotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  id_producto INTEGER NOT NULL REFERENCES productos(id),
  id_compra_detalle INTEGER REFERENCES compra_detalles(id) ON DELETE CASCADE,
  codigo_lote TEXT NOT NULL,
  fecha_vencimiento TEXT NOT NULL,
  cantidad_inicial INTEGER NOT NULL,
  cantidad_disponible INTEGER NOT NULL,
  fecha_registro TEXT DEFAULT CURRENT_TIMESTAMP,
  documento_ingreso TEXT,
  registro_sanitario TEXT,
  estado INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS compras_devoluciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  id_compra INTEGER NOT NULL REFERENCES compras(id) ON DELETE CASCADE,
  id_usuario INTEGER NOT NULL REFERENCES usuarios(id),
  num_documento_prov TEXT NOT NULL,
  motivo TEXT,
  total_devuelto REAL NOT NULL DEFAULT 0,
  fecha_devolucion TEXT NOT NULL,
  fecha_registro TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS compras_devolucion_detalles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  id_devolucion INTEGER NOT NULL REFERENCES compras_devoluciones(id) ON DELETE CASCADE,
  id_producto INTEGER NOT NULL REFERENCES productos(id),
  id_lote INTEGER NOT NULL REFERENCES inventario_lotes(id),
  cantidad INTEGER NOT NULL,
  precio_costo REAL NOT NULL,
  subtotal REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS kardex (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  id_producto INTEGER NOT NULL REFERENCES productos(id),
  id_usuario INTEGER NOT NULL REFERENCES usuarios(id),
  tipo_movimiento TEXT NOT NULL CHECK(tipo_movimiento IN ('ENTRADA','SALIDA','AJUSTE')),
  motivo TEXT NOT NULL,
  cantidad INTEGER NOT NULL,
  saldo_actual INTEGER NOT NULL,
  fecha TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventario_auditorias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  id_usuario INTEGER NOT NULL REFERENCES usuarios(id),
  fecha_inicio TEXT DEFAULT CURRENT_TIMESTAMP,
  fecha_fin TEXT,
  estado TEXT DEFAULT 'Abierta' CHECK(estado IN ('Abierta','Finalizada','Cancelada')),
  observaciones TEXT
);

CREATE TABLE IF NOT EXISTS inventario_auditoria_detalles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  id_auditoria INTEGER NOT NULL REFERENCES inventario_auditorias(id) ON DELETE CASCADE,
  id_lote INTEGER NOT NULL REFERENCES inventario_lotes(id),
  stock_sistema INTEGER NOT NULL,
  stock_fisico INTEGER NOT NULL DEFAULT 0,
  contado INTEGER NOT NULL DEFAULT 0,
  revisado INTEGER NOT NULL DEFAULT 0,
  diferencia INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ventas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  id_cliente INTEGER NOT NULL REFERENCES clientes(id),
  caja_id INTEGER REFERENCES cajas(id),
  id_usuario INTEGER NOT NULL REFERENCES usuarios(id),
  tipo_comprobante TEXT NOT NULL DEFAULT 'Ticket',
  serie_comprobante TEXT,
  num_comprobante TEXT NOT NULL,
  fecha_venta TEXT DEFAULT CURRENT_TIMESTAMP,
  subtotal REAL NOT NULL DEFAULT 0,
  descuento REAL DEFAULT 0,
  igv REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  metodo_pago TEXT NOT NULL DEFAULT 'Efectivo',
  pago_recibido REAL,
  vuelto REAL,
  puntos_ganados INTEGER DEFAULT 0,
  puntos_usados INTEGER DEFAULT 0,
  medico_cmp TEXT,
  estado TEXT DEFAULT 'Completada'
);

CREATE TABLE IF NOT EXISTS venta_detalles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  id_venta INTEGER NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  id_producto INTEGER NOT NULL REFERENCES productos(id),
  cantidad INTEGER NOT NULL,
  precio_unitario REAL NOT NULL,
  subtotal REAL NOT NULL,
  id_lote INTEGER REFERENCES inventario_lotes(id) ON DELETE SET NULL,
  tipo_unidad TEXT DEFAULT 'Caja'
);

CREATE TABLE IF NOT EXISTS configuracion (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clave TEXT NOT NULL UNIQUE,
  valor TEXT,
  descripcion TEXT
);

CREATE INDEX IF NOT EXISTS idx_productos_categoria ON productos(id_categoria);
CREATE INDEX IF NOT EXISTS idx_productos_laboratorio ON productos(id_laboratorio);
CREATE INDEX IF NOT EXISTS idx_lotes_producto ON inventario_lotes(id_producto);
CREATE INDEX IF NOT EXISTS idx_kardex_producto ON kardex(id_producto);
CREATE INDEX IF NOT EXISTS idx_ventas_cliente ON ventas(id_cliente);
CREATE INDEX IF NOT EXISTS idx_compras_proveedor ON compras(id_proveedor);
