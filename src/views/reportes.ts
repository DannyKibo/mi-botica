import { api } from "../api";
import { pageContent, pageHeader } from "./layout";
import { toast } from "../ui";

function csvEscape(v: string | number): string {
  const s = String(v ?? "");
  if (s.includes(";") || s.includes('"') || s.includes("\n")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function renderReportes() {
  const content = pageContent();
  content.innerHTML =
    pageHeader("Reportes", "Exporta reportes gerenciales a CSV (compatible con Excel)") +
    `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
      <div class="card-metric" style="text-align:left;">
        <h3 style="margin-top:0;font-size:16px;"><i class="bi bi-receipt"></i> Reporte de ventas</h3>
        <p style="color:var(--text-secondary);font-size:14px;">Exporta el detalle de ventas realizadas en un rango de fechas.</p>
        <form id="form-ventas">
          <div class="grid-2">
            <div class="form-group"><label class="form-label">Desde</label><input class="form-control-custom" id="f-desde" type="date" value="${hoyISO()}" required /></div>
            <div class="form-group"><label class="form-label">Hasta</label><input class="form-control-custom" id="f-hasta" type="date" value="${hoyISO()}" required /></div>
          </div>
          <button class="btn-primary-custom" type="submit"><i class="bi bi-file-earmark-spreadsheet"></i> Exportar CSV</button>
        </form>
      </div>
      <div class="card-metric" style="text-align:left;">
        <h3 style="margin-top:0;font-size:16px;"><i class="bi bi-hourglass-split"></i> Reporte de vencimientos</h3>
        <p style="color:var(--text-secondary);font-size:14px;">Exporta los lotes próximos a vencer en los siguientes 90 días.</p>
        <button class="btn-primary-custom" id="btn-vencimientos" type="button"><i class="bi bi-file-earmark-spreadsheet"></i> Exportar CSV</button>
      </div>
    </div>
    <div id="reporte-resultado" style="margin-top:20px;"></div>
  `;

  const mostrarResultado = (ruta: string) => {
    const wrap = document.querySelector("#reporte-resultado") as HTMLElement;
    wrap.innerHTML = `<div class="empty-state" style="text-align:left;"><i class="bi bi-check-circle" style="color:var(--accent-primary);"></i> Archivo guardado en: <code>${ruta}</code></div>`;
  };

  content.querySelector("#form-ventas")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    const desde = (content.querySelector("#f-desde") as HTMLInputElement).value;
    const hasta = (content.querySelector("#f-hasta") as HTMLInputElement).value;
    try {
      const ventas = await api.listarVentas();
      const tsInicio = new Date(desde + "T00:00:00").getTime();
      const tsFin = new Date(hasta + "T23:59:59").getTime();
      const filtradas = ventas.filter((v) => {
        const ts = new Date(v.fecha_venta.replace(" ", "T")).getTime();
        return ts >= tsInicio && ts <= tsFin;
      });
      const filas = [
        ["ID Venta", "Fecha", "Cajero", "Cliente", "Doc", "Numero", "Total", "Forma Pago", "Estado"],
        ...filtradas.map((v) => [
          v.id,
          v.fecha_venta,
          v.cajero,
          v.cliente,
          v.tipo_comprobante,
          v.num_comprobante,
          v.total.toFixed(2),
          v.metodo_pago,
          v.estado,
        ]),
      ];
      const csv = filas.map((f) => f.map(csvEscape).join(";")).join("\r\n");
      const ruta = await api.guardarArchivoExportado(`Reporte_Ventas_${desde}_al_${hasta}.csv`, csv);
      toast(`Reporte exportado: ${filtradas.length} venta(s)`);
      mostrarResultado(ruta);
    } catch (err) {
      toast(String(err), "error");
    }
  });

  content.querySelector("#btn-vencimientos")!.addEventListener("click", async () => {
    try {
      const lotes = await api.productosPorVencer(90);
      const filas = [
        ["Producto", "Lote", "Fecha Vencimiento", "Stock disponible", "Dias Restantes"],
        ...lotes.map((l) => [l.producto, l.codigo_lote, l.fecha_vencimiento, l.cantidad_disponible, l.dias_restantes < 0 ? "VENCIDO" : l.dias_restantes]),
      ];
      const csv = filas.map((f) => f.map(csvEscape).join(";")).join("\r\n");
      const ruta = await api.guardarArchivoExportado("Reporte_Lotes_Vencer.csv", csv);
      toast(`Reporte exportado: ${lotes.length} lote(s)`);
      mostrarResultado(ruta);
    } catch (err) {
      toast(String(err), "error");
    }
  });
}
