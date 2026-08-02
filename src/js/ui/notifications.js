/* Bottom toast notification. */
import { $ } from "../core/dom.js";

let toastTimer = null;
export function showToast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 2600);
}
