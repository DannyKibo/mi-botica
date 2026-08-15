import type { SessionUser } from "../types";
import { api } from "../api";
import { escapeHtml } from "../ui";

export interface NavItem {
  key: string;
  label: string;
  icon: string;
  ready: boolean;
  /** Solo Administrador, Químico Farmacéutico o Propietario (rol_id 1/2/3). */
  soloElevado?: boolean;
  /** Exclusivo del rol Administrador (rol_id 1). */
  soloAdmin?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { key: "dashboard", label: "Dashboard", icon: "bi-speedometer2", ready: true, soloElevado: true },
  { key: "productos", label: "Productos", icon: "bi-capsule", ready: true },
  { key: "categorias", label: "Categorías", icon: "bi-tags", ready: true, soloElevado: true },
  { key: "laboratorios", label: "Laboratorios", icon: "bi-building", ready: true, soloElevado: true },
  { key: "proveedores", label: "Proveedores", icon: "bi-truck", ready: true, soloElevado: true },
  { key: "inventario", label: "Inventario", icon: "bi-box-seam", ready: true, soloElevado: true },
  { key: "compras", label: "Compras", icon: "bi-cart-check", ready: true },
  { key: "ventas", label: "Ventas (POS)", icon: "bi-cash-coin", ready: true },
  { key: "clientes", label: "Clientes", icon: "bi-people", ready: true, soloElevado: true },
  { key: "notificaciones", label: "Alertas Sanitarias", icon: "bi-bell", ready: true, soloElevado: true },
  { key: "reportes", label: "Reportes", icon: "bi-bar-chart", ready: true, soloElevado: true },
  { key: "observatorio", label: "Observatorio de Precios", icon: "bi-globe-americas", ready: false, soloElevado: true },
  { key: "auditoria", label: "Auditoría", icon: "bi-clipboard-data", ready: true, soloAdmin: true },
  { key: "usuarios", label: "Usuarios", icon: "bi-person-gear", ready: true, soloElevado: true },
  { key: "backups", label: "Copias de Seguridad", icon: "bi-hdd-network", ready: true, soloElevado: true },
  { key: "configuracion", label: "Configuración", icon: "bi-gear", ready: true, soloElevado: true },
];

/** Replica el criterio $_esElevado (rol_id in [1,2,3]) del sidebar PHP original. */
export function esElevado(user: SessionUser): boolean {
  return [1, 2, 3].includes(user.rol_id);
}

/** Ídem a $_esElevado, pero para lo que además exige rol_id == 1 (ej. Logs de Auditoría). */
export function esAdmin(user: SessionUser): boolean {
  return user.rol_id === 1;
}

/** Un ítem del menú es visible/navegable para este usuario según su rol. */
export function puedeVer(item: NavItem, user: SessionUser): boolean {
  if (item.soloAdmin && !esAdmin(user)) return false;
  if (item.soloElevado && !esElevado(user)) return false;
  return true;
}

/** Landing por defecto tras iniciar sesión: el Técnico en Farmacia no tiene Dashboard, así
 * que aterriza directo en el Punto de Venta — igual que DashboardController::index del
 * sistema original, que redirige a venta/pos para rol_id == 4. */
export function moduloPorDefecto(user: SessionUser): string {
  return esElevado(user) ? "dashboard" : "ventas";
}

export function renderLayout(
  app: HTMLElement,
  user: SessionUser,
  activeKey: string,
  onNavigate: (key: string) => void,
  onLogout: () => void
) {
  const itemsVisibles = NAV_ITEMS.filter((item) => puedeVer(item, user));

  app.innerHTML = `
    <div id="wrapper">
      <aside id="sidebar">
        <a class="sidebar-logo" href="#" id="sidebar-logo-link"><i class="bi bi-capsule"></i>Mi Botica</a>
        <ul class="sidebar-nav" id="nav-list">
          ${itemsVisibles
            .map(
              (item) => `
            <li class="nav-item">
              <a href="#" class="nav-link ${item.key === activeKey ? "active" : ""}" data-key="${item.key}">
                <i class="bi ${item.icon}"></i>
                <span>${item.label}</span>
                ${item.ready ? "" : '<span class="badge-sidebar">Próx.</span>'}
              </a>
            </li>`
            )
            .join("")}
        </ul>
      </aside>
      <div id="content-wrapper">
        <header id="topbar">
          <div class="search-box">
            <i class="bi bi-search"></i>
            <input placeholder="Buscar..." disabled />
          </div>
          <div class="topbar-actions">
            <a href="#" class="topbar-icon" id="bell-btn" title="Alertas Sanitarias" style="position:relative;text-decoration:none;">
              <i class="bi bi-bell-fill"></i>
              <span id="bell-badge" class="badge-sidebar" style="display:none;position:absolute;top:-4px;right:-6px;background:var(--danger);"></span>
            </a>
            <div class="user-profile" id="user-menu">
              <div class="user-info">
                <span class="user-name">${user.nombre_completo}</span>
                <span class="user-role">${user.rol_nombre}</span>
              </div>
              <i class="bi bi-box-arrow-right topbar-icon" id="logout-btn" title="Cerrar sesión"></i>
            </div>
          </div>
        </header>
        <main class="page-content" id="page-content"></main>
      </div>
    </div>
  `;

  app.querySelectorAll<HTMLAnchorElement>("[data-key]").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      onNavigate(a.dataset.key!);
    });
  });

  // La campanita de alertas es visible y funcional para TODOS los roles (igual que en el
  // topbar del sistema original), aunque el ítem "Alertas Sanitarias" del sidebar esté
  // oculto para el Técnico en Farmacia.
  app.querySelector("#bell-btn")!.addEventListener("click", (e) => {
    e.preventDefault();
    onNavigate("notificaciones");
  });

  app.querySelector("#logout-btn")!.addEventListener("click", async () => {
    await api.logout();
    onLogout();
  });

  refrescarBadgeAlertas();
  cargarLogoSidebar();
}

/** Consulta stock bajo + próximos a vencer y actualiza el contador de la campanita — se
 * ejecuta en segundo plano tras el render inicial para no bloquear la navegación. */
async function refrescarBadgeAlertas() {
  try {
    const [stockBajo, porVencer] = await Promise.all([api.productosStockBajo(), api.productosPorVencer(90)]);
    const total = stockBajo.length + porVencer.length;
    const badge = document.querySelector("#bell-badge") as HTMLElement | null;
    if (!badge) return;
    if (total > 0) {
      badge.textContent = String(total);
      badge.style.display = "inline-block";
    } else {
      badge.style.display = "none";
    }
  } catch {
    // silencioso: si falla, simplemente no se muestra el contador
  }
}

/** Si hay un logo propio configurado, lo muestra en vez del ícono de cápsula por defecto. */
async function cargarLogoSidebar() {
  try {
    const config = await api.obtenerConfiguracion();
    const logoEl = document.querySelector("#sidebar-logo-link") as HTMLElement | null;
    if (!logoEl || !config.logo) return;
    logoEl.innerHTML = `<img src="${escapeHtml(config.logo)}" alt="Logo Botica" style="max-height:36px;max-width:100%;object-fit:contain;" />`;
  } catch {
    // silencioso: si falla, se queda con el ícono por defecto
  }
}

export function pageContent(): HTMLElement {
  return document.querySelector("#page-content") as HTMLElement;
}

export function pageHeader(title: string, subtitle: string): string {
  return `
    <div class="page-header">
      <h1 class="page-title">${title}</h1>
      <div class="page-subtitle">${subtitle}</div>
    </div>
  `;
}
