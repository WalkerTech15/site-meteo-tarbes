/* Bottom toast notification. */
import { $ } from "../core/dom.js";

let toastTimer = null;
export function showToast(msg, options = {}) {
  const el = $("#toast");
  const { actionLabel, onAction, duration = actionLabel ? 6500 : 2600 } = options;
  const text = document.createElement("span");
  text.textContent = msg;
  el.replaceChildren(text);
  el.classList.toggle("has-action", Boolean(actionLabel && onAction));

  if (actionLabel && onAction) {
    const action = document.createElement("button");
    action.className = "toast-action";
    action.type = "button";
    action.textContent = actionLabel;
    action.addEventListener("click", () => {
      clearTimeout(toastTimer);
      el.hidden = true;
      onAction();
    });
    el.appendChild(action);
  }

  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, duration);
}
