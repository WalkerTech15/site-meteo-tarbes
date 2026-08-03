/* Reusable accessible confirmation dialog for destructive UI actions. */
import { $ } from "../core/dom.js";

export function confirmAction({
  title,
  message,
  confirmLabel,
  cancelLabel,
  trigger,
  danger = true,
}) {
  const dialog = $("#confirmDialog");
  const confirmBtn = $("#confirmDialogConfirm");
  const cancelBtn = $("#confirmDialogCancel");

  $("#confirmDialogTitle").textContent = title;
  $("#confirmDialogMessage").textContent = message;
  confirmBtn.textContent = confirmLabel;
  cancelBtn.textContent = cancelLabel;
  confirmBtn.classList.toggle("confirm-dialog-danger", danger);
  confirmBtn.classList.toggle("confirm-dialog-primary", !danger);

  return new Promise((resolve) => {
    let settled = false;
    const cleanup = () => {
      confirmBtn.removeEventListener("click", confirm);
      cancelBtn.removeEventListener("click", cancel);
      dialog.removeEventListener("cancel", cancelDialog);
      dialog.removeEventListener("click", backdropClick);
    };
    const finish = (accepted) => {
      if (settled) return;
      settled = true;
      cleanup();
      dialog.close();
      if (!accepted && trigger?.isConnected) trigger.focus();
      resolve(accepted);
    };
    const confirm = () => finish(true);
    const cancel = () => finish(false);
    const cancelDialog = (event) => {
      event.preventDefault();
      cancel();
    };
    const backdropClick = (event) => {
      if (event.target === dialog) cancel();
    };

    confirmBtn.addEventListener("click", confirm);
    cancelBtn.addEventListener("click", cancel);
    dialog.addEventListener("cancel", cancelDialog);
    dialog.addEventListener("click", backdropClick);
    dialog.showModal();
    cancelBtn.focus();
  });
}
