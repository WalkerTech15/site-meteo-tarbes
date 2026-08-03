/* Favorites view rendering: card grid + quick-list table. */
import { state } from "../core/state.js";
import { $, esc } from "../core/dom.js";
import { t } from "../core/i18n.js";
import { weatherIcon } from "../data/icons.js";
import { wmo, wxDesc } from "../data/weather-codes.js";
import { fmtTemp, tempUnit, fmtWind, windUnit } from "../core/units.js";
import { locName, locCountry, flagsHtml } from "../core/location.js";
import { flagHtml } from "../data/flags.js";
import { gradBg, locVisual } from "../services/photo-api.js";
import { favWx, favWxAt, persistFavs } from "../features/favorites.js";
import { showToast } from "./notifications.js";
import { selectLocation } from "../features/location.js";
import { switchView } from "./navigation.js";
import { renderHero } from "./render-home.js";

function favAgoText() {
  const mins = Math.max(0, Math.round((Date.now() - favWxAt) / 60000));
  return mins < 1 ? t("justNow") : t("agoMin").replace("{m}", mins);
}

function favCardHtml(loc, i) {
  const w = favWx[loc.id];
  const openLabel = esc(t("openLocation").replace("{name}", locName(loc)));
  /* A plain <article> container with two sibling buttons: a full-bleed overlay
     button that opens the location, and the remove button raised above it. The
     previous role="button" wrapper nested the remove control inside another
     control, which is invalid and made the card unusable with a screen reader. */
  return `
    <article class="favx-card" style="animation-delay:${i * 60}ms">
      <span class="favx-bg" style="${gradBg(loc)}" aria-hidden="true"></span>
      <span class="favx-emoji" aria-hidden="true">${locVisual(loc)}</span>
      <span class="favx-top">
        ${flagsHtml(loc, "small")}
        <span class="favx-names"><b>${esc(locName(loc))}</b><span>${esc(locCountry(loc))}</span></span>
        <button class="favx-star" data-remove="${esc(loc.id)}" aria-label="${t("removeFavorite")}">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="#FBBF24" stroke="#FBBF24" stroke-width="1.6" stroke-linejoin="round"><path d="m12 3 2.7 5.6 6.3.9-4.5 4.4 1 6.1L12 17l-5.5 3 1-6.1L3 9.5l6.3-.9L12 3z"/></svg>
        </button>
      </span>
      <span class="favx-main">
        ${
          w
            ? `
          <span class="favx-temp">${fmtTemp(w.temp)}<sup>${tempUnit()}</sup></span>
          <span class="favx-desc"><span class="favx-wicon">${weatherIcon(wmo(w.code).icon, w.isDay)}</span> ${wxDesc(w.code, state.lang)}</span>
          <span class="favx-chips">
            <span>↑ ${fmtTemp(w.hi)}°</span><span>↓ ${fmtTemp(w.lo)}°</span>
            <span>💧 ${Math.round(w.humidity)}%</span><span>🍃 ${fmtWind(w.wind)} ${windUnit()}</span>
          </span>`
            : `<span class="favx-temp">…</span>`
        }
      </span>
      <span class="favx-foot">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
        ${t("updated")} ${favAgoText()}
      </span>
      <button class="favx-open" data-loc="${esc(loc.id)}" aria-label="${openLabel}"></button>
    </article>`;
}

function favRowHtml(loc) {
  const w = favWx[loc.id];
  return `
    <tr data-loc="${esc(loc.id)}">
      <td>
        <button class="ft-open ft-place">
          <span class="ft-visual" style="${gradBg(loc)}" aria-hidden="true">${locVisual(loc)}</span>
          <span class="ft-names">${flagHtml(loc.cc, "", state.lang)} <b>${esc(locName(loc))}</b><span>${esc(locCountry(loc))}</span></span>
        </button>
      </td>
      <td><span class="ft-cond">${w ? `<span class="ft-wicon">${weatherIcon(wmo(w.code).icon, w.isDay)}</span> ${wxDesc(w.code, state.lang)}` : "…"}</span></td>
      <td><b>${w ? fmtTemp(w.temp) + tempUnit() : "—"}</b></td>
      <td>${w ? `<span class="ft-hi">${fmtTemp(w.hi)}°</span> / <span class="ft-lo">${fmtTemp(w.lo)}°</span>` : "—"}</td>
      <td>💧 ${w ? Math.round(w.humidity) + "%" : "—"}</td>
      <td>🍃 ${w ? fmtWind(w.wind) + " " + windUnit() : "—"}</td>
      <td class="ft-ago">${favAgoText()}</td>
      <td>
        <button class="fav-remove-s" data-remove="${esc(loc.id)}" aria-label="${t("removeFavorite")}">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button>
      </td>
    </tr>`;
}

function favClickHandler(e) {
  const rm = e.target.closest("[data-remove]");
  if (rm) {
    e.stopPropagation();
    state.favorites = state.favorites.filter((f) => f.id !== rm.dataset.remove);
    persistFavs();
    renderFavorites();
    if (state.loc) renderHero();
    showToast(t("removedFav"));
    return;
  }
  const host = e.target.closest("[data-loc]");
  if (!host) return;
  const loc = state.favorites.find((f) => f.id === host.dataset.loc);
  if (loc) {
    selectLocation(loc);
    switchView("home");
  }
}

export function renderFavorites() {
  const grid = $("#favGrid");
  const listBlock = $("#favListBlock");
  const badge = $("#favBadge");
  badge.hidden = state.favorites.length === 0;
  badge.textContent = state.favorites.length;

  if (!state.favorites.length) {
    grid.hidden = false;
    grid.innerHTML = `
      <div class="empty-state">
        <div class="big" aria-hidden="true">⭐</div>
        <h3>${t("favEmptyTitle")}</h3>
        <p>${t("favEmptyText")}</p>
      </div>`;
    listBlock.hidden = true;
    return;
  }

  /* exactly one of the two representations is ever in the DOM flow — showing
     both meant the "grid" view also rendered the full table underneath it */
  grid.hidden = state.favView === "list";
  listBlock.hidden = state.favView !== "list";
  grid.innerHTML = state.favorites.map(favCardHtml).join("");

  $("#favTable").innerHTML = `
    <thead><tr>
      <th>${t("colPlace")}</th><th>${t("colConditions")}</th><th>${t("colTemp")}</th>
      <th>${t("colMaxMin")}</th><th>${t("humidity")}</th><th>${t("wind")}</th>
      <th>${t("updated")}</th><th></th>
    </tr></thead>
    <tbody>${state.favorites.map(favRowHtml).join("")}</tbody>`;

  /* every interactive target is now a real <button>, so Enter/Space activate
     natively and no synthetic keydown handler is needed */
  grid.onclick = favClickHandler;
  $("#favTable").onclick = favClickHandler;
}
