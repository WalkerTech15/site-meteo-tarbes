import { describe, it, expect, vi } from "vitest";
import { createAsyncCache, createBoundedCache } from "./cache.js";

describe("createAsyncCache", () => {
  it("dedupes concurrent calls for the same key", () => {
    const cache = createAsyncCache(60000);
    let calls = 0;
    const factory = () => {
      calls++;
      return Promise.resolve("value");
    };
    const p1 = cache.get("a", factory);
    const p2 = cache.get("a", factory);
    expect(p1).toBe(p2); // same in-flight promise, factory only called once
    expect(calls).toBe(1);
  });

  it("calls the factory again for a different key", () => {
    const cache = createAsyncCache(60000);
    let calls = 0;
    const factory = () => {
      calls++;
      return Promise.resolve("value");
    };
    cache.get("a", factory);
    cache.get("b", factory);
    expect(calls).toBe(2);
  });

  it("refetches once the TTL has expired", () => {
    vi.useFakeTimers();
    try {
      const cache = createAsyncCache(1000);
      let calls = 0;
      const factory = () => {
        calls++;
        return Promise.resolve("value");
      };
      cache.get("a", factory);
      expect(calls).toBe(1);
      vi.advanceTimersByTime(1500); // past the 1000ms TTL
      cache.get("a", factory);
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("evicts a rejected entry so the next call retries", async () => {
    const cache = createAsyncCache(60000);
    let calls = 0;
    const factory = () => {
      calls++;
      return calls === 1 ? Promise.reject(new Error("boom")) : Promise.resolve("ok");
    };
    await expect(cache.get("a", factory)).rejects.toThrow("boom");
    // give the .catch() eviction microtask a turn
    await Promise.resolve();
    await expect(cache.get("a", factory)).resolves.toBe("ok");
    expect(calls).toBe(2);
  });
});

describe("createBoundedCache", () => {
  it("stores and retrieves values", () => {
    const cache = createBoundedCache(3);
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
    expect(cache.has("a")).toBe(true);
    expect(cache.has("missing")).toBe(false);
  });

  it("evicts the oldest entry once the size limit is exceeded", () => {
    const cache = createBoundedCache(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3); // pushes "a" out
    expect(cache.has("a")).toBe(false);
    expect(cache.has("b")).toBe(true);
    expect(cache.has("c")).toBe(true);
  });
});
