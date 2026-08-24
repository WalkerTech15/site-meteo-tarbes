import { defineConfig, loadEnv } from "vite";

/* Development stand-in for the production Pexels proxy.
 *
 * Production is api/pexels.js (a Vercel serverless function) on the current
 * deploy target, or public/api/pexels.php on the alternate Hostinger/Apache
 * path (reached via the rewrite rule in public/.htaccess, since Apache has
 * no serverless functions). `vite dev` has neither, so the same endpoint is
 * served here by Node. All three speak the identical contract, so the
 * frontend has exactly one code path.
 *
 * The key is read from PEXELS_API_KEY — deliberately WITHOUT the VITE_ prefix,
 * which is the only thing that keeps it out of the client bundle. Vite injects
 * prefixed variables into import.meta.env; unprefixed ones stay in the Node
 * process, which is where this middleware runs. The value is never written into
 * a response body, a define(), or any file under src/.
 */
const ENDPOINT = "/api/pexels";
const QUERY_MIN_LENGTH = 2;
const QUERY_MAX_LENGTH = 120;
const UPSTREAM_TIMEOUT_MS = 8000;
/* Pexels photo IDs are positive integers. Bounding the digit count keeps an
   absurdly long string from ever reaching the upstream URL. */
const ID_PATTERN = /^[1-9][0-9]{0,15}$/;

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", status === 200 ? "public, max-age=600" : "no-store");
  res.end(JSON.stringify(payload));
}

/* Same validation as clean_query() in the PHP proxy: reject C0/C1 control
   characters outright rather than stripping them, collapse whitespace, and
   bound the length. */
// eslint-disable-next-line no-control-regex -- rejecting these characters IS the point
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001F\\u007F-\\u009F]");

function cleanQuery(raw) {
  if (typeof raw !== "string") return null;
  if (CONTROL_CHARS.test(raw)) return null;
  const query = raw.replace(/\s+/g, " ").trim();
  if (query.length < QUERY_MIN_LENGTH || query.length > QUERY_MAX_LENGTH) return null;
  return query;
}

/* Mirror of the PHP re-projection: only these fields ever reach the browser. */
function toPayload(photo) {
  const src = (photo && photo.src) || {};
  const https = (v) => (typeof v === "string" && v.startsWith("https://") ? v : null);
  const sizes = Object.fromEntries(
    [
      ["medium", https(src.medium)],
      ["large", https(src.large)],
      ["large2x", https(src.large2x)],
    ].filter(([, v]) => v !== null),
  );
  if (Object.keys(sizes).length === 0) return null;
  const link = typeof photo.url === "string" ? photo.url : "";
  return {
    src: sizes,
    photographer: typeof photo.photographer === "string" ? photo.photographer.slice(0, 120) : "",
    link: link.startsWith("https://www.pexels.com/") ? link : "",
    alt: typeof photo.alt === "string" ? photo.alt.slice(0, 200) : "",
  };
}

function pexelsDevProxy(apiKey) {
  const handler = async (req, res, next) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname !== ENDPOINT) return next();

    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return sendJson(res, 405, { error: "method_not_allowed" });
    }

    /* Curated locations (src/js/data/locations.js) carry a manually reviewed
       Pexels photo ID so the hero/card image is guaranteed to show the actual
       landmark rather than whatever a text search ranks first — see
       api/pexels.js, which this dev proxy mirrors. */
    const idParam = url.searchParams.get("id");
    if (idParam !== null) {
      if (!ID_PATTERN.test(idParam)) return sendJson(res, 400, { error: "invalid_id" });
      if (!apiKey) return sendJson(res, 503, { error: "unavailable" });

      try {
        const r = await fetch(`https://api.pexels.com/v1/photos/${idParam}`, {
          headers: { Authorization: apiKey, Accept: "application/json" },
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        });
        if (r.status === 404) return sendJson(res, 404, { error: "not_found" });
        if (r.status === 429) {
          res.setHeader("Retry-After", "60");
          return sendJson(res, 429, { error: "rate_limited" });
        }
        if (!r.ok) return sendJson(res, 502, { error: "upstream_error" });

        const photo = await r.json();
        return sendJson(res, 200, { photo: toPayload(photo) });
      } catch {
        return sendJson(res, 502, { error: "upstream_error" });
      }
    }

    const query = cleanQuery(url.searchParams.get("query"));
    if (query === null) return sendJson(res, 400, { error: "invalid_query" });

    if (!apiKey) {
      /* Same answer the PHP proxy gives when the secret file is missing, so the
         "no key configured" path is exercised identically in dev. */
      return sendJson(res, 503, { error: "unavailable" });
    }

    const upstream =
      "https://api.pexels.com/v1/search?" +
      new URLSearchParams({
        query,
        orientation: "landscape",
        per_page: "1",
        size: "medium",
      });

    try {
      const r = await fetch(upstream, {
        headers: { Authorization: apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      if (r.status === 429) {
        res.setHeader("Retry-After", "60");
        return sendJson(res, 429, { error: "rate_limited" });
      }
      if (!r.ok) return sendJson(res, 502, { error: "upstream_error" });

      const data = await r.json();
      const photo = (data.photos || [])[0];
      return sendJson(res, 200, { photo: photo ? toPayload(photo) : null });
    } catch {
      /* Network failure or timeout. The message is deliberately not forwarded —
         the browser only needs "no photo". */
      return sendJson(res, 502, { error: "upstream_error" });
    }
  };

  /* Braces, not a concise arrow body: `middlewares.use()` returns the connect
     app, and a value returned from configureServer is treated by Vite as a
     post-hook to invoke later — returning it crashes server startup. */
  return {
    name: "weathersphere-pexels-dev-proxy",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(handler);
    },
    /* `vite preview` serves dist/, which carries only the static
       public/api/pexels.php file (no PHP or Vercel runtime to execute it
       here) — wire the same middleware in so previewing a production build
       still shows photos. */
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

// The app has no client-side router (views are shown/hidden with JS, not
// URLs), so a relative base lets the same build work unmodified whether it's
// served from a domain root (current Hostinger deploy) or a GitHub Pages
// project path such as /site-meteo-tarbes/.
export default defineConfig(({ mode }) => {
  /* Loaded with an empty prefix so unprefixed variables are visible HERE, in
     the config, which runs in Node. This does NOT expose them to client code:
     what reaches import.meta.env is governed by `envPrefix` (default "VITE_"),
     which is left untouched. */
  const env = loadEnv(mode, process.cwd(), "");
  const pexelsKey = process.env.PEXELS_API_KEY ?? env.PEXELS_API_KEY ?? "";

  return {
    root: "src",
    base: "./",
    publicDir: "../public",
    envDir: "../",
    plugins: [pexelsDevProxy(pexelsKey)],
    build: {
      outDir: "../dist",
      emptyOutDir: true,
    },
    test: {
      environment: "node",
      include: ["js/**/*.test.js"],
    },
  };
});
