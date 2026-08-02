/* Small reusable cache helpers shared by the API services — extracted from
   the same Map + TTL + in-flight-promise-dedup pattern that was previously
   duplicated across the weather/geocoding fetch functions. */

/* TTL cache of in-flight/settled promises, keyed by a caller-chosen string.
   A second caller for the same key while the first is still pending gets the
   SAME promise (dedup), and a settled value is reused until it expires. A
   rejected promise is evicted immediately so the next call retries. */
export function createAsyncCache(ttlMs) {
  const map = new Map();
  return {
    get(key, factory) {
      const hit = map.get(key);
      if (hit && Date.now() - hit.at < ttlMs) return hit.p;
      const p = factory();
      map.set(key, { p, at: Date.now() });
      p.catch(() => map.delete(key));
      return p;
    },
    clear() {
      map.clear();
    },
  };
}

/* Simple bounded cache (insertion-order eviction) for plain values with no
   expiry — used for the MapTiler autocomplete cache, where staleness matters
   less than keeping memory bounded. */
export function createBoundedCache(maxSize) {
  const map = new Map();
  return {
    get(key) {
      return map.get(key);
    },
    set(key, value) {
      map.set(key, value);
      if (map.size > maxSize) map.delete(map.keys().next().value);
    },
    has(key) {
      return map.has(key);
    },
  };
}
