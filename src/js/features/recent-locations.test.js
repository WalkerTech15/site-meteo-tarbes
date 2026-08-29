/* Recent searches carry the app's strictest privacy rules, so they are tested
 * as rules rather than as a list: opt-in, minimal, device-fix-free, capped,
 * deduplicated, clearable and undoable. */
import { describe, it, expect, beforeEach } from "vitest";
import { state } from "../core/state.js";
import { KEYS, getJSON, getStr } from "../core/storage.js";
import {
  RECENTS_LIMIT,
  addRecent,
  toRecentEntry,
  recentKey,
  recentToLocation,
  sanitizeRecents,
  isDeviceLocation,
  recordRecent,
  clearRecents,
  restoreRecents,
  loadRecents,
  isRecentsEnabled,
  setRecentsEnabled,
} from "./recent-locations.js";

/* Same in-memory localStorage stand-in core/storage.test.js uses — the node
   test environment has none, and the real try/catch guards should still run. */
function installFakeLocalStorage() {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
}

const place = (id, name, extra = {}) => ({
  id,
  kind: "city",
  cc: "fr",
  lat: 43.2333,
  lon: 0.0782,
  name: { en: name, fr: name },
  region: { en: "Occitania", fr: "Occitanie" },
  country: { en: "France", fr: "France" },
  ...extra,
});

beforeEach(() => {
  installFakeLocalStorage();
  state.recents = [];
  state.saveRecents = false;
});

describe("the opt-in", () => {
  it("is off for a new visitor", () => {
    expect(isRecentsEnabled()).toBe(false);
  });

  it("records nothing while it is off", () => {
    expect(recordRecent(place("mt-1", "Tarbes"))).toBe(false);
    expect(state.recents).toEqual([]);
    expect(getJSON(KEYS.recents, null)).toBeNull(); /* nothing written at all */
  });

  it("records once turned on, and stops again when turned off", () => {
    setRecentsEnabled(true);
    expect(getStr(KEYS.recentsOptIn)).toBe("1");
    expect(recordRecent(place("mt-1", "Tarbes"))).toBe(true);
    expect(state.recents).toHaveLength(1);

    setRecentsEnabled(false);
    expect(recordRecent(place("mt-2", "Lyon"))).toBe(false);
    expect(state.recents).toHaveLength(1); /* the existing entry is left alone */
  });
});

describe("what is stored", () => {
  it("keeps only the identifier, names, coordinate and type", () => {
    const entry = toRecentEntry(
      place("mt-1", "Tarbes", { regionCode: "FR-OCC", bbox: [0, 0, 1, 1], _zoom: 11 }),
    );
    /* waterKind joins the list because it cannot be re-derived on restore:
       every body of water is stored as kind "ocean", so without it a
       restored lake comes back labelled "Ocean / Sea". Still type metadata
       about the place itself — nothing about the visitor. */
    expect(Object.keys(entry).sort()).toEqual(
      [
        "cc",
        "country",
        "id",
        "kind",
        "lat",
        "lon",
        "name",
        "regionCode",
        "region",
        "waterKind",
      ].sort(),
    );
  });

  it("never stores a weather response, even if one is attached", () => {
    const entry = toRecentEntry({ ...place("mt-1", "Tarbes"), wx: { current: { temp: 21 } } });
    expect(JSON.stringify(entry)).not.toContain("temp");
  });

  it("refuses a device-geolocation fix outright", () => {
    const fix = place("geo-me-43.2333,0.0782", "43.23°, 0.08°");
    expect(isDeviceLocation(fix)).toBe(true);
    expect(toRecentEntry(fix)).toBeNull();
    setRecentsEnabled(true);
    expect(recordRecent(fix)).toBe(false);
    expect(state.recents).toEqual([]);
  });

  it("rejects anything without a usable coordinate or name", () => {
    expect(toRecentEntry(null)).toBeNull();
    expect(toRecentEntry({ ...place("mt-1", "Tarbes"), lat: "north" })).toBeNull();
    expect(toRecentEntry({ ...place("mt-1", ""), name: { en: "", fr: "" } })).toBeNull();
  });

  it("round-trips back into a usable location", () => {
    const loc = recentToLocation(toRecentEntry(place("mt-1", "Tarbes")));
    expect(loc).toMatchObject({ id: "mt-1", kind: "city", lat: 43.2333, lon: 0.0782 });
    expect(loc.name.fr).toBe("Tarbes");
  });
});

describe("dedup + limit", () => {
  it("moves a repeated location to the top instead of duplicating it", () => {
    let list = [];
    list = addRecent(list, place("mt-1", "Tarbes"));
    list = addRecent(list, place("mt-2", "Lyon"));
    list = addRecent(list, place("mt-1", "Tarbes"));
    expect(list.map((entry) => entry.id)).toEqual(["mt-1", "mt-2"]);
  });

  it("deduplicates a coordinate when the provider gave no stable id", () => {
    const noId = { ...place("", "Zone"), id: "" };
    const list = addRecent(addRecent([], noId), { ...noId, name: { en: "Zone", fr: "Zone" } });
    expect(list).toHaveLength(1);
    expect(recentKey(list[0])).toBe("@43.2333,0.0782");
  });

  it("keeps at most five entries, dropping the oldest", () => {
    let list = [];
    for (let i = 1; i <= 8; i++) {
      list = addRecent(list, place(`mt-${i}`, `City ${i}`, { lat: 40 + i, lon: i }));
    }
    expect(list).toHaveLength(RECENTS_LIMIT);
    expect(list.map((entry) => entry.id)).toEqual(["mt-8", "mt-7", "mt-6", "mt-5", "mt-4"]);
  });

  it("enforces the same cap through the recording path", () => {
    setRecentsEnabled(true);
    for (let i = 1; i <= 8; i++) {
      recordRecent(place(`mt-${i}`, `City ${i}`, { lat: 40 + i, lon: i }));
    }
    expect(state.recents).toHaveLength(RECENTS_LIMIT);
    expect(getJSON(KEYS.recents, [])).toHaveLength(RECENTS_LIMIT);
  });

  it("skips the write when the same place is re-selected immediately", () => {
    setRecentsEnabled(true);
    recordRecent(place("mt-1", "Tarbes"));
    expect(recordRecent(place("mt-1", "Tarbes"))).toBe(false);
  });
});

describe("clear + undo", () => {
  it("clears storage and hands back a snapshot that restores exactly", () => {
    setRecentsEnabled(true);
    recordRecent(place("mt-1", "Tarbes"));
    recordRecent(place("mt-2", "Lyon", { lat: 45.764, lon: 4.8357 }));
    const before = [...state.recents];

    const removed = clearRecents();
    expect(state.recents).toEqual([]);
    expect(getJSON(KEYS.recents, null)).toEqual([]);

    restoreRecents(removed);
    expect(state.recents).toEqual(before);
    expect(getJSON(KEYS.recents, null)).toEqual(before);
  });

  it("re-sanitizes on undo, so a stale snapshot cannot smuggle anything back", () => {
    restoreRecents([place("geo-me-1,2", "Home"), place("mt-1", "Tarbes")]);
    expect(state.recents.map((entry) => entry.id)).toEqual(["mt-1"]);
  });
});

describe("loading a store written earlier", () => {
  it("drops device fixes, duplicates, junk and anything past the cap", () => {
    const stored = [
      place("mt-1", "Tarbes"),
      place("geo-me-1,2", "Home"),
      place("mt-1", "Tarbes"),
      null,
      { id: "mt-x" },
      ...Array.from({ length: 9 }, (_, i) => place(`mt-b${i}`, `B${i}`, { lat: 10 + i, lon: i })),
    ];
    localStorage.setItem(KEYS.recents, JSON.stringify(stored));
    const loaded = loadRecents();
    expect(loaded).toHaveLength(RECENTS_LIMIT);
    expect(loaded.some((entry) => entry.id.startsWith("geo-me-"))).toBe(false);
  });

  it("survives a corrupted store", () => {
    localStorage.setItem(KEYS.recents, "{not json");
    expect(loadRecents()).toEqual([]);
  });

  it("sanitizeRecents tolerates a non-array", () => {
    expect(sanitizeRecents("nope")).toEqual([]);
  });
});

/* Priority 2: a recent row must not come back as a different KIND of place
   than the one that was saved. Every body of water is stored as kind
   "ocean", so waterKind is the only thing separating a lake from the open
   sea — and it used to be dropped on the way to storage, so re-opening a
   lake from Recents relabelled it "Ocean / Sea" and re-queried its photo as
   a seascape. */
describe("water bodies survive the recents round-trip", () => {
  const water = (name, waterKind) => ({
    id: `map-1,1`,
    kind: "ocean",
    waterKind,
    lat: 1,
    lon: 1,
    name: { en: name, fr: name },
    region: { en: "", fr: "" },
    country: { en: "", fr: "" },
    cc: "",
  });

  it("preserves the finer water kind through store and restore", () => {
    for (const kind of ["ocean", "sea", "gulf", "bay", "strait", "lake"]) {
      const restored = recentToLocation(toRecentEntry(water("Somewhere Wet", kind)));
      expect(restored.kind).toBe("ocean");
      expect(restored.waterKind).toBe(kind);
    }
  });

  it("restores the water gradient rather than the city one", () => {
    const restored = recentToLocation(toRecentEntry(water("Lake Superior", "lake")));
    expect(restored.grad).toEqual(["#0EA5E9", "#0C4A6E"]);
  });

  /* Rows written before waterKind was stored still carry kind "ocean" —
     they must not regress to the city gradient on restore. */
  it("still treats a legacy entry with no waterKind as water", () => {
    const legacy = recentToLocation({
      id: "map-1,1",
      kind: "ocean",
      lat: 1,
      lon: 1,
      name: { en: "Pacific Ocean", fr: "Océan Pacifique" },
      region: { en: "", fr: "" },
      country: { en: "", fr: "" },
      cc: "",
    });
    expect(legacy.grad).toEqual(["#0EA5E9", "#0C4A6E"]);
    expect(legacy.waterKind).toBeNull();
  });

  it("leaves a land location on the city gradient with no water kind", () => {
    const restored = recentToLocation(toRecentEntry(place("mt-1", "Tarbes")));
    expect(restored.grad).toEqual(["#3B82F6", "#1E40AF"]);
    expect(restored.waterKind).toBeNull();
  });
});
