import { pageContent } from "./layout";

export function renderLocked(label: string) {
  const content = pageContent();
  content.innerHTML = `
    <div class="locked-module">
      <i class="bi bi-cone-striped"></i>
      <h2>${label}</h2>
      <p>Este módulo se construye en la siguiente fase del proyecto de migración a escritorio.</p>
    </div>
  `;
}
