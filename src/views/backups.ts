import { api } from "../api";
import { pageContent, pageHeader } from "./layout";
import { closeModal, escapeHtml, openModal, toast } from "../ui";

export async function renderBackups() {
  const content = pageContent();
  content.innerHTML =
    pageHeader("Copias de Seguridad", "Respalda, restaura o prepara el sistema para entregarlo a un cliente nuevo") +
    `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px;">
      <div id="ruta-carpeta" style="color:var(--text-secondary);font-size:13px;"></div>
      <div style="display:flex;gap:10px;">
        <button class="btn-sm-icon danger" id="btn-vaciar" title="Preparar para entrega"><i class="bi bi-eraser"></i> Preparar para entrega</button>
        <button class="btn-add" id="btn-generar"><i class="bi bi-hdd-network"></i> Generar backup ahora</button>
      </div>
    </div>
    <div id="backups-wrap">Cargando…</div>
  `;

  const user = await api.currentUser();
  const esAdmin = user?.rol_id === 1;
  const btnVaciar = content.querySelector("#btn-vaciar") as HTMLButtonElement;
  if (!esAdmin) btnVaciar.style.display = "none";

  api.carpetaBackupsRuta().then((ruta) => {
    (content.querySelector("#ruta-carpeta") as HTMLElement).innerHTML = `<i class="bi bi-folder2-open"></i> Carpeta: <code>${escapeHtml(ruta)}</code>`;
  });

  const load = async () => {
    const items = await api.listarBackups();
    const wrap = document.querySelector("#backups-wrap") as HTMLElement;
    if (items.length === 0) {
      wrap.innerHTML = '<div class="empty-state">Aún no se ha generado ningún backup.</div>';
      return;
    }
    wrap.innerHTML = `
      <table class="table-custom">
        <thead><tr><th>Archivo</th><th>Fecha</th><th>Tamaño</th><th></th></tr></thead>
        <tbody>
          ${items
            .map(
              (b) => `
            <tr>
              <td>${escapeHtml(b.nombre)}</td>
              <td>${escapeHtml(b.fecha)}</td>
              <td>${b.tamano_kb} KB</td>
              <td style="text-align:right;"><button class="btn-sm-icon" data-restaurar="${escapeHtml(b.nombre)}"><i class="bi bi-arrow-counterclockwise"></i> Restaurar</button></td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    `;
    wrap.querySelectorAll<HTMLButtonElement>("[data-restaurar]").forEach((b) =>
      b.addEventListener("click", () => abrirRestaurar(b.dataset.restaurar!))
    );
  };

  content.querySelector("#btn-generar")!.addEventListener("click", async () => {
    try {
      const nombre = await api.generarBackup();
      toast(`Backup generado: ${nombre}`);
      load();
    } catch (err) {
      toast(String(err), "error");
    }
  });

  const abrirRestaurar = (nombre: string) => {
    const overlay = openModal(`
      <h3>Restaurar backup</h3>
      <p style="color:var(--text-secondary);font-size:14px;">
        Vas a reemplazar <strong>toda la base de datos actual</strong> por el contenido de
        <code>${escapeHtml(nombre)}</code>. Antes de hacerlo se guardará un respaldo automático
        del estado actual, por si esto fue un error. Al terminar, la sesión se cerrará y deberás
        volver a iniciar sesión.
      </p>
      <form id="form-restaurar">
        <div class="form-group">
          <label class="form-label">Escribe <strong>RESTAURAR</strong> para confirmar</label>
          <input class="form-control-custom" id="f-confirm" required />
        </div>
        <button class="btn-primary-custom" type="submit" style="background:var(--danger);border-color:var(--danger);">Restaurar ahora</button>
      </form>
    `);
    overlay.querySelector("#form-restaurar")!.addEventListener("submit", async (e) => {
      e.preventDefault();
      const confirmacion = (overlay.querySelector("#f-confirm") as HTMLInputElement).value.trim();
      try {
        await api.restaurarBackup(nombre, confirmacion);
        closeModal();
        toast("Base de datos restaurada. Vuelve a iniciar sesión.");
        setTimeout(() => window.location.reload(), 1200);
      } catch (err) {
        toast(String(err), "error");
      }
    });
  };

  btnVaciar.addEventListener("click", () => {
    const overlay = openModal(`
      <h3><i class="bi bi-exclamation-triangle" style="color:var(--danger);"></i> Preparar sistema para entrega</h3>
      <p style="color:var(--text-secondary);font-size:14px;">
        Esto borra permanentemente productos, ventas, compras, inventario, clientes de prueba
        y cuentas de usuario que no sean Administrador — dejando el sistema como recién
        instalado, listo para un cliente nuevo. Se genera un backup automático antes de vaciar,
        por si necesitas recuperar los datos de prueba.
      </p>
      <form id="form-vaciar">
        <div class="form-group">
          <label class="form-label">Escribe <strong>VACIAR SISTEMA</strong> para confirmar</label>
          <input class="form-control-custom" id="f-confirm" required />
        </div>
        <button class="btn-primary-custom" type="submit" style="background:var(--danger);border-color:var(--danger);">Vaciar sistema</button>
      </form>
    `);
    overlay.querySelector("#form-vaciar")!.addEventListener("submit", async (e) => {
      e.preventDefault();
      const confirmacion = (overlay.querySelector("#f-confirm") as HTMLInputElement).value.trim();
      try {
        await api.vaciarSistema(confirmacion);
        closeModal();
        toast("Sistema vaciado y listo para entregar. Vuelve a iniciar sesión.");
        setTimeout(() => window.location.reload(), 1200);
      } catch (err) {
        toast(String(err), "error");
      }
    });
  });

  load();
}
