export interface SessionUser {
  id: number;
  usuario: string;
  nombre_completo: string;
  rol_id: number;
  rol_nombre: string;
  debe_cambiar_password: boolean;
}

export interface Categoria {
  id: number | null;
  nombre: string;
  descripcion: string | null;
  estado: number;
}

export interface Laboratorio {
  id: number | null;
  nombre: string;
  descripcion: string | null;
  estado: number;
}

export interface Proveedor {
  id: number | null;
  ruc: string;
  razon_social: string;
  representante: string | null;
  telefono: string | null;
  direccion: string | null;
  estado: number;
}

export interface Producto {
  id: number | null;
  codigo_barras: string | null;
  registro_sanitario: string | null;
  nombre_generico: string;
  nombre_comercial: string;
  concentracion: string | null;
  forma_farmaceutica: string | null;
  presentacion: string | null;
  id_laboratorio: number | null;
  id_categoria: number | null;
  precio_compra: number;
  precio_venta: number;
  unidad_medida: string | null;
  requiere_receta: number;
  stock_actual: number;
  stock_minimo: number;
  estado: number;
  fraccionable: number;
  unidades_por_caja: number;
  unidad_fraccion: string | null;
  precio_fraccion: number;
  categoria_nombre?: string | null;
  laboratorio_nombre?: string | null;
}

export interface Rol {
  id: number;
  nombre: string;
  descripcion: string | null;
}

export interface Usuario {
  id: number | null;
  nombres: string;
  apellidos: string;
  usuario: string;
  email: string | null;
  rol_id: number;
  estado: number;
  password: string | null;
  rol_nombre?: string | null;
}

export interface AlertaStock {
  id: number;
  nombre_comercial: string;
  stock_actual: number;
  stock_minimo: number;
}

export interface AlertaVencimiento {
  lote_id: number;
  producto: string;
  codigo_lote: string;
  fecha_vencimiento: string;
  cantidad_disponible: number;
  dias_restantes: number;
}

export interface Lote {
  id: number;
  id_producto: number;
  nombre_comercial: string;
  forma_farmaceutica: string | null;
  codigo_lote: string;
  fecha_vencimiento: string;
  cantidad_inicial: number;
  cantidad_disponible: number;
  categoria: string | null;
}

export interface MovimientoKardex {
  id: number;
  id_producto: number;
  nombre_comercial: string;
  usuario: string;
  tipo_movimiento: string;
  motivo: string;
  cantidad: number;
  saldo_actual: number;
  fecha: string;
}

export interface Auditoria {
  id: number;
  usuario: string;
  fecha_inicio: string;
  fecha_fin: string | null;
  estado: string;
  observaciones: string | null;
}

export interface DetalleAuditoria {
  id: number;
  id_lote: number;
  nombre_comercial: string;
  codigo_lote: string;
  fecha_vencimiento: string;
  stock_sistema: number;
  stock_fisico: number;
  contado: number;
  diferencia: number;
}

export interface AgregarEncontradoInput {
  id_auditoria: number;
  id_producto: number | null;
  nombre_producto: string | null;
  laboratorio: string | null;
  codigo_lote: string;
  fecha_vencimiento: string;
  cantidad: number;
  registro_sanitario: string | null;
}

export interface AgregarEncontradoResultado {
  id_lote: number;
  stock_sistema: number;
}

export interface ResumenImportacionCodigos {
  actualizados: number;
  sin_cambios: number;
  conflictos: string[];
}

export interface CompraResumen {
  id: number;
  proveedor: string;
  tipo_comprobante: string;
  serie_comprobante: string | null;
  num_comprobante: string;
  fecha_compra: string;
  total: number;
  estado: string;
}

export interface DetalleCompra {
  id: number;
  id_producto: number;
  nombre_comercial: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
  id_lote: number | null;
  codigo_lote: string | null;
  fecha_vencimiento: string | null;
}

export interface CabeceraCompra {
  id_proveedor: number;
  tipo_comprobante: string;
  serie_comprobante: string | null;
  num_comprobante: string;
  fecha_compra: string;
  impuesto: number;
  total: number;
  estado: string;
}

export interface DetalleCompraInput {
  id_producto: number;
  cantidad: number;
  precio_unitario: number;
  precio_venta: number;
  precio_fraccion: number;
  subtotal: number;
  lote: string;
  vencimiento: string;
  registro_sanitario: string | null;
  actualizar_precio: boolean;
  actualizar_rs: boolean;
}

export interface LoteRecepcion {
  id_detalle: number;
  lote: string;
  vencimiento: string;
}

export interface CabeceraDevolucion {
  id_compra: number;
  num_documento_prov: string;
  motivo: string | null;
  total_devuelto: number;
  fecha_devolucion: string;
}

export interface DetalleDevolucionInput {
  id_producto: number;
  id_lote: number;
  cantidad: number;
  precio_costo: number;
  subtotal: number;
}

export interface Cliente {
  id: number | null;
  tipo_documento: string;
  num_documento: string;
  nombres: string;
  telefono: string | null;
  direccion: string | null;
  puntos_acumulados: number;
  estado: number;
}

export interface ClienteRapido {
  tipo_documento: string;
  num_documento: string;
  nombres: string;
  telefono: string | null;
  direccion: string | null;
}

export interface ProveedorRapido {
  ruc: string;
  razon_social: string;
  representante: string | null;
  telefono: string | null;
  direccion: string | null;
}

export interface Caja {
  id: number;
  usuario_id: number;
  fecha_apertura: string;
  fecha_cierre: string | null;
  monto_inicial: number;
  ingresos_efectivo: number;
  ingresos_transferencia: number;
  monto_final_esperado: number | null;
  monto_final_real: number | null;
  diferencia: number | null;
  observacion: string | null;
  estado: number;
}

export interface ResumenCaja {
  ingresos_efectivo: number;
  ingresos_transferencia: number;
  ingresos_extras: number;
  egresos: number;
}

export interface MovimientoCaja {
  id: number;
  tipo: string;
  monto: number;
  motivo: string;
  fecha_movimiento: string;
}

export interface VentaResumen {
  id: number;
  cliente: string;
  cajero: string;
  tipo_comprobante: string;
  serie_comprobante: string | null;
  num_comprobante: string;
  fecha_venta: string;
  total: number;
  metodo_pago: string;
  estado: string;
}

export interface DetalleVenta {
  id: number;
  id_producto: number;
  nombre_comercial: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
  id_lote: number | null;
  codigo_lote: string | null;
  tipo_unidad: string | null;
}

export interface CabeceraVenta {
  id_cliente: number;
  tipo_comprobante: string;
  subtotal: number;
  descuento: number;
  igv: number;
  total: number;
  metodo_pago: string;
  pago_recibido: number | null;
  vuelto: number | null;
  puntos_usados: number;
  medico_cmp: string | null;
}

export interface DetalleVentaInput {
  id_producto: number;
  cantidad: number;
  precio_unitario: number;
  tipo_unidad: string;
  id_lote: number | null;
}

export interface AuditAcceso {
  id: number;
  usuario: string;
  nombres: string;
  accion: string;
  ip_address: string | null;
  user_agent: string | null;
  fecha: string;
}

export interface AuditAccion {
  id: number;
  usuario: string;
  nombres: string;
  modulo: string;
  accion: string;
  descripcion: string;
  monto_afectado: number;
  fecha: string;
}

export interface BackupInfo {
  nombre: string;
  fecha: string;
  tamano_kb: number;
}
