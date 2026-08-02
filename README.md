# WeatherSphere

A premium, modern weather dashboard: live conditions, 7-day/hourly forecasts,
an interactive world map, favorites, and French/English support — built with
vanilla JavaScript (ES modules) and Vite. No UI framework.

## What it does

- **Home** — current conditions ("Simple" or "Detailed" mode), a 5-day
  forecast strip, an hourly chart, weather insights, a mini world map, and an
  "explore the world" carousel of curated destinations.
- **Map** — an interactive MapLibre GL map (MapTiler Hybrid style) with
  quick-jump chips for France/USA/Canada, a location-info panel, and a
  popular-cities list.
- **Forecast** — a day carousel, hourly temperature/wind/precipitation
  charts, and a plain-language daily summary.
- **Favorites** — save locations, see them all at a glance (grid or table),
  with live weather refreshed in one batched request.
- **Settings** — temperature/wind units, language, display mode, theme
  (light/dark/system), and a data export/reset.
- Works fully offline/without API keys via a deterministic **demo weather**
  fallback, so the app is always explorable.

## Architecture

```
src/
├── index.html            Vite entry HTML
├── styles/
│   ├── foundation/        design tokens, reset, base element styles
│   ├── layout/             topnav, sidebar, main shell, footer
│   ├── components/        reusable UI atoms (buttons, cards, forms,
│   │                       toggles, flags, weather icons, charts, toast)
│   ├── views/              per-page styles (home, map, forecast,
│   │                       favorites, about, settings)
│   ├── utilities/          accessibility + cross-cutting responsive rules
│   └── main.css            the single entry point — imports everything
│                            above, in cascade order
└── js/
    ├── core/               state, storage, i18n, dom helpers, units,
    │                        datetime, config, location formatting
    ├── data/                static/lookup data: locations, translations,
    │                        weather codes, icons, flags
    ├── services/           network + caching: weather-api, geocoding-api,
    │                        photo-api (Pexels), plus the shared cache helper
    ├── features/            state transitions + event wiring: search,
    │                        geolocation, favorites, settings, map, location
    ├── ui/                  DOM rendering: render-home, render-map,
    │                        render-forecast, render-favorites, navigation,
    │                        notifications (toast), charts
    └── main.js              bootstrap — wires every feature's events and
                              kicks off the initial render
public/
└── assets/flags/           SVG flag assets, served as-is (never imported
                              as JS — referenced by URL at runtime)
dist/                       generated production build (git-ignored, never
                              edit by hand)
```

Each `*.test.js` file lives next to the module it tests (e.g.
`src/js/core/units.test.js`).

### Where to add things

- **A new view**: add a `<section class="view" id="view-yourname" hidden>`
  in `src/index.html`, a `src/styles/views/yourname.css` (imported from
  `main.css`), a `src/js/ui/render-yourname.js`, and a case in
  `switchView()` (`src/js/ui/navigation.js`) if it needs special handling.
- **A new reusable component**: add a file under `src/styles/components/`
  and import it from `main.css`.
- **A new translation string**: add the key to **both** `en` and `fr`
  objects in `src/js/data/translations.js`, then reference it with `t("key")`
  (import from `src/js/core/i18n.js`) or `data-i18n="key"` in the HTML.
- **A new API/service**: add a file under `src/js/services/`. Reuse
  `createAsyncCache`/`createBoundedCache` from `src/js/services/cache.js`
  for caching, and always pass an `AbortSignal.timeout(...)` (see
  `FETCH_TIMEOUT_MS` in `src/js/core/config.js`).
- **A new setting**: add the control's markup in `src/index.html`, a
  setter in `src/js/features/settings.js` (persist via
  `src/js/core/storage.js`'s `setStr`/`setJSON` + a new `KEYS` entry), and
  wire the click listener in `src/js/main.js`.

## Requirements

- Node.js `^20.19.0` or `>=22.12.0` (required by Vite 8 — check with `node -v`)
- npm (this project uses npm only — one `package-lock.json`, no yarn/pnpm)

## Getting started

```bash
npm install
cp .env.local.example .env.local   # fill in API keys — see below (optional)
npm run dev                        # start the dev server
```

## Scripts

| Command                  | What it does                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `npm run dev`            | Start the Vite dev server with hot reload                                           |
| `npm run build`          | Production build to `dist/`                                                         |
| `npm run preview`        | Serve the `dist/` build locally, to sanity-check the production output              |
| `npm run test`           | Run the unit tests once (Vitest)                                                    |
| `npm run test:watch`     | Run the unit tests in watch mode                                                    |
| `npm run lint`           | ESLint (JS) + Stylelint (CSS)                                                       |
| `npm run lint:fix`       | Same, auto-fixing what it safely can                                                |
| `npm run format`         | Format everything with Prettier                                                     |
| `npm run format:check`   | Check formatting without writing changes                                            |
| `npm run check`          | lint + format:check + test + build — the full pre-push gate                         |
| `npm run optimize:flags` | Re-run SVGO over `public/assets/flags/` (only needed if you add/replace a flag SVG) |

## Environment configuration & API keys

Copy `.env.local.example` to `.env.local` and fill in what you have —
everything works with both blank (the app falls back to demo weather and a
gradient/emoji visual instead of a real photo).

```
VITE_MAPTILER_KEY=   # map tiles + geocoding — https://cloud.maptiler.com/account/keys/
VITE_PEXELS_KEY=     # optional location photos — https://www.pexels.com/api/
```

### API key security — read this before deploying

Both variables above are bundled into the **client-side JavaScript at build
time**. That is what the `VITE_` prefix means to Vite: anything with that
prefix is exposed to the browser bundle, full stop. Neither key is a secret
once the app is built and deployed — treat them as public.

- **`VITE_MAPTILER_KEY`** — MapTiler lets you restrict a key to a list of
  allowed origins (configure this in the MapTiler dashboard, under the
  key's settings). Restricting it to your production domain (and
  `localhost` for local dev) is what makes it reasonably safe to ship in a
  browser bundle: a copied key simply won't work from any other domain.
- **`VITE_PEXELS_KEY`** — Pexels API keys **cannot** be origin-restricted.
  Anyone who reads your bundle's source can extract and reuse this key with
  its full rate limit. Genuine protection would require routing photo
  requests through a small backend/serverless proxy that holds the real key
  server-side and is not shipped to the browser — that proxy does not exist
  in this project (out of scope for a static site). If this matters for
  your deployment, either build that proxy or leave `VITE_PEXELS_KEY` blank
  and accept the gradient/emoji visual fallback, which is exactly what
  happens today when the key is unset.

`.env.local` is git-ignored (see `.gitignore`); only `.env.local.example`
(placeholders, no real values) is committed.

## GitHub Pages deployment

The app has no client-side router — views are shown/hidden with JavaScript,
not URLs — so the same build works unmodified from a domain root or from a
GitHub Pages project path. `vite.config.js` sets `base: './'` (relative),
so built `<script>`/`<link>` URLs resolve correctly either way.

```bash
npm run build
```

Publish the contents of `dist/` (e.g. via `gh-pages`, or a GitHub Actions
workflow that runs `npm ci && npm run build` and deploys `dist/`) to your
Pages branch/target. No further path configuration is needed.

The project also ships `public/.htaccess`, copied verbatim into `dist/` —
useful if you deploy to a plain Apache host instead of/alongside GitHub
Pages (this is how the app is deployed today). It sets security headers and
long-lived caching for hashed assets; delete it if you don't need it.

## Testing

```bash
npm run test
```

Covers pure logic: unit conversion and compass directions
(`core/units.test.js`), the TTL/dedup cache helper
(`services/cache.test.js`), safe localStorage parsing
(`core/storage.test.js`), location search scoring
(`data/locations.test.js`), and WMO weather-code lookups
(`data/weather-codes.test.js`). UI rendering and network calls are not unit
tested — verify those manually with `npm run dev`/`npm run preview`.

## Browser support

Modern evergreen browsers (the app uses `Intl.DisplayNames`,
`AbortSignal.timeout`, CSS `:has()`, and other recent-ish web platform
features). No IE11/legacy support.
