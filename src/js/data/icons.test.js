import { describe, expect, it } from "vitest";
import { weatherIcon } from "./icons.js";

describe("animated sun origin", () => {
  it("centres clear-sky rays on the clear-sky sun", () => {
    expect(weatherIcon("clear", true)).toContain("--sun-cx:32px;--sun-cy:32px");
  });

  it("centres partly-cloudy rays on the offset sun", () => {
    expect(weatherIcon("partly", true)).toContain("--sun-cx:24px;--sun-cy:23px");
  });
});
