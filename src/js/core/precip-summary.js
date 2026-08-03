/* Precipitation-summary computation for the forecast page's precipitation
   card. peakPrecip() is pure data in/out; precipSummaryText() only adds
   i18n/time formatting on top (t()/fmtHour read state, not the DOM), so both
   stay unit-testable without a DOM — deliberately kept out of render-
   forecast.js, which pulls in the map/navigation modules that touch
   `window` at import time. */
import { t } from "./i18n.js";
import { fmtHour } from "./datetime.js";

export function peakPrecip(points) {
  if (!Array.isArray(points) || !points.length) return null;
  let best = null;
  for (const p of points) {
    if (!p || typeof p.rainProb !== "number" || Number.isNaN(p.rainProb)) continue;
    if (!best || p.rainProb > best.rainProb) best = p;
  }
  if (!best) return null;
  return { pct: Math.round(best.rainProb), time: best.time };
}

/* Localized "maximum chance: X% around Y" line for the precipitation card. */
export function precipSummaryText(points) {
  const peak = peakPrecip(points);
  if (!peak) return t("precipNoData");
  return t("precipMaxTpl").replace("{pct}", peak.pct).replace("{time}", fmtHour(peak.time));
}
