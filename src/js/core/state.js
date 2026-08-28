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
  /* "24" matches the previous unconfigurable default (fr-FR's Intl default,
     and the app's own default language) — introducing the setting changes
     no one's display until they explicitly pick 12-hour. */
  clockFormat: getStr(KEYS.clockFormat, "24"),
  /* off by default — getStr() returns null for a visitor who never set it,
     and null !== "1" */
  clockSeconds: getStr(KEYS.clockSeconds) === "1",
  notifs: getJSON(KEYS.notifs, DEFAULT_NOTIFS),
  favorites: getJSON(KEYS.favorites, []),
  /* Recent searches: opt-in, so a missing flag means off for a new visitor.
     The list itself is loaded/sanitized by features/recent-locations.js at
     startup — kept here so every view reads one shared value. */
  saveRecents: getStr(KEYS.recentsOptIn) === "1",
  recents: [],
  loc: null,
  wx: null,
  isDemo: false,
  view: "home",
  chartTab: "temp",
  fcTab: "temp",
  favView: "grid",
};
