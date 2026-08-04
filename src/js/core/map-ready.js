/* Waits for a MapLibre/MapTiler map's style to actually be ready before a
   layer add/remove is safe. `isStyleLoaded()` can read false for a moment
   even after the map's original "load" event already fired — the style
   briefly reloads sources during other operations (e.g. a language-driven
   text-field rewrite) — so a `once("load", …)` wait can hang forever, since
   "load" only ever fires once per map. "styledata" and "idle" both repeat,
   so this rechecks on either and adds a timeout as a last resort, and always
   tears down its own listeners/timer before settling — no dependency on the
   real SDK or DOM, so it's unit-testable with a plain fake map object. */
const DEFAULT_TIMEOUT_MS = 8000;

export function awaitMapReady(map, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    if (map.isStyleLoaded()) {
      resolve();
      return;
    }
    let settled = false;

    function finish(action) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      map.off("styledata", recheck);
      map.off("idle", recheck);
      map.off("error", onError);
      action();
    }
    function recheck() {
      if (map.isStyleLoaded()) finish(resolve);
    }
    function onError(e) {
      finish(() => reject(e && e.error instanceof Error ? e.error : new Error("Map error")));
    }

    const timer = setTimeout(
      () => finish(() => reject(new Error("Map readiness timed out"))),
      timeoutMs,
    );
    map.on("styledata", recheck);
    map.on("idle", recheck);
    map.on("error", onError);
  });
}
