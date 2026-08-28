import { describe, it, expect, vi } from "vitest";
import {
  SHEET_STATES,
  DEFAULT_SHEET_STATE,
  isValidSheetState,
  stepState,
  cycleState,
  resolveDragState,
  bindMapSheet,
} from "./map-sheet.js";

describe("stepState", () => {
  it("moves one step toward expanded", () => {
    expect(stepState("collapsed", 1)).toBe("half");
    expect(stepState("half", 1)).toBe("expanded");
  });
  it("moves one step toward collapsed", () => {
    expect(stepState("expanded", -1)).toBe("half");
    expect(stepState("half", -1)).toBe("collapsed");
  });
  it("clamps at either end", () => {
    expect(stepState("expanded", 1)).toBe("expanded");
    expect(stepState("collapsed", -1)).toBe("collapsed");
  });
  it("falls back to the default state for an unrecognised input", () => {
    expect(stepState("bogus", 1)).toBe(stepState(DEFAULT_SHEET_STATE, 1));
  });
});

describe("cycleState", () => {
  it("cycles collapsed → half → expanded → collapsed", () => {
    expect(cycleState("collapsed")).toBe("half");
    expect(cycleState("half")).toBe("expanded");
    expect(cycleState("expanded")).toBe("collapsed");
  });
});

describe("resolveDragState", () => {
  it("expands one step on a sufficient upward drag", () => {
    expect(resolveDragState("half", -60)).toBe("expanded");
    expect(resolveDragState("collapsed", -60)).toBe("half");
  });
  it("collapses one step on a sufficient downward drag", () => {
    expect(resolveDragState("half", 60)).toBe("collapsed");
    expect(resolveDragState("expanded", 60)).toBe("half");
  });
  it("snaps back to the start state for a drag under the threshold", () => {
    expect(resolveDragState("half", 20)).toBe("half");
    expect(resolveDragState("half", -20)).toBe("half");
  });
  it("respects a custom threshold", () => {
    expect(resolveDragState("half", 30, 25)).toBe("collapsed");
    expect(resolveDragState("half", 30, 100)).toBe("half");
  });
  it("never steps past the ends even from a huge drag", () => {
    expect(resolveDragState("expanded", -500)).toBe("expanded");
    expect(resolveDragState("collapsed", 500)).toBe("collapsed");
  });
});

describe("isValidSheetState", () => {
  it("accepts exactly the three defined states", () => {
    for (const s of SHEET_STATES) expect(isValidSheetState(s)).toBe(true);
  });
  it("rejects anything else", () => {
    expect(isValidSheetState("open")).toBe(false);
    expect(isValidSheetState(undefined)).toBe(false);
  });
});

/* Minimal fake DOM — this suite runs under Vitest's "node" environment (see
   vite.config.js), so bindMapSheet is exercised against small hand-rolled
   stand-ins rather than a real <button>/<aside>. Real-browser drag/keyboard
   behaviour is covered by the mobile e2e specs. */
function fakeElement() {
  const listeners = {};
  const classes = new Set();
  return {
    dataset: {},
    style: {},
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    },
    _attrs: {},
    setAttribute(name, value) {
      this._attrs[name] = value;
    },
    getAttribute(name) {
      return this._attrs[name];
    },
    addEventListener(type, fn) {
      (listeners[type] ||= []).push(fn);
    },
    removeEventListener(type, fn) {
      listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
    },
    fire(type, event = {}) {
      (listeners[type] || []).forEach((fn) => fn(event));
    },
  };
}

describe("bindMapSheet", () => {
  it("no-ops safely when the panel or handle is missing", () => {
    const onChange = vi.fn();
    const controller = bindMapSheet(null, null, { onChange });
    expect(controller.getState()).toBe(DEFAULT_SHEET_STATE);
    expect(onChange).not.toHaveBeenCalled(); // initial apply is silent
  });

  it("applies the initial state to the panel dataset and handle aria-expanded without calling onChange", () => {
    const panel = fakeElement();
    const handle = fakeElement();
    const onChange = vi.fn();
    bindMapSheet(panel, handle, { initialState: "half", onChange });
    expect(panel.dataset.sheetState).toBe("half");
    expect(handle.getAttribute("aria-expanded")).toBe("true");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("collapsed state reports aria-expanded=false", () => {
    const panel = fakeElement();
    const handle = fakeElement();
    bindMapSheet(panel, handle, { initialState: "collapsed" });
    expect(handle.getAttribute("aria-expanded")).toBe("false");
  });

  it("a tap (click with no drag) cycles the state and fires onChange", () => {
    const panel = fakeElement();
    const handle = fakeElement();
    const onChange = vi.fn();
    const controller = bindMapSheet(panel, handle, { initialState: "collapsed", onChange });
    handle.fire("click");
    expect(controller.getState()).toBe("half");
    expect(panel.dataset.sheetState).toBe("half");
    expect(onChange).toHaveBeenCalledWith("half");
  });

  it("ArrowUp/ArrowDown on the handle step the state and preventDefault the key", () => {
    const panel = fakeElement();
    const handle = fakeElement();
    const controller = bindMapSheet(panel, handle, { initialState: "half" });
    const up = { key: "ArrowUp", preventDefault: vi.fn() };
    handle.fire("keydown", up);
    expect(controller.getState()).toBe("expanded");
    expect(up.preventDefault).toHaveBeenCalled();

    const down = { key: "ArrowDown", preventDefault: vi.fn() };
    handle.fire("keydown", down);
    handle.fire("keydown", down);
    expect(controller.getState()).toBe("collapsed");
  });

  it("Home expands fully, End collapses fully", () => {
    const panel = fakeElement();
    const handle = fakeElement();
    const controller = bindMapSheet(panel, handle, { initialState: "half" });
    handle.fire("keydown", { key: "Home", preventDefault: vi.fn() });
    expect(controller.getState()).toBe("expanded");
    handle.fire("keydown", { key: "End", preventDefault: vi.fn() });
    expect(controller.getState()).toBe("collapsed");
  });

  it("a real drag resolves via resolveDragState and the trailing click does not double-apply", () => {
    const panel = fakeElement();
    const handle = fakeElement();
    const onChange = vi.fn();
    const controller = bindMapSheet(panel, handle, { initialState: "half", onChange });

    handle.fire("pointerdown", { clientY: 300, pointerId: 1 });
    handle.fire("pointermove", { clientY: 250 }); // -50px, past the tap tolerance
    handle.fire("pointerup", { clientY: 250 });
    expect(controller.getState()).toBe("expanded");
    expect(onChange).toHaveBeenCalledTimes(1);

    /* the browser's own trailing click after a drag must not cycle again */
    handle.fire("click");
    expect(controller.getState()).toBe("expanded");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("a drag under the tap tolerance is treated as a tap, not a resize", () => {
    const panel = fakeElement();
    const handle = fakeElement();
    const controller = bindMapSheet(panel, handle, { initialState: "half" });

    handle.fire("pointerdown", { clientY: 300, pointerId: 1 });
    handle.fire("pointermove", { clientY: 297 }); // 3px — under the 6px tolerance
    handle.fire("pointerup", { clientY: 297 });
    expect(controller.getState()).toBe("half"); // endDrag did not apply

    handle.fire("click"); // onClick still runs — the tap itself
    expect(controller.getState()).toBe("expanded");
  });

  it("setState applies programmatically and calls onChange", () => {
    const panel = fakeElement();
    const handle = fakeElement();
    const onChange = vi.fn();
    const controller = bindMapSheet(panel, handle, { initialState: "half", onChange });
    controller.setState("collapsed");
    expect(controller.getState()).toBe("collapsed");
    expect(panel.dataset.sheetState).toBe("collapsed");
    expect(onChange).toHaveBeenCalledWith("collapsed");
  });

  it("destroy removes all listeners so further events are no-ops", () => {
    const panel = fakeElement();
    const handle = fakeElement();
    const onChange = vi.fn();
    const controller = bindMapSheet(panel, handle, { initialState: "half", onChange });
    controller.destroy();
    handle.fire("click");
    expect(controller.getState()).toBe("half");
    expect(onChange).not.toHaveBeenCalled();
  });
});
