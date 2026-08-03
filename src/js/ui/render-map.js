/* Map view info panels: selected-location card, current conditions, and
   the popular-cities list. */
import { state } from "../core/state.js";
import { $, $$, esc } from "../core/dom.js";
import { t } from "../core/i18n.js";
import { FETCH_TIMEOUT_MS } from "../core/config.js";
import { LOCATIONS, COUNTRY_FACTS } from "../data/locations.js";
import { weatherIcon } from "../data/icons.js";
import { wmo, wxDesc } from "../data/weather-codes.js";
import { fmtTemp, tempUnit, fmtWind, windUnit } from "../core/units.js";
import { locName, locRegion, locCountry, kindLabel, flagsHtml } from "../core/location.js";
import { locPhotoHtml, hydrateLocPhoto } from "../services/photo-api.js";
import { demoWeather } from "../services/weather-api.js";
import { selectLocation } from "../features/location.js";

const POPULAR_IDS = ["paris", "newyork", "tokyo", "sydney", "london"];
let popularCache = null;

export async function loadPopular() {
  const locs = POPULAR_IDS.map((id) => LOCATIONS.find((l) => l.id === id));
  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.search = new URLSearchParams({
      latitude: locs.map((l) => l.lat).join(","),
      longitude: locs.map((l) => l.lon).join(","),
      current: "temperature_2m,weather_code,is_day",
    }).toString();
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    const d = await res.json();
    const arr = Array.isArray(d) ? d : [d];
    popularCache = locs.map((loc, i) => ({
      loc,
      temp: arr[i].current.temperature_2m,
      code: arr[i].current.weather_code,
      isDay: arr[i].current.is_day,
    }));
  } catch {
    popularCache = locs.map((loc) => {
      const w = demoWeather(loc);
      return { loc, temp: w.current.temp, code: w.current.code, isDay: w.current.isDay };
    });
  }
  renderMapInfo();
}

function factRows(loc) {
  const facts = loc.kind === "country" && COUNTRY_FACTS[loc.id];
  if (facts) {
    return [
      [t("factType"), kindLabel(loc.kind)],
      [t("factCapital"), facts.capital[state.lang]],
      [t("factLang"), facts.lang[state.lang]],
      [t("factPop"), facts.pop[state.lang]],
      [t("factCurrency"), facts.currency[state.lang]],
      [t("factTz"), facts.tz],
    ];
  }
  const rows = [
    [t("factType"), kindLabel(loc.kind)],
    [t("factRegion"), locRegion(loc) || "—"],
    [t("factCountry"), locCountry(loc)],
  ];
  if (loc.landmark) rows.push([t("factLandmark"), loc.landmark[state.lang] || loc.landmark.en]);
  rows.push([t("factCoords"), `${loc.lat.toFixed(2)}°, ${loc.lon.toFixed(2)}°`]);
  return rows;
}

export function renderMapInfo() {
  const loc = state.loc,
    wx = state.wx;
  if (!loc || !wx || !$("#mapLocInfo")) return;
  const c = wx.current;

  $("#mapLocInfo").innerHTML = `
    <h3 class="info-title">${t("locInfo")}</h3>
    <div class="info-head">
      <div class="info-visual">${locPhotoHtml(loc)}</div>
      <div>
        <div class="info-name">${flagsHtml(loc, "small")} <b>${esc(locName(loc))}</b></div>
        <div class="info-sub">${esc(locRegion(loc))}</div>
      </div>
    </div>
    <dl class="facts">${factRows(loc)
      .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
      .join("")}</dl>`;
  /* the info thumbnail is only 96×66px — credit the card body instead */
  hydrateLocPhoto($("#mapLocInfo .info-visual .loc-photo"), loc, {
    creditHost: $("#mapLocInfo"),
    creditClass: "loc-credit--inline",
  });

  $("#mapConditions").innerHTML = `
    <h3 class="info-title">${t("conditions")}</h3>
    <div class="cond-main">
      <div class="cond-icon">${weatherIcon(wmo(c.code).icon, c.isDay)}</div>
      <div><b>${fmtTemp(c.temp)}${tempUnit()}</b><span>${wxDesc(c.code, state.lang)}</span></div>
    </div>
    <div class="cond-stats">
      <div><dt>${t("feelsLike")}</dt><dd>${fmtTemp(c.feels)}°</dd></div>
      <div><dt>${t("humidity")}</dt><dd>${Math.round(c.humidity)}%</dd></div>
      <div><dt>${t("wind")}</dt><dd>${fmtWind(c.windSpeed)} ${windUnit()}</dd></div>
      <div><dt>${t("pressure")}</dt><dd>${Math.round(c.pressure)} hPa</dd></div>
    </div>`;

  $("#mapPopular").innerHTML = `
    <h3 class="info-title">${t("popularTitle")}</h3>
    <div class="pop-list">${(popularCache || [])
      .map(
        (p) => `
      <button class="pop-row" data-loc="${esc(p.loc.id)}">
        ${flagsHtml(p.loc, "small")}
        <span class="pop-names"><b>${esc(locName(p.loc))}</b><span>${esc(locCountry(p.loc))}</span></span>
        <span class="pop-wx"><b>${fmtTemp(p.temp)}°C</b>${weatherIcon(wmo(p.code).icon, p.isDay)}</span>
      </button>`,
      )
      .join("")}</div>`;
  $$("#mapPopular .pop-row").forEach((btn) =>
    btn.addEventListener("click", () => {
      selectLocation(LOCATIONS.find((l) => l.id === btn.dataset.loc));
    }),
  );
}
