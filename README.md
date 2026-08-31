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

> **Offline support is partial, by design.** A service worker (`public/sw.js`,
> registered in production only) precaches the app shell and replays weather
> and photo data the visitor has already loaded, and the hero switches its live
> pill to "Offline" with a "last updated" timestamp so cached readings are
> never presented as current. A first visit still requires a network
> connection, and licence-restricted imagery (Google Places, Mapillary) is
> never cached at all.

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
    │                        photo-api (the provider chain), places-api and
    │                        mapillary-api (each calls its OWN same-origin
    │                        proxy, never the provider directly),
    │                        wikimedia-api, photo-relevance, offline, cache
    ├── features/            state transitions + event wiring: search,
    │                        geolocation, favorites, settings, map, location
    ├── ui/                  DOM rendering: render-home, render-map,
    │                        render-forecast, render-favorites, navigation,
    │                        notifications (toast), charts
    └── main.js              bootstrap — wires every feature's events and
                              kicks off the initial render
api/                        Vercel serverless functions — the photo proxies.
├── pexels.js                Each holds no key itself and reads an UNPREFIXED
├── places.js                environment variable, so no credential can ever
└── mapillary.js             be compiled into the client bundle.
public/                     copied verbatim into dist/ by Vite
├── api/pexels.php          the same three proxies for a Hostinger/Apache
├── api/places.php           deployment — they hold no keys either, reading
├── api/mapillary.php        them from a file outside the web root
├── sw.js                   service worker: app-shell + replayable-data
│                            caching, with a deny-list for licence-restricted
│                            imagery (Google Places, Mapillary)
├── .htaccess               Apache security headers, caching, and the
│                            extensionless /api/* → *.php rewrites
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

| Command                  | What it does                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| `npm run dev`            | Start the Vite dev server with hot reload                                                              |
| `npm run build`          | Production build to `dist/`                                                                            |
| `npm run preview`        | Serve the `dist/` build locally, to sanity-check the production output                                 |
| `npm run test`           | Run the unit tests once (Vitest)                                                                       |
| `npm run test:watch`     | Run the unit tests in watch mode                                                                       |
| `npm run test:e2e`       | Run the Playwright browser tests (starts its own dev server; APIs are mocked)                          |
| `npm run lint`           | ESLint (JS) + Stylelint (CSS)                                                                          |
| `npm run lint:fix`       | Same, auto-fixing what it safely can                                                                   |
| `npm run format`         | Format everything with Prettier                                                                        |
| `npm run format:check`   | Check formatting without writing changes                                                               |
| `npm run verify:secrets` | Scan `dist/` for Pexels/Google/Mapillary credentials — fails the build if one leaked (run after build) |
| `npm run check`          | lint + format:check + test + build + verify:secrets — the full pre-push gate                           |
| `npm run optimize:flags` | Re-run SVGO over `public/assets/flags/` (only needed if you add/replace a flag SVG)                    |

`verify:secrets` never prints a matched value — only the file, the rule that
fired, and a byte offset.

## Environment configuration & API keys

Copy `.env.local.example` to `.env.local` and fill in what you have —
everything works with both blank (the app falls back to demo weather and a
gradient/emoji visual instead of a real photo).

```
VITE_MAPTILER_KEY=       # map tiles + geocoding  — https://cloud.maptiler.com/account/keys/
PEXELS_API_KEY=          # optional location photos — https://www.pexels.com/api/
GOOGLE_PLACES_API_KEY=   # optional, most accurate photos — https://console.cloud.google.com/
MAPILLARY_ACCESS_TOKEN=  # optional street-level photos — https://www.mapillary.com/dashboard/developers
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
browser  ──GET /api/pexels?query=Paris%20France%20landmark──►  same-origin proxy
                                                                     │
                                     Authorization: <key>  ──────────┘
                                                  ▼
                                          api.pexels.com
```

The browser always calls the same-origin `/api/pexels` (no `.php` — see
`PEXELS_PROXY_URL` in `src/js/core/config.js`). Which server actually answers
that request depends on where you deploy:

| Deployment                             | Handler                                | Where the key lives                                                                      |
| -------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Vercel** (current)                   | `api/pexels.js`, a serverless function | `PEXELS_API_KEY` set in the Vercel project's environment variables                       |
| **Hostinger/Apache** (still supported) | `public/api/pexels.php`                | a file **outside `public_html`** — see [Deploying to Hostinger](#deploying-to-hostinger) |
| **Development**                        | a Vite middleware in `vite.config.js`  | `PEXELS_API_KEY` from `.env.local`                                                       |

All three answer the identical contract below, so the frontend has one code
path regardless of target. Because the variable is unprefixed, Vite never
places it in `import.meta.env`, so it cannot reach client code in any case.

> **Hostinger note:** the Apache deployment's PHP file is physically named
> `pexels.php`, but the frontend requests the extensionless `/api/pexels`
> everywhere. `public/.htaccess` carries a `mod_rewrite` rule mapping one to
> the other internally, so no browser-visible redirect or `.php` extension
> is ever seen. See [Deploying to Hostinger](#deploying-to-hostinger).

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

#### `GOOGLE_PLACES_API_KEY` — server-side only

Also unprefixed, for the same reason plus two more: Places API (New)
authenticates with an `X-Goog-Api-Key` **header**, which a browser cannot send
without publishing the key, and **every Places call is billed** — a leaked key
is someone else's spending on your account.

It follows exactly the Pexels arrangement: one browser route (`/api/places`,
see `GOOGLE_PLACES_PROXY_URL` in `src/js/core/config.js`), three server
implementations (`api/places.js` on Vercel, `public/api/places.php` on
Apache via the same `mod_rewrite` pattern, a Vite middleware in dev), one
contract.

Two operations share the route, so a location costs two upstream calls rather
than one per candidate:

| Request                              | Response                                             |
| ------------------------------------ | ---------------------------------------------------- |
| `?query=…&lat=&lon=&lang=`           | `{"places":[…]}` — place **metadata only**, no image |
| `?photo=places/<id>/photos/<ref>&w=` | `{"photo":{"src":…}}` — one short-lived signed URI   |

Errors mirror the Pexels proxy (`400 invalid_query` / `invalid_photo`, `404`,
`405`, `429`, `502`, `503`) and mean the same single thing to the UI: no
Google photo, fall through to the next provider.

**Set the key up correctly in Google Cloud Console:** enable _Places API
(New)_, then restrict the key to that API and to your **server's IP address**.
Do _not_ use an HTTP-referrer restriction — this is a server-to-server call
and referrer restrictions do not apply to it.

**Licensing.** Google Maps Platform allows only _temporary_ caching of Places
content, and a resolved photo URI is a short-lived signed URL that must not be
persisted or re-published. So the app:

- answers the photo-resolve response `no-store` in all three proxies;
- caches candidates and resolved URIs **in memory only**, under short TTLs
  (`services/places-api.js`) — never `localStorage`;
- names `googleusercontent.com` / `ggpht.com` and `/api/places` in the service
  worker's `NEVER_CACHE_HOSTS` deny-list, checked _before_ the photo
  allow-list, so no Google photo is ever written to Cache Storage;
- refuses to display any Google photo it cannot attribute, and renders the
  contributor's name and Google visibly next to the image.

Leaving `GOOGLE_PLACES_API_KEY` blank is fully supported — the proxy answers
503, the client stops asking for the rest of the session, and the photo chain
falls straight through to Wikimedia and Pexels exactly as before.

#### `MAPILLARY_ACCESS_TOKEN` — server-side only

Also unprefixed. A Mapillary client token (`MLY|<app id>|<secret>`) cannot be
origin-restricted, so it never reaches the browser: one route
(`/api/mapillary`, see `MAPILLARY_PROXY_URL`), three implementations
(`api/mapillary.js` on Vercel, `public/api/mapillary.php` on Apache, a Vite
middleware in dev).

| Request              | Response                                                       |
| -------------------- | -------------------------------------------------------------- |
| `?lat=&lon=&radius=` | `{"images":[{id,src,lat,lon,capturedAt,isPano,creator,link}]}` |

**What it is for.** Geotagged street-level photography — the only coverage
available for the villages and small towns Google, Wikimedia and Pexels have
never photographed. Every Mapillary image carries the coordinate it was taken
at, which is a claim about _where_, never about _what_. So its results are
always labelled **nearby**, never as a photo of the place itself, and it is
only ever queried for a settlement (city 1000 m, town 800 m, village 500 m,
POI 200 m, address 150 m). Regions, states, provinces, countries and open
water are never asked: one roadside frame says nothing about a territory.

**Licensing.** Mapillary imagery is **CC BY-SA 4.0**. The contributor's
username and the licence are displayed with every image, and an image that
cannot be attributed is refused rather than shown bare. The licence would
permit caching, but the `thumb_1024_url` values are **signed CDN URLs that
expire**, so they are held in memory for ~10 minutes only and
`googleusercontent.com` / `ggpht.com` / `fbcdn.net` / `mapillary.com` are all
on the service worker's `NEVER_CACHE_HOSTS` deny-list.

Create a token at <https://www.mapillary.com/dashboard/developers>. Leaving it
blank is fully supported — the proxy answers 503, the client stops asking for
the session, and the chain falls through to the Wikimedia text search.

> **KartaView is deliberately NOT used by this project.** Mapillary is the
> only street-level imagery provider configured. There is no KartaView code,
> proxy, token or mock anywhere in the repository, and a test
> (`mapillary-vercel-route.test.js`) asserts none is ever added silently. Do
> not add another street-level provider without reviewing its licence and its
> attribution requirements first.

#### The photo provider chain

Ordered by how well each source can **prove** the picture shows the selected
place, not by how attractive it is (`services/photo-api.js`, `fetchBestPhoto`):

| #   | Source                            | Provenance it can claim |
| --- | --------------------------------- | ----------------------- |
| 1   | **Curated verified image**        | exact                   |
| 2   | **Google Places**                 | exact, or nearby        |
| 3   | **Wikimedia Commons geosearch**   | exact                   |
| 4   | **Mapillary**                     | nearby (always)         |
| 5   | **Wikimedia Commons text search** | exact                   |
| 6   | **Pexels**                        | exact                   |
| 7   | Region, then country, photo       | regional / country      |
| 8   | Neutral gradient/emoji            | —                       |

A step that finds nothing sufficiently relevant, or fails outright, falls
through to the next. Nothing is ever displayed merely because a result
existed.

#### Provenance: what the visitor is told

These steps do not all make the same claim, so every photo carries a tier and
the credit says which (`ui/photo-provenance.js`):

| Tier         | Shown as                                                        | When                                                          |
| ------------ | --------------------------------------------------------------- | ------------------------------------------------------------- |
| **exact**    | no qualifier — just the source                                  | the photo is of the selected place                            |
| **nearby**   | "Nearby · &lt;source&gt;", full sentence in the accessible name | a landmark inside the place, or a Mapillary frame taken at it |
| **regional** | "&lt;Region&gt; · &lt;source&gt;"                               | the area fallback, at region level                            |
| **country**  | "&lt;Country&gt; · &lt;source&gt;"                              | the area fallback, at country level                           |

`exact` deliberately shows no qualifier: adding "exact photo" to the common
case would be noise, and an absent qualifier already means "this is the
place". The other three are always announced, in both languages, in the
visible badge **and** in the link's accessible name — so a screen-reader user
is told exactly what a sighted user reads.

**Why the `nearby` tier exists.** Google's place photos are attached
overwhelmingly to businesses and points of interest; administrative entities
(a `locality`, an `administrative_area_level_1`, a `country`) very often carry
no photos at all. Without a second tier, a city/region/country selection could
get candidates back and still show nothing. A photo of the cathedral in a town
is a useful picture _of_ that town — it is simply not the town itself, so it is
ranked below every genuine match and labelled. Only genuinely civic or scenic
Google types qualify (`tourist_attraction`, `museum`, `church`, `park`,
`city_hall`, …); `establishment` and `point_of_interest` are deliberately
excluded because Google attaches them to every business, which would make a
hotel car park a "landmark".

#### Known worldwide coverage limitations

- **Countries named by an endonym.** A country has no distance gate (its
  representative point is arbitrary), so it can only be confirmed by name. The
  proxy requests Google's display name in the interface language, so this
  normally matches; if Google answered "Ísland" for Iceland the candidate is
  refused and the chain falls through. Refusing is deliberate — the
  alternative is accepting a country entity on no evidence.
- **Non-Latin-script place names** yield no comparable text tokens, so they
  are confirmed by coordinate proximity alone. That works for Google and
  Mapillary (both geotagged) but means a Commons/Pexels text search can rarely
  confirm them.
- **Oceans and seas** are never sent to Google (no ocean entity exists) or
  Mapillary (no streets). They rely on Commons geosearch and text search.
- **Regions, states and provinces** get no Mapillary tier and a wide (120 km)
  Google landmark radius, so a regional photo is often a well-known landmark
  somewhere in the region, labelled `nearby`.
- **Small towns outside Mapillary's coverage** (much of rural Africa, Central
  Asia and inland South America) will still reach the region/country fallback.
  That is the honest outcome, and it is labelled.
- Photo availability for any specific place cannot be asserted offline; the
  test suite exercises the query construction and the matching rules, not
  Google's or Mapillary's live coverage.

`.env.local` is git-ignored (see `.gitignore`); only `.env.local.example`
(placeholders, no real values) is committed.

### Vercel environment variables

The Vercel deployment reads three server-side secrets from the project's
environment variables. They must be set for **Production** (and Preview, if
preview deployments should show photos):

| Variable                 | Required?       | Effect when missing                                   |
| ------------------------ | --------------- | ----------------------------------------------------- |
| `GOOGLE_PLACES_API_KEY`  | optional        | `/api/places` answers `503`; chain skips Google       |
| `MAPILLARY_ACCESS_TOKEN` | optional        | `/api/mapillary` answers `503`; chain skips Mapillary |
| `PEXELS_API_KEY`         | optional        | `/api/pexels` answers `503`; chain skips Pexels       |
| `VITE_MAPTILER_KEY`      | needed for maps | map tiles and geocoding fall back to placeholders     |

Only `VITE_MAPTILER_KEY` is prefixed, and that is deliberate — it is the one
key designed to be public and origin-restricted. **A missing key is never a
crash:** each proxy answers `503`, the client marks that provider unavailable
for the session, and the photo chain continues. That also means _a blank photo
is indistinguishable from a missing key by looking at the page_ — check the
endpoint directly instead:

```bash
# 503 => the key is not set on this deployment (or was denied)
curl -s -o /dev/null -w '%{http_code}\n' 'https://<your-domain>/api/places?query=Tarbes,%20France'
curl -s -o /dev/null -w '%{http_code}\n' 'https://<your-domain>/api/mapillary?lat=43.23&lon=0.07'
curl -s 'https://<your-domain>/api/places?query=Tarbes,%20Occitanie,%20France' | head -c 400
```

| Status                             | Meaning                                                                                                                                                                                  |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `200` with a non-empty array       | working                                                                                                                                                                                  |
| `200` `{"places":[],"received":0}` | the key works; Google genuinely has nothing for that query                                                                                                                               |
| `200` `{"places":[],"received":5}` | the key works and Google answered, but none of those places had an attributable photo — the usual case for administrative entities, and what the `nearby` landmark tier exists to handle |
| `503`                              | **key not set on the deployment**, or the key was denied/over quota (403)                                                                                                                |
| `429`                              | rate limited — the proxy's own limiter, or the provider's                                                                                                                                |
| `502`                              | provider unreachable, timed out, or returned something malformed                                                                                                                         |

The response body never contains the key, the upstream body, or a file path,
so these commands are safe to run and safe to paste.

### Provider quotas, costs and caching restrictions

| Provider                | Auth               | Billed?                              | Caching permitted                                                                |
| ----------------------- | ------------------ | ------------------------------------ | -------------------------------------------------------------------------------- |
| **Google Places (New)** | server key         | **Yes — per request**                | Place metadata: temporarily. Photo URIs: **not persisted** (short-lived signed)  |
| **Mapillary**           | server token       | No (fair-use rate limits)            | CC BY-SA permits it, but thumb URLs **expire** — memory only                     |
| **Pexels**              | server key         | No (200 req/hr, 20k/month free tier) | Yes — process-lifetime cache, incl. negative results                             |
| **Wikimedia Commons**   | none (keyless)     | No                                   | Yes — process-lifetime cache                                                     |
| **MapTiler**            | public browser key | **Yes** above the free tier          | Tiles/styles cached by the browser; **never** by the service worker (key in URL) |

**What the app already does to contain cost**

- Google is asked **at most twice per location** (one text search, then one
  photo resolve for the single winning candidate — never one resolve per
  candidate), and only for non-marine kinds.
- Every provider client de-duplicates in-flight requests and caches results,
  including negative ones, so re-selecting a place costs nothing.
- A `503` from Google or Mapillary sets a session-wide "provider unavailable"
  flag, so an unconfigured deployment makes **one** wasted request, not one
  per location.
- The chain short-circuits: if Google answers, Commons, Mapillary and Pexels
  are never called at all.
- The PHP proxies carry a per-IP sliding-window rate limit (Places 20/min,
  Mapillary 30/min, Pexels 40/min) that fails open.

**What still requires manual configuration — this project cannot do it for
you, and deliberately does not try:**

1. **Set a Google Cloud budget and a quota cap on the Places API.** This is
   the only real cost exposure in the stack. Without a per-day quota cap, a
   traffic spike (or a scraper hitting `/api/places`) bills your account.
   Console → APIs & Services → Places API (New) → Quotas.
2. **Restrict the Google key** to the Places API (New) _and_ to your server's
   IP address. Not an HTTP referrer — this is a server-to-server call.
3. **Confirm the MapTiler key's allowed-origins list.** It is public by
   design; the origin list is the only thing making that safe.
4. Optionally raise the Pexels tier if the site exceeds 200 requests/hour.

Nothing in this repository changes billing, creates keys, or alters cloud
permissions, and no billing alerts are configured automatically.

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

## Deploying to Vercel

This is the currently deployed target. `api/pexels.js` is a Vercel
serverless function, auto-detected from the repo root — no extra config file
is required.

1. Import the repo into Vercel.
2. In the project's **Settings → Environment Variables**, add
   `PEXELS_API_KEY` (no `VITE_` prefix) with your real key. Leaving it unset
   is fine — the function answers 503 and the app falls back to
   gradient/emoji visuals.
3. Deploy. The build command (`npm run build`) and output directory
   (`dist`) are picked up automatically from `vite.config.js`.

The browser calls the same-origin `/api/pexels`, which Vercel routes to
`api/pexels.js` by its file-based convention — no rewrite rule needed, unlike
the Hostinger path below.

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

> **Route note:** the browser always requests the extensionless `/api/pexels`
> (see [PEXELS_API_KEY — server-side only](#pexels_api_key--server-side-only)),
> but the file on this host is `api/pexels.php`. `public/.htaccess` carries an
> internal `mod_rewrite` rule (`RewriteRule ^api/pexels$ api/pexels.php [L]`)
> that maps one to the other without redirecting the browser or exposing the
> `.php` extension — requires `mod_rewrite` to be enabled, which it is by
> default on Hostinger.

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
`/api/pexels` on your own domain (routed to `api/pexels.php` by the rewrite
rule above) and that **no request to `api.pexels.com`** appears. Searching
the built JS for `PEXELS` should return nothing but the attribution text.

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
Pages. It sets security headers and long-lived caching for hashed assets;
delete it if you don't need it.

> **GitHub Pages has no PHP and no serverless functions.** `api/pexels.js`
> (Vercel) never runs there, and `api/pexels.php` will be served as a plain
> file rather than executed, so the photo proxy returns something the app
> can't parse and it falls back to gradient/emoji visuals — which is the
> intended degraded behaviour, not a bug. Everything else (weather, map,
> forecast, favourites, i18n) works normally. Real photos require the
> [Vercel](#deploying-to-vercel) or [Hostinger](#deploying-to-hostinger)
> deployment described above.

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
  (which holds a real key) would have answered. `**/api/pexels*` is
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
