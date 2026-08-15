import { api } from "../api";
import { pageContent, pageHeader } from "./layout";
import { closeModal, escapeHtml, openModal, toast } from "../ui";
import type { Cliente } from "../types";

export async function renderClientes() {
  const content = pageContent();
  content.innerHTML =
    pageHeader("Clientes", "Base de clientes y puntos de fidelización") +
    `
    <div style="display:flex;justify-content:flex-end;margin-bottom:16px;">
      <button class="btn-add" id="btn-nuevo"><i class="bi bi-plus-lg"></i>Nuevo cliente</button>
    </div>
    <div id="tabla-wrap">Cargando…</div>
  `;

  const load = async () => {
    const items = await api.listarClientes();
    const wrap = document.querySelector("#tabla-wrap") as HTMLElement;
    wrap.innerHTML = `
      <table class="table-custom">
        <thead><tr><th>Documento</th><th>Nombre</th><th>Teléfono</th><th>Puntos</th><th></th></tr></thead>
        <tbody>
          ${items
            .map(
              (c: Cliente) => `
            <tr>
              <td>${escapeHtml(c.tipo_documento)} ${escapeHtml(c.num_documento)}</td>
              <td>${escapeHtml(c.nombres)}</td>
              <td>${escapeHtml(c.telefono) || "—"}</td>
              <td>${c.puntos_acumulados}</td>
              <td style="text-align:right;">
                ${
                  c.id !== 1
                    ? `<button class="btn-sm-icon" data-edit="${c.id}"><i class="bi bi-pencil"></i></button>
                       <button class="btn-sm-icon danger" data-del="${c.id}"><i class="bi bi-trash"></i></button>`
                    : `<span style="font-size:12px;color:var(--text-secondary);">Protegido</span>`
                }
              </td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    `;
    wrap.querySelectorAll<HTMLButtonElement>("[data-edit]").forEach((b) =>
      b.addEventListener("click", () => {
        const item = items.find((i: Cliente) => i.id === Number(b.dataset.edit));
        openForm(item ?? null);
      })
    );
    wrap.querySelectorAll<HTMLButtonElement>("[data-del]").forEach((b) =>
      b.addEventListener("click", async () => {
        if (!confirm("¿Desactivar este cliente?")) return;
        try {
          await api.eliminarCliente(Number(b.dataset.del));
          toast("Cliente desactivado");
          load();
        } catch (err) {
          toast(String(err), "error");
        }
      })
    );
  };

  const openForm = (item: Cliente | null) => {
    const overlay = openModal(`
      <h3>${item ? "Editar" : "Nuevo"} cliente</h3>
      <form id="form-cliente">
        <div class="grid-2">
          <div class="form-group"><label class="form-label">Tipo de documento</label>
            <select class="form-control-custom" id="f-tipo">
              <option ${item?.tipo_documento === "DNI" || !item ? "selected" : ""}>DNI</option>
              <option ${item?.tipo_documento === "RUC" ? "selected" : ""}>RUC</option>
              <option ${item?.tipo_documento === "Carnet Ext." ? "selected" : ""}>Carnet Ext.</option>
              <option ${item?.tipo_documento === "Sin Documento" ? "selected" : ""}>Sin Documento</option>
            </select>
          </div>
          <div class="form-group"><label class="form-label">N° Documento</label><input class="form-control-custom" id="f-num" required value="${escapeHtml(item?.num_documento)}" /></div>
        </div>
        <div class="form-group"><label class="form-label">Nombres / Razón social</label><input class="form-control-custom" id="f-nombres" required value="${escapeHtml(item?.nombres)}" /></div>
        <div class="grid-2">
          <div class="form-group"><label class="form-label">Teléfono</label><input class="form-control-custom" id="f-tel" value="${escapeHtml(item?.telefono)}" /></div>
          <div class="form-group"><label class="form-label">Dirección</label><input class="form-control-custom" id="f-dir" value="${escapeHtml(item?.direccion)}" /></div>
        </div>
        <button class="btn-primary-custom" type="submit">Guardar</button>
      </form>
    `);
    overlay.querySelector("#form-cliente")!.addEventListener("submit", async (e) => {
      e.preventDefault();
      const cliente: Cliente = {
        id: item?.id ?? null,
        tipo_documento: (overlay.querySelector("#f-tipo") as HTMLSelectElement).value,
        num_documento: (overlay.querySelector("#f-num") as HTMLInputElement).value.trim(),
        nombres: (overlay.querySelector("#f-nombres") as HTMLInputElement).value.trim(),
        telefono: (overlay.querySelector("#f-tel") as HTMLInputElement).value.trim() || null,
        direccion: (overlay.querySelector("#f-dir") as HTMLInputElement).value.trim() || null,
        puntos_acumulados: item?.puntos_acumulados ?? 0,
        estado: item?.estado ?? 1,
      };
      try {
        await api.guardarCliente(cliente);
        closeModal();
        toast("Cliente guardado correctamente");
        load();
      } catch (err) {
        toast(String(err), "error");
      }
    });
  };

  content.querySelector("#btn-nuevo")!.addEventListener("click", () => openForm(null));
  load();
}
