<?php

/**
 * WeatherSphere — server-side Mapillary proxy (Hostinger/Apache path).
 *
 * WHY THIS EXISTS
 * ---------------
 * Same reason as api/pexels.php and api/places.php: a Mapillary access token
 * (`MLY|<app id>|<secret>`) is a credential that cannot be origin-restricted,
 * so it never reaches the browser. This file is the only thing that sees it.
 *
 * WHERE THE TOKEN LIVES
 * ---------------------
 * NOT in this file, not anywhere under public_html, and not in the repository.
 * It shares the private secrets file the other two proxies already use, one
 * level ABOVE the web root:
 *
 *     /home/<user>/private/weathersphere-secrets.php   <-- the real secrets
 *     /home/<user>/public_html/api/mapillary.php       <-- this file
 *
 * WHAT IT IS FOR
 * --------------
 * Geotagged street-level imagery: the only provider with any coverage of the
 * villages and small towns Google, Wikimedia and Pexels have never
 * photographed. The client always labels its results as NEARBY photos, never
 * as photos of the place itself (see services/mapillary-api.js).
 *
 * KartaView is deliberately NOT used anywhere in this project. Mapillary is
 * the only street-level provider configured.
 *
 * LICENSING
 * ---------
 * Mapillary imagery is CC BY-SA 4.0. The contributor's username and the
 * licence must be displayed with the image, and an image that cannot be
 * attributed is dropped here rather than shown uncredited. The thumbnail URLs
 * are SIGNED and EXPIRE, so this response is never cached by a shared cache
 * and public/sw.js refuses to put them in Cache Storage.
 *
 * RESPONSE CONTRACT (shared with api/mapillary.js and the Vite dev middleware)
 * ---------------------------------------------------------------------------
 *   GET ?lat=&lon=&radius=
 *   200 {"images":[{id,src,width,height,lat,lon,capturedAt,isPano,creator,link}]}
 *   200 {"images":[]}
 *   400 {"error":"invalid_coordinates"}
 *   405 {"error":"method_not_allowed"}
 *   429 {"error":"rate_limited"}
 *   502 {"error":"upstream_error"}
 *   503 {"error":"unavailable"}
 *
 * The body never contains upstream headers, credentials, file paths, or PHP
 * diagnostics.
 */

declare(strict_types=1);

ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

/* Guarantee a generic JSON error whatever breaks, so a fatal can never answer
   with a bare 500 or a stack trace containing absolute paths. */
set_exception_handler(static function (Throwable $e): void {
    error_log('WeatherSphere mapillary proxy: ' . $e->getMessage());
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

const MAPILLARY_GRAPH_ENDPOINT = 'https://graph.mapillary.com/images';
/* Mirrors FIELDS in api/mapillary.js and vite.config.js. */
const MAPILLARY_FIELDS = 'id,thumb_1024_url,captured_at,is_pano,geometry,creator,width,height';
const MAPILLARY_CANDIDATE_COUNT = 12;
const MAPILLARY_MIN_RADIUS_M = 100;
const MAPILLARY_MAX_RADIUS_M = 2000;
const MAPILLARY_DEFAULT_RADIUS_M = 800;
const CONNECT_TIMEOUT_S = 4;
const TOTAL_TIMEOUT_S = 8;

/* Street-level lookups are cheap but not free, and Mapillary rate-limits per
   token. Fails open by design — an unwritable temp directory must degrade to
   "no rate limiting", never to "the site stops working". */
const RATE_LIMIT_MAX_REQUESTS = 30;
const RATE_LIMIT_WINDOW_S = 60;

function respond(int $status, array $payload): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    /* Signed, expiring image URLs — briefly reusable, never by a shared cache. */
    header($status === 200 ? 'Cache-Control: private, max-age=300' : 'Cache-Control: no-store');
    /* No Access-Control-Allow-Origin on purpose: same-origin only. */
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

/**
 * Load the Mapillary token from the private config file outside the web root,
 * using the same resolution order as the other two proxies.
 */
function load_mapillary_token(): ?string
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
        $token = $config['mapillary_access_token'] ?? null;
        if (is_string($token) && trim($token) !== '' && trim($token) !== 'REPLACE_ON_SERVER') {
            return trim($token);
        }
    }

    return null;
}

function rate_limit_exceeded(): bool
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    if (!is_string($ip) || $ip === '') {
        return false;
    }

    $dir = sys_get_temp_dir() . '/weathersphere-rl-mapillary';
    if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) {
        return false;
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

function finite_or_null(mixed $value, float $limit): ?float
{
    if (!is_int($value) && !is_float($value) && !(is_string($value) && is_numeric($value))) {
        return null;
    }
    $n = (float) $value;

    return is_finite($n) && abs($n) <= $limit ? $n : null;
}

/** Metres → a degree bounding box, clamped so a polar location cannot blow up. */
function mapillary_bbox(float $lat, float $lon, float $radiusM): string
{
    $dLat = $radiusM / 111320;
    $dLon = $radiusM / (111320 * max(0.05, cos(deg2rad($lat))));

    return implode(',', [
        number_format($lon - $dLon, 6, '.', ''),
        number_format($lat - $dLat, 6, '.', ''),
        number_format($lon + $dLon, 6, '.', ''),
        number_format($lat + $dLat, 6, '.', ''),
    ]);
}

/** Mapillary serves thumbnails from Meta's CDN — allow only those hosts. */
function is_mapillary_thumb(mixed $raw): bool
{
    return is_string($raw)
        && preg_match('#^https://[a-z0-9._-]+\.(mapillary\.com|fbcdn\.net|facebook\.com)/#i', $raw) === 1;
}

/**
 * Re-projection: only these fields ever reach the browser. An image with no
 * usable thumbnail, no coordinate or no named contributor is dropped —
 * CC BY-SA requires the attribution, so an uncreditable image must not show.
 */
function to_image_payload(mixed $image): ?array
{
    if (!is_array($image)) {
        return null;
    }
    $src = $image['thumb_1024_url'] ?? null;
    if (!is_mapillary_thumb($src)) {
        return null;
    }

    $coords = $image['geometry']['coordinates'] ?? null;
    if (!is_array($coords) || count($coords) < 2) {
        return null;
    }
    $lon = finite_or_null($coords[0], 180.0);
    $lat = finite_or_null($coords[1], 90.0);
    if ($lat === null || $lon === null) {
        return null;
    }

    $creator = is_string($image['creator']['username'] ?? null)
        ? substr($image['creator']['username'], 0, 120)
        : '';
    if ($creator === '') {
        return null;
    }

    $id = (string) ($image['id'] ?? '');
    if (preg_match('/^[0-9]{1,64}$/', $id) !== 1) {
        return null;
    }

    return [
        'id'         => $id,
        'src'        => substr($src, 0, 2048),
        'width'      => (int) (finite_or_null($image['width'] ?? null, 100000.0) ?? 0),
        'height'     => (int) (finite_or_null($image['height'] ?? null, 100000.0) ?? 0),
        'lat'        => $lat,
        'lon'        => $lon,
        'capturedAt' => (float) (finite_or_null($image['captured_at'] ?? null, 1e15) ?? 0),
        'isPano'     => ($image['is_pano'] ?? null) === true,
        'creator'    => $creator,
        'link'       => 'https://www.mapillary.com/app/?pKey=' . $id . '&focus=photo',
    ];
}

/**
 * HTTP GET helper. Returns [status, decodedBody|null]. cURL when available,
 * a stream context otherwise, because shared hosts vary in which is enabled.
 * The token travels in a header, never in the URL.
 */
function ws_http_get(string $url, array $headers): array
{
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
        $raw    = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        if ($raw === false || $status === 0) {
            return [0, null];
        }

        return [$status, json_decode((string) $raw, true)];
    }

    if (!in_array('https', stream_get_wrappers(), true)) {
        error_log('WeatherSphere: neither cURL nor an https stream wrapper is available.');

        return [0, null];
    }

    $context = stream_context_create([
        'http' => [
            'method'          => 'GET',
            'header'          => implode("\r\n", $headers),
            'timeout'         => TOTAL_TIMEOUT_S,
            'ignore_errors'   => true,
            'follow_location' => 0,
        ],
        'ssl' => ['verify_peer' => true, 'verify_peer_name' => true],
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

/* ── Request handling ──────────────────────────────────────────────────── */

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    header('Allow: GET');
    respond(405, ['error' => 'method_not_allowed']);
}

if (rate_limit_exceeded()) {
    header('Retry-After: 60');
    respond(429, ['error' => 'rate_limited']);
}

$lat = finite_or_null($_GET['lat'] ?? null, 90.0);
$lon = finite_or_null($_GET['lon'] ?? null, 180.0);
if ($lat === null || $lon === null) {
    respond(400, ['error' => 'invalid_coordinates']);
}

$token = load_mapillary_token();
if ($token === null) {
    error_log('WeatherSphere: Mapillary token missing or unreadable.');
    respond(503, ['error' => 'unavailable']);
}

$asked  = finite_or_null($_GET['radius'] ?? null, (float) MAPILLARY_MAX_RADIUS_M);
$radius = min(
    (float) MAPILLARY_MAX_RADIUS_M,
    max((float) MAPILLARY_MIN_RADIUS_M, $asked ?? (float) MAPILLARY_DEFAULT_RADIUS_M)
);

$url = MAPILLARY_GRAPH_ENDPOINT . '?' . http_build_query([
    'fields' => MAPILLARY_FIELDS,
    'bbox'   => mapillary_bbox($lat, $lon, $radius),
    'limit'  => MAPILLARY_CANDIDATE_COUNT,
], '', '&', PHP_QUERY_RFC3986);

[$status, $data] = ws_http_get($url, ['Authorization: OAuth ' . $token, 'Accept: application/json']);

if ($status === 429) {
    header('Retry-After: 60');
    respond(429, ['error' => 'rate_limited']);
}
/* A denied/absent/over-quota token is a configuration problem, not a broken
   request — same answer as "no token", so the client stops asking. */
if ($status === 401 || $status === 403) {
    respond(503, ['error' => 'unavailable']);
}
if ($status !== 200 || !is_array($data)) {
    respond(502, ['error' => 'upstream_error']);
}

$images = [];
foreach (is_array($data['data'] ?? null) ? $data['data'] : [] as $image) {
    $payload = to_image_payload($image);
    if ($payload !== null) {
        $images[] = $payload;
    }
}

respond(200, ['images' => $images]);
