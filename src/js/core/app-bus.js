/* Tiny publish/subscribe bus.
 *
 * It exists for exactly one reason: the URL-state layer needs to know when the
 * map camera moved, a weather layer changed, or a location was selected — but
 * features/map.js and features/location.js must NOT import the URL layer back,
 * or the module graph gains a cycle (map → url-sync → map). Emitting a named
 * event instead keeps every import pointing one way: producers depend only on
 * this file, and features/map-url-sync.js subscribes.
 *
 * No DOM, no window — directly unit-testable. */

const listeners = new Map();

export function on(event, handler) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(handler);
  return () => off(event, handler);
}

export function off(event, handler) {
  listeners.get(event)?.delete(handler);
}

export function emit(event, payload) {
  /* copy first: a handler that unsubscribes itself must not mutate the set
     mid-iteration */
  for (const handler of [...(listeners.get(event) || [])]) {
    try {
      handler(payload);
    } catch {
      /* one broken subscriber must never stop the others (or the emitter) */
    }
  }
}

/* test/teardown helper — never used by app code */
export function clearBus() {
  listeners.clear();
}
