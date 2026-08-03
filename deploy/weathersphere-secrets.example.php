<?php

/**
 * TEMPLATE ONLY — this file contains no real credentials and never should.
 *
 * ── What to do with it ────────────────────────────────────────────────────
 * 1. Copy this file to your Hostinger account, OUTSIDE the web root:
 *
 *        /home/<your-user>/private/weathersphere-secrets.php
 *
 *    NOT /home/<your-user>/public_html/... — anything under public_html can be
 *    requested over HTTP. `private/` sits next to public_html, one level up,
 *    where the web server will not serve it but PHP can still read it.
 *
 * 2. Replace the placeholder below with your real Pexels key.
 * 3. Set the file permissions to 600 (owner read/write only).
 * 4. Never copy the edited file back into this repository. The real filename
 *    (weathersphere-secrets.php) is gitignored precisely so an accidental copy
 *    cannot be committed.
 *
 * ── Resulting layout ──────────────────────────────────────────────────────
 *     /home/<user>/private/weathersphere-secrets.php   <- the real key (600)
 *     /home/<user>/public_html/api/pexels.php          <- reads the file above
 *     /home/<user>/public_html/index.html              <- the built app
 *
 * public/api/pexels.php finds this file by looking at, in order:
 *   1. the WEATHERSPHERE_SECRETS environment variable (absolute path), then
 *   2. <DOCUMENT_ROOT>/../private/weathersphere-secrets.php, then
 *   3. a path relative to the proxy itself.
 * If none of them yields a usable key the proxy answers 503 and the app simply
 * falls back to its gradient/emoji visuals — it never breaks.
 *
 * Get a key at https://www.pexels.com/api/ (free, no card required).
 */

return [
    'pexels_api_key' => 'REPLACE_ON_SERVER',
];
