/* Favorites view rendering: card grid + quick-list table. */
import { state } from "../core/state.js";
import { $, esc } from "../core/dom.js";
import { t } from "../core/i18n.js";
import { weatherIcon } from "../data/icons.js";
import { wmo, wxDesc } from "../data/weather-codes.js";
import { fmtTemp, tempUnit, fmtWind, windUnit } from "../core/units.js";
import { locName, locCountry, kindLabel, flagsHtml } from "../core/location.js";
import { flagHtml } from "../data/flags.js";
import { gradBg, locVisual, hydrateLocPhoto } from "../services/photo-api.js";
import { favWx, favWxAt, persistFavs } from "../features/favorites.js";
import { showToast } from "./notifications.js";
import { confirmAction } from "./confirm-dialog.js";
import { selectLocation } from "../features/location.js";
import { switchView } from "./navigation.js";
import { renderHero } from "./render-home.js";

/* Secondary line under a favorite's name. A country's country is itself, so
   naming it twice ("France / France") is noise for sighted users and reads as
   "France, France" to a screen reader — show what the place IS instead. */
function favSubtitle(loc) {
  return loc.kind === "country" ? kindLabel(loc.kind) : esc(locCountry(loc));
}

function favAgoText() {
  const mins = Math.max(0, Math.round((Date.now() - favWxAt) / 60000));
  return mins < 1 ? t("justNow") : t("agoMin").replace("{m}", mins);
}

let favPhotoObserver;

/* Favorite cards can exist while their view is hidden, so hydrate them only
   when they approach the viewport. Re-rendering replaces the cards; disconnect
   the previous observer so detached cards never trigger stale photo requests. */
function hydrateFavoritePhotos(grid, table) {
  favPhotoObserver?.disconnect();
  favPhotoObserver = null;

  const targets = [...grid.querySelectorAll(".favx-card"), ...table.querySelectorAll("tbody tr")];
  const hydrate = (target) => {
    const isRow = target.matches("tr");
    const locId = isRow ? target.dataset.loc : target.dataset.favId;
    const loc = state.favorites.find((item) => item.id === locId);
    hydrateLocPhoto(target.querySelector(isRow ? ".ft-visual" : ".favx-bg"), loc, {
      creditHost: isRow ? target.querySelector(".ft-place-cell") : target,
      creditClass: isRow ? "loc-credit--inline ft-credit" : "favx-credit",
      decorative: true,
      raceGuard: false,
      sizes: isRow ? "46px" : "(max-width: 640px) 100vw, 320px",
    });
  };

  if (!("IntersectionObserver" in window)) {
    targets.forEach(hydrate);
    return;
  }

  favPhotoObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        observer.unobserve(entry.target);
        hydrate(entry.target);
      });
    },
    { rootMargin: "160px" },
  );
  targets.forEach((target) => favPhotoObserver.observe(target));
}

function favCardHtml(loc, i) {
  const w = favWx[loc.id];
  const openLabel = esc(t("openLocation").replace("{name}", locName(loc)));
  /* A plain <article> container with two sibling buttons: a full-bleed overlay
     button that opens the location, and the remove button raised above it. The
     previous role="button" wrapper nested the remove control inside another
     control, which is invalid and made the card unusable with a screen reader. */
  return `
    <article class="favx-card" data-fav-id="${esc(loc.id)}" style="animation-delay:${i * 60}ms">
      <span class="favx-bg loc-photo loading" style="${gradBg(loc)}" aria-hidden="true">
        <span class="loc-photo-fallback favx-emoji">${locVisual(loc)}</span>
      </span>
      <span class="favx-top">
        ${flagsHtml(loc, "small")}
        <span class="favx-names"><b>${esc(locName(loc))}</b><span>${favSubtitle(loc)}</span></span>
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
      <td class="ft-place-cell">
        <button class="ft-open ft-place">
          <span class="ft-visual loc-photo loading" style="${gradBg(loc)}" aria-hidden="true">
            <span class="loc-photo-fallback">${locVisual(loc)}</span>
          </span>
          <span class="ft-names">${flagHtml(loc.cc, "", state.lang)} <b>${esc(locName(loc))}</b><span>${favSubtitle(loc)}</span></span>
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

async function favClickHandler(e) {
  /* Attribution links are independent controls; following one must not also
     select the table row's location. */
  if (e.target.closest(".loc-credit")) return;
  const rm = e.target.closest("[data-remove]");
  if (rm) {
    e.stopPropagation();
    const index = state.favorites.findIndex((favorite) => favorite.id === rm.dataset.remove);
    if (index < 0) return;
    const removed = state.favorites[index];

    rm.classList.add("is-confirming");
    const accepted = await confirmAction({
      title: t("removeFavTitle"),
      message: t("removeFavConfirm").replace("{name}", locName(removed)),
      confirmLabel: t("removeAction"),
      cancelLabel: t("cancelAction"),
      trigger: rm,
    });
    rm.classList.remove("is-confirming");
    if (!accepted) return;

    state.favorites.splice(index, 1);
    persistFavs();
    renderFavorites();
    if (state.loc) renderHero();
    showToast(t("removedFav"), {
      actionLabel: t("undoAction"),
      onAction: () => {
        if (state.favorites.some((favorite) => favorite.id === removed.id)) return;
        state.favorites.splice(Math.min(index, state.favorites.length), 0, removed);
        persistFavs();
        renderFavorites();
        if (state.loc) renderHero();
        showToast(t("restoredFav"));
      },
    });
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
  hydrateFavoritePhotos(grid, $("#favTable"));

  /* every interactive target is now a real <button>, so Enter/Space activate
     natively and no synthetic keydown handler is needed */
  grid.onclick = favClickHandler;
  $("#favTable").onclick = favClickHandler;
}
