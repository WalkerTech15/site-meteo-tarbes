/* View switching, sidebar drawer, and the segmented-toggle helpers shared
   by the mode switch (nav + sidebar) and settings unit chips. */
import { state } from "../core/state.js";
import { $, $$ } from "../core/dom.js";
import { t } from "../core/i18n.js";
import { emit } from "../core/app-bus.js";
import { closeThemeMenu } from "../features/settings.js";
import { renderMap, updateMapLayerFades } from "../features/map.js";
import { loadFavWeather } from "../features/favorites.js";
import { loadComparison } from "./render-comparison.js";
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
  if (view === "favorites") {
    loadFavWeather();
    /* the comparison lives inside this view — see ui/render-comparison.js */
    loadComparison();
  }
  /* charts drawn while their view was hidden used a fallback width —
     redraw at the real container size once the view is visible. The map
     layer row was measured while #view-map was still hidden too (0 width),
     so its scroll-fade state needs the same re-check — independent of
     wx, unlike the two chart redraws below it. */
  requestAnimationFrame(() => {
    if (view === "map") updateMapLayerFades();
    if (!state.wx) return;
    if (view === "home") renderChart();
    if (view === "forecast") renderForecastPage();
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
  /* announced on the bus rather than by calling the URL layer directly, so
     navigation.js keeps no dependency on it (see core/app-bus.js) */
  emit("view:changed", view);
}

/* Below this width the sidebar becomes an off-canvas drawer (kept in sync with
   the `max-width: 900px` block in styles/utilities/responsive.css). Above it the
   sidebar is a permanently visible landmark and must never be inert/aria-hidden. */
const DRAWER_MQ = window.matchMedia("(max-width: 900px)");
const isDrawerMode = () => DRAWER_MQ.matches;

const FOCUSABLE =
  "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled])," +
  ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/* Rendered focusables only — getClientRects() (rather than offsetParent) because
   the open drawer is position:fixed, where offsetParent is unreliable. */
function drawerFocusables() {
  return $$(FOCUSABLE, $("#sidebar")).filter((el) => el.getClientRects().length > 0);
}

/* A translated-offscreen drawer is still in the tab order and the a11y tree, so
   closed === inert + aria-hidden. Called after every open/close and on every
   breakpoint change, so the two modes can never disagree. */
export function syncSidebarA11y() {
  const sidebar = $("#sidebar");
  const burger = $("#burgerBtn");
  const open = sidebar.classList.contains("is-open");
  if (isDrawerMode()) {
    sidebar.inert = !open;
    sidebar.setAttribute("aria-hidden", String(!open));
    burger.setAttribute("aria-expanded", String(open));
    burger.setAttribute("aria-label", t(open ? "closeMenu" : "openMenu"));
  } else {
    sidebar.inert = false;
    sidebar.removeAttribute("aria-hidden");
    burger.setAttribute("aria-expanded", "false");
    burger.setAttribute("aria-label", t("openMenu"));
  }
}

export function openSidebar() {
  const sidebar = $("#sidebar");
  sidebar.classList.add("is-open");
  $("#sidebarScrim").hidden = false;
  /* the drawer toggle was display:none until now — align its thumb */
  positionThumb($("#modeToggleSide"));
  syncSidebarA11y(); /* must lift inert before anything inside can take focus */
  const first = drawerFocusables()[0];
  ($(".side-item.is-active", sidebar) || first)?.focus();
}

export function closeSidebar() {
  const sidebar = $("#sidebar");
  const wasOpen = sidebar.classList.contains("is-open");
  sidebar.classList.remove("is-open");
  $("#sidebarScrim").hidden = true;
  /* focus has to leave before inert lands, otherwise the browser drops it to
     <body> and the user loses their place. Drawer mode only — on desktop the
     burger is display:none and the sidebar keeps focus legitimately. */
  if (wasOpen && isDrawerMode() && sidebar.contains(document.activeElement)) {
    $("#burgerBtn").focus();
  }
  syncSidebarA11y();
}

/* The burger's own click handler — open/closeSidebar stay the single source
   of truth for state changes triggered elsewhere (nav-item selection, Escape,
   the scrim), so this only decides which of the two to call. */
export function toggleSidebar() {
  const sidebar = $("#sidebar");
  if (sidebar.classList.contains("is-open")) closeSidebar();
  else openSidebar();
}

export function bindSidebarA11y() {
  const sidebar = $("#sidebar");
  /* Focus trap: Tab cycles within the open drawer instead of escaping to the
     page behind the scrim. */
  sidebar.addEventListener("keydown", (e) => {
    if (e.key !== "Tab" || !isDrawerMode() || !sidebar.classList.contains("is-open")) return;
    const items = drawerFocusables();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
  /* Crossing the breakpoint always resets the drawer to closed, in BOTH
     directions: going up, so the now-visible desktop sidebar is never left
     inert; coming back down, so a drawer that was open before the excursion
     doesn't reappear already open.

     Deliberately unconditional rather than `if (!isDrawerMode())`. Reading the
     live media state here describes where the viewport is *now*, not the
     transition being handled — and `change` is delivered in a task, so two
     rapid resizes across the breakpoint (375 → 1280 → 375) can run this
     handler once the viewport is already back where it started. The old
     guard then saw drawer mode, skipped the close, and syncSidebarA11y()
     faithfully reported the stale `is-open` as aria-hidden="false". Since
     neither direction may leave the drawer open, the guard bought nothing.
     `is-open` has no styling outside the ≤900px block, so closing on the way
     up is a no-op for the desktop layout. */
  DRAWER_MQ.addEventListener("change", () => {
    closeSidebar();
    syncSidebarA11y();
  });
  syncSidebarA11y();
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
