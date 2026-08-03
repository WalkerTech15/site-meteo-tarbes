<?php

/**
 * WeatherSphere — server-side Pexels proxy.
 *
 * WHY THIS EXISTS
 * ---------------
 * Anything Vite exposes to the browser (every VITE_-prefixed variable) is
 * compiled into the JavaScript bundle and is therefore public. MapTiler is fine
 * with that because a MapTiler key can be locked to a list of allowed origins.
 * Pexels offers no such restriction, so a Pexels key shipped to the browser is
 * simply a published credential. This endpoint keeps the key on the server: the
 * browser asks *this* file for a photo, and only this file ever sees the key.
 *
 * WHERE THE KEY LIVES
 * -------------------
 * NOT in this file, not anywhere under public_html, and not in the repository.
 * It is read from a PHP file stored one level ABOVE the web root, e.g.:
 *
 *     /home/<user>/private/weathersphere-secrets.php     <-- the real secret
 *     /home/<user>/public_html/api/pexels.php            <-- this file
 *
 * See deploy/weathersphere-secrets.example.php for the template, and the
 * "Deploying to Hostinger" section of README.md for the exact steps.
 *
 * RESPONSE CONTRACT (shared with the Vite dev middleware in vite.config.js)
 * ------------------------------------------------------------------------
 *   200 {"photo": {"src": {...}, "photographer": "...", "link": "...", "alt": "..."}}
 *   200 {"photo": null}                  no match for this query
 *   400 {"error": "invalid_query"}
 *   405 {"error": "method_not_allowed"}
 *   429 {"error": "rate_limited"}
 *   502 {"error": "upstream_error"}      Pexels unreachable / malformed / failed
 *   503 {"error": "unavailable"}         secret missing or unreadable
 *
 * The body never contains upstream headers, credentials, file paths, or PHP
 * diagnostics — the frontend only needs to know "photo, or no photo".
 */

declare(strict_types=1);

/* Never let a warning or notice leak a path into the JSON body. Errors still
   reach the server log, which is where they belong. */
ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

/* Last line of defence. display_errors=0 blanks the body of a fatal, but the
   browser would still get a bare 500 with no JSON — and on a host that
   overrides display_errors it could get a stack trace with absolute paths.
   These two handlers guarantee a generic JSON error instead, whatever breaks
   (a missing extension, an out-of-memory, a PHP version quirk). */
set_exception_handler(static function (Throwable $e): void {
    error_log('WeatherSphere pexels proxy: ' . $e->getMessage());
    if (!headers_sent()) {
        http_response_code(502);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
    }
    echo '{"error":"upstream_error"}';
});
register_shutdown_function(static function (): void {
    $error = error_get_last();
    if ($error === null || !in_array($error['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        return;
    }
    if (!headers_sent()) {
        http_response_code(502);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
    }
    echo '{"error":"upstream_error"}';
});

const PEXELS_ENDPOINT   = 'https://api.pexels.com/v1/search';
const QUERY_MIN_LENGTH  = 2;
const QUERY_MAX_LENGTH  = 120;
const CONNECT_TIMEOUT_S = 4;
const TOTAL_TIMEOUT_S   = 8;

/* Rate limiting: per client IP, sliding window. Deliberately conservative and
   fail-open — on shared hosting a locked or unwritable temp directory must
   degrade to "no rate limiting", never to "the site stops working". */
const RATE_LIMIT_MAX_REQUESTS = 40;
const RATE_LIMIT_WINDOW_S     = 60;

/* ── UTF-8 helpers ─────────────────────────────────────────────────────────
 * mbstring is usually present on shared hosting but is NOT guaranteed, and a
 * call to a missing function is a fatal error — which would answer the browser
 * with a 500 and a stack trace. Everything below therefore works with pcre
 * (always compiled in) and only uses mbstring when it happens to be available.
 */

function ws_is_utf8(string $value): bool
{
    /* An empty pattern with the /u modifier fails outright on invalid UTF-8,
       which makes it a dependency-free encoding check. */
    return preg_match('//u', $value) === 1;
}

function ws_strlen(string $value): int
{
    if (function_exists('mb_strlen')) {
        return mb_strlen($value, 'UTF-8');
    }

    return preg_match_all('/./us', $value) ?: 0;
}

function ws_substr(string $value, int $length): string
{
    if (function_exists('mb_substr')) {
        return mb_substr($value, 0, $length, 'UTF-8');
    }
    if (preg_match('/^.{0,' . $length . '}/us', $value, $m) === 1) {
        return $m[0];
    }

    return '';
}

/**
 * Emit a JSON response and stop. Kept in one place so every exit path gets the
 * same headers and nothing can accidentally fall through to more output.
 */
function respond(int $status, array $payload): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    /* A successful photo lookup is safe to reuse briefly (the same location is
       re-requested on every view switch); anything else must not be cached. */
    header($status === 200
        ? 'Cache-Control: public, max-age=600'
        : 'Cache-Control: no-store');
    /* No Access-Control-Allow-Origin on purpose: this endpoint is same-origin
       only. Adding a permissive CORS header would let any site borrow the key
       through this proxy. */
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

/**
 * Load the Pexels key from the private config file outside the web root.
 *
 * Resolution order:
 *   1. WEATHERSPHERE_SECRETS  — absolute path, set via SetEnv / panel env var
 *   2. <document root>/../private/weathersphere-secrets.php   (the documented default)
 *   3. <this file>/../../../private/weathersphere-secrets.php (fallback when
 *      DOCUMENT_ROOT is unreliable, e.g. some CGI setups)
 *
 * Returns null — never throws, never reveals which path was tried.
 */
function load_pexels_key(): ?string
{
    $candidates = [];

    $fromEnv = getenv('WEATHERSPHERE_SECRETS');
    if (is_string($fromEnv) && $fromEnv !== '') {
        $candidates[] = $fromEnv;
    }

    $docRoot = $_SERVER['DOCUMENT_ROOT'] ?? '';
    if (is_string($docRoot) && $docRoot !== '') {
        $candidates[] = rtrim($docRoot, '/\\') . '/../private/weathersphere-secrets.php';
    }

    $candidates[] = __DIR__ . '/../../private/weathersphere-secrets.php';

    foreach ($candidates as $path) {
        if (!is_string($path) || $path === '' || !is_file($path) || !is_readable($path)) {
            continue;
        }
        /* include, not file_get_contents: the file returns an array, so its
           contents never pass through a string that could be echoed. */
        $config = @include $path;
        if (!is_array($config)) {
            continue;
        }
        $key = $config['pexels_api_key'] ?? null;
        if (is_string($key) && trim($key) !== '' && trim($key) !== 'REPLACE_ON_SERVER') {
            return trim($key);
        }
    }

    return null;
}

/**
 * Sliding-window rate limit, one small JSON file per client IP in the system
 * temp directory. Fails open by design (see the constants above).
 */
function rate_limit_exceeded(): bool
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    if (!is_string($ip) || $ip === '') {
        return false;
    }

    $dir = sys_get_temp_dir() . '/weathersphere-rl';
    if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) {
        return false; // can't track → don't block
    }

    $file = $dir . '/' . hash('sha256', $ip) . '.json';
    $now  = time();

    $handle = @fopen($file, 'c+');
    if ($handle === false) {
        return false;
    }
    if (!@flock($handle, LOCK_EX)) {
        fclose($handle);
        return false;
    }

    $raw   = stream_get_contents($handle) ?: '';
    $stamps = json_decode($raw, true);
    if (!is_array($stamps)) {
        $stamps = [];
    }

    /* drop everything older than the window, then decide */
    $stamps = array_values(array_filter(
        $stamps,
        static fn($t): bool => is_int($t) && ($now - $t) < RATE_LIMIT_WINDOW_S
    ));

    $exceeded = count($stamps) >= RATE_LIMIT_MAX_REQUESTS;
    if (!$exceeded) {
        $stamps[] = $now;
    }

    ftruncate($handle, 0);
    rewind($handle);
    fwrite($handle, json_encode($stamps));
    fflush($handle);
    flock($handle, LOCK_UN);
    fclose($handle);

    return $exceeded;
}

/**
 * Validate the only accepted parameter. Returns the cleaned query or null.
 */
function clean_query(mixed $raw): ?string
{
    if (!is_string($raw)) {
        return null;
    }
    if (!ws_is_utf8($raw)) {
        return null;
    }
    /* Reject C0/C1 control characters outright rather than stripping them —
       a query containing them is malformed, not merely untidy. */
    if (preg_match('/[\x00-\x1F\x7F-\x9F]/u', $raw) === 1) {
        return null;
    }
    $query = trim(preg_replace('/\s+/u', ' ', $raw) ?? '');
    $length = ws_strlen($query);
    if ($length < QUERY_MIN_LENGTH || $length > QUERY_MAX_LENGTH) {
        return null;
    }

    return $query;
}

/**
 * Call Pexels. Returns [status, decodedBody|null].
 * Uses cURL when available and falls back to a stream context, because shared
 * hosts vary in which of the two is enabled.
 */
function fetch_from_pexels(string $query, string $apiKey): array
{
    $url = PEXELS_ENDPOINT . '?' . http_build_query([
        'query'       => $query,
        'orientation' => 'landscape',
        'per_page'    => 1,
        'size'        => 'medium',
    ], '', '&', PHP_QUERY_RFC3986);

    /* The key travels in the Authorization header, never in the URL — query
       strings end up in access logs, proxies and Referer headers. */
    $headers = ['Authorization: ' . $apiKey, 'Accept: application/json'];

    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_CONNECTTIMEOUT => CONNECT_TIMEOUT_S,
            CURLOPT_TIMEOUT        => TOTAL_TIMEOUT_S,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_USERAGENT      => 'WeatherSphere/1.0',
        ]);
        $body   = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        if ($body === false || $status === 0) {
            return [0, null];
        }

        return [$status, json_decode((string) $body, true)];
    }

    /* No cURL and no HTTPS stream wrapper (openssl missing) means this host
       simply cannot make the call. Report it as an upstream failure — the app
       falls back to its gradient visuals — instead of fataling. */
    if (!in_array('https', stream_get_wrappers(), true)) {
        error_log('WeatherSphere: neither cURL nor an https stream wrapper is available.');

        return [0, null];
    }

    $context = stream_context_create([
        'http' => [
            'method'        => 'GET',
            'header'        => implode("\r\n", $headers),
            'timeout'       => TOTAL_TIMEOUT_S,
            'ignore_errors' => true,
            'follow_location' => 0,
        ],
        'ssl' => ['verify_peer' => true, 'verify_peer_name' => true],
    ]);
    $body = @file_get_contents($url, false, $context);
    if ($body === false) {
        return [0, null];
    }

    $status = 0;
    foreach ($http_response_header ?? [] as $line) {
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $m) === 1) {
            $status = (int) $m[1];
        }
    }

    return [$status, json_decode($body, true)];
}

/* ── Request handling ──────────────────────────────────────────────────── */

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    header('Allow: GET');
    respond(405, ['error' => 'method_not_allowed']);
}

$query = clean_query($_GET['query'] ?? null);
if ($query === null) {
    respond(400, ['error' => 'invalid_query']);
}

if (rate_limit_exceeded()) {
    header('Retry-After: ' . RATE_LIMIT_WINDOW_S);
    respond(429, ['error' => 'rate_limited']);
}

$apiKey = load_pexels_key();
if ($apiKey === null) {
    error_log('WeatherSphere: Pexels secret file missing or unreadable.');
    respond(503, ['error' => 'unavailable']);
}

[$status, $data] = fetch_from_pexels($query, $apiKey);

if ($status === 429) {
    header('Retry-After: ' . RATE_LIMIT_WINDOW_S);
    respond(429, ['error' => 'rate_limited']);
}
if ($status !== 200 || !is_array($data)) {
    respond(502, ['error' => 'upstream_error']);
}

$photo = $data['photos'][0] ?? null;
if (!is_array($photo)) {
    respond(200, ['photo' => null]); // valid query, simply no match
}

/* Re-project onto our own shape. Only these fields cross back to the browser;
   everything else Pexels returns (ids, avg colours, upstream URLs we don't use)
   is dropped rather than forwarded blindly. */
$src = is_array($photo['src'] ?? null) ? $photo['src'] : [];
$pick = static function (array $src, string $key): ?string {
    $value = $src[$key] ?? null;

    return is_string($value) && str_starts_with($value, 'https://') ? $value : null;
};

$sizes = array_filter([
    'medium'  => $pick($src, 'medium'),
    'large'   => $pick($src, 'large'),
    'large2x' => $pick($src, 'large2x'),
], static fn(?string $v): bool => $v !== null);

if ($sizes === []) {
    respond(200, ['photo' => null]);
}

$link = $photo['url'] ?? '';
respond(200, [
    'photo' => [
        'src'          => $sizes,
        'photographer' => is_string($photo['photographer'] ?? null)
            ? ws_substr($photo['photographer'], 120)
            : '',
        'link'         => is_string($link) && str_starts_with($link, 'https://www.pexels.com/')
            ? $link
            : '',
        'alt'          => is_string($photo['alt'] ?? null)
            ? ws_substr($photo['alt'], 200)
            : '',
    ],
]);
