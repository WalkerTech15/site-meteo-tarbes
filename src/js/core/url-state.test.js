/* The URL is the one piece of app state a stranger can hand-edit, so every
 * value that comes out of parseAppUrl() has to be validated and clamped. These
 * tests are the contract for "an invalid link still opens a working app". */
import { describe, it, expect } from "vitest";
import {
  parseAppUrl,
  buildAppUrl,
  parseLatLon,
  sameAppUrl,
  DEFAULT_URL_STATE,
} from "./url-state.js";

describe("parseLatLon", () => {
  it("reads a valid pair and rounds it to ~11 m", () => {
    expect(parseLatLon("48.85661234,2.35229999")).toEqual({ lat: 48.8566, lon: 2.3523 });
  });

  it("clamps latitude to the Web Mercator limit", () => {
    expect(parseLatLon("89,10").lat).toBeCloseTo(85.0511, 3);
    expect(parseLatLon("-89,10").lat).toBeCloseTo(-85.0511, 3);
  });

  it("wraps longitude instead of clamping it", () => {
    expect(parseLatLon("0,190").lon).toBe(-170);
    expect(parseLatLon("0,-190").lon).toBe(170);
  });

  it.each(["", "abc", "1", "1,2,3", "NaN,2", "48.8,", "999,2"])("rejects %o", (raw) => {
    expect(parseLatLon(raw)).toBeNull();
  });
});

describe("parseAppUrl", () => {
  it("falls back to defaults for an empty or bare hash", () => {
    expect(parseAppUrl("")).toEqual(DEFAULT_URL_STATE);
    expect(parseAppUrl("#")).toEqual(DEFAULT_URL_STATE);
  });

  it("reads a full map state", () => {
    const state = parseAppUrl("#/map?sel=48.8566,2.3522&c=48.9,2.4&z=9.5&layer=rain&t=3&panel=1");
    expect(state).toEqual({
      view: "map",
      sel: { lat: 48.8566, lon: 2.3522 },
      center: { lat: 48.9, lon: 2.4 },
      zoom: 9.5,
      layer: "rain",
      offset: 3,
      panel: true,
    });
  });

  it("ignores an unknown view and keeps the rest", () => {
    const state = parseAppUrl("#/wormhole?layer=wind");
    expect(state.view).toBe("home");
    expect(state.layer).toBe("wind");
  });

  it("clamps zoom into the map's own range", () => {
    expect(parseAppUrl("#/map?z=99").zoom).toBe(20);
    expect(parseAppUrl("#/map?z=-4").zoom).toBe(1);
  });

  it.each(["z=abc", "z=", "z=NaN"])("drops an unparseable zoom (%s)", (query) => {
    expect(parseAppUrl(`#/map?${query}`).zoom).toBeNull();
  });

  it("rejects an unknown layer rather than passing it through", () => {
    expect(parseAppUrl("#/map?layer=radioactivity").layer).toBe("satellite");
  });

  it.each(["t=99", "t=-3", "t=1.5", "t=abc"])(
    "resolves an unsupported forecast offset (%s) to now",
    (query) => {
      expect(parseAppUrl(`#/map?layer=wind&${query}`).offset).toBe(0);
    },
  );

  it("drops a forecast offset when there is no weather layer under it", () => {
    expect(parseAppUrl("#/map?t=6").offset).toBe(0);
  });

  it("treats a non-boolean panel value as unspecified", () => {
    expect(parseAppUrl("#/map?panel=maybe").panel).toBeNull();
    expect(parseAppUrl("#/map?panel=0").panel).toBe(false);
  });

  it("survives junk that is not a query string at all", () => {
    expect(() => parseAppUrl("#///??&&==")).not.toThrow();
    expect(parseAppUrl("#///??&&==").view).toBe("home");
  });
});

describe("buildAppUrl", () => {
  it("omits every default, keeping an ordinary session's URL clean", () => {
    expect(buildAppUrl({ view: "home" })).toBe("#/home");
  });

  it("round-trips a full state", () => {
    const state = parseAppUrl("#/map?sel=48.8566,2.3522&c=48.9,2.4&z=9.5&layer=rain&t=3&panel=1");
    expect(parseAppUrl(buildAppUrl(state))).toEqual(state);
  });

  it("never writes a forecast offset without its layer", () => {
    expect(buildAppUrl({ view: "map", layer: "satellite", offset: 6 })).toBe("#/map");
  });

  it("writes panel=0 explicitly, since 'closed' is a real shared state", () => {
    expect(buildAppUrl({ view: "map", panel: false })).toBe("#/map?panel=0");
  });

  it("clamps an out-of-range zoom on the way out too", () => {
    expect(buildAppUrl({ view: "map", zoom: 99 })).toBe("#/map?z=20");
  });

  it("sameAppUrl compares meaning, not spelling", () => {
    expect(sameAppUrl({ view: "map", zoom: 9.5001 }, { view: "map", zoom: 9.5 })).toBe(true);
    expect(sameAppUrl({ view: "map" }, { view: "home" })).toBe(false);
  });
});
