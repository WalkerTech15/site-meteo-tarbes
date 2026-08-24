# WeatherSphere — School Project Analysis

> **How to read this document.** Every claim is tagged with its evidence level:
>
> - **[Code]** — verified by reading this repository's source. Safe to assert to a jury.
> - **[Inference]** — a reasonable reading of the code, but not proven by it. Present as an opinion ("I chose this because…"), not as fact.
> - **[You]** — information only you can supply. **Fill these in before presenting.** They are deliberately left blank rather than invented.
>
> This document does not assume anything about your school, your assignment brief, your deadline, your teacher's expectations, whether you worked alone or in a team, or why you picked this topic. Those are all **[You]**.

---

## 1. Executive summary

**[Code]** WeatherSphere is a single-page weather dashboard built with vanilla JavaScript ES modules and Vite — no UI framework. It shows current conditions, hourly and 7-day forecasts, an interactive world map, a favourites list, and a settings page, in French and English, with light/dark theming.

It draws on four public APIs (Open-Meteo for weather and air quality, MapTiler for maps and geocoding, Pexels for location photography) and stores all user preferences locally in the browser. There is no database and no user accounts. The app is static files plus **one server-side PHP endpoint**, which exists for exactly one reason: to keep the Pexels API key off the browser (see §15).

**[Code]** The codebase is organised into five JavaScript layers (`core`, `data`, `services`, `features`, `ui`) and five CSS layers (`foundation`, `layout`, `components`, `views`, `utilities`), with 53 unit tests over the pure logic and 24 end-to-end browser tests over the user-facing behaviour.

**[Inference]** The strongest thing about the project is not any single feature — it is that a framework-free codebase of this size stayed navigable, tested, and honest about its own limits.

---

## 2. The problem it solves

**[Code]** Existing weather sites tend to either be information-dense and ugly, or attractive and shallow. WeatherSphere targets the middle: a genuinely readable interface that still exposes the full data set on demand.

Two design decisions in the code speak directly to this:

- **Simple / Detailed mode** — the same location renders either 4 metric cards or 12, chosen by the user, rather than forcing one audience's density on everyone.
- **Bilingual by construction** — every user-visible string lives in one dictionary with French and English entries; there is no hardcoded interface text to translate later.

**[You]** Whether this problem was assigned to you, chosen by you, or emerged from a specific frustration.

---

## 3. Intended users

**[Inference]** Based on what the code actually optimises for:

- **Everyday users** who want today's weather at a glance — served by Simple mode, the hero card, and favourites.
- **Users who want more** — served by Detailed mode, the hourly charts, the air-quality reading, and the forecast page's day breakdown.
- **French and English speakers**, treated as equals — French is the default (`<html lang="fr">`), not an afterthought.
- **Phone users** — the layout has explicit breakpoints at 1240px, 1080px, 900px, and 640px, and the sidebar becomes a drawer below 900px.

**[You]** Whether you had a specific user in mind (classmates? family? a persona from the brief?).

---

## 4. Goals

### Primary goals — **[Inference]**, but each is visibly pursued in the code

1. **Accurate, live weather for anywhere on Earth** — global geocoding, not a fixed city list.
2. **An interface that stays readable** — one design-token file, consistent spacing, and a deliberate density switch.
3. **Full French/English parity.**
4. **Never show the user a broken page** — every network path has a fallback.

### Secondary goals — **[Inference]**

5. **Maintainability** — module boundaries you can explain in one sentence each.
6. **Accessibility** — keyboard operation, ARIA state, focus management, reduced-motion support.
7. **Performance** — the 786 KB map library is code-split and only downloaded if you open a map.

**[You]** Which of these were required by the assignment versus chosen by you. This distinction matters to a jury.

---

## 5. Confirmed features — **[Code]**

| Area              | What it does                                                                                                                                                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Home**          | Hero card (location, temperature, condition, local time, high/low, "updated" line), metrics grid (4 in Simple, 12 in Detailed), 5-day forecast strip, hourly chart with 4 tabs, weather insights, mini world map, "explore the world" carousel |
| **Map**           | MapLibre GL map with the MapTiler Hybrid style, quick-jump chips (World / France / USA / Canada), clickable markers with popups, a location-info panel, and a popular-cities list                                                              |
| **Forecast**      | Day carousel, hourly chart (temperature / feels-like / precipitation / wind), precipitation bar chart, sunrise/sunset/UV/air-quality details, and a generated plain-language summary                                                           |
| **Favourites**    | Add/remove any location, grid or table view, weather for all favourites fetched in **one batched request**, persisted in localStorage                                                                                                          |
| **Search**        | Searches 33 curated locations instantly, then queries MapTiler (falling back to Open-Meteo) after a 300 ms debounce; full keyboard navigation with ARIA combobox semantics                                                                     |
| **Geolocation**   | Optional "my location" via the browser API, reverse-geocoded to a place name, cached for 30 minutes                                                                                                                                            |
| **Settings**      | Temperature unit (°C/°F), wind unit, language, display mode, theme (light/dark/system), data export to JSON, and a full reset                                                                                                                  |
| **i18n**          | Complete FR/EN dictionaries; switching re-renders live without a reload                                                                                                                                                                        |
| **Theming**       | Light/dark/system; dark mode redefines the same design tokens rather than duplicating rules                                                                                                                                                    |
| **Accessibility** | Skip link, focus-visible rings, ARIA roles and state on every custom control, focus trap in the mobile drawer, `prefers-reduced-motion` support, ~44 px touch targets                                                                          |
| **Resilience**    | 8-second request timeouts, 5-minute weather cache with in-flight deduplication, deterministic demo-data fallback, every localStorage read guarded                                                                                              |

---

## 6. Prototype and incomplete features — **[Code]**

Be upfront about these. A jury respects a student who names their own gaps.

| Feature                                | Actual status                                                                                                                                                                                                                                                         |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Notifications**                      | **Preferences only.** The four switches write to localStorage and nothing else. No notification is ever sent, and the app never requests browser notification permission. Labelled "Prototype" in the UI, and the settings text says so explicitly in both languages. |
| **Offline support**                    | **Does not exist.** There is no service worker and nothing is precached. The demo dataset is an in-session fallback for _failed API calls_, not offline capability — the app cannot be opened from scratch without a network.                                         |
| **"Export my data"**                   | Works, but exports only what the app itself stored (settings, favourites, last location).                                                                                                                                                                             |
| **Pexels photos**                      | Optional, and they need a PHP host: the key is held by a server-side proxy, so on a static host (e.g. GitHub Pages) the endpoint can't run and locations fall back to gradients and emoji. Same fallback when no key is configured.                                   |
| **Air quality**                        | European AQI only (the Open-Meteo endpoint used), so the scale is less meaningful outside Europe.                                                                                                                                                                     |
| **Blog / Contact / Help footer links** | Present in the footer; several are placeholders.                                                                                                                                                                                                                      |

---

## 7. Architecture overview — **[Code]**

```
src/
├── index.html          single page; all six views exist in the DOM at once
├── styles/
│   ├── foundation/     design tokens, reset, base element styles
│   ├── layout/         topnav, sidebar, main shell, footer
│   ├── components/     reusable atoms (buttons, cards, forms, toggles, …)
│   ├── views/          per-page styles
│   ├── utilities/      accessibility + cross-cutting responsive rules
│   └── main.css        the ONE entry point, imports the above in cascade order
└── js/
    ├── core/           state, storage, i18n, DOM helpers, units, date/time, config
    ├── data/           static data: locations, WMO codes, translations, icons, flags
    ├── services/       everything that talks to a network: weather, geocoding, photos, cache
    ├── features/       behaviour: search, favourites, map, geolocation, settings
    ├── ui/             rendering: one module per view, plus charts/nav/toasts
    └── main.js         bootstrap — wires events, then loads the first location
```

**The dependency rule that keeps it honest:** `data` depends on nothing. `core` depends only on `data`. `services` may use `core`. `features` and `ui` sit on top. `main.js` is the only place that knows about all of them.

**[Inference]** The layer split matters more than the file count. When something breaks, the layer name tells you where to look: a wrong number is `services` or `core/units`, a wrong-looking element is `ui` or `styles`, a wrong reaction to a click is `features`.

**Views are shown and hidden, not routed** — **[Code]** `switchView()` toggles the `hidden` attribute on six `<section class="view">` elements. There is no router and no URL change.

---

## 8. Source versus production build — **[Code]**

|              | Development (`npm run dev`)            | Production (`npm run build`)                                         |
| ------------ | -------------------------------------- | -------------------------------------------------------------------- |
| Files served | ~40 separate ES modules, ~20 CSS files | 3 bundles                                                            |
| JavaScript   | unbundled, native imports              | `index-*.js` — **116 KB (38 KB gzipped)**                            |
| Map library  | same                                   | `maplibre-gl-*.js` — **787 KB (210 KB gzipped)**, a _separate_ chunk |
| CSS          | ~20 files via `@import`                | one file — **124 KB (22 KB gzipped)**                                |
| Output       | in-memory                              | `dist/` — static files only                                          |

**The key number:** MapLibre is `import()`-ed dynamically the first time a map is actually rendered. A visitor who never opens the Map view never downloads those 210 KB. **[Code]** — confirmed by the separate chunk in the build output.

**[Code]** `vite.config.js` sets `base: "./"`, so the same `dist/` works from a domain root _or_ a subdirectory. Deployment is "copy `dist/` to the server" — nothing to install, no Node.js on the host.

---

## 9. API flow — **[Code]**

```
User picks a location
        │
        ▼
selectLocation(loc)
        │
        ├──► fetchWeather()  ── 5-min TTL cache, in-flight dedup ──► api.open-meteo.com/v1/forecast
        │         │                                                   (current + hourly + daily, timezone=auto)
        │         └──► air-quality-api.open-meteo.com  (separate, non-blocking — never delays the render)
        │
        ├──► on ANY failure ──► demoWeather(loc)   deterministic local generator, state.isDemo = true
        │
        └──► hydrateLocPhoto()
                  │
                  └──► GET /api/pexels?query=…      SAME ORIGIN — no key in the browser
                             │
                             │  (Vercel function in production, PHP for the
                             │   Hostinger deploy path, Vite middleware in dev)
                             │  reads the key from outside the web root
                             ▼
                        api.pexels.com                  Authorization header, server-side only
                             │
                             └──► {"photo": {...}} | {"photo": null} | 4xx/5xx
                                       └──► any failure ⇒ gradient + emoji fallback
```

| API                        | Used for                                 | Key needed? | What happens without it                                     |
| -------------------------- | ---------------------------------------- | ----------- | ----------------------------------------------------------- |
| **Open-Meteo forecast**    | all weather                              | No          | —                                                           |
| **Open-Meteo air quality** | European AQI                             | No          | field shows "—"                                             |
| **Open-Meteo geocoding**   | search fallback                          | No          | —                                                           |
| **MapTiler**               | map tiles + primary global search        | **Yes**     | map shows an error message; search falls back to Open-Meteo |
| **Pexels** (via own proxy) | location photos                          | Optional    | gradient + emoji fallback                                   |
| **BigDataCloud**           | reverse geocoding without a MapTiler key | No          | —                                                           |

**Three things worth pointing out to a jury** — all **[Code]**:

1. **Requests are deduplicated.** `createAsyncCache` stores the in-flight _promise_, so the sidebar widget, the popular-cities list, and the hero asking for the same coordinates produce **one** network call.
2. **Favourites are batched.** Open-Meteo accepts comma-separated coordinates, so N favourites cost 1 request, not N.
3. **Every request has an 8-second timeout** via `AbortSignal.timeout()`, so a hanging API can never freeze the interface.

---

## 10. State management and localStorage — **[Code]**

There is no state library. One plain object in `core/state.js` holds everything: `lang`, `mode`, `unitTemp`, `unitWind`, `theme`, `view`, `loc`, `wx`, `favorites`, `notifs`, `isDemo`, and the chart tab selections.

The persistence pattern is **"mutate state, persist, re-render"** — no reactivity, no observers.

| Key                      | Contents                            |
| ------------------------ | ----------------------------------- |
| `ws_lang`                | `"fr"` / `"en"`                     |
| `ws_mode`                | `"simple"` / `"detailed"`           |
| `ws_unit_t`, `ws_unit_w` | unit choices                        |
| `ws_theme`               | `"light"` / `"dark"` / `"system"`   |
| `ws_favs`                | array of location objects           |
| `ws_lastLoc`             | location to restore on next visit   |
| `ws_notifs`              | the four notification preferences   |
| `ws_geo`                 | cached geolocation fix (30-min TTL) |

**A defensive detail worth mentioning:** **[Code]** every read goes through `core/storage.js`, where each one is wrapped in `try/catch`. A single corrupted value — from a partial write, a browser extension, or someone editing devtools — cannot crash startup, and localStorage being unavailable entirely (private mode, quota exceeded) degrades to "preferences don't persist" rather than a blank page.

**Privacy consequence:** **[Code]** every byte the app stores is in the user's own browser. There is no account, no server-side storage, and no analytics.

---

## 11. Internationalisation — **[Code]**

- Two dictionaries in `data/translations.js`, keyed identically.
- Static markup carries `data-i18n` / `data-i18n-aria` attributes; `applyStaticI18n()` fills them in.
- Dynamic markup calls `t("key")` at render time.
- Weather descriptions are translated per WMO code — not machine-translated strings.
- Some data is inherently bilingual: every curated location stores `name.en` / `name.fr`, so "London" correctly becomes "Londres".
- Switching language re-renders immediately, updates `<html lang>`, and persists the choice.

**[Inference]** The reason this works cleanly is that the language was never allowed to become implicit: no user-visible string is written directly into a template.

---

## 12. Accessibility decisions — **[Code]**

| Decision                                                                         | Why it matters                                                                       |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Skip link to `#main`                                                             | keyboard users skip the nav                                                          |
| `:focus-visible` rings throughout                                                | visible keyboard focus without mouse-click outlines                                  |
| Real `<button>` elements everywhere interactive                                  | Enter/Space work natively; no synthetic key handlers                                 |
| Favourite cards are `<article>` with **sibling** open/remove buttons             | a control nested inside another control is invalid and unusable with a screen reader |
| Table rows are not focusable; the location cell holds a real button              | rows aren't interactive elements                                                     |
| Mobile drawer: `inert` + `aria-hidden` while closed                              | an off-screen drawer is otherwise still tabbable and still read aloud                |
| Focus trap in the open drawer; Escape closes it and restores focus to the burger | standard dialog-like behaviour                                                       |
| `aria-expanded` / `aria-controls` on the burger                                  | screen readers announce the drawer's state                                           |
| ARIA combobox pattern on search                                                  | `aria-expanded`, `role="option"`, `aria-selected`, arrow-key navigation              |
| `prefers-reduced-motion` honoured                                                | animations reduced to ~0 for users who ask                                           |
| ~44 px touch targets, via transparent `::before` hit areas                       | meets touch guidance **without** making the design look oversized                    |
| Dark-mode secondary text colours deliberately lightened                          | the light-mode greys don't have enough contrast on dark                              |

**[Inference]** The mobile-drawer and favourites-card fixes are the two most defensible items here, because both were real defects with a concrete failure mode, not box-ticking.

---

## 13. Responsive design — **[Code]**

Breakpoints at **1240px** (hero shrinks), **1080px** (single-column, forecast becomes a swipeable row), **900px** (sidebar becomes a drawer, burger appears), and **640px** (phone: logo text hidden, 2-column metrics, single-column favourites).

Supporting choices: `env(safe-area-inset-*)` padding for notched phones; charts redrawn on resize because they're SVG sized to their container; `overflow-x: auto` carousels instead of wrapping; touch-target rules keyed to `(pointer: coarse)` as well as width.

---

## 14. The demo-data fallback, honestly — **[Code]**

**What it is:** `demoWeather(loc)` in `services/weather-api.js`. When a weather request fails for any reason, it generates a plausible dataset locally, sets `state.isDemo = true`, and the hero badge changes from "Live" to "Demo data (fallback)". A toast appears — at most once a minute, not on every navigation.

**It is deterministic.** A hash of the location id seeds a linear congruential generator, so the same place always produces the same demo weather. It also models latitude (colder toward the poles), hemisphere-aware seasons, and a sinusoidal day/night temperature curve.

**What it is emphatically not:**

- ❌ It is **not** offline support. There is **no service worker**. Opening the site with no network gives you a browser error page, not the app.
- ❌ It is **not** real weather. It is invented data, clearly labelled as such in the UI.
- ✅ It **is** a graceful-degradation mechanism for API failures that occur _while the app is already loaded_.

**[Inference]** This distinction is the single most likely place a jury will catch out an over-claiming student — which is exactly why the README and the About page were reworded to state it plainly.

---

## 15. Privacy and API-key limitations — **[Code]**

**Privacy — genuinely good:**

- No accounts, no server, no analytics, no tracking, no cookies.
- All data stays in localStorage, and the settings page offers a full reset.
- Geolocation is opt-in, only ever sent to a geocoder to resolve a place name, and cached for 30 minutes.

**API keys — and how one of them stopped being a problem.** This is worth explaining carefully, because it is the clearest example in the project of a security decision with a real trade-off.

**The rule:** anything Vite exposes to the browser is public. Vite only exposes variables whose name starts with `VITE_`, and it compiles them into the JavaScript bundle as plain string literals. Minification does not hide them. So the prefix is not a naming convention — it is the decision about whether a key is published.

The two keys need different answers because the two services offer different protections:

|                                  | MapTiler                             | Pexels                                               |
| -------------------------------- | ------------------------------------ | ---------------------------------------------------- |
| Must run in the browser?         | Yes — it draws the map               | No — only the resulting image URL is needed          |
| Can be restricted to your domain | **Yes** — allowed-origins list       | **No** — Pexels offers no origin restriction         |
| Where the key lives now          | In the bundle, deliberately          | On the server only                                   |
| If someone copies it             | It answers 403 from any other origin | It would work anywhere — which is why it isn't there |

**[Code] MapTiler stays in the browser**, because a map library genuinely needs it client-side and MapTiler keys can be locked to an allowed-origins list (localhost for development, the production domain for the live site). A restricted key is worthless to anyone who copies it.

**[Code] Pexels was moved to the server.** The browser now calls a same-origin endpoint, `/api/pexels?query=…`, which attaches the key server-side and returns only what the UI needs — image URLs, the photographer's name, the Pexels link, and alt text:

- **Production (Vercel):** `api/pexels.js`, a serverless function, reads `PEXELS_API_KEY` from the platform's environment variables.
- **Production (Hostinger/Apache alternate):** `public/api/pexels.php` reads the key from a file **outside `public_html`** (`/home/<user>/private/weathersphere-secrets.php`). Nothing under the web root contains it.
- **Development:** a Vite middleware serves the same path from Node, reading the unprefixed `PEXELS_API_KEY`.

The proxy accepts GET only, validates and length-bounds the single `query` parameter, rejects control characters, fixes the upstream parameters server-side, sends the key in an `Authorization` header (never a query string, which would land in access logs), applies connect/total timeouts, sets no permissive CORS header, and answers a generic 503 if the secret is unavailable. `npm run verify:secrets` scans the built bundle and fails the build if a credential or a direct `api.pexels.com` call reappears.

**[Code] What this does and does not achieve.** The proxy stops the key from being _published_. It does not stop someone from calling your proxy — it is a public endpoint by design, so a third party could still use your quota through it. That is why it also rate-limits per IP. Closing that gap completely would need authentication, which a public weather site has no basis for.

**[Inference]** The honest framing for a jury: the previous version documented this as a known limitation and did nothing about it; this version fixes it properly for the credential and is explicit about the residual risk that remains.

**[You]** Whether a PHP host was available to you from the start, or whether this constrained your hosting choice.

---

## 16. Testing strategy — **[Code]**

Two layers, deliberately separated.

**Unit tests — Vitest, 53 tests in 6 files, colocated with the code they test.** They cover _pure logic only_, where a test can be exact: unit conversion and formatting, the TTL cache and its in-flight deduplication, safe localStorage parsing (including deliberately corrupted values), location-search scoring, WMO weather-code lookup, and the photo-proxy contract — success, no-result, every error status (400/405/429/502/503), timeout, negative caching, plus assertions that the client sends **no** `Authorization` header and never addresses `api.pexels.com`.

**End-to-end tests — Playwright, 24 tests, real Chromium.** Desktop and an emulated Pixel 5:

1. Homepage loads with weather and no console errors
2. Selecting a search suggestion switches location
3. A failing weather API activates the demo fallback
4. French ↔ English switching
5. Simple ↔ Detailed switching
6. Add, open, and remove a favourite
7. Grid/list views are mutually exclusive; rows aren't focusable
8. Mobile drawer: inert when closed, focus on open, Tab trapped, Escape restores focus, scrim and nav both close it, touch targets ≥ 44 px
9. Pexels attribution appears **only** for Pexels images, in the right language, with the photo fetched from the same-origin proxy and never from Pexels
10. Settings persist across a reload
11. Every proxy failure (400/429/502/503, and a proxy that never answers) leaves the gradient fallback, no console errors, and no server message on screen

**Plus a build-artifact check:** `npm run verify:secrets` scans `dist/` for the old public variable, the server-side variable name, a direct `api.pexels.com` call, credential-shaped strings, and — when a key is present in the environment — that exact value. It fails the build on a hit and **never prints the matched value**, only the file and which rule fired.

**The rule that makes the e2e suite trustworthy:** **[Code]** no test ever touches a live API. Every external origin is intercepted and served a fixture, and a catch-all route **aborts anything unmocked**. The photo proxy needed special care: it is _same-origin_, so the cross-origin catch-all would have let it through to the real dev middleware, which holds a real key — it is therefore intercepted explicitly, and the test server is started with an intentionally **empty** `PEXELS_API_KEY` so that even an escaped request could only produce a 503.

**[Inference]** The split is the point: unit tests answer "is the maths right?", e2e tests answer "does a person get what they expect?". Neither can replace the other.

---

## 17. Strongest aspects

**[Code]**

1. **Genuine architecture without a framework.** Five named layers with a one-way dependency rule.
2. **Layered resilience.** Timeouts → cache → deduplication → demo fallback. Four independent mechanisms.
3. **Accessibility that goes past the checklist.** `inert` on a closed drawer and un-nesting the favourite-card buttons are things most projects — including commercial ones — get wrong.
4. **Measurable performance work.** 210 KB gzipped of map library moved off the initial load; flag SVGs optimised from 6.3 MB to 4.4 MB (–31 %).
5. **Real test coverage at two levels**, with e2e tests that cannot silently start hitting the network.
6. **Bilingual by construction**, not by retrofit.
7. **A credential moved out of the browser, with the reasoning to back it.** Not "I added a proxy", but: I can say which of my two keys belongs client-side and why, what the prefix actually controls, where the secret lives on the server and why that directory, what the endpoint validates, and what the proxy still does _not_ protect against.

**[Inference]** 8. **It is honest about itself.** The prototype badge and the corrected offline wording are cases where the project says "this doesn't work yet" instead of hiding it. The Pexels key is the counter-example that proves the point: it was documented as a known limitation, and then actually fixed.

---

## 18. Known limitations — **[Code]**

1. No service worker → **not** an offline app.
2. Notifications are preferences only.
3. **Photos now need a server that can run the proxy** (Vercel serverless function or a PHP host). The Pexels key is server-side, so a purely static deployment (GitHub Pages) can't run the proxy and falls back to gradients. That is a deliberate trade: portability given up for a credential that is no longer published.
4. **The proxy is open by design.** It keeps the key private, but anyone can call `/api/pexels` and consume your quota. Per-IP rate limiting blunts this; only authentication would close it, and a public weather site has no basis for that.
5. **The rate limiter is best-effort.** It uses per-IP files in the system temp directory and deliberately fails _open_ — if the directory is unwritable on shared hosting, requests pass rather than the site breaking. It also does not survive a load-balanced multi-server setup.
6. The MapTiler key is still browser-visible. That is correct for a map library, but it is only safe if the allowed-origins list is actually configured — an unrestricted key is as exposed as the old Pexels one was.
7. Air quality is the European index only.
8. No routing — views aren't linkable or bookmarkable, and the Back button doesn't move between them.
9. No accounts or database → no cross-device sync.
10. `dist/index.html` is large (~64 KB) because all six views ship in one document.
11. MapLibre is 787 KB raw; code-split, but still large if you do open the map.
12. Weather accuracy is entirely Open-Meteo's; the app adds no modelling of its own.
13. Curated data covers 33 locations; everywhere else depends on live geocoding.

---

## 19. Realistic future improvements

Ordered by effort-to-value. **[Inference]** throughout — these are proposals, not commitments.

**Small**

1. URL hash routing (`#map`, `#favorites`) so views are linkable and Back works.
2. `<meta name="theme-color">` matched to the active theme.
3. Per-view `<title>` updates for screen-reader and history clarity.

**Medium**

4. A service worker precaching the app shell — this, and only this, would make the offline claim true.
5. A short-lived server-side cache in the photo proxy (query → result), so repeat visitors don't each spend a Pexels request, and quota abuse via the open endpoint costs less.
6. Weather alerts from a real warnings API — which would make the notifications section real.
7. Regional air-quality indices instead of European-only.

**Larger**

8. Real push notifications (needs both a service worker and a push service).
9. Optional accounts for cross-device favourites — a significant privacy trade-off that should be argued, not assumed.
10. Visual-regression tests on the two themes.

---

## 20. The 30-second pitch

> WeatherSphere is a weather dashboard for anywhere in the world, in French and English. You get current conditions, hourly and 7-day forecasts, an interactive map, and saved favourites — with a switch between a simple view and a detailed one, so it works whether you want a number or a full analysis.
>
> I built it in vanilla JavaScript with no framework, because I wanted to understand the architecture rather than inherit one. It's organised in five layers, it has 39 unit tests and 18 browser tests, and it's designed so that if any API fails, you still get a usable page instead of a broken one.

---

## 21. The 2-minute presentation

**(0:00–0:20) The problem.** Weather sites are either dense and ugly or pretty and shallow. I wanted one that's readable by default but gives you everything on demand — and that treats French and English as equals rather than translating one into the other.

**(0:20–0:50) What it does.** Six views: home, map, forecast, favourites, about, settings. Search any place on Earth. Save favourites. Switch language, units, theme, and density. It uses Open-Meteo for weather, MapTiler for maps, and Pexels for location photos.

**(0:50–1:20) How it's built.** Vanilla JavaScript ES modules with Vite — no React, no Vue. Five layers with a one-way dependency rule: data, core, services, features, UI. Twenty CSS files behind one entry point, all colours and spacing driven by design tokens. Around 40 modules, and I can tell you what each layer is responsible for in one sentence.

**(1:20–1:45) The engineering I'm proudest of.** Three things. First, resilience: 8-second timeouts, a 5-minute cache that deduplicates simultaneous requests, and a deterministic demo dataset if everything fails — so the page is never broken. Second, performance: the map library is 210 KB gzipped, and it's code-split so you only download it if you actually open a map. Third, accessibility: real buttons everywhere, and the mobile menu is properly `inert` when it's closed, so it isn't secretly tabbable.

**(1:45–2:00) What's honest about it.** Notifications are a prototype — they save preferences and nothing else, and the UI says so. It is not an offline app; the demo data is a fallback for failed requests, not offline support. One thing I did fix rather than document: my Pexels key used to be compiled into the JavaScript, because anything with Vite's `VITE_` prefix is. Pexels keys can't be domain-restricted, so that key was effectively published. It now sits in a file outside the web root and the browser calls my own endpoint instead. The build fails if a credential ever reappears in the bundle.

---

## 22. The 5–7 minute presentation outline

**1. Opening (30 s)** — the problem, and the density/bilingual angle. **[You]** add one sentence on why you chose it.

**2. Live demonstration (2 min)** — see §23. Demo first, slides later.

**3. Architecture (1.5 min)** — draw the five layers and the one-way dependency rule. Explain _why_: when something breaks, the layer name tells you where to look. Mention the parallel CSS layering and the single `main.css` entry point.

**4. Two technical deep dives (1.5 min)** — pick two, don't rush all of them:

- _Resilience_: timeout → cache → dedup → demo fallback, and the batched favourites request.
- _Performance_: dynamic `import()` of MapLibre; quote 210 KB gzipped moved off the initial load.
- _Accessibility_: the `inert` drawer and the un-nested favourite card — both real bugs you found and fixed.

**5. Testing (45 s)** — the two layers and why they're separate. The strongest line: _"No end-to-end test can touch the network — anything unmocked is aborted, so the suite can't silently become flaky."_

**6. Limitations and next steps (45 s)** — say these before you're asked. Notifications are a prototype; it isn't offline; the photo proxy keeps the key private but is itself open to anyone who calls it, and it needs a PHP host, so a static deployment loses photos. Then the fixes: a service worker, and a server-side cache in front of the proxy.

**7. Close (30 s)** — **[You]** what you learned. The most credible version names something that surprised you or that you got wrong first.

---

## 23. Recommended live demonstration

Rehearse this. **[Code]** — every step works.

**Before you start:** load the page once so assets are cached, set the language to French, clear your favourites, and have devtools closed.

1. **Home (20 s)** — point out the hero, the local time, and the "Live" badge.
2. **Simple → Detailed (15 s)** — 4 cards become 12. _"Same data, user's choice of density."_
3. **Search (20 s)** — type a city, use the **arrow keys**, press Enter. Say: _"Fully keyboard-operable, and it searches curated locations instantly while the global geocoder catches up."_
4. **Favourite (15 s)** — click the star, open Favourites, toggle grid/list.
5. **Map (25 s)** — open it and say: _"This is the moment MapLibre downloads — it isn't in the initial bundle."_ Click a marker.
6. **Language (15 s)** — switch to English. Everything re-renders, including the photo credit.
7. **Theme (10 s)** — switch to dark. _"Same tokens, redefined."_
8. **The strong finish — offline (25 s):** open devtools → Network → **Offline**, then pick a different city. The badge flips to "Demo data (fallback)" and a toast appears. Then say the honest line out loud:

   > _"That's a fallback for failed requests — not offline support. If I reloaded right now, the app wouldn't load at all, because there's no service worker. That's a limitation I chose to document rather than hide."_

   **[Inference]** This is the single highest-value moment in the demo. Volunteering the limitation immediately after showing the impressive behaviour is far more convincing than being caught out on it later.

9. **Mobile (20 s)** — device toolbar, open the burger, press Tab a few times, press Escape. _"The menu traps focus while it's open, and it's `inert` when closed so it isn't tabbable."_

---

## 24. Ten likely jury questions, with honest answers

**1. "Why no framework? Isn't that a step backwards?"**

> A framework solves problems I didn't have — this app has no complex shared state and no component reuse across pages. What I did need was to understand architecture, and a framework would have made those decisions for me. The trade-off is real: I hand-wrote things React gives you free, like re-rendering after a state change. **[Inference]** For a project this size I'd make the same choice again; for something twice as big I wouldn't.

**2. "Does it really work offline?"**

> No, and I'd rather say that clearly. There's no service worker, so the app can't be opened from scratch without a network. What it has is a fallback: if a weather request fails while the app is already open, it generates a deterministic demo dataset and labels it in the UI. I corrected the wording in the README and the About page specifically because the earlier version over-claimed this.

**3. "Your API key is in the JavaScript. Isn't that a security hole?"**

> One of them is in the JavaScript deliberately, and one used to be by mistake.
>
> Vite only exposes variables whose name starts with `VITE_`, and it compiles them into the bundle as plain strings — minifying doesn't hide them. So that prefix is really a decision about whether a key is published.
>
> MapTiler has to be in the browser, because the map library runs there. That's acceptable because MapTiler keys can be locked to an allowed-origins list — localhost and my domain — so a copied key returns 403 anywhere else.
>
> Pexels can't be restricted that way, so my Pexels key was effectively published. I moved it server-side: the browser now calls my own `/api/pexels`, which attaches the key and returns only the image URLs, the photographer, the link, and the alt text. In production (Vercel) that's a serverless function reading the key from the platform's environment variables; on the alternate Hostinger deploy it's a PHP script reading a file above `public_html`, so it isn't reachable over HTTP at all either way. And because the old key had been shipped, I rotated it — removing a key from the current bundle doesn't un-publish the old one.
>
> What that does **not** fix: my proxy is a public endpoint, so someone could still call it and use my quota. I rate-limit per IP; genuinely closing it would need authentication, which a public weather site can't justify.

**3b. "How do you know the key isn't still in there?"**

> `npm run verify:secrets` runs after every build and scans `dist/` for the old variable name, the server-side variable name, any direct call to `api.pexels.com`, credential-shaped strings, and — if a key is set in the environment — that exact value. It fails the build on a hit, and it prints the file and which rule matched but never the value itself, so the check can't leak what it's protecting. There's also a unit test asserting the client sends no `Authorization` header, and an end-to-end test asserting the browser requests `/api/pexels` and never `api.pexels.com`.

**4. "How accurate is the weather?"**

> As accurate as Open-Meteo, which aggregates national meteorological models. I don't do any forecasting myself — I fetch, convert units, and display. That's a deliberate boundary: writing my own weather model wasn't realistic, and pretending otherwise would be dishonest.

**5. "What happens if an API is down?"**

> Four layers. Every request times out after 8 seconds so nothing hangs. A 5-minute cache means a recently-viewed location doesn't need the network. If a request does fail, demo data takes over and the badge changes. And features degrade independently — no MapTiler key means no map, but weather still works.

**6. "Do the notifications work?"**

> No. They save preferences to localStorage and nothing else. The app never even asks for notification permission. They're badged "Prototype" and the settings text says so in both languages. Making them real needs a service worker and a push service — I listed it as future work rather than shipping a switch that lies.

**7. "How do you know it works? Did you just click around?"**

> Two test layers. 39 unit tests over pure logic — conversions, caching, corrupted-storage handling, search ranking. Then 18 Playwright tests driving a real browser through search, favourites, language switching, the mobile menu, and the demo fallback. The e2e tests mock every API, and anything unmocked is aborted — so a test can never accidentally depend on the network.

**8. "Is it accessible?"**

> I think so, and I can point at specifics rather than claim it generally. Every interactive element is a real `<button>`. The mobile menu is `inert` when closed, so it isn't tabbable while off-screen — that was a bug I found and fixed. The favourite cards had a remove button nested inside a `role="button"` wrapper, which is invalid; they're now plain containers with two sibling buttons. Focus is trapped in the open drawer and restored on Escape. **[You]** — if you tested with an actual screen reader, say which one; if you didn't, say that instead of implying you did.

**9. "Why is the JavaScript bundle so big?"**

> The app bundle is 38 KB gzipped, which is small. The 210 KB is MapLibre, and it's loaded with a dynamic `import()` only when a map is first rendered — so a user who never opens the Map view never downloads it. That was a deliberate change: it used to load on every page view from a CDN.

**10. "What was the hardest part?"**

> **[You]** — answer this honestly and specifically; a vague answer here undoes a good presentation. **[Inference]** Defensible candidates visible in the code: getting the mobile drawer's focus management right across the desktop/mobile breakpoint; making the photo loading race-safe when the user switches location mid-fetch; or splitting one large stylesheet into twenty files while proving nothing was lost.

---

## 25. Difficult technical questions

**1. "Your services are cached. What happens if two components request the same location at the same moment?"**

> One network call. `createAsyncCache` stores the in-flight **promise**, not just the resolved value — so the second caller receives the same pending promise instead of firing a second request. Both then get the same result. Without that, opening the home view would have triggered three simultaneous identical requests.

**2. "You have circular imports between modules. Why doesn't that break?"**

> ES modules handle cycles as long as the imported binding isn't used during module evaluation. Every cyclic usage here is inside a function body, so by the time it runs, both modules are fully initialised. It would break if any of them called an imported function at the top level. **[Inference]** It's a pattern that works but needs care, and it's the thing I'd document most carefully for anyone else working on the code.

**3. "How do you prevent XSS when place names come from a third-party geocoder?"**

> Every interpolation into `innerHTML` goes through one `esc()` function. It matters here because geocoder datasets are partly crowd-sourced, so a place name genuinely could contain markup. The rule is to escape at the interpolation site, not at the source — the same name is also used with `textContent`, where a pre-escaped string would display raw entities. The Pexels photographer name goes further and uses `textContent` directly, and the photo URL is validated as `https://` before being used as an `href`.

**4. "The user switches city while a photo is still loading. What stops the wrong image appearing?"**

> A token counter. Every location change increments `photoToken`; each hydration captures its value and checks it before touching the DOM. A response from an abandoned request finds its token stale and does nothing. The gradient and emoji fallback render immediately in a fixed-ratio container, so there's no layout shift either way.

**5. "Why `inert` instead of just `display: none` on the closed menu?"**

> Because the drawer is _animated_ — it slides in with a CSS transform, so it has to remain rendered. Being off-screen it was still in the tab order and still announced by screen readers: you could tab into an invisible menu. `inert` removes it from focus and from the accessibility tree without touching layout, so the animation is preserved. I pair it with `aria-hidden`, and both are removed above 900px where the sidebar is genuinely visible — a state machine that has to react to breakpoint changes, not just clicks.

**6. "Your proxy takes a user-supplied string and sends it to another API. What stops someone abusing that?"**

> Several things, and it's worth being precise because "I validate the input" on its own isn't an answer.
>
> The endpoint accepts GET only and exactly one parameter, `query` — anything else in the URL is ignored, so a caller can't smuggle in `per_page=10000` or a different endpoint. The query must be valid UTF-8, must contain no control characters, is whitespace-collapsed, and must be between 2 and 120 characters. Everything that shapes the upstream request — orientation, page size, the endpoint itself — is fixed server-side.
>
> The key goes in an `Authorization` header, never the URL, because query strings end up in access logs, proxy logs and `Referer` headers. There's a connect and a total timeout so a slow upstream can't pile up PHP workers. And the response is re-projected rather than forwarded: I build a new object with the four fields the UI needs and validate that each URL actually starts with `https://`, so nothing unexpected from upstream reaches the browser.
>
> What remains is quota abuse — the endpoint is public, so someone could call it in a loop. There's a per-IP sliding-window rate limit for that, which deliberately fails _open_: on shared hosting, if the temp directory isn't writable, I'd rather lose rate limiting than have the site stop working.

**7. "What happens if the PHP host is missing an extension your proxy uses?"**

> That was a real bug I hit while testing. My first version used `mb_check_encoding` and `mb_substr`, and my local PHP had no mbstring — so the proxy died with a fatal error and returned a 500 containing a stack trace with absolute file paths. Exactly what a proxy holding a secret must never do.
>
> Two fixes. The UTF-8 handling now uses pcre, which is always compiled in — an empty pattern with the `/u` flag fails on invalid UTF-8, which is a dependency-free encoding check — and only uses mbstring when it happens to be available. Separately I added an exception handler and a shutdown handler so that _any_ fatal, whatever causes it, produces a generic `{"error":"upstream_error"}` instead of a trace. The same reasoning covers a host with no cURL and no HTTPS stream wrapper: it's detected and reported as an upstream failure rather than crashing.
>
> **[Inference]** The general lesson is that on shared hosting you can't assume your local PHP build matches the server's, and an error path in security-sensitive code deserves as much attention as the success path.

---

## 26. Claims to avoid

These are the ways a good project loses credibility. **[Code]** — each corresponds to something the code does _not_ do.

| ❌ Don't say                              | ✅ Say instead                                                                                                                                                                                                                                        |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "It works offline."                       | "It falls back to demo data if an API fails while the app is open. It's not an offline app — there's no service worker."                                                                                                                              |
| "It sends weather alerts."                | "The notification switches save preferences. Nothing is sent yet — they're a prototype."                                                                                                                                                              |
| "My API keys are secure."                 | "The Pexels key is server-side and never reaches the browser. The MapTiler key is in the bundle on purpose and is protected by an allowed-origins list, not by secrecy. And my proxy is still an open endpoint — it protects the key, not the quota." |
| "It's fully accessible / WCAG compliant." | "I made specific accessibility decisions — real buttons, `inert` on the closed drawer, focus trapping, reduced-motion support." **[You]** — only claim conformance if you actually audited against the standard.                                      |
| "It's a PWA."                             | It isn't. No manifest, no service worker.                                                                                                                                                                                                             |
| "I built the weather forecasting."        | "I consume Open-Meteo's forecasts and handle conversion, caching, and presentation."                                                                                                                                                                  |
| "It's fast" (unquantified)                | "38 KB gzipped initial JS, with the 210 KB map library code-split out of the first load."                                                                                                                                                             |
| "It works on every browser."              | **[You]** — name the browsers you actually tested. The code uses `inert`, `:has()`, and `AbortSignal.timeout()`, which need reasonably recent browsers.                                                                                               |
| "It's production-ready."                  | "It's deployed and working, with limitations I've documented."                                                                                                                                                                                        |
| Overstating test coverage                 | "39 unit tests over pure logic and 18 browser tests over user flows." Don't imply a coverage percentage you haven't measured.                                                                                                                         |

---

## 27. Your checklist before presenting — **[You]**

- [ ] Fill in every **[You]** item above.
- [ ] Decide what you'll say about scope: solo or team, and which parts were assigned versus chosen.
- [ ] Name the browsers and devices you actually tested on.
- [ ] Decide whether you tested with a screen reader — and be ready to say "no" if you didn't.
- [ ] Rehearse the §23 demo end to end, including the offline moment, at least twice.
- [ ] Prepare one specific, honest answer to "what was hardest" and one to "what would you do differently".
- [ ] Confirm your presentation machine has network access, or rehearse the fallback.
