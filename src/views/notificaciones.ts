import { api } from "../api";
import { pageContent, pageHeader } from "./layout";
import { escapeHtml } from "../ui";

/** Replica NotificacionController::index ("Centro de Alertas Sanitarias"): lotes por vencer
 * en los próximos 90 días + productos con stock bajo, en una página dedicada (además de
 * seguir disponibles como tarjetas resumidas en el Dashboard). */
export async function renderNotificaciones() {
  const content = pageContent();
  content.innerHTML = pageHeader("Alertas Sanitarias", "Lotes próximos a vencer y productos con stock bajo") + `<div id="notif-body">Cargando…</div>`;

  const [stockBajo, porVencer] = await Promise.all([api.productosStockBajo(), api.productosPorVencer(90)]);
  const body = document.querySelector("#notif-body") as HTMLElement;

  body.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:28px;">
      <div>
        <h3 style="font-size:16px;margin-bottom:12px;"><i class="bi bi-hourglass-split" style="color:var(--warning);"></i> Lotes próximos a vencer (90 días)</h3>
        ${
          porVencer.length === 0
            ? '<div class="empty-state">No hay lotes por vencer en los próximos 90 días.</div>'
            : `<table class="table-custom">
                <thead><tr><th>Producto</th><th>Lote</th><th>Vence</th><th>Stock disponible</th><th>Días restantes</th></tr></thead>
                <tbody>
                  ${porVencer
                    .map((v) => {
                      const pill = v.dias_restantes < 0 ? "pill-off" : v.dias_restantes <= 30 ? "pill-off" : "pill-ok";
                      return `<tr>
                        <td>${escapeHtml(v.producto)}</td>
                        <td>${escapeHtml(v.codigo_lote)}</td>
                        <td>${v.fecha_vencimiento}</td>
                        <td>${v.cantidad_disponible}</td>
                        <td><span class="pill ${pill}">${v.dias_restantes < 0 ? "VENCIDO" : `${v.dias_restantes}d`}</span></td>
                      </tr>`;
                    })
                    .join("")}
                </tbody>
              </table>`
        }
      </div>
      <div>
        <h3 style="font-size:16px;margin-bottom:12px;"><i class="bi bi-exclamation-triangle" style="color:var(--danger);"></i> Productos con stock bajo</h3>
        ${
          stockBajo.length === 0
            ? '<div class="empty-state">No hay productos con stock bajo.</div>'
            : `<table class="table-custom">
                <thead><tr><th>Producto</th><th>Stock actual</th><th>Stock mínimo</th></tr></thead>
                <tbody>
                  ${stockBajo
                    .map((p) => `<tr><td>${escapeHtml(p.nombre_comercial)}</td><td>${p.stock_actual}</td><td>${p.stock_minimo}</td></tr>`)
                    .join("")}
                </tbody>
              </table>`
        }
      </div>
    </div>
  `;
}
