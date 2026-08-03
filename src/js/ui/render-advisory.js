/* Renders the forecast-advisory banner on the home view.
 *
 * Detection lives in features/advisories.js and is pure and metric; this file
 * only turns its descriptors into translated, unit-formatted markup. No
 * interface string is written here — every one comes from the I18N dictionary,
 * so both languages stay in step.
 *
 * The banner is an in-page advisory. It requests no notification permission and
 * schedules nothing: it exists only while the home view is on screen.
 */
import { state } from "../core/state.js";
import { $, esc } from "../core/dom.js";
import { t } from "../core/i18n.js";
import { fmtTemp, tempUnit, fmtWind, windUnit } from "../core/units.js";
import { fmtHour } from "../core/datetime.js";
import { ADVISORY_ICONS } from "../data/icons.js";
import { detectAdvisories } from "../features/advisories.js";

/* Values are stored in canonical metric units and printed in the user's own:
   changing to °F or mph changes this line, never whether the banner appears. */
function formatValue(adv) {
  if (adv.value == null) return "";
  /* non-breaking spaces: "88 km/h" must not wrap onto two lines on a phone */
  if (adv.unit === "temp") return `${fmtTemp(adv.value)}${tempUnit()}`;
  if (adv.unit === "wind") return `${fmtWind(adv.value)}\u00A0${windUnit()}`;
  if (adv.unit === "metres") return `${Math.round(adv.value)}\u00A0m`;
  return String(adv.value);
}

/* Localised hour labels ("3 PM" / "15 h") come from the shared date helper. */
function formatWindow(adv) {
  const from = adv.from ? fmtHour(adv.from) : null;
  const to = adv.to ? fmtHour(adv.to) : null;
  if (adv.now) return to && to !== from ? t("advNowUntil").replace("{to}", to) : t("advNow");
  if (from && to && from !== to) return t("advWindow").replace("{from}", from).replace("{to}", to);
  if (from) return t("advWindowAt").replace("{from}", from);
  return t("advNow");
}

const SEVERITY_LABEL = {
  high: "advSevHigh",
  moderate: "advSevModerate",
  low: "advSevLow",
};

/* Capitalised type key → translation keys, e.g. "thunderstorm" →
   advThunderstormTitle / …Desc / …Tip. */
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function advisoryHtml(adv) {
  const key = cap(adv.type);
  const desc = t(`adv${key}Desc`).replace("{value}", formatValue(adv));
  /* The severity is spelled out, not just coloured, and the icon is decorative:
     the banner reads correctly in monochrome and to a screen reader. */
  return `
    <article class="advisory adv--${esc(adv.severity)}">
      <span class="adv-icon" aria-hidden="true">${ADVISORY_ICONS[adv.type] || ""}</span>
      <div class="adv-body">
        <p class="adv-kicker">
          <span>${t("advKicker")}</span>
          <span class="adv-sev">${t(SEVERITY_LABEL[adv.severity] || "advSevLow")}</span>
        </p>
        <h3 class="adv-title">${t(`adv${key}Title`)}</h3>
        <p class="adv-desc">${esc(desc)}</p>
        <p class="adv-meta"><b>${t("advWhen")}</b> ${esc(formatWindow(adv))}</p>
        <p class="adv-meta"><b>${t("advAdvice")}</b> ${t(`adv${key}Tip`)}</p>
      </div>
    </article>`;
}

/* A live region that rewrote itself on every repaint would re-announce the same
   advisory each time the "updated N min ago" line ticks. Comparing a signature
   first means the region only speaks when something actually changed. */
let lastSignature = null;

function signatureOf(advisories) {
  return advisories.length === 0
    ? "none"
    : [
        state.lang,
        state.unitTemp,
        state.unitWind,
        ...advisories.map((a) => `${a.type}:${a.from}:${a.to}:${Math.round(a.value ?? 0)}`),
      ].join("|");
}

/* Called while a new location's weather is still loading, so the previous
   city's hazards can never linger over the incoming one. */
export function clearAdvisory() {
  const region = $("#advisoryRegion");
  if (!region) return;
  region.hidden = true;
  $("#advisoryList").innerHTML = "";
  lastSignature = null;
}

export function renderAdvisory() {
  const region = $("#advisoryRegion");
  if (!region) return;
  const list = $("#advisoryList");
  const advisories = detectAdvisories(state.wx);
  const signature = signatureOf(advisories);
  if (signature === lastSignature) return; // nothing changed — stay silent
  lastSignature = signature;

  if (advisories.length === 0) {
    region.hidden = true; // no meaningful hazard → the component leaves no trace
    list.innerHTML = "";
    return;
  }
  list.innerHTML =
    advisories.map(advisoryHtml).join("") + `<p class="adv-disclaimer">${t("advDisclaimer")}</p>`;
  region.hidden = false;
}
