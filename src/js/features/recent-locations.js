/* Recent searches — five entries, opt-in, minimal, erasable.
 *
 * Privacy rules encoded here rather than left to callers:
 *
 * - OFF by default. A visitor who never opens Settings never has a search
 *   history stored, so the feature cannot quietly accumulate one.
 * - Only what is needed to re-select the place: a stable id when the provider
 *   gave one, the localized names/metadata used to render the row, the
 *   coordinate and the location type. Never a weather response, never a
 *   timestamp of when you looked, never the surrounding search query.
 * - Device-geolocation fixes are refused outright. "My location" ids are
 *   coordinate-derived (core/coord-location.js), so recording them would build
 *   exactly the movement history this feature must not keep — the check is
 *   here, in the single write path, not in each caller.
 *
 * The list logic (dedup, move-to-top, cap) is pure and takes the array as an
 * argument; only the small wrapper functions at the bottom touch storage. */
import { state } from "../core/state.js";
import { getJSON, setJSON, getStr, setStr, KEYS } from "../core/storage.js";

export const RECENTS_LIMIT = 5;

/* Ids minted from a device position. Anything with this prefix is history
   about the user, not about a place they chose to look up. */
const DEVICE_ID_PREFIX = "geo-me-";

function localized(value) {
  if (value && typeof value === "object") return { en: value.en || "", fr: value.fr || "" };
  const text = typeof value === "string" ? value : "";
  return { en: text, fr: text };
}

export function isDeviceLocation(loc) {
  return typeof loc?.id === "string" && loc.id.startsWith(DEVICE_ID_PREFIX);
}

/* Identity for deduplication: the provider's stable id when there is one,
   otherwise the coordinate rounded to ~11 m so the same spot clicked twice
   collapses into one entry. */
export function recentKey(entry) {
  if (!entry) return "";
  if (entry.id) return String(entry.id);
  const lat = Number(entry.lat);
  const lon = Number(entry.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "";
  return `@${lat.toFixed(4)},${lon.toFixed(4)}`;
}

/* Project a full location object down to the stored minimum. Returns null for
   anything that isn't a usable, storable place. */
export function toRecentEntry(loc) {
  if (!loc || typeof loc !== "object") return null;
  const lat = Number(loc.lat);
  const lon = Number(loc.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (isDeviceLocation(loc)) return null;

  const name = localized(loc.name);
  if (!name.en && !name.fr) return null;

  return {
    id: loc.id ? String(loc.id) : "",
    kind: loc.kind || "city",
    lat,
    lon,
    name,
    region: localized(loc.region),
    country: localized(loc.country),
    cc: (loc.cc || "").toUpperCase(),
    regionCode: loc.regionCode || "",
  };
}

/* Expand a stored entry back into the location shape the rest of the app
   works with. The presentational extras (gradient, pin emoji) are defaults,
   not stored — they are the same for every dynamic result anyway. An
   administrative area's bbox and polygon are deliberately NOT stored, so a
   restored country/region is framed by its type-based zoom instead. */
export function recentToLocation(entry) {
  if (!entry) return null;
  return {
    id: entry.id || `recent-${entry.lat},${entry.lon}`,
    kind: entry.kind || "city",
    cc: entry.cc || "",
    flag: "📍",
    lat: entry.lat,
    lon: entry.lon,
    name: { ...entry.name },
    region: { ...entry.region },
    country: { ...entry.country },
    landmark: null,
    aliases: [],
    grad: ["#3B82F6", "#1E40AF"],
    dynamic: true,
    regionCode: entry.regionCode || "",
  };
}

/* Pure: new list with `loc` first, its previous occurrence removed, capped. */
export function addRecent(list, loc, limit = RECENTS_LIMIT) {
  const entry = toRecentEntry(loc);
  const current = Array.isArray(list) ? list : [];
  if (!entry) return current.slice(0, limit);
  const key = recentKey(entry);
  return [entry, ...current.filter((item) => recentKey(item) !== key)].slice(0, limit);
}

/* Drop anything a hand-edited or older store may contain that we would not
   write today (a device fix, a weather blob, a malformed row). */
export function sanitizeRecents(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const entry = toRecentEntry(item);
    if (!entry) continue;
    const key = recentKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
    if (out.length >= RECENTS_LIMIT) break;
  }
  return out;
}

/* ── persistence ──────────────────────────────────────────────────────── */

export function loadRecents() {
  return sanitizeRecents(getJSON(KEYS.recents, []));
}

export function isRecentsEnabled() {
  return getStr(KEYS.recentsOptIn) === "1";
}

export function setRecentsEnabled(on) {
  state.saveRecents = !!on;
  setStr(KEYS.recentsOptIn, on ? "1" : "0");
}

function persist(list) {
  state.recents = list;
  setJSON(KEYS.recents, list);
  return list;
}

/** Record a selection. A no-op while the setting is off — that is the whole
 *  point of the opt-in, so it is enforced here rather than at each call site.
 *  @returns {boolean} whether anything was stored */
export function recordRecent(loc) {
  if (!state.saveRecents) return false;
  const next = addRecent(state.recents, loc);
  if (next.length === state.recents.length && recentKey(next[0]) === recentKey(state.recents[0])) {
    /* already the most recent entry — nothing changed, skip the write */
    return false;
  }
  persist(next);
  return true;
}

/** Clear the list, returning what was there so the caller can offer Undo. */
export function clearRecents() {
  const previous = state.recents;
  persist([]);
  return previous;
}

/** Undo a clear. Re-sanitized on the way back in, so a stale snapshot can
 *  never reintroduce something we would refuse to store now. */
export function restoreRecents(list) {
  return persist(sanitizeRecents(list));
}
