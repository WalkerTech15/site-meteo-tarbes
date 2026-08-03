# WeatherSphere

A premium, modern weather dashboard: live conditions, 7-day/hourly forecasts,
an interactive world map, favorites, and French/English support — built with
vanilla JavaScript (ES modules) and Vite. No UI framework.

## What it does

- **Home** — current conditions ("Simple" or "Detailed" mode), a 5-day
  forecast strip, an hourly chart, weather insights, a mini world map, and an
  "explore the world" carousel of curated destinations.
- **Map** — an interactive MapTiler map with satellite, temperature, rain, and
  wind layers; quick-jump filters; an integrated current-weather/hourly panel;
  and a compact popular-cities list.
- **Forecast** — a day carousel, hourly temperature/wind/precipitation
  charts, and a plain-language daily summary.
- **Favorites** — save locations, see them all at a glance (grid or table),
  with live weather refreshed in one batched request.
- **Settings** — temperature/wind units, language, display mode, theme
  (light/dark/system), and a data export/reset.
- Degrades gracefully: if a weather request fails (network error, timeout, API
  outage) **after the app has loaded**, a deterministic **demo weather** dataset
  takes over and the UI stays explorable. The map and photo features simply fall
  back to their placeholders when their API keys are absent.

> **This is not an offline app.** There is no service worker and nothing is
> precached, so loading the site from scratch still requires a network
> connection. The demo dataset is an in-session fallback for failed API calls,
> not offline support.

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
    │                        photo-api (calls the same-origin Pexels proxy —
    │                        never Pexels directly), plus the cache helper
    ├── features/            state transitions + event wiring: search,
    │                        geolocation, favorites, settings, map, location
    ├── ui/                  DOM rendering: render-home, render-map,
    │                        render-forecast, render-favorites, navigation,
    │                        notifications (toast), charts
    └── main.js              bootstrap — wires every feature's events and
                              kicks off the initial render
public/                     copied verbatim into dist/ by Vite
├── api/pexels.php          server-side Pexels proxy — holds no key itself,
│                            reads one from outside the web root
├── .htaccess               Apache security headers + caching
└── assets/flags/           SVG flag assets, served as-is (never imported
                              as JS — referenced by URL at runtime)
deploy/                     templates that are NOT part of the site
└── weathersphere-secrets.example.php
                            copy to /home/<user>/private/ on the server and
                              fill in the real key there — never here
scripts/
└── verify-no-secrets.mjs   fails the build if a credential reaches dist/
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

| Command                  | What it does                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------- |
| `npm run dev`            | Start the Vite dev server with hot reload                                             |
| `npm run build`          | Production build to `dist/`                                                           |
| `npm run preview`        | Serve the `dist/` build locally, to sanity-check the production output                |
| `npm run test`           | Run the unit tests once (Vitest)                                                      |
| `npm run test:watch`     | Run the unit tests in watch mode                                                      |
| `npm run test:e2e`       | Run the Playwright browser tests (starts its own dev server; APIs are mocked)         |
| `npm run lint`           | ESLint (JS) + Stylelint (CSS)                                                         |
| `npm run lint:fix`       | Same, auto-fixing what it safely can                                                  |
| `npm run format`         | Format everything with Prettier                                                       |
| `npm run format:check`   | Check formatting without writing changes                                              |
| `npm run verify:secrets` | Scan `dist/` for Pexels credentials — fails the build if one leaked (run after build) |
| `npm run check`          | lint + format:check + test + build + verify:secrets — the full pre-push gate          |
| `npm run optimize:flags` | Re-run SVGO over `public/assets/flags/` (only needed if you add/replace a flag SVG)   |

`verify:secrets` never prints a matched value — only the file, the rule that
fired, and a byte offset.

## Environment configuration & API keys

Copy `.env.local.example` to `.env.local` and fill in what you have —
everything works with both blank (the app falls back to demo weather and a
gradient/emoji visual instead of a real photo).

```
VITE_MAPTILER_KEY=   # map tiles + geocoding  — https://cloud.maptiler.com/account/keys/
PEXELS_API_KEY=      # optional location photos — https://www.pexels.com/api/
```

### The prefix is the security boundary

This is the single most important thing to understand about this project's
configuration:

| Variable form          | Where it ends up                    | Is it secret?                         |
| ---------------------- | ----------------------------------- | ------------------------------------- |
| `VITE_ANYTHING`        | compiled into the JavaScript bundle | **No. Public.**                       |
| `ANYTHING` (no prefix) | stays in the Node/PHP process       | Yes, if kept off disk in public paths |

Vite deliberately requires the `VITE_` prefix before it will expose a value to
client code. Minifying the bundle changes nothing — the value is a string
literal in a file anyone can download. So the prefix is not a naming
convention, it is the decision about whether a key is published.

The two keys are therefore handled completely differently.

#### `VITE_MAPTILER_KEY` — public on purpose

Maps and geocoding run in the browser, so this key must be reachable from
client code. That is acceptable **only because MapTiler keys can be
origin-restricted**. In
[MapTiler Cloud → Account → Keys](https://cloud.maptiler.com/account/keys/),
set the key's allowed origins to:

```
http://localhost:5173     # dev server
http://localhost:5174     # Playwright e2e server
https://your-domain.tld   # production
```

With that list in place, a copied key answers `403 Key usage restricted`
from anywhere else. **Without it, the key works from anyone's website and your
quota is theirs.** Restricting it is not optional.

#### `PEXELS_API_KEY` — server-side only

Note the missing prefix. It is deliberate and load-bearing.

Pexels offers **no** origin restriction, so a Pexels key in the bundle is
simply a published credential — anyone can extract it and spend your rate
limit. The key is therefore never given to the browser. Instead:

```
browser  ──GET /api/pexels.php?query=Paris%20France%20landmark──►  same-origin proxy
                                                                        │
                                        Authorization: <key>  ──────────┘
                                                     ▼
                                             api.pexels.com
```

- **Production** — `public/api/pexels.php` runs on the Apache/PHP host and
  reads the key from a file **outside `public_html`**. See
  [Deploying to Hostinger](#deploying-to-hostinger).
- **Development** — a Vite middleware in `vite.config.js` serves the same
  `/api/pexels.php` path from Node, reading `PEXELS_API_KEY` from
  `.env.local`. Because the variable is unprefixed, Vite never places it in
  `import.meta.env`, so it cannot reach client code.

Both implementations answer the same contract, so the frontend has one code
path:

| Status | Body                             | Meaning                                             |
| ------ | -------------------------------- | --------------------------------------------------- |
| 200    | `{"photo": {…}}`                 | a photo (URLs, photographer, Pexels link, alt text) |
| 200    | `{"photo": null}`                | valid query, no match                               |
| 400    | `{"error":"invalid_query"}`      | missing/short/long/control-character query          |
| 405    | `{"error":"method_not_allowed"}` | anything other than GET                             |
| 429    | `{"error":"rate_limited"}`       | local rate limit, or Pexels'                        |
| 502    | `{"error":"upstream_error"}`     | Pexels unreachable, timed out, or malformed         |
| 503    | `{"error":"unavailable"}`        | the server has no key configured                    |

Every non-200 means exactly one thing to the UI: no photo, keep the
gradient/emoji fallback. No server detail is ever displayed.

Leaving `PEXELS_API_KEY` blank is fully supported — the proxy answers 503 and
the app shows its fallback visuals.

`.env.local` is git-ignored (see `.gitignore`); only `.env.local.example`
(placeholders, no real values) is committed.

### If your Pexels key was ever in a `VITE_` variable, rotate it

Earlier versions of this project shipped the Pexels key to the browser as
`VITE_PEXELS_KEY`. **Any key that was built and deployed that way must be
considered compromised**, even if the site was only briefly online — bundles
get cached, archived, and crawled.

1. Go to <https://www.pexels.com/api/new/> and generate a new key.
2. The Pexels dashboard issues one key per account, so requesting a new one
   revokes the old one. Confirm the old value no longer works.
3. Put the **new** key in `.env.local` as `PEXELS_API_KEY=` (no prefix) and in
   the private server file described below.
4. Never put it back behind a `VITE_` prefix.

Rotating is cheap and the only way to undo the exposure. Removing the key from
the current bundle does not retroactively un-publish the old one.

## Deploying to Hostinger

The production secret lives in a file that the web server cannot serve, one
level **above** `public_html`:

```
/home/<user>/private/weathersphere-secrets.php   ← the real key, chmod 600
/home/<user>/public_html/                        ← everything from dist/
                        ├── index.html
                        ├── assets/
                        ├── api/pexels.php       ← reads the file above
                        └── .htaccess
```

Anything under `public_html` is reachable over HTTP; `private/` is not. That
separation — not obscurity — is what protects the key.

**One-time setup**

1. Create the `private/` directory next to `public_html` (File Manager or SFTP).
2. Copy `deploy/weathersphere-secrets.example.php` there, renamed to
   `weathersphere-secrets.php`.
3. Edit it and replace `REPLACE_ON_SERVER` with your real Pexels key.
   The proxy treats the untouched placeholder as "no key" and returns 503.
4. Set its permissions to **600**.

The proxy locates that file by trying, in order: the `WEATHERSPHERE_SECRETS`
environment variable (an absolute path, if you prefer to set one), then
`<document root>/../private/weathersphere-secrets.php`, then a path relative to
the proxy itself. If none yields a usable key it fails safely with 503.

**Every deploy**

```bash
npm run build
npm run verify:secrets      # refuses to pass if a credential reached dist/
```

Then upload the **contents of `dist/`** into `public_html` — including
`api/pexels.php` and `.htaccess`, both of which Vite copies from `public/`.
Never upload `.env.local`, and never place the secrets file inside
`public_html`.

**Verifying the proxy without exposing anything**

```bash
# a real query: expect 200 and a JSON body with "photo"
curl -s -o /dev/null -w '%{http_code}\n' \
  'https://your-domain.tld/api/pexels.php?query=Paris%20France%20landmark'

# validation: expect 400
curl -s -o /dev/null -w '%{http_code}\n' 'https://your-domain.tld/api/pexels.php?query=a'

# method check: expect 405
curl -s -o /dev/null -w '%{http_code}\n' -X POST 'https://your-domain.tld/api/pexels.php?query=Paris'

# the secret file must NOT be reachable over HTTP: expect 403 or 404
curl -s -o /dev/null -w '%{http_code}\n' 'https://your-domain.tld/private/weathersphere-secrets.php'
```

A 503 on the first command means the server cannot read the key — re-check
steps 1–4. Note that none of these commands ever prints the key: the response
body contains only photo URLs and attribution.

In the browser, open DevTools → Network and confirm requests go to
`/api/pexels.php` on your own domain and that **no request to
`api.pexels.com`** appears. Searching the built JS for `PEXELS` should return
nothing but the attribution text.

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

> **GitHub Pages has no PHP.** `api/pexels.php` will be served as a plain file
> rather than executed, so the photo proxy returns something the app can't
> parse and it falls back to gradient/emoji visuals — which is the intended
> degraded behaviour, not a bug. Everything else (weather, map, forecast,
> favourites, i18n) works normally. Real photos require a PHP host such as the
> Hostinger deployment described above.

## Testing

Two layers, deliberately separate.

### Unit tests — pure logic

```bash
npm run test
```

Vitest, colocated `*.test.js` files next to the code they cover: unit
conversion and compass directions (`core/units.test.js`), the TTL/dedup cache
helper (`services/cache.test.js`), safe localStorage parsing
(`core/storage.test.js`), location search scoring (`data/locations.test.js`),
WMO weather-code lookups (`data/weather-codes.test.js`), and the photo-proxy
contract (`services/photo-api.test.js` — success, no-result, 400/405/429/502/503,
timeout, negative caching, and an assertion that the client sends **no**
`Authorization` header and never calls `api.pexels.com`).

### End-to-end tests — real browser

```bash
npm run test:e2e            # all projects
npx playwright test --ui    # interactive debugging
```

Playwright drives Chromium through the actual UI on a desktop viewport and an
emulated Pixel 5 (`e2e/mobile-*.spec.js` runs only on the phone profile, since
it covers behaviour that exists solely below the 900px drawer breakpoint).
It covers: initial load, search-and-select, the demo-data fallback on API
failure, FR/EN switching, Simple/Detailed switching, the favourite lifecycle,
grid/list exclusivity, the mobile drawer's ARIA + keyboard behaviour, Pexels
attribution, every photo-proxy failure status, and settings persistence across
reload.

Three rules keep the suite deterministic and safe, enforced in `e2e/mocks.js`
and `playwright.config.js`:

- **No test ever reaches a live API.** Every external origin is intercepted and
  served a fixture, and a catch-all route _aborts_ anything unmocked — so a
  newly-added live call fails the suite loudly instead of making it flaky.
- **The same-origin photo proxy is mocked too.** It is same-origin, so the
  cross-origin catch-all would not have caught it and the real dev middleware
  (which holds a real key) would have answered. `**/api/pexels.php*` is
  intercepted explicitly, and a direct browser call to `api.pexels.com` is
  aborted with a warning if one ever reappears.
- **Real keys never reach the test browser or the test server.** Playwright
  starts its own dev server on port 5174 with a placeholder
  `VITE_MAPTILER_KEY` and an intentionally **empty** `PEXELS_API_KEY`, both of
  which take precedence over `.env.local`. With no key the dev proxy answers
  503, so even a mock that failed to intercept could not produce a live call.

Playwright needs its browser binary once per machine:
`npx playwright install chromium`.

## Browser support

Modern evergreen browsers (the app uses `Intl.DisplayNames`,
`AbortSignal.timeout`, CSS `:has()`, and other recent-ish web platform
features). No IE11/legacy support.
