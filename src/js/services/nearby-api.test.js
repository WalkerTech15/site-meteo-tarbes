/* Contract tests for the "nearby places" discovery + batched-weather pipeline.
 *
 * reverseGeocodeLocation is stubbed (it's covered by its own tests in
 * geocoding-api) so this file exercises only: eligibility gating, ring-probe
 * dedup/distance-filtering, the loading/empty/error/ready states, and that
 * weather for all candidates comes from ONE batched fetch call. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("./geocoding-api.js", () => ({ reverseGeocodeLocation: vi.fn() }));

import { reverseGeocodeLocation } from "./geocoding-api.js";
import { loadNearbyPlaces, isNearbyEligible, __resetNearbyCacheForTests } from "./nearby-api.js";

const ORIGIN = { kind: "city", lat: 43.2333, lon: 0.0782, name: { en: "Tarbes", fr: "Tarbes" } };

function place(name, lat, lon, id) {
  return { id, kind: "city", cc: "FR", lat, lon, name: { en: name, fr: name } };
}

let originalFetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
  __resetNearbyCacheForTests();
  reverseGeocodeLocation.mockReset();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function weatherEntryFor(temp) {
  return {
    current: {
      time: "2024-06-15T12:00",
      temperature_2m: temp,
      wind_speed_10m: 10,
      weather_code: 1,
      is_day: 1,
    },
    hourly: { time: ["2024-06-15T12:00"], precipitation_probability: [20] },
  };
}

describe("isNearbyEligible", () => {
  it("is eligible for point-like kinds", () => {
    for (const kind of ["city", "town", "village", "address", "poi"]) {
      expect(isNearbyEligible({ kind })).toBe(true);
    }
  });
  it("is not eligible for broad areas — nothing meaningful to probe around a centroid", () => {
    for (const kind of ["country", "state", "province", "region"]) {
      expect(isNearbyEligible({ kind })).toBe(false);
    }
  });
  it("is not eligible for a missing/null location", () => {
    expect(isNearbyEligible(null)).toBe(false);
  });
});

describe("loadNearbyPlaces — eligibility", () => {
  it("resolves 'ineligible' without calling the geocoder at all for a country", async () => {
    const result = await loadNearbyPlaces({
      kind: "country",
      lat: 46,
      lon: 2,
      name: { en: "France" },
    });
    expect(result).toEqual({ status: "ineligible", places: [] });
    expect(reverseGeocodeLocation).not.toHaveBeenCalled();
  });
});

describe("loadNearbyPlaces — discovery", () => {
  it("dedupes probes that resolve to the same place and sorts by distance", async () => {
    /* Two probes land on the same neighbouring town (same id); a third is a
       genuinely different, farther place. */
    reverseGeocodeLocation.mockImplementation((lat, lon) => {
      if (lon > ORIGIN.lon) return Promise.resolve(place("Lourdes", 43.1, 0.05, "mt-lourdes"));
      if (lat > ORIGIN.lat) return Promise.resolve(place("Lourdes", 43.1, 0.05, "mt-lourdes"));
      return Promise.resolve(place("Vic-en-Bigorre", 43.38, 0.05, "mt-vic"));
    });
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => [weatherEntryFor(20), weatherEntryFor(18)],
    }));

    const result = await loadNearbyPlaces(ORIGIN);

    expect(result.status).toBe("ready");
    const ids = result.places.map((p) => p.loc.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicate place
    expect(result.places).toEqual([...result.places].sort((a, b) => a.distanceKm - b.distanceKm));
  });

  it("excludes a probe that resolves back to the origin's own name", async () => {
    reverseGeocodeLocation.mockResolvedValue(place("Tarbes", 43.24, 0.09, "mt-self"));
    const result = await loadNearbyPlaces(ORIGIN);
    expect(result).toEqual({ status: "empty", places: [] });
  });

  it("excludes a probe closer than the same-place distance floor", async () => {
    /* A place object at ~1 km from the origin — well under the 3 km floor. */
    reverseGeocodeLocation.mockResolvedValue(place("Micro-hameau", 43.242, 0.0782, "mt-close"));
    const result = await loadNearbyPlaces(ORIGIN);
    expect(result).toEqual({ status: "empty", places: [] });
  });

  it("'empty': every probe answers, none usable (null / open water)", async () => {
    reverseGeocodeLocation.mockResolvedValue(null);
    const result = await loadNearbyPlaces(ORIGIN);
    expect(result).toEqual({ status: "empty", places: [] });
  });

  it("'error': every probe rejects — the geocoder itself is down", async () => {
    reverseGeocodeLocation.mockRejectedValue(new Error("offline"));
    const result = await loadNearbyPlaces(ORIGIN);
    expect(result).toEqual({ status: "error", places: [] });
  });

  it("a mix of rejected and successful probes still returns ready", async () => {
    let call = 0;
    reverseGeocodeLocation.mockImplementation(() => {
      call++;
      if (call % 2 === 0) return Promise.reject(new Error("timeout"));
      return Promise.resolve(place(`Place ${call}`, 43.3 + call * 0.01, 0.2, `mt-${call}`));
    });
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => [weatherEntryFor(15), weatherEntryFor(16), weatherEntryFor(17)],
    }));
    const result = await loadNearbyPlaces(ORIGIN);
    expect(result.status).toBe("ready");
    expect(result.places.length).toBeGreaterThan(0);
  });
});

describe("loadNearbyPlaces — weather batching", () => {
  it("fetches weather for every candidate in exactly one request, comma-joined", async () => {
    reverseGeocodeLocation.mockImplementation((lat, lon) =>
      Promise.resolve(place(`Place ${lon.toFixed(2)}`, lat, lon, `mt-${lon.toFixed(2)}`)),
    );
    const fetchSpy = vi.fn(async (url) => {
      expect(String(url)).toContain("latitude=");
      const parsed = new URL(String(url));
      const coordCount = parsed.searchParams.get("latitude").split(",").length;
      return {
        ok: true,
        json: async () => Array.from({ length: coordCount }, (_, i) => weatherEntryFor(10 + i)),
      };
    });
    globalThis.fetch = fetchSpy;

    const result = await loadNearbyPlaces(ORIGIN);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("ready");
    for (const place_ of result.places) {
      expect(place_.weather).toEqual(
        expect.objectContaining({ temp: expect.any(Number), windSpeed: 10, rainProb: 20 }),
      );
    }
  });

  it("'error' with places still populated when the batched forecast call fails — the panel can still list names/distances", async () => {
    reverseGeocodeLocation.mockResolvedValue(place("Lourdes", 43.1, 0.05, "mt-lourdes"));
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500 }));

    const result = await loadNearbyPlaces(ORIGIN);

    expect(result.status).toBe("error");
    expect(result.places).toHaveLength(1);
    expect(result.places[0].weather).toBeNull();
  });

  it("caches by rounded coordinate so re-selecting the same location does not re-probe", async () => {
    reverseGeocodeLocation.mockResolvedValue(place("Lourdes", 43.1, 0.05, "mt-lourdes"));
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => [weatherEntryFor(20)] }));

    await loadNearbyPlaces(ORIGIN);
    await loadNearbyPlaces(ORIGIN);

    expect(reverseGeocodeLocation).toHaveBeenCalledTimes(6); // one ring, not two
  });
});
