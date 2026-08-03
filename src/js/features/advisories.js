/* Forecast-based severe-weather advisory detection.
 *
 * Pure: no DOM, no app state, no i18n, no network. It reads the weather object
 * the app ALREADY holds (services/weather-api.js) and returns descriptors made
 * of type keys and canonical metric numbers. Turning those into translated
 * sentences is the renderer's job (ui/render-advisory.js), which is what keeps
 * this file testable in plain Node and free of interface strings.
 *
 * These are advisories derived from a public forecast — never official
 * warnings. The wording that says so lives in the translation dictionary.
 *
 * Every threshold below is metric, and every comparison is made against the
 * canonical metric value, so switching the display units to °F or mph cannot
 * change whether an advisory appears — only how its number is printed.
 */

export const ADVISORY_LIMIT = 3;

export const THRESHOLDS = {
  windGustKmh: 70,
  feelsHotC: 40,
  feelsColdC: -15,
  visibilityM: 1000,
};

/* WMO weather-interpretation codes. Only the violent end of each family: 63
   (moderate rain) and 71 (slight snow) are ordinary weather and never raise an
   advisory. */
const CODES = {
  thunderstorm: [95, 96, 99], // storm, storm with slight/heavy hail
  heavyRain: [65, 67, 82], // heavy rain, heavy freezing rain, violent showers
  heavySnow: [75, 77, 86], // heavy snowfall, snow grains, heavy snow showers
};

const finite = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
/* the app normalises every visibility to kilometres; the threshold is metres */
const kmToM = (km) => (finite(km) === null ? null : km * 1000);

/* Ordered by the priority the brief sets out: a thunderstorm outranks extreme
   temperature, which outranks wind, snow, rain and finally fog. `peak` picks
   which of several matching hours supplies the number worth showing. */
const HAZARDS = [
  {
    type: "thunderstorm",
    severity: "high",
    test: (s) => CODES.thunderstorm.includes(s.code),
  },
  {
    type: "extremeHeat",
    severity: "high",
    unit: "temp",
    test: (s) => finite(s.feels) !== null && s.feels >= THRESHOLDS.feelsHotC,
    read: (s) => s.feels,
    peak: Math.max,
  },
  {
    type: "extremeCold",
    severity: "high",
    unit: "temp",
    test: (s) => finite(s.feels) !== null && s.feels <= THRESHOLDS.feelsColdC,
    read: (s) => s.feels,
    peak: Math.min,
  },
  {
    type: "strongWind",
    severity: "moderate",
    unit: "wind",
    /* gusts, not sustained wind — and a provider that omits gusts simply
       doesn't raise this advisory rather than falling back to a weaker field */
    test: (s) => finite(s.gust) !== null && s.gust >= THRESHOLDS.windGustKmh,
    read: (s) => s.gust,
    peak: Math.max,
  },
  {
    type: "heavySnow",
    severity: "moderate",
    test: (s) => CODES.heavySnow.includes(s.code),
  },
  {
    type: "heavyRain",
    severity: "moderate",
    test: (s) => CODES.heavyRain.includes(s.code),
  },
  {
    type: "denseFog",
    severity: "low",
    unit: "metres",
    test: (s) => finite(s.visM) !== null && s.visM <= THRESHOLDS.visibilityM,
    read: (s) => s.visM,
    peak: Math.min,
  },
];

/* One flat shape for "now" and for each of the next 24 hours, so a hazard is
   written once and applied to both. Anything malformed becomes null and every
   test above rejects null. */
function samples(wx) {
  const out = [];
  const c = wx.current;
  if (c && typeof c === "object") {
    out.push({
      at: null, // "now" has no hour of its own
      code: c.code,
      feels: finite(c.feels),
      gust: finite(c.gust),
      visM: kmToM(c.visibility),
    });
  }
  const hourly = Array.isArray(wx.hourly) ? wx.hourly : [];
  /* the normalised series starts at the current hour and runs 25 entries — the
     rest of the week is not part of a "next 24 hours" advisory */
  for (const h of hourly.slice(0, 25)) {
    if (!h || typeof h !== "object") continue;
    out.push({
      at: typeof h.time === "string" ? h.time : null,
      code: h.code,
      feels: finite(h.feels),
      gust: finite(h.gust),
      visM: kmToM(h.vis),
    });
  }
  return out;
}

/**
 * @param {object} wx normalised weather (current + hourly), as held in state
 * @param {number} limit most advisories to return, highest priority first
 * @returns {Array<{type,severity,priority,now,from,to,value,unit}>}
 *   `from`/`to` are ISO hour strings bounding the forecast window, or null when
 *   only the current conditions match. `value` is the peak metric reading
 *   (°C / km·h⁻¹ / metres) or null for the code-based hazards.
 */
export function detectAdvisories(wx, limit = ADVISORY_LIMIT) {
  if (!wx || typeof wx !== "object") return [];
  const all = samples(wx);
  const found = [];

  for (const [i, hazard] of HAZARDS.entries()) {
    const hits = all.filter((s) => {
      try {
        return hazard.test(s) === true;
      } catch {
        return false; // a malformed sample is never a hazard
      }
    });
    if (hits.length === 0) continue;

    const timed = hits.filter((s) => s.at !== null);
    const values = hazard.read ? hits.map(hazard.read).filter((v) => finite(v) !== null) : [];
    found.push({
      type: hazard.type,
      severity: hazard.severity,
      priority: i + 1,
      now: hits.some((s) => s.at === null),
      from: timed.length ? timed[0].at : null,
      to: timed.length ? timed[timed.length - 1].at : null,
      value: values.length ? hazard.peak(...values) : null,
      unit: hazard.unit || null,
    });
  }

  /* HAZARDS is already in priority order, so the most urgent survives the cut */
  return found.slice(0, Math.max(0, limit));
}
