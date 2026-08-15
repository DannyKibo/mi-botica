import { api } from "./api";
import type { SessionUser } from "./types";
import { renderLogin } from "./views/login";
import { renderCambiarPasswordObligatorio } from "./views/cambiarPassword";
import { renderLayout, NAV_ITEMS, moduloPorDefecto, puedeVer } from "./views/layout";
import { renderDashboard } from "./views/dashboard";
import { renderProductos } from "./views/productos";
import { renderCategorias, renderLaboratorios, renderProveedores } from "./views/catalogoSimple";
import { renderUsuarios } from "./views/usuarios";
import { renderInventario } from "./views/inventario";
import { renderCompras } from "./views/compras";
import { renderVentas } from "./views/ventas";
import { renderClientes } from "./views/clientes";
import { renderLocked } from "./views/locked";
import { renderAuditoria } from "./views/auditoria";
import { renderReportes } from "./views/reportes";
import { renderConfiguracion } from "./views/configuracion";
import { renderBackups } from "./views/backups";
import { renderNotificaciones } from "./views/notificaciones";

const app = document.querySelector<HTMLDivElement>("#app")!;

let currentUser: SessionUser | null = null;
let activeKey = "dashboard";

async function renderModule(key: string) {
  activeKey = key;
  const item = NAV_ITEMS.find((n) => n.key === key);
  if (!item || !item.ready) {
    renderLocked(item?.label ?? "Módulo");
    return;
  }
  // Defensa en profundidad: aunque el ítem esté oculto del sidebar para este rol, si de
  // algún modo se intenta navegar ahí igual (ej. quedó como activeKey de una sesión previa),
  // no se renderiza — mismo criterio que el bloqueo en los controladores PHP originales.
  if (currentUser && !puedeVer(item, currentUser)) {
    return renderModule(moduloPorDefecto(currentUser));
  }
  switch (key) {
    case "dashboard":
      return renderDashboard();
    case "productos":
      return renderProductos();
    case "categorias":
      return renderCategorias();
    case "laboratorios":
      return renderLaboratorios();
    case "proveedores":
      return renderProveedores();
    case "usuarios":
      return renderUsuarios();
    case "inventario":
      return renderInventario();
    case "compras":
      return renderCompras();
    case "ventas":
      return renderVentas();
    case "clientes":
      return renderClientes();
    case "auditoria":
      return renderAuditoria();
    case "reportes":
      return renderReportes();
    case "configuracion":
      return renderConfiguracion();
    case "backups":
      return renderBackups();
    case "notificaciones":
      return renderNotificaciones();
    default:
      return renderLocked(item.label);
  }
}

function navigate(key: string) {
  activeKey = key;
  renderLayout(app, currentUser!, activeKey, navigate, doLogout);
  renderModule(activeKey);
}

function showApp() {
  if (!currentUser) return;
  navigate(activeKey);
}

async function doLogout() {
  currentUser = null;
  activeKey = "dashboard";
  boot();
}

async function goApp() {
  const user = await api.currentUser();
  currentUser = user;
  if (!user) {
    boot();
    return;
  }
  // El Técnico en Farmacia no tiene Dashboard gerencial: aterriza directo en el POS, igual
  // que el sistema original (DashboardController redirige a venta/pos para su rol).
  activeKey = moduloPorDefecto(user);
  if (user.debe_cambiar_password) {
    renderCambiarPasswordObligatorio(app, async () => {
      currentUser = await api.currentUser();
      showApp();
    });
    return;
  }
  showApp();
}

function boot() {
  renderLogin(app, goApp);
}

// Al arrancar: si ya hay una sesión activa en memoria (no debería en un arranque
// en frío, pero cubre recargas del webview), saltamos directo a la app.
(async () => {
  const existing = await api.currentUser();
  if (existing) {
    currentUser = existing;
    goApp();
  } else {
    boot();
  }
})();
