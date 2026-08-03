/* Location selection + the render fan-out that follows it: fetch (or demo-
   fallback) the weather for the chosen place, then repaint every view that
   shows weather data. This is the app's central orchestration point. */
import { state } from "../core/state.js";
import { t } from "../core/i18n.js";
import { setJSON, KEYS } from "../core/storage.js";
import { fetchWeather, demoWeather } from "../services/weather-api.js";
import { bumpPhotoToken } from "../services/photo-api.js";
import { showToast } from "../ui/notifications.js";
import {
  renderHeroSkeleton,
  renderHero,
  renderMetrics,
  renderGroupedMetrics,
  renderForecast,
  renderChartTabs,
  renderChart,
  renderInsights,
  renderHomeHourly,
} from "../ui/render-home.js";
import { renderAdvisory, clearAdvisory } from "../ui/render-advisory.js";
import { renderHourly, renderForecastPage } from "../ui/render-forecast.js";
import { renderMap } from "./map.js";
import { renderMapInfo } from "../ui/render-map.js";
import { renderSidePos } from "./geolocation.js";

let lastErrToast = 0;

export async function selectLocation(loc) {
  state.loc = loc;
  bumpPhotoToken(); /* invalidate any in-flight photo swap from the previous place */
  setJSON(KEYS.lastLocation, loc);
  renderHeroSkeleton();
  /* the previous city's hazards must not hang over the one now loading */
  clearAdvisory();
  try {
    state.wx = await fetchWeather(loc);
    state.isDemo = false;
  } catch {
    state.wx = demoWeather(loc);
    state.isDemo = true;
    /* offline: warn once a minute, not on every navigation */
    if (Date.now() - lastErrToast > 60000) {
      showToast(t("loadError"));
      lastErrToast = Date.now();
    }
  }
  renderAllWeather();
  /* air quality resolves separately — update the forecast page when it lands */
  const wx = state.wx;
  if (wx._aqi)
    wx._aqi.then((aqi) => {
      if (state.wx === wx && aqi != null) {
        wx.current.aqi = aqi;
        renderForecastPage();
      }
    });
}

export function renderAllWeather() {
  if (!state.wx) return;
  renderHero();
  renderAdvisory();
  renderMetrics();
  renderGroupedMetrics();
  renderForecast();
  renderChartTabs();
  renderChart();
  renderInsights();
  renderHourly();
  renderHomeHourly();
  renderForecastPage();
  renderMap();
  renderMapInfo();
  renderSidePos();
}
