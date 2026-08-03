/* Home view rendering: hero card, metrics (simple + detailed), forecast
   strip, home chart, insights, compact hourly strip, explore carousel. */
import { state } from "../core/state.js";
import { $, $$, esc } from "../core/dom.js";
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
import { fmtHour, fmtClock, fmtDay, fmtDate } from "../core/datetime.js";
import { weatherIcon, METRIC_ICONS } from "../data/icons.js";
import { wmo, wxDesc, skyKey } from "../data/weather-codes.js";
import { LOCATIONS, EXPLORE_IDS } from "../data/locations.js";
import {
  locName,
  locRegion,
  locCountry,
  kindLabel,
  localTimeStr,
  flagsHtml,
} from "../core/location.js";
import { isFav, toggleFavorite } from "../features/favorites.js";
import { locVisual, locPhotoHtml, hydrateLocPhoto, gradBg } from "../services/photo-api.js";
import { renderLineChart } from "./charts.js";
import { selectLocation } from "../features/location.js";
import { switchView } from "./navigation.js";

export function renderHeroSkeleton() {
  $("#heroInner").innerHTML = `
    <div class="hero-top"><div class="skeleton" style="width:120px;height:30px;border-radius:999px"></div></div>
    <div class="hero-head">
      <div class="skeleton" style="width:min(260px,70%);height:44px"></div>
      <div class="skeleton" style="width:min(190px,55%);height:16px;margin-top:12px"></div>
    </div>
    <div class="hero-main">
      <div class="hero-now">
        <div class="skeleton" style="width:84px;height:84px;border-radius:50%"></div>
        <div class="hero-now-txt">
          <div class="skeleton" style="width:min(190px,50vw);height:56px"></div>
          <div class="skeleton" style="width:min(140px,38vw);height:16px;margin-top:10px"></div>
        </div>
      </div>
    </div>
    <div class="hero-updated"><div class="skeleton" style="width:180px;height:14px"></div></div>`;
}

export function renderHero() {
  const { loc, wx } = state;
  const c = wx.current;
  const sky = skyKey(c.code, c.isDay);
  $("#heroBg").dataset.sky = sky;
  const hl = $("#heroLandmark");
  hl.innerHTML = locPhotoHtml(loc, "hero-photo");
  /* the landmark layer is pointer-events:none and sits behind .hero-inner, so
     the (clickable) Pexels credit is hosted by .hero-inner instead */
  hydrateLocPhoto(hl.querySelector(".loc-photo"), loc, { creditHost: $("#heroInner") });

  const mins = Math.max(0, Math.round((Date.now() - wx.updatedAt.getTime()) / 60000));
  const updatedTxt = mins < 1 ? t("justNow") : `${mins} ${t("minAgo")}`;
  const fav = isFav(loc);
  const landmarkLine =
    loc.kind !== "country" && loc.landmark
      ? `<span aria-hidden="true">·</span> ${esc(loc.landmark[state.lang] || loc.landmark.en)}`
      : "";
  const localTime = localTimeStr(wx.timezone);

  $("#heroInner").innerHTML = `
    <div class="hero-top">
      <span class="hero-loc-kicker"><span aria-hidden="true">${locVisual(loc)}</span> ${kindLabel(loc.kind)}</span>
      ${localTime ? `<span class="hero-clock"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg> ${localTime}</span>` : ""}
    </div>
    <div class="hero-head">
      <h1 class="hero-city" id="heroCityName">${esc(locName(loc))}
        <button class="hero-fav-btn ${fav ? "is-fav" : ""}" id="heroFavBtn"
          aria-label="${fav ? t("removeFavorite") : t("addFavorite")}" aria-pressed="${fav}">
          <svg viewBox="0 0 24 24" width="19" height="19" fill="${fav ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="m12 3 2.7 5.6 6.3.9-4.5 4.4 1 6.1L12 17l-5.5 3 1-6.1L3 9.5l6.3-.9L12 3z"/></svg>
        </button>
      </h1>
      <p class="hero-region">${esc(locRegion(loc))} ${locRegion(loc) ? "·" : ""} ${loc.kind === "country" ? "" : flagsHtml(loc) + " "}${esc(locCountry(loc))} ${landmarkLine}</p>
    </div>
    <div class="hero-main">
      <div class="hero-now">
        <div class="hero-wicon">${weatherIcon(wmo(c.code).icon, c.isDay)}</div>
        <div class="hero-now-txt">
          <div class="hero-temp">${fmtTemp(c.temp)}<sup>${tempUnit()}</sup></div>
          <div class="hero-desc">${wxDesc(c.code, state.lang)}</div>
        </div>
      </div>
      <div class="hero-hl">
        <span>↑ <b>${fmtTemp(wx.daily[0].hi)}°</b> ${t("high")}</span>
        <span>↓ <b>${fmtTemp(wx.daily[0].lo)}°</b> ${t("low")}</span>
      </div>
    </div>
    <div class="hero-updated">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
      ${t("updated")} · ${updatedTxt}
      <span class="hero-live"><span class="pulse-dot" aria-hidden="true"></span> ${state.isDemo ? t("demoData") : t("live")}</span>
    </div>`;

  $("#heroFavBtn").addEventListener("click", toggleFavorite);
}

const METRICS = [
  {
    key: "temperature",
    icon: "temperature",
    tint: "tint-amber",
    simple: true,
    val: (c) => `${fmtTemp(c.temp)}<span class="unit">${tempUnit()}</span>`,
    foot: (c) => wxDesc(c.code, state.lang),
  },
  {
    key: "humidity",
    icon: "humidity",
    tint: "tint-sky",
    simple: true,
    val: (c) => `${Math.round(c.humidity)}<span class="unit">%</span>`,
    foot: (c) => (c.humidity > 70 ? t("humid") : c.humidity < 35 ? t("dry") : t("comfortable")),
  },
  {
    key: "windSpeed",
    icon: "wind",
    tint: "tint-emerald",
    simple: true,
    val: (c) => `${fmtWind(c.windSpeed)}<span class="unit">${windUnit()}</span>`,
    foot: (c) => compass(c.windDir).label,
  },
  {
    key: "feelsLike",
    icon: "feels",
    tint: "tint-rose",
    simple: true,
    /* 4th Simple-mode card: apparent_temperature is a plain `current` field with
       no `??` fallback in fetchWeatherRaw (unlike rainProb, which defaults to 0
       when Open-Meteo omits it) — the most reliable value already on hand. */
    val: (c) => `${fmtTemp(c.feels)}<span class="unit">${tempUnit()}</span>`,
    foot: () => "",
  },
  {
    key: "windDirection",
    icon: "direction",
    tint: "tint-emerald",
    val: (c) => `${compass(c.windDir).abbr}<span class="unit">${Math.round(c.windDir)}°</span>`,
    foot: (c) => compass(c.windDir).label,
  },
  {
    key: "pressure",
    icon: "pressure",
    tint: "tint-violet",
    val: (c) => `${Math.round(c.pressure)}<span class="unit">hPa</span>`,
    foot: (c) =>
      c.pressure > 1020
        ? t("highPressure")
        : c.pressure < 1005
          ? t("lowPressure")
          : t("normalPressure"),
  },
  {
    key: "uvIndex",
    icon: "uv",
    tint: "tint-amber",
    val: (c) => `${Math.round(c.uv * 10) / 10}`,
    foot: (c) => uvLabel(c.uv),
  },
  {
    key: "visibility",
    icon: "visibility",
    tint: "tint-blue",
    val: (c) => `${Math.round(c.visibility)}<span class="unit">km</span>`,
    foot: (c) =>
      c.visibility >= 20
        ? t("excellent")
        : c.visibility >= 10
          ? t("good")
          : c.visibility >= 4
            ? t("moderate")
            : t("poor"),
  },
  {
    key: "sunrise",
    icon: "sunrise",
    tint: "tint-amber",
    val: (c, wx) => `<span style="font-size:22px">${fmtClock(wx.daily[0].sunrise)}</span>`,
    foot: () => "",
  },
  {
    key: "sunset",
    icon: "sunset",
    tint: "tint-violet",
    val: (c, wx) => `<span style="font-size:22px">${fmtClock(wx.daily[0].sunset)}</span>`,
    foot: () => "",
  },
  {
    key: "rainChance",
    icon: "rain",
    tint: "tint-sky",
    val: (c) => `${Math.round(c.rainProb)}<span class="unit">%</span>`,
    foot: () => "",
  },
  {
    key: "dewPoint",
    icon: "dew",
    tint: "tint-blue",
    val: (c) => `${fmtTemp(c.dewPoint)}<span class="unit">${tempUnit()}</span>`,
    foot: () => "",
  },
];

export function renderMetrics() {
  const c = state.wx.current;
  $("#metricsGrid").innerHTML = METRICS.map(
    (m, i) => `
    <div class="metric-card ${m.simple ? "" : "detailed-only"}" style="animation-delay:${i * 45}ms">
      <div class="metric-head">
        <span class="metric-ico ${m.tint}" aria-hidden="true">${METRIC_ICONS[m.icon]}</span>
        <span class="metric-label">${t(m.key)}</span>
      </div>
      <div class="metric-value">${m.val(c, state.wx)}</div>
      ${m.foot(c, state.wx) ? `<div class="metric-foot">${m.foot(c, state.wx)}</div>` : ""}
    </div>`,
  ).join("");
}

/* ── Detailed-mode grouped metrics ──
   Simple mode keeps using METRICS/renderMetrics/#metricsGrid completely
   unchanged above. This is a SEPARATE container (#metricsGridDetailed) so
   compacting Detailed can never touch Simple's markup, CSS, or render path.
   Values are pulled from the same METRICS entries (not recomputed) so the
   numbers can never drift between the two views. */
function metricVal(key, c, wx) {
  const m = METRICS.find((x) => x.key === key);
  return m ? m.val(c, wx) : "";
}
function metricFoot(key, c, wx) {
  const m = METRICS.find((x) => x.key === key);
  return m ? m.foot(c, wx) : "";
}
const stripHtml = (s) => String(s).replace(/<[^>]*>/g, "");

export function renderGroupedMetrics() {
  const el = $("#metricsGridDetailed");
  if (!el) return;
  const c = state.wx.current,
    wx = state.wx;

  const cardHtml = (g, i) => `
    <div class="metric-group" style="animation-delay:${i * 45}ms" aria-label="${esc(g.label)}">
      <div class="mg-head"><span class="metric-ico ${g.tint}" aria-hidden="true">${METRIC_ICONS[g.icon]}</span><span class="mg-title">${g.title}</span></div>
      ${g.primary !== undefined ? `<div class="mg-primary">${g.primary}</div>` : ""}
      ${
        g.rows && g.rows.length
          ? `<div class="mg-rows ${g.rowsEq ? "mg-rows-eq" : ""}">${g.rows
              .map(
                (r) =>
                  `<div class="mg-row">${r.icon ? `<span class="metric-ico ${r.tint}" aria-hidden="true">${METRIC_ICONS[r.icon]}</span>` : ""}<span class="mg-row-label">${r.label}</span><span class="mg-row-value">${r.value}</span></div>`,
              )
              .join("")}</div>`
          : ""
      }
      ${g.status ? `<div class="mg-status">${g.status}</div>` : ""}
    </div>`;

  const groups = [
    {
      key: "temperature",
      tint: "tint-amber",
      icon: "temperature",
      title: t("temperature"),
      primary: metricVal("temperature", c, wx),
      rows: [{ label: t("feelsLike"), value: metricVal("feelsLike", c, wx) }],
      status: wxDesc(c.code, state.lang),
      label: `${t("temperature")}: ${stripHtml(metricVal("temperature", c, wx))}, ${t("feelsLike")} ${stripHtml(metricVal("feelsLike", c, wx))}, ${wxDesc(c.code, state.lang)}`,
    },
    {
      key: "humidity",
      tint: "tint-sky",
      icon: "humidity",
      title: t("humidity"),
      primary: metricVal("humidity", c, wx),
      rows: [{ label: t("dewPoint"), value: metricVal("dewPoint", c, wx) }],
      status: metricFoot("humidity", c, wx),
      label: `${t("humidity")}: ${stripHtml(metricVal("humidity", c, wx))}, ${t("dewPoint")} ${stripHtml(metricVal("dewPoint", c, wx))}, ${metricFoot("humidity", c, wx)}`,
    },
    {
      key: "wind",
      tint: "tint-emerald",
      icon: "wind",
      title: t("wind"),
      primary: metricVal("windSpeed", c, wx),
      /* built directly (not via metricVal) only to add a space between the
         compass abbreviation and the degree figure — cramped without it once
         the two sit side by side in a compact row instead of a full card */
      rows: [
        {
          label: t("windDirection"),
          value: `${compass(c.windDir).abbr} <span class="unit">${Math.round(c.windDir)}°</span>`,
        },
      ],
      status: compass(c.windDir).label,
      label: `${t("wind")}: ${stripHtml(metricVal("windSpeed", c, wx))}, ${t("windDirection")} ${compass(c.windDir).abbr} ${Math.round(c.windDir)}°`,
    },
    {
      key: "pressure",
      tint: "tint-violet",
      icon: "pressure",
      title: t("pressure"),
      primary: metricVal("pressure", c, wx),
      status: metricFoot("pressure", c, wx),
      label: `${t("pressure")}: ${stripHtml(metricVal("pressure", c, wx))}, ${metricFoot("pressure", c, wx)}`,
    },
    {
      key: "uv",
      tint: "tint-amber",
      icon: "uv",
      title: t("uvIndex"),
      primary: metricVal("uvIndex", c, wx),
      status: metricFoot("uvIndex", c, wx),
      label: `${t("uvIndex")}: ${stripHtml(metricVal("uvIndex", c, wx))}, ${metricFoot("uvIndex", c, wx)}`,
    },
    {
      key: "visibility",
      tint: "tint-blue",
      icon: "visibility",
      title: t("visibility"),
      primary: metricVal("visibility", c, wx),
      status: metricFoot("visibility", c, wx),
      label: `${t("visibility")}: ${stripHtml(metricVal("visibility", c, wx))}, ${metricFoot("visibility", c, wx)}`,
    },
    {
      key: "sunCycle",
      tint: "tint-amber",
      icon: "sunrise",
      title: t("sunCycle"),
      rowsEq: true,
      /* no per-row icon (header icon already reads "sun cycle") — keeping the
         row to label+value only lets it share the same narrow-width
         label-above-value stacking as every other group, instead of a 3-way
         icon/label/value split that stacking would otherwise produce */
      rows: [
        { label: t("sunrise"), value: fmtClock(wx.daily[0].sunrise) },
        { label: t("sunset"), value: fmtClock(wx.daily[0].sunset) },
      ],
      label: `${t("sunCycle")}: ${t("sunrise")} ${fmtClock(wx.daily[0].sunrise)}, ${t("sunset")} ${fmtClock(wx.daily[0].sunset)}`,
    },
    /* Precipitation: only a probability % exists anywhere in this app's data
       model (fetchWeatherRaw never requests a raw mm amount) — no secondary
       row is fabricated for it, per "hide cleanly rather than show fake data". */
    {
      key: "rain",
      tint: "tint-sky",
      icon: "rain",
      title: t("precipitation"),
      primary: metricVal("rainChance", c, wx),
      label: `${t("precipitation")}: ${stripHtml(metricVal("rainChance", c, wx))}`,
    },
  ];

  el.innerHTML = groups.map(cardHtml).join("");
}

export function forecastCardHtml(d, i) {
  return `
    <div class="forecast-card ${i === 0 ? "is-today" : ""}" style="animation-delay:${i * 70}ms">
      <div class="fc-day">${i === 0 ? t("today") : fmtDay(d.date)}</div>
      <div class="fc-date">${fmtDate(d.date)}</div>
      <div class="fc-icon">${weatherIcon(wmo(d.code).icon, true)}</div>
      <div class="fc-desc">${wxDesc(d.code, state.lang)}</div>
      <div class="fc-temps"><span class="hi">${fmtTemp(d.hi)}°</span><span class="lo">${fmtTemp(d.lo)}°</span></div>
      ${d.rainProb >= 20 ? `<span class="fc-rain">💧 ${Math.round(d.rainProb)}%</span>` : ""}
    </div>`;
}

export function renderForecast() {
  $("#forecastRow").innerHTML = state.wx.daily.slice(0, 5).map(forecastCardHtml).join("");
  $("#forecastSub").textContent =
    `${t("forecastFor")} ${locName(state.loc)}, ${locCountry(state.loc)}`;
}

const CHART_TABS = [
  {
    id: "temp",
    labelKey: "chartTemp",
    color: "#D97706",
    unit: () => tempUnit(),
    get: (h) => convTemp(h.temp),
    fmt: (v) => Math.round(v),
  },
  {
    id: "humidity",
    labelKey: "chartHumidity",
    color: "#0284C7",
    unit: () => "%",
    get: (h) => h.humidity,
    fmt: (v) => Math.round(v),
  },
  {
    id: "wind",
    labelKey: "chartWind",
    color: "#059669",
    unit: () => windUnit(),
    get: (h) => convWind(h.wind),
    fmt: (v) => Math.round(v),
  },
  {
    id: "pressure",
    labelKey: "chartPressure",
    color: "#7C3AED",
    unit: () => "hPa",
    get: (h) => h.pressure,
    fmt: (v) => Math.round(v),
  },
];

export function renderChartTabs() {
  $("#chartTabs").innerHTML = CHART_TABS.map(
    (tab) => `
    <button role="tab" aria-selected="${state.chartTab === tab.id}" data-tab="${tab.id}">${t(tab.labelKey)}</button>`,
  ).join("");
  $$("#chartTabs button").forEach((btn) =>
    btn.addEventListener("click", () => {
      state.chartTab = btn.dataset.tab;
      renderChartTabs();
      renderChart();
    }),
  );
}

export function renderChart() {
  if (state.mode !== "detailed" || !state.wx) return;
  const tab = CHART_TABS.find((x) => x.id === state.chartTab);
  const points = state.wx.hourly.slice(0, 25).map((h) => ({ t: fmtHour(h.time), v: tab.get(h) }));
  renderLineChart($("#chartHost"), {
    points,
    color: tab.color,
    unit: tab.unit(),
    format: tab.fmt,
    ariaLabel: `${t(tab.labelKey)} — ${t("next24h")}`,
  });
}

export function renderInsights() {
  const wx = state.wx;
  const uvMax = wx.daily[0].uvMax;
  const windMax = wx.daily[0].windMax;
  const rainMax = Math.max(...wx.hourly.map((h) => h.rainProb));
  const items = [
    {
      emoji: "🧴",
      tint: "tint-amber",
      title: t("insightUvTitle"),
      text: uvMax >= 5 ? t("insightUvHigh") : t("insightUvLow"),
      value: Math.round(uvMax * 10) / 10,
      sub: t("uvIndex"),
    },
    {
      emoji: "🍃",
      tint: "tint-emerald",
      title: t("insightWindTitle"),
      text: windMax >= 28 ? t("insightWindStrong") : t("insightWindCalm"),
      value: `${fmtWind(windMax)} ${windUnit()}`,
      sub: t("wind"),
    },
    {
      emoji: "☂️",
      tint: "tint-sky",
      title: t("insightRainTitle"),
      text: rainMax >= 40 ? t("insightRainYes") : t("insightRainNo"),
      value: `${Math.round(rainMax)} %`,
      sub: t("rainChance"),
    },
  ];
  $("#insightsGrid").innerHTML = items
    .map(
      (it, i) => `
    <div class="insight-card" style="animation-delay:${i * 80}ms">
      <span class="insight-emoji ${it.tint}" aria-hidden="true">${it.emoji}</span>
      <div class="insight-body"><h3>${it.title}</h3><p>${it.text}</p></div>
      <div class="insight-value"><b>${it.value}</b><span>${it.sub}</span></div>
    </div>`,
    )
    .join("");
}

/* Compact Simple-mode strip: next 6 CONSECUTIVE hours (unlike the Forecast
   page's renderHourly in ui/render-forecast.js, which samples every 3rd hour
   over a wider span — deliberately lighter/denser here, not a duplicate). */
export function renderHomeHourly() {
  const el = $("#homeHourlyStrip");
  if (!el) return;
  const nowLabel = state.lang === "fr" ? "Maint." : "Now";
  const cells = state.wx.hourly.slice(0, 6);
  el.innerHTML = cells
    .map((h, i) => {
      const time = i === 0 ? nowLabel : fmtHour(h.time);
      const desc = wxDesc(h.code, state.lang);
      const temp = `${fmtTemp(h.temp)}${tempUnit()}`;
      const rain = Math.round(h.rainProb);
      const label = `${time}, ${desc}, ${temp}${rain > 0 ? `, ${rain}% ${t("rainChance")}` : ""}`;
      return `
    <div class="hour-cell ${i === 0 ? "is-now" : ""}" role="group" aria-label="${esc(label)}">
      <div class="h-time" aria-hidden="true">${esc(time)}</div>
      <div class="h-icon">${weatherIcon(wmo(h.code).icon, h.isDay)}</div>
      <div class="h-temp" aria-hidden="true">${temp}</div>
      ${rain > 0 ? `<div class="h-rain" aria-hidden="true">💧 ${rain}%</div>` : ""}
    </div>`;
    })
    .join("");
}

export function renderExplore() {
  $("#exploreCarousel").innerHTML = EXPLORE_IDS.map((id) => {
    const loc = LOCATIONS.find((l) => l.id === id);
    return `
      <button class="explore-card" data-loc="${esc(loc.id)}" aria-label="${esc(locName(loc))}, ${esc(locCountry(loc))}">
        <span class="explore-bg" style="${gradBg(loc)}" aria-hidden="true"></span>
        <span class="explore-emoji" aria-hidden="true">${locVisual(loc)}</span>
        <span class="explore-txt">
          <span class="explore-name">${esc(locName(loc))}</span>
          <span class="explore-country">${flagsHtml(loc, "small")} ${loc.kind === "country" ? kindLabel(loc.kind) : esc(locCountry(loc))}</span>
        </span>
      </button>`;
  }).join("");
  $$(".explore-card").forEach((card) =>
    card.addEventListener("click", () => {
      selectLocation(LOCATIONS.find((l) => l.id === card.dataset.loc));
      switchView("home");
    }),
  );
}
