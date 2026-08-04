import { describe, it, expect, vi, beforeEach } from "vitest";
import { on, off, emit, clearBus } from "./app-bus.js";

beforeEach(() => clearBus());

describe("app bus", () => {
  it("delivers a payload to every subscriber of that event only", () => {
    const moved = vi.fn();
    const other = vi.fn();
    on("map:moved", moved);
    on("map:layer", other);
    emit("map:moved", { zoom: 9 });
    expect(moved).toHaveBeenCalledWith({ zoom: 9 });
    expect(other).not.toHaveBeenCalled();
  });

  it("stops delivering after off(), and after the returned unsubscribe", () => {
    const a = vi.fn();
    const b = vi.fn();
    on("x", a);
    const unsubscribe = on("x", b);
    off("x", a);
    unsubscribe();
    emit("x");
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });

  it("emitting an event nobody listens to is a no-op", () => {
    expect(() => emit("nothing-here", 1)).not.toThrow();
  });

  it("one throwing subscriber never stops the others or the emitter", () => {
    const after = vi.fn();
    on("x", () => {
      throw new Error("boom");
    });
    on("x", after);
    expect(() => emit("x")).not.toThrow();
    expect(after).toHaveBeenCalled();
  });

  it("a subscriber that unsubscribes itself mid-emit does not skip the next one", () => {
    const second = vi.fn();
    const unsubscribe = on("x", () => unsubscribe());
    on("x", second);
    emit("x");
    expect(second).toHaveBeenCalledTimes(1);
  });
});
