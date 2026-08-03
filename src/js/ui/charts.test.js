import { describe, it, expect } from "vitest";
import { formatTick } from "./charts.js";

describe("formatTick", () => {
  it("appends a degree unit with no space, for both metric and imperial", () => {
    expect(formatTick(20, "°C")).toBe("20°C");
    expect(formatTick(68, "°F")).toBe("68°F");
  });

  it("appends a percentage with no space", () => {
    expect(formatTick(23, "%")).toBe("23%");
  });

  it("appends a wind unit with a separating space", () => {
    expect(formatTick(12, "km/h")).toBe("12 km/h");
    expect(formatTick(7, "mph")).toBe("7 mph");
    expect(formatTick(3, "m/s")).toBe("3 m/s");
  });

  it("omits the unit entirely when none is given", () => {
    expect(formatTick(20)).toBe("20");
  });

  it("keeps the existing magnitude-based rounding", () => {
    expect(formatTick(1234, "%")).toBe(`${(1234).toLocaleString()}%`);
    expect(formatTick(123.4, "°C")).toBe("123°C");
    expect(formatTick(12.34, "°C")).toBe("12.3°C");
  });
});
