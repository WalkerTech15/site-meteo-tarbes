/* Browser-history plumbing for the shareable URL state.
 *
 * Deliberately thin and dependency-free (only core/url-state.js): all the
 * parsing, validation and clamping lives there and is unit-tested without a
 * browser, while this file owns the parts that genuinely need `window` —
 * pushState/replaceState, popstate/hashchange, and the debounce that keeps
 * ordinary panning out of the back button's way.
 *
 * Two write modes, matching how the two kinds of change feel to a user:
 *   push    — a semantic action (picking a place, switching layer or time,
 *             changing view). Back should undo it.
 *   replace — incidental camera drift from panning and zooming. Debounced, so
 *             a single drag writes one entry instead of sixty. */
import { parseAppUrl, buildAppUrl } from "../core/url-state.js";

/* Long enough that a continuous drag or pinch settles first, short enough
   that a refresh right after letting go still restores where you were. */
export const URL_REPLACE_DEBOUNCE_MS = 400;

let pendingTimer = null;
let pendingHash = null;
/* the last hash this module wrote, so our own writes are not mistaken for
   user navigation when hashchange fires */
let lastWritten = null;
/* the last hash actually handed to the change handler. Back/Forward across a
   hash-only change fires popstate AND hashchange for the SAME hash, and
   restoring twice concurrently is both wasteful and racy — two restores of the
   same weather layer would fight over which one gets to finish. */
let lastSeen = null;

export function readUrlState() {
  return parseAppUrl(window.location.hash);
}

function commit(hash, replace) {
  if (hash === window.location.hash) return;
  lastWritten = hash;
  lastSeen = hash;
  try {
    /* Relative URL: resolved against the current document, so this keeps
       working from a domain root and from a project subdirectory alike. */
    if (replace) window.history.replaceState(null, "", hash);
    else window.history.pushState(null, "", hash);
  } catch {
    /* history unavailable (file:// in some browsers) — the app still works,
       it just isn't linkable */
    lastWritten = null;
  }
}

export function flushUrlState() {
  if (pendingTimer === null) return;
  clearTimeout(pendingTimer);
  pendingTimer = null;
  const hash = pendingHash;
  pendingHash = null;
  if (hash) commit(hash, true);
}

/** Drop a queued camera write without applying it.
 *
 *  Needed before restoring state FROM the URL: a debounced pan/zoom write that
 *  is still in flight describes the view the user is navigating away from, and
 *  replaceState would stamp it over the entry they just navigated to — quietly
 *  undoing their Back. */
export function cancelPendingUrlState() {
  if (pendingTimer !== null) clearTimeout(pendingTimer);
  pendingTimer = null;
  pendingHash = null;
}

/**
 * Write app state to the URL.
 * @param {object} appState  shape accepted by buildAppUrl()
 * @param {object} options   { replace, debounceMs }
 */
export function writeUrlState(appState, { replace = false, debounceMs = 0 } = {}) {
  const hash = buildAppUrl(appState);
  if (!replace || debounceMs <= 0) {
    /* a semantic change supersedes any queued camera write — the queued hash
       is already folded into the state we are writing now */
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
      pendingHash = null;
    }
    commit(hash, replace);
    return hash;
  }
  pendingHash = hash;
  if (pendingTimer !== null) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    const queued = pendingHash;
    pendingHash = null;
    if (queued) commit(queued, true);
  }, debounceMs);
  return hash;
}

/**
 * Subscribe to Back/Forward (and a hand-edited hash). Our own pushState /
 * replaceState calls fire neither event, and the `lastWritten` guard covers
 * the hashchange a manual edit produces for a hash we just wrote ourselves.
 */
export function onUrlChange(handler) {
  const notify = () => {
    const hash = window.location.hash;
    /* our own write, or the duplicate event for a hash we just handled */
    if (hash === lastWritten || hash === lastSeen) return;
    lastWritten = null;
    lastSeen = hash;
    handler(parseAppUrl(hash));
  };
  window.addEventListener("popstate", notify);
  window.addEventListener("hashchange", notify);
  return () => {
    window.removeEventListener("popstate", notify);
    window.removeEventListener("hashchange", notify);
  };
}
