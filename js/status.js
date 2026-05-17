let statusEl;

export function initStatus(el) {
  statusEl = el;
}

export function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg;
}
