import { api } from "../api";
import { pageContent, pageHeader } from "./layout";
import { closeModal, escapeHtml, openModal, toast } from "../ui";
import type { Rol, Usuario } from "../types";

export async function renderUsuarios() {
  const content = pageContent();
  content.innerHTML =
    pageHeader("Usuarios", "Cuentas de acceso al sistema y sus roles") +
    `
    <div style="display:flex;justify-content:flex-end;margin-bottom:16px;">
      <button class="btn-add" id="btn-nuevo"><i class="bi bi-plus-lg"></i>Nuevo usuario</button>
    </div>
    <div id="tabla-wrap">Cargando…</div>
  `;

  const roles = await api.listarRoles();

  const load = async () => {
    const items = await api.listarUsuarios();
    const wrap = document.querySelector("#tabla-wrap") as HTMLElement;
    wrap.innerHTML = `
      <table class="table-custom">
        <thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          ${items
            .map(
              (u) => `
            <tr>
              <td>${escapeHtml(u.nombres)} ${escapeHtml(u.apellidos)}</td>
              <td>${escapeHtml(u.usuario)}</td>
              <td>${escapeHtml(u.rol_nombre) || "—"}</td>
              <td><span class="pill ${u.estado ? "pill-ok" : "pill-off"}">${u.estado ? "Activo" : "Inactivo"}</span></td>
              <td style="text-align:right;">
                <button class="btn-sm-icon" data-edit="${u.id}"><i class="bi bi-pencil"></i></button>
                <button class="btn-sm-icon danger" data-del="${u.id}"><i class="bi bi-trash"></i></button>
              </td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    `;
    wrap.querySelectorAll<HTMLButtonElement>("[data-edit]").forEach((b) =>
      b.addEventListener("click", () => {
        const item = items.find((i) => i.id === Number(b.dataset.edit));
        openForm(item ?? null);
      })
    );
    wrap.querySelectorAll<HTMLButtonElement>("[data-del]").forEach((b) =>
      b.addEventListener("click", async () => {
        if (!confirm("¿Desactivar este usuario?")) return;
        await api.eliminarUsuario(Number(b.dataset.del));
        toast("Usuario desactivado");
        load();
      })
    );
  };

  const rolOptions = (rolesList: Rol[], selected: number | undefined) =>
    rolesList.map((r) => `<option value="${r.id}" ${r.id === selected ? "selected" : ""}>${escapeHtml(r.nombre)}</option>`).join("");

  const openForm = (item: Usuario | null) => {
    const overlay = openModal(`
      <h3>${item ? "Editar" : "Nuevo"} usuario</h3>
      <form id="form-usr">
        <div class="grid-2">
          <div class="form-group"><label class="form-label">Nombres</label><input class="form-control-custom" id="f-nombres" required value="${escapeHtml(item?.nombres)}" /></div>
          <div class="form-group"><label class="form-label">Apellidos</label><input class="form-control-custom" id="f-apellidos" required value="${escapeHtml(item?.apellidos)}" /></div>
        </div>
        <div class="grid-2">
          <div class="form-group"><label class="form-label">Usuario (login)</label><input class="form-control-custom" id="f-user" required value="${escapeHtml(item?.usuario)}" /></div>
          <div class="form-group"><label class="form-label">Rol</label><select class="form-control-custom" id="f-rol">${rolOptions(roles, item?.rol_id)}</select></div>
        </div>
        <div class="form-group"><label class="form-label">Email</label><input class="form-control-custom" id="f-email" value="${escapeHtml(item?.email)}" /></div>
        <div class="form-group">
          <label class="form-label">${item ? "Nueva contraseña (dejar vacío para no cambiar)" : "Contraseña inicial"}</label>
          <input class="form-control-custom" id="f-pass" type="password" ${item ? "" : "required"} />
          ${item ? "" : '<small style="color:var(--text-secondary);">El usuario deberá cambiarla en su primer ingreso.</small>'}
        </div>
        <div class="form-group">
          <label class="form-label">Estado</label>
          <select class="form-control-custom" id="f-estado">
            <option value="1" ${item?.estado ?? 1 ? "selected" : ""}>Activo</option>
            <option value="0" ${item && !item.estado ? "selected" : ""}>Inactivo</option>
          </select>
        </div>
        <button class="btn-primary-custom" type="submit">Guardar</button>
      </form>
    `);

    overlay.querySelector("#form-usr")!.addEventListener("submit", async (e) => {
      e.preventDefault();
      const usuario: Usuario = {
        id: item?.id ?? null,
        nombres: (overlay.querySelector("#f-nombres") as HTMLInputElement).value.trim(),
        apellidos: (overlay.querySelector("#f-apellidos") as HTMLInputElement).value.trim(),
        usuario: (overlay.querySelector("#f-user") as HTMLInputElement).value.trim(),
        email: (overlay.querySelector("#f-email") as HTMLInputElement).value.trim() || null,
        rol_id: Number((overlay.querySelector("#f-rol") as HTMLSelectElement).value),
        estado: Number((overlay.querySelector("#f-estado") as HTMLSelectElement).value),
        password: (overlay.querySelector("#f-pass") as HTMLInputElement).value || null,
      };
      try {
        await api.guardarUsuario(usuario);
        closeModal();
        toast("Usuario guardado correctamente");
        load();
      } catch (err) {
        toast(String(err), "error");
      }
    });
  };

  content.querySelector("#btn-nuevo")!.addEventListener("click", () => openForm(null));
  load();
}
