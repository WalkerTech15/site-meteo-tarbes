import { describe, it, expect } from "vitest";
import { computeFadeVisibility } from "./carousel-fade.js";

describe("computeFadeVisibility", () => {
  it("shows no fades when the content does not overflow", () => {
    expect(computeFadeVisibility({ scrollLeft: 0, scrollWidth: 400, clientWidth: 400 })).toEqual({
      left: false,
      right: false,
    });
  });

  it("shows only the right fade at the start of an overflowing row", () => {
    expect(computeFadeVisibility({ scrollLeft: 0, scrollWidth: 1000, clientWidth: 400 })).toEqual({
      left: false,
      right: true,
    });
  });

  it("shows both fades in the middle of an overflowing row", () => {
    expect(computeFadeVisibility({ scrollLeft: 300, scrollWidth: 1000, clientWidth: 400 })).toEqual(
      { left: true, right: true },
    );
  });

  it("shows only the left fade at the end of an overflowing row", () => {
    expect(computeFadeVisibility({ scrollLeft: 600, scrollWidth: 1000, clientWidth: 400 })).toEqual(
      { left: true, right: false },
    );
  });
});
