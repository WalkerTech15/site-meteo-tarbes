/* The pure half of the comparison table: unit-aware cell formatting and the
 * row model. The DOM half (picker wiring, remove buttons, keyboard) is
 * covered by e2e/comparison.spec.js. */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { state } from "../core/state.js";
import { formatComparisonCell, buildComparisonRows } from "./render-comparison.js";
import { COMPARISON_METRICS } from "../features/comparison.js";

const DASH = "—";

const FULL = {
  temp: 21.4,
  feelsLike: 19.8,
  humidity: 55.4,
  wind: 12.5,
  precipitation: 30.2,
  uv: 4.4,
  aqi: 21.6,
  timezone: "Europe/Paris",
};

const EMPTY = {
  temp: null,
  feelsLike: null,
  humidity: null,
  wind: null,
  precipitation: null,
  uv: null,
  aqi: null,
  timezone: null,
};

const originalLang = state.lang;
const originalTemp = state.unitTemp;
const originalWind = state.unitWind;

beforeEach(() => {
  state.lang = "en";
  state.unitTemp = "c";
  state.unitWind = "kmh";
});

afterEach(() => {
  state.lang = originalLang;
  state.unitTemp = originalTemp;
  state.unitWind = originalWind;
});

describe("formatComparisonCell", () => {
  it("formats temperature and feels-like in the chosen unit", () => {
    expect(formatComparisonCell("temperature", FULL)).toBe("21°C");
    expect(formatComparisonCell("feelsLike", FULL)).toBe("20°C");
    state.unitTemp = "f";
    expect(formatComparisonCell("temperature", FULL)).toBe("71°F");
  });

  it("formats wind in the chosen unit", () => {
    expect(formatComparisonCell("wind", FULL)).toBe("13 km/h");
    state.unitWind = "mph";
    expect(formatComparisonCell("wind", FULL)).toContain("mph");
  });

  it("formats percentages as whole numbers", () => {
    expect(formatComparisonCell("humidity", FULL)).toBe("55%");
    expect(formatComparisonCell("precipitation", FULL)).toBe("30%");
  });

  it("pairs the UV index with its descriptive band", () => {
    const cell = formatComparisonCell("uv", FULL);
    expect(cell).toMatch(/^4 · /);
    expect(cell.length).toBeGreaterThan(3);
  });

  it("shows air quality as a plain index value", () => {
    expect(formatComparisonCell("airQuality", FULL)).toBe("22");
  });

  it("shows the place's own local time", () => {
    expect(formatComparisonCell("localTime", FULL)).toMatch(/^\d{2}:\d{2}$/);
  });

  it("returns an em dash for every missing value rather than 'null' or NaN", () => {
    for (const metric of COMPARISON_METRICS) {
      const cell = formatComparisonCell(metric, EMPTY);
      expect(cell, metric).toBe(DASH);
    }
  });

  it("returns an em dash for a missing entry entirely", () => {
    for (const metric of COMPARISON_METRICS) {
      expect(formatComparisonCell(metric, null), metric).toBe(DASH);
      expect(formatComparisonCell(metric, undefined), metric).toBe(DASH);
    }
  });

  it("treats a non-finite number as missing", () => {
    const broken = { ...FULL, temp: NaN, humidity: Infinity };
    expect(formatComparisonCell("temperature", broken)).toBe(DASH);
    expect(formatComparisonCell("humidity", broken)).toBe(DASH);
  });

  it("returns an em dash for an unknown metric instead of throwing", () => {
    expect(formatComparisonCell("nonsense", FULL)).toBe(DASH);
  });

  it("returns an em dash for an invalid time zone rather than crashing", () => {
    expect(formatComparisonCell("localTime", { timezone: "Not/AZone" })).toBe(DASH);
  });
});

describe("buildComparisonRows", () => {
  const paris = { id: "paris" };
  const tokyo = { id: "tokyo" };

  it("builds one row per metric, in the declared order", () => {
    const rows = buildComparisonRows([paris], { paris: FULL });
    expect(rows.map((r) => r.metric)).toEqual(COMPARISON_METRICS);
  });

  it("builds one cell per place, in column order", () => {
    const rows = buildComparisonRows([paris, tokyo], {
      paris: FULL,
      tokyo: { ...FULL, temp: 30 },
    });
    const temperature = rows.find((r) => r.metric === "temperature");
    expect(temperature.cells).toEqual(["21°C", "30°C"]);
  });

  it("gives every row a translated label", () => {
    state.lang = "en";
    const en = buildComparisonRows([paris], {}).map((r) => r.label);
    state.lang = "fr";
    const fr = buildComparisonRows([paris], {}).map((r) => r.label);

    expect(en).toContain("Temperature");
    expect(fr).toContain("Température");
    /* every label is real text, never a raw key */
    for (const label of [...en, ...fr]) {
      expect(label).toBeTruthy();
      expect(label).not.toMatch(/^[a-z][a-zA-Z]+$/);
    }
  });

  it("fills the table with dashes when no weather has arrived yet", () => {
    const rows = buildComparisonRows([paris, tokyo], {});
    for (const row of rows) expect(row.cells).toEqual([DASH, DASH]);
  });

  it("returns rows with no cells for an empty selection", () => {
    const rows = buildComparisonRows([], {});
    expect(rows).toHaveLength(COMPARISON_METRICS.length);
    for (const row of rows) expect(row.cells).toEqual([]);
  });
});
