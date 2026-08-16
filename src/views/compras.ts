import { api } from "../api";
import { pageContent, pageHeader } from "./layout";
import { closeModal, escapeHtml, openModal, openNestedModal, toast } from "../ui";
import type { CompraResumen, DetalleCompra, Producto, Proveedor } from "../types";

/** Alta rápida de proveedor desde Compras (equivalente a ProveedorController::crearRapido del
 * sistema original): disponible para cualquier rol con sesión, incluido el Técnico en
 * Farmacia, que no tiene acceso al módulo completo de Proveedores. Se abre ENCIMA del
 * formulario de "Nueva compra" sin cerrarlo (openNestedModal), así no se pierden las líneas
 * de productos que ya se habían llenado ahí. */
async function abrirProveedorRapido(onCreado: (proveedor: Proveedor) => void) {
  const overlay = openNestedModal(`
    <h3>Proveedor nuevo (alta rápida)</h3>
    <form id="form-prov-rapido">
      <div class="grid-2">
        <div class="form-group"><label class="form-label">RUC</label><input class="form-control-custom" id="f-ruc" required /></div>
        <div class="form-group"><label class="form-label">Teléfono</label><input class="form-control-custom" id="f-telefono" /></div>
      </div>
      <div class="form-group"><label class="form-label">Razón social</label><input class="form-control-custom" id="f-razon" required /></div>
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Representante</label><input class="form-control-custom" id="f-rep" /></div>
        <div class="form-group"><label class="form-label">Dirección</label><input class="form-control-custom" id="f-dir" /></div>
      </div>
      <button class="btn-primary-custom" type="submit">Guardar y usar</button>
    </form>
  `);
  overlay.querySelector("#form-prov-rapido")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const id = await api.crearProveedorRapido({
        ruc: (overlay.querySelector("#f-ruc") as HTMLInputElement).value.trim(),
        razon_social: (overlay.querySelector("#f-razon") as HTMLInputElement).value.trim(),
        representante: (overlay.querySelector("#f-rep") as HTMLInputElement).value.trim() || null,
        telefono: (overlay.querySelector("#f-telefono") as HTMLInputElement).value.trim() || null,
        direccion: (overlay.querySelector("#f-dir") as HTMLInputElement).value.trim() || null,
      });
      const nuevos = await api.listarProveedores();
      const creado = nuevos.find((p) => p.id === id);
      overlay.remove();
      toast("Proveedor creado y seleccionado");
      if (creado) onCreado(creado);
    } catch (err) {
      toast(String(err), "error");
    }
  });
}

interface LineaCompra {
  id_producto: number | null;
  cantidad: number;
  precio_unitario: number;
  precio_venta: number;
  precio_fraccion: number;
  lote: string;
  vencimiento: string;
  registro_sanitario: string;
  actualizar_precio: boolean;
  actualizar_rs: boolean;
}

export async function renderCompras() {
  const content = pageContent();
  content.innerHTML =
    pageHeader("Compras", "Órdenes de compra, recepción de mercadería y devoluciones a proveedor") +
    `
    <div style="display:flex;justify-content:flex-end;margin-bottom:16px;">
      <button class="btn-add" id="btn-nueva"><i class="bi bi-plus-lg"></i>Nueva compra</button>
    </div>
    <div id="compras-wrap">Cargando…</div>
  `;

  // registrar_devolucion está bloqueado para el Técnico en Farmacia (exigir_no_tecnico); se
  // oculta el botón para que no llegue a llenar el formulario solo para toparse con el error.
  const sesion = await api.currentUser();
  const esTecnico = sesion?.rol_id === 4;

  const load = async () => {
    const compras = await api.listarCompras();
    const wrap = document.querySelector("#compras-wrap") as HTMLElement;
    if (compras.length === 0) {
      wrap.innerHTML = '<div class="empty-state">Aún no hay compras registradas.</div>';
      return;
    }
    wrap.innerHTML = `
      <table class="table-custom">
        <thead><tr><th>Fecha</th><th>Proveedor</th><th>Comprobante</th><th>Total</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          ${compras
            .map(
              (c: CompraResumen) => `
            <tr>
              <td>${c.fecha_compra}</td>
              <td>${escapeHtml(c.proveedor)}</td>
              <td>${escapeHtml(c.tipo_comprobante)} ${escapeHtml(c.serie_comprobante) || ""}-${escapeHtml(c.num_comprobante)}</td>
              <td>S/ ${c.total.toFixed(2)}</td>
              <td><span class="pill ${c.estado === "Completada" ? "pill-ok" : "pill-off"}">${escapeHtml(c.estado)}</span></td>
              <td style="text-align:right;white-space:nowrap;">
                <button class="btn-sm-icon" data-ver="${c.id}" title="Ver detalle"><i class="bi bi-eye"></i></button>
                ${c.estado === "Pendiente" ? `<button class="btn-sm-icon" data-recibir="${c.id}" title="Recibir mercadería"><i class="bi bi-truck"></i></button>` : ""}
                ${c.estado === "Completada" && !esTecnico ? `<button class="btn-sm-icon danger" data-devolver="${c.id}" title="Devolver al proveedor"><i class="bi bi-arrow-return-left"></i></button>` : ""}
              </td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    `;

    wrap.querySelectorAll<HTMLButtonElement>("[data-ver]").forEach((b) =>
      b.addEventListener("click", () => verDetalle(Number(b.dataset.ver)))
    );
    wrap.querySelectorAll<HTMLButtonElement>("[data-recibir]").forEach((b) =>
      b.addEventListener("click", () => abrirRecepcion(Number(b.dataset.recibir), load))
    );
    wrap.querySelectorAll<HTMLButtonElement>("[data-devolver]").forEach((b) =>
      b.addEventListener("click", () => abrirDevolucion(Number(b.dataset.devolver), load))
    );
  };

  content.querySelector("#btn-nueva")!.addEventListener("click", () => abrirNuevaCompra(load));
  load();
}

async function verDetalle(idCompra: number) {
  const detalles = await api.detallesCompra(idCompra);
  openModal(`
    <h3>Detalle de la compra #${idCompra}</h3>
    <table class="table-custom">
      <thead><tr><th>Producto</th><th>Cant.</th><th>P. Unit.</th><th>Subtotal</th><th>Lote</th><th>Vence</th></tr></thead>
      <tbody>
        ${detalles
          .map(
            (d: DetalleCompra) => `
          <tr>
            <td>${escapeHtml(d.nombre_comercial)}</td>
            <td>${d.cantidad}</td>
            <td>S/ ${d.precio_unitario.toFixed(2)}</td>
            <td>S/ ${d.subtotal.toFixed(2)}</td>
            <td>${escapeHtml(d.codigo_lote) || "—"}</td>
            <td>${d.fecha_vencimiento || "—"}</td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>
  `);
}

// ---------------- Nueva compra ----------------

async function abrirNuevaCompra(onDone: () => void) {
  const [proveedoresIniciales, productos, sesion] = await Promise.all([api.listarProveedores(), api.listarProductos(true), api.currentUser()]);
  const proveedores: Proveedor[] = proveedoresIniciales;
  const lineas: LineaCompra[] = [];
  // crear_compra ignora silenciosamente el precio de venta que ingrese el Técnico en Farmacia
  // (nunca se le permite cambiar precios de venta); se lo avisamos aquí para que no piense que
  // el campo no se guardó por un error.
  const esTecnico = sesion?.rol_id === 4;

  const overlay = openModal(`
    <h3>Nueva compra</h3>
    <form id="form-compra">
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Proveedor</label>
          <div style="display:flex;gap:6px;">
            <select class="form-control-custom" id="f-prov" required style="flex:1;">
              <option value="">Selecciona…</option>
              ${proveedores.map((p: Proveedor) => `<option value="${p.id}">${escapeHtml(p.razon_social)}</option>`).join("")}
            </select>
            <button type="button" class="btn-sm-icon" id="btn-prov-rapido" title="Proveedor nuevo (alta rápida)"><i class="bi bi-truck"></i></button>
          </div>
        </div>
        <div class="form-group"><label class="form-label">Fecha de compra</label><input class="form-control-custom" id="f-fecha" type="date" required value="${new Date().toISOString().slice(0, 10)}" /></div>
      </div>
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Tipo de comprobante</label>
          <select class="form-control-custom" id="f-tipo">
            <option>Factura</option><option>Boleta</option><option>Guía</option>
          </select>
        </div>
        <div class="form-group"><label class="form-label">Serie y número</label>
          <div style="display:flex;gap:8px;">
            <input class="form-control-custom" id="f-serie" placeholder="F001" style="width:40%;" />
            <input class="form-control-custom" id="f-num" placeholder="000123" required />
          </div>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Estado</label>
        <select class="form-control-custom" id="f-estado">
          <option value="Completada">Completada (ingresa stock de inmediato)</option>
          <option value="Pendiente">Pendiente (orden de compra, recibir después)</option>
        </select>
      </div>

      <h4 style="margin:20px 0 10px;font-size:15px;">Productos</h4>
      <div id="lineas-wrap"></div>
      <button type="button" class="btn-sm-icon" id="btn-add-linea" style="margin-bottom:16px;"><i class="bi bi-plus-circle"></i> Agregar producto</button>

      <div style="display:flex;justify-content:flex-end;gap:24px;margin-bottom:16px;font-size:14px;">
        <div>Impuesto: <input class="form-control-custom" id="f-impuesto" type="number" step="0.01" value="0" style="width:100px;display:inline-block;padding:6px 10px;" /></div>
        <div><strong>Total: S/ <span id="f-total">0.00</span></strong></div>
      </div>
      <button class="btn-primary-custom" type="submit">Registrar compra</button>
    </form>
  `);
  (overlay.querySelector(".modal-box") as HTMLElement).style.width = "760px";

  overlay.querySelector("#btn-prov-rapido")!.addEventListener("click", () => {
    abrirProveedorRapido((creado) => {
      proveedores.push(creado);
      const sel = overlay.querySelector("#f-prov") as HTMLSelectElement;
      sel.innerHTML =
        `<option value="">Selecciona…</option>` +
        proveedores.map((p: Proveedor) => `<option value="${p.id}">${escapeHtml(p.razon_social)}</option>`).join("");
      sel.value = String(creado.id);
    });
  });

  const productoOptions = (selected: number | null) =>
    `<option value="">—</option>` +
    productos.map((p: Producto) => `<option value="${p.id}" ${p.id === selected ? "selected" : ""}>${escapeHtml(p.nombre_comercial)}</option>`).join("");

  const recalcTotal = () => {
    const subtotales = lineas.reduce((acc, l) => acc + l.cantidad * l.precio_unitario, 0);
    const impuesto = Number((overlay.querySelector("#f-impuesto") as HTMLInputElement).value || 0);
    (overlay.querySelector("#f-total") as HTMLElement).textContent = (subtotales + impuesto).toFixed(2);
  };

  const pintarLineas = () => {
    const wrap = overlay.querySelector("#lineas-wrap") as HTMLElement;
    wrap.innerHTML = lineas
      .map(
        (l, i) => `
      <div style="border:1px solid var(--border-color);border-radius:12px;padding:14px;margin-bottom:10px;">
        <div class="grid-2">
          <div class="form-group"><label class="form-label">Producto</label><select class="form-control-custom" data-f="producto" data-i="${i}">${productoOptions(l.id_producto)}</select></div>
          <div class="form-group"><label class="form-label">Cantidad</label><input class="form-control-custom" type="number" min="1" data-f="cantidad" data-i="${i}" value="${l.cantidad}" /></div>
        </div>
        <div class="grid-2">
          <div class="form-group"><label class="form-label">Precio compra unit.</label><input class="form-control-custom" type="number" step="0.01" data-f="precio_unitario" data-i="${i}" value="${l.precio_unitario}" /></div>
          <div class="form-group"><label class="form-label">Precio venta (si actualiza)</label><input class="form-control-custom" type="number" step="0.01" data-f="precio_venta" data-i="${i}" value="${l.precio_venta}" ${esTecnico ? "disabled" : ""} />${esTecnico ? '<small style="color:var(--text-secondary);">El Técnico en Farmacia no puede modificar el precio de venta.</small>' : ""}</div>
        </div>
        <div class="grid-2">
          <div class="form-group"><label class="form-label">Código de lote</label><input class="form-control-custom" data-f="lote" data-i="${i}" value="${l.lote}" /></div>
          <div class="form-group"><label class="form-label">Vencimiento</label><input class="form-control-custom" type="date" data-f="vencimiento" data-i="${i}" value="${l.vencimiento}" /></div>
        </div>
        <label style="font-size:13px;"><input type="checkbox" data-f="actualizar_precio" data-i="${i}" ${l.actualizar_precio ? "checked" : ""} /> Actualizar precio de compra/venta del producto</label>
        <button type="button" class="btn-sm-icon danger" data-remove="${i}" style="float:right;"><i class="bi bi-trash"></i></button>
      </div>`
      )
      .join("");

    wrap.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-f]").forEach((el) => {
      const ev = el.tagName === "SELECT" || el.type === "checkbox" ? "change" : "input";
      el.addEventListener(ev, () => {
        const i = Number(el.dataset.i);
        const field = el.dataset.f as keyof LineaCompra;
        const linea = lineas[i] as any;
        if (el.type === "checkbox") linea[field] = (el as HTMLInputElement).checked;
        else if (["cantidad", "precio_unitario", "precio_venta", "precio_fraccion", "id_producto"].includes(field))
          linea[field] = field === "id_producto" ? Number(el.value) || null : Number(el.value) || 0;
        else linea[field] = el.value;
        recalcTotal();
      });
    });
    wrap.querySelectorAll<HTMLButtonElement>("[data-remove]").forEach((b) =>
      b.addEventListener("click", () => {
        lineas.splice(Number(b.dataset.remove), 1);
        pintarLineas();
        recalcTotal();
      })
    );
  };

  const nuevaLinea = (): LineaCompra => ({
    id_producto: null,
    cantidad: 1,
    precio_unitario: 0,
    precio_venta: 0,
    precio_fraccion: 0,
    lote: "",
    vencimiento: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
    registro_sanitario: "",
    actualizar_precio: false,
    actualizar_rs: false,
  });

  overlay.querySelector("#btn-add-linea")!.addEventListener("click", () => {
    lineas.push(nuevaLinea());
    pintarLineas();
  });
  overlay.querySelector("#f-impuesto")!.addEventListener("input", recalcTotal);

  lineas.push(nuevaLinea());
  pintarLineas();

  overlay.querySelector("#form-compra")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    const validas = lineas.filter((l) => l.id_producto && l.cantidad > 0);
    if (validas.length === 0) {
      toast("Debe agregar al menos un producto", "error");
      return;
    }
    const impuesto = Number((overlay.querySelector("#f-impuesto") as HTMLInputElement).value || 0);
    const subtotales = validas.reduce((acc, l) => acc + l.cantidad * l.precio_unitario, 0);
    try {
      await api.crearCompra(
        {
          id_proveedor: Number((overlay.querySelector("#f-prov") as HTMLSelectElement).value),
          tipo_comprobante: (overlay.querySelector("#f-tipo") as HTMLSelectElement).value,
          serie_comprobante: (overlay.querySelector("#f-serie") as HTMLInputElement).value.trim() || null,
          num_comprobante: (overlay.querySelector("#f-num") as HTMLInputElement).value.trim(),
          fecha_compra: (overlay.querySelector("#f-fecha") as HTMLInputElement).value,
          impuesto,
          total: subtotales + impuesto,
          estado: (overlay.querySelector("#f-estado") as HTMLSelectElement).value,
        },
        validas.map((l) => ({
          id_producto: l.id_producto!,
          cantidad: l.cantidad,
          precio_unitario: l.precio_unitario,
          precio_venta: l.precio_venta,
          precio_fraccion: l.precio_fraccion,
          subtotal: l.cantidad * l.precio_unitario,
          lote: l.lote,
          vencimiento: l.vencimiento,
          registro_sanitario: l.registro_sanitario || null,
          actualizar_precio: l.actualizar_precio,
          actualizar_rs: l.actualizar_rs,
        }))
      );
      closeModal();
      toast("Compra registrada correctamente");
      onDone();
    } catch (err) {
      toast(String(err), "error");
    }
  });
}

// ---------------- Recepción ----------------

async function abrirRecepcion(idCompra: number, onDone: () => void) {
  const detalles = await api.detallesCompra(idCompra);
  const overlay = openModal(`
    <h3>Recibir mercadería — Compra #${idCompra}</h3>
    <form id="form-recepcion">
      ${detalles
        .map(
          (d: DetalleCompra) => `
        <div style="border:1px solid var(--border-color);border-radius:12px;padding:14px;margin-bottom:10px;">
          <strong>${escapeHtml(d.nombre_comercial)}</strong> — ${d.cantidad} unidades
          <div class="grid-2" style="margin-top:8px;">
            <div class="form-group"><label class="form-label">Código de lote</label><input class="form-control-custom" data-detalle="${d.id}" data-f="lote" required /></div>
            <div class="form-group"><label class="form-label">Vencimiento</label><input class="form-control-custom" type="date" data-detalle="${d.id}" data-f="vencimiento" required /></div>
          </div>
        </div>`
        )
        .join("")}
      <button class="btn-primary-custom" type="submit">Confirmar recepción</button>
    </form>
  `);
  (overlay.querySelector(".modal-box") as HTMLElement).style.width = "620px";

  overlay.querySelector("#form-recepcion")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    const lotes = detalles.map((d: DetalleCompra) => ({
      id_detalle: d.id,
      lote: (overlay.querySelector(`[data-detalle="${d.id}"][data-f="lote"]`) as HTMLInputElement).value.trim(),
      vencimiento: (overlay.querySelector(`[data-detalle="${d.id}"][data-f="vencimiento"]`) as HTMLInputElement).value,
    }));
    try {
      await api.procesarRecepcion(idCompra, lotes);
      closeModal();
      toast("Mercadería recibida y stock actualizado");
      onDone();
    } catch (err) {
      toast(String(err), "error");
    }
  });
}

// ---------------- Devolución ----------------

async function abrirDevolucion(idCompra: number, onDone: () => void) {
  const detalles = await api.detallesCompra(idCompra);
  const conLote = detalles.filter((d) => d.codigo_lote);
  if (conLote.length === 0) {
    toast("Esta compra no tiene lotes asociados para devolver", "error");
    return;
  }

  const overlay = openModal(`
    <h3>Devolver al proveedor — Compra #${idCompra}</h3>
    <form id="form-devolucion">
      <div class="grid-2">
        <div class="form-group"><label class="form-label">N° Nota de crédito</label><input class="form-control-custom" id="f-nc" required /></div>
        <div class="form-group"><label class="form-label">Fecha</label><input class="form-control-custom" id="f-fecha" type="date" required value="${new Date().toISOString().slice(0, 10)}" /></div>
      </div>
      <div class="form-group"><label class="form-label">Motivo</label><input class="form-control-custom" id="f-motivo" placeholder="Ej: producto vencido, defectuoso, etc." /></div>
      ${conLote
        .map(
          (d) => `
        <div style="border:1px solid var(--border-color);border-radius:12px;padding:14px;margin-bottom:10px;">
          <strong>${escapeHtml(d.nombre_comercial)}</strong> — Lote ${escapeHtml(d.codigo_lote)} (vence ${d.fecha_vencimiento})
          <div class="form-group" style="margin-top:8px;"><label class="form-label">Cantidad a devolver</label>
            <input class="form-control-custom" type="number" min="0" value="0" data-prod="${d.id_producto}" data-precio="${d.precio_unitario}" />
          </div>
        </div>`
        )
        .join("")}
      <button class="btn-primary-custom" type="submit">Registrar devolución</button>
    </form>
  `);
  (overlay.querySelector(".modal-box") as HTMLElement).style.width = "620px";

  overlay.querySelector("#form-devolucion")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    const detallesFinal = conLote
      .map((d, i) => {
        const input = overlay.querySelectorAll<HTMLInputElement>("[data-prod]")[i];
        const cantidad = Number(input.value);
        if (cantidad <= 0 || !d.id_lote) return null;
        return {
          id_producto: d.id_producto,
          id_lote: d.id_lote,
          cantidad,
          precio_costo: d.precio_unitario,
          subtotal: cantidad * d.precio_unitario,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if (detallesFinal.length === 0) {
      toast("Indica al menos una cantidad a devolver", "error");
      return;
    }

    const total = detallesFinal.reduce((acc, d) => acc + d.subtotal, 0);
    try {
      await api.registrarDevolucion(
        {
          id_compra: idCompra,
          num_documento_prov: (overlay.querySelector("#f-nc") as HTMLInputElement).value.trim(),
          motivo: (overlay.querySelector("#f-motivo") as HTMLInputElement).value.trim() || null,
          total_devuelto: total,
          fecha_devolucion: (overlay.querySelector("#f-fecha") as HTMLInputElement).value,
        },
        detallesFinal
      );
      closeModal();
      toast("Devolución registrada y stock descontado");
      onDone();
    } catch (err) {
      toast(String(err), "error");
    }
  });
}
