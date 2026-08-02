import { describe, it, expect, beforeEach } from "vitest";
import { getStr, setStr, getJSON, setJSON } from "./storage.js";

/* Vitest's default "node" test environment has no localStorage — this repo
   doesn't need jsdom for anything else, so a minimal in-memory stand-in is
   enough to exercise the real getStr/getJSON try/catch guards. */
function installFakeLocalStorage() {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
  return map;
}

beforeEach(() => {
  installFakeLocalStorage();
});

describe("getStr / setStr", () => {
  it("returns the fallback when the key is missing", () => {
    expect(getStr("missing", "fallback")).toBe("fallback");
  });

  it("round-trips a written value", () => {
    setStr("k", "hello");
    expect(getStr("k", "fallback")).toBe("hello");
  });
});

describe("getJSON / setJSON", () => {
  it("returns the fallback when the key is missing", () => {
    expect(getJSON("missing", { a: 1 })).toEqual({ a: 1 });
  });

  it("round-trips a written object", () => {
    setJSON("prefs", { theme: "dark" });
    expect(getJSON("prefs", null)).toEqual({ theme: "dark" });
  });

  it("returns the fallback instead of throwing on malformed JSON", () => {
    localStorage.setItem("broken", "{not valid json");
    expect(() => getJSON("broken", [])).not.toThrow();
    expect(getJSON("broken", [])).toEqual([]);
  });

  it("does not crash when localStorage itself throws (private-mode/quota errors)", () => {
    globalThis.localStorage = {
      getItem() {
        throw new Error("SecurityError");
      },
    };
    expect(() => getJSON("anything", "safe")).not.toThrow();
    expect(getJSON("anything", "safe")).toBe("safe");
  });
});
