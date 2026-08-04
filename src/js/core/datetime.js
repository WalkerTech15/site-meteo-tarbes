/* Date/time formatting, language-aware (reads state.lang). Shared by the
   home view and the forecast view so there is exactly one implementation. */
import { state } from "./state.js";
import { t } from "./i18n.js";

export function fmtHour(iso) {
  const h = parseInt(iso.slice(11, 13), 10);
  if (state.lang === "fr") return `${h} h`;
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 === 0 ? 12 : h % 12} ${ampm}`;
}

export function fmtClock(iso) {
  const h = iso.slice(11, 13),
    m = iso.slice(14, 16);
  if (state.lang === "fr") return `${parseInt(h, 10)} h ${m}`;
  const hh = parseInt(h, 10);
  return `${hh % 12 === 0 ? 12 : hh % 12}:${m} ${hh >= 12 ? "PM" : "AM"}`;
}

export function fmtDay(dateStr, short = true) {
  const d = new Date(dateStr + "T12:00:00");
  const arr = short ? t("daysShort") : t("days");
  return arr[d.getDay()];
}

export function fmtDate(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  return state.lang === "fr"
    ? `${d.getDate()} ${t("months")[d.getMonth()].toLowerCase()}`
    : `${t("months")[d.getMonth()]} ${d.getDate()}`;
}

/* Absolute instant (day + clock) in the visitor's own zone, used by the map
   timeline to name the real moment the weather overlay is showing. Unlike the
   helpers above — which format a location's local ISO string — this takes a
   Date or epoch value, so Intl handles day rollover and month names for it. */
export function fmtDateTime(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const locale = state.lang === "fr" ? "fr-FR" : "en-US";
  try {
    return new Intl.DateTimeFormat(locale, {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 16).replace("T", " "); /* unsupported locale/runtime */
  }
}
