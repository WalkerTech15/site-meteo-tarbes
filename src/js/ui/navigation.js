/* View switching, sidebar drawer, and the segmented-toggle helpers shared
   by the mode switch (nav + sidebar) and settings unit chips. */
import { state } from "../core/state.js";
import { $, $$ } from "../core/dom.js";
import { closeThemeMenu } from "../features/settings.js";
import { renderMap } from "../features/map.js";
import { loadFavWeather } from "../features/favorites.js";
import { renderChart } from "./render-home.js";
import { renderForecastPage } from "./render-forecast.js";

export function switchView(view) {
  state.view = view;
  $$(".view").forEach((v) => {
    v.hidden = true;
    v.classList.remove("is-visible");
  });
  const target = $(`#view-${view}`);
  target.hidden = false;
  requestAnimationFrame(() => target.classList.add("is-visible"));
  $$(".side-item").forEach((b) => {
    const on = b.dataset.view === view;
    b.classList.toggle("is-active", on);
    if (on) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  closeSidebar();
  closeThemeMenu();
  if (view === "map" || view === "home") renderMap();
  if (view === "favorites") loadFavWeather();
  /* charts drawn while their view was hidden used a fallback width —
     redraw at the real container size once the view is visible */
  requestAnimationFrame(() => {
    if (!state.wx) return;
    if (view === "home") renderChart();
    if (view === "forecast") renderForecastPage();
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

export function openSidebar() {
  $("#sidebar").classList.add("is-open");
  $("#sidebarScrim").hidden = false;
  /* the drawer toggle was display:none until now — align its thumb */
  positionThumb($("#modeToggleSide"));
}
export function closeSidebar() {
  $("#sidebar").classList.remove("is-open");
  $("#sidebarScrim").hidden = true;
}

export function positionThumb(group) {
  const active = $('[aria-checked="true"]', group);
  const thumb = $(".seg-thumb", group);
  if (!active || !thumb) return;
  thumb.style.width = active.offsetWidth + "px";
  thumb.style.transform = `translateX(${active.offsetLeft - 4}px)`;
}

export function bindSegToggle(group, attr, onChange) {
  $$("button", group).forEach((btn) =>
    btn.addEventListener("click", () => {
      $$("button", group).forEach((b) =>
        b.setAttribute("aria-checked", b === btn ? "true" : "false"),
      );
      positionThumb(group);
      onChange(btn.dataset[attr]);
    }),
  );
}

export function syncSegToggle(group, attr, value) {
  $$("button", group).forEach((b) =>
    b.setAttribute("aria-checked", b.dataset[attr] === value ? "true" : "false"),
  );
  positionThumb(group);
}
