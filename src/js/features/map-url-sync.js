/* Keeps the URL and the app in step, in both directions.
 *
 * Reads app state through small getters and writes it through the existing
 * entry points (switchView, setMapLayer, jumpTo, selectCoordinate); it owns no
 * state of its own beyond the share-consent flag. Producers announce changes
 * on core/app-bus.js instead of calling in here, so nothing imports this file
 * except main.js.
 *
 * Privacy rule, enforced in one place — snapshot():
 *   While the selected location is a device-geolocation fix, neither the
 *   selection nor the camera is written to the URL. A precise home address
 *   must not end up in a link because the page happened to be open. The user
 *   can still share it, but only by pressing Share, which is what sets
 *   `shareConsent`.
 *
 *   Consent is revoked on "location:selecting", NOT "location:selected".
 *   features/location.js sets state.loc synchronously but only emits
 *   "location:selected" once that location's weather has finished loading —
 *   and a pan, view switch or layer change firing during that wait would
 *   otherwise snapshot the new (already-current) state.loc under whatever
 *   consent value a PREVIOUS, different location left behind. "selecting"
 *   fires synchronously, before that gap opens, so no other handler can ever
 *   observe the new state.loc next to a stale consent.
 *
 * No API key, session id or other private value is ever encoded: the URL
 * carries a view name, two coordinates, a zoom, a layer id, an hour offset
 * and a boolean (see core/url-state.js). */
import { state } from "../core/state.js";
import { t } from "../core/i18n.js";
import { on } from "../core/app-bus.js";
import { showToast } from "../ui/notifications.js";
import { switchView } from "../ui/navigation.js";
import { isMapPanelOpen, showMapPanel, hideMapPanel } from "../ui/render-map.js";
import { getMapCamera, getMapOverlayState, setMapLayer, jumpTo } from "./map.js";
import { selectCoordinate } from "./map-click.js";
import { isDeviceLocation } from "./recent-locations.js";
import {
  readUrlState,
  writeUrlState,
  onUrlChange,
  cancelPendingUrlState,
  URL_REPLACE_DEBOUNCE_MS,
} from "./map-url.js";

/* Two selections closer than this are the same place as far as the URL is
   concerned (~11 m), so a restore does not re-fetch what is already shown. */
const SAME_PLACE_EPSILON = 1e-4;

let shareConsent = false;
let applying = false;
/* The first write of a session replaces rather than pushes: the app selecting
   its start location is not a navigation the user made, and pushing there
   would leave a Back button that goes nowhere useful. */
let hasWritten = false;
/* The camera a shared link asked for, held until the map exists to receive it.
   Without this, normalizing the URL right after a restore would read "no map
   yet → no camera" and quietly drop the c/z the link was carrying. */
let lastCamera = null;
/* a URL that arrived while a restore was still running */
let queuedUrl = null;

function samePoint(a, b) {
  if (!a || !b) return false;
  return (
    Math.abs(a.lat - b.lat) < SAME_PLACE_EPSILON && Math.abs(a.lon - b.lon) < SAME_PLACE_EPSILON
  );
}

function snapshot() {
  const overlay = getMapOverlayState();
  const camera = getMapCamera() || lastCamera;
  /* the one privacy gate */
  const shareCoords = !isDeviceLocation(state.loc) || shareConsent;
  return {
    view: state.view,
    sel: shareCoords && state.loc ? { lat: state.loc.lat, lon: state.loc.lon } : null,
    center: shareCoords && camera ? { lat: camera.lat, lon: camera.lon } : null,
    zoom: shareCoords && camera ? camera.zoom : null,
    layer: overlay.type,
    offset: overlay.offset,
    /* the panel only exists on the map page */
    panel: state.view === "map" ? isMapPanelOpen() : null,
  };
}

/* `camera` = incidental drift from panning/zooming: debounced replaceState, so
   a drag never floods the back button. Everything else is a semantic action
   and gets its own history entry. */
function sync(kind = "semantic") {
  if (applying) return;
  const camera = kind === "camera";
  const replace = camera || !hasWritten;
  hasWritten = true;
  writeUrlState(snapshot(), {
    replace,
    debounceMs: camera ? URL_REPLACE_DEBOUNCE_MS : 0,
  });
}

async function applyUrlState(url, { initial = false } = {}) {
  /* A queued pan/zoom write describes the view being navigated AWAY from;
     letting it land would replaceState over the entry we are restoring. */
  cancelPendingUrlState();
  /* A second navigation arriving mid-restore wins: remember it and re-run once
     the first finishes, rather than interleaving two restores on one map. */
  if (applying) {
    queuedUrl = url;
    return;
  }
  applying = true;
  try {
    if (url.view !== state.view) switchView(url.view);

    /* Selection: restored from the coordinate, through the same pipeline a
       map click uses, so the name/region/country/flags come out identical. */
    const current = state.loc ? { lat: state.loc.lat, lon: state.loc.lon } : null;
    if (url.sel && !samePoint(url.sel, current)) {
      await selectCoordinate(url.sel.lat, url.sel.lon, {
        onLoading: () => showMapPanel(),
        onError: () => showToast(t("mapClickGeoError")),
      });
    }

    /* Layer + forecast time. setMapLayer awaits updateMap() and the map's own
       readiness before touching a style, so this is safe on a cold load. */
    const overlay = getMapOverlayState();
    if (url.layer !== overlay.type || url.offset !== overlay.offset) {
      await setMapLayer(url.layer, { offset: url.offset });
    }

    /* Camera last: selecting a place moves it, so the shared view must win.
       jumpTo() queues the camera when the map has not been built yet, and
       features/map.js applies it as soon as it is. */
    if (url.center) {
      lastCamera = { ...url.center, zoom: url.zoom };
      jumpTo([url.center.lon, url.center.lat], url.zoom ?? undefined, {
        duration: initial ? 0 : 800,
      });
    }

    if (url.panel === true) showMapPanel();
    else if (url.panel === false) hideMapPanel();
  } catch {
    /* a restore that partly fails leaves a working app on whatever it did
       manage to apply — never a blank screen */
  } finally {
    applying = false;
  }

  if (queuedUrl) {
    const next = queuedUrl;
    queuedUrl = null;
    await applyUrlState(next);
  }
}

/** Explicit share: the only path that may publish a device-location
 *  coordinate. Writes the full URL and copies it to the clipboard. */
export async function shareMapView() {
  shareConsent = true;
  sync("semantic");
  const href = window.location.href;
  try {
    await navigator.clipboard.writeText(href);
    showToast(t("mapShareCopied"));
  } catch {
    /* no clipboard permission (or no clipboard API): the address bar now
       holds the shareable link, so say that instead of failing silently */
    showToast(t("mapShareInAddressBar"));
  }
  return href;
}

export function initUrlSync() {
  on("view:changed", () => sync());
  on("location:selecting", () => {
    /* a new place is a new decision — consent to publish the previous
       coordinate never carries over, even when the new selection is ALSO a
       device fix. Fires synchronously, before state.loc's weather has even
       started loading — see the module comment above for why that timing
       matters. Deliberately does not call sync(): state.loc has not
       necessarily changed shape yet from any writer's point of view, and the
       next event that legitimately needs a write (map:moved, location:
       selected, ...) will call sync() itself with this flag already correct. */
    shareConsent = false;
  });
  on("location:selected", () => sync());
  on("map:layer", () => sync());
  on("map:panel", () => sync());
  on("map:moved", (payload) => {
    if (payload?.id !== "worldMap") return;
    lastCamera = { lat: payload.lat, lon: payload.lon, zoom: payload.zoom };
    sync("camera");
  });

  onUrlChange((url) => applyUrlState(url));
}

/** Restore whatever the opening URL asked for. Called once, after the app's
 *  normal bootstrap, so an empty hash simply leaves the default alone. */
export async function restoreInitialUrlState() {
  const url = readUrlState();
  await applyUrlState(url, { initial: true });
  /* normalize the address bar to the canonical form without adding history */
  hasWritten = true;
  writeUrlState(snapshot(), { replace: true });
}

/** True when the opening URL selects a location, so the bootstrap can skip
 *  loading the stored "last location" that the URL is about to replace. */
export function urlHasSelection() {
  return readUrlState().sel !== null;
}
