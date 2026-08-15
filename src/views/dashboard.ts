import { api } from "../api";
import { pageContent, pageHeader } from "./layout";
import { escapeHtml } from "../ui";

export async function renderDashboard() {
  const content = pageContent();
  content.innerHTML = pageHeader("Dashboard", "Resumen general de la botica") + `<div id="dash-body">Cargando…</div>`;

  const [productos, stockBajo, porVencer] = await Promise.all([
    api.listarProductos(true),
    api.productosStockBajo(),
    api.productosPorVencer(60),
  ]);

  const body = document.querySelector("#dash-body") as HTMLElement;
  body.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-bottom:30px;">
      <div class="card-metric">
        <div class="metric-header">
          <span class="metric-title">Productos activos</span>
          <div class="metric-icon"><i class="bi bi-capsule"></i></div>
        </div>
        <div class="metric-value">${productos.length}</div>
      </div>
      <div class="card-metric">
        <div class="metric-header">
          <span class="metric-title">Stock bajo</span>
          <div class="metric-icon" style="background:var(--danger-bg);color:var(--danger);"><i class="bi bi-exclamation-triangle"></i></div>
        </div>
        <div class="metric-value">${stockBajo.length}</div>
      </div>
      <div class="card-metric">
        <div class="metric-header">
          <span class="metric-title">Por vencer (60 días)</span>
          <div class="metric-icon" style="background:rgba(244,162,97,0.15);color:var(--warning);"><i class="bi bi-hourglass-split"></i></div>
        </div>
        <div class="metric-value">${porVencer.length}</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
      <div>
        <h3 style="font-size:16px;margin-bottom:12px;">Alertas de stock mínimo</h3>
        ${
          stockBajo.length === 0
            ? '<div class="empty-state">No hay productos con stock bajo.</div>'
            : `<table class="table-custom"><thead><tr><th>Producto</th><th>Actual</th><th>Mínimo</th></tr></thead><tbody>
              ${stockBajo
                .map(
                  (p) =>
                    `<tr><td>${escapeHtml(p.nombre_comercial)}</td><td>${p.stock_actual}</td><td>${p.stock_minimo}</td></tr>`
                )
                .join("")}
              </tbody></table>`
        }
      </div>
      <div>
        <h3 style="font-size:16px;margin-bottom:12px;">Próximos a vencer</h3>
        ${
          porVencer.length === 0
            ? '<div class="empty-state">No hay lotes por vencer en los próximos 60 días.</div>'
            : `<table class="table-custom"><thead><tr><th>Producto</th><th>Lote</th><th>Vence</th><th>Días</th></tr></thead><tbody>
              ${porVencer
                .map(
                  (v) =>
                    `<tr><td>${escapeHtml(v.producto)}</td><td>${escapeHtml(v.codigo_lote)}</td><td>${v.fecha_vencimiento}</td><td>${v.dias_restantes}</td></tr>`
                )
                .join("")}
              </tbody></table>`
        }
      </div>
    </div>
  `;
}
