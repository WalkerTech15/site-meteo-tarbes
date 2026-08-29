/* Side-by-side comparison table, rendered into the Favorites view.
 *
 * Two halves on purpose:
 *   - formatComparisonCell / buildComparisonRows are PURE, so every unit
 *     conversion and every "no data" case is unit-testable without a DOM.
 *   - renderComparison does the markup and the event wiring.
 *
 * Accessibility: this is a real <table> with a <caption>, row headers
 * (scope="row") for the metric names and column headers (scope="col") for
 * the places, so a screen reader announces "Humidity, Paris, 55%" rather
 * than reading a grid of loose numbers. The picker is a group of real
 * toggle buttons with aria-pressed, and each column carries its own remove
 * button — reachable by keyboard in DOM order, no roving tabindex needed. */
import { $, $$, esc } from "../core/dom.js";
import { t } from "../core/i18n.js";
import { fmtTemp, tempUnit, fmtWind, windUnit, uvLabel } from "../core/units.js";
import { locName, locAccessibleName, locCountryFlagHtml, localTimeStr } from "../core/location.js";
import {
  COMPARISON_METRICS,
  comparableLocations,
  comparisonLocations,
  comparisonWx,
  isCompared,
  toggleComparison,
  removeFromComparison,
  clearComparison,
  comparisonFull,
  loadComparisonWeather,
} from "../features/comparison.js";
import { showToast } from "./notifications.js";

const DASH = "—";

/* One metric of one place, already formatted for display in the visitor's
   chosen units. Returns the em dash for anything missing, so a partial
   response (air quality is a separate service and may fail alone) degrades
   per cell rather than blanking the column. */
export function formatComparisonCell(metric, entry) {
  if (!entry) return DASH;
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  switch (metric) {
    case "temperature": {
      const v = num(entry.temp);
      return v === null ? DASH : `${fmtTemp(v)}${tempUnit()}`;
    }
    case "feelsLike": {
      const v = num(entry.feelsLike);
      return v === null ? DASH : `${fmtTemp(v)}${tempUnit()}`;
    }
    case "humidity": {
      const v = num(entry.humidity);
      return v === null ? DASH : `${Math.round(v)}%`;
    }
    case "wind": {
      const v = num(entry.wind);
      return v === null ? DASH : `${fmtWind(v)} ${windUnit()}`;
    }
    case "precipitation": {
      const v = num(entry.precipitation);
      return v === null ? DASH : `${Math.round(v)}%`;
    }
    case "uv": {
      const v = num(entry.uv);
      return v === null ? DASH : `${Math.round(v)} · ${uvLabel(v)}`;
    }
    case "airQuality": {
      const v = num(entry.aqi);
      return v === null ? DASH : String(Math.round(v));
    }
    case "localTime":
      return localTimeStr(entry.timezone) || DASH;
    default:
      return DASH;
  }
}

/* The whole table as data: one row per metric, one cell per selected place.
   `wx` is passed in rather than read from the module so tests can supply a
   fixture. */
export function buildComparisonRows(locs, wx = {}) {
  return COMPARISON_METRICS.map((metric) => ({
    metric,
    label: t(metric === "uv" ? "uvIndex" : metric),
    cells: locs.map((loc) => formatComparisonCell(metric, wx[loc.id])),
  }));
}

function pickerHtml() {
  const options = comparableLocations();
  if (!options.length) {
    return `<p class="compare-empty">${esc(t("compareNoPlaces"))}</p>`;
  }
  return `<div class="compare-picker" role="group" aria-label="${esc(t("comparePick"))}">
      ${options
        .map((loc) => {
          const on = isCompared(loc);
          /* Disabled only when the cap is reached AND this one is not
             already selected — a selected chip must always stay clickable
             so the visitor can free a slot. */
          const disabled = !on && comparisonFull();
          const label = (on ? t("compareRemove") : t("compareAdd")).replace(
            "{name}",
            locAccessibleName(loc),
          );
          return `<button type="button" class="compare-chip" data-compare-id="${esc(loc.id)}"
              aria-pressed="${on}" ${disabled ? "disabled" : ""} aria-label="${esc(label)}">
              ${locCountryFlagHtml(loc)}<span>${esc(locName(loc))}</span>
            </button>`;
        })
        .join("")}
    </div>`;
}

function tableHtml(locs) {
  const rows = buildComparisonRows(locs, comparisonWx);
  return `<div class="table-scroll">
      <table class="compare-table">
        <caption class="sr-only">${esc(t("compareTitle"))}</caption>
        <thead>
          <tr>
            <th scope="col">${esc(t("compareMetric"))}</th>
            ${locs
              .map(
                (loc) => `<th scope="col">
                  <span class="compare-col">
                    <span class="compare-col-name">${locCountryFlagHtml(loc)}${esc(locName(loc))}</span>
                    <button type="button" class="compare-remove" data-compare-remove="${esc(loc.id)}"
                      aria-label="${esc(t("compareRemove").replace("{name}", locAccessibleName(loc)))}">
                      <span aria-hidden="true">×</span>
                    </button>
                  </span>
                </th>`,
              )
              .join("")}
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `<tr>
                <th scope="row">${esc(row.label)}</th>
                ${row.cells.map((cell) => `<td>${esc(cell)}</td>`).join("")}
              </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>`;
}

/* Which control inside the block currently has focus, as a selector that
   will still match after the block is rebuilt.

   Toggling a chip replaces the whole block's markup, which destroys the
   very button the visitor just activated — a mouse user never notices, but
   a keyboard user is dropped back to <body> and loses their place. The
   selector is rebuilt from the control's own data attribute rather than
   held as a node reference, precisely because the node does not survive. */
function focusedControlSelector(host) {
  const active = document.activeElement;
  if (!active || !host.contains(active)) return "";
  if (active.dataset.compareId)
    return `[data-compare-id="${CSS.escape(active.dataset.compareId)}"]`;
  if (active.dataset.compareRemove) {
    return `[data-compare-remove="${CSS.escape(active.dataset.compareRemove)}"]`;
  }
  if (active.id === "compareClearBtn") return "#compareClearBtn";
  return "";
}

/* Puts focus back on the equivalent control after a rebuild. Falls back to
   the picker's first chip when the exact control is gone (the visitor
   removed the column they were standing on), so focus never lands on
   <body>. */
function restoreFocus(host, selector) {
  if (!selector) return;
  const target = $(selector, host) || $(".compare-chip", host);
  target?.focus();
}

export function renderComparison() {
  const host = $("#compareBlock");
  if (!host) return;
  const locs = comparisonLocations();
  const previouslyFocused = focusedControlSelector(host);

  host.innerHTML = `
    <div class="block-head compare-head">
      <div>
        <h2 class="section-title sm" id="compareTitle">${esc(t("compareTitle"))}</h2>
        <p class="section-sub">${esc(t("compareSub"))}</p>
      </div>
      ${
        locs.length
          ? `<button type="button" class="compare-clear" id="compareClearBtn">${esc(t("compareClear"))}</button>`
          : ""
      }
    </div>
    <div class="card compare-card">
      ${pickerHtml()}
      ${
        locs.length >= 2
          ? tableHtml(locs)
          : comparableLocations().length
            ? `<p class="compare-empty">${esc(t("compareEmpty"))}</p>`
            : ""
      }
    </div>`;

  $$("[data-compare-id]", host).forEach((btn) =>
    btn.addEventListener("click", () => {
      const loc = comparableLocations().find((l) => l.id === btn.dataset.compareId);
      if (!loc) return;
      const result = toggleComparison(loc);
      /* Silently doing nothing at the cap would read as a broken button */
      if (result === "full") return showToast(t("compareFull"));
      refreshComparison();
    }),
  );
  $$("[data-compare-remove]", host).forEach((btn) =>
    btn.addEventListener("click", () => {
      removeFromComparison(btn.dataset.compareRemove);
      refreshComparison();
    }),
  );
  $("#compareClearBtn")?.addEventListener("click", () => {
    clearComparison();
    refreshComparison();
  });

  restoreFocus(host, previouslyFocused);
}

/* Repaint, then fetch, then repaint again — so a click feels immediate
   (the column appears at once, showing dashes) and fills in when the
   batched request lands. loadComparisonWeather is latest-only, so a rapid
   sequence of picks can only ever paint the last one. */
export function refreshComparison() {
  renderComparison();
  if (comparisonLocations().length < 2) return;
  loadComparisonWeather(true).then(() => renderComparison());
}

/* Called when the view opens: same flow, but honouring the freshness
   window rather than forcing a refetch. */
export function loadComparison() {
  renderComparison();
  if (comparisonLocations().length < 2) return;
  loadComparisonWeather().then(() => renderComparison());
}
