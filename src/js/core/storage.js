/* Safe localStorage helpers — every read is guarded so a corrupted or
   tampered value (partial write, extension interference, manual edit) can
   never crash app startup. All the app's storage keys are named here. */

export const KEYS = {
  lang: "ws_lang",
  mode: "ws_mode",
  unitTemp: "ws_unit_t",
  unitWind: "ws_unit_w",
  legacyUnits: "ws_units", // old combined key, read-only, never written by current code
  theme: "ws_theme",
  notifs: "ws_notifs",
  favorites: "ws_favs",
  lastLocation: "ws_lastLoc",
  geo: "ws_geo",
};

export function getStr(key, fallback = null) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

export function setStr(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode, quota) — the app still works, just doesn't persist */
  }
}

export function getJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function setJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — ignore, nothing else can be done client-side */
  }
}

export function clearAll() {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
}
