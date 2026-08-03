/* Detection tests for the forecast advisory banner.
 *
 * detectAdvisories() is pure and metric-only, so everything here is plain data
 * in and plain data out — no DOM, no i18n, no network. */
import { describe, it, expect } from "vitest";
import { detectAdvisories, THRESHOLDS, ADVISORY_LIMIT } from "./advisories.js";
import { state } from "../core/state.js";

/* A calm baseline: mild, still, clear and far-seeing. Individual tests bend one
   field at a time, so anything that fires is unambiguously that field. */
const CALM_HOUR = { time: "2024-06-15T12:00", code: 1, feels: 19, gust: 20, vis: 20 };
const hours = (n, over = {}) =>
  Array.from({ length: n }, (_, i) => ({
    ...CALM_HOUR,
    time: `2024-06-15T${String(12 + i).padStart(2, "0")}:00`,
    ...over,
  }));

function wx({ current = {}, hourly = hours(25) } = {}) {
  return {
    current: { code: 1, feels: 19, gust: 20, visibility: 20, ...current },
    hourly,
  };
}

/* Bend a single hour of an otherwise calm day. */
function withHour(index, over) {
  const list = hours(25);
  list[index] = { ...list[index], ...over };
  return wx({ hourly: list });
}

const types = (list) => list.map((a) => a.type);

describe("detectAdvisories — hazards", () => {
  it("says nothing about ordinary weather", () => {
    expect(detectAdvisories(wx())).toEqual([]);
  });

  it("ignores ordinary rain, cloud, warmth and moderate wind", () => {
    const ordinary = wx({
      current: { code: 63, feels: 28, gust: 55, visibility: 6 }, // moderate rain, warm, breezy, hazy
      hourly: hours(25, { code: 3, feels: 30, gust: 60, vis: 5 }),
    });
    expect(detectAdvisories(ordinary)).toEqual([]);
  });

  it("detects a thunderstorm from WMO 95, 96 and 99", () => {
    for (const code of [95, 96, 99]) {
      expect(types(detectAdvisories(wx({ current: { code } })))).toContain("thunderstorm");
    }
    expect(types(detectAdvisories(wx({ current: { code: 80 } })))).not.toContain("thunderstorm");
  });

  it("detects heavy rain from WMO 65, 67 and 82 only", () => {
    for (const code of [65, 67, 82]) {
      expect(types(detectAdvisories(wx({ current: { code } })))).toContain("heavyRain");
    }
    /* 61/63 are slight and moderate rain — ordinary weather */
    for (const code of [61, 63, 80]) {
      expect(types(detectAdvisories(wx({ current: { code } })))).not.toContain("heavyRain");
    }
  });

  it("detects heavy snow from WMO 75, 77 and 86 only", () => {
    for (const code of [75, 77, 86]) {
      expect(types(detectAdvisories(wx({ current: { code } })))).toContain("heavySnow");
    }
    for (const code of [71, 73, 85]) {
      expect(types(detectAdvisories(wx({ current: { code } })))).not.toContain("heavySnow");
    }
  });

  it("detects strong wind at the gust threshold, not below", () => {
    const at = detectAdvisories(wx({ current: { gust: THRESHOLDS.windGustKmh } }));
    expect(types(at)).toContain("strongWind");
    const below = detectAdvisories(wx({ current: { gust: THRESHOLDS.windGustKmh - 0.1 } }));
    expect(types(below)).not.toContain("strongWind");
  });

  it("uses gusts, not sustained wind, and skips the check when gusts are absent", () => {
    /* a howling sustained wind with no gust field must not invent a gust */
    const noGusts = wx({
      current: { windSpeed: 95, gust: null },
      hourly: hours(25, { gust: undefined }),
    });
    expect(types(detectAdvisories(noGusts))).not.toContain("strongWind");
  });

  it("detects extreme heat at or above the apparent-temperature threshold", () => {
    expect(types(detectAdvisories(wx({ current: { feels: THRESHOLDS.feelsHotC } })))).toContain(
      "extremeHeat",
    );
    expect(types(detectAdvisories(wx({ current: { feels: 39.9 } })))).not.toContain("extremeHeat");
  });

  it("detects extreme cold at or below the apparent-temperature threshold", () => {
    expect(types(detectAdvisories(wx({ current: { feels: THRESHOLDS.feelsColdC } })))).toContain(
      "extremeCold",
    );
    expect(types(detectAdvisories(wx({ current: { feels: -14.9 } })))).not.toContain("extremeCold");
  });

  it("detects dense fog at or below 1000 m, reading the km-based field", () => {
    /* the app normalises every visibility to kilometres */
    expect(types(detectAdvisories(wx({ current: { visibility: 1 } })))).toContain("denseFog");
    expect(types(detectAdvisories(wx({ current: { visibility: 0.4 } })))).toContain("denseFog");
    expect(types(detectAdvisories(wx({ current: { visibility: 1.1 } })))).not.toContain("denseFog");
    expect(THRESHOLDS.visibilityM).toBe(1000);
  });
});

describe("detectAdvisories — the next 24 hours", () => {
  it("finds a hazard that is only in the forecast, not in the current hour", () => {
    const later = withHour(6, { code: 95 });
    const [adv] = detectAdvisories(later);
    expect(adv.type).toBe("thunderstorm");
    expect(adv.now).toBe(false);
    expect(adv.from).toBe("2024-06-15T18:00");
  });

  it("reports the window spanned by the matching hours", () => {
    const list = hours(25);
    list[3] = { ...list[3], gust: 82 };
    list[4] = { ...list[4], gust: 91 };
    const [adv] = detectAdvisories(wx({ hourly: list }));
    expect(adv.from).toBe("2024-06-15T15:00");
    expect(adv.to).toBe("2024-06-15T16:00");
    expect(adv.value).toBe(91); // the peak gust, not the first one
  });

  it("marks a hazard already happening as current", () => {
    const [adv] = detectAdvisories(wx({ current: { code: 99 } }));
    expect(adv.now).toBe(true);
  });

  it("looks no further than 24 hours ahead", () => {
    const list = hours(40);
    list[30] = { ...list[30], code: 95 };
    expect(detectAdvisories(wx({ hourly: list }))).toEqual([]);
  });
});

describe("detectAdvisories — priority", () => {
  it("ranks storm above extreme temperature, wind, snow, rain and fog", () => {
    const everything = wx({
      current: { code: 95, feels: 44, gust: 90, visibility: 0.3 },
      hourly: hours(25, { code: 86, feels: 44, gust: 90, vis: 0.3 }),
    });
    const found = detectAdvisories(everything, 99);
    expect(types(found)).toEqual([
      "thunderstorm",
      "extremeHeat",
      "strongWind",
      "heavySnow",
      "denseFog",
    ]);
    expect(found[0].priority).toBeLessThan(found[1].priority);
  });

  it("shows at most three advisories by default", () => {
    const everything = wx({
      current: { code: 95, feels: 44, gust: 90, visibility: 0.3 },
    });
    const found = detectAdvisories(everything);
    expect(found).toHaveLength(ADVISORY_LIMIT);
    expect(ADVISORY_LIMIT).toBe(3);
    expect(types(found)[0]).toBe("thunderstorm"); // the most urgent survives the cut
  });

  it("labels severity so the banner never depends on colour alone", () => {
    const severities = detectAdvisories(
      wx({ current: { code: 95, feels: 44, visibility: 0.3 } }),
      99,
    ).map((a) => a.severity);
    expect(severities).toContain("high");
    expect(severities).toContain("low");
    for (const s of severities) expect(["high", "moderate", "low"]).toContain(s);
  });
});

describe("detectAdvisories — missing or malformed data", () => {
  it("returns nothing rather than throwing", () => {
    for (const bad of [null, undefined, {}, "", 42, [], { current: null, hourly: null }]) {
      expect(detectAdvisories(bad)).toEqual([]);
    }
  });

  it("skips a condition whose field is absent instead of inventing a value", () => {
    const partial = { current: { code: 1 }, hourly: [{ time: "2024-06-15T12:00", code: 1 }] };
    expect(detectAdvisories(partial)).toEqual([]);
  });

  it("ignores non-numeric and non-finite readings", () => {
    const junk = wx({
      current: { feels: "45", gust: NaN, visibility: Infinity },
      hourly: [{ time: "x", feels: null, gust: "80", vis: undefined }, null, 7],
    });
    expect(detectAdvisories(junk)).toEqual([]);
  });

  it("still works when there is no hourly series at all", () => {
    const currentOnly = { current: { code: 96, feels: 20, gust: 10, visibility: 20 } };
    const [adv] = detectAdvisories(currentOnly);
    expect(adv.type).toBe("thunderstorm");
    expect(adv.from).toBeNull();
    expect(adv.now).toBe(true);
  });
});

describe("detectAdvisories — detection is independent of display units", () => {
  /* Thresholds are metric; the unit setting only changes how the number is
     printed. 104 °F ≈ 40 °C and 43 mph ≈ 70 km/h must not flip a result. */
  const hot = wx({ current: { feels: 41 } });
  const windy = wx({ current: { gust: 72 } });
  const original = { temp: state.unitTemp, wind: state.unitWind };

  it("detects the same hazards in imperial as in metric", () => {
    try {
      state.unitTemp = "c";
      state.unitWind = "kmh";
      const metric = [detectAdvisories(hot), detectAdvisories(windy)];
      state.unitTemp = "f";
      state.unitWind = "mph";
      const imperial = [detectAdvisories(hot), detectAdvisories(windy)];
      expect(imperial).toEqual(metric);
      expect(types(imperial[0])).toContain("extremeHeat");
      expect(types(imperial[1])).toContain("strongWind");
      /* the raw value stays canonical — °C and km/h — for the renderer to convert */
      expect(imperial[0][0].value).toBe(41);
      expect(imperial[1][0].value).toBe(72);
    } finally {
      state.unitTemp = original.temp;
      state.unitWind = original.wind;
    }
  });

  it("does not raise an advisory for 41 °F, which is only 5 °C", () => {
    expect(detectAdvisories(wx({ current: { feels: 5 } }))).toEqual([]);
  });
});
