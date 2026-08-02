/* Central UI state — a single shared mutable object, imported by every
   module that needs to read or change it (mirrors how the original single-
   file app used one global `state`, just made explicit via ES module
   imports instead of an implicit global). */
import { getStr, getJSON, KEYS } from "./storage.js";

const DEFAULT_NOTIFS = { alerts: true, daily: true, changes: true, features: false };

const legacyImperial = getStr(KEYS.legacyUnits) === "imperial";

export const state = {
  lang: getStr(KEYS.lang, "fr"),
  mode: getStr(KEYS.mode, "simple"),
  unitTemp: getStr(KEYS.unitTemp, legacyImperial ? "f" : "c"),
  unitWind: getStr(KEYS.unitWind, legacyImperial ? "mph" : "kmh"),
  theme: getStr(KEYS.theme, "light"),
  notifs: getJSON(KEYS.notifs, DEFAULT_NOTIFS),
  favorites: getJSON(KEYS.favorites, []),
  loc: null,
  wx: null,
  isDemo: false,
  view: "home",
  chartTab: "temp",
  fcTab: "temp",
  favView: "grid",
};
