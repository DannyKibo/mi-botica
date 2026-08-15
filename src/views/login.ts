import { api } from "../api";
import { escapeHtml } from "../ui";

export function renderLogin(app: HTMLElement, onSuccess: () => void) {
  app.innerHTML = `
    <div class="login-body">
      <div class="login-card">
        <div class="login-logo"><i class="bi bi-capsule"></i>Mi Botica</div>
        <div class="login-title">Iniciar sesión</div>
        <div class="login-subtitle">Sistema de gestión de botica — versión de escritorio</div>
        <div id="login-error"></div>
        <form id="login-form">
          <div class="form-group">
            <label class="form-label">Usuario</label>
            <input class="form-control-custom" id="usuario" autocomplete="username" required />
          </div>
          <div class="form-group">
            <label class="form-label">Contraseña</label>
            <input class="form-control-custom" id="password" type="password" autocomplete="current-password" required />
          </div>
          <button class="btn-primary-custom" type="submit">Ingresar</button>
        </form>
      </div>
    </div>
  `;

  const form = app.querySelector("#login-form") as HTMLFormElement;
  const errorBox = app.querySelector("#login-error") as HTMLElement;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorBox.innerHTML = "";
    const usuario = (app.querySelector("#usuario") as HTMLInputElement).value.trim();
    const password = (app.querySelector("#password") as HTMLInputElement).value;
    try {
      await api.login(usuario, password);
      onSuccess();
    } catch (err) {
      errorBox.innerHTML = `<div class="alert-danger">${escapeHtml(String(err))}</div>`;
    }
  });
}
