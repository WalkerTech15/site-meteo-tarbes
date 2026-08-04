/* awaitMapReady() is pure — no DOM, no SDK — so it's exercised here with a
 * tiny fake map that mimics just the bit of the MapLibre/MapTiler event API
 * it depends on (on/off/isStyleLoaded), same "minimal in-memory stand-in"
 * approach core/storage.test.js uses for localStorage. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { awaitMapReady } from "./map-ready.js";

function fakeMap({ styleLoaded = false } = {}) {
  const listeners = new Map(); // event -> Set(handler)
  return {
    _isStyleLoaded: styleLoaded,
    isStyleLoaded() {
      return this._isStyleLoaded;
    },
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(handler);
    },
    off(event, handler) {
      listeners.get(event)?.delete(handler);
    },
    /* test-only helpers, not part of the real map API */
    listenerCount(event) {
      return listeners.get(event)?.size ?? 0;
    },
    emit(event, payload) {
      for (const handler of listeners.get(event) || []) handler(payload);
    },
  };
}

describe("awaitMapReady", () => {
  it("resolves immediately when the style is already loaded", async () => {
    const map = fakeMap({ styleLoaded: true });
    await expect(awaitMapReady(map)).resolves.toBeUndefined();
    /* never had to listen for anything */
    expect(map.listenerCount("styledata")).toBe(0);
  });

  it("resolves once styledata fires and isStyleLoaded turns true — the case where the original load event already happened and will never fire again", async () => {
    const map = fakeMap({ styleLoaded: false });
    const p = awaitMapReady(map);
    /* a styledata event that fires too early still doesn't satisfy readiness */
    map.emit("styledata");
    map._isStyleLoaded = true;
    map.emit("styledata");
    await expect(p).resolves.toBeUndefined();
  });

  it("resolves on idle just as well as on styledata", async () => {
    const map = fakeMap({ styleLoaded: false });
    const p = awaitMapReady(map);
    map._isStyleLoaded = true;
    map.emit("idle");
    await expect(p).resolves.toBeUndefined();
  });

  it("removes every listener and the timer once it resolves", async () => {
    const map = fakeMap({ styleLoaded: false });
    const p = awaitMapReady(map);
    expect(map.listenerCount("styledata")).toBe(1);
    expect(map.listenerCount("idle")).toBe(1);
    expect(map.listenerCount("error")).toBe(1);
    map._isStyleLoaded = true;
    map.emit("idle");
    await p;
    expect(map.listenerCount("styledata")).toBe(0);
    expect(map.listenerCount("idle")).toBe(0);
    expect(map.listenerCount("error")).toBe(0);
  });

  describe("timeout and error paths", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("rejects after the timeout instead of waiting forever", async () => {
      const map = fakeMap({ styleLoaded: false });
      const p = awaitMapReady(map, { timeoutMs: 1000 });
      const assertion = expect(p).rejects.toThrow(/timed out/i);
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
      expect(map.listenerCount("styledata")).toBe(0);
      expect(map.listenerCount("error")).toBe(0);
    });

    it("rejects cleanly on a genuine map error, before the timeout", async () => {
      const map = fakeMap({ styleLoaded: false });
      const p = awaitMapReady(map, { timeoutMs: 5000 });
      const boom = new Error("style fetch failed");
      const assertion = expect(p).rejects.toBe(boom);
      map.emit("error", { error: boom });
      await assertion;
      expect(map.listenerCount("styledata")).toBe(0);
      expect(map.listenerCount("error")).toBe(0);
    });

    it("falls back to a generic error when the error event carries no Error instance", async () => {
      const map = fakeMap({ styleLoaded: false });
      const p = awaitMapReady(map, { timeoutMs: 5000 });
      const assertion = expect(p).rejects.toThrow(/map error/i);
      map.emit("error", {});
      await assertion;
    });

    it("never double-settles if styledata fires again after an error", async () => {
      const map = fakeMap({ styleLoaded: false });
      const p = awaitMapReady(map, { timeoutMs: 5000 });
      const assertion = expect(p).rejects.toThrow();
      map.emit("error", { error: new Error("boom") });
      map._isStyleLoaded = true;
      map.emit("styledata"); // must be a no-op post-rejection
      await assertion;
    });
  });
});
