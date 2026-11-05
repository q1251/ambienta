<?php
declare(strict_types=1);

ini_set('display_errors', '0');
ini_set('session.use_strict_mode', '1');
ini_set('session.use_only_cookies', '1');
ini_set('session.use_trans_sid', '0');
ini_set('session.gc_maxlifetime', '28800');

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, private');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');

function respond(int $status, array $body, array $headers = []): never
{
    http_response_code($status);
    foreach ($headers as $name => $value) {
        header($name . ': ' . $value);
    }
    echo json_encode($body, JSON_UNESCAPED_SLASHES);
    exit;
}

function get_auth_config(): array
{
    $configPath = dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'private' . DIRECTORY_SEPARATOR . 'admin-auth.php';
    if (!is_file($configPath)) {
        respond(503, [
            'authenticated' => false,
            'configured' => false,
            'code' => 'auth_not_configured',
            'message' => 'The administrator sign-in has not been configured on this server yet.',
        ]);
    }

    try {
        $config = require $configPath;
    } catch (Throwable $error) {
        error_log('AuraCare admin authentication configuration could not be loaded: ' . $error->getMessage());
        respond(500, [
            'authenticated' => false,
            'configured' => false,
            'code' => 'auth_configuration_error',
            'message' => 'The administrator sign-in configuration could not be loaded.',
        ]);
    }

    if (
        !is_array($config)
        || !isset($config['admin_email'], $config['password_hash'])
        || !is_string($config['admin_email'])
        || !filter_var($config['admin_email'], FILTER_VALIDATE_EMAIL)
        || !is_string($config['password_hash'])
        || password_get_info($config['password_hash'])['algo'] === null
    ) {
        error_log('AuraCare admin authentication configuration is incomplete or invalid.');
        respond(500, [
            'authenticated' => false,
            'configured' => false,
            'code' => 'auth_configuration_error',
            'message' => 'The administrator sign-in configuration is incomplete.',
        ]);
    }

    return $config;
}

function connect_staff_database(): PDO
{
    $configPath = dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'private' . DIRECTORY_SEPARATOR . 'app-config.php';
    if (!is_file($configPath)) {
        respond(503, ['authenticated' => false, 'message' => 'Staff sign-in is unavailable until the database is configured.']);
    }

    try {
        $database = require $configPath;
        if (!is_array($database)) {
            throw new RuntimeException('Database configuration is invalid.');
        }
        foreach (['db_host', 'db_name', 'db_user', 'db_password'] as $key) {
            if (!isset($database[$key]) || !is_string($database[$key]) || $database[$key] === '') {
                throw new RuntimeException('Database configuration is incomplete.');
            }
        }
        $db = new PDO(
            sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4', $database['db_host'], $database['db_name']),
            $database['db_user'],
            $database['db_password'],
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]
        );
        $db->exec(
            "CREATE TABLE IF NOT EXISTS staff_users (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                email VARCHAR(254) NOT NULL UNIQUE,
                display_name VARCHAR(120) NOT NULL DEFAULT '',
                password_hash VARCHAR(255) NOT NULL,
                role VARCHAR(24) NOT NULL DEFAULT 'operator',
                permissions TEXT NOT NULL DEFAULT '[\"leads\",\"orders\",\"products\",\"integrations\"]',
                is_active TINYINT(1) NOT NULL DEFAULT 1,
                must_change_password TINYINT(1) NOT NULL DEFAULT 1,
                session_version INT UNSIGNED NOT NULL DEFAULT 1,
                created_by VARCHAR(254) NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                KEY staff_active_role (is_active, role)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
        $databaseName = (string) $db->query('SELECT DATABASE()')->fetchColumn();
        $column = $db->prepare('SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?');
        $column->execute([$databaseName, 'staff_users', 'must_change_password']);
        if ((int) $column->fetchColumn() === 0) {
            $db->exec('ALTER TABLE staff_users ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 1 AFTER is_active');
        }
        $column->execute([$databaseName, 'staff_users', 'display_name']);
        if ((int) $column->fetchColumn() === 0) {
            $db->exec("ALTER TABLE staff_users ADD COLUMN display_name VARCHAR(120) NOT NULL DEFAULT '' AFTER email");
        }
        foreach ([
            'permissions' => "TEXT NOT NULL DEFAULT '[\"leads\",\"orders\",\"products\",\"integrations\"]'",
            'session_version' => 'INT UNSIGNED NOT NULL DEFAULT 1',
        ] as $columnName => $definition) {
            $column->execute([$databaseName, 'staff_users', $columnName]);
            if ((int) $column->fetchColumn() === 0) {
                $db->exec("ALTER TABLE staff_users ADD COLUMN `$columnName` $definition");
            }
        }
        $db->exec(
            "CREATE TABLE IF NOT EXISTS admin_profile (
                id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
                email VARCHAR(254) NOT NULL UNIQUE,
                display_name VARCHAR(120) NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
        $adminConfig = get_auth_config();
        $seed = $db->prepare(
            "INSERT IGNORE INTO admin_profile (id, email, display_name, password_hash) VALUES (1, ?, 'Administrator', ?)"
        );
        $seed->execute([$adminConfig['admin_email'], $adminConfig['password_hash']]);
        return $db;
    } catch (Throwable $error) {
        error_log('Ambients staff sign-in lookup failed: ' . $error->getMessage());
        respond(503, ['authenticated' => false, 'message' => 'Staff sign-in is temporarily unavailable. Please try again later.']);
    }
}

function find_staff_account(string $email): ?array
{
    $db = connect_staff_database();
    $statement = $db->prepare('SELECT id, email, display_name, password_hash, role, permissions, session_version, must_change_password FROM staff_users WHERE email = ? AND is_active = 1');
    $statement->execute([$email]);
    $staff = $statement->fetch();
    return is_array($staff) ? $staff : null;
}

function find_admin_account(): array
{
    $db = connect_staff_database();
    $account = $db->query('SELECT email, display_name, password_hash FROM admin_profile WHERE id = 1')->fetch();
    if (!is_array($account)) {
        error_log('Ambients primary administrator profile is missing.');
        respond(503, ['authenticated' => false, 'message' => 'Administrator sign-in is temporarily unavailable.']);
    }
    return $account;
}

function update_login_attempts(string $clientAddress, bool $clear): array
{
    $filePath = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'auracare-admin-login-limits.json';
    $handle = fopen($filePath, 'c+');
    if ($handle === false || !flock($handle, LOCK_EX)) {
        if (is_resource($handle)) {
            fclose($handle);
        }
        error_log('AuraCare admin login rate limiter could not lock its storage.');
        respond(503, [
            'authenticated' => false,
            'code' => 'auth_temporarily_unavailable',
            'message' => 'Sign-in is temporarily unavailable. Please try again later.',
        ]);
    }

    $contents = stream_get_contents($handle);
    $entries = $contents === '' ? [] : json_decode($contents, true);
    if (!is_array($entries)) {
        flock($handle, LOCK_UN);
        fclose($handle);
        error_log('AuraCare admin login rate-limit storage contains invalid data.');
        respond(503, [
            'authenticated' => false,
            'code' => 'auth_temporarily_unavailable',
            'message' => 'Sign-in is temporarily unavailable. Please try again later.',
        ]);
    }

    $now = time();
    foreach ($entries as $key => $timestamps) {
        if (!is_array($timestamps)) {
            unset($entries[$key]);
            continue;
        }
        $entries[$key] = array_values(array_filter(
            $timestamps,
            static fn ($timestamp): bool => is_int($timestamp) && $timestamp > $now - 900
        ));
        if ($entries[$key] === []) {
            unset($entries[$key]);
        }
    }

    $clientKey = hash('sha256', $clientAddress);
    $attempts = $entries[$clientKey] ?? [];
    $retryAfter = $attempts !== [] ? max(1, 900 - ($now - $attempts[0])) : 900;

    if ($clear) {
        unset($entries[$clientKey]);
    } elseif (count($attempts) < 10) {
        $entries[$clientKey][] = $now;
    }

    rewind($handle);
    $encoded = json_encode($entries);
    if ($encoded === false || !ftruncate($handle, 0) || fwrite($handle, $encoded) === false) {
        flock($handle, LOCK_UN);
        fclose($handle);
        error_log('AuraCare admin login rate-limit storage could not be updated.');
        respond(503, [
            'authenticated' => false,
            'code' => 'auth_temporarily_unavailable',
            'message' => 'Sign-in is temporarily unavailable. Please try again later.',
        ]);
    }

    fflush($handle);
    flock($handle, LOCK_UN);
    fclose($handle);

    return [
        'allowed' => count($attempts) < 10,
        'retry_after' => $retryAfter,
    ];
}

function start_admin_session(): void
{
    $isSecure = (
        isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== '' && strtolower((string) $_SERVER['HTTPS']) !== 'off'
    ) || (
        isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && strtolower((string) $_SERVER['HTTP_X_FORWARDED_PROTO']) === 'https'
    );

    session_name('auracare_admin');
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => $isSecure,
        'httponly' => true,
        'samesite' => 'Strict',
    ]);

    if (!session_start()) {
        error_log('AuraCare admin session could not be started.');
        respond(503, [
            'authenticated' => false,
            'code' => 'auth_temporarily_unavailable',
            'message' => 'Sign-in is temporarily unavailable. Please try again later.',
        ]);
    }
}

$config = get_auth_config();
$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? ''));
$input = [];

if ($method === 'POST') {
    $contentType = strtolower(trim(explode(';', (string) ($_SERVER['CONTENT_TYPE'] ?? ''))[0]));
    if ($contentType !== 'application/json') {
        respond(415, [
            'authenticated' => false,
            'message' => 'Requests must use application/json.',
        ]);
    }

    $rawInput = file_get_contents('php://input');
    if ($rawInput === false || strlen($rawInput) > 16384) {
        respond(413, [
            'authenticated' => false,
            'message' => 'The sign-in request is too large.',
        ]);
    }

    $input = json_decode($rawInput, true);
    if (!is_array($input)) {
        respond(400, [
            'authenticated' => false,
            'message' => 'The sign-in request is invalid.',
        ]);
    }
}

$action = $method === 'GET' ? 'session' : ($input['action'] ?? '');
if (!is_string($action)) {
    respond(400, ['authenticated' => false, 'message' => 'The requested action is invalid.']);
}

if ($action === 'session' && $method === 'GET') {
    start_admin_session();
    $lastActivity = $_SESSION['last_activity'] ?? 0;
    $authenticated = isset($_SESSION['admin_email'])
        && is_string($_SESSION['admin_email'])
        && isset($_SESSION['admin_role'])
        && in_array($_SESSION['admin_role'], ['admin', 'operator'], true)
        && $lastActivity >= time() - 28800;
    if ($authenticated && $_SESSION['admin_role'] === 'operator') {
        $staff = find_staff_account($_SESSION['admin_email']);
        if ($staff === null || $staff['role'] !== 'operator') {
            $authenticated = false;
        } else {
            if (isset($_SESSION['staff_session_version']) && (int) $_SESSION['staff_session_version'] !== (int) $staff['session_version']) {
                $authenticated = false;
            }
            $_SESSION['admin_email'] = $staff['email'];
            $_SESSION['admin_display_name'] = $staff['display_name'];
            $_SESSION['staff_id'] = (int) $staff['id'];
            $_SESSION['staff_session_version'] = (int) $staff['session_version'];
            $permissions = json_decode((string) $staff['permissions'], true);
            $_SESSION['admin_permissions'] = is_array($permissions)
                ? array_values(array_filter($permissions, static fn ($permission): bool => is_string($permission) && in_array($permission, ['leads', 'new_leads', 'orders', 'products', 'integrations', 'chat'], true)))
                : [];
            $_SESSION['must_change_password'] = !empty($_SESSION['is_impersonating']) ? false : (bool) $staff['must_change_password'];
        }
    } elseif ($authenticated) {
        $admin = find_admin_account();
        $_SESSION['admin_email'] = $admin['email'];
        $_SESSION['admin_display_name'] = $admin['display_name'];
        $_SESSION['admin_permissions'] = ['leads', 'new_leads', 'orders', 'products', 'integrations', 'chat'];
    }

    if ($authenticated) {
        $_SESSION['last_activity'] = time();
    } else {
        $_SESSION = [];
    }

    respond(200, [
        'authenticated' => $authenticated,
        'configured' => true,
        'email' => $authenticated ? $_SESSION['admin_email'] : null,
        'displayName' => $authenticated ? ($_SESSION['admin_display_name'] ?? '') : null,
        'role' => $authenticated ? ($_SESSION['admin_role'] ?? null) : null,
        'mustChangePassword' => $authenticated && (bool) ($_SESSION['must_change_password'] ?? false),
        'permissions' => $authenticated ? ($_SESSION['admin_permissions'] ?? []) : [],
        'impersonating' => $authenticated && !empty($_SESSION['is_impersonating']),
        'impersonatedBy' => $authenticated ? ($_SESSION['impersonated_by'] ?? null) : null,
    ]);
}

if ($action === 'login' && $method === 'POST') {
    start_admin_session();

    $email = isset($input['email']) && is_string($input['email']) ? strtolower(trim($input['email'])) : '';
    $password = isset($input['password']) && is_string($input['password']) ? $input['password'] : '';
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || $password === '' || strlen($password) > 1024) {
        respond(400, [
            'authenticated' => false,
            'message' => 'Enter a valid email address and password.',
        ]);
    }

    $attemptLimit = update_login_attempts((string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown'), false);
    if (!$attemptLimit['allowed']) {
        respond(429, [
            'authenticated' => false,
            'message' => 'Too many sign-in attempts. Please wait before trying again.',
        ], ['Retry-After' => (string) $attemptLimit['retry_after']]);
    }

    $role = null;
    $mustChangePassword = false;
    $staffSession = null;
    $admin = find_admin_account();
    if (hash_equals(strtolower($admin['email']), $email)) {
        if (password_verify($password, $admin['password_hash'])) {
            $role = 'admin';
            $displayName = $admin['display_name'];
        }
    } else {
        $staff = find_staff_account($email);
        if (
            $staff !== null
            && $staff['role'] === 'operator'
            && password_verify($password, $staff['password_hash'])
        ) {
            $role = 'operator';
            $mustChangePassword = (bool) $staff['must_change_password'];
            $displayName = $staff['display_name'];
            $staffSession = $staff;
        }
    }

    if ($role === null) {
        respond(401, [
            'authenticated' => false,
            'message' => 'The email or password is incorrect.',
        ]);
    }

    update_login_attempts((string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown'), true);
    if (!session_regenerate_id(true)) {
        error_log('AuraCare admin session ID could not be regenerated after authentication.');
        respond(503, [
            'authenticated' => false,
            'message' => 'Sign-in is temporarily unavailable. Please try again later.',
        ]);
    }

    $_SESSION = [];
    $_SESSION['admin_email'] = $email;
    $_SESSION['admin_display_name'] = $displayName;
    $_SESSION['admin_role'] = $role;
    $_SESSION['must_change_password'] = $mustChangePassword;
    if ($role === 'operator' && is_array($staffSession)) {
        $_SESSION['staff_id'] = (int) $staffSession['id'];
        $_SESSION['staff_session_version'] = (int) $staffSession['session_version'];
        $permissions = json_decode((string) $staffSession['permissions'], true);
        $_SESSION['admin_permissions'] = is_array($permissions)
            ? array_values(array_filter($permissions, static fn ($permission): bool => is_string($permission) && in_array($permission, ['leads', 'new_leads', 'orders', 'products', 'integrations', 'chat'], true)))
            : [];
    } else {
        unset($_SESSION['staff_id'], $_SESSION['staff_session_version'], $_SESSION['is_impersonating'], $_SESSION['impersonated_by'], $_SESSION['original_admin']);
        $_SESSION['admin_permissions'] = ['leads', 'new_leads', 'orders', 'products', 'integrations', 'chat'];
    }
    $_SESSION['last_activity'] = time();
    respond(200, [
        'authenticated' => true,
        'configured' => true,
        'email' => $email,
        'displayName' => $displayName,
        'role' => $role,
        'mustChangePassword' => $mustChangePassword,
        'permissions' => $_SESSION['admin_permissions'],
        'impersonating' => false,
    ]);
}

if ($action === 'update-profile' && $method === 'POST') {
    start_admin_session();
    if (
        !isset($_SESSION['admin_email'], $_SESSION['admin_role'])
        || !is_string($_SESSION['admin_email'])
        || !in_array($_SESSION['admin_role'], ['admin', 'operator'], true)
        || !is_int($_SESSION['last_activity'] ?? null)
        || $_SESSION['last_activity'] < time() - 28800
    ) {
        respond(401, ['authenticated' => false, 'message' => 'Sign in again before updating your profile.']);
    }
    if ($_SESSION['admin_role'] !== 'admin') {
        respond(403, ['message' => 'Agent account details are managed by an administrator.']);
    }

    $displayName = isset($input['displayName']) && is_string($input['displayName']) ? trim($input['displayName']) : '';
    $email = isset($input['email']) && is_string($input['email']) ? strtolower(trim($input['email'])) : '';
    $currentPassword = isset($input['currentPassword']) && is_string($input['currentPassword']) ? $input['currentPassword'] : '';
    $newPassword = isset($input['newPassword']) && is_string($input['newPassword']) ? $input['newPassword'] : '';
    if ($displayName === '' || strlen($displayName) > 120 || !filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 254) {
        respond(400, ['message' => 'Enter a display name and valid email address.']);
    }
    if ($currentPassword === '' || strlen($currentPassword) > 1024) {
        respond(400, ['message' => 'Enter your current password to confirm profile changes.']);
    }
    if ($newPassword !== '' && (strlen($newPassword) < 12 || strlen($newPassword) > 1024)) {
        respond(400, ['message' => 'A new password must be at least 12 characters.']);
    }

    $db = connect_staff_database();
    $role = $_SESSION['admin_role'];
    $currentEmail = $_SESSION['admin_email'];
    $db->beginTransaction();
    try {
        if ($role === 'admin') {
            $find = $db->query('SELECT email, display_name, password_hash FROM admin_profile WHERE id = 1 FOR UPDATE');
            $account = $find->fetch();
            if (!is_array($account) || !password_verify($currentPassword, $account['password_hash'])) {
                $db->rollBack();
                respond(403, ['message' => 'Your current password is incorrect.']);
            }
            $adminEmail = $db->prepare('SELECT id FROM staff_users WHERE email = ? LIMIT 1');
            $adminEmail->execute([$email]);
            if (strtolower($email) !== strtolower($account['email']) && $adminEmail->fetch()) {
                $db->rollBack();
                respond(409, ['message' => 'That email address is already assigned to another account.']);
            }
            if ($newPassword !== '' && password_verify($newPassword, $account['password_hash'])) {
                $db->rollBack();
                respond(400, ['message' => 'Choose a new password different from your current password.']);
            }
            $passwordHash = $newPassword === '' ? $account['password_hash'] : password_hash($newPassword, PASSWORD_DEFAULT);
            if (!is_string($passwordHash)) {
                throw new RuntimeException('Administrator password hashing failed.');
            }
            $update = $db->prepare('UPDATE admin_profile SET email = ?, display_name = ?, password_hash = ? WHERE id = 1');
            $update->execute([$email, $displayName, $passwordHash]);
        } else {
            $find = $db->prepare('SELECT id, email, password_hash, must_change_password FROM staff_users WHERE email = ? AND is_active = 1 AND role = ? FOR UPDATE');
            $find->execute([$currentEmail, 'operator']);
            $account = $find->fetch();
            if (!is_array($account) || !password_verify($currentPassword, $account['password_hash'])) {
                $db->rollBack();
                respond(403, ['message' => 'Your current password is incorrect or the account is inactive.']);
            }
            if ((int) $account['must_change_password'] === 1 && $newPassword === '') {
                $db->rollBack();
                respond(403, ['message' => 'Set a new password before changing other profile details.']);
            }
            $adminEmail = $db->query('SELECT email FROM admin_profile WHERE id = 1')->fetchColumn();
            $otherStaff = $db->prepare('SELECT id FROM staff_users WHERE email = ? AND id <> ? LIMIT 1');
            $otherStaff->execute([$email, $account['id']]);
            if (strtolower($email) === strtolower((string) $adminEmail) || $otherStaff->fetch()) {
                $db->rollBack();
                respond(409, ['message' => 'That email address is already assigned to another account.']);
            }
            if ($newPassword !== '' && password_verify($newPassword, $account['password_hash'])) {
                $db->rollBack();
                respond(400, ['message' => 'Choose a new password different from your current password.']);
            }
            $passwordHash = $newPassword === '' ? $account['password_hash'] : password_hash($newPassword, PASSWORD_DEFAULT);
            if (!is_string($passwordHash)) {
                throw new RuntimeException('Staff password hashing failed.');
            }
            $update = $db->prepare('UPDATE staff_users SET email = ?, display_name = ?, password_hash = ?, must_change_password = 0 WHERE id = ?');
            $update->execute([$email, $displayName, $passwordHash, $account['id']]);
        }

        if (!session_regenerate_id(true)) {
            $db->rollBack();
            error_log('Ambients account profile session ID could not be regenerated.');
            respond(503, ['message' => 'The profile could not be updated. Please try again.']);
        }
        $db->commit();
        $_SESSION['admin_email'] = $email;
        $_SESSION['admin_display_name'] = $displayName;
        $_SESSION['must_change_password'] = false;
        $_SESSION['last_activity'] = time();
        respond(200, ['updated' => true, 'email' => $email, 'displayName' => $displayName]);
    } catch (Throwable $error) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        error_log('Ambients account profile update failed: ' . $error->getMessage());
        respond(500, ['message' => 'The profile could not be updated. Please try again.']);
    }
}

if ($action === 'change-password' && $method === 'POST') {
    start_admin_session();
    if (
        !isset($_SESSION['admin_email'], $_SESSION['admin_role'])
        || $_SESSION['admin_role'] !== 'operator'
        || !is_string($_SESSION['admin_email'])
    ) {
        respond(403, ['authenticated' => false, 'message' => 'A signed-in staff account is required.']);
    }
    $newPassword = isset($input['newPassword']) && is_string($input['newPassword']) ? $input['newPassword'] : '';
    if (strlen($newPassword) < 12 || strlen($newPassword) > 1024) {
        respond(400, ['message' => 'Choose a password with at least 12 characters.']);
    }
    $db = connect_staff_database();
    $hash = password_hash($newPassword, PASSWORD_DEFAULT);
    if (!is_string($hash)) {
        error_log('Ambients staff password hashing failed during password change.');
        respond(500, ['message' => 'The password could not be changed. Please try again.']);
    }
    $currentPassword = $db->prepare('SELECT password_hash, session_version FROM staff_users WHERE email = ? AND is_active = 1');
    $currentPassword->execute([$_SESSION['admin_email']]);
    $staff = $currentPassword->fetch();
    if (!is_array($staff) || !is_string($staff['password_hash'])) {
        respond(401, ['authenticated' => false, 'message' => 'This staff account is inactive. Sign in again or contact an administrator.']);
    }
    if (isset($_SESSION['staff_session_version']) && (int) $_SESSION['staff_session_version'] !== (int) $staff['session_version']) {
        $_SESSION = [];
        session_destroy();
        respond(401, ['authenticated' => false, 'message' => 'This account was updated. Sign in again.']);
    }
    $currentHash = $staff['password_hash'];
    if (password_verify($newPassword, $currentHash)) {
        respond(400, ['message' => 'Choose a password different from your temporary password.']);
    }
    $update = $db->prepare('UPDATE staff_users SET password_hash = ?, must_change_password = 0 WHERE email = ? AND is_active = 1');
    $update->execute([$hash, $_SESSION['admin_email']]);
    if ($update->rowCount() !== 1) {
        respond(401, ['authenticated' => false, 'message' => 'This staff account is inactive. Sign in again or contact an administrator.']);
    }
    $_SESSION['must_change_password'] = false;
    $_SESSION['last_activity'] = time();
    respond(200, ['updated' => true]);
}

if ($action === 'logout' && $method === 'POST') {
    start_admin_session();
    $_SESSION = [];
    $cookie = session_get_cookie_params();
    setcookie(session_name(), '', [
        'expires' => time() - 42000,
        'path' => $cookie['path'],
        'secure' => $cookie['secure'],
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    session_destroy();
    respond(200, ['authenticated' => false]);
}

if ($action === 'session' && $method !== 'GET') {
    header('Allow: GET');
    respond(405, ['authenticated' => false, 'message' => 'Method not allowed.']);
}

if (in_array($action, ['login', 'logout', 'change-password'], true) && $method !== 'POST') {
    header('Allow: POST');
    respond(405, ['authenticated' => false, 'message' => 'Method not allowed.']);
}

respond(400, ['authenticated' => false, 'message' => 'The requested action is invalid.']);
