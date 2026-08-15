import { api } from "../api";
import { pageContent, pageHeader } from "./layout";
import { escapeHtml, toast } from "../ui";

export async function renderConfiguracion() {
  const content = pageContent();
  content.innerHTML = pageHeader("Configuración", "Datos de la botica, moneda/IGV y fidelización de clientes") + `<div id="config-wrap">Cargando…</div>`;

  const [config, user] = await Promise.all([api.obtenerConfiguracion(), api.currentUser()]);
  const esAdmin = user?.rol_id === 1;
  const wrap = document.querySelector("#config-wrap") as HTMLElement;

  wrap.innerHTML = `
    <div style="max-width:680px;margin-bottom:24px;">
      <h3 style="font-size:16px;">Logo de la botica</h3>
      <div style="display:flex;align-items:center;gap:16px;">
        <div id="logo-preview" style="width:90px;height:90px;border:1px solid var(--border-color);border-radius:12px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:var(--bg-card);">
          ${config.logo ? `<img src="${escapeHtml(config.logo)}" alt="Logo actual" style="max-width:100%;max-height:100%;object-fit:contain;" />` : '<i class="bi bi-image" style="font-size:28px;color:var(--text-secondary);"></i>'}
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <button type="button" class="btn-sm-icon" id="btn-cambiar-logo"><i class="bi bi-upload"></i> ${config.logo ? "Cambiar logo" : "Subir logo"}</button>
          ${config.logo ? '<button type="button" class="btn-sm-icon danger" id="btn-quitar-logo"><i class="bi bi-trash"></i> Quitar logo</button>' : ""}
        </div>
      </div>
    </div>

    <form id="form-config" style="max-width:680px;">
      <h3 style="font-size:16px;">Datos de la empresa</h3>
      <div class="form-group"><label class="form-label">Nombre de la botica</label><input class="form-control-custom" id="f-nombre" value="${escapeHtml(config.nombre_botica)}" required /></div>
      <div class="grid-2">
        <div class="form-group"><label class="form-label">RUC</label><input class="form-control-custom" id="f-ruc" value="${escapeHtml(config.ruc)}" /></div>
        <div class="form-group"><label class="form-label">Teléfono</label><input class="form-control-custom" id="f-telefono" value="${escapeHtml(config.telefono)}" /></div>
      </div>
      <div class="form-group"><label class="form-label">Dirección</label><input class="form-control-custom" id="f-direccion" value="${escapeHtml(config.direccion)}" /></div>

      <h3 style="font-size:16px;margin-top:24px;">Moneda e impuestos</h3>
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Símbolo de moneda</label><input class="form-control-custom" id="f-moneda" value="${escapeHtml(config.moneda)}" required /></div>
        <div class="form-group"><label class="form-label">IGV (%)</label><input class="form-control-custom" id="f-igv" type="number" step="0.01" min="0" value="${escapeHtml(config.igv)}" required /></div>
      </div>

      ${
        esAdmin
          ? `
      <h3 style="font-size:16px;margin-top:24px;">Puntos de fidelización <span style="font-weight:400;color:var(--text-secondary);font-size:13px;">(exclusivo del Administrador)</span></h3>
      <div class="form-group">
        <label style="display:flex;align-items:center;gap:8px;font-weight:600;">
          <input type="checkbox" id="f-puntos-hab" ${config.puntos_habilitado === "1" ? "checked" : ""} />
          Habilitar acumulación de puntos por venta
        </label>
      </div>
      <div class="form-group" style="max-width:220px;">
        <label class="form-label">Puntos por cada S/ 1.00 vendido</label>
        <input class="form-control-custom" id="f-puntos-sol" type="number" step="0.01" min="0" value="${escapeHtml(config.puntos_por_sol) || "1.00"}" />
      </div>`
          : ""
      }

      <button class="btn-primary-custom" type="submit" style="margin-top:12px;"><i class="bi bi-check-lg"></i> Guardar cambios</button>
    </form>
  `;

  wrap.querySelector("#btn-cambiar-logo")!.addEventListener("click", async () => {
    try {
      const ruta = await api.elegirArchivoLogo();
      if (!ruta) return;
      await api.subirLogo(ruta);
      toast("Logo actualizado correctamente");
      renderConfiguracion();
    } catch (err) {
      toast(String(err), "error");
    }
  });

  const btnQuitarLogo = wrap.querySelector("#btn-quitar-logo");
  if (btnQuitarLogo) {
    btnQuitarLogo.addEventListener("click", async () => {
      if (!confirm("¿Quitar el logo actual?")) return;
      try {
        await api.quitarLogo();
        toast("Logo eliminado");
        renderConfiguracion();
      } catch (err) {
        toast(String(err), "error");
      }
    });
  }

  wrap.querySelector("#form-config")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    const valores: Record<string, string> = {
      nombre_botica: (wrap.querySelector("#f-nombre") as HTMLInputElement).value.trim(),
      ruc: (wrap.querySelector("#f-ruc") as HTMLInputElement).value.trim(),
      telefono: (wrap.querySelector("#f-telefono") as HTMLInputElement).value.trim(),
      direccion: (wrap.querySelector("#f-direccion") as HTMLInputElement).value.trim(),
      moneda: (wrap.querySelector("#f-moneda") as HTMLInputElement).value.trim(),
      igv: (wrap.querySelector("#f-igv") as HTMLInputElement).value.trim(),
    };
    // Los parámetros de puntos solo se envían (y por tanto solo se pueden cambiar) si quien
    // guarda es Administrador — igual que ConfiguracionController::save en el sistema original.
    if (esAdmin) {
      const habilitado = (wrap.querySelector("#f-puntos-hab") as HTMLInputElement).checked;
      valores.puntos_habilitado = habilitado ? "1" : "0";
      valores.puntos_por_sol = (wrap.querySelector("#f-puntos-sol") as HTMLInputElement).value.trim() || "1.00";
    }
    try {
      await api.guardarConfiguracion(valores);
      toast("Parámetros actualizados correctamente");
    } catch (err) {
      toast(String(err), "error");
    }
  });
}
