<?php
declare(strict_types=1);

ini_set('display_errors', '0');
ini_set('session.use_strict_mode', '1');
ini_set('session.use_only_cookies', '1');
ini_set('session.use_trans_sid', '0');

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, private');
header('X-Content-Type-Options: nosniff');

function respond(int $status, array $body): never
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_SLASHES);
    exit;
}

if (strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? '')) !== 'POST') {
    respond(405, ['error' => 'method_not_allowed']);
}

$host = strtolower((string) ($_SERVER['HTTP_HOST'] ?? ''));
$originHost = strtolower((string) parse_url((string) ($_SERVER['HTTP_ORIGIN'] ?? ''), PHP_URL_HOST));
if ($host === '' || $originHost !== preg_replace('/:\d+$/', '', $host)) {
    respond(403, ['error' => 'same_origin_required']);
}

$secure = (
    isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== '' && strtolower((string) $_SERVER['HTTPS']) !== 'off'
) || (
    isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && strtolower((string) $_SERVER['HTTP_X_FORWARDED_PROTO']) === 'https'
);
session_name('auracare_admin');
session_set_cookie_params([
    'lifetime' => 0,
    'path' => '/',
    'secure' => $secure,
    'httponly' => true,
    'samesite' => 'Strict',
]);
if (!session_start()) {
    respond(503, ['error' => 'session_unavailable']);
}

$lastActivity = $_SESSION['last_activity'] ?? 0;
if (($_SESSION['admin_role'] ?? '') !== 'admin'
    || !is_string($_SESSION['admin_email'] ?? null)
    || !is_int($lastActivity)
    || $lastActivity < time() - 28800) {
    respond(403, ['error' => 'admin_required']);
}

if (!function_exists('opcache_invalidate')) {
    respond(503, ['error' => 'opcache_unavailable']);
}
$scriptPath = realpath(__DIR__ . DIRECTORY_SEPARATOR . 'data.php');
if ($scriptPath === false || !opcache_invalidate($scriptPath, true)) {
    error_log('The admin API bytecode could not be invalidated.');
    respond(503, ['error' => 'opcache_refresh_failed']);
}

respond(200, ['refreshed' => true]);
