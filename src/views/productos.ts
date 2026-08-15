import { api } from "../api";
import { pageContent, pageHeader } from "./layout";
import { closeModal, escapeHtml, openModal, toast } from "../ui";
import type { Categoria, Laboratorio, Producto } from "../types";

export async function renderProductos() {
  const content = pageContent();
  content.innerHTML =
    pageHeader("Productos", "Catálogo de medicamentos y otros productos") +
    `
    <div style="display:flex;justify-content:flex-end;gap:10px;margin-bottom:16px;flex-wrap:wrap;">
      <button class="btn-sm-icon" id="btn-exportar-codigos" title="Descarga un Excel con todos los productos activos, para escanear el código de barras físico directo sobre cada celda con la pistola lectora">
        <i class="bi bi-file-earmark-spreadsheet"></i> Exportar plantilla de códigos
      </button>
      <button class="btn-sm-icon" id="btn-importar-codigos" title="Sube de vuelta el Excel ya escaneado para cargar todos los códigos de barra de una sola vez">
        <i class="bi bi-upload"></i> Importar códigos de barra
      </button>
      <button class="btn-add" id="btn-nuevo"><i class="bi bi-plus-lg"></i>Nuevo producto</button>
    </div>
    <div id="tabla-wrap">Cargando…</div>
  `;

  content.querySelector("#btn-exportar-codigos")!.addEventListener("click", async () => {
    try {
      const ruta = await api.exportarPlantillaCodigos();
      toast(`Plantilla guardada en: ${ruta}`);
    } catch (err) {
      toast(String(err), "error");
    }
  });

  content.querySelector("#btn-importar-codigos")!.addEventListener("click", async () => {
    try {
      const ruta = await api.elegirArchivoCodigos();
      if (!ruta) return;
      const resumen = await api.importarCodigosBarras(ruta);
      let mensaje = `Importación completa: ${resumen.actualizados} código(s) actualizados.`;
      if (resumen.sin_cambios > 0) mensaje += ` ${resumen.sin_cambios} ya tenían ese mismo código.`;
      toast(mensaje);
      if (resumen.conflictos.length > 0) {
        toast(`Estos códigos ya pertenecen a OTRO producto y no se pudieron asignar: ${resumen.conflictos.join(", ")}`, "error");
      }
      load();
    } catch (err) {
      toast(String(err), "error");
    }
  });

  const [categorias, laboratorios] = await Promise.all([api.listarCategorias(), api.listarLaboratorios()]);

  const load = async () => {
    const items = await api.listarProductos(true);
    const wrap = document.querySelector("#tabla-wrap") as HTMLElement;
    if (items.length === 0) {
      wrap.innerHTML = '<div class="empty-state">Aún no hay productos registrados.</div>';
      return;
    }
    wrap.innerHTML = `
      <table class="table-custom">
        <thead><tr><th>Producto</th><th>Categoría</th><th>Laboratorio</th><th>P. Venta</th><th>Stock</th><th>Receta</th><th></th></tr></thead>
        <tbody>
          ${items
            .map(
              (p) => `
            <tr>
              <td><strong>${escapeHtml(p.nombre_comercial)}</strong><br/><span style="color:var(--text-secondary);font-size:12px;">${escapeHtml(p.nombre_generico)} ${escapeHtml(p.concentracion) || ""}</span></td>
              <td>${escapeHtml(p.categoria_nombre) || "—"}</td>
              <td>${escapeHtml(p.laboratorio_nombre) || "—"}</td>
              <td>S/ ${p.precio_venta.toFixed(2)}</td>
              <td>${p.stock_actual <= p.stock_minimo ? `<span class="pill pill-off">${p.stock_actual}</span>` : p.stock_actual}</td>
              <td>${p.requiere_receta ? '<i class="bi bi-check-circle-fill" style="color:var(--warning)"></i>' : "—"}</td>
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
        if (!confirm("¿Desactivar este producto?")) return;
        await api.eliminarProducto(Number(b.dataset.del));
        toast("Producto desactivado");
        load();
      })
    );
  };

  const opciones = (list: (Categoria | Laboratorio)[], selectedId: number | null) =>
    `<option value="">—</option>` +
    list.map((o) => `<option value="${o.id}" ${o.id === selectedId ? "selected" : ""}>${escapeHtml(o.nombre)}</option>`).join("");

  const openForm = (item: Producto | null) => {
    const overlay = openModal(`
      <h3>${item ? "Editar" : "Nuevo"} producto</h3>
      <form id="form-prod">
        <div class="grid-2">
          <div class="form-group"><label class="form-label">Nombre genérico</label><input class="form-control-custom" id="f-generico" required value="${escapeHtml(item?.nombre_generico)}" /></div>
          <div class="form-group"><label class="form-label">Nombre comercial</label><input class="form-control-custom" id="f-comercial" required value="${escapeHtml(item?.nombre_comercial)}" /></div>
        </div>
        <div class="grid-2">
          <div class="form-group"><label class="form-label">Concentración</label><input class="form-control-custom" id="f-conc" value="${escapeHtml(item?.concentracion)}" /></div>
          <div class="form-group"><label class="form-label">Forma farmacéutica</label><input class="form-control-custom" id="f-forma" value="${escapeHtml(item?.forma_farmaceutica)}" /></div>
        </div>
        <div class="grid-2">
          <div class="form-group"><label class="form-label">Categoría</label><select class="form-control-custom" id="f-cat">${opciones(categorias, item?.id_categoria ?? null)}</select></div>
          <div class="form-group"><label class="form-label">Laboratorio</label><select class="form-control-custom" id="f-lab">${opciones(laboratorios, item?.id_laboratorio ?? null)}</select></div>
        </div>
        <div class="grid-2">
          <div class="form-group"><label class="form-label">Código de barras</label><input class="form-control-custom" id="f-cb" value="${escapeHtml(item?.codigo_barras)}" /></div>
          <div class="form-group"><label class="form-label">Unidad de medida</label><input class="form-control-custom" id="f-unidad" value="${escapeHtml(item?.unidad_medida) || "Caja"}" /></div>
        </div>
        <div class="grid-2">
          <div class="form-group"><label class="form-label">Precio compra (S/)</label><input class="form-control-custom" id="f-pcompra" type="number" step="0.01" required value="${item?.precio_compra ?? 0}" /></div>
          <div class="form-group"><label class="form-label">Precio venta (S/)</label><input class="form-control-custom" id="f-pventa" type="number" step="0.01" required value="${item?.precio_venta ?? 0}" /></div>
        </div>
        <div class="grid-2">
          <div class="form-group"><label class="form-label">Stock mínimo</label><input class="form-control-custom" id="f-stockmin" type="number" required value="${item?.stock_minimo ?? 10}" /></div>
          <div class="form-group"><label class="form-label">Estado</label>
            <select class="form-control-custom" id="f-estado">
              <option value="1" ${item?.estado ?? 1 ? "selected" : ""}>Activo</option>
              <option value="0" ${item && !item.estado ? "selected" : ""}>Inactivo</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label"><input type="checkbox" id="f-receta" ${item?.requiere_receta ? "checked" : ""} /> Requiere receta médica</label>
        </div>
        <button class="btn-primary-custom" type="submit">Guardar</button>
      </form>
    `);

    overlay.querySelector("#form-prod")!.addEventListener("submit", async (e) => {
      e.preventDefault();
      const producto: Producto = {
        id: item?.id ?? null,
        codigo_barras: (overlay.querySelector("#f-cb") as HTMLInputElement).value.trim() || null,
        registro_sanitario: item?.registro_sanitario ?? null,
        nombre_generico: (overlay.querySelector("#f-generico") as HTMLInputElement).value.trim(),
        nombre_comercial: (overlay.querySelector("#f-comercial") as HTMLInputElement).value.trim(),
        concentracion: (overlay.querySelector("#f-conc") as HTMLInputElement).value.trim() || null,
        forma_farmaceutica: (overlay.querySelector("#f-forma") as HTMLInputElement).value.trim() || null,
        presentacion: item?.presentacion ?? null,
        id_laboratorio: (overlay.querySelector("#f-lab") as HTMLSelectElement).value ? Number((overlay.querySelector("#f-lab") as HTMLSelectElement).value) : null,
        id_categoria: (overlay.querySelector("#f-cat") as HTMLSelectElement).value ? Number((overlay.querySelector("#f-cat") as HTMLSelectElement).value) : null,
        precio_compra: Number((overlay.querySelector("#f-pcompra") as HTMLInputElement).value),
        precio_venta: Number((overlay.querySelector("#f-pventa") as HTMLInputElement).value),
        unidad_medida: (overlay.querySelector("#f-unidad") as HTMLInputElement).value.trim() || null,
        requiere_receta: (overlay.querySelector("#f-receta") as HTMLInputElement).checked ? 1 : 0,
        stock_actual: item?.stock_actual ?? 0,
        stock_minimo: Number((overlay.querySelector("#f-stockmin") as HTMLInputElement).value),
        estado: Number((overlay.querySelector("#f-estado") as HTMLSelectElement).value),
        fraccionable: item?.fraccionable ?? 0,
        unidades_por_caja: item?.unidades_por_caja ?? 1,
        unidad_fraccion: item?.unidad_fraccion ?? null,
        precio_fraccion: item?.precio_fraccion ?? 0,
      };
      try {
        await api.guardarProducto(producto);
        closeModal();
        toast("Producto guardado correctamente");
        load();
      } catch (err) {
        toast(String(err), "error");
      }
    });
  };

  content.querySelector("#btn-nuevo")!.addEventListener("click", () => openForm(null));
  load();
}
