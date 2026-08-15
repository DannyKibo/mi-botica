import { api } from "../api";
import { escapeHtml } from "../ui";

export function renderCambiarPasswordObligatorio(app: HTMLElement, onDone: () => void) {
  app.innerHTML = `
    <div class="login-body">
      <div class="login-card">
        <div class="login-logo"><i class="bi bi-shield-lock"></i>Mi Botica</div>
        <div class="login-title">Actualiza tu contraseña</div>
        <div class="login-subtitle">Por seguridad, debes definir una contraseña propia antes de continuar.</div>
        <div id="cp-error"></div>
        <form id="cp-form">
          <div class="form-group">
            <label class="form-label">Nueva contraseña</label>
            <input class="form-control-custom" id="cp-nueva" type="password" required minlength="6" />
          </div>
          <div class="form-group">
            <label class="form-label">Confirmar contraseña</label>
            <input class="form-control-custom" id="cp-confirmar" type="password" required minlength="6" />
          </div>
          <button class="btn-primary-custom" type="submit">Guardar y continuar</button>
        </form>
      </div>
    </div>
  `;

  const form = app.querySelector("#cp-form") as HTMLFormElement;
  const errorBox = app.querySelector("#cp-error") as HTMLElement;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorBox.innerHTML = "";
    const nueva = (app.querySelector("#cp-nueva") as HTMLInputElement).value;
    const confirmar = (app.querySelector("#cp-confirmar") as HTMLInputElement).value;
    try {
      await api.cambiarPassword(nueva, confirmar);
      onDone();
    } catch (err) {
      errorBox.innerHTML = `<div class="alert-danger">${escapeHtml(String(err))}</div>`;
    }
  });
}
