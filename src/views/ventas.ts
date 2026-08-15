import { api } from "../api";
import { pageContent, pageHeader } from "./layout";
import { closeModal, escapeHtml, openModal, openNestedModal, toast } from "../ui";
import type { Cliente, DetalleVenta, Producto, VentaResumen } from "../types";

/** Alta rápida de cliente desde el POS (equivalente a ClienteController::crearRapido del
 * sistema original): disponible para cualquier rol con sesión, incluido el Técnico en
 * Farmacia, que no tiene acceso al módulo completo de Clientes. Se abre ENCIMA del POS sin
 * cerrarlo (openNestedModal), así no se pierde nada de lo que ya había en el carrito. */
async function abrirClienteRapido(onCreado: (cliente: Cliente) => void) {
  const overlay = openNestedModal(`
    <h3>Cliente nuevo (alta rápida)</h3>
    <form id="form-cliente-rapido">
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Tipo de documento</label>
          <select class="form-control-custom" id="f-tipo-doc"><option>DNI</option><option>RUC</option><option>Carnet Ext.</option></select>
        </div>
        <div class="form-group"><label class="form-label">N° Documento</label><input class="form-control-custom" id="f-num-doc" required /></div>
      </div>
      <div class="form-group"><label class="form-label">Nombres</label><input class="form-control-custom" id="f-nombres" required /></div>
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Teléfono</label><input class="form-control-custom" id="f-telefono" /></div>
        <div class="form-group"><label class="form-label">Dirección</label><input class="form-control-custom" id="f-direccion" /></div>
      </div>
      <button class="btn-primary-custom" type="submit">Guardar y usar</button>
    </form>
  `);
  overlay.querySelector("#form-cliente-rapido")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const id = await api.crearClienteRapido({
        tipo_documento: (overlay.querySelector("#f-tipo-doc") as HTMLSelectElement).value,
        num_documento: (overlay.querySelector("#f-num-doc") as HTMLInputElement).value.trim(),
        nombres: (overlay.querySelector("#f-nombres") as HTMLInputElement).value.trim(),
        telefono: (overlay.querySelector("#f-telefono") as HTMLInputElement).value.trim() || null,
        direccion: (overlay.querySelector("#f-direccion") as HTMLInputElement).value.trim() || null,
      });
      const nuevos = await api.listarClientes();
      const creado = nuevos.find((c) => c.id === id);
      overlay.remove();
      toast("Cliente creado y seleccionado");
      if (creado) onCreado(creado);
    } catch (err) {
      toast(String(err), "error");
    }
  });
}

type Tab = "pos" | "historial" | "caja";
let activeTab: Tab = "pos";

interface LineaCarrito {
  producto: Producto;
  cantidad: number;
  tipoUnidad: string; // "CAJA" o el nombre de la fracción
}

export async function renderVentas() {
  const content = pageContent();
  content.innerHTML =
    pageHeader("Ventas", "Punto de venta, historial y control de caja") +
    `
    <div style="display:flex;gap:8px;margin-bottom:22px;">
      <button class="tab-btn" data-tab="pos">Punto de venta</button>
      <button class="tab-btn" data-tab="historial">Historial</button>
      <button class="tab-btn" data-tab="caja">Caja</button>
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
  if (activeTab === "pos") return renderPos();
  if (activeTab === "historial") return renderHistorial();
  return renderCaja();
}

// ==================== Punto de Venta ====================

async function renderPos() {
  const body = document.querySelector("#tab-body") as HTMLElement;
  body.innerHTML = `Cargando…`;

  const caja = await api.cajaAbierta();
  if (!caja) {
    body.innerHTML = `
      <div class="locked-module">
        <i class="bi bi-cash-stack"></i>
        <h2>Debes aperturar tu caja antes de vender</h2>
        <div class="form-group" style="max-width:280px;margin-top:16px;">
          <label class="form-label">Monto inicial (S/)</label>
          <input class="form-control-custom" id="f-monto-inicial" type="number" step="0.01" value="0" />
        </div>
        <button class="btn-add" id="btn-abrir-caja"><i class="bi bi-unlock"></i>Aperturar caja</button>
      </div>
    `;
    body.querySelector("#btn-abrir-caja")!.addEventListener("click", async () => {
      try {
        await api.abrirCaja(Number((body.querySelector("#f-monto-inicial") as HTMLInputElement).value || 0));
        toast("Caja aperturada");
        renderPos();
      } catch (err) {
        toast(String(err), "error");
      }
    });
    return;
  }

  const [productos, clientesIniciales, config] = await Promise.all([
    api.listarProductos(true),
    api.listarClientes(),
    api.obtenerConfiguracion(),
  ]);
  const clientes: Cliente[] = clientesIniciales;
  const igvPct = Number(config["igv"] || "18");
  const puntosHabilitado = config["puntos_habilitado"] === "1";
  const puntosPorSol = Number(config["puntos_por_sol"] || "1");
  const moneda = config["moneda"] || "S/";

  const carrito: LineaCarrito[] = [];

  body.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 400px;gap:24px;align-items:start;">
      <div>
        <div class="form-group">
          <label class="form-label">Buscar producto</label>
          <input class="form-control-custom" id="f-buscar" placeholder="Nombre comercial o genérico…" />
        </div>
        <div id="lista-productos" style="max-height:520px;overflow-y:auto;"></div>
      </div>
      <div class="card-metric" style="position:sticky;top:0;">
        <h3 style="margin-top:0;font-size:16px;">Carrito</h3>
        <div id="carrito-lineas" style="max-height:260px;overflow-y:auto;margin-bottom:14px;"></div>
        <div class="form-group"><label class="form-label">Cliente</label>
          <div style="display:flex;gap:6px;">
            <select class="form-control-custom" id="f-cliente" style="flex:1;">
              ${clientes.map((c: Cliente) => `<option value="${c.id}">${escapeHtml(c.nombres)} (${escapeHtml(c.num_documento)})</option>`).join("")}
            </select>
            <button type="button" class="btn-sm-icon" id="btn-cliente-rapido" title="Cliente nuevo (alta rápida)"><i class="bi bi-person-plus"></i></button>
          </div>
        </div>
        <div id="puntos-info" style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;"></div>
        <div class="grid-2">
          <div class="form-group"><label class="form-label">Comprobante</label>
            <select class="form-control-custom" id="f-comprobante"><option>Ticket</option><option>Boleta</option><option>Factura</option></select>
          </div>
          <div class="form-group"><label class="form-label">Pago</label>
            <select class="form-control-custom" id="f-pago"><option>Efectivo</option><option>Tarjeta</option><option>Yape/Plin</option></select>
          </div>
        </div>
        <div class="grid-2">
          <div class="form-group"><label class="form-label">Descuento (${moneda})</label><input class="form-control-custom" id="f-descuento" type="number" step="0.01" value="0" /></div>
          <div class="form-group"><label class="form-label">Recibido (${moneda})</label><input class="form-control-custom" id="f-recibido" type="number" step="0.01" value="0" /></div>
        </div>
        <div class="form-group"><label class="form-label">N° Receta / CMP médico (si aplica)</label><input class="form-control-custom" id="f-cmp" /></div>
        <div style="border-top:1px solid var(--border-color);padding-top:12px;margin-top:6px;font-size:14px;">
          <div style="display:flex;justify-content:space-between;"><span>Subtotal</span><span id="r-subtotal">${moneda} 0.00</span></div>
          <div style="display:flex;justify-content:space-between;color:var(--text-secondary);"><span>IGV (${igvPct}% ref)</span><span id="r-igv">${moneda} 0.00</span></div>
          <div style="display:flex;justify-content:space-between;"><span>Vuelto</span><span id="r-vuelto">${moneda} 0.00</span></div>
          <div style="display:flex;justify-content:space-between;font-size:20px;font-weight:700;margin-top:6px;"><span>Total</span><span id="r-total">${moneda} 0.00</span></div>
        </div>
        <button class="btn-primary-custom" id="btn-cobrar" style="margin-top:16px;"><i class="bi bi-check2-circle"></i> Cobrar</button>
      </div>
    </div>
  `;

  const pintarProductos = (filtro: string) => {
    const f = filtro.trim().toLowerCase();
    const filtrados = productos.filter(
      (p: Producto) =>
        !f || p.nombre_comercial.toLowerCase().includes(f) || p.nombre_generico.toLowerCase().includes(f) || (p.codigo_barras || "").includes(f)
    );
    const wrap = body.querySelector("#lista-productos") as HTMLElement;
    wrap.innerHTML = filtrados
      .slice(0, 40)
      .map(
        (p: Producto) => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border-color);">
        <div>
          <strong>${escapeHtml(p.nombre_comercial)}</strong> ${p.requiere_receta ? '<i class="bi bi-file-medical" style="color:var(--warning)" title="Requiere receta"></i>' : ""}<br/>
          <span style="font-size:12px;color:var(--text-secondary);">Stock: ${p.stock_actual} · ${moneda} ${p.precio_venta.toFixed(2)}${p.fraccionable ? ` / ${moneda} ${p.precio_fraccion.toFixed(2)} x ${escapeHtml(p.unidad_fraccion) || "unidad"}` : ""}</span>
        </div>
        <button type="button" class="btn-sm-icon" data-add="${p.id}"><i class="bi bi-plus-circle" style="font-size:20px;"></i></button>
      </div>`
      )
      .join("");
    wrap.querySelectorAll<HTMLButtonElement>("[data-add]").forEach((b) =>
      b.addEventListener("click", () => {
        const p = productos.find((x: Producto) => x.id === Number(b.dataset.add))!;
        const existente = carrito.find((l) => l.producto.id === p.id && l.tipoUnidad === "CAJA");
        if (existente) existente.cantidad += 1;
        else carrito.push({ producto: p, cantidad: 1, tipoUnidad: "CAJA" });
        pintarCarrito();
      })
    );
  };

  const precioLinea = (l: LineaCarrito) => (l.tipoUnidad === "CAJA" ? l.producto.precio_venta : l.producto.precio_fraccion);

  const pintarCarrito = () => {
    const wrap = body.querySelector("#carrito-lineas") as HTMLElement;
    if (carrito.length === 0) {
      wrap.innerHTML = '<div style="color:var(--text-secondary);font-size:13px;">Carrito vacío — agrega productos de la lista.</div>';
    } else {
      wrap.innerHTML = carrito
        .map(
          (l, i) => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border-color);font-size:13px;">
          <div style="flex:1;">
            <div>${escapeHtml(l.producto.nombre_comercial)}</div>
            <div style="display:flex;gap:6px;margin-top:4px;align-items:center;">
              <input type="number" min="1" value="${l.cantidad}" data-cant="${i}" style="width:55px;padding:4px 6px;border-radius:6px;border:1px solid var(--border-color);" />
              ${
                l.producto.fraccionable
                  ? `<select data-unidad="${i}" style="padding:4px 6px;border-radius:6px;border:1px solid var(--border-color);">
                       <option value="CAJA" ${l.tipoUnidad === "CAJA" ? "selected" : ""}>Caja</option>
                       <option value="${escapeHtml(l.producto.unidad_fraccion) || "Unidad"}" ${l.tipoUnidad !== "CAJA" ? "selected" : ""}>${escapeHtml(l.producto.unidad_fraccion) || "Unidad"}</option>
                     </select>`
                  : ""
              }
              <span style="margin-left:auto;">${moneda} ${(precioLinea(l) * l.cantidad).toFixed(2)}</span>
              <button type="button" class="btn-sm-icon danger" data-del="${i}"><i class="bi bi-x-lg"></i></button>
            </div>
          </div>
        </div>`
        )
        .join("");
    }

    wrap.querySelectorAll<HTMLInputElement>("[data-cant]").forEach((inp) =>
      inp.addEventListener("input", () => {
        carrito[Number(inp.dataset.cant)].cantidad = Math.max(1, Number(inp.value) || 1);
        recalcular();
      })
    );
    wrap.querySelectorAll<HTMLSelectElement>("[data-unidad]").forEach((sel) =>
      sel.addEventListener("change", () => {
        carrito[Number(sel.dataset.unidad)].tipoUnidad = sel.value;
        pintarCarrito();
      })
    );
    wrap.querySelectorAll<HTMLButtonElement>("[data-del]").forEach((b) =>
      b.addEventListener("click", () => {
        carrito.splice(Number(b.dataset.del), 1);
        pintarCarrito();
      })
    );
    recalcular();
  };

  const clienteSeleccionado = () => clientes.find((c: Cliente) => c.id === Number((body.querySelector("#f-cliente") as HTMLSelectElement).value));

  const recalcular = () => {
    const sumaLineas = carrito.reduce((acc, l) => acc + precioLinea(l) * l.cantidad, 0);
    const descuento = Number((body.querySelector("#f-descuento") as HTMLInputElement).value || 0);
    const total = Math.max(0, sumaLineas - descuento);
    const factorIgv = igvPct / 100 + 1;
    const subtotal = total / factorIgv;
    const igv = total - subtotal;
    const recibido = Number((body.querySelector("#f-recibido") as HTMLInputElement).value || 0);
    const vuelto = Math.max(0, recibido - total);

    (body.querySelector("#r-subtotal") as HTMLElement).textContent = `${moneda} ${subtotal.toFixed(2)}`;
    (body.querySelector("#r-igv") as HTMLElement).textContent = `${moneda} ${igv.toFixed(2)}`;
    (body.querySelector("#r-vuelto") as HTMLElement).textContent = `${moneda} ${vuelto.toFixed(2)}`;
    (body.querySelector("#r-total") as HTMLElement).textContent = `${moneda} ${total.toFixed(2)}`;

    const cli = clienteSeleccionado();
    const puntosInfo = body.querySelector("#puntos-info") as HTMLElement;
    if (puntosHabilitado && cli && cli.id !== 1) {
      const ganados = Math.floor(total * puntosPorSol);
      puntosInfo.textContent = `Puntos actuales: ${cli.puntos_acumulados} · Ganará: ${ganados} con esta venta.`;
    } else {
      puntosInfo.textContent = "";
    }
  };

  body.querySelector("#f-buscar")!.addEventListener("input", (e) => pintarProductos((e.target as HTMLInputElement).value));
  body.querySelector("#f-descuento")!.addEventListener("input", recalcular);
  body.querySelector("#f-recibido")!.addEventListener("input", recalcular);
  body.querySelector("#f-cliente")!.addEventListener("change", recalcular);
  body.querySelector("#btn-cliente-rapido")!.addEventListener("click", () => {
    abrirClienteRapido((creado) => {
      clientes.push(creado);
      const sel = body.querySelector("#f-cliente") as HTMLSelectElement;
      sel.innerHTML = clientes.map((c: Cliente) => `<option value="${c.id}">${escapeHtml(c.nombres)} (${escapeHtml(c.num_documento)})</option>`).join("");
      sel.value = String(creado.id);
      recalcular();
    });
  });

  body.querySelector("#btn-cobrar")!.addEventListener("click", async () => {
    if (carrito.length === 0) {
      toast("El carrito está vacío", "error");
      return;
    }
    const sumaLineas = carrito.reduce((acc, l) => acc + precioLinea(l) * l.cantidad, 0);
    const descuento = Number((body.querySelector("#f-descuento") as HTMLInputElement).value || 0);
    const total = Math.max(0, sumaLineas - descuento);
    const factorIgv = igvPct / 100 + 1;
    const subtotal = total / factorIgv;
    const igv = total - subtotal;
    const recibido = Number((body.querySelector("#f-recibido") as HTMLInputElement).value || 0);
    const vuelto = Math.max(0, recibido - total);

    try {
      const idVenta = await api.registrarVenta(
        {
          id_cliente: Number((body.querySelector("#f-cliente") as HTMLSelectElement).value),
          tipo_comprobante: (body.querySelector("#f-comprobante") as HTMLSelectElement).value,
          subtotal,
          descuento,
          igv,
          total,
          metodo_pago: (body.querySelector("#f-pago") as HTMLSelectElement).value,
          pago_recibido: recibido || total,
          vuelto,
          puntos_usados: 0,
          medico_cmp: (body.querySelector("#f-cmp") as HTMLInputElement).value.trim() || null,
        },
        carrito.map((l) => ({
          id_producto: l.producto.id!,
          cantidad: l.cantidad,
          precio_unitario: precioLinea(l),
          tipo_unidad: l.tipoUnidad,
          id_lote: null,
        }))
      );
      toast(`Venta #${idVenta} registrada correctamente`);
      renderPos();
    } catch (err) {
      toast(String(err), "error");
    }
  });

  pintarProductos("");
  pintarCarrito();
}

// ==================== Historial ====================

async function renderHistorial() {
  const body = document.querySelector("#tab-body") as HTMLElement;
  body.innerHTML = "Cargando…";
  const ventas = await api.listarVentas();
  if (ventas.length === 0) {
    body.innerHTML = '<div class="empty-state">Aún no hay ventas registradas.</div>';
    return;
  }
  body.innerHTML = `
    <table class="table-custom">
      <thead><tr><th>Fecha</th><th>Cliente</th><th>Comprobante</th><th>Total</th><th>Pago</th><th>Estado</th><th></th></tr></thead>
      <tbody>
        ${ventas
          .map(
            (v: VentaResumen) => `
          <tr>
            <td>${v.fecha_venta}</td>
            <td>${escapeHtml(v.cliente)}</td>
            <td>${escapeHtml(v.tipo_comprobante)} ${escapeHtml(v.serie_comprobante) || "T001"}-${escapeHtml(v.num_comprobante)}</td>
            <td>S/ ${v.total.toFixed(2)}</td>
            <td>${escapeHtml(v.metodo_pago)}</td>
            <td><span class="pill ${v.estado === "Anulada" ? "pill-off" : "pill-ok"}">${escapeHtml(v.estado)}</span></td>
            <td style="text-align:right;white-space:nowrap;">
              <button class="btn-sm-icon" data-ver="${v.id}"><i class="bi bi-eye"></i></button>
              ${v.estado !== "Anulada" ? `<button class="btn-sm-icon danger" data-anular="${v.id}"><i class="bi bi-x-circle"></i></button>` : ""}
            </td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>
  `;

  body.querySelectorAll<HTMLButtonElement>("[data-ver]").forEach((b) =>
    b.addEventListener("click", async () => {
      const detalles = await api.detallesVenta(Number(b.dataset.ver));
      openModal(`
        <h3>Detalle de venta #${b.dataset.ver}</h3>
        <table class="table-custom">
          <thead><tr><th>Producto</th><th>Cant.</th><th>Unidad</th><th>P. Unit.</th><th>Subtotal</th></tr></thead>
          <tbody>
            ${detalles.map((d: DetalleVenta) => `<tr><td>${escapeHtml(d.nombre_comercial)}</td><td>${d.cantidad}</td><td>${escapeHtml(d.tipo_unidad) || "—"}</td><td>S/ ${d.precio_unitario.toFixed(2)}</td><td>S/ ${d.subtotal.toFixed(2)}</td></tr>`).join("")}
          </tbody>
        </table>
      `);
    })
  );
  body.querySelectorAll<HTMLButtonElement>("[data-anular]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!confirm("¿Anular esta venta? El stock se devolverá al inventario.")) return;
      try {
        await api.anularVenta(Number(b.dataset.anular));
        toast("Venta anulada, stock devuelto");
        renderHistorial();
      } catch (err) {
        toast(String(err), "error");
      }
    })
  );
}

// ==================== Caja ====================

async function renderCaja() {
  const body = document.querySelector("#tab-body") as HTMLElement;
  body.innerHTML = "Cargando…";
  const caja = await api.cajaAbierta();

  if (!caja) {
    const hoy = new Date().toISOString().slice(0, 10);
    const historial = await api.historialCajas(hoy, hoy);
    body.innerHTML = `
      <div class="empty-state" style="margin-bottom:20px;">No tienes una caja abierta actualmente.</div>
      ${
        historial.length
          ? `<h3 style="font-size:15px;">Cajas de hoy</h3>
             <table class="table-custom"><thead><tr><th>Apertura</th><th>Cierre</th><th>Inicial</th><th>Esperado</th><th>Real</th><th>Diferencia</th></tr></thead>
             <tbody>${historial
               .map(
                 (c) => `<tr><td>${c.fecha_apertura}</td><td>${c.fecha_cierre || "—"}</td><td>S/ ${c.monto_inicial.toFixed(2)}</td><td>${c.monto_final_esperado != null ? "S/ " + c.monto_final_esperado.toFixed(2) : "—"}</td><td>${c.monto_final_real != null ? "S/ " + c.monto_final_real.toFixed(2) : "—"}</td><td>${c.diferencia != null ? "S/ " + c.diferencia.toFixed(2) : "—"}</td></tr>`
               )
               .join("")}</tbody></table>`
          : ""
      }
    `;
    return;
  }

  const resumen = await api.resumenCaja(caja.id);
  const movimientos = await api.movimientosCaja(caja.id);
  const esperado = caja.monto_inicial + resumen.ingresos_efectivo + resumen.ingresos_extras - resumen.egresos;

  body.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px;">
      <div class="card-metric"><div class="metric-title">Monto inicial</div><div class="metric-value" style="font-size:22px;">S/ ${caja.monto_inicial.toFixed(2)}</div></div>
      <div class="card-metric"><div class="metric-title">Ventas efectivo</div><div class="metric-value" style="font-size:22px;">S/ ${resumen.ingresos_efectivo.toFixed(2)}</div></div>
      <div class="card-metric"><div class="metric-title">Ventas transferencia/tarjeta</div><div class="metric-value" style="font-size:22px;">S/ ${resumen.ingresos_transferencia.toFixed(2)}</div></div>
      <div class="card-metric"><div class="metric-title">Esperado en caja</div><div class="metric-value" style="font-size:22px;">S/ ${esperado.toFixed(2)}</div></div>
    </div>

    <div style="display:flex;gap:10px;margin-bottom:20px;">
      <button class="btn-add" id="btn-movimiento"><i class="bi bi-arrow-left-right"></i>Registrar ingreso/egreso</button>
      <button class="btn-sm-icon" id="btn-cerrar" style="border:1px solid var(--danger);color:var(--danger);"><i class="bi bi-lock"></i> Cerrar caja</button>
    </div>

    <h3 style="font-size:15px;">Movimientos manuales</h3>
    ${
      movimientos.length === 0
        ? '<div class="empty-state">Sin movimientos manuales.</div>'
        : `<table class="table-custom"><thead><tr><th>Fecha</th><th>Tipo</th><th>Motivo</th><th>Monto</th></tr></thead>
           <tbody>${movimientos.map((m) => `<tr><td>${m.fecha_movimiento}</td><td><span class="pill ${m.tipo === "INGRESO" ? "pill-ok" : "pill-off"}">${m.tipo}</span></td><td>${escapeHtml(m.motivo)}</td><td>S/ ${m.monto.toFixed(2)}</td></tr>`).join("")}</tbody></table>`
    }
  `;

  body.querySelector("#btn-movimiento")!.addEventListener("click", () => {
    const overlay = openModal(`
      <h3>Registrar movimiento de caja</h3>
      <form id="form-mov">
        <div class="form-group"><label class="form-label">Tipo</label>
          <select class="form-control-custom" id="f-tipo"><option value="INGRESO">Ingreso</option><option value="EGRESO">Egreso</option></select>
        </div>
        <div class="form-group"><label class="form-label">Monto (S/)</label><input class="form-control-custom" id="f-monto" type="number" step="0.01" required /></div>
        <div class="form-group"><label class="form-label">Motivo</label><input class="form-control-custom" id="f-motivo" required /></div>
        <button class="btn-primary-custom" type="submit">Registrar</button>
      </form>
    `);
    overlay.querySelector("#form-mov")!.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await api.registrarMovimientoCaja(
          caja.id,
          (overlay.querySelector("#f-tipo") as HTMLSelectElement).value,
          Number((overlay.querySelector("#f-monto") as HTMLInputElement).value),
          (overlay.querySelector("#f-motivo") as HTMLInputElement).value.trim()
        );
        closeModal();
        toast("Movimiento registrado");
        renderCaja();
      } catch (err) {
        toast(String(err), "error");
      }
    });
  });

  body.querySelector("#btn-cerrar")!.addEventListener("click", () => {
    const overlay = openModal(`
      <h3>Cerrar caja</h3>
      <p style="color:var(--text-secondary);font-size:14px;">Monto esperado en caja: <strong>S/ ${esperado.toFixed(2)}</strong></p>
      <form id="form-cierre">
        <div class="form-group"><label class="form-label">Monto real contado (S/)</label><input class="form-control-custom" id="f-real" type="number" step="0.01" required /></div>
        <div class="form-group"><label class="form-label">Observación</label><input class="form-control-custom" id="f-obs" /></div>
        <button class="btn-primary-custom" type="submit">Confirmar cierre</button>
      </form>
    `);
    overlay.querySelector("#form-cierre")!.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await api.cerrarCaja(
          caja.id,
          Number((overlay.querySelector("#f-real") as HTMLInputElement).value),
          (overlay.querySelector("#f-obs") as HTMLInputElement).value.trim() || null
        );
        closeModal();
        toast("Caja cerrada correctamente");
        renderCaja();
      } catch (err) {
        toast(String(err), "error");
      }
    });
  });
}
