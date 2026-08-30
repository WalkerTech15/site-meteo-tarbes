<?php

/**
 * WeatherSphere — server-side Google Places proxy (Hostinger/Apache path).
 *
 * WHY THIS EXISTS
 * ---------------
 * The same reason as api/pexels.php, plus one: Places API (New) authenticates
 * with an `X-Goog-Api-Key` header, which a browser cannot send without
 * publishing the key, and every call is billed. So GOOGLE_PLACES_API_KEY never
 * reaches the browser — this file is the only thing that sees it.
 *
 * WHERE THE KEY LIVES
 * -------------------
 * NOT in this file, not anywhere under public_html, and not in the repository.
 * It shares the private secrets file the Pexels proxy already uses, one level
 * ABOVE the web root:
 *
 *     /home/<user>/private/weathersphere-secrets.php     <-- the real secrets
 *     /home/<user>/public_html/api/places.php            <-- this file
 *
 * See deploy/weathersphere-secrets.example.php for the template.
 *
 * TWO OPERATIONS, ONE ROUTE (identical to api/places.js and the Vite dev
 * middleware in vite.config.js — the frontend has exactly one code path)
 * ------------------------------------------------------------------------
 *   GET ?query=…[&lat=&lon=&lang=]  candidate lookup, metadata only
 *     200 {"places":[{id,name,address,lat,lon,types,mapsUri,photo:{…}}, …]}
 *     200 {"places":[]}
 *   GET ?photo=places/<id>/photos/<ref>[&w=]   resolve one signed image URI
 *     200 {"photo":{"src":"https://lh3.googleusercontent.com/…","width":n}}
 *     200 {"photo":null}
 *   400 {"error":"invalid_query"|"invalid_photo"}
 *   404 {"error":"not_found"}
 *   405 {"error":"method_not_allowed"}
 *   429 {"error":"rate_limited"}
 *   502 {"error":"upstream_error"}
 *   503 {"error":"unavailable"}        key missing/unreadable, or denied
 *
 * LICENSING / CACHING
 * -------------------
 * A resolved photo URI is a short-lived signed URL that Google's terms do not
 * permit persisting or re-publishing, so the photo response is always
 * `no-store`. Place METADATA is ordinary Places content and may be cached
 * briefly. The client keeps both in memory only, under its own TTLs, and
 * public/sw.js refuses to put either into Cache Storage.
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

/* Last line of defence: guarantee a generic JSON error whatever breaks, so a
   fatal can never answer with a bare 500 or a stack trace containing absolute
   paths. Mirrors api/pexels.php. */
set_exception_handler(static function (Throwable $e): void {
    error_log('WeatherSphere places proxy: ' . $e->getMessage());
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

const PLACES_SEARCH_ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';
const PLACES_MEDIA_BASE      = 'https://places.googleapis.com/v1/';
const QUERY_MIN_LENGTH       = 2;
const QUERY_MAX_LENGTH       = 120;
const CONNECT_TIMEOUT_S      = 4;
const TOTAL_TIMEOUT_S        = 8;
/* Mirrors PLACES_CANDIDATE_COUNT in vite.config.js and CANDIDATE_COUNT in
   api/places.js — the client ranks these itself (pickBestPlace in
   services/places-api.js) rather than trusting Google's first hit. */
const PLACES_CANDIDATE_COUNT = 5;
const PHOTO_MAX_WIDTH_PX     = 1280;

/* Places API (New) refuses a request with no field mask and bills per field
   group. Mirrors FIELD_MASK in the other two implementations. */
const PLACES_FIELD_MASK = 'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.googleMapsUri,places.photos';

/* Rate limiting: per client IP, sliding window. Tighter than the Pexels proxy's
   40/min because every Places call is billed. Fails open by design — on shared
   hosting a locked or unwritable temp directory must degrade to "no rate
   limiting", never to "the site stops working". */
const RATE_LIMIT_MAX_REQUESTS = 20;
const RATE_LIMIT_WINDOW_S     = 60;

/* ── UTF-8 helpers ─────────────────────────────────────────────────────────
 * mbstring is usually present on shared hosting but is NOT guaranteed, and a
 * call to a missing function is a fatal error. Everything below therefore
 * works with pcre (always compiled in) and only uses mbstring when available.
 */

function ws_is_utf8(string $value): bool
{
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
 * Emit a JSON response and stop. `$store` false forces `no-store` on a 200 —
 * used for the resolved photo URI, which no cache may retain.
 */
function respond(int $status, array $payload, bool $store = true): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    header($status === 200 && $store
        ? 'Cache-Control: public, max-age=600'
        : 'Cache-Control: no-store');
    /* No Access-Control-Allow-Origin on purpose: this endpoint is same-origin
       only. A permissive CORS header would let any site borrow the key — and
       the billing — through this proxy. */
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

/**
 * Load the Google Places key from the private config file outside the web
 * root, using the same resolution order as the Pexels proxy:
 *   1. WEATHERSPHERE_SECRETS  — absolute path, set via SetEnv / panel env var
 *   2. <document root>/../private/weathersphere-secrets.php
 *   3. <this file>/../../../private/weathersphere-secrets.php
 * Returns null — never throws, never reveals which path was tried.
 */
function load_places_key(): ?string
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
        $config = @include $path;
        if (!is_array($config)) {
            continue;
        }
        $key = $config['google_places_api_key'] ?? null;
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

    $dir = sys_get_temp_dir() . '/weathersphere-rl-places';
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

    $raw    = stream_get_contents($handle) ?: '';
    $stamps = json_decode($raw, true);
    if (!is_array($stamps)) {
        $stamps = [];
    }

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
 * Validate the free-text query. Returns the cleaned query or null.
 */
function clean_query(mixed $raw): ?string
{
    if (!is_string($raw) || !ws_is_utf8($raw)) {
        return null;
    }
    /* Reject C0/C1 control characters outright rather than stripping them —
       a query containing them is malformed, not merely untidy. */
    if (preg_match('/[\x00-\x1F\x7F-\x9F]/u', $raw) === 1) {
        return null;
    }
    $query  = trim(preg_replace('/\s+/u', ' ', $raw) ?? '');
    $length = ws_strlen($query);
    if ($length < QUERY_MIN_LENGTH || $length > QUERY_MAX_LENGTH) {
        return null;
    }

    return $query;
}

/**
 * A photo resource name is `places/<place id>/photos/<reference>`, both halves
 * base64url. Validating the WHOLE shape — rather than interpolating whatever
 * arrived — is what stops this route being used to reach an arbitrary Google
 * API path.
 */
function is_photo_name(mixed $raw): bool
{
    return is_string($raw)
        && preg_match('#^places/[A-Za-z0-9_-]{1,255}/photos/[A-Za-z0-9_-]{1,1024}$#', $raw) === 1;
}

/** The resolved URI is handed to the browser as an <img> src — Google CDN only. */
function is_google_photo_uri(mixed $raw): bool
{
    return is_string($raw)
        && preg_match('#^https://[a-z0-9-]+(\.[a-z0-9-]+)*\.(googleusercontent\.com|ggpht\.com)/#i', $raw) === 1;
}

function https_only(mixed $value): string
{
    return is_string($value) && str_starts_with($value, 'https://') ? ws_substr($value, 512) : '';
}

function finite_or_null(mixed $value, float $limit): ?float
{
    if (!is_int($value) && !is_float($value) && !(is_string($value) && is_numeric($value))) {
        return null;
    }
    $n = (float) $value;

    return is_finite($n) && abs($n) <= $limit ? $n : null;
}

/**
 * HTTP request helper. Returns [status, decodedBody|null]. Uses cURL when
 * available and falls back to a stream context, because shared hosts vary in
 * which of the two is enabled.
 *
 * The key travels in a header, never in the URL — query strings end up in
 * access logs, proxies and Referer headers.
 */
function ws_http(string $method, string $url, array $headers, ?string $body): array
{
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        $opts = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_CONNECTTIMEOUT => CONNECT_TIMEOUT_S,
            CURLOPT_TIMEOUT        => TOTAL_TIMEOUT_S,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_USERAGENT      => 'WeatherSphere/1.0',
        ];
        if ($method === 'POST') {
            $opts[CURLOPT_POST]       = true;
            $opts[CURLOPT_POSTFIELDS] = (string) $body;
        }
        curl_setopt_array($ch, $opts);
        $raw    = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        if ($raw === false || $status === 0) {
            return [0, null];
        }

        return [$status, json_decode((string) $raw, true)];
    }

    /* No cURL and no HTTPS stream wrapper (openssl missing) means this host
       simply cannot make the call. Report it as an upstream failure — the app
       falls back to another provider — instead of fataling. */
    if (!in_array('https', stream_get_wrappers(), true)) {
        error_log('WeatherSphere: neither cURL nor an https stream wrapper is available.');

        return [0, null];
    }

    $http = [
        'method'          => $method,
        'header'          => implode("\r\n", $headers),
        'timeout'         => TOTAL_TIMEOUT_S,
        'ignore_errors'   => true,
        'follow_location' => 0,
    ];
    if ($body !== null) {
        $http['content'] = $body;
    }
    $context = stream_context_create([
        'http' => $http,
        'ssl'  => ['verify_peer' => true, 'verify_peer_name' => true],
    ]);
    $raw = @file_get_contents($url, false, $context);
    if ($raw === false) {
        return [0, null];
    }

    $status = 0;
    foreach ($http_response_header ?? [] as $line) {
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $m) === 1) {
            $status = (int) $m[1];
        }
    }

    return [$status, json_decode((string) $raw, true)];
}

/**
 * Re-projection: only these fields ever reach the browser. A place with no
 * usable, ATTRIBUTABLE photo is dropped — Google requires the contributor
 * attribution to be displayed, so a photo we could not credit is one we must
 * not show.
 */
function to_place_payload(mixed $place): ?array
{
    if (!is_array($place)) {
        return null;
    }
    $name = is_string($place['displayName']['text'] ?? null)
        ? ws_substr($place['displayName']['text'], 160)
        : '';
    if ($name === '') {
        return null;
    }

    $raw = (is_array($place['photos'] ?? null) ? $place['photos'] : [])[0] ?? null;
    if (!is_array($raw) || !is_photo_name($raw['name'] ?? null)) {
        return null;
    }

    $attributions = [];
    foreach (array_slice(is_array($raw['authorAttributions'] ?? null) ? $raw['authorAttributions'] : [], 0, 3) as $a) {
        $author = is_array($a) && is_string($a['displayName'] ?? null) ? ws_substr($a['displayName'], 120) : '';
        if ($author === '') {
            continue;
        }
        $attributions[] = ['name' => $author, 'uri' => https_only($a['uri'] ?? null)];
    }
    if ($attributions === []) {
        return null;
    }

    $types = [];
    foreach (array_slice(is_array($place['types'] ?? null) ? $place['types'] : [], 0, 12) as $t) {
        if (is_string($t)) {
            $types[] = $t;
        }
    }

    return [
        'id'      => is_string($place['id'] ?? null) ? ws_substr($place['id'], 255) : '',
        'name'    => $name,
        'address' => is_string($place['formattedAddress'] ?? null) ? ws_substr($place['formattedAddress'], 240) : '',
        'lat'     => finite_or_null($place['location']['latitude'] ?? null, 90.0),
        'lon'     => finite_or_null($place['location']['longitude'] ?? null, 180.0),
        'types'   => $types,
        'mapsUri' => https_only($place['googleMapsUri'] ?? null),
        'photo'   => [
            'ref'          => $raw['name'],
            'width'        => (int) (finite_or_null($raw['widthPx'] ?? null, 100000.0) ?? 0),
            'height'       => (int) (finite_or_null($raw['heightPx'] ?? null, 100000.0) ?? 0),
            'attributions' => $attributions,
        ],
    ];
}

/* ── Request handling ──────────────────────────────────────────────────── */

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    header('Allow: GET');
    respond(405, ['error' => 'method_not_allowed']);
}

if (rate_limit_exceeded()) {
    header('Retry-After: 60');
    respond(429, ['error' => 'rate_limited']);
}

$apiKey = load_places_key();

/* ── The RESOLVE step: one photo reference → its short-lived signed URI ── */
$photoParam = $_GET['photo'] ?? null;
if ($photoParam !== null) {
    if (!is_photo_name($photoParam)) {
        respond(400, ['error' => 'invalid_photo']);
    }
    if ($apiKey === null) {
        error_log('WeatherSphere: Google Places secret missing or unreadable.');
        respond(503, ['error' => 'unavailable']);
    }

    $asked      = finite_or_null($_GET['w'] ?? null, 4800.0);
    $maxWidthPx = ($asked !== null && $asked >= 200) ? (int) round($asked) : PHOTO_MAX_WIDTH_PX;

    /* skipHttpRedirect returns JSON with the signed URI instead of a 302 to
       it, so the key stays on this side and the browser loads the image
       directly from Google's CDN with no credential involved. */
    $url = PLACES_MEDIA_BASE . $photoParam . '/media?' . http_build_query([
        'maxWidthPx'       => $maxWidthPx,
        'skipHttpRedirect' => 'true',
    ], '', '&', PHP_QUERY_RFC3986);

    [$status, $data] = ws_http('GET', $url, ['X-Goog-Api-Key: ' . $apiKey, 'Accept: application/json'], null);

    if ($status === 404) {
        respond(404, ['error' => 'not_found']);
    }
    if ($status === 429) {
        header('Retry-After: 60');
        respond(429, ['error' => 'rate_limited']);
    }
    if ($status !== 200 || !is_array($data)) {
        respond(502, ['error' => 'upstream_error']);
    }
    if (!is_google_photo_uri($data['photoUri'] ?? null)) {
        respond(200, ['photo' => null], false);
    }

    respond(200, ['photo' => ['src' => $data['photoUri'], 'width' => $maxWidthPx]], false);
}

/* ── The CANDIDATE step: text search → place metadata ──────────────────── */
$query = clean_query($_GET['query'] ?? null);
if ($query === null) {
    respond(400, ['error' => 'invalid_query']);
}
if ($apiKey === null) {
    error_log('WeatherSphere: Google Places secret missing or unreadable.');
    respond(503, ['error' => 'unavailable']);
}

$body = [
    'textQuery'      => $query,
    'maxResultCount' => PLACES_CANDIDATE_COUNT,
    'languageCode'   => (($_GET['lang'] ?? '') === 'fr') ? 'fr' : 'en',
];
/* A bias, not a restriction: the geocoder's coordinate is authoritative for
   WHERE the place is, but Google may legitimately place a city's own entry a
   few km from another provider's centroid. */
$lat = finite_or_null($_GET['lat'] ?? null, 90.0);
$lon = finite_or_null($_GET['lon'] ?? null, 180.0);
if ($lat !== null && $lon !== null) {
    $body['locationBias'] = ['circle' => [
        'center' => ['latitude' => $lat, 'longitude' => $lon],
        'radius' => 50000,
    ]];
}

[$status, $data] = ws_http(
    'POST',
    PLACES_SEARCH_ENDPOINT,
    [
        'Content-Type: application/json',
        'Accept: application/json',
        'X-Goog-Api-Key: ' . $apiKey,
        'X-Goog-FieldMask: ' . PLACES_FIELD_MASK,
    ],
    json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) ?: '{}'
);

if ($status === 429) {
    header('Retry-After: 60');
    respond(429, ['error' => 'rate_limited']);
}
/* A denied/absent/over-quota key is a configuration problem, not a broken
   request — same answer as "no key", so the app just uses another provider
   instead of retrying a call that cannot succeed. */
if ($status === 403) {
    respond(503, ['error' => 'unavailable']);
}
if ($status !== 200 || !is_array($data)) {
    respond(502, ['error' => 'upstream_error']);
}

$places = [];
foreach (is_array($data['places'] ?? null) ? $data['places'] : [] as $place) {
    $payload = to_place_payload($place);
    if ($payload !== null) {
        $places[] = $payload;
    }
}

respond(200, ['places' => $places]);
