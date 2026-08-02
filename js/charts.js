/* ═══════════════════════════════════════════════════════════════
   WeatherSphere — Interactive SVG line charts
   Smooth monotone curve · 10% area wash · crosshair + tooltip
   ═══════════════════════════════════════════════════════════════ */

function renderLineChart(host, opts) {
  const { points, color, unit, ariaLabel } = opts;
  host.innerHTML = "";
  host.setAttribute("aria-label", ariaLabel || "");

  /* draw at the host's real size so nothing is stretched or squished */
  const W = Math.max(260, host.clientWidth || 900);
  const H = host.clientHeight || 300;
  const PAD = { top: 24, right: 20, bottom: 34, left: 48 };
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;

  const vals = points.map(p => p.v);
  let vMin = Math.min(...vals), vMax = Math.max(...vals);
  if (vMax - vMin < 1e-6) { vMax += 1; vMin -= 1; }
  const span = vMax - vMin;
  vMin -= span * 0.12; vMax += span * 0.12;

  const x = i => PAD.left + (i / (points.length - 1)) * iw;
  const y = v => PAD.top + (1 - (v - vMin) / (vMax - vMin)) * ih;

  /* Monotone-ish smooth path (Catmull-Rom → cubic Bézier) */
  let d = `M ${x(0)} ${y(points[0].v)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)], p1 = points[i],
          p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
    const x1 = x(i), y1 = y(p1.v), x2 = x(i + 1), y2 = y(p2.v);
    const cx1 = x1 + (x(Math.min(points.length - 1, i + 1)) - x(Math.max(0, i - 1))) / 6;
    const cy1 = y1 + (y(p2.v) - y(p0.v)) / 6;
    const cx2 = x2 - (x(Math.min(points.length - 1, i + 2)) - x(i)) / 6;
    const cy2 = y2 - (y(p3.v) - y(p1.v)) / 6;
    d += ` C ${cx1.toFixed(1)} ${cy1.toFixed(1)}, ${cx2.toFixed(1)} ${cy2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  }
  const areaD = `${d} L ${x(points.length - 1)} ${PAD.top + ih} L ${x(0)} ${PAD.top + ih} Z`;

  /* Clean y ticks */
  const tickCount = 4;
  const rawStep = (vMax - vMin) / tickCount;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= rawStep) || rawStep;
  const tickStart = Math.ceil(vMin / step) * step;
  const ticks = [];
  for (let v = tickStart; v <= vMax + 1e-9; v += step) ticks.push(v);

  const gid = "cg" + Math.random().toString(36).slice(2, 8);
  let gridSvg = "", labelSvg = "";
  for (const tv of ticks) {
    const ty = y(tv);
    gridSvg += `<line x1="${PAD.left}" y1="${ty}" x2="${W - PAD.right}" y2="${ty}" stroke="var(--grid-line)" stroke-width="1"/>`;
    labelSvg += `<text x="${PAD.left - 10}" y="${ty + 4}" text-anchor="end" font-size="12" fill="var(--axis-ink)">${formatTick(tv)}</text>`;
  }
  /* x labels: adapt density to available width */
  const labelStep = W < 480 ? 8 : W < 760 ? 6 : 4;
  for (let i = 0; i < points.length; i += labelStep) {
    labelSvg += `<text x="${x(i)}" y="${H - 10}" text-anchor="middle" font-size="12" fill="var(--axis-ink)">${points[i].t}</text>`;
  }

  const lastI = points.length - 1;
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.innerHTML = `
    <defs>
      <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${color}" stop-opacity=".16"/>
        <stop offset="1" stop-color="${color}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${gridSvg}
    <line x1="${PAD.left}" y1="${PAD.top + ih}" x2="${W - PAD.right}" y2="${PAD.top + ih}" stroke="#DBE2EC" stroke-width="1"/>
    <path d="${areaD}" fill="url(#${gid})"/>
    <path class="chart-line" d="${d}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
          pathLength="1" stroke-dasharray="1" stroke-dashoffset="1">
      <animate attributeName="stroke-dashoffset" from="1" to="0" dur="0.9s" fill="freeze" calcMode="spline" keySplines="0.22 1 0.36 1"/>
    </path>
    <circle cx="${x(lastI)}" cy="${y(points[lastI].v)}" r="5" fill="${color}" stroke="var(--card)" stroke-width="2.5"/>
    ${labelSvg}
    <line class="chart-cross" x1="0" y1="${PAD.top}" x2="0" y2="${PAD.top + ih}" stroke="${color}" stroke-width="1.2" stroke-dasharray="none" opacity="0"/>
    <circle class="chart-dot" r="6" fill="${color}" stroke="var(--card)" stroke-width="3" opacity="0"/>
  `;
  host.appendChild(svg);

  const tooltip = document.createElement("div");
  tooltip.className = "chart-tooltip";
  host.appendChild(tooltip);

  const cross = svg.querySelector(".chart-cross");
  const dot = svg.querySelector(".chart-dot");

  function onMove(clientX) {
    const rect = host.getBoundingClientRect();
    const relX = (clientX - rect.left) / rect.width * W;
    let i = Math.round((relX - PAD.left) / iw * (points.length - 1));
    i = Math.max(0, Math.min(points.length - 1, i));
    const px = x(i), py = y(points[i].v);

    cross.setAttribute("x1", px); cross.setAttribute("x2", px);
    cross.setAttribute("opacity", ".45");
    dot.setAttribute("cx", px); dot.setAttribute("cy", py);
    dot.setAttribute("opacity", "1");

    tooltip.innerHTML = `<div class="tt-val">${opts.format(points[i].v)}<span style="font-size:12px;font-weight:600;opacity:.8"> ${unit}</span></div><div class="tt-time">${points[i].t}</div>`;
    tooltip.style.left = `${px / W * 100}%`;
    tooltip.style.top = `${py / H * 100}%`;
    tooltip.classList.add("on");
  }
  function onLeave() {
    cross.setAttribute("opacity", "0");
    dot.setAttribute("opacity", "0");
    tooltip.classList.remove("on");
  }

  host.onpointermove = e => onMove(e.clientX);
  host.onpointerleave = onLeave;
  host.ontouchstart = e => onMove(e.touches[0].clientX);
  host.ontouchmove = e => onMove(e.touches[0].clientX);
  host.ontouchend = onLeave;
}

function formatTick(v) {
  const abs = Math.abs(v);
  if (abs >= 1000) return Math.round(v).toLocaleString();
  if (abs >= 100) return Math.round(v).toString();
  return (Math.round(v * 10) / 10).toString();
}

/* Simple percentage bar chart (precipitation) — value labels on top */
function renderBarChart(host, opts) {
  const { points, ariaLabel } = opts;
  host.innerHTML = "";
  host.setAttribute("aria-label", ariaLabel || "");

  const W = Math.max(260, host.clientWidth || 900);
  const H = host.clientHeight || 300;
  const PAD = { top: 36, right: 16, bottom: 34, left: 46 };
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const max = 100;

  const gid = "bg" + Math.random().toString(36).slice(2, 8);
  let gridSvg = "", barsSvg = "";
  for (const tv of [0, 25, 50, 75, 100]) {
    const ty = PAD.top + (1 - tv / max) * ih;
    gridSvg += `<line x1="${PAD.left}" y1="${ty}" x2="${W - PAD.right}" y2="${ty}" stroke="var(--grid-line)" stroke-width="1"/>
      <text x="${PAD.left - 10}" y="${ty + 4}" text-anchor="end" font-size="12" fill="var(--axis-ink)">${tv}%</text>`;
  }

  const slot = iw / points.length;
  const bw = Math.min(44, slot * 0.44);
  /* thin out the hour labels when bars get narrow, so they never collide */
  const xLabelStep = slot >= 52 ? 1 : 2;
  points.forEach((p, i) => {
    const cx = PAD.left + slot * (i + 0.5);
    const v = Math.max(0, Math.min(max, p.v));
    const bh = Math.max(3, (v / max) * ih);
    const y = PAD.top + ih - bh;
    barsSvg += `
      <rect x="${(cx - bw / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}"
            rx="5" fill="url(#${gid})">
        <animate attributeName="height" from="3" to="${bh.toFixed(1)}" dur="0.6s" fill="freeze" calcMode="spline" keySplines="0.22 1 0.36 1"/>
        <animate attributeName="y" from="${(PAD.top + ih - 3).toFixed(1)}" to="${y.toFixed(1)}" dur="0.6s" fill="freeze" calcMode="spline" keySplines="0.22 1 0.36 1"/>
      </rect>
      <text x="${cx.toFixed(1)}" y="${(y - 8).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="600" fill="var(--text-2)">${Math.round(v)}%</text>
      ${i % xLabelStep === 0 ? `<text x="${cx.toFixed(1)}" y="${H - 10}" text-anchor="middle" font-size="12" fill="var(--axis-ink)">${p.t}</text>` : ""}`;
  });

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.innerHTML = `
    <defs>
      <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#2563EB"/>
        <stop offset="1" stop-color="#93C5FD"/>
      </linearGradient>
    </defs>
    ${gridSvg}${barsSvg}`;
  host.appendChild(svg);
}
