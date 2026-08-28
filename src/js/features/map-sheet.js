/* Mobile bottom-sheet behaviour for the map's location detail panel.
 *
 * Desktop keeps the existing floating panel (styles/views/map.css) untouched;
 * below the ≤820px breakpoint already used for that panel (the same one
 * ui/render-map.js and this module share) it becomes a draggable sheet with
 * three snap states. State is driven entirely by a `data-sheet-state`
 * attribute so CSS owns the actual positioning/height — this module only
 * ever decides WHICH state applies and applies it.
 *
 * The pure state-transition functions (stepState/cycleState/resolveDragState)
 * are exported separately from the DOM wiring so the transition logic is
 * unit-testable without a browser. */

export const SHEET_STATES = ["collapsed", "half", "expanded"];
export const DEFAULT_SHEET_STATE = "half";

/* Kept in sync with the panel's own mobile breakpoint in map.css. */
export const SHEET_BREAKPOINT = "(max-width: 820px)";

export function isValidSheetState(value) {
  return SHEET_STATES.includes(value);
}

/* Move one step toward "expanded" (direction > 0) or "collapsed" (direction
   < 0), clamped at either end — used by both the drag gesture and arrow-key
   handling on the handle. */
export function stepState(state, direction) {
  const i = SHEET_STATES.indexOf(state);
  const from = i < 0 ? SHEET_STATES.indexOf(DEFAULT_SHEET_STATE) : i;
  const next = Math.min(SHEET_STATES.length - 1, Math.max(0, from + Math.sign(direction)));
  return SHEET_STATES[next];
}

/* Tap-to-cycle on the handle: collapsed → half → expanded → collapsed. */
export function cycleState(state) {
  const i = SHEET_STATES.indexOf(state);
  const from = i < 0 ? SHEET_STATES.indexOf(DEFAULT_SHEET_STATE) : i;
  return SHEET_STATES[(from + 1) % SHEET_STATES.length];
}

/**
 * Where a drag gesture should land. `deltaY` is total pointer movement in CSS
 * pixels since the drag started — negative is UP (toward the screen top,
 * i.e. toward "expanded" for a sheet anchored to the bottom), positive is
 * DOWN. A drag shorter than `threshold` snaps back to where it started
 * (reads as a tap-and-release, not a resize), matching standard bottom-sheet
 * behaviour rather than jumping on the slightest touch jitter.
 */
export function resolveDragState(startState, deltaY, threshold = 48) {
  if (deltaY <= -threshold) return stepState(startState, 1);
  if (deltaY >= threshold) return stepState(startState, -1);
  return isValidSheetState(startState) ? startState : DEFAULT_SHEET_STATE;
}

/**
 * Wire pointer-drag + keyboard on the handle, and apply `data-sheet-state`
 * to the panel. Returns { getState, setState, destroy }. No-ops safely if
 * either element is missing (desktop markup reuse, or a panel not yet
 * rendered) so callers never need to guard the call site.
 *
 * Non-modal by design: unlike the sidebar drawer, this never sets `inert` or
 * traps focus — the map's own layer switcher must stay reachable while the
 * sheet is open, at any of its three states (task requirement).
 */
export function bindMapSheet(panel, handle, { initialState = DEFAULT_SHEET_STATE, onChange } = {}) {
  let current = isValidSheetState(initialState) ? initialState : DEFAULT_SHEET_STATE;

  const apply = (next, { silent = false } = {}) => {
    current = next;
    if (panel) panel.dataset.sheetState = current;
    if (handle) handle.setAttribute("aria-expanded", String(current !== "collapsed"));
    if (!silent) onChange?.(current);
  };
  apply(current, { silent: true });

  if (!panel || !handle) {
    return { getState: () => current, setState: apply, destroy: () => {} };
  }

  let dragStartY = null;
  let dragStartState = current;
  /* A pointerup after real movement still fires a native "click" right
     after — tracked so that click doesn't ALSO cycle the state endDrag just
     resolved. A click with no preceding movement is a genuine tap, and is
     left for onClick to handle. */
  let wasDragged = false;
  const TAP_TOLERANCE_PX = 6;

  const onPointerDown = (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    dragStartY = event.clientY;
    dragStartState = current;
    wasDragged = false;
    /* Best-effort: keeps receiving pointermove even if the finger/cursor
       leaves the handle mid-drag. Can throw for a pointer the browser never
       registered as active (e.g. a synthetic event) — capture is purely an
       enhancement, so a failure here must not abort the drag itself. */
    try {
      handle.setPointerCapture?.(event.pointerId);
    } catch {
      /* no-op */
    }
    panel.classList.add("is-dragging");
  };
  const onPointerMove = (event) => {
    if (dragStartY === null) return;
    const deltaY = event.clientY - dragStartY;
    if (Math.abs(deltaY) > TAP_TOLERANCE_PX) wasDragged = true;
    /* Live-follow the finger/pointer via a transform, bypassing the CSS
       transition used for the snapped states — cleared on release. */
    panel.style.transform = `translateY(${Math.max(0, deltaY)}px)`;
  };
  const endDrag = (event) => {
    if (dragStartY === null) return;
    const deltaY = event.clientY - dragStartY;
    dragStartY = null;
    panel.classList.remove("is-dragging");
    panel.style.transform = "";
    if (wasDragged) apply(resolveDragState(dragStartState, deltaY));
  };

  const onKeydown = (event) => {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      apply(stepState(current, 1));
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      apply(stepState(current, -1));
    } else if (event.key === "Home") {
      event.preventDefault();
      apply("expanded");
    } else if (event.key === "End") {
      event.preventDefault();
      apply("collapsed");
    }
  };
  const onClick = () => {
    if (wasDragged) {
      wasDragged = false;
      return;
    }
    apply(cycleState(current));
  };

  handle.addEventListener("pointerdown", onPointerDown);
  handle.addEventListener("pointermove", onPointerMove);
  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);
  handle.addEventListener("keydown", onKeydown);
  handle.addEventListener("click", onClick);

  return {
    getState: () => current,
    setState: apply,
    destroy: () => {
      handle.removeEventListener("pointerdown", onPointerDown);
      handle.removeEventListener("pointermove", onPointerMove);
      handle.removeEventListener("pointerup", endDrag);
      handle.removeEventListener("pointercancel", endDrag);
      handle.removeEventListener("keydown", onKeydown);
      handle.removeEventListener("click", onClick);
    },
  };
}
