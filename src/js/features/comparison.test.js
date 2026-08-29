/* Comparison selection rules: the cap, persistence, deduplication, and the
 * pruning that keeps a removed favorite from lingering. The batched fetch
 * has its own coverage below; the formatting half lives in
 * ui/render-comparison.test.js. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { state } from "../core/state.js";
import { KEYS } from "../core/storage.js";
import {
  MAX_COMPARISON,
  COMPARISON_METRICS,
  loadComparison,
  isCompared,
  comparisonFull,
  toggleComparison,
  removeFromComparison,
  clearComparison,
  comparableLocations,
  comparisonLocations,
  pruneComparison,
  loadComparisonWeather,
  comparisonWx,
  __resetComparisonForTests,
} from "./comparison.js";

const loc = (id, over = {}) => ({
  id,
  kind: "city",
  lat: 1,
  lon: 2,
  name: { en: id, fr: id },
  region: { en: "", fr: "" },
  country: { en: "France", fr: "France" },
  ...over,
});

const PARIS = loc("paris");
const TOKYO = loc("tokyo");
const LIMA = loc("lima");
const OSLO = loc("oslo");
const CAIRO = loc("cairo");

let store;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  store = {};
  vi.stubGlobal("localStorage", {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
    removeItem: (k) => delete store[k],
  });
  state.comparison = [];
  state.favorites = [];
  state.loc = null;
  __resetComparisonForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.fetch = originalFetch;
});

describe("loadComparison — sanitizing what comes back from storage", () => {
  it("returns an empty list for a visitor who never compared anything", () => {
    expect(loadComparison()).toEqual([]);
  });

  it("keeps only string ids", () => {
    store[KEYS.comparison] = JSON.stringify(["paris", 42, null, { id: "x" }, "tokyo", ""]);
    expect(loadComparison()).toEqual(["paris", "tokyo"]);
  });

  it("truncates a hand-edited list longer than the cap", () => {
    store[KEYS.comparison] = JSON.stringify(["a", "b", "c", "d", "e", "f"]);
    expect(loadComparison()).toHaveLength(MAX_COMPARISON);
  });

  it("survives a non-array value without throwing", () => {
    store[KEYS.comparison] = JSON.stringify({ nope: true });
    expect(loadComparison()).toEqual([]);
  });
});

describe("toggleComparison", () => {
  beforeEach(() => {
    state.favorites = [PARIS, TOKYO, LIMA, OSLO, CAIRO];
  });

  it("adds, then removes, reporting which happened", () => {
    expect(toggleComparison(PARIS)).toBe("added");
    expect(isCompared(PARIS)).toBe(true);
    expect(toggleComparison(PARIS)).toBe("removed");
    expect(isCompared(PARIS)).toBe(false);
  });

  it("persists every change", () => {
    toggleComparison(PARIS);
    expect(JSON.parse(store[KEYS.comparison])).toEqual(["paris"]);
    toggleComparison(TOKYO);
    expect(JSON.parse(store[KEYS.comparison])).toEqual(["paris", "tokyo"]);
    toggleComparison(PARIS);
    expect(JSON.parse(store[KEYS.comparison])).toEqual(["tokyo"]);
  });

  it("refuses to exceed the cap, and says so instead of failing silently", () => {
    for (const l of [PARIS, TOKYO, LIMA, OSLO]) expect(toggleComparison(l)).toBe("added");
    expect(comparisonFull()).toBe(true);
    expect(toggleComparison(CAIRO)).toBe("full");
    expect(state.comparison).toHaveLength(MAX_COMPARISON);
  });

  it("still lets an already-selected place be removed at the cap", () => {
    for (const l of [PARIS, TOKYO, LIMA, OSLO]) toggleComparison(l);
    expect(toggleComparison(PARIS)).toBe("removed");
    expect(comparisonFull()).toBe(false);
  });

  it("is total on a malformed location", () => {
    expect(toggleComparison(null)).toBe("full");
    expect(toggleComparison({})).toBe("full");
    expect(state.comparison).toEqual([]);
  });
});

describe("removeFromComparison / clearComparison", () => {
  beforeEach(() => {
    state.favorites = [PARIS, TOKYO, LIMA];
    for (const l of [PARIS, TOKYO, LIMA]) toggleComparison(l);
  });

  it("removes one by id and persists", () => {
    removeFromComparison("tokyo");
    expect(state.comparison).toEqual(["paris", "lima"]);
    expect(JSON.parse(store[KEYS.comparison])).toEqual(["paris", "lima"]);
  });

  it("ignores an id that is not selected", () => {
    removeFromComparison("nowhere");
    expect(state.comparison).toEqual(["paris", "tokyo", "lima"]);
  });

  it("clears everything", () => {
    clearComparison();
    expect(state.comparison).toEqual([]);
    expect(JSON.parse(store[KEYS.comparison])).toEqual([]);
  });
});

describe("comparableLocations", () => {
  it("offers the current location first, then favorites", () => {
    state.loc = LIMA;
    state.favorites = [PARIS, TOKYO];
    expect(comparableLocations().map((l) => l.id)).toEqual(["lima", "paris", "tokyo"]);
  });

  it("never lists the current location twice when it is also a favorite", () => {
    state.loc = PARIS;
    state.favorites = [PARIS, TOKYO];
    expect(comparableLocations().map((l) => l.id)).toEqual(["paris", "tokyo"]);
  });

  it("is empty when nothing is selected or saved", () => {
    expect(comparableLocations()).toEqual([]);
  });
});

describe("comparisonLocations", () => {
  it("resolves ids in the order they were added", () => {
    state.favorites = [PARIS, TOKYO, LIMA];
    toggleComparison(LIMA);
    toggleComparison(PARIS);
    expect(comparisonLocations().map((l) => l.id)).toEqual(["lima", "paris"]);
  });

  it("silently drops an id whose place is gone", () => {
    state.favorites = [PARIS, TOKYO];
    toggleComparison(PARIS);
    toggleComparison(TOKYO);
    state.favorites = [PARIS]; /* Tokyo un-favourited elsewhere */
    expect(comparisonLocations().map((l) => l.id)).toEqual(["paris"]);
  });
});

describe("pruneComparison", () => {
  it("drops unresolvable ids from state and storage", () => {
    state.favorites = [PARIS, TOKYO];
    toggleComparison(PARIS);
    toggleComparison(TOKYO);
    state.favorites = [PARIS];

    expect(pruneComparison()).toBe(true);
    expect(state.comparison).toEqual(["paris"]);
    expect(JSON.parse(store[KEYS.comparison])).toEqual(["paris"]);
  });

  it("reports no change when everything still resolves", () => {
    state.favorites = [PARIS];
    toggleComparison(PARIS);
    expect(pruneComparison()).toBe(false);
    expect(state.comparison).toEqual(["paris"]);
  });
});

describe("COMPARISON_METRICS", () => {
  it("covers every metric the feature promises, with no duplicates", () => {
    expect(COMPARISON_METRICS).toEqual([
      "temperature",
      "feelsLike",
      "humidity",
      "wind",
      "precipitation",
      "uv",
      "airQuality",
      "localTime",
    ]);
    expect(new Set(COMPARISON_METRICS).size).toBe(COMPARISON_METRICS.length);
  });
});

describe("loadComparisonWeather", () => {
  const weatherPayload = (temp) => ({
    timezone: "Europe/Paris",
    current: {
      temperature_2m: temp,
      apparent_temperature: temp - 1,
      relative_humidity_2m: 55,
      wind_speed_10m: 12,
      weather_code: 1,
      is_day: 1,
    },
    daily: { precipitation_probability_max: [30], uv_index_max: [4] },
  });

  function stubFetch(handler) {
    const calls = [];
    globalThis.fetch = vi.fn(async (url) => {
      calls.push(String(url));
      return handler(String(url));
    });
    return calls;
  }

  const ok = (body) => ({ ok: true, status: 200, json: async () => body });

  beforeEach(() => {
    state.favorites = [PARIS, TOKYO];
    toggleComparison(PARIS);
    toggleComparison(TOKYO);
  });

  it("batches every selected place into one weather call and one air-quality call", async () => {
    const calls = stubFetch((url) =>
      url.includes("air-quality")
        ? ok([{ current: { european_aqi: 21 } }, { current: { european_aqi: 42 } }])
        : ok([weatherPayload(20), weatherPayload(30)]),
    );
    const wx = await loadComparisonWeather(true);

    expect(calls).toHaveLength(2);
    expect(calls.some((u) => u.includes("latitude=1%2C1"))).toBe(true);
    expect(wx.paris.temp).toBe(20);
    expect(wx.tokyo.temp).toBe(30);
    expect(wx.paris.aqi).toBe(21);
    expect(wx.tokyo.aqi).toBe(42);
    expect(wx.paris.timezone).toBe("Europe/Paris");
  });

  it("keeps the columns with blank values when the whole batch fails", async () => {
    stubFetch(() => {
      throw new Error("offline");
    });
    const wx = await loadComparisonWeather(true);
    expect(Object.keys(wx).sort()).toEqual(["paris", "tokyo"]);
    expect(wx.paris.temp).toBeNull();
    expect(wx.paris.aqi).toBeNull();
  });

  it("keeps the weather when only air quality fails — it is a separate service", async () => {
    stubFetch((url) => {
      if (url.includes("air-quality")) throw new Error("down");
      return ok([weatherPayload(20), weatherPayload(30)]);
    });
    const wx = await loadComparisonWeather(true);
    expect(wx.paris.temp).toBe(20);
    expect(wx.paris.aqi).toBeNull();
  });

  it("does nothing and clears when no place is selected", async () => {
    clearComparison();
    const calls = stubFetch(() => ok({}));
    const wx = await loadComparisonWeather(true);
    expect(calls).toHaveLength(0);
    expect(wx).toEqual({});
  });

  it("reuses a fresh result instead of refetching", async () => {
    const calls = stubFetch((url) =>
      url.includes("air-quality") ? ok([]) : ok([weatherPayload(20), weatherPayload(30)]),
    );
    await loadComparisonWeather(true);
    const afterFirst = calls.length;
    await loadComparisonWeather(false);
    expect(calls).toHaveLength(afterFirst);
  });

  it("exports the same object the renderer reads", async () => {
    stubFetch((url) =>
      url.includes("air-quality") ? ok([]) : ok([weatherPayload(20), weatherPayload(30)]),
    );
    await loadComparisonWeather(true);
    expect(comparisonWx).toBeDefined();
  });
});
