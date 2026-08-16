import { api } from "../api";
import { pageContent, pageHeader } from "./layout";
import { closeModal, escapeHtml, openModal, toast } from "../ui";
import type { Auditoria, DetalleAuditoria, Producto } from "../types";

type Tab = "lotes" | "kardex" | "fisico";
let activeTab: Tab = "lotes";

export async function renderInventario() {
  const content = pageContent();
  content.innerHTML =
    pageHeader("Inventario", "Lotes (FEFO), kardex de movimientos e inventario físico") +
    `
    <div style="display:flex;gap:8px;margin-bottom:22px;">
      <button class="tab-btn" data-tab="lotes">Lotes / Vencimientos</button>
      <button class="tab-btn" data-tab="kardex">Kardex</button>
      <button class="tab-btn" data-tab="fisico">Inventario físico</button>
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
  if (activeTab === "lotes") return renderLotes();
  if (activeTab === "kardex") return renderKardex();
  return renderFisico();
}

// ---------------- Lotes ----------------

async function renderLotes() {
  const body = document.querySelector("#tab-body") as HTMLElement;
  body.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:16px;">
      <button class="btn-add" id="btn-entrada"><i class="bi bi-box-arrow-in-down"></i>Entrada manual de stock</button>
    </div>
    <div id="lotes-wrap">Cargando…</div>
  `;

  const load = async () => {
    const lotes = await api.listarLotesActivos();
    const wrap = document.querySelector("#lotes-wrap") as HTMLElement;
    if (lotes.length === 0) {
      wrap.innerHTML = '<div class="empty-state">No hay lotes activos con stock.</div>';
      return;
    }
    const hoy = new Date();
    wrap.innerHTML = `
      <table class="table-custom">
        <thead><tr><th>Producto</th><th>Lote</th><th>Vencimiento</th><th>Disponible</th><th>Inicial</th><th>Categoría</th></tr></thead>
        <tbody>
          ${lotes
            .map((l) => {
              const dias = Math.floor((new Date(l.fecha_vencimiento).getTime() - hoy.getTime()) / 86400000);
              const pill = dias < 0 ? "pill-off" : dias <= 60 ? "pill-off" : "pill-ok";
              return `<tr>
                <td>${escapeHtml(l.nombre_comercial)}</td>
                <td>${escapeHtml(l.codigo_lote)}</td>
                <td><span class="pill ${pill}">${l.fecha_vencimiento} ${dias < 0 ? "(vencido)" : `(${dias}d)`}</span></td>
                <td>${l.cantidad_disponible}</td>
                <td>${l.cantidad_inicial}</td>
                <td>${escapeHtml(l.categoria) || "—"}</td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    `;
  };

  body.querySelector("#btn-entrada")!.addEventListener("click", async () => {
    const productos = await api.listarProductos(true);
    const overlay = openModal(`
      <h3>Entrada manual de stock</h3>
      <form id="form-entrada">
        <div class="form-group">
          <label class="form-label">Producto</label>
          <select class="form-control-custom" id="f-prod" required>
            <option value="">Selecciona…</option>
            ${productos.map((p) => `<option value="${p.id}">${escapeHtml(p.nombre_comercial)}</option>`).join("")}
          </select>
        </div>
        <div class="grid-2">
          <div class="form-group"><label class="form-label">Cantidad</label><input class="form-control-custom" id="f-cant" type="number" min="1" required /></div>
          <div class="form-group"><label class="form-label">Código de lote</label><input class="form-control-custom" id="f-lote" placeholder="SIN-LOTE" /></div>
        </div>
        <div class="form-group"><label class="form-label">Fecha de vencimiento</label><input class="form-control-custom" id="f-venc" type="date" required /></div>
        <div class="form-group"><label class="form-label">Motivo</label><input class="form-control-custom" id="f-motivo" placeholder="Ej: Ajuste de stock inicial" required /></div>
        <button class="btn-primary-custom" type="submit">Registrar entrada</button>
      </form>
    `);

    overlay.querySelector("#form-entrada")!.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await api.registrarEntradaManual({
          id_producto: Number((overlay.querySelector("#f-prod") as HTMLSelectElement).value),
          cantidad: Number((overlay.querySelector("#f-cant") as HTMLInputElement).value),
          codigo_lote: (overlay.querySelector("#f-lote") as HTMLInputElement).value.trim(),
          fecha_vencimiento: (overlay.querySelector("#f-venc") as HTMLInputElement).value,
          motivo: (overlay.querySelector("#f-motivo") as HTMLInputElement).value.trim(),
        });
        closeModal();
        toast("Entrada registrada: lote creado, kardex y stock actualizados");
        load();
      } catch (err) {
        toast(String(err), "error");
      }
    });
  });

  load();
}

// ---------------- Kardex ----------------

async function renderKardex() {
  const body = document.querySelector("#tab-body") as HTMLElement;
  const productos = await api.listarProductos(true);
  body.innerHTML = `
    <div style="margin-bottom:16px;max-width:340px;">
      <select class="form-control-custom" id="f-filtro">
        <option value="">Todos los productos</option>
        ${productos.map((p) => `<option value="${p.id}">${escapeHtml(p.nombre_comercial)}</option>`).join("")}
      </select>
    </div>
    <div id="kardex-wrap">Cargando…</div>
  `;

  const load = async (idProducto: number | null) => {
    const movimientos = await api.listarKardex(idProducto);
    const wrap = document.querySelector("#kardex-wrap") as HTMLElement;
    if (movimientos.length === 0) {
      wrap.innerHTML = '<div class="empty-state">Sin movimientos registrados.</div>';
      return;
    }
    wrap.innerHTML = `
      <table class="table-custom">
        <thead><tr><th>Fecha</th><th>Producto</th><th>Tipo</th><th>Motivo</th><th>Cantidad</th><th>Saldo</th><th>Usuario</th></tr></thead>
        <tbody>
          ${movimientos
            .map((m) => {
              const signo = m.tipo_movimiento === "ENTRADA" ? "+" : m.tipo_movimiento === "SALIDA" ? "-" : "";
              const pill = m.tipo_movimiento === "ENTRADA" ? "pill-ok" : m.tipo_movimiento === "SALIDA" ? "pill-off" : "";
              return `<tr>
                <td>${m.fecha}</td>
                <td>${escapeHtml(m.nombre_comercial)}</td>
                <td><span class="pill ${pill}">${m.tipo_movimiento}</span></td>
                <td>${escapeHtml(m.motivo)}</td>
                <td>${signo}${Math.abs(m.cantidad)}</td>
                <td>${m.saldo_actual}</td>
                <td>${escapeHtml(m.usuario)}</td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    `;
  };

  body.querySelector("#f-filtro")!.addEventListener("change", (e) => {
    const v = (e.target as HTMLSelectElement).value;
    load(v ? Number(v) : null);
  });

  load(null);
}

// ---------------- Inventario físico ----------------

async function renderFisico() {
  const body = document.querySelector("#tab-body") as HTMLElement;
  body.innerHTML = `
    <div style="display:flex;justify-content:flex-end;gap:10px;margin-bottom:16px;flex-wrap:wrap;">
      <button class="btn-sm-icon" id="btn-iniciar-aleatorio" title="Toma una muestra aleatoria de productos en vez de contar todo el inventario">
        <i class="bi bi-shuffle"></i> Inventario aleatorio (muestreo)
      </button>
      <button class="btn-add" id="btn-iniciar"><i class="bi bi-clipboard-plus"></i>Iniciar nuevo conteo</button>
    </div>
    <div id="fisico-wrap">Cargando…</div>
  `;

  const loadLista = async () => {
    const auditorias = await api.listarAuditorias();
    const wrap = document.querySelector("#fisico-wrap") as HTMLElement;
    if (auditorias.length === 0) {
      wrap.innerHTML = '<div class="empty-state">Aún no se ha realizado ningún inventario físico.</div>';
      return;
    }
    wrap.innerHTML = `
      <table class="table-custom">
        <thead><tr><th>#</th><th>Inicio</th><th>Fin</th><th>Estado</th><th>Responsable</th><th>Observaciones</th><th></th></tr></thead>
        <tbody>
          ${auditorias
            .map(
              (a: Auditoria) => `
            <tr>
              <td>${a.id}</td>
              <td>${a.fecha_inicio}</td>
              <td>${a.fecha_fin || "—"}</td>
              <td><span class="pill ${a.estado === "Abierta" ? "pill-off" : a.estado === "Finalizada" ? "pill-ok" : ""}">${a.estado}</span></td>
              <td>${escapeHtml(a.usuario)}</td>
              <td>${escapeHtml(a.observaciones) || "—"}</td>
              <td style="text-align:right;white-space:nowrap;">
                <button class="btn-sm-icon" data-exportar="${a.id}" title="Exportar detalle a CSV"><i class="bi bi-file-earmark-spreadsheet"></i></button>
                <button class="btn-sm-icon" data-abrir="${a.id}"><i class="bi bi-box-arrow-up-right"></i></button>
              </td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    `;
    wrap.querySelectorAll<HTMLButtonElement>("[data-abrir]").forEach((b) =>
      b.addEventListener("click", () => renderConteo(Number(b.dataset.abrir)))
    );
    wrap.querySelectorAll<HTMLButtonElement>("[data-exportar]").forEach((b) =>
      b.addEventListener("click", async () => {
        try {
          const ruta = await api.exportarDetalleAuditoria(Number(b.dataset.exportar));
          toast(`Detalle exportado en: ${ruta}`);
        } catch (err) {
          toast(String(err), "error");
        }
      })
    );
  };

  body.querySelector("#btn-iniciar")!.addEventListener("click", () => {
    const overlay = openModal(`
      <h3>Iniciar inventario físico</h3>
      <p style="color:var(--text-secondary);font-size:14px;">
        Se tomará una "foto" del stock de todos los lotes activos en este momento. Luego podrás
        ir contando físicamente cada producto y comparar contra lo que dice el sistema.
      </p>
      <form id="form-iniciar">
        <div class="form-group">
          <label class="form-label">Tipo de inventario</label>
          <select class="form-control-custom" id="f-tipo">
            <option value="total">Total (todos los productos)</option>
            <option value="farmaceuticos">Solo Productos Farmacéuticos (clasificación DIGEMID)</option>
            <option value="sanitarios">Solo Productos Sanitarios (clasificación DIGEMID)</option>
          </select>
        </div>
        <div class="form-group"><label class="form-label">Observaciones (opcional)</label><input class="form-control-custom" id="f-obs" /></div>
        <button class="btn-primary-custom" type="submit">Iniciar conteo</button>
      </form>
    `);
    overlay.querySelector("#form-iniciar")!.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const tipo = (overlay.querySelector("#f-tipo") as HTMLSelectElement).value;
        const id = await api.iniciarAuditoria(tipo, (overlay.querySelector("#f-obs") as HTMLInputElement).value.trim());
        closeModal();
        toast("Inventario físico iniciado");
        renderConteo(id);
      } catch (err) {
        toast(String(err), "error");
      }
    });
  });

  body.querySelector("#btn-iniciar-aleatorio")!.addEventListener("click", () => {
    const overlay = openModal(`
      <h3>Inventario aleatorio (muestreo)</h3>
      <p style="color:var(--text-secondary);font-size:14px;">
        Toma una muestra aleatoria de productos activos con stock disponible, en vez de
        contar todo el inventario — útil para revisiones rápidas periódicas.
      </p>
      <form id="form-aleatorio">
        <div class="form-group"><label class="form-label">Cantidad de productos a muestrear</label><input class="form-control-custom" id="f-cant" type="number" min="1" value="30" required /></div>
        <div class="form-group"><label class="form-label">Observaciones (opcional)</label><input class="form-control-custom" id="f-obs" /></div>
        <button class="btn-primary-custom" type="submit">Iniciar muestreo</button>
      </form>
    `);
    overlay.querySelector("#form-aleatorio")!.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const cantidad = Number((overlay.querySelector("#f-cant") as HTMLInputElement).value);
        const obs = (overlay.querySelector("#f-obs") as HTMLInputElement).value.trim();
        const id = await api.iniciarAuditoriaAleatoria(cantidad, obs);
        closeModal();
        toast("Inventario aleatorio iniciado");
        renderConteo(id);
      } catch (err) {
        toast(String(err), "error");
      }
    });
  });

  loadLista();
}

async function renderConteo(idAuditoria: number) {
  const body = document.querySelector("#tab-body") as HTMLElement;
  body.innerHTML = `<div id="conteo-wrap">Cargando…</div>`;

  const load = async () => {
    const detalles = await api.detallesAuditoria(idAuditoria);
    const auditorias = await api.listarAuditorias();
    const auditoria = auditorias.find((a) => a.id === idAuditoria);
    const wrap = document.querySelector("#conteo-wrap") as HTMLElement;

    const abierta = auditoria?.estado === "Abierta";

    wrap.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <div>
          <h3 style="margin:0;">Conteo físico #${idAuditoria}</h3>
          <span style="color:var(--text-secondary);font-size:13px;">Estado: ${auditoria?.estado ?? "—"}</span>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <button class="btn-sm-icon" id="btn-volver"><i class="bi bi-arrow-left"></i> Volver</button>
          <button class="btn-sm-icon" id="btn-exportar-hoja" title="Descarga una hoja en blanco para llenar a mano mientras recorres la botica">
            <i class="bi bi-file-earmark-spreadsheet"></i> Hoja de conteo
          </button>
          ${
            abierta
              ? `<button class="btn-sm-icon" id="btn-agregar-encontrado" title="Anota un producto o lote que apareció físicamente pero no estaba en esta auditoría">
                  <i class="bi bi-plus-circle"></i> Agregar producto encontrado
                </button>`
              : ""
          }
          ${
            abierta
              ? `<button class="btn-add" id="btn-finalizar"><i class="bi bi-check2-circle"></i>Finalizar y aplicar ajustes</button>`
              : ""
          }
        </div>
      </div>
      <table class="table-custom">
        <thead><tr><th>Producto</th><th>Lote</th><th>Vence</th><th>Sistema</th><th>Físico contado</th><th>Diferencia</th></tr></thead>
        <tbody>
          ${detalles
            .map(
              (d: DetalleAuditoria) => `
            <tr>
              <td>${escapeHtml(d.nombre_comercial)}</td>
              <td>${escapeHtml(d.codigo_lote)}</td>
              <td>${d.fecha_vencimiento}</td>
              <td>${d.stock_sistema}</td>
              <td>${
                abierta
                  ? `<input type="number" min="0" class="form-control-custom" style="padding:6px 10px;width:100px;" data-lote="${d.id_lote}" value="${d.stock_fisico}" ${d.contado ? "" : ""}/>`
                  : d.stock_fisico
              }</td>
              <td>${d.contado ? d.diferencia : "—"}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    `;

    wrap.querySelector("#btn-volver")!.addEventListener("click", () => renderFisico());

    wrap.querySelector("#btn-exportar-hoja")!.addEventListener("click", async () => {
      try {
        const ruta = await api.exportarConteoAuditoria(idAuditoria);
        toast(`Hoja de conteo exportada en: ${ruta}`);
      } catch (err) {
        toast(String(err), "error");
      }
    });

    const btnAgregar = wrap.querySelector("#btn-agregar-encontrado");
    if (btnAgregar) {
      btnAgregar.addEventListener("click", () => abrirAgregarEncontrado(idAuditoria, load));
    }

    if (abierta) {
      wrap.querySelectorAll<HTMLInputElement>("[data-lote]").forEach((inp) => {
        inp.addEventListener("change", async () => {
          if (Number(inp.value) < 0) {
            toast("El stock físico no puede ser negativo", "error");
            return;
          }
          try {
            await api.guardarConteoParcial(idAuditoria, Number(inp.dataset.lote), Number(inp.value));
            toast("Conteo guardado");
          } catch (err) {
            toast(String(err), "error");
          }
        });
      });

      wrap.querySelector("#btn-finalizar")!.addEventListener("click", async () => {
        if (!confirm("Esto aplicará los ajustes de stock definitivos según lo contado. ¿Continuar?")) return;
        try {
          await api.finalizarAuditoria(idAuditoria);
          toast("Inventario físico finalizado y ajustes aplicados");
          load();
        } catch (err) {
          toast(String(err), "error");
        }
      });
    }
  };

  load();
}

// ---------------- Agregar producto/lote encontrado durante el conteo ----------------

async function abrirAgregarEncontrado(idAuditoria: number, onDone: () => void) {
  const productos = await api.listarProductos(true);

  const overlay = openModal(`
    <h3>Agregar producto encontrado</h3>
    <p style="color:var(--text-secondary);font-size:14px;">
      Para cuando un producto o lote apareció físicamente en el conteo pero no estaba en la
      auditoría al iniciarla (producto nuevo, o lote no registrado).
    </p>
    <form id="form-encontrado">
      <div class="form-group">
        <label class="form-label">Producto existente</label>
        <select class="form-control-custom" id="f-prod">
          <option value="">— Escribir uno nuevo abajo —</option>
          ${productos.map((p: Producto) => `<option value="${p.id}">${escapeHtml(p.nombre_comercial)}</option>`).join("")}
        </select>
      </div>
      <div class="grid-2">
        <div class="form-group"><label class="form-label">O nombre de producto nuevo</label><input class="form-control-custom" id="f-nombre-nuevo" /></div>
        <div class="form-group"><label class="form-label">Laboratorio (si es nuevo)</label><input class="form-control-custom" id="f-lab-nuevo" /></div>
      </div>
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Código de lote</label><input class="form-control-custom" id="f-lote" required /></div>
        <div class="form-group"><label class="form-label">Fecha de vencimiento</label><input class="form-control-custom" id="f-venc" type="date" required /></div>
      </div>
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Cantidad encontrada</label><input class="form-control-custom" id="f-cant" type="number" min="0" required /></div>
        <div class="form-group"><label class="form-label">Registro sanitario (opcional)</label><input class="form-control-custom" id="f-rs" /></div>
      </div>
      <button class="btn-primary-custom" type="submit">Agregar a la auditoría</button>
    </form>
  `);

  overlay.querySelector("#form-encontrado")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    const idProdSel = (overlay.querySelector("#f-prod") as HTMLSelectElement).value;
    const nombreNuevo = (overlay.querySelector("#f-nombre-nuevo") as HTMLInputElement).value.trim();
    if (!idProdSel && !nombreNuevo) {
      toast("Elige un producto existente o escribe el nombre de uno nuevo", "error");
      return;
    }
    try {
      const resultado = await api.agregarLoteEncontrado({
        id_auditoria: idAuditoria,
        id_producto: idProdSel ? Number(idProdSel) : null,
        nombre_producto: nombreNuevo || null,
        laboratorio: (overlay.querySelector("#f-lab-nuevo") as HTMLInputElement).value.trim() || null,
        codigo_lote: (overlay.querySelector("#f-lote") as HTMLInputElement).value.trim(),
        fecha_vencimiento: (overlay.querySelector("#f-venc") as HTMLInputElement).value,
        cantidad: Number((overlay.querySelector("#f-cant") as HTMLInputElement).value),
        registro_sanitario: (overlay.querySelector("#f-rs") as HTMLInputElement).value.trim() || null,
      });
      closeModal();
      toast(`Agregado a la auditoría (lote #${resultado.id_lote})`);
      onDone();
    } catch (err) {
      toast(String(err), "error");
    }
  });
}
