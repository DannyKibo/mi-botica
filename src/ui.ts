export function toast(message: string, kind: "success" | "error" = "success") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

export function closeModal() {
  document.querySelectorAll(".modal-overlay").forEach((m) => m.remove());
}

export function openModal(innerHtml: string): HTMLElement {
  closeModal();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `<div class="modal-box">${innerHtml}</div>`;
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });
  document.body.appendChild(overlay);
  return overlay;
}

/** Como openModal, pero NO cierra los modales ya abiertos — para diálogos de "alta rápida"
 * (ej. cliente/proveedor nuevo) que se abren ENCIMA de un formulario más grande sin perder lo
 * que el usuario ya llenó ahí. Quien lo use debe cerrar este modal removiendo el elemento
 * devuelto directamente (`overlay.remove()`), nunca con `closeModal()` — eso cerraría también
 * el modal padre. */
export function openNestedModal(innerHtml: string): HTMLElement {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `<div class="modal-box">${innerHtml}</div>`;
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
  return overlay;
}

export function el(html: string): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html.trim();
  return wrapper.firstElementChild as HTMLElement;
}

export function escapeHtml(str: string | null | undefined): string {
  if (str === null || str === undefined) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
