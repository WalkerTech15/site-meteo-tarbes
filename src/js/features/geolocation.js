/* "My location" sidebar widget (real browser geolocation).
   States: idle (never asked) → locating → success | denied | unavailable.
   Permission is only requested on an explicit user action, except when the
   Permissions API says it was already granted. Last fix cached 30 min. */
import { state } from "../core/state.js";
import { $ } from "../core/dom.js";
import { t } from "../core/i18n.js";
import { getJSON, setJSON, KEYS } from "../core/storage.js";
import { GEO_FIX_TTL_MS } from "../core/config.js";
import { fmtTemp, tempUnit } from "../core/units.js";
import { weatherIcon } from "../data/icons.js";
import { wmo, wxDesc } from "../data/weather-codes.js";
import { fetchWeather, demoWeather } from "../services/weather-api.js";
import { reverseGeocode } from "../services/geocoding-api.js";
import { showUserLocation } from "./map.js";
import { locName, locRegion, locCountry } from "../core/location.js";
import { selectLocation } from "./location.js";
import { switchView } from "../ui/navigation.js";

export let geoState = { status: "idle", loc: null, wx: null };

function geoLocFrom(lat, lon, info) {
  /* honest fallback: raw coordinates when reverse geocoding gave nothing */
  const name = info.name || `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`;
  return {
    /* id must be coordinate-derived, not a constant: favorites are matched by id
       alone, so a fixed "geo-me" made a second saved fix silently overwrite the
       first one instead of adding a distinct favorite. ~11 m of precision. */
    id: `geo-me-${lat.toFixed(4)},${lon.toFixed(4)}`,
    kind: "city",
    cc: info.cc || "",
    flag: "📍",
    lat,
    lon,
    name: { en: name, fr: name },
    region: { en: info.region || "", fr: info.region || "" },
    country: { en: info.country || "", fr: info.country || "" },
    landmark: null,
    aliases: [],
    grad: ["#3B82F6", "#1E40AF"],
    dynamic: true,
  };
}

export async function applyGeoSuccess(lat, lon, info, opts = {}) {
  const { persist = false, acc = null, recenter = false } = opts;
  const loc = geoLocFrom(lat, lon, info);
  geoState = { status: "success", loc, wx: null };
  renderSidePos();
  if (persist) setJSON(KEYS.geo, { lat, lon, acc, ...info, at: Date.now() });
  if (acc != null) showUserLocation(lat, lon, acc); /* Google-style blue dot + accuracy ring */
  if (recenter) {
    await selectLocation(loc); /* move map, marker/popup, weather, hero — no pin blink */
    geoState.wx = state.wx; /* reuse the just-fetched weather for the card */
  } else {
    try {
      geoState.wx = await fetchWeather(loc);
    } catch {
      geoState.wx = demoWeather(loc);
    }
  }
  renderSidePos();
}

/* recenter=true (explicit tap): move the map to the fix. recenter=false
   (silent restore of a granted/cached fix on load): only fill the card + dot. */
export function locateMe(recenter = true) {
  if (geoState.status === "locating") return;
  if (!("geolocation" in navigator)) {
    geoState = { status: "unsupported", loc: null, wx: null };
    renderSidePos();
    return;
  }
  geoState = { status: "locating", loc: null, wx: null };
  renderSidePos();
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude: lat, longitude: lon, accuracy } = pos.coords;
      let info = {};
      try {
        info = await reverseGeocode(lat, lon);
      } catch {
        /* coords shown instead */
      }
      applyGeoSuccess(lat, lon, info, { persist: true, acc: accuracy, recenter });
    },
    (err) => {
      /* 1 = denied, 2 = position unavailable, 3 = timeout */
      const status = err.code === 1 ? "denied" : err.code === 3 ? "timeout" : "unavailable";
      geoState = { status, loc: null, wx: null };
      renderSidePos();
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
  );
}

export async function initGeo() {
  /* fresh cached fix → no permission prompt, no geolocation call at all */
  const c = getJSON(KEYS.geo, null);
  if (c && Date.now() - c.at < GEO_FIX_TTL_MS) {
    applyGeoSuccess(c.lat, c.lon, c, { acc: c.acc });
    return;
  }
  let perm = "prompt";
  try {
    perm = (await navigator.permissions.query({ name: "geolocation" })).state;
  } catch {
    /* Permissions API unavailable — treat as "prompt" */
  }
  if (perm === "granted") locateMe(false); /* already allowed — refresh card, don't hijack view */
  else if (perm === "denied") {
    geoState.status = "denied";
    renderSidePos();
  } else renderSidePos(); /* idle: wait for an explicit tap */
}

export function renderSidePos() {
  const box = $("#sidePosBox");
  if (!box) return;
  box.hidden = false;
  const body = $("#sidePosBtn"),
    nameEl = $("#sidePosName"),
    wxEl = $("#sidePosWx");
  const retry = $("#geoRetryBtn");
  retry.disabled = geoState.status === "locating";
  const s = geoState.status;
  box.classList.remove("is-collapsed", "is-expanded");
  if (s === "success" && geoState.loc) {
    const loc = geoState.loc;
    nameEl.textContent = [locName(loc), locRegion(loc), locCountry(loc)].filter(Boolean).join(", ");
    wxEl.innerHTML = geoState.wx
      ? `${weatherIcon(wmo(geoState.wx.current.code).icon, geoState.wx.current.isDay)} <b>${fmtTemp(geoState.wx.current.temp)}${tempUnit()}</b> · ${wxDesc(geoState.wx.current.code, state.lang)}`
      : "…";
    body.onclick = () => {
      selectLocation(loc);
      switchView("home");
    };
  } else if (s === "locating") {
    nameEl.innerHTML = `<span class="geo-spin" aria-hidden="true"></span> ${t("geoLocating")}`;
    wxEl.textContent = "";
    body.onclick = null;
  } else if (s === "denied" || s === "unavailable" || s === "timeout" || s === "unsupported") {
    /* collapsed by default so a denied fix doesn't dominate the sidebar on every
       page; click expands the hint, and the header refresh button still retries. */
    box.classList.add("is-collapsed");
    const msg = {
      denied: "geoDenied",
      unavailable: "geoUnavailable",
      timeout: "geoTimeout",
      unsupported: "geoUnsupported",
    }[s];
    nameEl.textContent = t(msg);
    wxEl.textContent = s === "unsupported" ? "" : t("geoRetryHint");
    body.onclick = s === "unsupported" ? null : () => box.classList.toggle("is-expanded");
  } else {
    /* idle */
    nameEl.textContent = t("geoUse");
    wxEl.textContent = "";
    body.onclick = () => locateMe();
  }
}
