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

function data_respond(int $status, array $body): never
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_SLASHES);
    exit;
}
function data_config(): array
{
    $path = dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'private' . DIRECTORY_SEPARATOR . 'app-config.php';
    if (!is_file($path)) {
        data_respond(503, [
            'error' => 'database_not_configured',
            'message' => 'The application database is not configured on this server.',
        ]);
    }

    try {
        $config = require $path;
    } catch (Throwable $error) {
        error_log('Ambients application configuration could not be loaded: ' . $error->getMessage());
        data_respond(500, ['error' => 'configuration_error', 'message' => 'The application configuration is invalid.']);
    }

    foreach (['db_host', 'db_name', 'db_user', 'db_password'] as $key) {
        if (!is_array($config) || !isset($config[$key]) || !is_string($config[$key]) || $config[$key] === '') {
            error_log('Ambients application database configuration is incomplete.');
            data_respond(500, ['error' => 'configuration_error', 'message' => 'The database configuration is incomplete.']);
        }
    }

    return $config;
}

function data_db(): PDO
{
    static $connection = null;
    if ($connection instanceof PDO) {
        return $connection;
    }

    $config = data_config();
    try {
        $connection = new PDO(
            sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4', $config['db_host'], $config['db_name']),
            $config['db_user'],
            $config['db_password'],
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]
        );
        data_ensure_schema($connection);
    } catch (PDOException $error) {
        error_log('Ambients database connection failed: ' . $error->getMessage());
        data_respond(503, ['error' => 'database_unavailable', 'message' => 'The application database is temporarily unavailable.']);
    }

    return $connection;
}

function data_ensure_schema(PDO $db): void
{
    $db->exec(
        "CREATE TABLE IF NOT EXISTS leads (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            first_name VARCHAR(100) NOT NULL,
            last_name VARCHAR(100) NOT NULL,
            email VARCHAR(254) NOT NULL,
            phone VARCHAR(40) NOT NULL DEFAULT '',
            country VARCHAR(100) NOT NULL DEFAULT '',
            lead_source VARCHAR(24) NOT NULL,
            status VARCHAR(24) NOT NULL DEFAULT 'Cold',
            marketing_consent TINYINT(1) NOT NULL DEFAULT 0,
            marketing_consent_at DATETIME NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY leads_email (email)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    $db->exec(
        "CREATE TABLE IF NOT EXISTS lead_activities (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            lead_id BIGINT UNSIGNED NOT NULL,
            activity_type VARCHAR(16) NOT NULL,
            note TEXT NULL,
            call_outcome VARCHAR(32) NULL,
            follow_up_date DATE NULL,
            author_email VARCHAR(254) NOT NULL,
            author_name VARCHAR(120) NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            KEY lead_activities_history (lead_id, id),
            CONSTRAINT lead_activities_lead_fk FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    $db->exec(
        "CREATE TABLE IF NOT EXISTS email_activity (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            recipient_email VARCHAR(254) NOT NULL,
            subject VARCHAR(998) NOT NULL,
            body MEDIUMTEXT NOT NULL,
            status VARCHAR(16) NOT NULL DEFAULT 'Queued',
            sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            KEY email_activity_sent_at (sent_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    $db->exec(
        "CREATE TABLE IF NOT EXISTS email_drafts (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            recipient_email VARCHAR(254) NOT NULL DEFAULT '',
            subject VARCHAR(998) NOT NULL DEFAULT '',
            body MEDIUMTEXT NOT NULL,
            deleted_at TIMESTAMP NULL DEFAULT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            KEY email_drafts_folder (deleted_at, updated_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    $db->exec(
        "CREATE TABLE IF NOT EXISTS email_campaigns (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(160) NOT NULL,
            subject VARCHAR(180) NOT NULL,
            body MEDIUMTEXT NOT NULL,
            status VARCHAR(16) NOT NULL DEFAULT 'draft',
            scheduled_at DATETIME NULL,
            recipient_count INT UNSIGNED NOT NULL DEFAULT 0,
            sent_count INT UNSIGNED NOT NULL DEFAULT 0,
            failed_count INT UNSIGNED NOT NULL DEFAULT 0,
            unsubscribed_count INT UNSIGNED NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            completed_at DATETIME NULL,
            KEY email_campaigns_status_schedule (status, scheduled_at, id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    $db->exec(
        "CREATE TABLE IF NOT EXISTS email_campaign_recipients (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            campaign_id BIGINT UNSIGNED NOT NULL,
            lead_id BIGINT UNSIGNED NOT NULL,
            recipient_email VARCHAR(254) NOT NULL,
            status VARCHAR(16) NOT NULL DEFAULT 'queued',
            unsubscribe_token_hash CHAR(64) NOT NULL,
            unsubscribe_token MEDIUMTEXT NOT NULL,
            claimed_at DATETIME NULL,
            sent_at DATETIME NULL,
            KEY email_campaign_recipients_queue (campaign_id, status, id),
            KEY email_campaign_recipients_lead (lead_id, status),
            KEY email_campaign_recipients_email (recipient_email, status),
            UNIQUE KEY email_campaign_recipient_token (unsubscribe_token_hash),
            CONSTRAINT email_campaign_recipients_campaign_fk FOREIGN KEY (campaign_id) REFERENCES email_campaigns(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    $databaseName = (string) $db->query('SELECT DATABASE()')->fetchColumn();
    foreach ([
        ['email_activity', 'body', 'MEDIUMTEXT NULL'],
    ] as [$table, $column, $definition]) {
        $columnExists = $db->prepare('SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?');
        $columnExists->execute([$databaseName, $table, $column]);
        if ((int) $columnExists->fetchColumn() === 0) {
            $db->exec("ALTER TABLE {$table} ADD COLUMN {$column} {$definition}");
        }
    }
    $db->exec(
        "CREATE TABLE IF NOT EXISTS products (
            id VARCHAR(64) NOT NULL PRIMARY KEY,
            name VARCHAR(180) NOT NULL,
            category VARCHAR(80) NOT NULL,
            description TEXT NOT NULL,
            rx_required TINYINT(1) NOT NULL DEFAULT 0,
            dosage VARCHAR(120) NOT NULL DEFAULT '',
            sku VARCHAR(80) NOT NULL DEFAULT '',
            ndc_code VARCHAR(32) NULL,
            image VARCHAR(500) NULL,
            images TEXT NULL,
            min_stock_threshold INT UNSIGNED NOT NULL DEFAULT 0,
            cost_price DECIMAL(10,2) NULL,
            copay_price DECIMAL(10,2) NULL,
            price DECIMAL(10,2) NOT NULL,
            stock_count INT UNSIGNED NOT NULL,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            is_featured TINYINT(1) NOT NULL DEFAULT 0,
            is_archived TINYINT(1) NOT NULL DEFAULT 0,
            last_restocked DATE NULL,
            UNIQUE KEY products_sku (sku)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    $db->exec(
        "CREATE TABLE IF NOT EXISTS product_categories (
            name VARCHAR(80) NOT NULL PRIMARY KEY,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    $db->exec(
        "CREATE TABLE IF NOT EXISTS orders (
            id VARCHAR(64) NOT NULL PRIMARY KEY,
            order_number VARCHAR(40) NOT NULL UNIQUE,
            customer_name VARCHAR(160) NOT NULL,
            email VARCHAR(254) NOT NULL,
            phone VARCHAR(40) NOT NULL,
            delivery_method VARCHAR(32) NOT NULL,
            delivery_address VARCHAR(500) NOT NULL,
            subtotal DECIMAL(10,2) NOT NULL,
            shipping_fee DECIMAL(10,2) NOT NULL,
            discount_amount DECIMAL(10,2) NOT NULL,
            coupon_code VARCHAR(32) NULL,
            total_amount DECIMAL(10,2) NOT NULL,
            payment_method VARCHAR(48) NOT NULL,
            payment_status VARCHAR(32) NOT NULL,
            status VARCHAR(32) NOT NULL,
            carrier VARCHAR(120) NULL,
            tracking_number VARCHAR(180) NULL,
            placed_at DATETIME NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            KEY orders_placed_at (placed_at),
            KEY orders_status (status),
            KEY orders_email (email)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    $db->exec(
        "CREATE TABLE IF NOT EXISTS order_items (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            order_id VARCHAR(64) NOT NULL,
            product_id VARCHAR(64) NOT NULL,
            product_name VARCHAR(180) NOT NULL,
            category VARCHAR(80) NOT NULL,
            quantity SMALLINT UNSIGNED NOT NULL,
            unit_price DECIMAL(10,2) NOT NULL,
            CONSTRAINT order_items_order_fk FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    $db->exec(
        "CREATE TABLE IF NOT EXISTS order_notes (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            order_id VARCHAR(64) NOT NULL,
            author_email VARCHAR(254) NOT NULL,
            note TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            KEY order_notes_order (order_id, id),
            CONSTRAINT order_notes_order_fk FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    $db->exec(
        "CREATE TABLE IF NOT EXISTS admin_audit_log (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            actor_email VARCHAR(254) NOT NULL,
            action VARCHAR(80) NOT NULL,
            entity_type VARCHAR(40) NOT NULL,
            entity_id VARCHAR(80) NOT NULL,
            details JSON NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            KEY audit_created (created_at),
            KEY audit_entity (entity_type, entity_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
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
    $staffPasswordChangeColumn = $db->prepare('SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?');
    $staffPasswordChangeColumn->execute([$databaseName, 'staff_users', 'must_change_password']);
    if ((int) $staffPasswordChangeColumn->fetchColumn() === 0) {
        $db->exec('ALTER TABLE staff_users ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 1 AFTER is_active');
    }
    $staffPasswordChangeColumn->execute([$databaseName, 'staff_users', 'display_name']);
    if ((int) $staffPasswordChangeColumn->fetchColumn() === 0) {
        $db->exec("ALTER TABLE staff_users ADD COLUMN display_name VARCHAR(120) NOT NULL DEFAULT '' AFTER email");
    }
    foreach ([
        'permissions' => "TEXT NOT NULL DEFAULT '[\"leads\",\"orders\",\"products\",\"integrations\"]'",
        'session_version' => 'INT UNSIGNED NOT NULL DEFAULT 1',
    ] as $column => $definition) {
        $staffPasswordChangeColumn->execute([$databaseName, 'staff_users', $column]);
        if ((int) $staffPasswordChangeColumn->fetchColumn() === 0) {
            $db->exec("ALTER TABLE staff_users ADD COLUMN `$column` $definition");
        }
    }
    $assignedLeadColumn = $db->prepare('SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?');
    $assignedLeadColumn->execute([$databaseName, 'leads', 'assigned_staff_id']);
    if ((int) $assignedLeadColumn->fetchColumn() === 0) {
        $db->exec('ALTER TABLE leads ADD COLUMN assigned_staff_id BIGINT UNSIGNED NULL, ADD KEY leads_assigned_staff (assigned_staff_id)');
    }
    $leadColumns = [
        'status' => "VARCHAR(24) NOT NULL DEFAULT 'Cold'",
        'marketing_consent' => 'TINYINT(1) NOT NULL DEFAULT 0',
        'marketing_consent_at' => 'DATETIME NULL',
        'country' => "VARCHAR(100) NOT NULL DEFAULT ''",
    ];
    foreach ($leadColumns as $column => $definition) {
        $check = $db->prepare('SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?');
        $check->execute([$databaseName, 'leads', $column]);
        if ((int) $check->fetchColumn() === 0) {
            $db->exec("ALTER TABLE leads ADD COLUMN `$column` $definition");
        }
    }
    $legacyColumns = [
        'category' => "VARCHAR(80) NOT NULL DEFAULT 'Daily Wellness'",
        'description' => 'TEXT NULL',
        'rx_required' => 'TINYINT(1) NOT NULL DEFAULT 0',
        'dosage' => "VARCHAR(120) NOT NULL DEFAULT ''",
        'sku' => "VARCHAR(80) NOT NULL DEFAULT ''",
        'ndc_code' => 'VARCHAR(32) NULL',
        'image' => 'VARCHAR(500) NULL',
        'images' => 'TEXT NULL',
        'min_stock_threshold' => 'INT UNSIGNED NOT NULL DEFAULT 0',
        'cost_price' => 'DECIMAL(10,2) NULL',
        'copay_price' => 'DECIMAL(10,2) NULL',
        'last_restocked' => 'DATE NULL',
        'is_featured' => 'TINYINT(1) NOT NULL DEFAULT 0',
        'is_archived' => 'TINYINT(1) NOT NULL DEFAULT 0',
    ];
    foreach ($legacyColumns as $column => $definition) {
        $check = $db->prepare('SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?');
        $check->execute([$databaseName, 'products', $column]);
        if ((int) $check->fetchColumn() === 0) {
            $db->exec("ALTER TABLE products ADD COLUMN `$column` $definition");
            if ($column === 'is_archived') {
                $db->exec('UPDATE products SET is_archived = 1 WHERE is_active = 0');
            }
        }
    }
    foreach (['products', 'order_items'] as $table) {
        $categoryLength = $db->prepare('SELECT CHARACTER_MAXIMUM_LENGTH FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?');
        $categoryLength->execute([$databaseName, $table, 'category']);
        if ((int) $categoryLength->fetchColumn() < 80) {
            $db->exec("ALTER TABLE `$table` MODIFY category VARCHAR(80) NOT NULL");
        }
    }
    $ordersEmailIndex = $db->prepare('SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?');
    $ordersEmailIndex->execute([$databaseName, 'orders', 'orders_email']);
    if ((int) $ordersEmailIndex->fetchColumn() === 0) {
        $db->exec('ALTER TABLE orders ADD KEY orders_email (email)');
    }

    $db->exec('UPDATE products SET sku = id WHERE sku = \'\'');
    $db->exec('UPDATE products SET description = name WHERE description IS NULL OR description = \'\'');
    $skuIndex = $db->prepare('SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?');
    $skuIndex->execute([$databaseName, 'products', 'products_sku']);
    if ((int) $skuIndex->fetchColumn() === 0) {
        $db->exec('ALTER TABLE products ADD UNIQUE KEY products_sku (sku)');
    }

    if ((int) $db->query('SELECT COUNT(*) FROM products')->fetchColumn() === 0) {
        $products = [
            ['cat-sleep-1', 'Deep Sleep Botanical Night Calm Formula', 'Sleep', 'Restorative nighttime wellness support.', 0, 'Standard dosage', 'SKU-SLEEP-001', 24.00, 180],
            ['cat-sleep-2', 'Magnesium L-Threonate Neuro Rest', 'Sleep', 'Magnesium support for nightly wellness.', 0, 'Standard dosage', 'SKU-SLEEP-002', 32.00, 95],
            ['cat-sleep-3', 'Valerian Root & L-Theanine Night Tincture', 'Sleep', 'Botanical nightly wellness formula.', 0, 'Standard dosage', 'SKU-SLEEP-003', 21.50, 64],
            ['cat-wl-1', 'Metabolic Vitality Clean Thermogenic Support', 'Weight Loss', 'Metabolic wellness support.', 0, 'Standard dosage', 'SKU-WEIGHT-001', 38.00, 140],
            ['cat-wl-2', 'Semaglutide Clinical Metabolic Kit', 'Weight Loss', 'Prescription product; appropriate prescription verification is required.', 1, 'As prescribed', 'SKU-WEIGHT-002', 149.00, 45],
            ['cat-wl-3', 'Appetite Control Organic Glucomannan Fiber', 'Weight Loss', 'Dietary fiber wellness product.', 0, 'Standard dosage', 'SKU-WEIGHT-003', 24.50, 88],
            ['cat-ef-1', 'High Potency Active Methyl B-Complex', 'Energy & Focus', 'Daily B-complex wellness support.', 0, 'Standard dosage', 'SKU-ENERGY-001', 22.00, 110],
            ['cat-ef-2', 'CoQ10 Ubiquinol 200mg Cellular Vitality', 'Energy & Focus', 'CoQ10 wellness supplement.', 0, 'Standard dosage', 'SKU-ENERGY-002', 39.00, 72],
            ['cat-hrt-1', 'Lisinopril Cardiovascular Care 20mg', 'Heart & Circulation', 'Prescription product; appropriate prescription verification is required.', 1, 'As prescribed', 'SKU-HEART-001', 12.00, 95],
            ['cat-hrt-2', 'Clinical Grade Omega-3 EPA/DHA Pure Triglyceride', 'Heart & Circulation', 'Omega-3 wellness supplement.', 0, 'Standard dosage', 'SKU-HEART-002', 34.00, 68],
            ['cat-dig-1', 'Probiotic Ultra 50 Billion CFU Gut Defense', 'Digestive Health', 'Probiotic wellness support.', 0, 'Standard dosage', 'SKU-DIGEST-001', 36.00, 82],
            ['cat-dig-2', 'Omeprazole Delayed Release 20mg', 'Digestive Health', 'Prescription product; appropriate prescription verification is required.', 1, 'As prescribed', 'SKU-DIGEST-002', 18.00, 50],
            ['cat-wel-1', 'Liposomal Vitamin C 1000mg Immune Shield', 'Daily Wellness', 'Daily Vitamin C supplement.', 0, 'Standard dosage', 'SKU-WELLNESS-001', 24.00, 115],
            ['cat-wel-2', 'Vitamin D3 + K2 (MK-7) Synergy Drops', 'Daily Wellness', 'Vitamin D3 and K2 supplement.', 0, 'Standard dosage', 'SKU-WELLNESS-002', 19.50, 77],
            ['cat-pain-1', 'Curcumin C3 Complex Anti-Inflammatory 500mg', 'Pain & Recovery', 'Curcumin wellness supplement.', 0, 'Standard dosage', 'SKU-RECOVERY-001', 31.00, 65],
            ['cat-pain-2', 'Arnica & Menthol Botanical Cooling Muscle Rub', 'Pain & Recovery', 'Topical botanical wellness product.', 0, 'Use as directed', 'SKU-RECOVERY-002', 17.50, 48],
        ];
        $insert = $db->prepare(
            'INSERT INTO products (id, name, category, description, rx_required, dosage, sku, price, stock_count, min_stock_threshold)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 10)'
        );
        foreach ($products as $product) {
            $insert->execute($product);
        }
    }
    $db->exec('INSERT IGNORE INTO product_categories (name) SELECT DISTINCT category FROM products WHERE category <> \'\'');
    $demoLeads = [
        ['Avery', 'Morgan', 'avery.morgan@example.com', '555-0101'],
        ['Jordan', 'Reed', 'jordan.reed@example.com', '555-0102'],
        ['Taylor', 'Brooks', 'taylor.brooks@example.com', '555-0103'],
        ['Casey', 'Parker', 'casey.parker@example.com', '555-0104'],
        ['Riley', 'Hayes', 'riley.hayes@example.com', '555-0105'],
        ['Morgan', 'Blake', 'morgan.blake@example.com', '555-0106'],
        ['Jamie', 'Quinn', 'jamie.quinn@example.com', '555-0107'],
        ['Cameron', 'Foster', 'cameron.foster@example.com', '555-0108'],
        ['Drew', 'Ellis', 'drew.ellis@example.com', '555-0109'],
        ['Reese', 'Bennett', 'reese.bennett@example.com', '555-0110'],
        ['Alex', 'Rivera', 'alex.rivera@example.com', '555-0111'],
        ['Skyler', 'Price', 'skyler.price@example.com', '555-0112'],
        ['Peyton', 'Murphy', 'peyton.murphy@example.com', '555-0113'],
        ['Rowan', 'Cole', 'rowan.cole@example.com', '555-0114'],
        ['Emerson', 'Gray', 'emerson.gray@example.com', '555-0115'],
        ['Finley', 'Ward', 'finley.ward@example.com', '555-0116'],
        ['Harper', 'Lane', 'harper.lane@example.com', '555-0117'],
        ['Sage', 'Turner', 'sage.turner@example.com', '555-0118'],
        ['Dakota', 'James', 'dakota.james@example.com', '555-0119'],
        ['Kendall', 'Ross', 'kendall.ross@example.com', '555-0120'],
    ];
    $insertDemoLead = $db->prepare(
        "INSERT IGNORE INTO leads (first_name, last_name, email, phone, lead_source, status, marketing_consent)
         VALUES (?, ?, ?, ?, 'Synthetic Demo', 'Cold', 0)"
    );
    foreach ($demoLeads as $demoLead) {
        $insertDemoLead->execute($demoLead);
    }
}

function data_require_admin(string $requiredRole = 'operator'): void
{
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
        data_respond(503, ['error' => 'session_unavailable', 'message' => 'The admin session is temporarily unavailable.']);
    }

    $lastActivity = $_SESSION['last_activity'] ?? 0;
    if (
        !isset($_SESSION['admin_email'])
        || !is_string($_SESSION['admin_email'])
        || !isset($_SESSION['admin_role'])
        || !in_array($_SESSION['admin_role'], ['admin', 'operator'], true)
        || !is_int($lastActivity)
        || $lastActivity < time() - 28800
    ) {
        data_respond(401, ['error' => 'unauthorized', 'message' => 'Sign in to access this resource.']);
    }
    if ($_SESSION['admin_role'] === 'operator' && !($requiredRole === 'exit-impersonation' && !empty($_SESSION['is_impersonating']))) {
        if ((bool) ($_SESSION['must_change_password'] ?? false) && empty($_SESSION['is_impersonating'])) {
            data_respond(403, ['error' => 'password_change_required', 'message' => 'Change the temporary password before using the workspace.']);
        }
        $check = data_db()->prepare('SELECT id, is_active, must_change_password, permissions, session_version FROM staff_users WHERE email = ? AND role = ?');
        $check->execute([$_SESSION['admin_email'], 'operator']);
        $staff = $check->fetch();
        if (!is_array($staff) || (int) $staff['is_active'] !== 1) {
            $_SESSION = [];
            session_destroy();
            data_respond(401, ['error' => 'account_disabled', 'message' => 'This staff account is inactive. Contact an administrator.']);
        }
        if (isset($_SESSION['staff_session_version']) && (int) $_SESSION['staff_session_version'] !== (int) $staff['session_version']) {
            $_SESSION = [];
            session_destroy();
            data_respond(401, ['error' => 'session_revoked', 'message' => 'This account was updated. Sign in again.']);
        }
        if ((int) $staff['must_change_password'] === 1 && empty($_SESSION['is_impersonating'])) {
            $_SESSION['must_change_password'] = true;
            data_respond(403, ['error' => 'password_change_required', 'message' => 'Change the temporary password before using the workspace.']);
        }
        $_SESSION['staff_id'] = (int) $staff['id'];
        $_SESSION['staff_session_version'] = (int) $staff['session_version'];
        $permissions = json_decode((string) $staff['permissions'], true);
        $_SESSION['admin_permissions'] = is_array($permissions)
            ? array_values(array_filter($permissions, static fn ($permission): bool => is_string($permission) && in_array($permission, ['leads', 'orders', 'products', 'integrations'], true)))
            : [];
    }
    if ($requiredRole === 'admin' && $_SESSION['admin_role'] !== 'admin') {
        data_respond(403, ['error' => 'admin_required', 'message' => 'Administrator access is required for this action.']);
    }
    $_SESSION['last_activity'] = time();
}

function data_require_permission(string $permission): void
{
    if (session_status() !== PHP_SESSION_ACTIVE) data_require_admin();
    if (($_SESSION['admin_role'] ?? '') !== 'admin'
        && !in_array($permission, $_SESSION['admin_permissions'] ?? [], true)) {
        data_respond(403, ['error' => 'permission_required', 'message' => 'Your account does not have access to this section.']);
    }
}

function data_require_lead_access(PDO $db, int $leadId): void
{
    if (($_SESSION['admin_role'] ?? '') === 'admin') return;
    $owner = $db->prepare('SELECT assigned_staff_id FROM leads WHERE id = ?');
    $owner->execute([$leadId]);
    $assignedStaffId = $owner->fetchColumn();
    if ($assignedStaffId === false) {
        data_respond(404, ['error' => 'lead_not_found', 'message' => 'The contact lead was not found.']);
    }
    if ($assignedStaffId === null || (int) $assignedStaffId !== (int) ($_SESSION['staff_id'] ?? 0)) {
        data_respond(404, ['error' => 'lead_not_found', 'message' => 'The contact lead was not found.']);
    }
}

function data_staff_permissions($permissions): ?array
{
    $validPermissions = ['leads', 'orders', 'products', 'integrations'];
    if (!is_array($permissions)) return null;
    foreach ($permissions as $permission) {
        if (!is_string($permission) || !in_array($permission, $validPermissions, true)) return null;
    }
    return array_values(array_unique($permissions));
}

function data_read_json(int $maxBytes = 262144): array
{
    $contentType = strtolower(trim(explode(';', (string) ($_SERVER['CONTENT_TYPE'] ?? ''))[0]));
    if ($contentType !== 'application/json') {
        data_respond(415, ['error' => 'unsupported_media_type', 'message' => 'Requests must use application/json.']);
    }
    $raw = file_get_contents('php://input');
    if ($raw === false || strlen($raw) > $maxBytes) {
        data_respond(413, ['error' => 'request_too_large', 'message' => 'The request is too large.']);
    }
    $body = json_decode($raw, true);
    if (!is_array($body)) {
        data_respond(400, ['error' => 'invalid_json', 'message' => 'The request body is invalid.']);
    }
    return $body;
}

function data_string(array $source, string $key, int $maxLength, bool $required = true): string
{
    $value = $source[$key] ?? '';
    if (!is_string($value)) {
        data_respond(400, ['error' => 'invalid_field', 'message' => 'A submitted field is invalid.']);
    }
    $value = trim($value);
    if (($required && $value === '') || strlen($value) > $maxLength) {
        data_respond(400, ['error' => 'invalid_field', 'message' => 'A required field is missing or too long.']);
    }
    return $value;
}

function data_mail_directory(): string
{
    return dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'private';
}

function data_mail_key(): string
{
    if (!function_exists('openssl_encrypt') || !function_exists('openssl_decrypt')) {
        data_respond(503, ['error' => 'mail_crypto_unavailable', 'message' => 'Secure mail credential storage is unavailable on this server.']);
    }

    $keyPath = data_mail_directory() . DIRECTORY_SEPARATOR . 'mail-encryption-key.bin';
    if (is_file($keyPath)) {
        if (!chmod($keyPath, 0600)) {
            error_log('Ambients mail encryption key permissions could not be restricted.');
            data_respond(503, ['error' => 'mail_storage_unavailable', 'message' => 'Secure mail storage permissions could not be set.']);
        }
        $key = file_get_contents($keyPath);
        if ($key === false || strlen($key) !== 32) {
            error_log('Ambients mail encryption key is invalid.');
            data_respond(503, ['error' => 'mail_storage_unavailable', 'message' => 'Secure mail settings could not be loaded. Contact the administrator.']);
        }
        return $key;
    }

    try {
        $key = random_bytes(32);
    } catch (Throwable $error) {
        error_log('Ambients mail encryption key generation failed.');
        data_respond(503, ['error' => 'mail_storage_unavailable', 'message' => 'Secure mail settings could not be initialized.']);
    }

    $handle = @fopen($keyPath, 'x+b');
    if ($handle === false) {
        if (is_file($keyPath)) return data_mail_key();
        error_log('Ambients private mail storage is not writable.');
        data_respond(503, ['error' => 'mail_storage_unavailable', 'message' => 'Secure mail settings could not be stored on this server.']);
    }

    if (!chmod($keyPath, 0600)) {
        fclose($handle);
        @unlink($keyPath);
        error_log('Ambients mail encryption key permissions could not be restricted.');
        data_respond(503, ['error' => 'mail_storage_unavailable', 'message' => 'Secure mail storage permissions could not be set.']);
    }
    $written = fwrite($handle, $key);
    fflush($handle);
    fclose($handle);
    if ($written !== 32) {
        @unlink($keyPath);
        error_log('Ambients mail encryption key could not be written.');
        data_respond(503, ['error' => 'mail_storage_unavailable', 'message' => 'Secure mail settings could not be initialized.']);
    }
    return $key;
}

function data_mail_encrypt_content(string $content): string
{
    $nonce = random_bytes(12);
    $tag = '';
    $ciphertext = openssl_encrypt($content, 'aes-256-gcm', data_mail_key(), OPENSSL_RAW_DATA, $nonce, $tag);
    if (!is_string($ciphertext) || $tag === '') {
        error_log('Ambients email content encryption failed.');
        data_respond(503, ['error' => 'mail_storage_unavailable', 'message' => 'Email content could not be secured for storage.']);
    }
    return 'enc:v1:' . base64_encode($nonce . $tag . $ciphertext);
}

function data_mail_decrypt_content(?string $content): string
{
    if ($content === null || !str_starts_with($content, 'enc:v1:')) {
        return $content ?? '';
    }
    $encoded = base64_decode(substr($content, 7), true);
    if (!is_string($encoded) || strlen($encoded) < 28) {
        error_log('Ambients encrypted email content is malformed.');
        data_respond(503, ['error' => 'mail_content_unavailable', 'message' => 'Saved email content could not be read.']);
    }
    $decrypted = openssl_decrypt(
        substr($encoded, 28),
        'aes-256-gcm',
        data_mail_key(),
        OPENSSL_RAW_DATA,
        substr($encoded, 0, 12),
        substr($encoded, 12, 16)
    );
    if (!is_string($decrypted)) {
        error_log('Ambients encrypted email content could not be decrypted.');
        data_respond(503, ['error' => 'mail_content_unavailable', 'message' => 'Saved email content could not be read.']);
    }
    return $decrypted;
}

function data_mail_settings(): array
{
    $path = data_mail_directory() . DIRECTORY_SEPARATOR . 'mail-settings.json';
    if (!is_file($path)) return [];

    $contents = file_get_contents($path);
    $settings = $contents === false ? null : json_decode($contents, true);
    if (
        !is_array($settings)
        || !isset($settings['emailAccount'], $settings['displayName'], $settings['password'], $settings['nonce'], $settings['tag'])
        || !is_string($settings['emailAccount'])
        || !is_string($settings['displayName'])
        || !is_string($settings['password'])
        || !is_string($settings['nonce'])
        || !is_string($settings['tag'])
        || $settings['emailAccount'] !== 'customersupport@ambienta.io'
        || !filter_var($settings['emailAccount'], FILTER_VALIDATE_EMAIL)
        || preg_match('/[\r\n\x00]/', $settings['displayName']) === 1
        || !is_string(base64_decode($settings['password'], true))
        || strlen((string) base64_decode($settings['nonce'], true)) !== 12
        || strlen((string) base64_decode($settings['tag'], true)) !== 16
        || (isset($settings['verified']) && !is_bool($settings['verified']))
        || (isset($settings['campaignWorkerTokenHash']) && (!is_string($settings['campaignWorkerTokenHash']) || preg_match('/^[a-f0-9]{64}$/', $settings['campaignWorkerTokenHash']) !== 1))
    ) {
        error_log('Ambients private mail settings are invalid.');
        data_respond(503, ['error' => 'mail_storage_unavailable', 'message' => 'Saved mail settings could not be loaded. Contact the administrator.']);
    }
    return $settings;
}

function data_mail_write_settings(array $settings): void
{
    $encodedSettings = json_encode($settings, JSON_UNESCAPED_SLASHES);
    if (!is_string($encodedSettings)) {
        data_respond(500, ['error' => 'mail_storage_unavailable', 'message' => 'Mail settings could not be saved.']);
    }

    $path = data_mail_directory() . DIRECTORY_SEPARATOR . 'mail-settings.json';
    $temporaryPath = $path . '.' . bin2hex(random_bytes(8)) . '.tmp';
    $written = @file_put_contents($temporaryPath, $encodedSettings, LOCK_EX);
    if ($written === false || $written !== strlen($encodedSettings)) {
        @unlink($temporaryPath);
        error_log('Ambients encrypted mail settings could not be written.');
        data_respond(503, ['error' => 'mail_storage_unavailable', 'message' => 'Mail settings could not be stored on this server.']);
    }
    if (!chmod($temporaryPath, 0600)) {
        @unlink($temporaryPath);
        error_log('Ambients encrypted mail settings permissions could not be restricted.');
        data_respond(503, ['error' => 'mail_storage_unavailable', 'message' => 'Mail settings permissions could not be set.']);
    }
    if (!@rename($temporaryPath, $path)) {
        @unlink($temporaryPath);
        error_log('Ambients encrypted mail settings could not be installed.');
        data_respond(503, ['error' => 'mail_storage_unavailable', 'message' => 'Mail settings could not be stored on this server.']);
    }
}

function data_mail_password(array $settings): string
{
    $password = openssl_decrypt(
        base64_decode($settings['password'], true) ?: '',
        'aes-256-gcm',
        data_mail_key(),
        OPENSSL_RAW_DATA,
        base64_decode($settings['nonce'], true) ?: '',
        base64_decode($settings['tag'], true) ?: ''
    );
    if (!is_string($password) || $password === '') {
        error_log('Ambients saved mail credential could not be decrypted.');
        data_respond(503, ['error' => 'mail_credential_unavailable', 'message' => 'Saved mail credentials could not be read. Re-enter the mailbox password in Integrations.']);
    }
    return $password;
}

function data_mail_save_settings(string $email, string $displayName, string $password): void
{
    $existing = data_mail_settings();
    if ($password === '' && $existing === []) {
        data_respond(400, ['error' => 'mail_password_required', 'message' => 'Enter the Hostinger mailbox password.']);
    }

    if ($password === '') {
        $settings = [
            'emailAccount' => $email,
            'displayName' => $displayName,
            'password' => $existing['password'],
            'nonce' => $existing['nonce'],
            'tag' => $existing['tag'],
            'verified' => false,
        ];
    } else {
        $nonce = random_bytes(12);
        $tag = '';
        $ciphertext = openssl_encrypt($password, 'aes-256-gcm', data_mail_key(), OPENSSL_RAW_DATA, $nonce, $tag);
        if (!is_string($ciphertext) || $tag === '') {
            error_log('Ambients mail credential encryption failed.');
            data_respond(503, ['error' => 'mail_storage_unavailable', 'message' => 'The mailbox password could not be secured.']);
        }
        $settings = [
            'emailAccount' => $email,
            'displayName' => $displayName,
            'password' => base64_encode($ciphertext),
            'nonce' => base64_encode($nonce),
            'tag' => base64_encode($tag),
            'verified' => false,
        ];
    }

    if (isset($existing['campaignWorkerTokenHash'])) {
        $settings['campaignWorkerTokenHash'] = $existing['campaignWorkerTokenHash'];
    }
    data_mail_write_settings($settings);
}

function data_smtp_read_response($socket, array $expectedCodes): string
{
    $response = '';
    $code = '';
    $complete = false;
    for ($lineNumber = 0; $lineNumber < 50; $lineNumber++) {
        $line = fgets($socket, 2048);
        if ($line === false) {
            throw new RuntimeException('smtp_response_unavailable');
        }
        $response .= $line;
        if (preg_match('/^(\d{3})([ -])/', $line, $matches) !== 1) {
            throw new RuntimeException('smtp_invalid_response');
        }
        $code = $matches[1];
        if ($matches[2] === ' ') {
            $complete = true;
            break;
        }
    }
    if (!$complete || !in_array($code, $expectedCodes, true)) {
        throw new RuntimeException('smtp_unexpected_response_' . $code);
    }
    return $response;
}

function data_smtp_write_all($socket, string $data): void
{
    $offset = 0;
    $length = strlen($data);
    while ($offset < $length) {
        $written = fwrite($socket, substr($data, $offset));
        if ($written === false || $written === 0) {
            throw new RuntimeException('smtp_write_failed');
        }
        $offset += $written;
    }
}

function data_smtp_command($socket, string $command, array $expectedCodes): string
{
    $command .= "\r\n";
    data_smtp_write_all($socket, $command);
    return data_smtp_read_response($socket, $expectedCodes);
}

function data_smtp_connect(array $settings)
{
    $context = stream_context_create([
        'ssl' => [
            'verify_peer' => true,
            'verify_peer_name' => true,
            'peer_name' => 'smtp.hostinger.com',
            'SNI_enabled' => true,
        ],
    ]);
    $socket = @stream_socket_client(
        'ssl://smtp.hostinger.com:465',
        $errorNumber,
        $errorMessage,
        15,
        STREAM_CLIENT_CONNECT,
        $context
    );
    if ($socket === false) {
        throw new RuntimeException('smtp_connection_failed');
    }
    stream_set_timeout($socket, 15);

    try {
        data_smtp_read_response($socket, ['220']);
        data_smtp_command($socket, 'EHLO ambienta.io', ['250']);
        data_smtp_command($socket, 'AUTH LOGIN', ['334']);
        data_smtp_command($socket, base64_encode($settings['emailAccount']), ['334']);
        data_smtp_command($socket, base64_encode(data_mail_password($settings)), ['235']);
    } catch (Throwable $error) {
        fclose($socket);
        throw $error;
    }

    return $socket;
}

function data_mail_send(array $settings, string $recipient, string $subject, string $body, ?string $unsubscribeUrl = null): void
{
    $socket = data_smtp_connect($settings);
    try {
        data_smtp_command($socket, 'MAIL FROM:<' . $settings['emailAccount'] . '>', ['250']);
        data_smtp_command($socket, 'RCPT TO:<' . $recipient . '>', ['250', '251']);
        data_smtp_command($socket, 'DATA', ['354']);
        $encodedSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
        $encodedName = '=?UTF-8?B?' . base64_encode($settings['displayName']) . '?=';
        $headers = [
            'From: ' . $encodedName . ' <' . $settings['emailAccount'] . '>',
            'To: <' . $recipient . '>',
            'Subject: ' . $encodedSubject,
            'Date: ' . date(DATE_RFC2822),
            'Message-ID: <' . bin2hex(random_bytes(16)) . '@ambienta.io>',
            'MIME-Version: 1.0',
            'Content-Type: text/plain; charset=UTF-8',
            'Content-Transfer-Encoding: base64',
        ];
        if ($unsubscribeUrl !== null) {
            $headers[] = 'List-Unsubscribe: <' . $unsubscribeUrl . '>';
            $headers[] = 'List-Unsubscribe-Post: List-Unsubscribe=One-Click';
            $body .= "\n\n---\nTo stop receiving marketing emails, unsubscribe here:\n" . $unsubscribeUrl;
        }
        $message = implode("\r\n", $headers) . "\r\n\r\n" . chunk_split(base64_encode($body), 76, "\r\n") . ".\r\n";
        data_smtp_write_all($socket, $message);
        data_smtp_read_response($socket, ['250']);
        try {
            data_smtp_command($socket, 'QUIT', ['221']);
        } catch (Throwable $error) {
            error_log('Ambients SMTP session could not be closed cleanly after server acceptance.');
        }
    } finally {
        if (is_resource($socket)) fclose($socket);
    }
}

function data_campaign_recipient_snapshot(PDO $db): array
{
    $rows = $db->query(
        "SELECT MIN(id) AS lead_id, LOWER(TRIM(email)) AS recipient_email
         FROM leads
         WHERE marketing_consent = 1 AND TRIM(email) <> ''
         GROUP BY LOWER(TRIM(email))
         ORDER BY MIN(id)
         LIMIT 5001"
    )->fetchAll();
    if (count($rows) > 5000) {
        return array_slice($rows, 0, 5001);
    }
    $recipients = array_values(array_filter($rows, static fn (array $row): bool =>
        filter_var($row['recipient_email'] ?? null, FILTER_VALIDATE_EMAIL) !== false
    ));
    return $recipients;
}

function data_campaign_queue(PDO $db, int $campaignId, string $status, ?string $scheduledAt): int
{
    if (!in_array($status, ['sending', 'scheduled'], true)) {
        throw new RuntimeException('invalid_campaign_status');
    }

    $recipients = data_campaign_recipient_snapshot($db);
    if ($recipients === []) {
        throw new RuntimeException('campaign_audience_empty');
    }
    if (count($recipients) > 5000) {
        throw new RuntimeException('campaign_audience_too_large');
    }

    $db->beginTransaction();
    try {
        $find = $db->prepare("SELECT status FROM email_campaigns WHERE id = ? FOR UPDATE");
        $find->execute([$campaignId]);
        if ($find->fetchColumn() !== 'draft') {
            throw new RuntimeException('campaign_not_editable');
        }
        $db->prepare('DELETE FROM email_campaign_recipients WHERE campaign_id = ?')->execute([$campaignId]);
        $insert = $db->prepare(
            'INSERT INTO email_campaign_recipients (campaign_id, lead_id, recipient_email, status, unsubscribe_token_hash, unsubscribe_token)
             VALUES (?, ?, ?, ?, ?, ?)'
        );
        foreach ($recipients as $recipient) {
            $token = bin2hex(random_bytes(32));
            $insert->execute([
                $campaignId,
                (int) $recipient['lead_id'],
                (string) $recipient['recipient_email'],
                'queued',
                hash('sha256', $token),
                data_mail_encrypt_content($token),
            ]);
        }
        $db->prepare(
            'UPDATE email_campaigns SET status = ?, scheduled_at = ?, recipient_count = ?, sent_count = 0, failed_count = 0, unsubscribed_count = 0, completed_at = NULL WHERE id = ?'
        )->execute([$status, $scheduledAt, count($recipients), $campaignId]);
        $db->commit();
    } catch (Throwable $error) {
        if ($db->inTransaction()) $db->rollBack();
        throw $error;
    }

    return count($recipients);
}

function data_campaign_process_batch(array $settings, int $limit = 5): array
{
    $db = data_db();
    $db->exec(
        "UPDATE email_campaign_recipients
         SET status = 'failed'
         WHERE status = 'sending' AND claimed_at < UTC_TIMESTAMP() - INTERVAL 10 MINUTE"
    );
    $processed = 0;
    $sent = 0;
    $failed = 0;
    $unsubscribed = 0;

    for ($index = 0; $index < max(1, min($limit, 10)); $index++) {
        $db->beginTransaction();
        try {
            $statement = $db->query(
                "SELECT r.id, r.campaign_id, r.lead_id, r.recipient_email, r.unsubscribe_token,
                        c.subject, c.body, c.status AS campaign_status
                 FROM email_campaign_recipients r
                 INNER JOIN email_campaigns c ON c.id = r.campaign_id
                 WHERE r.status = 'queued'
                   AND (c.status = 'sending' OR (c.status = 'scheduled' AND c.scheduled_at <= UTC_TIMESTAMP()))
                 ORDER BY COALESCE(c.scheduled_at, c.created_at), r.id
                 LIMIT 1
                 FOR UPDATE"
            );
            $recipient = $statement->fetch();
            if (!is_array($recipient)) {
                $db->commit();
                break;
            }
            if ($recipient['campaign_status'] === 'scheduled') {
                $db->prepare("UPDATE email_campaigns SET status = 'sending' WHERE id = ? AND status = 'scheduled'")
                    ->execute([(int) $recipient['campaign_id']]);
            }
            $claim = $db->prepare("UPDATE email_campaign_recipients SET status = 'sending', claimed_at = UTC_TIMESTAMP() WHERE id = ? AND status = 'queued'");
            $claim->execute([(int) $recipient['id']]);
            if ($claim->rowCount() !== 1) {
                $db->commit();
                continue;
            }
            $db->commit();
        } catch (Throwable $error) {
            if ($db->inTransaction()) $db->rollBack();
            throw $error;
        }

        $processed++;
        $consent = $db->prepare('SELECT marketing_consent FROM leads WHERE id = ? AND LOWER(TRIM(email)) = LOWER(?)');
        $consent->execute([(int) $recipient['lead_id'], (string) $recipient['recipient_email']]);
        if ((int) $consent->fetchColumn() !== 1) {
            $db->prepare("UPDATE email_campaign_recipients SET status = 'unsubscribed' WHERE id = ?")->execute([(int) $recipient['id']]);
            $unsubscribed++;
            continue;
        }

        $token = data_mail_decrypt_content((string) $recipient['unsubscribe_token']);
        $unsubscribeUrl = 'https://ambienta.io/api/data.php?resource=email-unsubscribe&token=' . rawurlencode($token);
        $message = data_mail_decrypt_content((string) $recipient['body']);
        $activityId = null;
        try {
            $db->prepare('INSERT INTO email_activity (recipient_email, subject, body, status) VALUES (?, ?, ?, ?)')->execute([
                (string) $recipient['recipient_email'],
                (string) $recipient['subject'],
                data_mail_encrypt_content($message . "\n\n---\nTo stop receiving marketing emails, unsubscribe here:\n" . $unsubscribeUrl),
                'Queued',
            ]);
            $activityId = $db->lastInsertId();
            data_mail_send($settings, (string) $recipient['recipient_email'], (string) $recipient['subject'], $message, $unsubscribeUrl);
            $db->prepare("UPDATE email_campaign_recipients SET status = 'sent', sent_at = UTC_TIMESTAMP() WHERE id = ?")->execute([(int) $recipient['id']]);
            $db->prepare("UPDATE email_activity SET status = 'Sent' WHERE id = ?")->execute([$activityId]);
            $sent++;
        } catch (Throwable $error) {
            $db->prepare("UPDATE email_campaign_recipients SET status = 'failed' WHERE id = ?")->execute([(int) $recipient['id']]);
            if ($activityId !== null) {
                $db->prepare("UPDATE email_activity SET status = 'Failed' WHERE id = ?")->execute([$activityId]);
            }
            error_log('Ambients email campaign recipient send failed: ' . $error->getMessage());
            $failed++;
        }
    }

    $db->exec(
        "        UPDATE email_campaigns AS c
        SET sent_count = (
                SELECT COUNT(*) FROM email_campaign_recipients r
                WHERE r.campaign_id = c.id AND r.status = 'sent'
             ),
            failed_count = (
                SELECT COUNT(*) FROM email_campaign_recipients r
                WHERE r.campaign_id = c.id AND r.status = 'failed'
             ),
            unsubscribed_count = (
               SELECT COUNT(*) FROM email_campaign_recipients r
               WHERE r.campaign_id = c.id AND r.status = 'unsubscribed'
            ),
            completed_at = CASE
               WHEN NOT EXISTS (
                   SELECT 1 FROM email_campaign_recipients r
                   WHERE r.campaign_id = c.id AND r.status IN ('queued', 'sending')
               ) AND c.completed_at IS NULL THEN UTC_TIMESTAMP()
               ELSE c.completed_at
            END,
            status = CASE
               WHEN NOT EXISTS (
                   SELECT 1 FROM email_campaign_recipients r
                   WHERE r.campaign_id = c.id AND r.status IN ('queued', 'sending')
               ) AND c.status IN ('sending', 'scheduled') THEN
                   CASE
                       WHEN NOT EXISTS (
                           SELECT 1 FROM email_campaign_recipients r
                           WHERE r.campaign_id = c.id AND r.status = 'sent'
                       ) AND EXISTS (
                           SELECT 1 FROM email_campaign_recipients r
                           WHERE r.campaign_id = c.id AND r.status = 'failed'
                       ) THEN 'failed'
                       WHEN EXISTS (
                           SELECT 1 FROM email_campaign_recipients r
                           WHERE r.campaign_id = c.id AND r.status = 'failed'
                       ) THEN 'partial'
                       ELSE 'sent'
                   END
               ELSE c.status
            END,
         WHERE c.status IN ('sending', 'scheduled')"
    );

    return ['processed' => $processed, 'sent' => $sent, 'failed' => $failed, 'unsubscribed' => $unsubscribed];
}

function data_imap_quote(string $value): string
{
    if (preg_match('/[\r\n\x00]/', $value) === 1) {
        throw new RuntimeException('imap_invalid_argument');
    }
    return '"' . addcslashes($value, "\\\"") . '"';
}

function data_imap_command($socket, int &$commandNumber, string $command): array
{
    $tag = 'A' . str_pad((string) ++$commandNumber, 4, '0', STR_PAD_LEFT);
    data_smtp_write_all($socket, $tag . ' ' . $command . "\r\n");
    $lines = [];
    $literals = [];
    $complete = false;
    for ($lineNumber = 0; $lineNumber < 300; $lineNumber++) {
        $line = fgets($socket, 8192);
        if ($line === false) {
            throw new RuntimeException('imap_response_unavailable');
        }
        $lines[] = $line;
        if (preg_match('/\{(\d+)\+?\}\r?\n$/', $line, $matches) === 1) {
            $literalLength = (int) $matches[1];
            if ($literalLength > 1048576) {
                throw new RuntimeException('imap_literal_too_large');
            }
            $literal = $literalLength === 0 ? '' : stream_get_contents($socket, $literalLength);
            if (!is_string($literal) || strlen($literal) !== $literalLength) {
                throw new RuntimeException('imap_literal_incomplete');
            }
            $literals[] = $literal;
            continue;
        }
        if (preg_match('/^' . preg_quote($tag, '/') . ' (OK|NO|BAD)\b/i', $line, $matches) === 1) {
            if (strtoupper($matches[1]) !== 'OK') {
                throw new RuntimeException('imap_command_rejected');
            }
            $complete = true;
            break;
        }
    }
    if (!$complete) {
        throw new RuntimeException('imap_response_incomplete');
    }
    return ['lines' => $lines, 'literals' => $literals];
}

function data_imap_decode_header(string $value): string
{
    $decoded = function_exists('iconv_mime_decode')
        ? iconv_mime_decode($value, ICONV_MIME_DECODE_CONTINUE_ON_ERROR, 'UTF-8')
        : false;
    return is_string($decoded) ? $decoded : trim($value);
}

function data_imap_decode_body(string $contentType, string $transferEncoding, string $rawBody): string
{
    if (preg_match('/^multipart\/[^;]+;\s*boundary="?([^";]+)"?/i', $contentType, $boundaryMatches) === 1) {
        $boundary = $boundaryMatches[1];
        foreach (explode('--' . $boundary, $rawBody) as $part) {
            if (preg_match('/\r?\n\r?\n/', $part, $separator, PREG_OFFSET_CAPTURE) !== 1) continue;
            $separatorOffset = $separator[0][1] + strlen($separator[0][0]);
            $partHeaders = substr($part, 0, $separator[0][1]);
            if (preg_match('/^Content-Type:\s*text\/plain\b[^\r\n]*/im', $partHeaders, $typeMatch) !== 1) continue;
            preg_match('/^Content-Transfer-Encoding:\s*([^\r\n]+)/im', $partHeaders, $encodingMatch);
            return data_imap_decode_body(
                trim($typeMatch[0]),
                trim($encodingMatch[1] ?? ''),
                substr($part, $separatorOffset)
            );
        }
        return '';
    }

    $body = match (strtolower(trim($transferEncoding))) {
        'base64' => base64_decode(preg_replace('/\s+/', '', $rawBody) ?? '', true) ?: '',
        'quoted-printable' => quoted_printable_decode($rawBody),
        default => $rawBody,
    };
    if (str_starts_with(strtolower($contentType), 'text/html')) {
        $body = html_entity_decode(strip_tags($body), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    }
    return trim(substr($body, 0, 8000));
}

function data_imap_connect(array $settings)
{
    $context = stream_context_create([
        'ssl' => [
            'verify_peer' => true,
            'verify_peer_name' => true,
            'peer_name' => 'imap.hostinger.com',
            'SNI_enabled' => true,
        ],
    ]);
    $socket = @stream_socket_client(
        'ssl://imap.hostinger.com:993',
        $errorNumber,
        $errorMessage,
        15,
        STREAM_CLIENT_CONNECT,
        $context
    );
    if ($socket === false) {
        throw new RuntimeException('imap_connection_failed');
    }
    stream_set_timeout($socket, 15);
    $greeting = fgets($socket, 8192);
    if ($greeting === false || !str_starts_with($greeting, '* OK')) {
        fclose($socket);
        throw new RuntimeException('imap_greeting_failed');
    }

    $commandNumber = 0;
    try {
        data_imap_command(
            $socket,
            $commandNumber,
            'LOGIN ' . data_imap_quote($settings['emailAccount']) . ' ' . data_imap_quote(data_mail_password($settings))
        );
    } catch (Throwable $error) {
        fclose($socket);
        throw $error;
    }
    return [$socket, $commandNumber];
}

function data_imap_folders(array $settings): array
{
    [$socket, $commandNumber] = data_imap_connect($settings);
    try {
        $result = data_imap_command($socket, $commandNumber, 'LIST "" "*"');
        $folders = [];
        foreach ($result['lines'] as $line) {
            if (preg_match('/^\* LIST \([^)]*\) (?:NIL|"(?:\\\\.|[^"])*") ("(?:\\\\.|[^"])*")\r?\n$/', $line, $matches) === 1) {
                $folder = stripcslashes(substr($matches[1], 1, -1));
                if ($folder !== '') $folders[] = $folder;
            }
        }
        data_imap_command($socket, $commandNumber, 'LOGOUT');
        return array_values(array_unique($folders));
    } finally {
        if (is_resource($socket)) fclose($socket);
    }
}

function data_imap_resolve_folder(array $folders, string $kind): ?string
{
    foreach ($folders as $folder) {
        if (!is_string($folder)) continue;
        $normalized = strtolower(str_replace(['.', ' ', '_', '-'], '', $folder));
        if ($kind === 'inbox' && $normalized === 'inbox') return $folder;
        if ($kind === 'sent' && str_contains($normalized, 'sent')) return $folder;
        if ($kind === 'trash' && (str_contains($normalized, 'trash') || str_contains($normalized, 'deleted'))) return $folder;
    }
    return null;
}

function data_imap_folder_messages(array $settings, string $folder, int $limit = 20): array
{
    [$socket, $commandNumber] = data_imap_connect($settings);
    try {
        data_imap_command($socket, $commandNumber, 'SELECT ' . data_imap_quote($folder));
        $search = data_imap_command($socket, $commandNumber, 'UID SEARCH ALL');
        $uidLine = '';
        foreach ($search['lines'] as $line) {
            if (preg_match('/^\* SEARCH(?:\s+(.*?))?\r?\n$/', $line, $matches) === 1) {
                $uidLine = trim($matches[1] ?? '');
                break;
            }
        }
        $uids = $uidLine === '' ? [] : preg_split('/\s+/', $uidLine);
        if (!is_array($uids)) $uids = [];
        $uids = array_slice(array_reverse($uids), 0, max(1, min($limit, 50)));
        $messages = [];

        foreach ($uids as $uid) {
            if (!is_string($uid) || !ctype_digit($uid)) continue;
            $fetch = data_imap_command(
                $socket,
                $commandNumber,
                'UID FETCH ' . $uid . ' (UID FLAGS INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE CONTENT-TYPE CONTENT-TRANSFER-ENCODING)] BODY.PEEK[TEXT]<0.8192>)'
            );
            $header = $fetch['literals'][0] ?? '';
            $rawBody = $fetch['literals'][1] ?? '';
            $fields = [];
            $currentField = '';
            foreach (preg_split('/\r?\n/', $header) ?: [] as $headerLine) {
                if ($headerLine === '') continue;
                if (preg_match('/^[ \t]/', $headerLine) === 1 && $currentField !== '') {
                    $fields[$currentField] .= ' ' . trim($headerLine);
                    continue;
                }
                if (preg_match('/^([A-Za-z0-9-]+):\s*(.*)$/', $headerLine, $headerMatches) === 1) {
                    $currentField = strtolower($headerMatches[1]);
                    $fields[$currentField] = trim($headerMatches[2]);
                }
            }
            $metadata = implode('', $fetch['lines']);
            $internalDate = '';
            if (preg_match('/INTERNALDATE "([^"]+)"/', $metadata, $dateMatches) === 1) {
                $internalDate = $dateMatches[1];
            }
            $contentType = $fields['content-type'] ?? 'text/plain';
            $contentTransferEncoding = $fields['content-transfer-encoding'] ?? '';
            $messages[] = [
                'id' => $uid,
                'folder' => $folder,
                'from' => data_imap_decode_header($fields['from'] ?? ''),
                'subject' => data_imap_decode_header($fields['subject'] ?? '(no subject)'),
                'date' => $fields['date'] ?? $internalDate,
                'body' => data_imap_decode_body($contentType, $contentTransferEncoding, $rawBody),
                'unread' => preg_match('/\bFLAGS\s+\([^)]*\\\\Seen/', $metadata) !== 1,
            ];
        }

        data_imap_command($socket, $commandNumber, 'LOGOUT');
        return $messages;
    } finally {
        if (is_resource($socket)) fclose($socket);
    }
}

function data_imap_move_message(array $settings, string $uid, string $sourceKind, string $targetKind): void
{
    if (!ctype_digit($uid) || !in_array($sourceKind, ['inbox', 'trash'], true) || !in_array($targetKind, ['inbox', 'trash'], true)) {
        throw new RuntimeException('imap_invalid_message_operation');
    }
    $folders = data_imap_folders($settings);
    $source = data_imap_resolve_folder($folders, $sourceKind);
    $target = data_imap_resolve_folder($folders, $targetKind);
    if ($source === null || $target === null) {
        throw new RuntimeException('imap_mailbox_folder_unavailable');
    }
    [$socket, $commandNumber] = data_imap_connect($settings);
    try {
        data_imap_command($socket, $commandNumber, 'SELECT ' . data_imap_quote($source));
        data_imap_command($socket, $commandNumber, 'UID MOVE ' . $uid . ' ' . data_imap_quote($target));
        data_imap_command($socket, $commandNumber, 'LOGOUT');
    } finally {
        if (is_resource($socket)) fclose($socket);
    }
}

function data_imap_delete_message(array $settings, string $uid): void
{
    if (!ctype_digit($uid)) throw new RuntimeException('imap_invalid_message_operation');
    $folders = data_imap_folders($settings);
    $trash = data_imap_resolve_folder($folders, 'trash');
    if ($trash === null) throw new RuntimeException('imap_mailbox_folder_unavailable');
    [$socket, $commandNumber] = data_imap_connect($settings);
    try {
        data_imap_command($socket, $commandNumber, 'SELECT ' . data_imap_quote($trash));
        data_imap_command($socket, $commandNumber, 'UID STORE ' . $uid . ' +FLAGS.SILENT (\\Deleted)');
        data_imap_command($socket, $commandNumber, 'UID EXPUNGE ' . $uid);
        data_imap_command($socket, $commandNumber, 'LOGOUT');
    } finally {
        if (is_resource($socket)) fclose($socket);
    }
}

function data_lead_row(array $row): array
{
    $lead = [
        'id' => (int) $row['id'],
        'firstName' => $row['first_name'],
        'lastName' => $row['last_name'],
        'email' => $row['email'],
        'phone' => $row['phone'],
        'country' => $row['country'] ?? '',
        'leadSource' => $row['lead_source'],
        'createdAt' => $row['created_at'],
        'status' => $row['status'] ?? 'Cold',
        'marketingConsent' => (bool) ($row['marketing_consent'] ?? false),
        'marketingConsentAt' => $row['marketing_consent_at'] ?? null,
    ];
    $canViewOrders = ($_SESSION['admin_role'] ?? '') === 'admin'
        || in_array('orders', $_SESSION['admin_permissions'] ?? [], true);
    if ($canViewOrders && array_key_exists('order_count', $row)) $lead['orderCount'] = (int) $row['order_count'];
    if ($canViewOrders && array_key_exists('last_order_at', $row)) $lead['lastOrderAt'] = $row['last_order_at'];
    if ($canViewOrders && array_key_exists('active_order_count', $row)) $lead['activeOrderCount'] = (int) $row['active_order_count'];
    if (array_key_exists('call_count', $row)) $lead['callCount'] = (int) $row['call_count'];
    if (array_key_exists('assigned_staff_id', $row)) $lead['assignedStaffId'] = $row['assigned_staff_id'] === null ? null : (int) $row['assigned_staff_id'];
    if (array_key_exists('assigned_staff_name', $row)) $lead['assignedStaffName'] = $row['assigned_staff_name'];
    return $lead;
}

function data_lead_activities(PDO $db, int $leadId): array
{
    $activities = [];
    $audit = $db->prepare(
        "SELECT id, actor_email, action, details, created_at
         FROM admin_audit_log
         WHERE entity_type = 'lead' AND entity_id = ? AND action IN ('lead.stage_changed', 'lead.phone_updated')
         ORDER BY id DESC LIMIT 200"
    );
    $audit->execute([(string) $leadId]);
    foreach ($audit->fetchAll() as $row) {
        $details = is_array($row['details']) ? $row['details'] : json_decode((string) ($row['details'] ?? ''), true);
        if (!is_array($details)) $details = [];
        $isStageChange = $row['action'] === 'lead.stage_changed';
        $activities[] = [
            'id' => 'audit-' . (string) $row['id'],
            'type' => $isStageChange ? 'status_change' : 'phone_updated',
            'note' => isset($details['note']) && is_string($details['note']) ? $details['note'] : '',
            'fromStatus' => isset($details['from']) && is_string($details['from']) ? $details['from'] : null,
            'toStatus' => isset($details['to']) && is_string($details['to']) ? $details['to'] : null,
            'actorName' => isset($details['actorName']) && is_string($details['actorName']) && $details['actorName'] !== ''
                ? $details['actorName']
                : (string) $row['actor_email'],
            'actorEmail' => (string) $row['actor_email'],
            'createdAt' => (string) $row['created_at'],
        ];
    }

    $query = $db->prepare(
        'SELECT id, activity_type, note, call_outcome, follow_up_date, author_email, author_name, created_at
         FROM lead_activities WHERE lead_id = ? ORDER BY id DESC LIMIT 200'
    );
    $query->execute([$leadId]);
    foreach ($query->fetchAll() as $row) {
        $activities[] = [
            'id' => 'activity-' . (string) $row['id'],
            'type' => $row['activity_type'],
            'note' => $row['note'] ?? '',
            'outcome' => $row['call_outcome'],
            'followUpDate' => $row['follow_up_date'],
            'actorName' => (string) $row['author_name'],
            'actorEmail' => (string) $row['author_email'],
            'createdAt' => (string) $row['created_at'],
        ];
    }

    usort($activities, static fn (array $a, array $b): int => strcmp($b['createdAt'], $a['createdAt']));
    return array_slice($activities, 0, 200);
}

function data_product_row(array $row): array
{
    $stock = (int) $row['stock_count'];
    $images = json_decode((string) ($row['images'] ?? ''), true);
    if (!is_array($images)) {
        $images = [];
    }
    $images = array_values(array_filter($images, static fn ($image): bool => is_string($image) && $image !== ''));
    if ($images === [] && is_string($row['image'] ?? null) && $row['image'] !== '') {
        $images = [$row['image']];
    }
    return [
        'id' => $row['id'],
        'name' => $row['name'],
        'category' => $row['category'],
        'description' => $row['description'],
        'rxRequired' => (bool) $row['rx_required'],
        'dosage' => $row['dosage'],
        'sku' => $row['sku'],
        'ndcCode' => $row['ndc_code'],
        'image' => $images[0] ?? $row['image'],
        'images' => $images,
        'price' => (float) $row['price'],
        'costPrice' => $row['cost_price'] === null ? null : (float) $row['cost_price'],
        'copayPrice' => $row['copay_price'] === null ? null : (float) $row['copay_price'],
        'stockCount' => $stock,
        'minStockThreshold' => (int) $row['min_stock_threshold'],
        'inStock' => $stock > 0 && (bool) $row['is_active'],
        'isActive' => (bool) $row['is_active'],
        'isFeatured' => (bool) ($row['is_featured'] ?? false),
        'lastRestocked' => $row['last_restocked'],
    ];
}

function data_audit(PDO $db, string $action, string $entityType, string $entityId, array $details = []): void
{
    $encoded = json_encode($details, JSON_UNESCAPED_SLASHES);
    if ($encoded === false) {
        throw new RuntimeException('Audit detail encoding failed.');
    }
    $actor = is_string($_SESSION['impersonated_by'] ?? null)
        ? $_SESSION['impersonated_by']
        : (is_string($_SESSION['admin_email'] ?? null) ? $_SESSION['admin_email'] : 'unknown');
    if (!empty($_SESSION['is_impersonating']) && is_string($_SESSION['admin_email'] ?? null)) {
        $details['actingAs'] = $_SESSION['admin_email'];
    }
    $db->prepare(
        'INSERT INTO admin_audit_log (actor_email, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)'
    )->execute([$actor, $action, $entityType, $entityId, $encoded]);
}

function data_product_input(PDO $db, array $body, bool $isUpdate): array
{
    $id = $isUpdate ? data_string($body, 'id', 64) : data_string($body, 'id', 64);
    $name = data_string($body, 'name', 180);
    $category = data_string($body, 'category', 80);
    $description = data_string($body, 'description', 3000, false);
    $dosage = data_string($body, 'dosage', 120, false);
    $sku = data_string($body, 'sku', 80);
    $ndc = data_string($body, 'ndcCode', 32, false);
    $image = data_string($body, 'image', 500, false);
    $images = $body['images'] ?? null;
    if ($images !== null && (!is_array($images) || count($images) > 10)) {
        data_respond(400, ['error' => 'invalid_product_images', 'message' => 'A product can have up to 10 images.']);
    }
    if ($images === null) {
        $images = $image === '' ? [] : [$image];
    }
    $validatedImages = [];
    foreach ($images as $productImage) {
        if (!is_string($productImage) || $productImage === '' || strlen($productImage) > 500) {
            data_respond(400, ['error' => 'invalid_product_images', 'message' => 'A product image URL is invalid.']);
        }
        if (!in_array($productImage, $validatedImages, true)) {
            $validatedImages[] = $productImage;
        }
    }
    if ($image !== '' && !in_array($image, $validatedImages, true)) {
        array_unshift($validatedImages, $image);
    }
    if (count($validatedImages) > 10) {
        data_respond(400, ['error' => 'invalid_product_images', 'message' => 'A product can have up to 10 images.']);
    }
    $price = $body['price'] ?? null;
    $stock = $body['stockCount'] ?? null;
    $minimum = $body['minStockThreshold'] ?? 0;
    $cost = $body['costPrice'] ?? null;
    $copay = $body['copayPrice'] ?? null;
    if (!is_numeric($price) || (float) $price < 0 || (float) $price > 99999999.99) {
        data_respond(400, ['error' => 'invalid_price', 'message' => 'Enter a valid product price.']);
    }
    if (!is_int($stock) || $stock < 0 || $stock > 100000000 || !is_int($minimum) || $minimum < 0 || $minimum > 100000000) {
        data_respond(400, ['error' => 'invalid_stock', 'message' => 'Stock values must be non-negative whole numbers.']);
    }
    if (
        ($cost !== null && (!is_numeric($cost) || (float) $cost < 0 || (float) $cost > 99999999.99))
        || ($copay !== null && (!is_numeric($copay) || (float) $copay < 0 || (float) $copay > 99999999.99))
    ) {
        data_respond(400, ['error' => 'invalid_price', 'message' => 'Cost and copay must be non-negative amounts.']);
    }
    if (!is_bool($body['rxRequired'] ?? null)) {
        data_respond(400, ['error' => 'invalid_product', 'message' => 'Prescription status must be specified.']);
    }
    $categoryQuery = $db->prepare('SELECT name FROM product_categories WHERE name = ? AND is_active = 1');
    $categoryQuery->execute([$category]);
    $savedCategory = $categoryQuery->fetchColumn();
    if (!$savedCategory) {
        data_respond(400, ['error' => 'invalid_category', 'message' => 'Choose an existing active product category.']);
    }
    $category = (string) $savedCategory;
    $isActive = $body['isActive'] ?? true;
    $isFeatured = $body['isFeatured'] ?? false;
    if (!is_bool($isActive) || !is_bool($isFeatured)) {
        data_respond(400, ['error' => 'invalid_product', 'message' => 'Storefront visibility and featured status must be true or false.']);
    }
    return [
        'id' => $id,
        'name' => $name,
        'category' => $category,
        'description' => $description,
        'rxRequired' => $body['rxRequired'],
        'dosage' => $dosage,
        'sku' => $sku,
        'ndcCode' => $ndc === '' ? null : $ndc,
        'image' => $validatedImages[0] ?? null,
        'images' => $validatedImages,
        'price' => round((float) $price, 2),
        'costPrice' => $cost === null ? null : round((float) $cost, 2),
        'copayPrice' => $copay === null ? null : round((float) $copay, 2),
        'stockCount' => $stock,
        'minStockThreshold' => $minimum,
        'inStock' => $stock > 0,
        'isActive' => $isActive,
        'isFeatured' => $isFeatured,
    ];
}

function data_order_row(PDO $db, array $row): array
{
    $statement = $db->prepare(
        'SELECT product_id, product_name, category, quantity, unit_price FROM order_items WHERE order_id = ? ORDER BY id'
    );
    $statement->execute([$row['id']]);
    $items = array_map(
        static fn (array $item): array => [
            'productId' => $item['product_id'],
            'name' => $item['product_name'],
            'category' => $item['category'],
            'quantity' => (int) $item['quantity'],
            'unitPrice' => (float) $item['unit_price'],
        ],
        $statement->fetchAll()
    );
    $medicationSummary = count($items) === 1
        ? $items[0]['name']
        : (count($items) > 1 ? $items[0]['name'] . ' + ' . (count($items) - 1) . ' item(s)' : 'Store purchase');
    $noteQuery = $db->prepare('SELECT id, author_email, note, created_at FROM order_notes WHERE order_id = ? ORDER BY id DESC');
    $noteQuery->execute([$row['id']]);
    $notes = array_map(
        static fn (array $note): string => '[' . $note['created_at'] . ' ' . $note['author_email'] . '] ' . $note['note'],
        $noteQuery->fetchAll()
    );

    return [
        'id' => $row['id'],
        'orderNumber' => $row['order_number'],
        'patientName' => $row['customer_name'],
        'email' => $row['email'],
        'phone' => $row['phone'],
        'medicationName' => $medicationSummary,
        'items' => $items,
        'subtotal' => (float) $row['subtotal'],
        'shippingFee' => (float) $row['shipping_fee'],
        'discountAmount' => (float) $row['discount_amount'],
        'couponCode' => $row['coupon_code'],
        'totalAmount' => (float) $row['total_amount'],
        'orderType' => 'Store Purchase',
        'deliveryMethod' => $row['delivery_method'],
        'deliveryAddress' => $row['delivery_address'],
        'paymentMethod' => $row['payment_method'],
        'paymentStatus' => $row['payment_status'],
        'status' => $row['status'],
        'placedAt' => $row['placed_at'],
        'carrier' => $row['carrier'],
        'trackingNumber' => $row['tracking_number'],
        'internalNotes' => $notes,
    ];
}

$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? ''));
$resource = $_GET['resource'] ?? '';
if (!is_string($resource)) {
    data_respond(400, ['error' => 'invalid_resource', 'message' => 'The requested resource is invalid.']);
}

if ($resource === 'email-unsubscribe') {
    $token = $_GET['token'] ?? ($_POST['token'] ?? '');
    if ($method === 'POST' && $token === '') {
        parse_str((string) file_get_contents('php://input'), $postBody);
        $token = is_array($postBody) ? ($postBody['token'] ?? '') : '';
    }
    if (!is_string($token) || preg_match('/^[a-f0-9]{64}$/', $token) !== 1) {
        data_respond(400, ['error' => 'invalid_unsubscribe_token', 'message' => 'This unsubscribe link is invalid or expired.']);
    }

    $db = data_db();
    $lookup = $db->prepare('SELECT id, lead_id, recipient_email FROM email_campaign_recipients WHERE unsubscribe_token_hash = ? LIMIT 1');
    $lookup->execute([hash('sha256', $token)]);
    $recipient = $lookup->fetch();
    if (!is_array($recipient)) {
        data_respond(404, ['error' => 'unsubscribe_link_not_found', 'message' => 'This unsubscribe link is invalid or expired.']);
    }

    if ($method === 'GET') {
        header('Content-Type: text/html; charset=utf-8');
        header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'");
        echo '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email preferences</title><body style="font:16px system-ui,sans-serif;max-width:560px;margin:12vh auto;padding:24px;color:#172033"><h1>Unsubscribe from marketing emails</h1><p>Confirm to stop receiving marketing emails from Ambienta.</p><form method="post"><input type="hidden" name="token" value="' . htmlspecialchars($token, ENT_QUOTES, 'UTF-8') . '"><button style="background:#5b21b6;color:white;border:0;border-radius:8px;padding:12px 18px;font:inherit;cursor:pointer" type="submit">Unsubscribe</button></form></body></html>';
        exit;
    }

    if ($method === 'POST') {
        parse_str((string) file_get_contents('php://input'), $postBody);
        $oneClick = is_array($postBody) && ($postBody['List-Unsubscribe'] ?? '') === 'One-Click';
        $manualConfirm = isset($_POST['token']) && hash_equals($token, (string) $_POST['token']);
        if (!$oneClick && !$manualConfirm) {
            data_respond(400, ['error' => 'unsubscribe_confirmation_required', 'message' => 'Confirm your unsubscribe request and try again.']);
        }
        $db->beginTransaction();
        try {
            $db->prepare('UPDATE leads SET marketing_consent = 0, marketing_consent_at = NULL WHERE email = ?')
                ->execute([(string) $recipient['recipient_email']]);
            $db->prepare("UPDATE email_campaign_recipients SET status = 'unsubscribed' WHERE recipient_email = ? AND status = 'queued'")
                ->execute([(string) $recipient['recipient_email']]);
            $db->commit();
        } catch (Throwable $error) {
            if ($db->inTransaction()) $db->rollBack();
            error_log('Ambients email unsubscribe could not be saved: ' . $error->getMessage());
            data_respond(503, ['error' => 'unsubscribe_unavailable', 'message' => 'Your preferences could not be updated. Please try again later.']);
        }
        header('Content-Type: text/html; charset=utf-8');
        header("Content-Security-Policy: default-src 'none'; base-uri 'none'");
        echo '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email preferences updated</title><body style="font:16px system-ui,sans-serif;max-width:560px;margin:12vh auto;padding:24px;color:#172033"><h1>You are unsubscribed</h1><p>You will no longer receive marketing emails from Ambienta.</p></body></html>';
        exit;
    }
    data_respond(405, ['error' => 'method_not_allowed', 'message' => 'Use the unsubscribe confirmation form.']);
}

if ($resource === 'email-campaign-process') {
    if ($method !== 'POST') {
        data_respond(405, ['error' => 'method_not_allowed', 'message' => 'The campaign worker accepts POST requests only.']);
    }
    $settings = data_mail_settings();
    $authorization = (string) ($_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
    if (preg_match('/^Bearer ([a-f0-9]{64})$/', $authorization, $matches) !== 1
        || !isset($settings['campaignWorkerTokenHash'])
        || !is_string($settings['campaignWorkerTokenHash'])
        || !hash_equals($settings['campaignWorkerTokenHash'], hash('sha256', $matches[1]))) {
        data_respond(401, ['error' => 'campaign_worker_unauthorized', 'message' => 'The campaign worker token is invalid.']);
    }
    if (empty($settings['verified'])) {
        data_respond(409, ['error' => 'mail_not_verified', 'message' => 'Verify Hostinger SMTP under Integrations before processing campaigns.']);
    }
    try {
        data_respond(200, data_campaign_process_batch($settings));
    } catch (Throwable $error) {
        error_log('Ambients email campaign worker failed: ' . $error->getMessage());
        data_respond(503, ['error' => 'campaign_worker_failed', 'message' => 'The campaign batch could not be processed. Check the server logs and try again.']);
    }
}

if (in_array($resource, [
    'email-settings', 'email-test', 'email-send', 'email-activity', 'email-inbox',
    'email-message-trash', 'email-message-restore', 'email-message-purge',
    'email-drafts', 'email-draft', 'email-draft-trash', 'email-draft-restore',
    'email-draft-purge', 'email-draft-remove', 'email-campaigns',
    'email-campaign-audience', 'email-campaign-save', 'email-campaign-launch',
    'email-campaign-schedule', 'email-campaign-cancel', 'email-campaign-worker-token',
], true)) {
    if ($method === 'GET' && $resource === 'email-settings') {
        data_require_permission('integrations');
        $settings = data_mail_settings();
        data_respond(200, [
            'configured' => $settings !== [],
            'verified' => (bool) ($settings['verified'] ?? false),
            'emailAccount' => $settings['emailAccount'] ?? 'customersupport@ambienta.io',
            'displayName' => $settings['displayName'] ?? 'Ambienta Customer Support',
            'smtpHost' => 'smtp.hostinger.com',
            'smtpPort' => 465,
        ]);
    }

    if ($method === 'POST' && $resource === 'email-settings') {
        data_require_admin('admin');
        $body = data_read_json(4096);
        $email = strtolower(data_string($body, 'emailAccount', 254));
        $displayName = data_string($body, 'displayName', 120);
        $password = $body['password'] ?? '';
        if (!is_string($password) || strlen($password) > 1024) {
            data_respond(400, ['error' => 'invalid_mail_settings', 'message' => 'The mailbox password is invalid.']);
        }
        if ($email !== 'customersupport@ambienta.io' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            data_respond(400, ['error' => 'invalid_mail_account', 'message' => 'Use the Hostinger mailbox customersupport@ambienta.io.']);
        }
        if (preg_match('/[\r\n\x00]/', $displayName) === 1) {
            data_respond(400, ['error' => 'invalid_mail_settings', 'message' => 'The sender display name is invalid.']);
        }
        data_mail_save_settings($email, $displayName, $password);
        data_respond(200, ['configured' => true, 'emailAccount' => $email, 'displayName' => $displayName]);
    }

    if ($method === 'POST' && $resource === 'email-test') {
        data_require_permission('integrations');
        data_read_json(1024);
        $settings = data_mail_settings();
        if ($settings === []) {
            data_respond(409, ['error' => 'mail_not_configured', 'message' => 'Save the Hostinger mailbox password before testing the connection.']);
        }
        $socket = null;
        try {
            $socket = data_smtp_connect($settings);
            data_smtp_command($socket, 'QUIT', ['221']);
        } catch (Throwable $error) {
            error_log('Ambients Hostinger SMTP connection test failed: ' . $error->getMessage());
            $settings['verified'] = false;
            data_mail_write_settings($settings);
            data_respond(502, ['error' => 'mail_connection_failed', 'message' => 'Hostinger SMTP authentication failed. Verify the mailbox password and try again.']);
        } finally {
            if (is_resource($socket)) fclose($socket);
        }
        $imapSocket = null;
        try {
            [$imapSocket, $imapCommandNumber] = data_imap_connect($settings);
            data_imap_command($imapSocket, $imapCommandNumber, 'LOGOUT');
        } catch (Throwable $error) {
            error_log('Ambients Hostinger IMAP connection test failed: ' . $error->getMessage());
            $settings['verified'] = false;
            data_mail_write_settings($settings);
            data_respond(502, ['error' => 'mail_connection_failed', 'message' => 'Hostinger SMTP connected, but IMAP authentication failed. Verify that IMAP is enabled for this mailbox.']);
        } finally {
            if (is_resource($imapSocket)) fclose($imapSocket);
        }
        $settings['verified'] = true;
        data_mail_write_settings($settings);
        data_respond(200, ['connected' => true, 'message' => 'Hostinger SMTP and IMAP authentication succeeded.']);
    }

    if ($method === 'GET' && $resource === 'email-inbox') {
        data_require_permission('integrations');
        $settings = data_mail_settings();
        if ($settings === []) {
            data_respond(409, ['error' => 'mail_not_configured', 'message' => 'Configure the Hostinger mailbox under Integrations before opening the inbox.']);
        }
        $folderKind = $_GET['folder'] ?? 'inbox';
        if (!is_string($folderKind) || !in_array($folderKind, ['inbox', 'sent', 'trash'], true)) {
            data_respond(400, ['error' => 'invalid_mail_folder', 'message' => 'The requested mailbox folder is invalid.']);
        }
        try {
            $folders = data_imap_folders($settings);
            $folder = data_imap_resolve_folder($folders, $folderKind);
            $mailboxMessages = $folder === null ? [] : data_imap_folder_messages($settings, $folder);
            data_respond(200, ['mailboxMessages' => $mailboxMessages, 'folderAvailable' => $folder !== null]);
        } catch (Throwable $error) {
            error_log('Ambients Hostinger IMAP inbox sync failed: ' . $error->getMessage());
            data_respond(502, ['error' => 'mail_inbox_unavailable', 'message' => 'The Hostinger inbox could not be synchronized. Verify the mailbox password and IMAP service.']);
        }
    }

    if (in_array($resource, ['email-message-trash', 'email-message-restore', 'email-message-purge'], true) && in_array($method, ['POST', 'DELETE'], true)) {
        data_require_permission('integrations');
        $body = data_read_json(1024);
        $uid = $body['id'] ?? null;
        if (!is_string($uid) || !ctype_digit($uid)) {
            data_respond(400, ['error' => 'invalid_message_id', 'message' => 'The selected mailbox message is invalid.']);
        }
        $settings = data_mail_settings();
        if ($settings === []) {
            data_respond(409, ['error' => 'mail_not_configured', 'message' => 'Configure the Hostinger mailbox before changing mailbox messages.']);
        }
        try {
            if ($resource === 'email-message-trash' && $method === 'POST') {
                data_imap_move_message($settings, $uid, 'inbox', 'trash');
            } elseif ($resource === 'email-message-restore' && $method === 'POST') {
                data_imap_move_message($settings, $uid, 'trash', 'inbox');
            } elseif ($resource === 'email-message-purge' && $method === 'DELETE') {
                data_imap_delete_message($settings, $uid);
            } else {
                data_respond(405, ['error' => 'method_not_allowed', 'message' => 'The requested mailbox operation is not allowed.']);
            }
        } catch (Throwable $error) {
            error_log('Ambients Hostinger mailbox message operation failed: ' . $error->getMessage());
            data_respond(502, ['error' => 'mail_message_update_failed', 'message' => 'The Hostinger message could not be moved or deleted. Refresh the folder and verify that the mailbox supports this operation.']);
        }
        data_respond(200, ['updated' => true]);
    }

    if ($method === 'GET' && in_array($resource, ['email-drafts', 'email-draft-trash'], true)) {
        data_require_permission('integrations');
        $deleted = $resource === 'email-draft-trash';
        $statement = data_db()->prepare(
            'SELECT id, recipient_email, subject, body, updated_at FROM email_drafts WHERE deleted_at IS ' . ($deleted ? 'NOT NULL' : 'NULL') . ' ORDER BY updated_at DESC LIMIT 100'
        );
        $statement->execute();
        $rows = $statement->fetchAll();
        data_respond(200, ['drafts' => array_map(static fn (array $row): array => [
            'id' => (string) $row['id'],
            'recipientEmail' => $row['recipient_email'],
            'subject' => $row['subject'],
            'body' => data_mail_decrypt_content($row['body']),
            'updatedAt' => $row['updated_at'],
        ], $rows)]);
    }

    if ($method === 'POST' && $resource === 'email-draft') {
        data_require_permission('integrations');
        $body = data_read_json(32768);
        $recipient = strtolower(data_string($body, 'recipientEmail', 254, false));
        $subject = data_string($body, 'subject', 180, false);
        $draftBody = $body['body'] ?? '';
        if (!is_string($draftBody) || strlen($draftBody) > 24000) {
            data_respond(400, ['error' => 'invalid_draft', 'message' => 'The draft message must be 24,000 bytes or less.']);
        }
        if ($recipient !== '' && !filter_var($recipient, FILTER_VALIDATE_EMAIL)) {
            data_respond(400, ['error' => 'invalid_recipient', 'message' => 'Enter a valid recipient email address.']);
        }
        $db = data_db();
        $draftId = filter_var($body['id'] ?? null, FILTER_VALIDATE_INT);
        $encryptedBody = data_mail_encrypt_content($draftBody);
        if ($draftId !== false && $draftId !== null && $draftId > 0) {
            $update = $db->prepare('UPDATE email_drafts SET recipient_email = ?, subject = ?, body = ? WHERE id = ? AND deleted_at IS NULL');
            $update->execute([$recipient, $subject, $encryptedBody, $draftId]);
            if ($update->rowCount() === 0) {
                $exists = $db->prepare('SELECT id FROM email_drafts WHERE id = ? AND deleted_at IS NULL');
                $exists->execute([$draftId]);
                if ($exists->fetchColumn() === false) {
                    data_respond(404, ['error' => 'draft_not_found', 'message' => 'The draft was not found.']);
                }
            }
        } else {
            $db->prepare('INSERT INTO email_drafts (recipient_email, subject, body) VALUES (?, ?, ?)')->execute([$recipient, $subject, $encryptedBody]);
            $draftId = (int) $db->lastInsertId();
        }
        data_respond(200, ['saved' => true, 'draft' => ['id' => (string) $draftId, 'recipientEmail' => $recipient, 'subject' => $subject, 'body' => $draftBody]]);
    }

    if (in_array($resource, ['email-draft-trash', 'email-draft-restore', 'email-draft-purge', 'email-draft-remove'], true) && in_array($method, ['POST', 'DELETE'], true)) {
        data_require_permission('integrations');
        $body = data_read_json(1024);
        $draftId = filter_var($body['id'] ?? null, FILTER_VALIDATE_INT);
        if ($draftId === false || $draftId < 1) {
            data_respond(400, ['error' => 'invalid_draft_id', 'message' => 'The selected draft is invalid.']);
        }
        $db = data_db();
        if ($resource === 'email-draft-trash' && $method === 'POST') {
            $statement = $db->prepare('UPDATE email_drafts SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL');
        } elseif ($resource === 'email-draft-restore' && $method === 'POST') {
            $statement = $db->prepare('UPDATE email_drafts SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL');
        } elseif ($resource === 'email-draft-purge' && $method === 'DELETE') {
            $statement = $db->prepare('DELETE FROM email_drafts WHERE id = ? AND deleted_at IS NOT NULL');
        } elseif ($resource === 'email-draft-remove' && $method === 'DELETE') {
            $statement = $db->prepare('DELETE FROM email_drafts WHERE id = ? AND deleted_at IS NULL');
        } else {
            data_respond(405, ['error' => 'method_not_allowed', 'message' => 'The requested draft operation is not allowed.']);
        }
        $statement->execute([$draftId]);
        if ($statement->rowCount() === 0) {
            data_respond(404, ['error' => 'draft_not_found', 'message' => 'The draft was not found in that folder.']);
        }
        data_respond(200, ['updated' => true]);
    }

    if ($method === 'POST' && $resource === 'email-send') {
        data_require_permission('integrations');
        $body = data_read_json(32768);
        $recipient = strtolower(data_string($body, 'recipientEmail', 254));
        $subject = data_string($body, 'subject', 180);
        $message = $body['body'] ?? null;
        if (!is_string($message) || trim($message) === '' || strlen($message) > 24000) {
            data_respond(400, ['error' => 'invalid_email_content', 'message' => 'Enter a message of 24,000 bytes or less.']);
        }
        if (!filter_var($recipient, FILTER_VALIDATE_EMAIL)) {
            data_respond(400, ['error' => 'invalid_recipient', 'message' => 'Enter a valid recipient email address.']);
        }
        if (preg_match('/[\r\n\x00]/', $subject) === 1 || preg_match('/\x00/', $message) === 1) {
            data_respond(400, ['error' => 'invalid_email_content', 'message' => 'The email subject or message contains unsupported characters.']);
        }
        $settings = data_mail_settings();
        if ($settings === [] || empty($settings['verified'])) {
            data_respond(409, ['error' => 'mail_not_configured', 'message' => 'Configure and test the Hostinger connection before sending email.']);
        }
        $db = data_db();
        $db->prepare('INSERT INTO email_activity (recipient_email, subject, body, status) VALUES (?, ?, ?, ?)')->execute([$recipient, $subject, data_mail_encrypt_content($message), 'Queued']);
        $activityId = $db->lastInsertId();
        try {
            data_mail_send($settings, $recipient, $subject, $message);
        } catch (Throwable $error) {
            $settings['verified'] = false;
            try {
                data_mail_write_settings($settings);
            } catch (Throwable $settingsError) {
                error_log('Ambients Hostinger connection state could not be updated after a send failure.');
            }
            try {
                $db->prepare('UPDATE email_activity SET status = ? WHERE id = ?')->execute(['Failed', $activityId]);
            } catch (Throwable $updateError) {
                error_log('Ambients failed email activity status could not be updated.');
            }
            error_log('Ambients Hostinger email send failed: ' . $error->getMessage());
            data_respond(502, ['error' => 'mail_send_failed', 'message' => 'Hostinger did not accept the email. Verify the connection and try again.']);
        }

        try {
            $db->prepare('UPDATE email_activity SET status = ? WHERE id = ?')->execute(['Sent', $activityId]);
            data_respond(201, ['sent' => true, 'logged' => true, 'message' => 'Hostinger accepted the email for sending.']);
        } catch (Throwable $error) {
            error_log('Ambients email activity could not be saved after SMTP acceptance: ' . $error->getMessage());
            data_respond(201, [
                'sent' => true,
                'logged' => false,
                'message' => 'Hostinger accepted the email, but CRM activity could not be saved. Do not retry unless necessary.',
            ]);
        }
    }

    if ($method === 'GET' && $resource === 'email-activity') {
        data_require_permission('integrations');
        $rows = data_db()->query('SELECT id, recipient_email, subject, body, status, sent_at FROM email_activity ORDER BY id DESC LIMIT 100')->fetchAll();
        data_respond(200, ['messages' => array_map(static fn (array $row): array => [
            'id' => (string) $row['id'],
            'recipientEmail' => $row['recipient_email'],
            'subject' => $row['subject'],
            'body' => data_mail_decrypt_content($row['body']),
            'status' => $row['status'],
            'sentAt' => $row['sent_at'],
        ], $rows)]);
    }

    if ($resource === 'email-campaign-worker-token' && $method === 'POST') {
        data_require_admin('admin');
        $settings = data_mail_settings();
        if ($settings === []) {
            data_respond(409, ['error' => 'mail_not_configured', 'message' => 'Configure Hostinger email before enabling scheduled campaigns.']);
        }
        $token = bin2hex(random_bytes(32));
        $settings['campaignWorkerTokenHash'] = hash('sha256', $token);
        data_mail_write_settings($settings);
        data_respond(200, [
            'workerToken' => $token,
            'command' => 'curl --silent --show-error --fail --request POST --header "Authorization: Bearer ' . $token . '" "https://ambienta.io/api/data.php?resource=email-campaign-process"',
        ]);
    }

    if ($method === 'GET' && $resource === 'email-campaign-audience') {
        data_require_admin('admin');
        $recipients = data_campaign_recipient_snapshot(data_db());
        data_respond(200, ['audienceCount' => count($recipients), 'audienceLimit' => 5000]);
    }

    if ($method === 'GET' && $resource === 'email-campaigns') {
        data_require_admin('admin');
        $rows = data_db()->query(
            'SELECT id, name, subject, body, status, scheduled_at, recipient_count, sent_count, failed_count, unsubscribed_count, created_at, completed_at
             FROM email_campaigns ORDER BY id DESC LIMIT 100'
        )->fetchAll();
        data_respond(200, ['campaigns' => array_map(static fn (array $row): array => [
            'id' => (string) $row['id'],
            'name' => $row['name'],
            'subject' => $row['subject'],
            'body' => data_mail_decrypt_content($row['body']),
            'status' => $row['status'],
            'scheduledAt' => $row['scheduled_at'],
            'recipientCount' => (int) $row['recipient_count'],
            'sentCount' => (int) $row['sent_count'],
            'failedCount' => (int) $row['failed_count'],
            'unsubscribedCount' => (int) $row['unsubscribed_count'],
            'createdAt' => $row['created_at'],
            'completedAt' => $row['completed_at'],
        ], $rows)]);
    }

    if ($method === 'POST' && $resource === 'email-campaign-save') {
        data_require_admin('admin');
        $body = data_read_json(32768);
        $name = trim(data_string($body, 'name', 160));
        $subject = trim(data_string($body, 'subject', 180));
        $message = $body['body'] ?? null;
        if ($name === '' || $subject === '' || !is_string($message) || trim($message) === '' || strlen($message) > 20000) {
            data_respond(400, ['error' => 'invalid_campaign', 'message' => 'Enter a campaign name, subject, and message up to 20,000 bytes.']);
        }
        if (preg_match('/[\r\n\x00]/', $name . $subject) === 1 || preg_match('/\x00/', $message) === 1) {
            data_respond(400, ['error' => 'invalid_campaign', 'message' => 'The campaign contains unsupported control characters.']);
        }
        $db = data_db();
        $campaignId = $body['id'] ?? null;
        if ($campaignId === null) {
            $db->prepare('INSERT INTO email_campaigns (name, subject, body, status) VALUES (?, ?, ?, ?)')->execute([
                $name,
                $subject,
                data_mail_encrypt_content($message),
                'draft',
            ]);
            $campaignId = (string) $db->lastInsertId();
        } else {
            $campaignId = filter_var($campaignId, FILTER_VALIDATE_INT);
            if ($campaignId === false || $campaignId < 1) {
                data_respond(400, ['error' => 'invalid_campaign_id', 'message' => 'The selected campaign is invalid.']);
            }
            $db->prepare("UPDATE email_campaigns SET name = ?, subject = ?, body = ? WHERE id = ? AND status = 'draft'")->execute([
                $name,
                $subject,
                data_mail_encrypt_content($message),
                $campaignId,
            ]);
            $exists = $db->prepare("SELECT COUNT(*) FROM email_campaigns WHERE id = ? AND status = 'draft'");
            $exists->execute([$campaignId]);
            if ((int) $exists->fetchColumn() !== 1) {
                data_respond(409, ['error' => 'campaign_not_editable', 'message' => 'Only draft campaigns can be edited.']);
            }
        }
        data_respond(200, ['saved' => true, 'campaignId' => (string) $campaignId]);
    }

    if (in_array($resource, ['email-campaign-launch', 'email-campaign-schedule', 'email-campaign-cancel'], true) && $method === 'POST') {
        data_require_admin('admin');
        $body = data_read_json(2048);
        $campaignId = filter_var($body['id'] ?? null, FILTER_VALIDATE_INT);
        if ($campaignId === false || $campaignId < 1) {
            data_respond(400, ['error' => 'invalid_campaign_id', 'message' => 'The selected campaign is invalid.']);
        }
        $db = data_db();

        if ($resource === 'email-campaign-cancel') {
            $db->beginTransaction();
            try {
                $find = $db->prepare('SELECT status FROM email_campaigns WHERE id = ? FOR UPDATE');
                $find->execute([$campaignId]);
                if ($find->fetchColumn() !== 'scheduled') {
                    $db->rollBack();
                    data_respond(409, ['error' => 'campaign_not_scheduled', 'message' => 'Only scheduled campaigns can be cancelled.']);
                }
                $db->prepare('DELETE FROM email_campaign_recipients WHERE campaign_id = ?')->execute([$campaignId]);
                $db->prepare("UPDATE email_campaigns SET status = 'draft', scheduled_at = NULL, recipient_count = 0, sent_count = 0, failed_count = 0, unsubscribed_count = 0 WHERE id = ?")->execute([$campaignId]);
                $db->commit();
                data_respond(200, ['cancelled' => true]);
            } catch (Throwable $error) {
                if ($db->inTransaction()) $db->rollBack();
                throw $error;
            }
        }

        $settings = data_mail_settings();
        if ($settings === [] || empty($settings['verified'])) {
            data_respond(409, ['error' => 'mail_not_verified', 'message' => 'Verify Hostinger SMTP and IMAP under Integrations before scheduling or sending a campaign.']);
        }
        $status = 'sending';
        $scheduledAt = null;
        if ($resource === 'email-campaign-schedule') {
            $requestedTime = $body['scheduledAt'] ?? null;
            if (!is_string($requestedTime)) {
                data_respond(400, ['error' => 'invalid_schedule_time', 'message' => 'Choose a valid date and time for this campaign.']);
            }
            try {
                $scheduledTime = new DateTimeImmutable($requestedTime);
            } catch (Throwable $error) {
                data_respond(400, ['error' => 'invalid_schedule_time', 'message' => 'Choose a valid date and time for this campaign.']);
            }
            if ($scheduledTime->getTimestamp() < time() + 300) {
                data_respond(400, ['error' => 'schedule_too_soon', 'message' => 'Schedule the campaign at least five minutes from now.']);
            }
            $status = 'scheduled';
            $scheduledAt = $scheduledTime->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
        }
        try {
            $recipientCount = data_campaign_queue($db, $campaignId, $status, $scheduledAt);
        } catch (Throwable $error) {
            $message = match ($error->getMessage()) {
                'campaign_audience_empty' => 'There are no opted-in leads with valid email addresses for this campaign.',
                'campaign_audience_too_large' => 'Campaigns are limited to 5,000 opted-in recipients.',
                'campaign_not_editable' => 'Only draft campaigns can be sent or scheduled.',
                default => null,
            };
            if ($message !== null) {
                data_respond(409, ['error' => $error->getMessage(), 'message' => $message]);
            }
            throw $error;
        }

        if ($status === 'scheduled') {
            data_respond(200, ['scheduled' => true, 'recipientCount' => $recipientCount, 'scheduledAt' => $scheduledAt]);
        }
        $batch = data_campaign_process_batch($settings, 5);
        data_respond(200, [
            'queued' => true,
            'recipientCount' => $recipientCount,
            'processed' => $batch['processed'],
            'sent' => $batch['sent'],
            'failed' => $batch['failed'],
            'status' => $batch['processed'] < $recipientCount
                ? 'sending'
                : ($batch['failed'] === 0 ? 'sent' : ($batch['sent'] === 0 ? 'failed' : 'partial')),
        ]);
    }

    data_respond(405, ['error' => 'method_not_allowed', 'message' => 'The requested mail operation is not allowed.']);
}

if ($method === 'POST' && $resource === 'staff-session') {
    $body = data_read_json();
    $action = $body['action'] ?? null;
    if ($action === 'enter') {
        data_require_admin('admin');
        $staffId = filter_var($body['staffId'] ?? null, FILTER_VALIDATE_INT);
        if ($staffId === false || $staffId < 1) {
            data_respond(400, ['error' => 'invalid_staff_id', 'message' => 'Select a valid agent account.']);
        }
        $db = data_db();
        $find = $db->prepare('SELECT id, email, display_name, role, permissions, session_version, must_change_password FROM staff_users WHERE id = ? AND is_active = 1');
        $find->execute([$staffId]);
        $staff = $find->fetch();
        if (!$staff || $staff['role'] !== 'operator') {
            data_respond(404, ['error' => 'staff_not_found', 'message' => 'The active agent account was not found.']);
        }
        if (!empty($_SESSION['is_impersonating'])) {
            data_respond(409, ['error' => 'already_impersonating', 'message' => 'Exit the current agent account before entering another.']);
        }
        $db->beginTransaction();
        try {
            data_audit($db, 'staff.impersonation_started', 'staff', (string) $staffId, ['email' => $staff['email']]);
            $db->commit();
        } catch (Throwable $error) {
            if ($db->inTransaction()) $db->rollBack();
            error_log('Ambients account-entry audit failed: ' . $error->getMessage());
            data_respond(500, ['error' => 'impersonation_failed', 'message' => 'The agent account could not be opened.']);
        }
        if (!session_regenerate_id(true)) {
            data_respond(500, ['error' => 'session_rotation_failed', 'message' => 'The secure session could not be renewed.']);
        }
        $_SESSION['original_admin'] = [
            'email' => (string) $_SESSION['admin_email'],
            'displayName' => (string) ($_SESSION['admin_display_name'] ?? ''),
        ];
        $_SESSION['is_impersonating'] = true;
        $_SESSION['impersonated_by'] = (string) $_SESSION['original_admin']['email'];
        $_SESSION['admin_email'] = (string) $staff['email'];
        $_SESSION['admin_display_name'] = (string) $staff['display_name'];
        $_SESSION['admin_role'] = 'operator';
        $_SESSION['must_change_password'] = false;
        $_SESSION['impersonated_email'] = (string) $staff['email'];
        $_SESSION['staff_id'] = (int) $staff['id'];
        $_SESSION['staff_session_version'] = (int) $staff['session_version'];
        $permissions = json_decode((string) $staff['permissions'], true);
        $_SESSION['admin_permissions'] = is_array($permissions)
            ? array_values(array_filter($permissions, static fn ($permission): bool => is_string($permission) && in_array($permission, ['leads', 'orders', 'products', 'integrations'], true)))
            : [];
        $_SESSION['last_activity'] = time();
        data_respond(200, [
            'role' => 'operator',
            'email' => $_SESSION['admin_email'],
            'displayName' => $_SESSION['admin_display_name'],
            'permissions' => $_SESSION['admin_permissions'],
            'impersonating' => true,
            'impersonatedBy' => $_SESSION['impersonated_by'],
            'mustChangePassword' => false,
        ]);
    }
    if ($action === 'exit') {
        data_require_admin('exit-impersonation');
        if (empty($_SESSION['is_impersonating']) || !is_array($_SESSION['original_admin'] ?? null)) {
            data_respond(409, ['error' => 'not_impersonating', 'message' => 'There is no administrator session to return to.']);
        }
        $original = $_SESSION['original_admin'];
        if (!session_regenerate_id(true)) {
            data_respond(503, ['error' => 'session_rotation_failed', 'message' => 'The secure session could not be renewed.']);
        }
        $db = data_db();
        $db->beginTransaction();
        try {
            data_audit($db, 'staff.impersonation_ended', 'staff', (string) ($_SESSION['staff_id'] ?? ''), ['email' => (string) ($_SESSION['impersonated_email'] ?? '')]);
            $db->commit();
        } catch (Throwable $error) {
            if ($db->inTransaction()) $db->rollBack();
            error_log('Ambients account-exit audit failed: ' . $error->getMessage());
            data_respond(500, ['error' => 'impersonation_exit_failed', 'message' => 'The administrator account could not be restored.']);
        }
        $_SESSION['admin_email'] = $original['email'];
        $_SESSION['admin_display_name'] = $original['displayName'];
        $_SESSION['admin_role'] = 'admin';
        unset($_SESSION['original_admin'], $_SESSION['is_impersonating'], $_SESSION['impersonated_by'], $_SESSION['staff_id'], $_SESSION['staff_session_version'], $_SESSION['admin_permissions'], $_SESSION['must_change_password'], $_SESSION['impersonated_email']);
        $_SESSION['last_activity'] = time();
        data_respond(200, [
            'role' => 'admin',
            'email' => $_SESSION['admin_email'],
            'displayName' => $_SESSION['admin_display_name'],
            'permissions' => ['leads', 'orders', 'products', 'integrations'],
            'impersonating' => false,
            'mustChangePassword' => false,
        ]);
    }
    data_respond(400, ['error' => 'invalid_staff_session_action', 'message' => 'Choose whether to enter or exit the agent account.']);
}

if ($method === 'GET' && $resource === 'catalog') {
    $db = data_db();
    $rows = $db->query('SELECT * FROM products WHERE is_active = 1 AND is_archived = 0 ORDER BY is_featured DESC, name')->fetchAll();
    $categories = $db->query('SELECT name FROM product_categories WHERE is_active = 1 ORDER BY name')->fetchAll(PDO::FETCH_COLUMN);
    data_respond(200, ['products' => array_map('data_product_row', $rows), 'categories' => $categories]);
}

if ($method === 'GET') {
    data_require_admin();
    $db = data_db();
    if ($resource === 'products') {
        data_require_permission('products');
        $rows = $db->query('SELECT * FROM products WHERE is_archived = 0 ORDER BY is_featured DESC, name')->fetchAll();
        data_respond(200, ['products' => array_map('data_product_row', $rows)]);
    }
    if ($resource === 'leads') {
        data_require_permission('leads');
        $leadId = $_GET['id'] ?? null;
        if ($leadId !== null) {
            $id = filter_var($leadId, FILTER_VALIDATE_INT);
            if ($id === false || $id < 1) {
                data_respond(400, ['error' => 'invalid_lead_id', 'message' => 'The contact lead identifier is invalid.']);
            }
            data_require_lead_access($db, (int) $id);
            $find = $db->prepare(
                'SELECT l.id, l.first_name, l.last_name, l.email, l.phone, l.country, l.lead_source, l.status, l.marketing_consent, l.marketing_consent_at, l.created_at,
                        l.assigned_staff_id, (SELECT display_name FROM staff_users WHERE id = l.assigned_staff_id) AS assigned_staff_name,
                        COUNT(o.id) AS order_count, MAX(o.placed_at) AS last_order_at,
                        COUNT(CASE WHEN o.status <> \'Cancelled\' THEN 1 END) AS active_order_count,
                        (SELECT COUNT(*) FROM lead_activities la WHERE la.lead_id = l.id AND la.activity_type = \'call\') AS call_count
                 FROM leads l LEFT JOIN orders o ON o.email = l.email
                 WHERE l.id = ? GROUP BY l.id LIMIT 1'
            );
            $find->execute([$id]);
            $lead = $find->fetch();
            if (!$lead) data_respond(404, ['error' => 'lead_not_found', 'message' => 'The contact lead was not found.']);
            $canViewOrders = ($_SESSION['admin_role'] ?? '') === 'admin'
                || in_array('orders', $_SESSION['admin_permissions'] ?? [], true);
            $orders = [];
            if ($canViewOrders) {
                $orderQuery = $db->prepare('SELECT * FROM orders WHERE email = ? ORDER BY placed_at DESC LIMIT 100');
                $orderQuery->execute([$lead['email']]);
                $orders = array_map(static fn (array $row): array => data_order_row($db, $row), $orderQuery->fetchAll());
            }
            data_respond(200, [
                'lead' => data_lead_row($lead),
                'orders' => $orders,
                'activities' => data_lead_activities($db, (int) $id),
            ]);
        }
        $listSql = 'SELECT l.id, l.first_name, l.last_name, l.email, l.phone, l.country, l.lead_source, l.status, l.marketing_consent, l.marketing_consent_at, l.created_at,
                    l.assigned_staff_id, (SELECT display_name FROM staff_users WHERE id = l.assigned_staff_id) AS assigned_staff_name,
                    COUNT(o.id) AS order_count, MAX(o.placed_at) AS last_order_at,
                    COUNT(CASE WHEN o.status <> \'Cancelled\' THEN 1 END) AS active_order_count,
                    (SELECT COUNT(*) FROM lead_activities la WHERE la.lead_id = l.id AND la.activity_type = \'call\') AS call_count
             FROM leads l LEFT JOIN orders o ON o.email = l.email';
        if (($_SESSION['admin_role'] ?? '') === 'operator') {
            $listSql .= ' WHERE l.assigned_staff_id = ?';
            $listSql .= ' GROUP BY l.id ORDER BY l.id DESC';
            $listQuery = $db->prepare($listSql);
            $listQuery->execute([(int) ($_SESSION['staff_id'] ?? 0)]);
            $rows = $listQuery->fetchAll();
        } else {
            $rows = $db->query($listSql . ' GROUP BY l.id ORDER BY l.id DESC')->fetchAll();
        }
        data_respond(200, ['leads' => array_map('data_lead_row', $rows)]);
    }
    if ($resource === 'categories') {
        data_require_permission('products');
        $categories = $db->query('SELECT name FROM product_categories WHERE is_active = 1 ORDER BY name')->fetchAll(PDO::FETCH_COLUMN);
        data_respond(200, ['categories' => $categories]);
    }
    if ($resource === 'orders') {
        data_require_permission('orders');
        $orderId = data_string($_GET, 'id', 64, false);
        if ($orderId !== '') {
            $orderQuery = $db->prepare('SELECT * FROM orders WHERE id = ?');
            $orderQuery->execute([$orderId]);
            $order = $orderQuery->fetch();
            if (!$order) {
                data_respond(404, ['error' => 'order_not_found', 'message' => 'The order was not found.']);
            }
            data_respond(200, ['order' => data_order_row($db, $order)]);
        }
        $page = filter_var($_GET['page'] ?? '1', FILTER_VALIDATE_INT);
        $limit = filter_var($_GET['limit'] ?? '100', FILTER_VALIDATE_INT);
        if ($page === false || $page < 1 || $limit === false || $limit < 1) {
            data_respond(400, ['error' => 'invalid_pagination', 'message' => 'The requested page is invalid.']);
        }
        $page = min($page, 1000000);
        $limit = min($limit, 100);
        $offset = ($page - 1) * $limit;
        $statusFilter = data_string($_GET, 'status', 32, false);
        $query = trim(data_string($_GET, 'q', 160, false));
        $where = [];
        $parameters = [];
        if ($statusFilter !== '') {
            $where[] = 'status = ?';
            $parameters[] = $statusFilter;
        }
        if ($query !== '') {
            $where[] = '(order_number LIKE ? OR customer_name LIKE ? OR email LIKE ? OR EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = orders.id AND oi.product_name LIKE ?))';
            array_push($parameters, '%' . $query . '%', '%' . $query . '%', '%' . $query . '%', '%' . $query . '%');
        }
        $whereSql = $where === [] ? '' : ' WHERE ' . implode(' AND ', $where);
        $countQuery = $db->prepare('SELECT COUNT(*) FROM orders' . $whereSql);
        $countQuery->execute($parameters);
        $total = (int) $countQuery->fetchColumn();
        $rowsQuery = $db->prepare('SELECT * FROM orders' . $whereSql . ' ORDER BY placed_at DESC LIMIT ? OFFSET ?');
        foreach ($parameters as $index => $parameter) {
            $rowsQuery->bindValue($index + 1, $parameter, PDO::PARAM_STR);
        }
        $rowsQuery->bindValue(count($parameters) + 1, $limit, PDO::PARAM_INT);
        $rowsQuery->bindValue(count($parameters) + 2, $offset, PDO::PARAM_INT);
        $rowsQuery->execute();
        $rows = $rowsQuery->fetchAll();
        data_respond(200, [
            'orders' => array_map(static fn (array $row): array => data_order_row($db, $row), $rows),
            'pagination' => ['page' => $page, 'limit' => $limit, 'total' => $total, 'pages' => (int) ceil($total / $limit)],
        ]);
    }
    if ($resource === 'audit') {
        data_require_admin('admin');
        $rows = $db->query('SELECT id, actor_email, action, entity_type, entity_id, details, created_at FROM admin_audit_log ORDER BY id DESC LIMIT 200')->fetchAll();
        foreach ($rows as &$row) {
            $row['details'] = $row['details'] === null ? null : json_decode($row['details'], true);
        }
        unset($row);
        data_respond(200, ['entries' => $rows]);
    }
    if ($resource === 'staff') {
        data_require_admin('admin');
        if (isset($_GET['id'])) {
            $staffId = filter_var($_GET['id'], FILTER_VALIDATE_INT);
            if ($staffId === false || $staffId < 1) {
                data_respond(400, ['error' => 'invalid_staff_id', 'message' => 'The agent profile identifier is invalid.']);
            }
            $findStaff = $db->prepare(
                'SELECT id, email, display_name, role, permissions, is_active, created_by, created_at, updated_at
                 FROM staff_users WHERE id = ? LIMIT 1'
            );
            $findStaff->execute([$staffId]);
            $staffProfile = $findStaff->fetch();
            if (!$staffProfile) {
                data_respond(404, ['error' => 'staff_not_found', 'message' => 'The agent profile was not found.']);
            }
            $staffProfile['id'] = (int) $staffProfile['id'];
            $staffProfile['is_active'] = (bool) $staffProfile['is_active'];
            $staffProfile['permissions'] = data_staff_permissions(json_decode((string) $staffProfile['permissions'], true)) ?? [];
            $assignedLeads = $db->prepare(
                'SELECT id, first_name, last_name, email, status, created_at
                 FROM leads WHERE assigned_staff_id = ? ORDER BY id DESC'
            );
            $assignedLeads->execute([$staffId]);
            $staffProfile['assignedLeads'] = array_map(static fn (array $lead): array => [
                'id' => (int) $lead['id'],
                'firstName' => $lead['first_name'],
                'lastName' => $lead['last_name'],
                'email' => $lead['email'],
                'status' => $lead['status'],
                'createdAt' => $lead['created_at'],
            ], $assignedLeads->fetchAll());
            data_respond(200, ['profile' => $staffProfile]);
        }
        $rows = $db->query(
            'SELECT s.id, s.email, s.display_name, s.role, s.permissions, s.is_active, s.created_by, s.created_at, s.updated_at,
                    (SELECT COUNT(*) FROM leads l WHERE l.assigned_staff_id = s.id) AS assigned_lead_count
             FROM staff_users s ORDER BY s.email'
        )->fetchAll();
        foreach ($rows as &$row) {
            $row['id'] = (int) $row['id'];
            $row['is_active'] = (bool) $row['is_active'];
            $row['permissions'] = json_decode((string) $row['permissions'], true) ?: [];
            $row['assigned_lead_count'] = (int) $row['assigned_lead_count'];
        }
        unset($row);
        data_respond(200, ['staff' => $rows]);
    }
    if ($resource === 'overview') {
        $canViewOrders = ($_SESSION['admin_role'] ?? '') === 'admin' || in_array('orders', $_SESSION['admin_permissions'] ?? [], true);
        $canViewLeads = ($_SESSION['admin_role'] ?? '') === 'admin' || in_array('leads', $_SESSION['admin_permissions'] ?? [], true);
        $canViewProducts = ($_SESSION['admin_role'] ?? '') === 'admin' || in_array('products', $_SESSION['admin_permissions'] ?? [], true);
        $orderCounts = $canViewOrders ? $db->query('SELECT status, COUNT(*) AS count FROM orders GROUP BY status')->fetchAll() : [];
        $counts = [];
        foreach ($orderCounts as $row) {
            $counts[$row['status']] = (int) $row['count'];
        }
        $lowStock = $canViewProducts ? $db->query(
            'SELECT id, name, sku, stock_count, min_stock_threshold FROM products WHERE is_active = 1 AND stock_count <= min_stock_threshold ORDER BY stock_count ASC, name ASC LIMIT 8'
        )->fetchAll() : [];
        $lowStockCount = $canViewProducts ? (int) $db->query(
            'SELECT COUNT(*) FROM products WHERE is_active = 1 AND stock_count <= min_stock_threshold'
        )->fetchColumn() : 0;
        $recent = $canViewOrders ? $db->query('SELECT * FROM orders ORDER BY placed_at DESC LIMIT 8')->fetchAll() : [];
        $leadCount = 0;
        if ($canViewLeads) {
            if (($_SESSION['admin_role'] ?? '') === 'admin') {
                $leadCount = (int) $db->query('SELECT COUNT(*) FROM leads')->fetchColumn();
            } else {
                $leadCountQuery = $db->prepare('SELECT COUNT(*) FROM leads WHERE assigned_staff_id = ?');
                $leadCountQuery->execute([(int) ($_SESSION['staff_id'] ?? 0)]);
                $leadCount = (int) $leadCountQuery->fetchColumn();
            }
        }
        data_respond(200, [
            'orders' => ['total' => $canViewOrders ? (int) $db->query('SELECT COUNT(*) FROM orders')->fetchColumn() : 0, 'byStatus' => $counts],
            'leads' => $leadCount,
            'products' => $canViewProducts ? (int) $db->query('SELECT COUNT(*) FROM products WHERE is_active = 1')->fetchColumn() : 0,
            'lowStockCount' => $lowStockCount,
            'lowStock' => array_map(static fn (array $row): array => [
                'id' => $row['id'],
                'name' => $row['name'],
                'sku' => $row['sku'],
                'stockCount' => (int) $row['stock_count'],
                'minStockThreshold' => (int) $row['min_stock_threshold'],
            ], $lowStock),
            'recentOrders' => array_map(static fn (array $row): array => data_order_row($db, $row), $recent),
        ]);
    }
    data_respond(404, ['error' => 'not_found', 'message' => 'The requested resource was not found.']);
}

if ($method === 'POST' && $resource === 'product-images') {
    data_require_permission('products');
    $files = $_FILES['images'] ?? null;
    if (!is_array($files) || !isset($files['name'], $files['type'], $files['tmp_name'], $files['error'], $files['size'])) {
        $contentLength = filter_var($_SERVER['CONTENT_LENGTH'] ?? null, FILTER_VALIDATE_INT);
        if ($contentLength !== false && $contentLength > 0) {
            data_respond(413, ['error' => 'product_images_too_large', 'message' => 'The upload request exceeded the server limit. Try fewer or smaller images.']);
        }
        data_respond(400, ['error' => 'missing_product_images', 'message' => 'Choose one or more product images to upload.']);
    }
    $names = is_array($files['name']) ? $files['name'] : [$files['name']];
    $types = is_array($files['type']) ? $files['type'] : [$files['type']];
    $temporaryPaths = is_array($files['tmp_name']) ? $files['tmp_name'] : [$files['tmp_name']];
    $errors = is_array($files['error']) ? $files['error'] : [$files['error']];
    $sizes = is_array($files['size']) ? $files['size'] : [$files['size']];
    if (count($names) < 1 || count($names) > 10) {
        data_respond(400, ['error' => 'invalid_product_images', 'message' => 'Upload between 1 and 10 product images at a time.']);
    }

    $allowedTypes = [
        'image/jpeg' => 'jpg',
        'image/png' => 'png',
        'image/webp' => 'webp',
        'image/gif' => 'gif',
    ];
    $validatedFiles = [];
    $totalSize = 0;
    foreach ($names as $index => $originalName) {
        $uploadError = $errors[$index] ?? UPLOAD_ERR_NO_FILE;
        if ($uploadError !== UPLOAD_ERR_OK) {
            $message = in_array($uploadError, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)
                ? 'Each product image must be no larger than 5 MB.'
                : 'One of the selected product images could not be uploaded.';
            data_respond(400, ['error' => 'product_image_upload_failed', 'message' => $message]);
        }
        $temporaryPath = $temporaryPaths[$index] ?? '';
        $size = $sizes[$index] ?? 0;
        if (!is_string($temporaryPath) || !is_uploaded_file($temporaryPath) || !is_int($size) || $size < 1 || $size > 5242880) {
            data_respond(400, ['error' => 'invalid_product_image', 'message' => 'Each product image must be a valid image no larger than 5 MB.']);
        }
        $totalSize += $size;
        if ($totalSize > 20971520) {
            data_respond(413, ['error' => 'product_images_too_large', 'message' => 'The total size of product images must be no more than 20 MB.']);
        }
        $imageInfo = getimagesize($temporaryPath);
        $mimeType = is_array($imageInfo) ? ($imageInfo['mime'] ?? null) : null;
        if (
            !is_string($mimeType)
            || !isset($allowedTypes[$mimeType])
            || !is_array($imageInfo)
            || ($imageInfo['mime'] ?? null) !== $mimeType
            || !isset($imageInfo[0], $imageInfo[1])
            || $imageInfo[0] < 1
            || $imageInfo[1] < 1
            || $imageInfo[0] > 8000
            || $imageInfo[1] > 8000
            || $imageInfo[0] * $imageInfo[1] > 30000000
        ) {
            data_respond(400, ['error' => 'invalid_product_image', 'message' => 'Use a valid JPEG, PNG, WebP, or GIF image (maximum dimensions 8000 × 8000).']);
        }
        $validatedFiles[] = [
            'temporaryPath' => $temporaryPath,
            'extension' => $allowedTypes[$mimeType],
        ];
    }

    $uploadDirectory = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'uploads' . DIRECTORY_SEPARATOR . 'products';
    if (!is_dir($uploadDirectory) && !mkdir($uploadDirectory, 0755, true) && !is_dir($uploadDirectory)) {
        error_log('Ambients product image directory could not be created.');
        data_respond(500, ['error' => 'product_image_storage_failed', 'message' => 'Product image storage is unavailable.']);
    }
    $uploadedUrls = [];
    $uploadedPaths = [];
    try {
        foreach ($validatedFiles as $validatedFile) {
            $fileName = bin2hex(random_bytes(16)) . '.' . $validatedFile['extension'];
            $destination = $uploadDirectory . DIRECTORY_SEPARATOR . $fileName;
            if (!move_uploaded_file($validatedFile['temporaryPath'], $destination)) {
                throw new RuntimeException('Product image could not be moved into storage.');
            }
            $uploadedPaths[] = $destination;
            $uploadedUrls[] = '/uploads/products/' . $fileName;
        }
    } catch (Throwable $error) {
        foreach ($uploadedPaths as $uploadedPath) {
            if (is_file($uploadedPath) && !unlink($uploadedPath)) {
                error_log('Ambients partial product image cleanup failed.');
            }
        }
        error_log('Ambients product image upload failed: ' . $error->getMessage());
        data_respond(500, ['error' => 'product_image_upload_failed', 'message' => 'The product images could not be stored.']);
    }
    data_respond(201, ['images' => $uploadedUrls]);
}

if ($method === 'POST' && $resource === 'products') {
    data_require_permission('products');
    $body = data_read_json(4194304);
    $db = data_db();
    $isBulk = array_key_exists('products', $body);
    if ($isBulk) {
        if (!is_array($body['products']) || count($body['products']) < 1 || count($body['products']) > 500) {
            data_respond(400, ['error' => 'invalid_products', 'message' => 'Provide between 1 and 500 products.']);
        }
        $products = [];
        $seenIds = [];
        $seenSkus = [];
        foreach ($body['products'] as $entry) {
            if (!is_array($entry)) {
                data_respond(400, ['error' => 'invalid_product', 'message' => 'A submitted product is invalid.']);
            }
            $product = data_product_input($db, $entry, false);
            $normalizedSku = strtolower($product['sku']);
            if (isset($seenIds[$product['id']]) || isset($seenSkus[$normalizedSku])) {
                data_respond(409, ['error' => 'product_conflict', 'message' => 'The import contains duplicate product IDs or SKUs.']);
            }
            $seenIds[$product['id']] = true;
            $seenSkus[$normalizedSku] = true;
            $products[] = $product;
        }
    } else {
        $products = [data_product_input($db, $body, false)];
    }

    $db->beginTransaction();
    try {
        $insert = $db->prepare(
            'INSERT INTO products (id, name, category, description, rx_required, dosage, sku, ndc_code, image, images, price, cost_price, copay_price, stock_count, min_stock_threshold, is_active, is_featured, last_restocked)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        foreach ($products as $product) {
            $insert->execute([
                $product['id'], $product['name'], $product['category'], $product['description'],
                (int) $product['rxRequired'], $product['dosage'], $product['sku'], $product['ndcCode'],
                $product['image'], json_encode($product['images'], JSON_UNESCAPED_SLASHES), $product['price'], $product['costPrice'], $product['copayPrice'],
                $product['stockCount'], $product['minStockThreshold'], (int) $product['isActive'], (int) $product['isFeatured'],
                $product['stockCount'] > 0 ? gmdate('Y-m-d') : null,
            ]);
            data_audit($db, 'product.created', 'product', $product['id'], ['sku' => $product['sku']]);
        }
        $db->commit();
    } catch (Throwable $error) {
        if ($db->inTransaction()) $db->rollBack();
        if ($error instanceof PDOException && (string) $error->getCode() === '23000') {
            data_respond(409, ['error' => 'product_conflict', 'message' => 'The product ID or SKU is already in use.']);
        }
        error_log('Ambients product creation failed: ' . $error->getMessage());
        data_respond(500, [
            'error' => 'product_create_failed',
            'message' => $isBulk ? 'The product import could not be saved.' : 'The product could not be saved.',
        ]);
    }
    $find = $db->prepare('SELECT * FROM products WHERE id = ?');
    $savedProducts = [];
    foreach ($products as $product) {
        $find->execute([$product['id']]);
        $savedProducts[] = data_product_row($find->fetch());
    }
    data_respond(201, $isBulk ? ['products' => $savedProducts] : ['product' => $savedProducts[0]]);
}

if ($method === 'POST' && $resource === 'categories') {
    data_require_permission('products');
    $body = data_read_json();
    $name = data_string($body, 'name', 80);
    if (
        $name === ''
        || preg_match('/[\x00-\x1F\x7F]/', $name)
        || in_array(strtolower($name), ['all', 'all products'], true)
    ) {
        data_respond(400, ['error' => 'invalid_category', 'message' => 'Enter a category name of 1 to 80 characters.']);
    }
    $db = data_db();
    $db->beginTransaction();
    try {
        $db->prepare('INSERT INTO product_categories (name) VALUES (?)')->execute([$name]);
        data_audit($db, 'category.created', 'category', $name);
        $db->commit();
    } catch (PDOException $error) {
        if ($db->inTransaction()) $db->rollBack();
        if ((string) $error->getCode() === '23000') {
            data_respond(409, ['error' => 'category_conflict', 'message' => 'A category with that name already exists.']);
        }
        error_log('Ambients product category creation failed: ' . $error->getMessage());
        data_respond(500, ['error' => 'category_create_failed', 'message' => 'The category could not be saved.']);
    } catch (Throwable $error) {
        if ($db->inTransaction()) $db->rollBack();
        error_log('Ambients product category creation failed: ' . $error->getMessage());
        data_respond(500, ['error' => 'category_create_failed', 'message' => 'The category could not be saved.']);
    }
    data_respond(201, ['category' => $name]);
}

if ($method === 'POST' && $resource === 'staff') {
    data_require_admin('admin');
    $body = data_read_json();
    $db = data_db();
    if (($body['createDemoAgents'] ?? false) === true) {
        $demoAgents = [
            ['Agent One', 'agent.one@example.com'],
            ['Agent Two', 'agent.two@example.com'],
            ['Agent Three', 'agent.three@example.com'],
            ['Agent Four', 'agent.four@example.com'],
            ['Agent Five', 'agent.five@example.com'],
        ];
        $permissionsJson = json_encode(['leads', 'orders', 'products', 'integrations']);
        $created = [];
        $db->beginTransaction();
        try {
            foreach ($demoAgents as [$displayName, $email]) {
                $exists = $db->prepare('SELECT id FROM staff_users WHERE email = ?');
                $exists->execute([$email]);
                if ($exists->fetchColumn()) continue;
                $temporaryPassword = bin2hex(random_bytes(16));
                $hash = password_hash($temporaryPassword, PASSWORD_DEFAULT);
                if (!is_string($hash) || !is_string($permissionsJson)) {
                    throw new RuntimeException('Demo agent credentials could not be generated.');
                }
                $db->prepare('INSERT INTO staff_users (email, display_name, password_hash, role, permissions, is_active, created_by) VALUES (?, ?, ?, ?, ?, 1, ?)')
                    ->execute([$email, $displayName, $hash, 'operator', $permissionsJson, $_SESSION['admin_email']]);
                $id = (string) $db->lastInsertId();
                data_audit($db, 'staff.created', 'staff', $id, ['email' => $email, 'role' => 'operator', 'demo' => true]);
                $created[] = ['displayName' => $displayName, 'email' => $email, 'temporaryPassword' => $temporaryPassword];
            }
            $db->commit();
            data_respond(201, ['created' => $created]);
        } catch (Throwable $error) {
            if ($db->inTransaction()) $db->rollBack();
            error_log('Ambients demo agent creation failed: ' . $error->getMessage());
            data_respond(500, ['error' => 'demo_staff_create_failed', 'message' => 'The demo agent accounts could not be created.']);
        }
    }

    $email = strtolower(data_string($body, 'email', 254));
    $displayName = data_string($body, 'displayName', 120);
    $password = $body['temporaryPassword'] ?? null;
    $permissions = data_staff_permissions($body['permissions'] ?? null);
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || !is_string($password) || strlen($password) < 12 || strlen($password) > 1024
        || $permissions === null) {
        data_respond(400, ['error' => 'invalid_staff_account', 'message' => 'Enter a display name, valid email, temporary password of at least 12 characters, and valid permissions.']);
    }
    $hash = password_hash($password, PASSWORD_DEFAULT);
    $permissionsJson = json_encode(array_values(array_unique($permissions)));
    if (!is_string($hash) || !is_string($permissionsJson)) {
        error_log('Ambients staff password or permissions encoding failed.');
        data_respond(500, ['error' => 'staff_create_failed', 'message' => 'The staff account could not be created.']);
    }
    $db->beginTransaction();
    try {
        $db->prepare('INSERT INTO staff_users (email, display_name, password_hash, role, permissions, is_active, created_by) VALUES (?, ?, ?, ?, ?, 1, ?)')
            ->execute([$email, $displayName, $hash, 'operator', $permissionsJson, $_SESSION['admin_email']]);
        $staffId = (string) $db->lastInsertId();
        data_audit($db, 'staff.created', 'staff', $staffId, ['email' => $email, 'role' => 'operator', 'permissions' => $permissions]);
        $db->commit();
        data_respond(201, ['created' => true]);
    } catch (Throwable $error) {
        if ($db->inTransaction()) $db->rollBack();
        if ($error instanceof PDOException && (string) $error->getCode() === '23000') {
            data_respond(409, ['error' => 'staff_conflict', 'message' => 'A staff account with that email already exists.']);
        }
        error_log('Ambients staff account creation failed: ' . $error->getMessage());
        data_respond(500, ['error' => 'staff_create_failed', 'message' => 'The staff account could not be created.']);
    }
}

if ($method === 'PATCH' && $resource === 'staff') {
    data_require_admin('admin');
    $body = data_read_json();
    $id = filter_var($body['id'] ?? null, FILTER_VALIDATE_INT);
    if ($id === false || $id < 1) {
        data_respond(400, ['error' => 'invalid_staff_update', 'message' => 'The staff account update is invalid.']);
    }
    $db = data_db();
    $find = $db->prepare('SELECT id, email, display_name, is_active FROM staff_users WHERE id = ?');
    $find->execute([$id]);
    $staff = $find->fetch();
    if (!$staff) {
        data_respond(404, ['error' => 'staff_not_found', 'message' => 'The staff account was not found.']);
    }
    if ($staff['email'] === $_SESSION['admin_email']) {
        data_respond(409, ['error' => 'primary_admin_protected', 'message' => 'The primary administrator account cannot be changed here.']);
    }
    $updates = [];
    $parameters = [];
    $auditDetails = [];
    if (array_key_exists('isActive', $body)) {
        if (!is_bool($body['isActive'])) data_respond(400, ['error' => 'invalid_staff_update', 'message' => 'Choose whether the account should be active.']);
        $updates[] = 'is_active = ?';
        $parameters[] = (int) $body['isActive'];
        $auditDetails['isActive'] = $body['isActive'];
    }
    if (array_key_exists('displayName', $body)) {
        $displayName = data_string($body, 'displayName', 120);
        if ($displayName === '') data_respond(400, ['error' => 'invalid_staff_update', 'message' => 'Enter a display name.']);
        $updates[] = 'display_name = ?';
        $parameters[] = $displayName;
        $auditDetails['displayNameChanged'] = true;
    }
    if (array_key_exists('email', $body)) {
        $email = strtolower(data_string($body, 'email', 254));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) data_respond(400, ['error' => 'invalid_staff_update', 'message' => 'Enter a valid email address.']);
        $updates[] = 'email = ?';
        $parameters[] = $email;
        $auditDetails['emailChanged'] = true;
    }
    if (array_key_exists('permissions', $body)) {
        $permissions = data_staff_permissions($body['permissions']);
        if ($permissions === null) {
            data_respond(400, ['error' => 'invalid_staff_update', 'message' => 'Choose valid access permissions.']);
        }
        $permissionsJson = json_encode($permissions);
        if (!is_string($permissionsJson)) data_respond(400, ['error' => 'invalid_staff_update', 'message' => 'The access permissions could not be saved.']);
        $updates[] = 'permissions = ?';
        $parameters[] = $permissionsJson;
        $auditDetails['permissions'] = array_values(array_unique($permissions));
    }
    $temporaryPassword = null;
    if (($body['resetPassword'] ?? false) === true) {
        $temporaryPassword = bin2hex(random_bytes(16));
        $hash = password_hash($temporaryPassword, PASSWORD_DEFAULT);
        if (!is_string($hash)) {
            error_log('Ambients staff reset password hashing failed.');
            data_respond(500, ['error' => 'staff_reset_failed', 'message' => 'A temporary password could not be generated.']);
        }
        $updates[] = 'password_hash = ?';
        $parameters[] = $hash;
        $updates[] = 'must_change_password = 1';
        $auditDetails['passwordReset'] = true;
    }
    if ($updates === []) data_respond(400, ['error' => 'invalid_staff_update', 'message' => 'No account changes were provided.']);
    $updates[] = 'session_version = session_version + 1';
    $parameters[] = $id;
    try {
        $db->beginTransaction();
        $db->prepare('UPDATE staff_users SET ' . implode(', ', $updates) . ' WHERE id = ?')->execute($parameters);
        data_audit($db, 'staff.updated', 'staff', (string) $id, ['email' => $staff['email']] + $auditDetails);
        $db->commit();
        data_respond(200, ['updated' => true, 'temporaryPassword' => $temporaryPassword]);
    } catch (Throwable $error) {
        if ($db->inTransaction()) $db->rollBack();
        if ($error instanceof PDOException && (string) $error->getCode() === '23000') {
            data_respond(409, ['error' => 'staff_email_conflict', 'message' => 'That email address is already assigned to another account.']);
        }
        error_log('Ambients staff account update failed: ' . $error->getMessage());
        data_respond(500, ['error' => 'staff_update_failed', 'message' => 'The staff account could not be updated.']);
    }
}

if ($method === 'PATCH' && $resource === 'products') {
    data_require_permission('products');
    $body = data_read_json();
    $db = data_db();
    if (isset($body['bulkPercent'])) {
        $percent = $body['bulkPercent'];
        $category = data_string($body, 'category', 80);
        if (!is_numeric($percent) || (float) $percent < -100 || (float) $percent > 100) {
            data_respond(400, ['error' => 'invalid_adjustment', 'message' => 'Price changes must be between -100% and 100%.']);
        }
        $factor = 1 + ((float) $percent / 100);
        $db->beginTransaction();
        try {
            if ($category === 'All') {
                $update = $db->prepare('UPDATE products SET price = ROUND(price * ?, 2) WHERE is_active = 1');
                $update->execute([$factor]);
            } else {
                $update = $db->prepare('UPDATE products SET price = ROUND(price * ?, 2) WHERE is_active = 1 AND category = ?');
                $update->execute([$factor, $category]);
            }
            data_audit($db, 'product.bulk_price_adjusted', 'catalog', $category, ['percent' => (float) $percent]);
            $db->commit();
        } catch (Throwable $error) {
            if ($db->inTransaction()) $db->rollBack();
            error_log('Ambients bulk price update failed: ' . $error->getMessage());
            data_respond(500, ['error' => 'bulk_price_failed', 'message' => 'The bulk price change could not be saved.']);
        }
        data_respond(200, ['updated' => true]);
    }

    $product = data_product_input($db, $body, true);
    $db->beginTransaction();
    try {
        $update = $db->prepare(
            'UPDATE products SET name = ?, category = ?, description = ?, rx_required = ?, dosage = ?, sku = ?, ndc_code = ?, image = ?, images = ?,
             price = ?, cost_price = ?, copay_price = ?, stock_count = ?, min_stock_threshold = ?, is_active = ?, is_featured = ?,
             last_restocked = IF(stock_count < ?, CURDATE(), last_restocked) WHERE id = ? AND is_archived = 0'
        );
        $update->execute([
            $product['name'], $product['category'], $product['description'], (int) $product['rxRequired'],
            $product['dosage'], $product['sku'], $product['ndcCode'], $product['image'],
            json_encode($product['images'], JSON_UNESCAPED_SLASHES), $product['price'],
            $product['costPrice'], $product['copayPrice'], $product['stockCount'], $product['minStockThreshold'],
            (int) $product['isActive'], (int) $product['isFeatured'],
            $product['stockCount'], $product['id'],
        ]);
        if ($update->rowCount() === 0) {
            $check = $db->prepare('SELECT id FROM products WHERE id = ? AND is_archived = 0');
            $check->execute([$product['id']]);
            if (!$check->fetch()) {
                $db->rollBack();
                data_respond(404, ['error' => 'product_not_found', 'message' => 'The product was not found.']);
            }
        }
        data_audit($db, 'product.updated', 'product', $product['id'], ['sku' => $product['sku']]);
        $db->commit();
    } catch (Throwable $error) {
        if ($db->inTransaction()) $db->rollBack();
        if ($error instanceof PDOException && (string) $error->getCode() === '23000') {
            data_respond(409, ['error' => 'product_conflict', 'message' => 'The product ID or SKU is already in use.']);
        }
        error_log('Ambients product update failed: ' . $error->getMessage());
        data_respond(500, ['error' => 'product_update_failed', 'message' => 'The product update could not be saved.']);
    }
    $find = $db->prepare('SELECT * FROM products WHERE id = ?');
    $find->execute([$product['id']]);
    data_respond(200, ['product' => data_product_row($find->fetch())]);
}

if ($method === 'DELETE' && $resource === 'products') {
    data_require_permission('products');
    $id = data_string($_GET, 'id', 64);
    $db = data_db();
    $db->beginTransaction();
    try {
        $update = $db->prepare('UPDATE products SET is_active = 0, is_archived = 1 WHERE id = ? AND is_archived = 0');
        $update->execute([$id]);
        if ($update->rowCount() === 0) {
            $db->rollBack();
            data_respond(404, ['error' => 'product_not_found', 'message' => 'The product was not found.']);
        }
        data_audit($db, 'product.archived', 'product', $id);
        $db->commit();
    } catch (Throwable $error) {
        if ($db->inTransaction()) $db->rollBack();
        error_log('Ambients product archive failed: ' . $error->getMessage());
        data_respond(500, ['error' => 'product_archive_failed', 'message' => 'The product could not be archived.']);
    }
    data_respond(200, ['archived' => true]);
}

if ($method === 'POST' && $resource === 'manual-orders') {
    data_require_permission('orders');
    $body = data_read_json();
    $customerName = data_string($body, 'customerName', 160);
    $email = strtolower(data_string($body, 'email', 254));
    $phone = data_string($body, 'phone', 40, false);
    $deliveryMethod = data_string($body, 'deliveryMethod', 32);
    $deliveryAddress = data_string($body, 'deliveryAddress', 500, false);
    $productId = data_string($body, 'productId', 64);
    $quantity = $body['quantity'] ?? null;
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || !is_int($quantity) || $quantity < 1 || $quantity > 50) {
        data_respond(400, ['error' => 'invalid_manual_order', 'message' => 'Enter valid customer contact details and quantity.']);
    }
    if (!in_array($deliveryMethod, ['Express Courier', 'Pharmacy Pickup', 'Discreet Mail'], true)) {
        data_respond(400, ['error' => 'invalid_delivery', 'message' => 'Select a valid delivery method.']);
    }
    if ($deliveryMethod !== 'Pharmacy Pickup' && $deliveryAddress === '') {
        data_respond(400, ['error' => 'invalid_delivery_address', 'message' => 'Enter a delivery address for shipped orders.']);
    }

    $db = data_db();
    $db->beginTransaction();
    try {
        $productQuery = $db->prepare('SELECT id, name, category, price, stock_count FROM products WHERE id = ? AND is_active = 1 FOR UPDATE');
        $productQuery->execute([$productId]);
        $product = $productQuery->fetch();
        if (!$product || (int) $product['stock_count'] < $quantity) {
            $db->rollBack();
            data_respond(409, ['error' => 'unavailable_item', 'message' => 'The selected product is unavailable or has insufficient stock.']);
        }
        $unitPrice = (float) $product['price'];
        $subtotal = round($unitPrice * $quantity, 2);
        $shippingFee = $deliveryMethod === 'Express Courier' && $subtotal < 35 ? 12.00 : 0.00;
        $total = round($subtotal + $shippingFee, 2);
        $orderId = bin2hex(random_bytes(16));
        $orderNumber = 'ORD-' . gmdate('Ymd') . '-' . strtoupper(bin2hex(random_bytes(3)));
        $placedAt = gmdate('Y-m-d H:i:s');
        $db->prepare(
            'INSERT INTO orders (id, order_number, customer_name, email, phone, delivery_method, delivery_address, subtotal, shipping_fee, discount_amount, total_amount, payment_method, payment_status, status, placed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)'
        )->execute([
            $orderId, $orderNumber, $customerName, $email, $phone, $deliveryMethod,
            $deliveryMethod === 'Pharmacy Pickup' ? 'Pharmacy Pickup' : $deliveryAddress,
            $subtotal, $shippingFee, $total, 'Cash on Delivery / Pickup', 'Pending Verification', 'Pending', $placedAt,
        ]);
        $db->prepare(
            'INSERT INTO order_items (order_id, product_id, product_name, category, quantity, unit_price) VALUES (?, ?, ?, ?, ?, ?)'
        )->execute([$orderId, $product['id'], $product['name'], $product['category'], $quantity, $unitPrice]);
        $db->prepare('UPDATE products SET stock_count = stock_count - ? WHERE id = ?')->execute([$quantity, $productId]);
        $nameParts = preg_split('/\s+/', $customerName, 2) ?: [$customerName];
        $db->prepare(
            "INSERT INTO leads (first_name, last_name, email, phone, lead_source) VALUES (?, ?, ?, ?, 'Online Order')
             ON DUPLICATE KEY UPDATE id = id"
        )->execute([$nameParts[0], $nameParts[1] ?? '', $email, $phone]);
        data_audit($db, 'order.created_manually', 'order', $orderId, ['orderNumber' => $orderNumber, 'total' => $total]);
        $db->commit();
        $find = $db->prepare('SELECT * FROM orders WHERE id = ?');
        $find->execute([$orderId]);
        data_respond(201, ['order' => data_order_row($db, $find->fetch())]);
    } catch (Throwable $error) {
        if ($db->inTransaction()) $db->rollBack();
        error_log('Ambients manual order creation failed: ' . $error->getMessage());
        data_respond(500, ['error' => 'manual_order_failed', 'message' => 'The order could not be saved.']);
    }
}

if ($method === 'POST' && $resource === 'orders') {
    $body = data_read_json();
    $db = data_db();
    $customerName = data_string($body, 'customerName', 160);
    $email = strtolower(data_string($body, 'email', 254));
    $phone = data_string($body, 'phone', 40);
    $deliveryMethod = data_string($body, 'deliveryMethod', 32);
    $deliveryAddress = data_string($body, 'deliveryAddress', 500);
    $couponCode = strtoupper(data_string($body, 'couponCode', 32, false));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        data_respond(400, ['error' => 'invalid_email', 'message' => 'Enter a valid email address.']);
    }
    if (!in_array($deliveryMethod, ['Express Courier', 'Pharmacy Pickup', 'Discreet Mail'], true)) {
        data_respond(400, ['error' => 'invalid_delivery', 'message' => 'Select a valid delivery method.']);
    }
    if (!is_array($body['items'] ?? null) || count($body['items']) < 1 || count($body['items']) > 30) {
        data_respond(400, ['error' => 'invalid_items', 'message' => 'The order items are invalid.']);
    }
    if (isset($body['paymentMethod']) && $body['paymentMethod'] !== 'Cash on Delivery / Pickup') {
        data_respond(400, ['error' => 'payment_unavailable', 'message' => 'This payment method is not configured.']);
    }

    $requestedItems = [];
    foreach ($body['items'] as $requestedItem) {
        if (
            !is_array($requestedItem)
            || !is_string($requestedItem['productId'] ?? null)
            || !is_int($requestedItem['quantity'] ?? null)
            || $requestedItem['quantity'] < 1
            || $requestedItem['quantity'] > 50
        ) {
            data_respond(400, ['error' => 'invalid_items', 'message' => 'An order item is invalid.']);
        }
        $productId = $requestedItem['productId'];
        $requestedItems[$productId] = ($requestedItems[$productId] ?? 0) + $requestedItem['quantity'];
        if ($requestedItems[$productId] > 50) {
            data_respond(400, ['error' => 'invalid_items', 'message' => 'The requested quantity is too large.']);
        }
    }

    $db->beginTransaction();
    try {
        $subtotal = 0.0;
        $items = [];
        $productQuery = $db->prepare('SELECT id, name, category, price, stock_count FROM products WHERE id = ? AND is_active = 1 FOR UPDATE');
        foreach ($requestedItems as $productId => $quantity) {
            $productQuery->execute([$productId]);
            $product = $productQuery->fetch();
            if (!$product || (int) $product['stock_count'] < $quantity) {
                $db->rollBack();
                data_respond(409, ['error' => 'unavailable_item', 'message' => 'An item is unavailable or has insufficient stock.']);
            }
            $unitPrice = (float) $product['price'];
            $subtotal += $unitPrice * $quantity;
            $items[] = [
                'id' => $product['id'],
                'name' => $product['name'],
                'category' => $product['category'],
                'quantity' => $quantity,
                'unitPrice' => $unitPrice,
            ];
        }

        $discountRate = match ($couponCode) {
            'AURA10', 'SAVE10' => 0.10,
            'CRYPTO5' => 0.05,
            'FREESHIP', '' => 0.0,
            default => -1.0,
        };
        if ($discountRate < 0) {
            $db->rollBack();
            data_respond(400, ['error' => 'invalid_coupon', 'message' => 'The coupon code is invalid.']);
        }
        $discountAmount = round($subtotal * $discountRate, 2);
        $shippingFee = $deliveryMethod === 'Express Courier' && $subtotal < 35 && $couponCode !== 'FREESHIP' ? 12.00 : 0.00;
        $totalAmount = max(0, round($subtotal - $discountAmount + $shippingFee, 2));
        $orderId = bin2hex(random_bytes(16));
        $orderNumber = 'ORD-' . gmdate('Ymd') . '-' . strtoupper(bin2hex(random_bytes(3)));
        $placedAt = gmdate('Y-m-d H:i:s');

        $db->prepare(
            'INSERT INTO orders (id, order_number, customer_name, email, phone, delivery_method, delivery_address, subtotal, shipping_fee, discount_amount, coupon_code, total_amount, payment_method, payment_status, status, placed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )->execute([
            $orderId, $orderNumber, $customerName, $email, $phone, $deliveryMethod, $deliveryAddress,
            $subtotal, $shippingFee, $discountAmount, $couponCode === '' ? null : $couponCode,
            $totalAmount, 'Cash on Delivery / Pickup', 'Pending Verification', 'Pending', $placedAt,
        ]);

        $insertItem = $db->prepare(
            'INSERT INTO order_items (order_id, product_id, product_name, category, quantity, unit_price) VALUES (?, ?, ?, ?, ?, ?)'
        );
        $updateStock = $db->prepare('UPDATE products SET stock_count = stock_count - ? WHERE id = ?');
        foreach ($items as $item) {
            $insertItem->execute([$orderId, $item['id'], $item['name'], $item['category'], $item['quantity'], $item['unitPrice']]);
            $updateStock->execute([$item['quantity'], $item['id']]);
        }

        $nameParts = preg_split('/\s+/', $customerName, 2) ?: [$customerName];
        $db->prepare(
            "INSERT INTO leads (first_name, last_name, email, phone, lead_source) VALUES (?, ?, ?, ?, 'Online Order')
             ON DUPLICATE KEY UPDATE id = id"
        )->execute([$nameParts[0], $nameParts[1] ?? '', $email, $phone]);
        data_audit($db, 'order.created', 'order', $orderId, ['orderNumber' => $orderNumber, 'total' => $totalAmount]);
        $db->commit();

        $rowQuery = $db->prepare('SELECT * FROM orders WHERE id = ?');
        $rowQuery->execute([$orderId]);
        data_respond(201, ['order' => data_order_row($db, $rowQuery->fetch())]);
    } catch (Throwable $error) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        error_log('Ambients order creation failed: ' . $error->getMessage());
        data_respond(500, ['error' => 'order_failed', 'message' => 'The order could not be saved. Please try again.']);
    }
}

if ($method === 'POST' && $resource === 'leads') {
    data_require_permission('leads');
    $body = data_read_json();
    $leads = $body['leads'] ?? null;
    if (!is_array($leads) || count($leads) < 1 || count($leads) > 500) {
        data_respond(400, ['error' => 'invalid_leads', 'message' => 'Provide between 1 and 500 contact leads.']);
    }

    $db = data_db();
    $canEditContactDetails = ($_SESSION['admin_role'] ?? '') === 'admin';
    $assignedStaffId = $canEditContactDetails ? null : (int) ($_SESSION['staff_id'] ?? 0);
    $insert = $db->prepare(
        'INSERT INTO leads (first_name, last_name, email, phone, country, lead_source, marketing_consent, marketing_consent_at, assigned_staff_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, IF(? = 1, CURRENT_TIMESTAMP, NULL), ?)
         ON DUPLICATE KEY UPDATE first_name = IF(? = 1, VALUES(first_name), first_name),
           last_name = IF(? = 1, VALUES(last_name), last_name),
           phone = IF(? = 1, VALUES(phone), phone),
           country = IF(? = 1 AND VALUES(country) <> \'\', VALUES(country), country),
           marketing_consent = IF(VALUES(marketing_consent) = 1, 1, marketing_consent),
           marketing_consent_at = IF(VALUES(marketing_consent) = 1, CURRENT_TIMESTAMP, marketing_consent_at),
           assigned_staff_id = IF(assigned_staff_id IS NULL, VALUES(assigned_staff_id), assigned_staff_id)'
    );
    $find = $db->prepare(
        'SELECT l.id, l.first_name, l.last_name, l.email, l.phone, l.country, l.lead_source, l.status, l.marketing_consent, l.marketing_consent_at, l.created_at,
                l.assigned_staff_id, (SELECT display_name FROM staff_users WHERE id = l.assigned_staff_id) AS assigned_staff_name,
                COUNT(o.id) AS order_count, MAX(o.placed_at) AS last_order_at,
                COUNT(CASE WHEN o.status <> \'Cancelled\' THEN 1 END) AS active_order_count,
                (SELECT COUNT(*) FROM lead_activities la WHERE la.lead_id = l.id AND la.activity_type = \'call\') AS call_count
         FROM leads l LEFT JOIN orders o ON o.email = l.email
         WHERE l.email = ? GROUP BY l.id LIMIT 1'
    );
    $existingOwner = $db->prepare('SELECT assigned_staff_id FROM leads WHERE email = ?');
    $priorConsent = $db->prepare('SELECT marketing_consent FROM leads WHERE email = ?');
    $saved = [];
    $db->beginTransaction();
    try {
        foreach ($leads as $lead) {
            if (!is_array($lead)) {
                data_respond(400, ['error' => 'invalid_lead', 'message' => 'A submitted lead is invalid.']);
            }
            $firstName = data_string($lead, 'firstName', 100);
            $lastName = data_string($lead, 'lastName', 100);
            $email = strtolower(data_string($lead, 'email', 254));
            $phone = data_string($lead, 'phone', 40, false);
            $country = data_string($lead, 'country', 100, false);
            $marketingConsent = $lead['marketingConsent'] ?? false;
            if (!is_bool($marketingConsent)) {
                data_respond(400, ['error' => 'invalid_consent', 'message' => 'Marketing consent must be explicitly true or false.']);
            }
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                data_respond(400, ['error' => 'invalid_email', 'message' => 'A lead has an invalid email address.']);
            }
            $priorConsent->execute([$email]);
            $wasOptedIn = (bool) $priorConsent->fetchColumn();
            $source = in_array($lead['leadSource'] ?? '', ['CSV Upload', 'Manual Entry'], true)
                ? $lead['leadSource']
                : 'Manual Entry';
            $existingOwner->execute([$email]);
            $ownerId = $existingOwner->fetchColumn();
            if ($ownerId !== false && !$canEditContactDetails && $ownerId !== null && (int) $ownerId !== $assignedStaffId) {
                data_respond(404, ['error' => 'lead_not_found', 'message' => 'A submitted contact lead is not available to this agent.']);
            }
            $canEditValue = (int) $canEditContactDetails;
            $insert->execute([$firstName, $lastName, $email, $phone, $country, $source, (int) $marketingConsent, (int) $marketingConsent, $assignedStaffId, $canEditValue, $canEditValue, $canEditValue, $canEditValue]);
            $find->execute([$email]);
            $savedLead = $find->fetch();
            if (!$canEditContactDetails && (!$savedLead || (int) $savedLead['assigned_staff_id'] !== $assignedStaffId)) {
                data_respond(404, ['error' => 'lead_not_found', 'message' => 'A submitted contact lead is not available to this agent.']);
            }
            $saved[] = data_lead_row($savedLead);
            if ($marketingConsent && !$wasOptedIn) {
                data_audit($db, 'lead.marketing_opt_in', 'lead', (string) $savedLead['id']);
            }
        }
        $db->commit();
    } catch (Throwable $error) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        if ($error instanceof PDOException) {
            error_log('Ambients contact lead save failed: ' . $error->getMessage());
        }
        data_respond(500, ['error' => 'lead_save_failed', 'message' => 'The contact leads could not be saved.']);
    }
    data_respond(201, ['leads' => $saved]);
}

if ($method === 'PATCH' && $resource === 'leads') {
    data_require_permission('leads');
    $body = data_read_json();
    $id = filter_var($body['id'] ?? null, FILTER_VALIDATE_INT);
    if ($id === false || $id < 1) {
        data_respond(400, ['error' => 'invalid_lead_id', 'message' => 'The contact lead identifier is invalid.']);
    }
    $status = $body['status'] ?? null;
    $marketingConsent = $body['marketingConsent'] ?? null;
    $statusNote = array_key_exists('statusNote', $body) ? data_string($body, 'statusNote', 2000, false) : null;
    $firstNameProvided = array_key_exists('firstName', $body);
    $firstName = $firstNameProvided ? data_string($body, 'firstName', 100) : null;
    $lastNameProvided = array_key_exists('lastName', $body);
    $lastName = $lastNameProvided ? data_string($body, 'lastName', 100) : null;
    $emailProvided = array_key_exists('email', $body);
    $email = $emailProvided ? strtolower(data_string($body, 'email', 254)) : null;
    if ($emailProvided && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        data_respond(400, ['error' => 'invalid_email', 'message' => 'Provide a valid email address.']);
    }
    $phoneProvided = array_key_exists('phone', $body);
    $phone = $phoneProvided ? data_string($body, 'phone', 40, false) : null;
    $countryProvided = array_key_exists('country', $body);
    $country = $countryProvided ? data_string($body, 'country', 100, false) : null;
    $contactDetailsProvided = $firstNameProvided || $lastNameProvided || $emailProvided || $phoneProvided || $countryProvided;
    $assignedStaffProvided = array_key_exists('assignedStaffId', $body);
    $assignedStaffId = $body['assignedStaffId'] ?? null;
    if ($contactDetailsProvided && ($_SESSION['admin_role'] ?? '') !== 'admin') {
        data_respond(403, ['error' => 'admin_required', 'message' => 'Only a superadmin can edit lead contact details.']);
    }
    if ($assignedStaffProvided && ($_SESSION['admin_role'] ?? '') !== 'admin') {
        data_respond(403, ['error' => 'admin_required', 'message' => 'Only a superadmin can assign contact leads.']);
    }
    if ($assignedStaffProvided && $assignedStaffId !== null && (!is_int($assignedStaffId) || $assignedStaffId < 1)) {
        data_respond(400, ['error' => 'invalid_lead_assignment', 'message' => 'Choose an active agent or leave the lead unassigned.']);
    }
    $validStatuses = ['Cold', 'Contacted', 'Qualified', 'Customer', 'Inactive'];
    if (
        ($status === null && $marketingConsent === null && !$contactDetailsProvided && !$assignedStaffProvided)
        || ($status !== null && (!is_string($status) || !in_array($status, $validStatuses, true)))
        || ($marketingConsent !== null && !is_bool($marketingConsent))
        || ($statusNote !== null && $status === null)
    ) {
        data_respond(400, ['error' => 'invalid_lead_update', 'message' => 'Provide a valid lead stage, contact detail, or marketing consent value.']);
    }

    $db = data_db();
    data_require_lead_access($db, (int) $id);
    $db->beginTransaction();
    try {
        if ($assignedStaffProvided && $assignedStaffId !== null) {
            $activeStaff = $db->prepare('SELECT id FROM staff_users WHERE id = ? AND role = ? AND is_active = 1 FOR UPDATE');
            $activeStaff->execute([$assignedStaffId, 'operator']);
            if (!$activeStaff->fetchColumn()) {
                $db->rollBack();
                data_respond(400, ['error' => 'invalid_lead_assignment', 'message' => 'Choose an active agent or leave the lead unassigned.']);
            }
        }
        $find = $db->prepare('SELECT id, first_name, last_name, email, phone, country, status, marketing_consent, assigned_staff_id FROM leads WHERE id = ? FOR UPDATE');
        $find->execute([$id]);
        $current = $find->fetch();
        if (!$current) {
            $db->rollBack();
            data_respond(404, ['error' => 'lead_not_found', 'message' => 'The contact lead was not found.']);
        }
        if (($_SESSION['admin_role'] ?? '') !== 'admin'
            && ($current['assigned_staff_id'] === null || (int) $current['assigned_staff_id'] !== (int) ($_SESSION['staff_id'] ?? 0))) {
            $db->rollBack();
            data_respond(404, ['error' => 'lead_not_found', 'message' => 'The contact lead was not found.']);
        }
        if ($emailProvided && $email !== $current['email']) {
            $duplicate = $db->prepare('SELECT id FROM leads WHERE email = ? AND id <> ? LIMIT 1 FOR UPDATE');
            $duplicate->execute([$email, $id]);
            if ($duplicate->fetchColumn()) {
                $db->rollBack();
                data_respond(409, ['error' => 'lead_email_in_use', 'message' => 'Another lead already uses this email address.']);
            }
            $existingOrder = $db->prepare('SELECT id FROM orders WHERE email = ? LIMIT 1 FOR UPDATE');
            $existingOrder->execute([$email]);
            if ($existingOrder->fetchColumn()) {
                $db->rollBack();
                data_respond(409, ['error' => 'lead_email_has_orders', 'message' => 'This email address is already associated with other order history.']);
            }
        }
        $updates = [];
        $parameters = [];
        $changedContactFields = [];
        if ($firstNameProvided && $firstName !== $current['first_name']) {
            $updates[] = 'first_name = ?';
            $parameters[] = $firstName;
            $changedContactFields[] = 'firstName';
        }
        if ($lastNameProvided && $lastName !== $current['last_name']) {
            $updates[] = 'last_name = ?';
            $parameters[] = $lastName;
            $changedContactFields[] = 'lastName';
        }
        if ($emailProvided && $email !== $current['email']) {
            $updates[] = 'email = ?';
            $parameters[] = $email;
            $changedContactFields[] = 'email';
            $db->prepare('UPDATE orders SET email = ? WHERE email = ?')->execute([$email, $current['email']]);
        }
        if ($status !== null && $status !== $current['status']) {
            $updates[] = 'status = ?';
            $parameters[] = $status;
            $details = [
                'from' => $current['status'],
                'to' => $status,
                'actorName' => (string) ($_SESSION['admin_display_name'] ?? $_SESSION['admin_email'] ?? 'Staff'),
            ];
            if ($statusNote !== null && $statusNote !== '') $details['note'] = $statusNote;
            data_audit($db, 'lead.stage_changed', 'lead', (string) $id, $details);
        }
        if ($phoneProvided && $phone !== $current['phone']) {
            $updates[] = 'phone = ?';
            $parameters[] = $phone;
            data_audit($db, 'lead.phone_updated', 'lead', (string) $id, [
                'actorName' => (string) ($_SESSION['admin_display_name'] ?? $_SESSION['admin_email'] ?? 'Staff'),
            ]);
        }
        if ($countryProvided && $country !== $current['country']) {
            $updates[] = 'country = ?';
            $parameters[] = $country;
            $changedContactFields[] = 'country';
        }
        if ($changedContactFields !== []) {
            data_audit($db, 'lead.contact_details_updated', 'lead', (string) $id, [
                'fields' => $changedContactFields,
                'actorName' => (string) ($_SESSION['admin_display_name'] ?? $_SESSION['admin_email'] ?? 'Staff'),
            ]);
        }
        if ($marketingConsent !== null && (bool) $marketingConsent !== (bool) $current['marketing_consent']) {
            $updates[] = 'marketing_consent = ?';
            $parameters[] = (int) $marketingConsent;
            $updates[] = 'marketing_consent_at = ?';
            $parameters[] = $marketingConsent ? gmdate('Y-m-d H:i:s') : null;
            data_audit($db, $marketingConsent ? 'lead.marketing_opt_in' : 'lead.marketing_opt_out', 'lead', (string) $id);
        }
        if ($assignedStaffProvided) {
            $updates[] = 'assigned_staff_id = ?';
            $parameters[] = $assignedStaffId;
            data_audit($db, 'lead.assignment_changed', 'lead', (string) $id, ['assignedStaffId' => $assignedStaffId]);
        }
        if ($updates) {
            $parameters[] = $id;
            $db->prepare('UPDATE leads SET ' . implode(', ', $updates) . ' WHERE id = ?')->execute($parameters);
        }
        $db->commit();
    } catch (Throwable $error) {
        if ($db->inTransaction()) $db->rollBack();
        error_log('Ambients contact lead update failed: ' . $error->getMessage());
        data_respond(500, ['error' => 'lead_update_failed', 'message' => 'The contact lead could not be updated.']);
    }
    $find = $db->prepare(
        'SELECT l.id, l.first_name, l.last_name, l.email, l.phone, l.country, l.lead_source, l.status, l.marketing_consent, l.marketing_consent_at, l.created_at,
                l.assigned_staff_id, (SELECT display_name FROM staff_users WHERE id = l.assigned_staff_id) AS assigned_staff_name,
                COUNT(o.id) AS order_count, MAX(o.placed_at) AS last_order_at,
                COUNT(CASE WHEN o.status <> \'Cancelled\' THEN 1 END) AS active_order_count,
                (SELECT COUNT(*) FROM lead_activities la WHERE la.lead_id = l.id AND la.activity_type = \'call\') AS call_count
         FROM leads l LEFT JOIN orders o ON o.email = l.email
         WHERE l.id = ? GROUP BY l.id LIMIT 1'
    );
    $find->execute([$id]);
    data_respond(200, ['lead' => data_lead_row($find->fetch())]);
}

if ($method === 'POST' && $resource === 'lead-activities') {
    data_require_permission('leads');
    $body = data_read_json();
    $leadId = filter_var($body['leadId'] ?? null, FILTER_VALIDATE_INT);
    if ($leadId === false || $leadId < 1) {
        data_respond(400, ['error' => 'invalid_lead_id', 'message' => 'The contact lead identifier is invalid.']);
    }

    $type = data_string($body, 'type', 8);
    $note = data_string($body, 'note', 2000, false);
    $outcome = data_string($body, 'outcome', 32, false);
    $followUpDate = data_string($body, 'followUpDate', 10, false);
    $validOutcomes = ['Connected', 'No answer', 'Voicemail left', 'Busy', 'Wrong number', 'Callback requested', 'Not interested'];
    if (
        !in_array($type, ['note', 'call'], true)
        || ($type === 'note' && $note === '')
        || ($type === 'call' && !in_array($outcome, $validOutcomes, true))
        || ($type === 'note' && $outcome !== '')
        || ($followUpDate !== '' && (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $followUpDate)
            || !checkdate((int) substr($followUpDate, 5, 2), (int) substr($followUpDate, 8, 2), (int) substr($followUpDate, 0, 4))))
    ) {
        data_respond(400, ['error' => 'invalid_lead_activity', 'message' => 'Enter a comment or a valid call outcome and follow-up date.']);
    }

    $db = data_db();
    $db->beginTransaction();
    $exists = $db->prepare('SELECT id, assigned_staff_id FROM leads WHERE id = ? FOR UPDATE');
    $exists->execute([$leadId]);
    $lead = $exists->fetch();
    if (!$lead) {
        $db->rollBack();
        data_respond(404, ['error' => 'lead_not_found', 'message' => 'The contact lead was not found.']);
    }
    if (($_SESSION['admin_role'] ?? '') !== 'admin'
        && ($lead['assigned_staff_id'] === null || (int) $lead['assigned_staff_id'] !== (int) ($_SESSION['staff_id'] ?? 0))) {
        $db->rollBack();
        data_respond(404, ['error' => 'lead_not_found', 'message' => 'The contact lead was not found.']);
    }

    $authorEmail = (string) ($_SESSION['admin_email'] ?? 'unknown');
    $authorName = trim((string) ($_SESSION['admin_display_name'] ?? ''));
    if ($authorName === '') $authorName = $authorEmail;
    try {
        $insert = $db->prepare(
            'INSERT INTO lead_activities (lead_id, activity_type, note, call_outcome, follow_up_date, author_email, author_name)
             VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        $insert->execute([
            $leadId,
            $type,
            $note === '' ? null : $note,
            $type === 'call' ? $outcome : null,
            $followUpDate === '' ? null : $followUpDate,
            $authorEmail,
            $authorName,
        ]);
        $activityId = (int) $db->lastInsertId();
        $auditDetails = ['type' => $type];
        if ($type === 'call') $auditDetails['outcome'] = $outcome;
        if ($followUpDate !== '') $auditDetails['followUpDate'] = $followUpDate;
        data_audit($db, $type === 'call' ? 'lead.call_logged' : 'lead.note_added', 'lead', (string) $leadId, $auditDetails);
        $created = $db->prepare('SELECT created_at FROM lead_activities WHERE id = ?');
        $created->execute([$activityId]);
        $createdAt = (string) $created->fetchColumn();
        $db->commit();
    } catch (Throwable $error) {
        if ($db->inTransaction()) $db->rollBack();
        error_log('Ambients lead activity save failed: ' . $error->getMessage());
        data_respond(500, ['error' => 'lead_activity_failed', 'message' => 'The lead activity could not be saved.']);
    }

    data_respond(201, ['activity' => [
        'id' => 'activity-' . (string) $activityId,
        'type' => $type,
        'note' => $note,
        'outcome' => $type === 'call' ? $outcome : null,
        'followUpDate' => $followUpDate === '' ? null : $followUpDate,
        'actorName' => $authorName,
        'actorEmail' => $authorEmail,
        'createdAt' => $createdAt,
    ]]);
}

if ($method === 'POST' && $resource === 'order-notes') {
    data_require_permission('orders');
    $body = data_read_json();
    $orderId = data_string($body, 'orderId', 64);
    $note = data_string($body, 'note', 2000);
    $db = data_db();
    $exists = $db->prepare('SELECT id FROM orders WHERE id = ?');
    $exists->execute([$orderId]);
    if (!$exists->fetch()) {
        data_respond(404, ['error' => 'order_not_found', 'message' => 'The order was not found.']);
    }
    $author = (string) ($_SESSION['admin_email'] ?? 'unknown');
    $db->beginTransaction();
    try {
        $db->prepare('INSERT INTO order_notes (order_id, author_email, note) VALUES (?, ?, ?)')->execute([$orderId, $author, $note]);
        data_audit($db, 'order.note_added', 'order', $orderId);
        $saved = $db->prepare('SELECT created_at FROM order_notes WHERE id = LAST_INSERT_ID()');
        $saved->execute();
        $createdAt = $saved->fetchColumn();
        $db->commit();
        data_respond(201, ['note' => '[' . $createdAt . ' ' . $author . '] ' . $note]);
    } catch (Throwable $error) {
        if ($db->inTransaction()) $db->rollBack();
        error_log('Ambients order note failed: ' . $error->getMessage());
        data_respond(500, ['error' => 'order_note_failed', 'message' => 'The order note could not be saved.']);
    }
}

if ($method === 'PATCH' && $resource === 'orders') {
    data_require_permission('orders');
    $body = data_read_json();
    $id = data_string($body, 'id', 64);
    $status = data_string($body, 'status', 32);
    $allowedStatuses = ['Pending', 'Submitted', 'Pharmacist Review', 'Dispensing', 'Ready for Pickup', 'Shipped', 'Delivered', 'Completed', 'Cancelled'];
    if (!in_array($status, $allowedStatuses, true)) {
        data_respond(400, ['error' => 'invalid_status', 'message' => 'The order status is invalid.']);
    }
    $carrierProvided = array_key_exists('carrier', $body);
    $trackingNumberProvided = array_key_exists('trackingNumber', $body);
    $carrier = $carrierProvided ? data_string($body, 'carrier', 120, false) : null;
    $trackingNumber = $trackingNumberProvided ? data_string($body, 'trackingNumber', 180, false) : null;
    $db = data_db();
    $db->beginTransaction();
    try {
        $find = $db->prepare('SELECT status, carrier, tracking_number FROM orders WHERE id = ? FOR UPDATE');
        $find->execute([$id]);
        $current = $find->fetch();
        if (!$current) {
            $db->rollBack();
            data_respond(404, ['error' => 'order_not_found', 'message' => 'The order was not found.']);
        }
        $nextCarrier = $carrierProvided ? ($carrier === '' ? null : $carrier) : $current['carrier'];
        $nextTrackingNumber = $trackingNumberProvided ? ($trackingNumber === '' ? null : $trackingNumber) : $current['tracking_number'];
        if ($current['status'] !== 'Cancelled' && $status === 'Cancelled') {
            $restock = $db->prepare(
                'UPDATE products p INNER JOIN order_items i ON i.product_id = p.id SET p.stock_count = p.stock_count + i.quantity WHERE i.order_id = ?'
            );
            $restock->execute([$id]);
        } elseif ($current['status'] === 'Cancelled' && $status !== 'Cancelled') {
            $items = $db->prepare('SELECT product_id, quantity FROM order_items WHERE order_id = ? ORDER BY product_id FOR UPDATE');
            $items->execute([$id]);
            $quantities = [];
            foreach ($items->fetchAll() as $item) {
                $productId = (string) $item['product_id'];
                $quantities[$productId] = ($quantities[$productId] ?? 0) + (int) $item['quantity'];
            }
            $productStock = $db->prepare('SELECT stock_count FROM products WHERE id = ? FOR UPDATE');
            $reserveStock = $db->prepare('UPDATE products SET stock_count = stock_count - ? WHERE id = ? AND stock_count >= ?');
            foreach ($quantities as $productId => $quantity) {
                $productStock->execute([$productId]);
                $availableStock = $productStock->fetchColumn();
                if ($availableStock === false || (int) $availableStock < $quantity) {
                    $db->rollBack();
                    data_respond(409, ['error' => 'insufficient_stock', 'message' => 'This cancelled order cannot be reopened because one or more items no longer have enough stock.']);
                }
                $reserveStock->execute([$quantity, $productId, $quantity]);
                if ($reserveStock->rowCount() !== 1) {
                    $db->rollBack();
                    data_respond(409, ['error' => 'insufficient_stock', 'message' => 'This cancelled order cannot be reopened because stock changed. Refresh and try again.']);
                }
            }
        }
        $update = $db->prepare('UPDATE orders SET status = ?, carrier = ?, tracking_number = ? WHERE id = ?');
        $update->execute([$status, $nextCarrier, $nextTrackingNumber, $id]);
        if ($current['status'] !== $status) {
            data_audit($db, 'order.status_changed', 'order', $id, ['from' => $current['status'], 'to' => $status]);
        }
        if ($current['carrier'] !== $nextCarrier || $current['tracking_number'] !== $nextTrackingNumber) {
            data_audit($db, 'order.tracking_updated', 'order', $id);
        }
        $db->commit();
    } catch (Throwable $error) {
        if ($db->inTransaction()) $db->rollBack();
        error_log('Ambients order update failed: ' . $error->getMessage());
        data_respond(500, ['error' => 'order_update_failed', 'message' => 'The order update could not be saved.']);
    }
    data_respond(200, ['updated' => true]);
}

header('Allow: GET, POST, PATCH, DELETE');
data_respond(405, ['error' => 'method_not_allowed', 'message' => 'The requested method is not allowed.']);
