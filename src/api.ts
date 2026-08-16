import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type {
  AgregarEncontradoInput,
  AgregarEncontradoResultado,
  AlertaStock,
  AlertaVencimiento,
  Auditoria,
  AuditAcceso,
  AuditAccion,
  BackupInfo,
  CabeceraCompra,
  CabeceraDevolucion,
  CabeceraVenta,
  Caja,
  Categoria,
  Cliente,
  ClienteRapido,
  CompraResumen,
  DetalleAuditoria,
  DetalleCompra,
  DetalleCompraInput,
  DetalleDevolucionInput,
  DetalleVenta,
  DetalleVentaInput,
  Laboratorio,
  Lote,
  LoteRecepcion,
  MovimientoCaja,
  MovimientoKardex,
  Producto,
  Proveedor,
  ProveedorRapido,
  ResumenCaja,
  ResumenImportacionCodigos,
  Rol,
  SessionUser,
  Usuario,
  VentaResumen,
} from "./types";

export const api = {
  // Auth
  login: (usuario: string, password: string) =>
    invoke<SessionUser>("login", { usuario, password }),
  logout: () => invoke<void>("logout"),
  currentUser: () => invoke<SessionUser | null>("current_user"),
  cambiarPassword: (password_nueva: string, password_confirmar: string) =>
    invoke<void>("cambiar_password", { passwordNueva: password_nueva, passwordConfirmar: password_confirmar }),

  // Categorías
  listarCategorias: () => invoke<Categoria[]>("listar_categorias"),
  guardarCategoria: (categoria: Categoria) => invoke<number>("guardar_categoria", { categoria }),
  eliminarCategoria: (id: number) => invoke<void>("eliminar_categoria", { id }),

  // Laboratorios
  listarLaboratorios: () => invoke<Laboratorio[]>("listar_laboratorios"),
  guardarLaboratorio: (laboratorio: Laboratorio) => invoke<number>("guardar_laboratorio", { laboratorio }),
  eliminarLaboratorio: (id: number) => invoke<void>("eliminar_laboratorio", { id }),

  // Proveedores
  listarProveedores: () => invoke<Proveedor[]>("listar_proveedores"),
  guardarProveedor: (proveedor: Proveedor) => invoke<number>("guardar_proveedor", { proveedor }),
  eliminarProveedor: (id: number) => invoke<void>("eliminar_proveedor", { id }),
  crearProveedorRapido: (datos: ProveedorRapido) => invoke<number>("crear_proveedor_rapido", { datos }),

  // Productos
  listarProductos: (solo_activos = true) => invoke<Producto[]>("listar_productos", { soloActivos: solo_activos }),
  guardarProducto: (producto: Producto) => invoke<number>("guardar_producto", { producto }),
  eliminarProducto: (id: number) => invoke<void>("eliminar_producto", { id }),
  productosStockBajo: () => invoke<AlertaStock[]>("productos_stock_bajo"),
  productosPorVencer: (dias: number) => invoke<AlertaVencimiento[]>("productos_por_vencer", { dias }),
  exportarPlantillaCodigos: () => invoke<string>("exportar_plantilla_codigos"),
  // Abre el diálogo nativo para elegir el .xlsx a importar; devuelve null si el usuario cancela.
  elegirArchivoCodigos: async () => {
    const ruta = await openDialog({
      multiple: false,
      filters: [{ name: "Excel", extensions: ["xlsx"] }],
    });
    return typeof ruta === "string" ? ruta : null;
  },
  importarCodigosBarras: (ruta: string) => invoke<ResumenImportacionCodigos>("importar_codigos_barras", { ruta }),

  // Usuarios y roles
  listarRoles: () => invoke<Rol[]>("listar_roles"),
  listarUsuarios: () => invoke<Usuario[]>("listar_usuarios"),
  guardarUsuario: (usuario: Usuario) => invoke<number>("guardar_usuario", { usuario }),
  eliminarUsuario: (id: number) => invoke<void>("eliminar_usuario", { id }),

  // Inventario: lotes, kardex, inventario físico
  listarLotesActivos: () => invoke<Lote[]>("listar_lotes_activos"),
  registrarEntradaManual: (payload: {
    id_producto: number;
    cantidad: number;
    codigo_lote: string;
    fecha_vencimiento: string;
    motivo: string;
  }) =>
    invoke<void>("registrar_entrada_manual", {
      idProducto: payload.id_producto,
      cantidad: payload.cantidad,
      codigoLote: payload.codigo_lote,
      fechaVencimiento: payload.fecha_vencimiento,
      motivo: payload.motivo,
    }),
  listarKardex: (id_producto: number | null) => invoke<MovimientoKardex[]>("listar_kardex", { idProducto: id_producto }),
  listarAuditorias: () => invoke<Auditoria[]>("listar_auditorias"),
  iniciarAuditoria: (tipo: string, observaciones: string) => invoke<number>("iniciar_auditoria", { tipo, observaciones }),
  detallesAuditoria: (id_auditoria: number) => invoke<DetalleAuditoria[]>("detalles_auditoria", { idAuditoria: id_auditoria }),
  guardarConteoParcial: (id_auditoria: number, id_lote: number, stock_fisico: number) =>
    invoke<void>("guardar_conteo_parcial", { idAuditoria: id_auditoria, idLote: id_lote, stockFisico: stock_fisico }),
  finalizarAuditoria: (id_auditoria: number) => invoke<void>("finalizar_auditoria", { idAuditoria: id_auditoria }),
  cancelarAuditoria: (id_auditoria: number) => invoke<void>("cancelar_auditoria", { idAuditoria: id_auditoria }),
  iniciarAuditoriaAleatoria: (cantidad: number, observaciones: string) =>
    invoke<number>("iniciar_auditoria_aleatoria", { cantidad, observaciones }),
  agregarLoteEncontrado: (input: AgregarEncontradoInput) =>
    invoke<AgregarEncontradoResultado>("agregar_lote_encontrado", { input }),
  exportarDetalleAuditoria: (id_auditoria: number) => invoke<string>("exportar_detalle_auditoria", { idAuditoria: id_auditoria }),
  exportarConteoAuditoria: (id_auditoria: number) => invoke<string>("exportar_conteo_auditoria", { idAuditoria: id_auditoria }),

  // Compras
  listarCompras: () => invoke<CompraResumen[]>("listar_compras"),
  detallesCompra: (id_compra: number) => invoke<DetalleCompra[]>("detalles_compra", { idCompra: id_compra }),
  crearCompra: (cabecera: CabeceraCompra, detalles: DetalleCompraInput[]) =>
    invoke<number>("crear_compra", { cabecera, detalles }),
  procesarRecepcion: (id_compra: number, lotes: LoteRecepcion[]) =>
    invoke<void>("procesar_recepcion", { idCompra: id_compra, lotes }),
  registrarDevolucion: (cabecera: CabeceraDevolucion, detalles: DetalleDevolucionInput[]) =>
    invoke<void>("registrar_devolucion", { cabecera, detalles }),

  // Clientes
  listarClientes: () => invoke<Cliente[]>("listar_clientes"),
  guardarCliente: (cliente: Cliente) => invoke<number>("guardar_cliente", { cliente }),
  eliminarCliente: (id: number) => invoke<void>("eliminar_cliente", { id }),
  crearClienteRapido: (datos: ClienteRapido) => invoke<number>("crear_cliente_rapido", { datos }),

  // Configuración
  obtenerConfiguracion: () => invoke<Record<string, string>>("obtener_configuracion"),
  guardarConfiguracion: (valores: Record<string, string>) => invoke<void>("guardar_configuracion", { valores }),
  // Abre el diálogo nativo para elegir una imagen de logo; devuelve null si el usuario cancela.
  elegirArchivoLogo: async () => {
    const ruta = await openDialog({
      multiple: false,
      filters: [{ name: "Imagen", extensions: ["png", "jpg", "jpeg", "gif"] }],
    });
    return typeof ruta === "string" ? ruta : null;
  },
  subirLogo: (ruta_origen: string) => invoke<string>("subir_logo", { rutaOrigen: ruta_origen }),
  quitarLogo: () => invoke<void>("quitar_logo"),

  // Auditoría
  listarAccesos: (limite = 100) => invoke<AuditAcceso[]>("listar_accesos", { limite }),
  listarAcciones: (limite = 200) => invoke<AuditAccion[]>("listar_acciones", { limite }),

  // Backups
  listarBackups: () => invoke<BackupInfo[]>("listar_backups"),
  generarBackup: () => invoke<string>("generar_backup"),
  carpetaBackupsRuta: () => invoke<string>("carpeta_backups_ruta"),
  restaurarBackup: (nombre: string, confirmacion: string) => invoke<void>("restaurar_backup", { nombre, confirmacion }),
  vaciarSistema: (confirmacion: string) => invoke<void>("vaciar_sistema", { confirmacion }),

  // Reportes
  guardarArchivoExportado: (nombre_archivo: string, contenido: string) =>
    invoke<string>("guardar_archivo_exportado", { nombreArchivo: nombre_archivo, contenido }),

  // Caja
  cajaAbierta: () => invoke<Caja | null>("caja_abierta"),
  abrirCaja: (monto_inicial: number) => invoke<number>("abrir_caja", { montoInicial: monto_inicial }),
  resumenCaja: (id_caja: number) => invoke<ResumenCaja>("resumen_caja", { idCaja: id_caja }),
  cerrarCaja: (id_caja: number, monto_final_real: number, observacion: string | null) =>
    invoke<void>("cerrar_caja", { idCaja: id_caja, montoFinalReal: monto_final_real, observacion }),
  historialCajas: (fecha_inicio: string, fecha_fin: string) =>
    invoke<Caja[]>("historial_cajas", { fechaInicio: fecha_inicio, fechaFin: fecha_fin }),
  movimientosCaja: (id_caja: number) => invoke<MovimientoCaja[]>("movimientos_caja", { idCaja: id_caja }),
  registrarMovimientoCaja: (id_caja: number, tipo: string, monto: number, motivo: string) =>
    invoke<void>("registrar_movimiento_caja", { idCaja: id_caja, tipo, monto, motivo }),

  // Ventas (POS)
  listarVentas: () => invoke<VentaResumen[]>("listar_ventas"),
  detallesVenta: (id_venta: number) => invoke<DetalleVenta[]>("detalles_venta", { idVenta: id_venta }),
  registrarVenta: (cabecera: CabeceraVenta, detalles: DetalleVentaInput[]) =>
    invoke<number>("registrar_venta", { cabecera, detalles }),
  anularVenta: (id_venta: number) => invoke<void>("anular_venta", { idVenta: id_venta }),
};
