import { api } from "../api";
import { pageContent, pageHeader } from "./layout";
import { escapeHtml } from "../ui";

type Tab = "accesos" | "acciones";
let activeTab: Tab = "accesos";

export async function renderAuditoria() {
  const content = pageContent();
  content.innerHTML =
    pageHeader("Auditoría", "Registro de accesos e historial de acciones de todos los usuarios") +
    `
    <div style="display:flex;gap:8px;margin-bottom:22px;">
      <button class="tab-btn" data-tab="accesos">Accesos (login/logout)</button>
      <button class="tab-btn" data-tab="acciones">Historial de acciones</button>
    </div>
    <div id="tab-body">Cargando…</div>
  `;

  if (!document.querySelector("#tab-btn-style")) {
    const style = document.createElement("style");
    style.id = "tab-btn-style";
    style.textContent = `
      .tab-btn { border: none; background: var(--bg-card); color: var(--text-secondary); padding: 10px 18px; border-radius: 10px; font-weight: 600; cursor: pointer; font-size: 14px; box-shadow: 0 2px 8px rgba(0,0,0,0.03); }
      .tab-btn.active { background: var(--accent-primary); color: #fff; }
    `;
    document.head.appendChild(style);
  }

  const buttons = content.querySelectorAll<HTMLButtonElement>(".tab-btn");
  const paint = () => buttons.forEach((b) => b.classList.toggle("active", b.dataset.tab === activeTab));
  buttons.forEach((b) =>
    b.addEventListener("click", () => {
      activeTab = b.dataset.tab as Tab;
      paint();
      renderTabBody();
    })
  );
  paint();
  renderTabBody();
}

async function renderTabBody() {
  if (activeTab === "accesos") return renderAccesos();
  return renderAcciones();
}

async function renderAccesos() {
  const body = document.querySelector("#tab-body") as HTMLElement;
  body.innerHTML = `<div id="accesos-wrap">Cargando…</div>`;
  const items = await api.listarAccesos(150);
  const wrap = document.querySelector("#accesos-wrap") as HTMLElement;
  if (items.length === 0) {
    wrap.innerHTML = '<div class="empty-state">Aún no hay registros de acceso.</div>';
    return;
  }
  wrap.innerHTML = `
    <table class="table-custom">
      <thead><tr><th>Fecha</th><th>Usuario</th><th>Nombre</th><th>Acción</th></tr></thead>
      <tbody>
        ${items
          .map(
            (a) => `
          <tr>
            <td>${a.fecha}</td>
            <td>${escapeHtml(a.usuario)}</td>
            <td>${escapeHtml(a.nombres)}</td>
            <td><span class="pill ${a.accion === "LOGIN" ? "pill-ok" : "pill-off"}">${escapeHtml(a.accion)}</span></td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>
  `;
}

async function renderAcciones() {
  const body = document.querySelector("#tab-body") as HTMLElement;
  body.innerHTML = `<div id="acciones-wrap">Cargando…</div>`;
  const items = await api.listarAcciones(300);
  const wrap = document.querySelector("#acciones-wrap") as HTMLElement;
  if (items.length === 0) {
    wrap.innerHTML = '<div class="empty-state">Aún no hay acciones registradas.</div>';
    return;
  }
  wrap.innerHTML = `
    <table class="table-custom">
      <thead><tr><th>Fecha</th><th>Usuario</th><th>Módulo</th><th>Acción</th><th>Descripción</th></tr></thead>
      <tbody>
        ${items
          .map(
            (a) => `
          <tr>
            <td>${a.fecha}</td>
            <td>${escapeHtml(a.usuario)}</td>
            <td>${escapeHtml(a.modulo)}</td>
            <td><span class="pill">${escapeHtml(a.accion)}</span></td>
            <td>${escapeHtml(a.descripcion)}</td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>
  `;
}
