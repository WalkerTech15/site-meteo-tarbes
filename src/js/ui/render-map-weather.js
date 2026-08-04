/* The overlay controls that sit beside the map: the forecast-time selector
   (Now / +3 h / +6 h) and the legend for the active weather layer.
 *
 * Both live in #mapWeatherControls, a sibling of #worldMap inside the map
 * card — never inside the map container. That placement is deliberate: a
 * click on a legend or a time button is then structurally incapable of
 * reaching MapLibre's canvas listeners, so it can never be mistaken for a
 * "select this coordinate" map click.
 *
 * Satellite is the plain basemap and carries no weather data, so it gets no
 * legend and no timeline at all — the whole block is emptied and hidden. */
import { $, $$, esc } from "../core/dom.js";
import { t } from "../core/i18n.js";
import { fmtDateTime } from "../core/datetime.js";
import { TIME_OFFSETS } from "../features/map-timeline.js";
import { legendModel, normalizeRampStops, hasLegend } from "../features/map-legend.js";

const LEGEND_TITLE_KEYS = {
  temperature: "temperature",
  rain: "precipitation",
  wind: "windSpeed",
};

const OFFSET_LABEL_KEYS = { 0: "mapTimeNow", 3: "mapTimePlus3", 6: "mapTimePlus6" };

function timeStatusText(overlay) {
  if (overlay.status === "loading") return t("mapTimeLoading");
  if (overlay.status === "error") return t("mapTimeError");
  if (overlay.status === "unavailable") return t("mapTimeUnavailable");
  if (!overlay.timeMs) return t("mapTimeUnavailable");
  const shown = t("mapTimeShowing").replace("{time}", fmtDateTime(overlay.timeMs));
  return overlay.clamped ? `${shown} — ${t("mapTimeClamped")}` : shown;
}

function timelineHtml(overlay) {
  const buttons = TIME_OFFSETS.map((offset) => {
    const active = overlay.offset === offset;
    /* an offset the loaded frames cannot reach is disabled rather than
       silently showing the same picture as its neighbour */
    const reachable = overlay.status !== "ready" || overlay.offsets.includes(offset);
    return `<button class="map-time" type="button" role="radio"
        data-map-time="${offset}"
        aria-checked="${active}"
        tabindex="${active ? 0 : -1}"
        ${reachable ? "" : "disabled"}>${esc(t(OFFSET_LABEL_KEYS[offset]))}</button>`;
  }).join("");

  return `
    <div class="map-time-row" role="radiogroup" aria-label="${esc(t("mapTimeline"))}">
      ${buttons}
    </div>
    <p class="map-time-status" ${overlay.status === "loading" ? 'data-loading="1"' : ""}>${esc(
      timeStatusText(overlay),
    )}</p>`;
}

/* The legend view-model, or null when there is nothing to draw one from
   (satellite, a layer still loading, or a ramp the provider did not supply).
   Built once per render and shared by the markup and the painting pass. */
function legendFor(overlay) {
  if (!hasLegend(overlay.type) || overlay.status !== "ready") return null;
  return legendModel(overlay.type, normalizeRampStops(overlay.colorRamp));
}

function legendHtml(overlay, legend) {
  if (!hasLegend(overlay.type) || overlay.status !== "ready") return "";
  if (!legend) {
    return `<p class="map-legend-empty">${esc(t("mapLegendUnavailable"))}</p>`;
  }

  const title = `${t(LEGEND_TITLE_KEYS[overlay.type])} (${legend.unit})`;
  const scale = t("mapLegendScale")
    .replace("{min}", legend.minLabel)
    .replace("{max}", legend.maxLabel)
    .replace("{unit}", legend.unit);
  const ticks = legend.ticks
    .map((tick) => `<li data-pct="${tick.pct}"><span>${esc(tick.label)}</span></li>`)
    .join("");

  return `
    <figure class="map-legend" data-legend="${esc(overlay.type)}">
      <figcaption class="map-legend-title">${esc(title)}</figcaption>
      <div class="map-legend-bar" role="img" aria-label="${esc(scale)}"></div>
      <ol class="map-legend-ticks">${ticks}</ol>
    </figure>`;
}

/* The gradient and tick offsets are numeric values derived from the layer's
   own color ramp; they are applied as element styles rather than interpolated
   into the markup so no provider-supplied value ever reaches an HTML string. */
function paintLegend(host, legend) {
  const bar = $(".map-legend-bar", host);
  if (!bar || !legend) return;
  bar.style.backgroundImage = legend.gradient;
  $$(".map-legend-ticks li", host).forEach((item) => {
    const pct = Number(item.dataset.pct);
    if (Number.isFinite(pct)) item.style.left = `${pct}%`;
  });
}

/* Roving-tabindex arrow navigation, the same pattern the theme menu uses:
   one tab stop for the group, arrows move between the options and select. */
function bindTimeline(host, onSelectTime) {
  const buttons = $$(".map-time", host);
  buttons.forEach((button) => {
    button.addEventListener("click", () => onSelectTime(Number(button.dataset.mapTime)));
  });
  const row = $(".map-time-row", host);
  row?.addEventListener("keydown", (event) => {
    const usable = buttons.filter((button) => !button.disabled);
    if (!usable.length) return;
    const index = usable.indexOf(document.activeElement);
    let next = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % usable.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      next = (index - 1 + usable.length) % usable.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = usable.length - 1;
    if (next === null) return;
    event.preventDefault();
    usable[next].focus();
    onSelectTime(Number(usable[next].dataset.mapTime));
  });
}

/**
 * Repaint the overlay controls.
 * @param {object} overlay  the map's overlay description (type, status,
 *                          offset, colorRamp, timeMs, clamped, offsets)
 * @param {object} handlers { onSelectTime }
 */
export function renderWeatherOverlayUI(overlay, { onSelectTime } = {}) {
  const host = $("#mapWeatherControls");
  if (!host) return;

  if (!overlay || overlay.type === "satellite") {
    host.replaceChildren();
    host.hidden = true;
    return;
  }

  /* re-rendering replaces the buttons, so remember whether focus was inside
     the group and put it back on the equivalent control afterwards */
  const focusedOffset = document.activeElement?.closest?.(".map-time")?.dataset.mapTime;

  const legend = legendFor(overlay);
  host.hidden = false;
  host.innerHTML = `${timelineHtml(overlay)}${legendHtml(overlay, legend)}`;
  paintLegend(host, legend);
  if (onSelectTime) bindTimeline(host, onSelectTime);

  if (focusedOffset !== undefined) {
    $(`.map-time[data-map-time="${focusedOffset}"]`, host)?.focus();
  }
}
