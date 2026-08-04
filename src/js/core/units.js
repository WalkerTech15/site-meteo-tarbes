/* Unit conversion + formatting, reading the user's chosen units from state. */
import { state } from "./state.js";
import { t } from "./i18n.js";

export const toF = (c) => (c * 9) / 5 + 32;
export const toMph = (k) => k / 1.609;

export const convTemp = (c) => (state.unitTemp === "f" ? toF(c) : c);
export const fmtTemp = (c) => Math.round(convTemp(c));
export const tempUnit = () => (state.unitTemp === "f" ? "°F" : "°C");

export const convWind = (k) =>
  state.unitWind === "mph" ? toMph(k) : state.unitWind === "ms" ? k / 3.6 : k;
export const fmtWind = (k) => Math.round(convWind(k));
export const windUnit = () => ({ kmh: "km/h", mph: "mph", ms: "m/s" })[state.unitWind];

/* Precipitation intensity. There is no separate precipitation unit in
   Settings, so it follows the temperature unit — the app's only imperial/
   metric signal, and the same pairing the old combined `ws_units` preference
   used. mm/h and in/h are exactly the two units the MapTiler precipitation
   layer itself reports (PrecipitationPickAt.value / .valueImperial), so a
   legend built on them can never disagree with the map. */
export const toInPerHour = (mm) => mm / 25.4;
export const convPrecip = (mm) => (state.unitTemp === "f" ? toInPerHour(mm) : mm);
export const precipUnit = () => (state.unitTemp === "f" ? "in/h" : "mm/h");

/* m/s is the MapTiler wind layer's own unit; convWind() speaks km/h. */
export const MS_TO_KMH = 3.6;

const COMPASS_KEYS = [
  "windDirN",
  "windDirNE",
  "windDirE",
  "windDirSE",
  "windDirS",
  "windDirSW",
  "windDirW",
  "windDirNW",
];
const COMPASS_ABBR = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/* Pure index/abbreviation lookup — no i18n dependency, easy to unit test. */
export function compassIndex(deg) {
  return Math.round((deg % 360) / 45) % 8;
}
export function compassAbbr(deg) {
  return COMPASS_ABBR[compassIndex(deg)];
}

export function compass(deg) {
  const i = compassIndex(deg);
  return { label: t(COMPASS_KEYS[i]), abbr: COMPASS_ABBR[i], deg };
}

export function uvLabel(uv) {
  if (uv < 3) return t("uvLow");
  if (uv < 6) return t("uvModerate");
  if (uv < 8) return t("uvHigh");
  if (uv < 11) return t("uvVeryHigh");
  return t("uvExtreme");
}
