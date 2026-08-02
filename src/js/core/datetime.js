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
