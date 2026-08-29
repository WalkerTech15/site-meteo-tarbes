/* Offline support: service-worker registration and the online/offline
   status the UI reports.

   Two deliberate boundaries:

   1. REGISTRATION IS PRODUCTION-ONLY. A service worker in front of `vite
      dev` fights HMR and would make the Playwright suite depend on cache
      state that varies between runs. The worker is a progressive
      enhancement — every failure path here is silent, and the app behaves
      exactly as it did before if it never registers.

   2. STATUS IS NOT THE SAME AS FRESHNESS. This module only answers "is the
      browser online right now". Whether the weather on screen is current is
      a separate question the hero already answers with "Updated · N min
      ago"; going offline switches its live pill so cached data is never
      presented as live. See updateHeroLiveStatus in ui/render-home.js. */

/* navigator.onLine is famously "connected to *a* network", not "the
   internet is reachable" — a false positive is possible. It is still the
   right signal here: everything it gates is a label, never a decision to
   skip a request, so the worst case is a pill that says Live while a fetch
   quietly fails and the app falls back to its existing demo/error path. */
export function isOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/* Subscribes to connectivity changes. Returns an unsubscribe function so a
   caller (and a test) can clean up rather than leaking listeners. */
export function bindOfflineStatus(onChange) {
  if (typeof window === "undefined") return () => {};
  const handler = () => onChange(isOffline());
  window.addEventListener("online", handler);
  window.addEventListener("offline", handler);
  return () => {
    window.removeEventListener("online", handler);
    window.removeEventListener("offline", handler);
  };
}

/* The worker lives at the deploy root (copied verbatim from public/), so
   its scope covers the whole app. Registration is fire-and-forget: a
   rejected promise here must never surface to the visitor, and must never
   block boot. */
export function registerServiceWorker({
  enabled = Boolean(import.meta.env && import.meta.env.PROD),
  scope = import.meta.env ? import.meta.env.BASE_URL : "/",
} = {}) {
  if (!enabled) return Promise.resolve(null);
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return Promise.resolve(null);
  }
  return navigator.serviceWorker.register(`${scope}sw.js`, { scope }).catch(() => null);
}

/* Asks the active worker to drop the caches it owns. Wired to the existing
   "Reset the application" action so clearing stored data really clears
   everything, not just localStorage. Safe to call when no worker exists. */
export function clearOfflineCaches() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.controller?.postMessage("clear-caches");
}
