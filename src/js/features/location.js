/* Location selection + the render fan-out that follows it: fetch (or demo-
   fallback) the weather for the chosen place, then repaint every view that
   shows weather data. This is the app's central orchestration point. */
import { state } from "../core/state.js";
import { t } from "../core/i18n.js";
import { setJSON, KEYS } from "../core/storage.js";
import { emit } from "../core/app-bus.js";
import { recordRecent } from "./recent-locations.js";
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
import { renderMapInfo, renderRecentLocations, resetMapSheet } from "../ui/render-map.js";
import { renderSidePos } from "./geolocation.js";

let lastErrToast = 0;

/* Selections can overlap: a map click while a previous click's weather is
   still in flight, or two search results picked in quick succession. Only the
   most recent one is allowed to write weather or repaint, so a slow earlier
   response can never land on top of a faster later choice — the map would
   otherwise end up showing one place's name over another place's numbers. */
let selectionToken = 0;

export async function selectLocation(loc) {
  const token = ++selectionToken;
  const isStale = () => token !== selectionToken;

  /* Synchronous and first: state.loc changes on the next line, and nothing
     must be able to observe that new location — via a pan, a view switch, or
     any other bus event — while still carrying share consent granted for
     whatever was selected before. fetchWeather() below can take a while, and
     location:selected does not fire until it resolves, so a revoke that
     waited for that event would leave a window where a stale `true` consent
     could publish a location the user never chose to share. Emitting here,
     ahead of the only await in this function, closes that window: nothing
     else runs between this line and the state.loc write just below it. */
  emit("location:selecting", loc);

  state.loc = loc;
  bumpPhotoToken(); /* invalidate any in-flight photo swap from the previous place */
  resetMapSheet(); /* a genuinely new selection re-peeks at "half", not wherever the last one was left */
  setJSON(KEYS.lastLocation, loc);
  recordRecent(loc); /* no-op unless the user opted in — see recent-locations.js */
  renderHeroSkeleton();
  /* the previous city's hazards must not hang over the one now loading */
  clearAdvisory();

  let wx;
  let isDemo = false;
  try {
    wx = await fetchWeather(loc);
  } catch {
    wx = demoWeather(loc);
    isDemo = true;
  }
  if (isStale()) return;

  state.wx = wx;
  state.isDemo = isDemo;
  if (isDemo && Date.now() - lastErrToast > 60000) {
    /* offline: warn once a minute, not on every navigation */
    showToast(t("loadError"));
    lastErrToast = Date.now();
  }

  renderAllWeather();
  emit("location:selected", loc);
  /* air quality resolves separately — update the forecast page when it lands */
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
  renderRecentLocations();
  renderSidePos();
}
