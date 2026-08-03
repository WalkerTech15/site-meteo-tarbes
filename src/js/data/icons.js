/* Animated SVG weather icons.
   weatherIcon(type, isDay) → SVG string (animated via CSS in
   styles/components/weather-icons.css) */

const ICON_DEFS = `
  <defs>
    <linearGradient id="wiSun" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#FDE68A"/><stop offset="1" stop-color="#F59E0B"/>
    </linearGradient>
    <linearGradient id="wiCloud" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#AFC0D4"/>
    </linearGradient>
    <linearGradient id="wiCloudDark" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#C6D2E0"/><stop offset="1" stop-color="#7E93AC"/>
    </linearGradient>
    <linearGradient id="wiMoon" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#FEF9C3"/><stop offset="1" stop-color="#FDE047"/>
    </linearGradient>
  </defs>`;

function _sun(cx = 32, cy = 32, r = 13) {
  let rays = "";
  for (let i = 0; i < 8; i++) {
    const a = (i * 45 * Math.PI) / 180;
    const x1 = cx + Math.cos(a) * (r + 5),
      y1 = cy + Math.sin(a) * (r + 5);
    const x2 = cx + Math.cos(a) * (r + 10),
      y2 = cy + Math.sin(a) * (r + 10);
    rays += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#FBBF24" stroke-width="3.4" stroke-linecap="round"/>`;
  }
  /* Pass the real centre to CSS. The partly-cloudy icon places its sun at
     (24, 23), so rotating every ray group around the clear-sky centre (32, 32)
     made that sun orbit and wobble instead of spinning in place. */
  return `<g class="sun-rays" style="--sun-cx:${cx}px;--sun-cy:${cy}px">${rays}</g><circle class="sun-core" cx="${cx}" cy="${cy}" r="${r}" fill="url(#wiSun)"/>`;
}

function _moon(cx = 32, cy = 32) {
  return `<g class="moon">
    <path d="M ${cx + 9} ${cy - 10} A 15 15 0 1 0 ${cx + 12} ${cy + 9} A 12 12 0 0 1 ${cx + 9} ${cy - 10} Z" fill="url(#wiMoon)"/>
    <circle class="star" cx="${cx - 15}" cy="${cy - 13}" r="1.8" fill="#FDE047"/>
    <circle class="star d2" cx="${cx - 9}" cy="${cy - 20}" r="1.3" fill="#FDE047"/>
  </g>`;
}

function _cloud(x, y, s = 1, dark = false, cls = "cloud-a") {
  const fill = dark ? "url(#wiCloudDark)" : "url(#wiCloud)";
  return `<g transform="translate(${x} ${y}) scale(${s})"><g class="${cls}">
    <circle cx="-8" cy="2" r="9" fill="${fill}"/>
    <circle cx="2" cy="-4" r="11" fill="${fill}"/>
    <circle cx="12" cy="3" r="8" fill="${fill}"/>
    <rect x="-16" y="2" width="36" height="9" rx="4.5" fill="${fill}"/>
  </g></g>`;
}

function _drops() {
  /* middle drop stays static so the icon always reads as "rain",
     the outer two animate for life */
  return `
    <line class="drop"    x1="24" y1="44" x2="22" y2="50" stroke="#38BDF8" stroke-width="3" stroke-linecap="round"/>
    <line class="drop-fix" x1="33" y1="44" x2="31" y2="50" stroke="#38BDF8" stroke-width="3" stroke-linecap="round"/>
    <line class="drop d3" x1="42" y1="44" x2="40" y2="50" stroke="#38BDF8" stroke-width="3" stroke-linecap="round"/>`;
}

function _flakes() {
  return `
    <circle class="flake"    cx="24" cy="46" r="2.4" fill="#BAE6FD"/>
    <circle class="flake-fix" cx="33" cy="46" r="2.4" fill="#E0F2FE"/>
    <circle class="flake d3" cx="42" cy="46" r="2.4" fill="#BAE6FD"/>`;
}

const WEATHER_ICONS = {
  clear: (day) => (day ? _sun() : _moon()),
  partly: (day) => (day ? _sun(24, 23, 10) : _moon(24, 23)) + _cloud(35, 40, 0.95),
  cloudy: () => _cloud(38, 30, 0.85, true, "cloud-b") + _cloud(29, 38, 0.95),
  rain: () => _cloud(32, 29, 1.0, true) + _drops(),
  snow: () => _cloud(32, 29, 1.0) + _flakes(),
  storm: () =>
    _cloud(32, 26, 1.0, true) +
    `<path class="bolt" d="M31 36 L26 47 h5 l-3 9 9-13 h-5 l4-7 z" fill="#FBBF24" stroke="#F59E0B" stroke-width=".8" stroke-linejoin="round"/>`,
  fog: () =>
    _cloud(32, 24, 0.85, true) +
    `<line class="fog-line"    x1="18" y1="42" x2="46" y2="42" stroke="#CBD5E1" stroke-width="3.4" stroke-linecap="round"/>
     <line class="fog-line d2" x1="22" y1="49" x2="42" y2="49" stroke="#E2E8F0" stroke-width="3.4" stroke-linecap="round"/>`,
};

/* Gradients injected once into the page — embedding ICON_DEFS in every icon
   instance would duplicate the same SVG ids dozens of times (invalid HTML).
   Call once during app bootstrap (see main.js), after <body> exists. */
export function injectIconDefs() {
  const holder = document.createElement("span");
  holder.setAttribute("aria-hidden", "true");
  holder.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
  holder.innerHTML = `<svg width="0" height="0" focusable="false">${ICON_DEFS}</svg>`;
  document.body.appendChild(holder);
}

export function weatherIcon(type, isDay = true, extraClass = "") {
  const draw = WEATHER_ICONS[type] || WEATHER_ICONS.clear;
  /* tight viewBox: the artwork fills its box instead of floating in padding */
  return `<svg class="wi ${extraClass}" viewBox="2 2 60 60" aria-hidden="true">${draw(!!isDay)}</svg>`;
}

/* Small colorful metric icons (stroke style, tinted chip behind) */
export const METRIC_ICONS = {
  temperature: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13.5V5a2 2 0 1 1 4 0v8.5a4.5 4.5 0 1 1-4 0z"/><circle cx="12" cy="17.5" r="1.6" fill="currentColor" stroke="none"/></svg>`,
  feels: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M8 13.5V6a2 2 0 1 1 4 0v7.5a4 4 0 1 1-4 0z"/><path d="M16 5c1.5 1.5 1.5 3.5 0 5M19 3c2.5 2.5 2.5 6.5 0 9"/></svg>`,
  humidity: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3s6.5 7 6.5 11.5a6.5 6.5 0 1 1-13 0C5.5 10 12 3 12 3z"/><path d="M9.5 15.5a2.8 2.8 0 0 0 2.5 2.6"/></svg>`,
  wind: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M3 8h10a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7a2.5 2.5 0 1 1-2.5 2.5"/></svg>`,
  direction: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5.5-5.5 2 2-5.5z" fill="currentColor" stroke="none"/></svg>`,
  pressure: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M5 19a9 9 0 1 1 14 0"/><path d="M12 13l3.5-4.5"/><circle cx="12" cy="14" r="1.7" fill="currentColor" stroke="none"/></svg>`,
  uv: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12h2.5M19 12h2.5M5 5l1.8 1.8M17.2 17.2 19 19M19 5l-1.8 1.8M6.8 17.2 5 19"/></svg>`,
  visibility: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>`,
  sunrise: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18h16M7 15a5 5 0 0 1 10 0"/><path d="M12 3v5M9.5 5.5 12 3l2.5 2.5"/></svg>`,
  sunset: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18h16M7 15a5 5 0 0 1 10 0"/><path d="M12 8V3M9.5 5.5 12 8l2.5-2.5"/></svg>`,
  rain: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M7 14a5 5 0 0 1 .8-9.94A6 6 0 0 1 19.5 6.5 4.5 4.5 0 0 1 18 14H7z"/><path d="M8 17.5 7 20M12.5 17.5l-1 2.5M17 17.5 16 20"/></svg>`,
  dew: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4s5 5.4 5 8.9A5 5 0 1 1 7 12.9C7 9.4 12 4 12 4z"/><path d="M4.5 19.5h15"/></svg>`,
};

/* One icon per forecast-advisory type (features/advisories.js). Same stroke
   style as METRIC_ICONS and drawn in `currentColor`, so each one picks up its
   severity colour. Purely decorative — every banner states its hazard in text,
   so the renderer marks these aria-hidden. */
export const ADVISORY_ICONS = {
  thunderstorm: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M7 14a5 5 0 0 1 .8-9.94A6 6 0 0 1 19.5 6.5 4.5 4.5 0 0 1 18 14"/><path d="m13 11-3.5 5H13l-1.5 4.5"/></svg>`,
  extremeHeat: METRIC_ICONS.temperature,
  extremeCold: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5v19M3.8 7.2l16.4 9.6M20.2 7.2 3.8 16.8"/><path d="M12 6.5 9.6 4.4M12 6.5l2.4-2.1M12 17.5l-2.4 2.1M12 17.5l2.4 2.1"/></svg>`,
  strongWind: METRIC_ICONS.wind,
  heavySnow: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M7 13.5a5 5 0 0 1 .8-9.94A6 6 0 0 1 19.5 6 4.5 4.5 0 0 1 18 13.5H7z"/><path d="M8 17.5h.01M12 19.5h.01M16 17.5h.01M10 21h.01M14 21h.01"/></svg>`,
  heavyRain: METRIC_ICONS.rain,
  denseFog: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 11a4.5 4.5 0 0 1 .7-8.95A5.5 5.5 0 0 1 18 4.5 4 4 0 0 1 17.5 11"/><path d="M4 14.5h16M6 18h12M9 21.5h9"/></svg>`,
};
