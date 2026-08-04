/* The forecast-time control. The single most important fact encoded here is
 * that MapTiler weather layers speak UNIX SECONDS, not milliseconds — the
 * fake layer below asserts on exactly what setAnimationTime() receives. */
import { describe, it, expect, vi } from "vitest";
import {
  TIME_OFFSETS,
  normalizeOffset,
  isSupportedOffset,
  layerTimeRange,
  applyLayerTime,
  availableOffsets,
} from "./map-timeline.js";

const HOUR = 3600 * 1000;
const NOW = Date.UTC(2024, 5, 15, 12, 0, 0);

/* Minimal stand-in for a TimeFrameAnimation-derived weather layer. `startMs`
   and `endMs` are given in ms for readability and exposed in seconds, exactly
   as the SDK does. */
function fakeLayer({ startMs = NOW - 3 * HOUR, endMs = NOW + 9 * HOUR, frames = true } = {}) {
  return {
    setAnimationTime: vi.fn(),
    getAnimationStart: () => (frames ? startMs / 1000 : Number.POSITIVE_INFINITY),
    getAnimationEnd: () => (frames ? endMs / 1000 : Number.NEGATIVE_INFINITY),
  };
}

describe("offsets", () => {
  it("offers exactly now, +3 h and +6 h", () => {
    expect(TIME_OFFSETS).toEqual([0, 3, 6]);
  });

  it.each([99, -3, 1.5, "abc", null, undefined])("resolves the unsupported %o to now", (value) => {
    expect(isSupportedOffset(value)).toBe(false);
    expect(normalizeOffset(value)).toBe(0);
  });

  it("accepts a numeric string, as a URL parameter would supply", () => {
    expect(normalizeOffset("3")).toBe(3);
  });
});

describe("layerTimeRange", () => {
  it("converts the layer's seconds to milliseconds", () => {
    expect(layerTimeRange(fakeLayer())).toEqual({
      startMs: NOW - 3 * HOUR,
      endMs: NOW + 9 * HOUR,
    });
  });

  it("is null while the layer has no frames", () => {
    expect(layerTimeRange(fakeLayer({ frames: false }))).toBeNull();
    expect(layerTimeRange(null)).toBeNull();
    expect(layerTimeRange({})).toBeNull();
  });
});

describe("applyLayerTime", () => {
  it("sets now + offset, in seconds", () => {
    const layer = fakeLayer();
    const result = applyLayerTime(layer, 3, NOW);
    expect(layer.setAnimationTime).toHaveBeenCalledWith((NOW + 3 * HOUR) / 1000);
    expect(result).toMatchObject({ available: true, offset: 3, clamped: false });
    expect(result.timeMs).toBe(NOW + 3 * HOUR);
  });

  it("handles 'now' with no offset", () => {
    const layer = fakeLayer();
    applyLayerTime(layer, 0, NOW);
    expect(layer.setAnimationTime).toHaveBeenCalledWith(NOW / 1000);
  });

  it("clamps to the last available frame and says so", () => {
    /* provider forecast only reaches +4 h, user asked for +6 h */
    const layer = fakeLayer({ endMs: NOW + 4 * HOUR });
    const result = applyLayerTime(layer, 6, NOW);
    expect(layer.setAnimationTime).toHaveBeenCalledWith((NOW + 4 * HOUR) / 1000);
    expect(result.clamped).toBe(true);
    expect(result.offset).toBe(6); /* the user's choice stays highlighted */
  });

  it("reports unavailable — and touches nothing — while frames are missing", () => {
    const layer = fakeLayer({ frames: false });
    const result = applyLayerTime(layer, 3, NOW);
    expect(result.available).toBe(false);
    expect(result.timeMs).toBeNull();
    expect(layer.setAnimationTime).not.toHaveBeenCalled();
  });

  it("never throws on a layer that is not a time-frame animation", () => {
    expect(applyLayerTime(null, 3, NOW).available).toBe(false);
    expect(applyLayerTime({}, 3, NOW).available).toBe(false);
  });

  it("normalizes an unsupported offset instead of jumping somewhere arbitrary", () => {
    const layer = fakeLayer();
    const result = applyLayerTime(layer, 42, NOW);
    expect(result.offset).toBe(0);
    expect(layer.setAnimationTime).toHaveBeenCalledWith(NOW / 1000);
  });
});

describe("availableOffsets", () => {
  it("lists every offset the loaded frames can satisfy", () => {
    expect(availableOffsets(fakeLayer(), NOW)).toEqual([0, 3, 6]);
  });

  it("drops offsets past the end of the forecast", () => {
    expect(availableOffsets(fakeLayer({ endMs: NOW + 4 * HOUR }), NOW)).toEqual([0, 3]);
  });

  it("is empty with no frames", () => {
    expect(availableOffsets(fakeLayer({ frames: false }), NOW)).toEqual([]);
  });
});
