import { api } from "../api";
import { pageContent, pageHeader } from "./layout";
import { closeModal, escapeHtml, openModal, toast } from "../ui";
import type { Categoria, Laboratorio, Proveedor } from "../types";

type SimpleEntity = Categoria | Laboratorio;

interface SimpleConfig {
  titulo: string;
  subtitulo: string;
  list: () => Promise<SimpleEntity[]>;
  save: (e: SimpleEntity) => Promise<number>;
  remove: (id: number) => Promise<void>;
}

async function renderSimple(cfg: SimpleConfig) {
  const content = pageContent();
  content.innerHTML = pageHeader(cfg.titulo, cfg.subtitulo) + `
    <div style="display:flex;justify-content:flex-end;margin-bottom:16px;">
      <button class="btn-add" id="btn-nuevo"><i class="bi bi-plus-lg"></i>Nuevo</button>
    </div>
    <div id="tabla-wrap">Cargando…</div>
  `;

  const load = async () => {
    const items = await cfg.list();
    const wrap = document.querySelector("#tabla-wrap") as HTMLElement;
    if (items.length === 0) {
      wrap.innerHTML = '<div class="empty-state">Sin registros todavía.</div>';
      return;
    }
    wrap.innerHTML = `
      <table class="table-custom">
        <thead><tr><th>Nombre</th><th>Descripción</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          ${items
            .map(
              (it) => `
            <tr>
              <td>${escapeHtml(it.nombre)}</td>
              <td>${escapeHtml(it.descripcion) || "—"}</td>
              <td><span class="pill ${it.estado ? "pill-ok" : "pill-off"}">${it.estado ? "Activo" : "Inactivo"}</span></td>
              <td style="text-align:right;">
                <button class="btn-sm-icon" data-edit="${it.id}"><i class="bi bi-pencil"></i></button>
                <button class="btn-sm-icon danger" data-del="${it.id}"><i class="bi bi-trash"></i></button>
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
        if (!confirm("¿Desactivar este registro?")) return;
        await cfg.remove(Number(b.dataset.del));
        toast("Registro desactivado");
        load();
      })
    );
  };

  const openForm = (item: SimpleEntity | null) => {
    const overlay = openModal(`
      <h3>${item ? "Editar" : "Nuevo"} — ${cfg.titulo}</h3>
      <form id="form-simple">
        <div class="form-group">
          <label class="form-label">Nombre</label>
          <input class="form-control-custom" id="f-nombre" required value="${escapeHtml(item?.nombre)}" />
        </div>
        <div class="form-group">
          <label class="form-label">Descripción</label>
          <input class="form-control-custom" id="f-desc" value="${escapeHtml(item?.descripcion)}" />
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
    overlay.querySelector("#form-simple")!.addEventListener("submit", async (e) => {
      e.preventDefault();
      const nombre = (overlay.querySelector("#f-nombre") as HTMLInputElement).value.trim();
      const descripcion = (overlay.querySelector("#f-desc") as HTMLInputElement).value.trim() || null;
      const estado = Number((overlay.querySelector("#f-estado") as HTMLSelectElement).value);
      try {
        await cfg.save({ id: item?.id ?? null, nombre, descripcion, estado });
        closeModal();
        toast("Guardado correctamente");
        load();
      } catch (err) {
        toast(String(err), "error");
      }
    });
  };

  content.querySelector("#btn-nuevo")!.addEventListener("click", () => openForm(null));
  load();
}

export const renderCategorias = () =>
  renderSimple({
    titulo: "Categorías",
    subtitulo: "Clasificación de medicamentos (analgésicos, antibióticos, etc.)",
    list: api.listarCategorias,
    save: (e) => api.guardarCategoria(e as Categoria),
    remove: api.eliminarCategoria,
  });

export const renderLaboratorios = () =>
  renderSimple({
    titulo: "Laboratorios",
    subtitulo: "Marcas y laboratorios fabricantes",
    list: api.listarLaboratorios,
    save: (e) => api.guardarLaboratorio(e as Laboratorio),
    remove: api.eliminarLaboratorio,
  });

export async function renderProveedores() {
  const content = pageContent();
  content.innerHTML = pageHeader("Proveedores", "Empresas que abastecen la botica") + `
    <div style="display:flex;justify-content:flex-end;margin-bottom:16px;">
      <button class="btn-add" id="btn-nuevo"><i class="bi bi-plus-lg"></i>Nuevo</button>
    </div>
    <div id="tabla-wrap">Cargando…</div>
  `;

  const load = async () => {
    const items = await api.listarProveedores();
    const wrap = document.querySelector("#tabla-wrap") as HTMLElement;
    if (items.length === 0) {
      wrap.innerHTML = '<div class="empty-state">Sin proveedores todavía.</div>';
      return;
    }
    wrap.innerHTML = `
      <table class="table-custom">
        <thead><tr><th>RUC</th><th>Razón social</th><th>Representante</th><th>Teléfono</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          ${items
            .map(
              (p) => `
            <tr>
              <td>${escapeHtml(p.ruc)}</td>
              <td>${escapeHtml(p.razon_social)}</td>
              <td>${escapeHtml(p.representante) || "—"}</td>
              <td>${escapeHtml(p.telefono) || "—"}</td>
              <td><span class="pill ${p.estado ? "pill-ok" : "pill-off"}">${p.estado ? "Activo" : "Inactivo"}</span></td>
              <td style="text-align:right;">
                <button class="btn-sm-icon" data-edit="${p.id}"><i class="bi bi-pencil"></i></button>
                <button class="btn-sm-icon danger" data-del="${p.id}"><i class="bi bi-trash"></i></button>
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
        if (!confirm("¿Desactivar este proveedor?")) return;
        await api.eliminarProveedor(Number(b.dataset.del));
        toast("Proveedor desactivado");
        load();
      })
    );
  };

  const openForm = (item: Proveedor | null) => {
    const overlay = openModal(`
      <h3>${item ? "Editar" : "Nuevo"} proveedor</h3>
      <form id="form-prov">
        <div class="grid-2">
          <div class="form-group"><label class="form-label">RUC</label><input class="form-control-custom" id="f-ruc" required value="${escapeHtml(item?.ruc)}" /></div>
          <div class="form-group"><label class="form-label">Teléfono</label><input class="form-control-custom" id="f-tel" value="${escapeHtml(item?.telefono)}" /></div>
        </div>
        <div class="form-group"><label class="form-label">Razón social</label><input class="form-control-custom" id="f-razon" required value="${escapeHtml(item?.razon_social)}" /></div>
        <div class="form-group"><label class="form-label">Representante</label><input class="form-control-custom" id="f-rep" value="${escapeHtml(item?.representante)}" /></div>
        <div class="form-group"><label class="form-label">Dirección</label><input class="form-control-custom" id="f-dir" value="${escapeHtml(item?.direccion)}" /></div>
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
    overlay.querySelector("#form-prov")!.addEventListener("submit", async (e) => {
      e.preventDefault();
      const proveedor: Proveedor = {
        id: item?.id ?? null,
        ruc: (overlay.querySelector("#f-ruc") as HTMLInputElement).value.trim(),
        razon_social: (overlay.querySelector("#f-razon") as HTMLInputElement).value.trim(),
        representante: (overlay.querySelector("#f-rep") as HTMLInputElement).value.trim() || null,
        telefono: (overlay.querySelector("#f-tel") as HTMLInputElement).value.trim() || null,
        direccion: (overlay.querySelector("#f-dir") as HTMLInputElement).value.trim() || null,
        estado: Number((overlay.querySelector("#f-estado") as HTMLSelectElement).value),
      };
      try {
        await api.guardarProveedor(proveedor);
        closeModal();
        toast("Guardado correctamente");
        load();
      } catch (err) {
        toast(String(err), "error");
      }
    });
  };

  content.querySelector("#btn-nuevo")!.addEventListener("click", () => openForm(null));
  load();
}
