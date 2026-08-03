/* Forecast view rendering: day carousel, hourly/precip charts, day
   details & summary, hourly-details strip. */
import { state } from "../core/state.js";
import { $, $$ } from "../core/dom.js";
import { t } from "../core/i18n.js";
import {
  fmtTemp,
  tempUnit,
  fmtWind,
  windUnit,
  compass,
  uvLabel,
  convTemp,
  convWind,
} from "../core/units.js";
import { fmtHour, fmtClock } from "../core/datetime.js";
import { weatherIcon, METRIC_ICONS } from "../data/icons.js";
import { wmo, wxDesc } from "../data/weather-codes.js";
import { locName } from "../core/location.js";
import { precipSummaryText } from "../core/precip-summary.js";
import { computeFadeVisibility } from "../core/carousel-fade.js";
import { renderLineChart, renderBarChart } from "./charts.js";
import { forecastCardHtml } from "./render-home.js";

function updateCarouselFades() {
  const el = $("#forecastRow2");
  if (!el) return;
  const { left, right } = computeFadeVisibility({
    scrollLeft: el.scrollLeft,
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  });
  $("#fcFadeLeft")?.classList.toggle("is-visible", left);
  $("#fcFadeRight")?.classList.toggle("is-visible", right);
}

/* Bound once at startup — re-renders reset scrollLeft to 0 and already call
   updateCarouselFades() themselves, so only the scroll gesture itself needs a
   listener here. */
export function bindForecastCarousel() {
  $("#forecastRow2")?.addEventListener("scroll", updateCarouselFades, { passive: true });
}

/* Forecast-page hourly strip — samples every 3rd hour over a wider span
   (unlike the home view's renderHomeHourly, which shows 6 consecutive hours). */
export function renderHourly() {
  const nowLabel = state.lang === "fr" ? "Maint." : "Now";
  const cells = state.wx.hourly.filter((_, i) => i % 3 === 0).slice(0, 8);
  $("#hourlyStrip").innerHTML = cells
    .map(
      (h, i) => `
    <div class="hour-cell ${i === 0 ? "is-now" : ""}">
      <div class="h-time">${i === 0 ? nowLabel : fmtHour(h.time)}</div>
      <div class="h-icon">${weatherIcon(wmo(h.code).icon, h.isDay)}</div>
      <div class="h-temp">${fmtTemp(h.temp)}${tempUnit()}</div>
      <div class="h-rain">💧 ${Math.round(h.rainProb)}%</div>
      <div class="h-wind">${METRIC_ICONS.wind} ${fmtWind(h.wind)} ${windUnit()}</div>
    </div>`,
    )
    .join("");
}

const FC_TABS = [
  {
    id: "temp",
    labelKey: "chartTemp",
    color: "#D97706",
    unit: () => tempUnit(),
    get: (h) => convTemp(h.temp),
  },
  {
    id: "feels",
    labelKey: "feelsLike",
    color: "#E11D48",
    unit: () => tempUnit(),
    get: (h) => convTemp(h.feels),
  },
  {
    id: "precip",
    labelKey: "precipitation",
    color: "#0284C7",
    unit: () => "%",
    get: (h) => h.rainProb,
  },
  {
    id: "wind",
    labelKey: "chartWind",
    color: "#059669",
    unit: () => windUnit(),
    get: (h) => convWind(h.wind),
  },
];

function aqInfo(aqi) {
  if (aqi == null) return { label: "—", cls: "" };
  if (aqi <= 50) return { label: t("aqGood"), cls: "is-good" };
  if (aqi <= 75) return { label: t("aqModerate"), cls: "is-warn" };
  if (aqi <= 100) return { label: t("aqPoor"), cls: "is-bad" };
  return { label: t("aqVeryPoor"), cls: "is-bad" };
}

export function renderForecastPage() {
  const wx = state.wx,
    loc = state.loc;
  $("#forecastViewSub").textContent = `${t("fcDetailedFor")} ${locName(loc)}`;
  $("#forecastRow2").innerHTML = wx.daily.map(forecastCardHtml).join("");
  updateCarouselFades();

  /* hourly chart with tabs */
  $("#fcTabs").innerHTML = FC_TABS.map(
    (tab) => `
    <button role="tab" aria-selected="${state.fcTab === tab.id}" data-tab="${tab.id}">${t(tab.labelKey)}</button>`,
  ).join("");
  $$("#fcTabs button").forEach((b) =>
    b.addEventListener("click", () => {
      state.fcTab = b.dataset.tab;
      renderForecastPage();
    }),
  );
  const tab = FC_TABS.find((x) => x.id === state.fcTab);
  renderLineChart($("#fcChartHost"), {
    points: wx.hourly.slice(0, 25).map((h) => ({ t: fmtHour(h.time), v: tab.get(h) })),
    color: tab.color,
    unit: tab.unit(),
    format: (v) => Math.round(v),
    ariaLabel: `${t(tab.labelKey)} — ${t("hourlyForecast")}`,
  });

  /* precipitation bars, every 3 hours — the summary line above the chart
     is derived from this exact same set of points, so it always matches
     what the bars show. */
  const precipPoints = wx.hourly.filter((_, i) => i % 3 === 0).slice(0, 8);
  renderBarChart($("#precipHost"), {
    points: precipPoints.map((h) => ({ t: fmtHour(h.time), v: h.rainProb })),
    ariaLabel: t("precipitation"),
  });
  $("#precipSummary").textContent = precipSummaryText(precipPoints);

  /* today's details */
  const d0 = wx.daily[0];
  const aq = aqInfo(wx.current.aqi);
  $("#dayDetails").innerHTML = `
    <h3 class="info-title">${t("dayDetails")}</h3>
    <div class="dd-grid">
      <div class="dd-item">
        <span class="metric-ico tint-amber" aria-hidden="true">${METRIC_ICONS.sunrise}</span>
        <div><dt>${t("sunrise")}</dt><dd>${fmtClock(d0.sunrise)}</dd></div>
      </div>
      <div class="dd-item">
        <span class="metric-ico tint-violet" aria-hidden="true">${METRIC_ICONS.sunset}</span>
        <div><dt>${t("sunset")}</dt><dd>${fmtClock(d0.sunset)}</dd></div>
      </div>
      <div class="dd-item">
        <span class="metric-ico tint-amber" aria-hidden="true">${METRIC_ICONS.uv}</span>
        <div><dt>${t("uvIndex")}</dt><dd>${Math.round(d0.uvMax)}</dd><span class="dd-badge is-warn">${uvLabel(d0.uvMax)}</span></div>
      </div>
      <div class="dd-item">
        <span class="metric-ico tint-emerald" aria-hidden="true">${METRIC_ICONS.visibility}</span>
        <div><dt>${t("airQuality")}</dt><dd>${wx.current.aqi ?? "—"}</dd><span class="dd-badge ${aq.cls}">${aq.label}</span></div>
      </div>
    </div>`;

  /* summary */
  const avgWind = wx.hourly.reduce((s, h) => s + h.wind, 0) / wx.hourly.length;
  const summary = t("summaryTpl")
    .replace("{desc}", wxDesc(d0.code, state.lang))
    .replace("{max}", `${fmtTemp(d0.hi)}${tempUnit()}`)
    .replace("{min}", `${fmtTemp(d0.lo)}${tempUnit()}`)
    .replace("{wind}", `${fmtWind(avgWind)} ${windUnit()}`)
    .replace("{dir}", compass(wx.current.windDir).label);
  $("#daySummary").innerHTML = `
    <h3 class="info-title">${t("summaryTitle")}</h3>
    <p class="sum-text">${summary}</p>
    <div class="sum-rows">
      <div class="sum-row"><span class="metric-ico tint-rose" aria-hidden="true">${METRIC_ICONS.temperature}</span> ${t("maxLabel")} <b style="color:var(--rose)">${fmtTemp(d0.hi)}${tempUnit()}</b></div>
      <div class="sum-row"><span class="metric-ico tint-blue" aria-hidden="true">${METRIC_ICONS.temperature}</span> ${t("minLabel")} <b style="color:var(--primary)">${fmtTemp(d0.lo)}${tempUnit()}</b></div>
      <div class="sum-row"><span class="metric-ico tint-emerald" aria-hidden="true">${METRIC_ICONS.wind}</span> ${t("avgWind")} <b>${fmtWind(avgWind)} ${windUnit()}</b></div>
    </div>`;
}
