/* Location search: instant curated matches, then debounced (300ms) MapTiler
   global autocomplete with request cancellation, keyboard navigation, and a
   keyless Open-Meteo fallback if MapTiler is unavailable. */
import { state } from "../core/state.js";
import { $, $$, esc } from "../core/dom.js";
import { t } from "../core/i18n.js";
import { findLocations, normalize } from "../data/locations.js";
import { maptilerGeocode, geocode } from "../services/geocoding-api.js";
import { locVisual } from "../services/photo-api.js";
import { locName, locRegion, locCountry, kindLabel, flagsHtml } from "../core/location.js";
import { selectLocation } from "./location.js";
import { switchView } from "../ui/navigation.js";

let searchIndex = -1;
let searchResults = [];
let geoTimer = null;
let searchAbort = null; // cancels the in-flight geocoding request when the query changes

/* Merge curated hits (rich landmarks/facts) on top of remote MapTiler results,
   then collapse duplicates by name + country + region so a place that MapTiler
   returns several times (e.g. Tarbes as municipality + place + POI) shows once,
   while genuine same-name places in different regions (Paris FR/TX/ON) stay. */
function dedupKey(l) {
  return `${normalize(l.name.en)}|${l.cc}|${normalize(l.region.en || "")}`;
}
function mergeResults(curated, remote) {
  const seen = new Set();
  const out = [];
  for (const l of curated.concat(remote)) {
    const k = dedupKey(l);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(l);
  }
  return out.slice(0, 8);
}

function openSearchPanel() {
  $("#searchPanel").hidden = false;
  $("#searchCombo").setAttribute("aria-expanded", "true");
}
function closeSearchPanel() {
  $("#searchPanel").hidden = true;
  $("#searchCombo").setAttribute("aria-expanded", "false");
  searchIndex = -1;
}

function renderSearchResults(list) {
  searchResults = list;
  const ul = $("#searchResults");
  if (!list.length) {
    ul.innerHTML = `<li class="search-empty">${t("searchNoResult")}</li>`;
    openSearchPanel();
    return;
  }
  ul.innerHTML = list
    .map(
      (loc, i) => `
    <li role="option" id="sr-${i}" aria-selected="${i === searchIndex}">
      <button class="search-item" data-i="${i}" tabindex="-1">
        <span class="si-visual" aria-hidden="true">${locVisual(loc)}</span>
        <span>
          <span class="si-name">${esc(locName(loc))} ${loc.kind !== "country" ? flagsHtml(loc, "small") : ""}</span><br>
          <span class="si-sub">${
            loc.kind === "country"
              ? esc(locRegion(loc))
              : `${esc(locRegion(loc))}${locRegion(loc) ? ", " : ""}${esc(locCountry(loc))}${loc.landmark ? ` · ${esc(loc.landmark[state.lang] || loc.landmark.en)}` : ""}`
          }</span>
        </span>
        <span class="si-kind">${kindLabel(loc.kind)}</span>
      </button>
    </li>`,
    )
    .join("");
  $$(".search-item", ul).forEach((btn) => {
    btn.addEventListener("click", () => pickSearchResult(+btn.dataset.i));
  });
  openSearchPanel();
}

function pickSearchResult(i) {
  const loc = searchResults[i];
  if (!loc) return;
  /* full place name in the input so the chosen result is unambiguous */
  $("#searchInput").value =
    loc.fullName || [locName(loc), locRegion(loc), locCountry(loc)].filter(Boolean).join(", ");
  closeSearchPanel();
  selectLocation(loc); /* fitBounds/flyTo + marker/popup + weather handled downstream */
  switchView("home");
}

/* Autocomplete: instant curated hits, then debounced (300 ms) MapTiler global
   search. Stale requests are aborted; results are guarded against out-of-order
   arrival by re-checking the input value before rendering. */
function onSearchInput() {
  const q = $("#searchInput").value.trim();
  clearTimeout(geoTimer);
  if (searchAbort) {
    searchAbort.abort();
    searchAbort = null;
  }
  if (!q) {
    closeSearchPanel();
    return;
  }

  const curated = findLocations(q, state.lang);
  if (curated.length) renderSearchResults(curated);
  if (q.length < 2) {
    if (!curated.length) closeSearchPanel();
    return;
  }

  geoTimer = setTimeout(async () => {
    searchAbort = new AbortController();
    const signal = searchAbort.signal;
    try {
      const remote = await maptilerGeocode(q, signal);
      if (signal.aborted || $("#searchInput").value.trim() !== q) return; /* stale */
      const merged = mergeResults(curated, remote);
      renderSearchResults(merged); /* empty list → accessible "no result" state */
    } catch (e) {
      if (e.name === "AbortError" || signal.aborted) return;
      /* MapTiler unreachable/misconfigured → keyless Open-Meteo fallback */
      try {
        const geo = await geocode(q);
        if ($("#searchInput").value.trim() === q) renderSearchResults(mergeResults(curated, geo));
      } catch {
        if (!curated.length) renderSearchResults([]);
      }
    } finally {
      searchAbort = null;
    }
  }, 300);
}

function onSearchKey(e) {
  const max = searchResults.length - 1;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    searchIndex = Math.min(max, searchIndex + 1);
    highlightSearch();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    searchIndex = Math.max(0, searchIndex - 1);
    highlightSearch();
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (searchIndex >= 0) pickSearchResult(searchIndex);
    else if (searchResults.length) pickSearchResult(0);
  } else if (e.key === "Escape") {
    closeSearchPanel();
    $("#searchInput").blur();
  }
}

function highlightSearch() {
  $$("#searchResults [role=option]").forEach((li, i) =>
    li.setAttribute("aria-selected", i === searchIndex),
  );
  const active = $(`#sr-${searchIndex} .search-item`);
  if (active) active.scrollIntoView({ block: "nearest" });
  $("#searchInput").setAttribute(
    "aria-activedescendant",
    searchIndex >= 0 ? `sr-${searchIndex}` : "",
  );
}

export function bindSearchEvents() {
  const input = $("#searchInput");
  input.addEventListener("input", onSearchInput);
  input.addEventListener("keydown", onSearchKey);
  input.addEventListener("focus", () => {
    if (input.value.trim()) onSearchInput();
  });
  $("#favAddBtn").addEventListener("click", () => input.focus());
}

/* used by main.js's document-level "click outside closes overlays" handler */
export { closeSearchPanel };
