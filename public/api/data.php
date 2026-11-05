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

function data_stripe_request(string $method, string $path, array $parameters = [], ?string $idempotencyKey = null): array
{
    $config = data_config();
    $secretKey = $config['stripe_secret_key'] ?? null;
    if (!is_string($secretKey) || !preg_match('/^sk_(test|live)_[A-Za-z0-9]+$/', $secretKey)) {
        throw new RuntimeException('Stripe is not configured.');
    }
    if (!function_exists('curl_init')) {
        throw new RuntimeException('The server HTTP client is unavailable.');
    }

    $headers = ['Authorization: Bearer ' . $secretKey];
    if ($idempotencyKey !== null) {
        $headers[] = 'Idempotency-Key: ' . $idempotencyKey;
    }
    $handle = curl_init('https://api.stripe.com' . $path);
    curl_setopt_array($handle, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 25,
        CURLOPT_HTTPHEADER => $headers,
    ]);
    if ($method !== 'GET') {
        curl_setopt($handle, CURLOPT_POSTFIELDS, http_build_query($parameters));
    }

    $response = curl_exec($handle);
    $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    $curlError = curl_error($handle);
    curl_close($handle);
    if (!is_string($response)) {
        error_log('Ambients Stripe request failed: ' . $curlError);
        throw new RuntimeException('Stripe could not be reached.');
    }

    $decoded = json_decode($response, true);
    if (!is_array($decoded) || $status < 200 || $status >= 300) {
        $stripeCode = is_array($decoded) && is_array($decoded['error'] ?? null)
            ? (string) ($decoded['error']['code'] ?? 'unknown')
            : 'invalid_response';
        error_log('Ambients Stripe request returned HTTP ' . $status . ' (' . $stripeCode . ').');
        throw new RuntimeException('Stripe could not complete the payment request.');
    }
    return $decoded;
}

function data_stripe_webhook_secret(): string
{
    $config = data_config();
    $secret = $config['stripe_webhook_secret'] ?? null;
    if (!is_string($secret) || !preg_match('/^whsec_[A-Za-z0-9]+$/', $secret)) {
        throw new RuntimeException('The Stripe webhook is not configured.');
    }
    return $secret;
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
            email VARCHAR(254) NULL,
            phone VARCHAR(40) NOT NULL DEFAULT '',
            import_key CHAR(64) NULL,
            country VARCHAR(100) NOT NULL DEFAULT '',
            address VARCHAR(500) NOT NULL DEFAULT '',
            postal_code VARCHAR(24) NOT NULL DEFAULT '',
            lead_source VARCHAR(24) NOT NULL,
            status VARCHAR(24) NOT NULL DEFAULT 'Cold',
            marketing_consent TINYINT(1) NOT NULL DEFAULT 0,
            marketing_consent_at DATETIME NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY leads_email (email)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    $databaseName = (string) $db->query('SELECT DATABASE()')->fetchColumn();
    $leadEmailColumn = $db->prepare(
        'SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?'
    );
    $leadEmailColumn->execute([$databaseName, 'leads', 'email']);
    if ($leadEmailColumn->fetchColumn() === 'NO') {
        $db->exec('ALTER TABLE leads MODIFY email VARCHAR(254) NULL');
    }
    $leadImportKeyColumn = $db->prepare(
        'SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?'
    );
    $leadImportKeyColumn->execute([$databaseName, 'leads', 'import_key']);
    if ((int) $leadImportKeyColumn->fetchColumn() === 0) {
        $db->exec('ALTER TABLE leads ADD COLUMN import_key CHAR(64) NULL AFTER phone');
    }
    $leadImportKeyIndex = $db->prepare(
        'SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?'
    );
    $leadImportKeyIndex->execute([$databaseName, 'leads', 'leads_import_key']);
    if ((int) $leadImportKeyIndex->fetchColumn() === 0) {
        $db->exec('ALTER TABLE leads ADD UNIQUE INDEX leads_import_key (import_key)');
    }
    $leadAddressColumn = $db->prepare(
        'SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?'
    );
    $leadAddressColumn->execute([$databaseName, 'leads', 'address']);
    if ((int) $leadAddressColumn->fetchColumn() === 0) {
        $db->exec("ALTER TABLE leads ADD COLUMN address VARCHAR(500) NOT NULL DEFAULT '' AFTER country");
    }
    $leadPostalCodeColumn = $db->prepare(
        'SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?'
    );
    $leadPostalCodeColumn->execute([$databaseName, 'leads', 'postal_code']);
    if ((int) $leadPostalCodeColumn->fetchColumn() === 0) {
        $db->exec("ALTER TABLE leads ADD COLUMN postal_code VARCHAR(24) NOT NULL DEFAULT '' AFTER address");
    }
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
        "CREATE TABLE IF NOT EXISTS lead_assignment_notifications (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            staff_id BIGINT UNSIGNED NOT NULL,
            lead_id BIGINT UNSIGNED NOT NULL,
            assigned_by_name VARCHAR(120) NOT NULL,
            assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            read_at DATETIME NULL,
            KEY lead_assignment_notifications_staff (staff_id, read_at, id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    $db->exec(
        "CREATE TABLE IF NOT EXISTS lead_order_history (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            lead_id BIGINT UNSIGNED NOT NULL,
            source_key CHAR(64) NOT NULL,
            source_sheet VARCHAR(64) NULL,
            order_number VARCHAR(100) NULL,
            placed_at DATETIME NULL,
            items TEXT NULL,
            tracking_number VARCHAR(180) NULL,
            carrier VARCHAR(120) NULL,
            delivery_address VARCHAR(500) NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY lead_order_history_source_key (source_key),
            KEY lead_order_history_contact (lead_id, placed_at, id),
            CONSTRAINT lead_order_history_lead_fk FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    $db->exec(
        "CREATE TABLE IF NOT EXISTS lead_source_records (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            lead_id BIGINT UNSIGNED NOT NULL,
            source_key CHAR(64) NOT NULL,
            source_file VARCHAR(255) NOT NULL,
            source_sheet VARCHAR(128) NOT NULL,
            source_row INT UNSIGNED NOT NULL,
            data JSON NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY lead_source_records_identity (lead_id, source_key),
            KEY lead_source_records_contact (lead_id, id),
            CONSTRAINT lead_source_records_lead_fk FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
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
            cc MEDIUMTEXT NULL,
            bcc MEDIUMTEXT NULL,
            thread_headers MEDIUMTEXT NULL,
            attachments MEDIUMTEXT NULL,
            sender_staff_id BIGINT UNSIGNED NULL,
            message_id VARCHAR(998) NULL,
            thread_root_message_id VARCHAR(998) NULL,
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
            cc MEDIUMTEXT NULL,
            bcc MEDIUMTEXT NULL,
            thread_headers MEDIUMTEXT NULL,
            attachments MEDIUMTEXT NULL,
            recipient_lead_id BIGINT UNSIGNED NULL,
            reply_uid VARCHAR(32) NULL,
            reply_folder VARCHAR(16) NULL,
            email_design VARCHAR(16) NOT NULL DEFAULT 'plain',
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
            audience_filter MEDIUMTEXT NULL,
            track_opens TINYINT(1) NOT NULL DEFAULT 0,
            created_by_staff_id BIGINT UNSIGNED NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            completed_at DATETIME NULL,
            KEY email_campaigns_staff_owner (created_by_staff_id, id),
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
            open_token_hash CHAR(64) NULL,
            open_token MEDIUMTEXT NULL,
            opened_at DATETIME NULL,
            claimed_at DATETIME NULL,
            sent_at DATETIME NULL,
            KEY email_campaign_recipients_queue (campaign_id, status, id),
            KEY email_campaign_recipients_lead (lead_id, status),
            KEY email_campaign_recipients_email (recipient_email, status),
            KEY email_campaign_recipient_open_token (open_token_hash),
            UNIQUE KEY email_campaign_recipient_token (unsubscribe_token_hash),
            CONSTRAINT email_campaign_recipients_campaign_fk FOREIGN KEY (campaign_id) REFERENCES email_campaigns(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    $db->exec(
        "CREATE TABLE IF NOT EXISTS chat_conversations (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            visitor_name VARCHAR(100) NOT NULL,
            visitor_email VARCHAR(254) NOT NULL DEFAULT '',
            visitor_token_hash CHAR(64) NOT NULL,
            visitor_id_hash CHAR(64) NULL,
            owner_type VARCHAR(16) NOT NULL DEFAULT 'queue',
            owner_staff_id BIGINT UNSIGNED NULL,
            status VARCHAR(16) NOT NULL DEFAULT 'open',
            last_visitor_message_at DATETIME NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY chat_conversations_token (visitor_token_hash),
            KEY chat_conversations_owner (owner_type, owner_staff_id, status, updated_at),
            KEY chat_conversations_visitor (visitor_id_hash, updated_at),
            KEY chat_conversations_status_updated (status, updated_at, id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    $db->exec(
        "CREATE TABLE IF NOT EXISTS chat_messages (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            conversation_id BIGINT UNSIGNED NOT NULL,
            sender_type VARCHAR(16) NOT NULL,
            sender_name VARCHAR(100) NOT NULL,
            body TEXT NOT NULL,
            read_at DATETIME NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            KEY chat_messages_conversation (conversation_id, id),
            KEY chat_messages_unread (conversation_id, sender_type, read_at),
            CONSTRAINT chat_messages_conversation_fk FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    $db->exec(
        "CREATE TABLE IF NOT EXISTS chat_rate_limits (
            bucket_hash CHAR(64) NOT NULL PRIMARY KEY,
            window_started_at DATETIME NOT NULL,
            request_count INT UNSIGNED NOT NULL DEFAULT 0
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    $db->exec(
        "CREATE TABLE IF NOT EXISTS visitor_sessions (
            session_token_hash CHAR(64) NOT NULL PRIMARY KEY,
            visitor_token_hash CHAR(64) NOT NULL,
            current_path VARCHAR(500) NOT NULL,
            referrer_domain VARCHAR(253) NOT NULL DEFAULT '',
            country_code CHAR(2) NULL,
            language VARCHAR(35) NOT NULL DEFAULT '',
            first_seen DATETIME NOT NULL,
            last_seen DATETIME NOT NULL,
            KEY visitor_sessions_recent (last_seen),
            KEY visitor_sessions_visitor (visitor_token_hash, last_seen),
            KEY visitor_sessions_country (country_code, last_seen)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    $db->exec(
        "CREATE TABLE IF NOT EXISTS visitor_page_views (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            session_token_hash CHAR(64) NOT NULL,
            page_path VARCHAR(500) NOT NULL,
            page_title VARCHAR(180) NOT NULL DEFAULT '',
            product_id VARCHAR(64) NULL,
            dwell_seconds INT UNSIGNED NOT NULL DEFAULT 0,
            viewed_at DATETIME NOT NULL,
            KEY visitor_page_views_session (session_token_hash, id),
            KEY visitor_page_views_date (viewed_at),
            CONSTRAINT visitor_page_views_session_fk FOREIGN KEY (session_token_hash) REFERENCES visitor_sessions(session_token_hash) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    $db->exec(
        "CREATE TABLE IF NOT EXISTS staff_presence (
            staff_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
            session_started_at DATETIME NOT NULL,
            last_seen_at DATETIME NOT NULL,
            current_section VARCHAR(32) NOT NULL DEFAULT 'overview',
            KEY staff_presence_last_seen (last_seen_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    $db->exec(
        "CREATE TABLE IF NOT EXISTS crm_routing_settings (
            setting_key VARCHAR(64) NOT NULL PRIMARY KEY,
            setting_value VARCHAR(16) NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    $db->exec(
        "INSERT IGNORE INTO crm_routing_settings (setting_key, setting_value)
         VALUES ('agents_may_claim_chat_when_admin_online', '0')"
    );
    $databaseName = (string) $db->query('SELECT DATABASE()')->fetchColumn();
    foreach ([
        ['email_activity', 'body', 'MEDIUMTEXT NULL'],
        ['email_activity', 'cc', 'MEDIUMTEXT NULL'],
        ['email_activity', 'bcc', 'MEDIUMTEXT NULL'],
        ['email_activity', 'thread_headers', 'MEDIUMTEXT NULL'],
        ['email_activity', 'attachments', 'MEDIUMTEXT NULL'],
        ['email_activity', 'sender_staff_id', 'BIGINT UNSIGNED NULL'],
        ['email_activity', 'message_id', 'VARCHAR(998) NULL'],
        ['email_activity', 'thread_root_message_id', 'VARCHAR(998) NULL'],
        ['email_drafts', 'cc', 'MEDIUMTEXT NULL'],
        ['email_drafts', 'bcc', 'MEDIUMTEXT NULL'],
        ['email_drafts', 'thread_headers', 'MEDIUMTEXT NULL'],
        ['email_drafts', 'attachments', 'MEDIUMTEXT NULL'],
        ['email_drafts', 'recipient_lead_id', 'BIGINT UNSIGNED NULL'],
        ['email_drafts', 'reply_uid', 'VARCHAR(32) NULL'],
        ['email_drafts', 'reply_folder', 'VARCHAR(16) NULL'],
        ['email_drafts', 'email_design', "VARCHAR(16) NOT NULL DEFAULT 'plain'"],
        ['email_campaigns', 'audience_filter', 'MEDIUMTEXT NULL'],
        ['email_campaigns', 'track_opens', 'TINYINT(1) NOT NULL DEFAULT 0'],
        ['email_campaigns', 'created_by_staff_id', 'BIGINT UNSIGNED NULL'],
        ['email_campaign_recipients', 'open_token_hash', 'CHAR(64) NULL'],
        ['email_campaign_recipients', 'open_token', 'MEDIUMTEXT NULL'],
        ['email_campaign_recipients', 'opened_at', 'DATETIME NULL'],
        ['chat_conversations', 'visitor_phone', "VARCHAR(40) NOT NULL DEFAULT ''"],
        ['chat_conversations', 'visitor_id_hash', 'CHAR(64) NULL'],
        ['chat_conversations', 'owner_type', "VARCHAR(16) NOT NULL DEFAULT 'queue'"],
        ['chat_conversations', 'owner_staff_id', 'BIGINT UNSIGNED NULL'],
        ['visitor_page_views', 'page_title', "VARCHAR(180) NOT NULL DEFAULT ''"],
        ['visitor_page_views', 'product_id', 'VARCHAR(64) NULL'],
        ['visitor_page_views', 'dwell_seconds', 'INT UNSIGNED NOT NULL DEFAULT 0'],
    ] as [$table, $column, $definition]) {
        $columnExists = $db->prepare('SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?');
        $columnExists->execute([$databaseName, $table, $column]);
        if ((int) $columnExists->fetchColumn() === 0) {
            $db->exec("ALTER TABLE {$table} ADD COLUMN {$column} {$definition}");
        }
    }
    foreach ([
        ['chat_conversations', 'chat_conversations_owner', 'owner_type, owner_staff_id, status, updated_at'],
        ['chat_conversations', 'chat_conversations_visitor', 'visitor_id_hash, updated_at'],
        ['email_campaigns', 'email_campaigns_staff_owner', 'created_by_staff_id, id'],
        ['email_activity', 'email_activity_sender_staff', 'sender_staff_id, id'],
        ['email_activity', 'email_activity_thread_root', 'thread_root_message_id(190), id'],
    ] as [$table, $index, $columns]) {
        $indexExists = $db->prepare('SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?');
        $indexExists->execute([$databaseName, $table, $index]);
        if ((int) $indexExists->fetchColumn() === 0) {
            $db->exec("ALTER TABLE {$table} ADD INDEX {$index} ({$columns})");
        }
    }
    $openTokenIndex = $db->prepare('SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?');
    $openTokenIndex->execute([$databaseName, 'email_campaign_recipients', 'email_campaign_recipient_open_token']);
    if ((int) $openTokenIndex->fetchColumn() === 0) {
        $db->exec('ALTER TABLE email_campaign_recipients ADD INDEX email_campaign_recipient_open_token (open_token_hash)');
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
            payment_link_url VARCHAR(2048) NULL,
            payment_link_type VARCHAR(32) NULL,
            payment_link_name VARCHAR(80) NULL,
            payment_crypto_asset VARCHAR(8) NULL,
            payment_crypto_network VARCHAR(32) NULL,
            payment_link_sent_at DATETIME NULL,
            stripe_checkout_session_id VARCHAR(255) NULL,
            stripe_payment_intent_id VARCHAR(255) NULL,
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
    foreach ([
        ['payment_link_url', 'VARCHAR(2048) NULL'],
        ['payment_link_type', 'VARCHAR(32) NULL'],
        ['payment_link_name', 'VARCHAR(80) NULL'],
        ['payment_crypto_asset', 'VARCHAR(8) NULL'],
        ['payment_crypto_network', 'VARCHAR(32) NULL'],
        ['payment_link_sent_at', 'DATETIME NULL'],
    ] as [$column, $definition]) {
        $columnExists = $db->prepare('SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?');
        $columnExists->execute([$databaseName, 'orders', $column]);
        if ((int) $columnExists->fetchColumn() === 0) {
            $db->exec("ALTER TABLE orders ADD COLUMN {$column} {$definition}");
        }
    }
    $db->exec(
        "CREATE TABLE IF NOT EXISTS stripe_webhook_events (
            event_id VARCHAR(255) NOT NULL PRIMARY KEY,
            processed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
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
            permissions TEXT NOT NULL DEFAULT '[\"leads\"]',
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            must_change_password TINYINT(1) NOT NULL DEFAULT 0,
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
        $db->exec('ALTER TABLE staff_users ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0 AFTER is_active');
    }
    $staffPasswordChangeColumn->execute([$databaseName, 'staff_users', 'display_name']);
    if ((int) $staffPasswordChangeColumn->fetchColumn() === 0) {
        $db->exec("ALTER TABLE staff_users ADD COLUMN display_name VARCHAR(120) NOT NULL DEFAULT '' AFTER email");
    }
    foreach ([
        'permissions' => "TEXT NOT NULL DEFAULT '[\"leads\"]'",
        'session_version' => 'INT UNSIGNED NOT NULL DEFAULT 1',
    ] as $column => $definition) {
        $staffPasswordChangeColumn->execute([$databaseName, 'staff_users', $column]);
        if ((int) $staffPasswordChangeColumn->fetchColumn() === 0) {
            $db->exec("ALTER TABLE staff_users ADD COLUMN `$column` $definition");
        }
    }
    $staffPermissionDefault = $db->prepare('SELECT COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?');
    $staffPermissionDefault->execute([$databaseName, 'staff_users', 'permissions']);
    if ($staffPermissionDefault->fetchColumn() !== '["leads"]') {
        $db->exec("ALTER TABLE staff_users ALTER COLUMN permissions SET DEFAULT '[\"leads\"]'");
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
    $ordersColumn = $db->prepare('SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?');
    foreach ([
        'stripe_checkout_session_id' => 'VARCHAR(255) NULL',
        'stripe_payment_intent_id' => 'VARCHAR(255) NULL',
    ] as $column => $definition) {
        $ordersColumn->execute([$databaseName, 'orders', $column]);
        if ((int) $ordersColumn->fetchColumn() === 0) {
            $db->exec("ALTER TABLE orders ADD COLUMN `$column` $definition");
        }
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
        $check = data_db()->prepare('SELECT id, is_active, permissions, session_version FROM staff_users WHERE email = ? AND role = ?');
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
        $_SESSION['must_change_password'] = false;
        $_SESSION['staff_id'] = (int) $staff['id'];
        $_SESSION['staff_session_version'] = (int) $staff['session_version'];
        $_SESSION['admin_permissions'] = data_staff_permissions(json_decode((string) $staff['permissions'], true)) ?? [];
    }
    if ($requiredRole === 'admin' && $_SESSION['admin_role'] !== 'admin') {
        data_respond(403, ['error' => 'admin_required', 'message' => 'Administrator access is required for this action.']);
    }
    $_SESSION['last_activity'] = time();
}

function data_require_permission(string $permission): void
{
    if (session_status() !== PHP_SESSION_ACTIVE) data_require_admin();
    $hasPermission = in_array($permission, $_SESSION['admin_permissions'] ?? [], true);
    if (!$hasPermission && in_array('create_leads', $_SESSION['admin_permissions'] ?? [], true)
        && in_array($permission, ['add_leads', 'import_leads', 'export_leads'], true)) {
        $hasPermission = true;
    }
    if (($_SESSION['admin_role'] ?? '') !== 'admin' && !$hasPermission) {
        data_respond(403, ['error' => 'permission_required', 'message' => 'Your account does not have access to this section.']);
    }
}

function data_require_lead_access(PDO $db, int $leadId, bool $allowUnassignedNew = false): void
{
    if (($_SESSION['admin_role'] ?? '') === 'admin') return;
    $owner = $db->prepare('SELECT assigned_staff_id, status FROM leads WHERE id = ?');
    $owner->execute([$leadId]);
    $lead = $owner->fetch();
    if (!is_array($lead)) {
        data_respond(404, ['error' => 'lead_not_found', 'message' => 'The contact lead was not found.']);
    }
    $isAssigned = $lead['assigned_staff_id'] !== null && (int) $lead['assigned_staff_id'] === (int) ($_SESSION['staff_id'] ?? 0);
    $canViewNew = $allowUnassignedNew
        && $lead['assigned_staff_id'] === null
        && $lead['status'] === 'New'
        && in_array('new_leads', $_SESSION['admin_permissions'] ?? [], true);
    if (!$isAssigned && !$canViewNew) {
        data_respond(404, ['error' => 'lead_not_found', 'message' => 'The contact lead was not found.']);
    }
}

function data_staff_permissions($permissions): ?array
{
    $validPermissions = ['leads', 'new_leads', 'create_leads', 'add_leads', 'import_leads', 'export_leads', 'orders', 'print_orders', 'products', 'integrations', 'email_campaigns', 'chat'];
    if (!is_array($permissions)) return null;
    foreach ($permissions as $permission) {
        if (!is_string($permission) || !in_array($permission, $validPermissions, true)) return null;
    }
    $permissions = array_values(array_unique($permissions));
    if ((in_array('new_leads', $permissions, true) || in_array('create_leads', $permissions, true)
        || in_array('add_leads', $permissions, true) || in_array('import_leads', $permissions, true)
        || in_array('export_leads', $permissions, true)) && !in_array('leads', $permissions, true)) return null;
    if (in_array('print_orders', $permissions, true) && !in_array('orders', $permissions, true)) return null;
    if (in_array('email_campaigns', $permissions, true) && !in_array('integrations', $permissions, true)) return null;
    if (in_array('create_leads', $permissions, true)) {
        $permissions = array_values(array_diff($permissions, ['create_leads']));
        $permissions = array_merge($permissions, ['add_leads', 'import_leads', 'export_leads']);
    }
    return $permissions;
}

function data_staff_can_handle_leads(array $staff): bool
{
    $permissions = data_staff_permissions(json_decode((string) ($staff['permissions'] ?? ''), true));
    return ($staff['role'] ?? '') === 'operator'
        && (bool) ($staff['is_active'] ?? false)
        && $permissions !== null
        && in_array('leads', $permissions, true);
}

function data_chat_admin_online(PDO $db): bool
{
    $query = $db->query('SELECT last_seen_at FROM staff_presence WHERE staff_id = 0 LIMIT 1');
    $lastSeen = $query->fetchColumn();
    return is_string($lastSeen) && strtotime($lastSeen . ' UTC') >= time() - 120;
}

function data_chat_agents_can_claim(PDO $db): bool
{
    $setting = $db->query(
        "SELECT setting_value FROM crm_routing_settings
         WHERE setting_key = 'agents_may_claim_chat_when_admin_online' LIMIT 1"
    )->fetchColumn();
    return !data_chat_admin_online($db) || $setting === '1';
}

function data_visitor_session_duration(string $firstSeen, string $lastSeen): int
{
    $start = strtotime($firstSeen . ' UTC');
    $end = strtotime($lastSeen . ' UTC');
    if ($start === false || $end === false) return 0;
    if ($end >= time() - 90) $end = time();
    return max(0, $end - $start);
}

function data_chat_conversation_accessible(PDO $db, array $conversation): bool
{
    if (($_SESSION['admin_role'] ?? '') === 'admin') return true;
    $staffId = (int) ($_SESSION['staff_id'] ?? 0);
    if ($conversation['owner_type'] === 'agent' && (int) $conversation['owner_staff_id'] === $staffId) return true;
    return in_array($conversation['owner_type'], ['queue', 'admin'], true)
        && $conversation['status'] === 'open'
        && data_chat_agents_can_claim($db);
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

function data_lead_import_identity_suffix(string $phone, string $address, string $postalCode): string
{
    $phoneDigits = preg_replace('/\D/', '', $phone) ?? '';
    if (strlen($phoneDigits) >= 7) return $phoneDigits;

    $address = strtolower(trim($address));
    if ($address !== '') return 'address:' . $address;

    $postalCode = trim($postalCode);
    if (preg_match('/^\d{5}(?:-\d{4})?$/', $postalCode) === 1) {
        return preg_replace('/\D/', '', $postalCode) ?? '';
    }
    return 'address:' . strtolower($postalCode);
}

function data_chat_rate_limit(PDO $db, string $scope, int $limit, int $windowSeconds, ?string $identity = null): void
{
    $clientAddress = $identity ?? (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
    $config = data_config();
    $bucketHash = hash_hmac(
        'sha256',
        gmdate('Y-m-d') . '|' . $scope . '|' . $clientAddress,
        (string) $config['db_password']
    );

    $db->beginTransaction();
    try {
        $db->prepare(
            'INSERT IGNORE INTO chat_rate_limits (bucket_hash, window_started_at, request_count) VALUES (?, UTC_TIMESTAMP(), 0)'
        )->execute([$bucketHash]);
        $find = $db->prepare('SELECT window_started_at, request_count FROM chat_rate_limits WHERE bucket_hash = ? FOR UPDATE');
        $find->execute([$bucketHash]);
        $bucket = $find->fetch();
        if (!is_array($bucket)) {
            throw new RuntimeException('The chat rate-limit bucket could not be loaded.');
        }

        $expired = strtotime((string) $bucket['window_started_at'] . ' UTC') < time() - $windowSeconds;
        if ($expired) {
            $update = $db->prepare('UPDATE chat_rate_limits SET window_started_at = UTC_TIMESTAMP(), request_count = 1 WHERE bucket_hash = ?');
            $update->execute([$bucketHash]);
            $count = 1;
        } else {
            $count = (int) $bucket['request_count'] + 1;
            $update = $db->prepare('UPDATE chat_rate_limits SET request_count = ? WHERE bucket_hash = ?');
            $update->execute([$count, $bucketHash]);
        }
        if ($scope === 'start' || $scope === 'visitor-session-new') {
            $db->exec('DELETE FROM chat_rate_limits WHERE window_started_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 2 DAY)');
        }
        $db->commit();
    } catch (Throwable $error) {
        if ($db->inTransaction()) $db->rollBack();
        error_log('Ambients live-chat rate limiting failed: ' . $error->getMessage());
        data_respond(503, ['error' => 'chat_rate_limit_unavailable', 'message' => 'Chat is temporarily unavailable. Please try again shortly.']);
    }

    if ($count > $limit) {
        data_respond(429, ['error' => 'chat_rate_limited', 'message' => 'You have sent several chat requests. Please wait a little and try again.']);
    }
}

function data_chat_message_rows(PDO $db, int $conversationId): array
{
    $query = $db->prepare(
        'SELECT id, sender_type, sender_name, body, created_at FROM chat_messages WHERE conversation_id = ? ORDER BY id ASC LIMIT 500'
    );
    $query->execute([$conversationId]);
    return array_map(static fn (array $row): array => [
        'id' => (int) $row['id'],
        'sender' => $row['sender_type'],
        'senderName' => $row['sender_name'],
        'body' => $row['body'],
        'createdAt' => $row['created_at'],
    ], $query->fetchAll());
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

function data_mail_address_list(mixed $value, string $field): array
{
    if ($value === null || $value === '') return [];
    if (!is_string($value)) throw new RuntimeException('invalid_' . $field);
    $addresses = preg_split('/[,;]+/', $value) ?: [];
    $addresses = array_values(array_unique(array_filter(array_map(
        static fn (string $address): string => strtolower(trim($address)),
        $addresses
    ), static fn (string $address): bool => $address !== '')));
    if (count($addresses) > 10) throw new RuntimeException('too_many_' . $field);
    foreach ($addresses as $address) {
        if (!filter_var($address, FILTER_VALIDATE_EMAIL)) throw new RuntimeException('invalid_' . $field);
    }
    return $addresses;
}

function data_mail_attachments(mixed $value): array
{
    if ($value === null || $value === []) return [];
    if (!is_array($value) || count($value) > 5) throw new RuntimeException('invalid_attachments');
    $attachments = [];
    $totalBytes = 0;
    foreach ($value as $item) {
        if (!is_array($item) || !is_string($item['name'] ?? null) || !is_string($item['contentType'] ?? null) || !is_string($item['content'] ?? null)) {
            throw new RuntimeException('invalid_attachments');
        }
        $name = preg_replace('/[^A-Za-z0-9._ -]/', '_', basename($item['name']));
        $contentType = preg_match('/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/', $item['contentType']) === 1
            ? $item['contentType'] : 'application/octet-stream';
        $decoded = base64_decode($item['content'], true);
        if (!is_string($name) || $name === '' || strlen($name) > 160 || !is_string($decoded)) {
            throw new RuntimeException('invalid_attachments');
        }
        $totalBytes += strlen($decoded);
        if ($totalBytes > 4 * 1024 * 1024) throw new RuntimeException('attachments_too_large');
        $attachments[] = ['name' => $name, 'contentType' => $contentType, 'content' => base64_encode($decoded)];
    }
    return $attachments;
}

function data_mail_thread_headers(mixed $value): array
{
    if ($value === null || $value === []) return [];
    if (!is_array($value)) throw new RuntimeException('invalid_thread_header');
    $headers = [];
    foreach (['In-Reply-To', 'References'] as $name) {
        $header = $value[$name] ?? '';
        if ($header === '') continue;
        if (!is_string($header) || strlen($header) > 2000 || preg_match('/[\r\n\x00]/', $header) === 1) {
            throw new RuntimeException('invalid_thread_header');
        }
        $headers[$name] = trim($header);
    }
    return $headers;
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

function data_mail_send(
    array $settings,
    string $recipient,
    string $subject,
    string $body,
    ?string $unsubscribeUrl = null,
    array $ccRecipients = [],
    array $bccRecipients = [],
    array $threadHeaders = [],
    array $attachments = [],
    ?string $htmlBody = null,
    array $inlineAttachments = []
): string
{
    $recipients = array_values(array_unique(array_merge([$recipient], $ccRecipients, $bccRecipients)));
    $socket = data_smtp_connect($settings);
    try {
        data_smtp_command($socket, 'MAIL FROM:<' . $settings['emailAccount'] . '>', ['250']);
        foreach ($recipients as $envelopeRecipient) {
            data_smtp_command($socket, 'RCPT TO:<' . $envelopeRecipient . '>', ['250', '251']);
        }
        data_smtp_command($socket, 'DATA', ['354']);
        $encodedSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
        $encodedName = '=?UTF-8?B?' . base64_encode($settings['displayName']) . '?=';
        $messageId = '<' . bin2hex(random_bytes(16)) . '@ambienta.io>';
        $headers = [
            'From: ' . $encodedName . ' <' . $settings['emailAccount'] . '>',
            'To: ' . implode(', ', array_map(static fn (string $address): string => '<' . $address . '>', [$recipient])),
            'Subject: ' . $encodedSubject,
            'Date: ' . date(DATE_RFC2822),
            'Message-ID: ' . $messageId,
            'MIME-Version: 1.0',
        ];
        if ($ccRecipients !== []) {
            $headers[] = 'Cc: ' . implode(",\r\n ", array_map(static fn (string $address): string => '<' . $address . '>', $ccRecipients));
        }
        foreach (['In-Reply-To', 'References'] as $headerName) {
            $headerValue = $threadHeaders[$headerName] ?? '';
            if (is_string($headerValue) && $headerValue !== '') {
                if (preg_match('/[\r\n\x00]/', $headerValue) === 1) {
                    throw new RuntimeException('invalid_thread_header');
                }
                $headers[] = $headerName . ': ' . (preg_replace('/\s+/', "\r\n ", trim($headerValue)) ?? $headerValue);
            }
        }
        if ($unsubscribeUrl !== null) {
            $headers[] = 'List-Unsubscribe: <' . $unsubscribeUrl . '>';
            $headers[] = 'List-Unsubscribe-Post: List-Unsubscribe=One-Click';
            $body .= "\n\n---\nTo stop receiving marketing emails, unsubscribe here:\n" . $unsubscribeUrl;
            if ($htmlBody !== null) {
                $htmlBody .= '<p>To stop receiving marketing emails, <a href="' . htmlspecialchars($unsubscribeUrl, ENT_QUOTES, 'UTF-8') . '">unsubscribe here</a>.</p>';
            }
        }
        $bodyPart = '';
        $bodyContentType = 'text/plain; charset=UTF-8';
        if ($htmlBody !== null) {
            $alternativeBoundary = 'ambienta_alt_' . bin2hex(random_bytes(16));
            $bodyContentType = 'multipart/alternative; boundary="' . $alternativeBoundary . '"';
            $bodyPart = '--' . $alternativeBoundary . "\r\n"
                . "Content-Type: text/plain; charset=UTF-8\r\n"
                . "Content-Transfer-Encoding: base64\r\n\r\n"
                . chunk_split(base64_encode($body), 76, "\r\n")
                . '--' . $alternativeBoundary . "\r\n"
                . "Content-Type: text/html; charset=UTF-8\r\n"
                . "Content-Transfer-Encoding: base64\r\n\r\n"
                . chunk_split(base64_encode($htmlBody), 76, "\r\n")
                . '--' . $alternativeBoundary . "--\r\n";
        } else {
            $bodyPart = "Content-Transfer-Encoding: base64\r\n\r\n"
                . chunk_split(base64_encode($body), 76, "\r\n");
        }
        if ($inlineAttachments !== []) {
            if ($htmlBody === null) {
                throw new RuntimeException('inline_attachment_requires_html_body');
            }
            $relatedBoundary = 'ambienta_related_' . bin2hex(random_bytes(16));
            $relatedParts = [
                '--' . $relatedBoundary . "\r\n"
                    . 'Content-Type: ' . $bodyContentType . "\r\n\r\n"
                    . $bodyPart,
            ];
            foreach ($inlineAttachments as $attachment) {
                $relatedParts[] = '--' . $relatedBoundary . "\r\n"
                    . 'Content-Type: ' . $attachment['contentType'] . '; name="' . addcslashes($attachment['name'], "\\\"") . "\"\r\n"
                    . "Content-Transfer-Encoding: base64\r\n"
                    . 'Content-ID: <' . $attachment['contentId'] . ">\r\n"
                    . 'Content-Disposition: inline; filename="' . addcslashes($attachment['name'], "\\\"") . "\"\r\n\r\n"
                    . chunk_split(base64_encode($attachment['content']), 76, "\r\n");
            }
            $relatedParts[] = '--' . $relatedBoundary . "--\r\n";
            $bodyPart = implode('', $relatedParts);
            $bodyContentType = 'multipart/related; boundary="' . $relatedBoundary . '"';
        }
        if ($attachments === []) {
            $headers[] = 'Content-Type: ' . $bodyContentType;
            if ($bodyContentType === 'text/plain; charset=UTF-8') {
                $headers[] = 'Content-Transfer-Encoding: base64';
            }
            $content = $bodyPart;
        } else {
            $boundary = 'ambienta_' . bin2hex(random_bytes(16));
            $headers[] = 'Content-Type: multipart/mixed; boundary="' . $boundary . '"';
            $parts = [
                '--' . $boundary . "\r\n"
                    . 'Content-Type: ' . $bodyContentType . "\r\n\r\n"
                    . $bodyPart,
            ];
            foreach ($attachments as $attachment) {
                $parts[] = '--' . $boundary . "\r\n"
                    . 'Content-Type: ' . $attachment['contentType'] . '; name="' . addcslashes($attachment['name'], "\\\"") . "\"\r\n"
                    . "Content-Transfer-Encoding: base64\r\n"
                    . 'Content-Disposition: attachment; filename="' . addcslashes($attachment['name'], "\\\"") . "\"\r\n\r\n"
                    . chunk_split($attachment['content'], 76, "\r\n");
            }
            $parts[] = '--' . $boundary . "--\r\n";
            $content = implode('', $parts);
        }
        $message = implode("\r\n", $headers) . "\r\n\r\n" . $content . ".\r\n";
        data_smtp_write_all($socket, $message);
        data_smtp_read_response($socket, ['250']);
        try {
            data_smtp_command($socket, 'QUIT', ['221']);
        } catch (Throwable $error) {
            error_log('Ambients SMTP session could not be closed cleanly after server acceptance.');
        }
        return $messageId;
    } finally {
        if (is_resource($socket)) fclose($socket);
    }
}

function data_campaign_filters(mixed $value): array
{
    if ($value === null || $value === []) return ['country' => '', 'status' => '', 'source' => ''];
    if (!is_array($value)) throw new RuntimeException('invalid_campaign_audience');
    $filters = [];
    foreach (['country', 'status', 'source'] as $key) {
        $filter = $value[$key] ?? '';
        if (!is_string($filter) || strlen($filter) > 100 || preg_match('/[\r\n\x00]/', $filter) === 1) {
            throw new RuntimeException('invalid_campaign_audience');
        }
        $filters[$key] = trim($filter);
    }
    return $filters;
}

function data_campaign_recipient_snapshot(PDO $db, array $filters = [], ?int $assignedStaffId = null): array
{
    $where = ['marketing_consent = 1', "TRIM(email) <> ''"];
    $parameters = [];
    if ($assignedStaffId !== null) {
        $where[] = 'assigned_staff_id = ?';
        $parameters[] = $assignedStaffId;
    }
    foreach (['country' => 'country', 'status' => 'status', 'source' => 'lead_source'] as $key => $column) {
        if (($filters[$key] ?? '') !== '') {
            $where[] = "{$column} = ?";
            $parameters[] = $filters[$key];
        }
    }
    $statement = $db->prepare(
        'SELECT MIN(id) AS lead_id, LOWER(TRIM(email)) AS recipient_email
         FROM leads WHERE ' . implode(' AND ', $where) . '
         GROUP BY LOWER(TRIM(email)) ORDER BY MIN(id) LIMIT 5001'
    );
    $statement->execute($parameters);
    $rows = $statement->fetchAll();
    if (count($rows) > 5000) {
        return array_slice($rows, 0, 5001);
    }
    $recipients = array_values(array_filter($rows, static fn (array $row): bool =>
        filter_var($row['recipient_email'] ?? null, FILTER_VALIDATE_EMAIL) !== false
    ));
    return $recipients;
}

function data_campaign_actor_staff_id(): ?int
{
    if (($_SESSION['admin_role'] ?? '') === 'admin') return null;
    data_require_permission('integrations');
    data_require_permission('email_campaigns');
    $staffId = (int) ($_SESSION['staff_id'] ?? 0);
    if ($staffId < 1) {
        data_respond(403, ['error' => 'campaign_access_denied', 'message' => 'A valid agent account is required to manage email campaigns.']);
    }
    return $staffId;
}

function data_campaign_queue(PDO $db, int $campaignId, string $status, ?string $scheduledAt): int
{
    if (!in_array($status, ['sending', 'scheduled'], true)) {
        throw new RuntimeException('invalid_campaign_status');
    }

    $campaign = $db->prepare('SELECT audience_filter, track_opens, created_by_staff_id FROM email_campaigns WHERE id = ?');
    $campaign->execute([$campaignId]);
    $campaignSettings = $campaign->fetch();
    if (!is_array($campaignSettings)) throw new RuntimeException('campaign_not_found');
    $filters = data_campaign_filters(json_decode(data_mail_decrypt_content($campaignSettings['audience_filter']), true) ?: []);
    $trackOpens = (int) $campaignSettings['track_opens'] === 1;
    $assignedStaffId = $campaignSettings['created_by_staff_id'] === null ? null : (int) $campaignSettings['created_by_staff_id'];
    $recipients = data_campaign_recipient_snapshot($db, $filters, $assignedStaffId);
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
            'INSERT INTO email_campaign_recipients (campaign_id, lead_id, recipient_email, status, unsubscribe_token_hash, unsubscribe_token, open_token_hash, open_token)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        );
        foreach ($recipients as $recipient) {
            $token = bin2hex(random_bytes(32));
            $openToken = $trackOpens ? bin2hex(random_bytes(32)) : null;
            $insert->execute([
                $campaignId,
                (int) $recipient['lead_id'],
                (string) $recipient['recipient_email'],
                'queued',
                hash('sha256', $token),
                data_mail_encrypt_content($token),
                $openToken === null ? null : hash('sha256', $openToken),
                $openToken === null ? null : data_mail_encrypt_content($openToken),
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

function data_campaign_merge_fields(string $template, array $lead): string
{
    $values = [
        '{{first_name}}' => $lead['first_name'] ?? '',
        '{{last_name}}' => $lead['last_name'] ?? '',
        '{{email}}' => $lead['email'] ?? '',
        '{{country}}' => $lead['country'] ?? '',
    ];
    foreach ($values as $placeholder => $value) {
        $safeValue = is_string($value) ? trim(preg_replace('/[\r\n\x00]/', ' ', $value) ?? '') : '';
        $template = str_replace($placeholder, $safeValue, $template);
    }
    return $template;
}

function data_campaign_plain_text(string $message): string
{
    return preg_replace('/\*\*(.*?)\*\*|\*(.*?)\*/s', '$1$2', $message) ?? $message;
}

function data_campaign_html(string $message): string
{
    $html = htmlspecialchars($message, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    $html = preg_replace('/\*\*(.+?)\*\*/s', '<strong>$1</strong>', $html) ?? $html;
    $html = preg_replace('/\*(.+?)\*/s', '<em>$1</em>', $html) ?? $html;
    return '<!doctype html><html><body>' . nl2br($html) . '</body></html>';
}

function data_mail_card_html(string $subject, string $message): string
{
    $formattedBody = data_campaign_html($message);
    $bodyContent = substr($formattedBody, strlen('<!doctype html><html><body>'), -strlen('</body></html>'));
    $safeSubject = htmlspecialchars($subject, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    return '<!doctype html><html><body style="margin:0;padding:28px 12px;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#172033">'
        . '<div style="width:100%;max-width:720px;box-sizing:border-box;margin:0 auto;overflow:hidden;border:1px solid #cbdcf0;border-radius:16px;background:#ffffff">'
        . '<div style="padding:20px 26px;background:#123b68;color:#ffffff">'
        . '<p style="margin:0;font-size:11px;font-weight:bold;letter-spacing:2px;color:#bfdbfe">AMBIENTA · CUSTOMER SUPPORT</p>'
        . '<h1 style="margin:10px 0 0;font-size:20px;line-height:1.35;color:#ffffff">' . $safeSubject . '</h1>'
        . '</div><div style="padding:24px 26px;font-size:14px;line-height:1.7;color:#334155">' . $bodyContent . '</div>'
        . '<div style="padding:13px 26px;border-top:1px solid #e2e8f0;background:#f8fafc;font-size:11px;color:#64748b">Ambient Customer Support</div>'
        . '</div></body></html>';
}

function data_campaign_process_batch(array $settings, int $limit = 10, ?int $campaignId = null): array
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
            $sql =
                "SELECT r.id, r.campaign_id, r.lead_id, r.recipient_email, r.unsubscribe_token,
                        r.open_token, c.subject, c.body, c.track_opens,
                        c.created_by_staff_id AS campaign_staff_id,
                        l.first_name, l.last_name, l.country,
                        c.status AS campaign_status
                 FROM email_campaign_recipients r
                 INNER JOIN email_campaigns c ON c.id = r.campaign_id
                 LEFT JOIN leads l ON l.id = r.lead_id
                 WHERE r.status = 'queued'
                   AND (c.status = 'sending' OR (c.status = 'scheduled' AND c.scheduled_at <= UTC_TIMESTAMP()))
                   " . ($campaignId === null ? '' : 'AND c.id = ? ') . "
                 ORDER BY COALESCE(c.scheduled_at, c.created_at), r.id
                 LIMIT 1
                 FOR UPDATE";
            $statement = $campaignId === null ? $db->query($sql) : $db->prepare($sql);
            if ($campaignId !== null) $statement->execute([$campaignId]);
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
        $consent = $db->prepare('SELECT marketing_consent, assigned_staff_id FROM leads WHERE id = ? AND LOWER(TRIM(email)) = LOWER(?)');
        $consent->execute([(int) $recipient['lead_id'], (string) $recipient['recipient_email']]);
        $leadEligibility = $consent->fetch();
        if (!is_array($leadEligibility) || (int) $leadEligibility['marketing_consent'] !== 1) {
            $db->prepare("UPDATE email_campaign_recipients SET status = 'unsubscribed' WHERE id = ?")->execute([(int) $recipient['id']]);
            $unsubscribed++;
            continue;
        }
        if ($recipient['campaign_staff_id'] !== null
            && (int) $leadEligibility['assigned_staff_id'] !== (int) $recipient['campaign_staff_id']) {
            $db->prepare("UPDATE email_campaign_recipients SET status = 'failed' WHERE id = ?")->execute([(int) $recipient['id']]);
            $failed++;
            continue;
        }

        $token = data_mail_decrypt_content((string) $recipient['unsubscribe_token']);
        $unsubscribeUrl = 'https://ambienta.io/api/data.php?resource=email-unsubscribe&token=' . rawurlencode($token);
        $leadFields = [
            'first_name' => $recipient['first_name'],
            'last_name' => $recipient['last_name'],
            'email' => $recipient['recipient_email'],
            'country' => $recipient['country'],
        ];
        $subject = data_campaign_merge_fields(data_mail_decrypt_content((string) $recipient['subject']), $leadFields);
        $formattedMessage = data_campaign_merge_fields(data_mail_decrypt_content((string) $recipient['body']), $leadFields);
        $message = data_campaign_plain_text($formattedMessage);
        $openToken = data_mail_decrypt_content($recipient['open_token'] ?? null);
        $openPixel = (int) $recipient['track_opens'] === 1 && $openToken !== ''
            ? '<img src="https://ambienta.io/api/data.php?resource=email-open&amp;token=' . rawurlencode($openToken) . '" alt="" width="1" height="1" style="display:block;width:1px;height:1px">'
            : '';
        $htmlBody = substr(data_campaign_html($formattedMessage), 0, -14) . $openPixel . '</body></html>';
        $activityId = null;
        try {
            $db->prepare('INSERT INTO email_activity (recipient_email, subject, body, status, sender_staff_id) VALUES (?, ?, ?, ?, ?)')->execute([
                (string) $recipient['recipient_email'],
                $subject,
                data_mail_encrypt_content($message . "\n\n---\nTo stop receiving marketing emails, unsubscribe here:\n" . $unsubscribeUrl),
                'Queued',
                $recipient['campaign_staff_id'] === null ? null : (int) $recipient['campaign_staff_id'],
            ]);
            $activityId = $db->lastInsertId();
            data_mail_send(
                $settings,
                (string) $recipient['recipient_email'],
                $subject,
                $message,
                $unsubscribeUrl,
                [],
                [],
                [],
                [],
                $htmlBody
            );
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
            if ($literalLength > 6291456) {
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
        $htmlFallback = null;
        foreach (explode('--' . $boundary, $rawBody) as $part) {
            $part = ltrim($part, "\r\n");
            if ($part === '' || str_starts_with($part, '--')
                || preg_match('/\r?\n\r?\n/', $part, $separator, PREG_OFFSET_CAPTURE) !== 1) continue;
            $separatorOffset = $separator[0][1] + strlen($separator[0][0]);
            $partHeaders = substr($part, 0, $separator[0][1]);
            $partFields = [];
            $currentField = '';
            foreach (preg_split('/\r?\n/', $partHeaders) ?: [] as $headerLine) {
                if (preg_match('/^[ \t]/', $headerLine) === 1 && $currentField !== '') {
                    $partFields[$currentField] .= ' ' . trim($headerLine);
                } elseif (preg_match('/^([A-Za-z0-9-]+):\s*(.*)$/', $headerLine, $headerMatch) === 1) {
                    $currentField = strtolower($headerMatch[1]);
                    $partFields[$currentField] = trim($headerMatch[2]);
                }
            }
            if (str_starts_with(strtolower($partFields['content-disposition'] ?? ''), 'attachment')) continue;
            $partType = $partFields['content-type'] ?? 'text/plain';
            $decodedPart = data_imap_decode_body(
                $partType,
                $partFields['content-transfer-encoding'] ?? '',
                substr($part, $separatorOffset)
            );
            if (str_starts_with(strtolower($partType), 'text/plain') && $decodedPart !== '') return $decodedPart;
            if ($decodedPart !== '' && $htmlFallback === null) $htmlFallback = $decodedPart;
        }
        return $htmlFallback ?? '';
    }

    $body = match (strtolower(trim($transferEncoding))) {
        'base64' => base64_decode(preg_replace('/\s+/', '', $rawBody) ?? '', true) ?: '',
        'quoted-printable' => quoted_printable_decode($rawBody),
        default => $rawBody,
    };
    if (str_starts_with(strtolower($contentType), 'text/html')) {
        $body = preg_replace('/<(script|style)\b[^>]*>.*?<\/\1>/is', '', $body) ?? $body;
        $body = preg_replace('/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/i', "\n", $body) ?? $body;
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
            if (preg_match('/^\* LIST \([^)]*\) (?:NIL|"(?:\\\\.|[^"])*") ("(?:\\\\.|[^"])*"|[^\s]+)\r?\n$/', $line, $matches) === 1) {
                $folderToken = $matches[1];
                $folder = str_starts_with($folderToken, '"')
                    ? stripcslashes(substr($folderToken, 1, -1))
                    : $folderToken;
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

function data_imap_folder_messages(array $settings, string $folder, int $page = 1, string $searchTerm = '', int $limit = 20, bool $subjectOnly = false): array
{
    [$socket, $commandNumber] = data_imap_connect($settings);
    try {
        data_imap_command($socket, $commandNumber, 'SELECT ' . data_imap_quote($folder));
        $searchTerm = trim($searchTerm);
        $search = data_imap_command(
            $socket,
            $commandNumber,
            $searchTerm === ''
                ? 'UID SEARCH ALL'
                : 'UID SEARCH ' . ($subjectOnly ? 'SUBJECT ' : 'TEXT ') . data_imap_quote($searchTerm)
        );
        $uidLine = '';
        foreach ($search['lines'] as $line) {
            if (preg_match('/^\* SEARCH(?:\s+(.*?))?\r?\n$/', $line, $matches) === 1) {
                $uidLine = trim($matches[1] ?? '');
                break;
            }
        }
        $uids = $uidLine === '' ? [] : preg_split('/\s+/', $uidLine);
        if (!is_array($uids)) $uids = [];
        $total = count($uids);
        $uids = array_slice(array_reverse($uids), (max(1, $page) - 1) * $limit, max(1, min($limit, 50)));
        $messages = [];

        foreach ($uids as $uid) {
            if (!is_string($uid) || !ctype_digit($uid)) continue;
            $fetch = data_imap_command(
                $socket,
                $commandNumber,
                'UID FETCH ' . $uid . ' (UID FLAGS INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID IN-REPLY-TO REFERENCES CONTENT-TYPE CONTENT-TRANSFER-ENCODING)] BODY.PEEK[TEXT]<0.8192>)'
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
                'messageId' => trim($fields['message-id'] ?? ''),
                'inReplyTo' => trim($fields['in-reply-to'] ?? ''),
                'references' => trim($fields['references'] ?? ''),
            ];
        }

        data_imap_command($socket, $commandNumber, 'LOGOUT');
        return ['messages' => $messages, 'total' => $total];
    } finally {
        if (is_resource($socket)) fclose($socket);
    }
}

function data_imap_set_seen(array $settings, string $uid, string $folderKind, bool $seen): void
{
    if (!ctype_digit($uid) || !in_array($folderKind, ['inbox', 'sent', 'trash'], true)) {
        throw new RuntimeException('imap_invalid_message_operation');
    }
    $folder = data_imap_resolve_folder(data_imap_folders($settings), $folderKind);
    if ($folder === null) throw new RuntimeException('imap_mailbox_folder_unavailable');
    [$socket, $commandNumber] = data_imap_connect($settings);
    try {
        data_imap_command($socket, $commandNumber, 'SELECT ' . data_imap_quote($folder));
        data_imap_command(
            $socket,
            $commandNumber,
            'UID STORE ' . $uid . ($seen ? ' +FLAGS.SILENT (\\Seen)' : ' -FLAGS.SILENT (\\Seen)')
        );
        data_imap_command($socket, $commandNumber, 'LOGOUT');
    } finally {
        if (is_resource($socket)) fclose($socket);
    }
}

function data_imap_extract_attachments(string $contentType, string $rawBody, int &$totalBytes): array
{
    if (preg_match('/^multipart\/[^;]+;\s*boundary="?([^";]+)"?/i', $contentType, $matches) !== 1) return [];
    $attachments = [];
    foreach (explode('--' . $matches[1], $rawBody) as $part) {
        $part = ltrim($part, "\r\n");
        if ($part === '' || str_starts_with($part, '--')) continue;
        $sections = preg_split('/\r?\n\r?\n/', $part, 2);
        if (!is_array($sections) || count($sections) !== 2) continue;
        [$headerText, $partBody] = $sections;
        $headers = [];
        $currentHeader = '';
        foreach (preg_split('/\r?\n/', $headerText) ?: [] as $line) {
            if (preg_match('/^[ \t]/', $line) === 1 && $currentHeader !== '') {
                $headers[$currentHeader] .= ' ' . trim($line);
            } elseif (preg_match('/^([A-Za-z0-9-]+):\s*(.*)$/', $line, $headerMatch) === 1) {
                $currentHeader = strtolower($headerMatch[1]);
                $headers[$currentHeader] = trim($headerMatch[2]);
            }
        }
        $partType = $headers['content-type'] ?? 'text/plain';
        $partEncoding = strtolower(trim($headers['content-transfer-encoding'] ?? ''));
        $disposition = $headers['content-disposition'] ?? '';
        $fileName = '';
        if (preg_match('/filename\*=(?:UTF-8\'\')?([^;\r\n]+)/i', $disposition, $fileNameMatch) === 1) {
            $fileName = rawurldecode(trim($fileNameMatch[1], " \t\"'"));
        } elseif (preg_match('/filename="?([^";\r\n]+)"?/i', $disposition, $fileNameMatch) === 1) {
            $fileName = $fileNameMatch[1];
        } elseif (preg_match('/\bname="?([^";\r\n]+)"?/i', $partType, $fileNameMatch) === 1) {
            $fileName = $fileNameMatch[1];
        }
        $fileName = data_imap_decode_header(trim($fileName));
        if ($fileName !== '') {
            $fileName = preg_replace('/[^A-Za-z0-9._ -]/', '_', basename($fileName)) ?? '';
            $decoded = match ($partEncoding) {
                'base64' => base64_decode(preg_replace('/\s+/', '', $partBody) ?? '', true),
                'quoted-printable' => quoted_printable_decode($partBody),
                default => $partBody,
            };
            if (!is_string($decoded)) throw new RuntimeException('imap_attachment_decode_failed');
            $totalBytes += strlen($decoded);
            if ($totalBytes > 4 * 1024 * 1024) throw new RuntimeException('imap_attachments_too_large');
            $attachments[] = [
                'name' => $fileName,
                'contentType' => trim(explode(';', $partType, 2)[0]),
                'content' => base64_encode($decoded),
            ];
        } elseif (str_starts_with(strtolower($partType), 'multipart/')) {
            $attachments = array_merge($attachments, data_imap_extract_attachments($partType, $partBody, $totalBytes));
        }
        if (count($attachments) > 10) throw new RuntimeException('imap_too_many_attachments');
    }
    return $attachments;
}

function data_imap_message_details(array $settings, string $uid, string $folderKind): array
{
    if (!ctype_digit($uid) || !in_array($folderKind, ['inbox', 'sent', 'trash'], true)) {
        throw new RuntimeException('imap_invalid_message_operation');
    }
    $folder = data_imap_resolve_folder(data_imap_folders($settings), $folderKind);
    if ($folder === null) throw new RuntimeException('imap_mailbox_folder_unavailable');
    [$socket, $commandNumber] = data_imap_connect($settings);
    try {
        data_imap_command($socket, $commandNumber, 'SELECT ' . data_imap_quote($folder));
        $fetch = data_imap_command(
            $socket,
            $commandNumber,
            'UID FETCH ' . $uid . ' (BODY.PEEK[HEADER.FIELDS (CONTENT-TYPE CONTENT-TRANSFER-ENCODING)] BODY.PEEK[TEXT])'
        );
        $header = $fetch['literals'][0] ?? '';
        $rawBody = $fetch['literals'][1] ?? '';
        $fields = [];
        foreach (preg_split('/\r?\n/', $header) ?: [] as $line) {
            if (preg_match('/^([A-Za-z0-9-]+):\s*(.*)$/', $line, $fieldMatch) === 1) {
                $fields[strtolower($fieldMatch[1])] = trim($fieldMatch[2]);
            }
        }
        $contentType = $fields['content-type'] ?? 'text/plain';
        $body = data_imap_decode_body($contentType, $fields['content-transfer-encoding'] ?? '', $rawBody);
        $totalAttachmentBytes = 0;
        return [
            'body' => $body,
            'attachments' => data_imap_extract_attachments($contentType, $rawBody, $totalAttachmentBytes),
        ];
    } finally {
        if (is_resource($socket)) fclose($socket);
    }
}

function data_imap_reply_metadata(array $settings, string $uid): array
{
    if (!ctype_digit($uid)) throw new RuntimeException('imap_invalid_message_operation');
    $folder = data_imap_resolve_folder(data_imap_folders($settings), 'inbox');
    if ($folder === null) throw new RuntimeException('imap_mailbox_folder_unavailable');
    [$socket, $commandNumber] = data_imap_connect($settings);
    try {
        data_imap_command($socket, $commandNumber, 'SELECT ' . data_imap_quote($folder));
        $fetch = data_imap_command(
            $socket,
            $commandNumber,
            'UID FETCH ' . $uid . ' (BODY.PEEK[HEADER.FIELDS (FROM REPLY-TO MESSAGE-ID REFERENCES IN-REPLY-TO)])'
        );
        $headers = [];
        $currentHeader = '';
        foreach (preg_split('/\r?\n/', $fetch['literals'][0] ?? '') ?: [] as $line) {
            if (preg_match('/^[ \t]/', $line) === 1 && $currentHeader !== '') {
                $headers[$currentHeader] .= ' ' . trim($line);
            } elseif (preg_match('/^([A-Za-z0-9-]+):\s*(.*)$/', $line, $match) === 1) {
                $currentHeader = strtolower($match[1]);
                $headers[$currentHeader] = trim($match[2]);
            }
        }
        $addressHeader = $headers['reply-to'] ?? $headers['from'] ?? '';
        if (preg_match('/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i', $addressHeader, $match) !== 1) {
            throw new RuntimeException('imap_reply_address_unavailable');
        }
        $messageId = trim($headers['message-id'] ?? '');
        $references = trim(($headers['references'] ?? '') . ' ' . ($headers['message-id'] ?? ''));
        return [
            'recipient' => strtolower($match[0]),
            'threadHeaders' => [
                'In-Reply-To' => $messageId !== '' ? $messageId : null,
                'References' => $references !== '' ? $references : null,
            ],
        ];
    } finally {
        if (is_resource($socket)) fclose($socket);
    }
}

function data_agent_mail_recipient(PDO $db, array $body, array $settings): array
{
    $leadIdValue = $body['leadId'] ?? null;
    if ($leadIdValue !== null) {
        $leadId = filter_var($leadIdValue, FILTER_VALIDATE_INT);
        if ($leadId === false || $leadId < 1) {
            data_respond(400, ['error' => 'invalid_lead_id', 'message' => 'Choose a valid lead recipient.']);
        }
        data_require_lead_access($db, (int) $leadId, true);
        $query = $db->prepare('SELECT email FROM leads WHERE id = ?');
        $query->execute([$leadId]);
        $recipient = strtolower((string) $query->fetchColumn());
        if (!filter_var($recipient, FILTER_VALIDATE_EMAIL)) {
            data_respond(400, ['error' => 'invalid_recipient', 'message' => 'The selected lead does not have a valid email address.']);
        }
        return ['recipient' => $recipient, 'leadId' => (int) $leadId, 'replyUid' => null, 'replyFolder' => null, 'threadHeaders' => []];
    }

    $replyMailbox = $body['replyMailbox'] ?? null;
    if (!is_array($replyMailbox)
        || !is_string($replyMailbox['id'] ?? null)
        || !ctype_digit($replyMailbox['id'])
        || ($replyMailbox['folder'] ?? null) !== 'inbox') {
        data_respond(403, ['error' => 'lead_recipient_required', 'message' => 'Select an assigned lead or reply to a message in the inbox.']);
    }
    try {
        $metadata = data_imap_reply_metadata($settings, $replyMailbox['id']);
    } catch (Throwable $error) {
        error_log('Ambients Hostinger reply recipient resolution failed: ' . $error->getMessage());
        data_respond(400, ['error' => 'reply_recipient_unavailable', 'message' => 'The inbox message no longer has a usable reply address. Refresh the inbox and try again.']);
    }
    return [
        'recipient' => $metadata['recipient'],
        'leadId' => null,
        'replyUid' => $replyMailbox['id'],
        'replyFolder' => 'inbox',
        'threadHeaders' => $metadata['threadHeaders'],
    ];
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

function data_mask_contact_email(string $email): string
{
    $separator = strpos($email, '@');
    if ($separator === false) return str_repeat('*', 5);

    return substr($email, 0, 1) . str_repeat('*', max(5, $separator - 1)) . substr($email, $separator);
}

function data_mask_contact_phone(string $phone): string
{
    $digits = preg_replace('/\D+/', '', $phone) ?? '';
    if (strlen($digits) <= 4) return str_repeat('*', 5);

    $prefix = str_starts_with($phone, '+') ? '+' : '';
    return $prefix . substr($digits, 0, 2) . str_repeat('*', max(5, strlen($digits) - 4)) . substr($digits, -2);
}

function data_mask_mail_text(string $text): string
{
    $text = preg_replace_callback(
        '/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i',
        static fn (array $match): string => data_mask_contact_email($match[0]),
        $text
    ) ?? $text;

    return preg_replace_callback(
        '/(?<![A-Za-z0-9])\+?\d(?:[\s().-]*\d){6,}(?![A-Za-z0-9])/',
        static fn (array $match): string => data_mask_contact_phone($match[0]),
        $text
    ) ?? $text;
}

function data_contains_contact_details(string $text): bool
{
    return data_contact_detail_types($text) !== [];
}

function data_contact_detail_types(string $text): array
{
    $types = [];
    if (preg_match('/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i', $text) === 1) {
        $types[] = 'email';
    }
    if (preg_match('/(?<![A-Za-z0-9])\+?\d(?:[\s().-]*\d){6,}(?![A-Za-z0-9])/', $text) === 1) {
        $types[] = 'phone';
    }
    return $types;
}

function data_lead_row(array $row): array
{
    $email = (string) ($row['email'] ?? '');
    $phone = (string) ($row['phone'] ?? '');
    $hasEmail = filter_var($email, FILTER_VALIDATE_EMAIL) !== false;
    $hasPhone = strlen(preg_replace('/\D/', '', $phone) ?? '') >= 7;
    $hasFullName = trim((string) ($row['first_name'] ?? '')) !== ''
        && trim((string) ($row['last_name'] ?? '')) !== '';
    $hasName = trim((string) ($row['first_name'] ?? '')) !== ''
        || trim((string) ($row['last_name'] ?? '')) !== '';
    $hasAddress = trim((string) ($row['address'] ?? '')) !== ''
        || trim((string) ($row['postal_code'] ?? '')) !== '';
    $contactCompleteness = $hasEmail && $hasPhone && $hasFullName ? 'full_contact'
        : ($hasEmail && $hasPhone ? 'email_phone'
            : ($hasEmail && $hasName ? 'email_name'
                : ($hasEmail ? 'email_only'
                    : ($hasPhone && $hasName ? 'phone_name'
                        : ($hasPhone ? 'phone_only' : ($hasAddress ? 'address_only' : 'incomplete'))))));
    if (($_SESSION['admin_role'] ?? '') !== 'admin') {
        $email = $email === '' ? '' : data_mask_contact_email($email);
        $phone = $phone === '' ? '' : data_mask_contact_phone($phone);
    }
    $canViewOrders = ($_SESSION['admin_role'] ?? '') === 'admin'
        || in_array('orders', $_SESSION['admin_permissions'] ?? [], true);
    $profileCompletenessScore = (int) (trim((string) ($row['first_name'] ?? '')) !== '')
        + (int) (trim((string) ($row['last_name'] ?? '')) !== '')
        + (int) $hasEmail
        + (int) $hasPhone
        + (int) (trim((string) ($row['country'] ?? '')) !== ''
            && strtolower(trim((string) ($row['country'] ?? ''))) !== 'not specified');
    if ($canViewOrders) {
        $profileCompletenessScore += (int) (trim((string) ($row['address'] ?? '')) !== '')
            + (int) (trim((string) ($row['postal_code'] ?? '')) !== '');
    }
    $lead = [
        'id' => (int) $row['id'],
        'firstName' => $row['first_name'],
        'lastName' => $row['last_name'],
        'email' => $email,
        'phone' => $phone,
        'contactCompleteness' => $contactCompleteness,
        'profileCompletenessScore' => $profileCompletenessScore,
        'profileCompletenessMaxScore' => $canViewOrders ? 7 : 5,
        'country' => $row['country'] ?? '',
        'leadSource' => $row['lead_source'],
        'createdAt' => $row['created_at'],
        'status' => $row['status'] ?? 'Cold',
        'marketingConsent' => (bool) ($row['marketing_consent'] ?? false),
        'marketingConsentAt' => $row['marketing_consent_at'] ?? null,
    ];
    if ($canViewOrders) {
        $lead['address'] = (string) ($row['address'] ?? '');
        $lead['postalCode'] = (string) ($row['postal_code'] ?? '');
    }
    if ($canViewOrders && array_key_exists('order_count', $row)) $lead['orderCount'] = (int) $row['order_count'];
    if ($canViewOrders && array_key_exists('last_order_at', $row)) $lead['lastOrderAt'] = $row['last_order_at'];
    if ($canViewOrders && array_key_exists('active_order_count', $row)) $lead['activeOrderCount'] = (int) $row['active_order_count'];
    if (array_key_exists('call_count', $row)) $lead['callCount'] = (int) $row['call_count'];
    if (array_key_exists('assigned_staff_id', $row)) $lead['assignedStaffId'] = $row['assigned_staff_id'] === null ? null : (int) $row['assigned_staff_id'];
    if (array_key_exists('assigned_staff_name', $row)) $lead['assignedStaffName'] = $row['assigned_staff_name'];
    return $lead;
}

function data_has_possible_payment_card_number(string $value, string $fieldName = ''): bool
{
    if (preg_match('/(?:email|e-mail|mail|tracking|order|invoice|date|time)/i', $fieldName) === 1) return false;
    preg_match_all('/(?<!\d)(?:\d[\s-]?){13,19}(?!\d)/', $value, $matches);
    foreach ($matches[0] ?? [] as $candidate) {
        $digits = preg_replace('/\D/', '', $candidate) ?? '';
        $length = strlen($digits);
        if ($length < 13 || $length > 19) continue;
        $sum = 0;
        $doubleDigit = false;
        for ($index = $length - 1; $index >= 0; $index--) {
            $digit = (int) $digits[$index];
            if ($doubleDigit) {
                $digit *= 2;
                if ($digit > 9) $digit -= 9;
            }
            $sum += $digit;
            $doubleDigit = !$doubleDigit;
        }
        if ($sum % 10 === 0) return true;
    }
    return false;
}

function data_lead_source_record_row(array $row): array
{
    $data = json_decode((string) $row['data'], true);
    if (!is_array($data)) {
        error_log('Ambients lead source record contains invalid stored JSON.');
        data_respond(500, ['error' => 'lead_source_data_invalid', 'message' => 'Imported source details could not be loaded.']);
    }
    foreach (array_keys($data) as $key) {
        if (!is_string($key)
            || preg_match('/(?:payment|credit|debit|card|(?:^|[^a-z])cc(?:[^a-z]|$)|cvv|cvc|ccv|security.?code|expir(?:y|ation)|medical|medication|prescription|diagnos|symptom|patient)/i', $key) === 1
            || !is_string($data[$key])
            || data_has_possible_payment_card_number($data[$key], $key)) {
            unset($data[$key]);
        }
    }
    return [
        'id' => (int) $row['id'],
        'sourceFile' => (string) $row['source_file'],
        'sourceSheet' => (string) $row['source_sheet'],
        'sourceRow' => (int) $row['source_row'],
        'data' => $data,
    ];
}

function data_lead_activities(PDO $db, int $leadId): array
{
    $activities = [];
    $audit = $db->prepare(
        "SELECT id, actor_email, action, details, created_at
         FROM admin_audit_log
         WHERE entity_type = 'lead' AND entity_id = ?
           AND action IN ('lead.stage_changed', 'lead.assignment_changed', 'lead.phone_updated')
         ORDER BY id DESC LIMIT 200"
    );
    $audit->execute([(string) $leadId]);
    foreach ($audit->fetchAll() as $row) {
        $details = is_array($row['details']) ? $row['details'] : json_decode((string) ($row['details'] ?? ''), true);
        if (!is_array($details)) $details = [];
        $isStageChange = $row['action'] === 'lead.stage_changed';
        $isAssignmentChange = $row['action'] === 'lead.assignment_changed';
        $activities[] = [
            'id' => 'audit-' . (string) $row['id'],
            'type' => $isStageChange ? 'status_change' : ($isAssignmentChange ? 'assignment_change' : 'phone_updated'),
            'note' => isset($details['note']) && is_string($details['note']) ? $details['note'] : '',
            'fromStatus' => isset($details['from']) && is_string($details['from']) ? $details['from'] : null,
            'toStatus' => isset($details['to']) && is_string($details['to']) ? $details['to'] : null,
            'previousStaffId' => isset($details['previousStaffId']) ? (int) $details['previousStaffId'] : null,
            'previousStaffName' => isset($details['previousStaffName']) && is_string($details['previousStaffName']) ? $details['previousStaffName'] : null,
            'assignedStaffId' => isset($details['assignedStaffId']) ? (int) $details['assignedStaffId'] : null,
            'assignedStaffName' => isset($details['assignedStaffName']) && is_string($details['assignedStaffName']) ? $details['assignedStaffName'] : null,
            'assignmentStrategy' => isset($details['strategy']) && is_string($details['strategy']) ? $details['strategy'] : null,
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
    $actor = is_string($_SESSION['impersonated_by'] ?? null)
        ? $_SESSION['impersonated_by']
        : (is_string($_SESSION['admin_email'] ?? null) ? $_SESSION['admin_email'] : 'unknown');
    if (!empty($_SESSION['is_impersonating']) && is_string($_SESSION['admin_email'] ?? null)) {
        $details['actingAs'] = $_SESSION['admin_email'];
    }
    $encoded = json_encode($details, JSON_UNESCAPED_SLASHES);
    if ($encoded === false) {
        throw new RuntimeException('Audit detail encoding failed.');
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
        'paymentLinkUrl' => ($_SESSION['admin_role'] ?? '') === 'admin' ? ($row['payment_link_url'] ?? null) : null,
        'paymentLinkType' => ($_SESSION['admin_role'] ?? '') === 'admin' ? ($row['payment_link_type'] ?? null) : null,
        'paymentLinkName' => ($_SESSION['admin_role'] ?? '') === 'admin' ? ($row['payment_link_name'] ?? null) : null,
        'paymentCryptoAsset' => ($_SESSION['admin_role'] ?? '') === 'admin' ? ($row['payment_crypto_asset'] ?? null) : null,
        'paymentCryptoNetwork' => ($_SESSION['admin_role'] ?? '') === 'admin' ? ($row['payment_crypto_network'] ?? null) : null,
        'paymentLinkSentAt' => $row['payment_link_sent_at'] ?? null,
        'transactionId' => $row['stripe_payment_intent_id'] ?? null,
        'status' => $row['status'],
        'placedAt' => $row['placed_at'],
        'carrier' => $row['carrier'],
        'trackingNumber' => $row['tracking_number'],
        'internalNotes' => $notes,
    ];
}

function data_staff_order_row(PDO $db, array $row): array
{
    $order = data_order_row($db, $row);
    if (($_SESSION['admin_role'] ?? '') === 'admin') return $order;

    $order['email'] = data_mask_contact_email((string) $order['email']);
    $phone = (string) $order['phone'];
    $order['phone'] = $phone === '' ? '' : data_mask_contact_phone($phone);
    return $order;
}

function data_stripe_authorize_order(PDO $db, string $orderId, string $sessionId, string $paymentIntentId, int $amountCapturable): bool
{
    $db->beginTransaction();
    try {
        $find = $db->prepare('SELECT order_number, total_amount, payment_status, stripe_checkout_session_id, stripe_payment_intent_id FROM orders WHERE id = ? FOR UPDATE');
        $find->execute([$orderId]);
        $order = $find->fetch();
        if (!is_array($order) || !hash_equals((string) $order['stripe_checkout_session_id'], $sessionId)) {
            $db->rollBack();
            return false;
        }
        if ($order['payment_status'] === 'Authorized' || $order['payment_status'] === 'Paid') {
            $db->commit();
            return true;
        }
        if (
            $order['payment_status'] !== 'Awaiting Payment'
            || (int) round((float) $order['total_amount'] * 100) !== $amountCapturable
        ) {
            $db->rollBack();
            return false;
        }
        $db->prepare('UPDATE orders SET payment_status = ?, stripe_payment_intent_id = ? WHERE id = ?')
            ->execute(['Authorized', $paymentIntentId, $orderId]);
        data_audit($db, 'order.payment_authorized', 'order', $orderId, ['orderNumber' => $order['order_number']]);
        $db->commit();
        return true;
    } catch (Throwable $error) {
        if ($db->inTransaction()) $db->rollBack();
        throw $error;
    }
}

function data_stripe_mark_order_paid(PDO $db, string $orderId, string $paymentIntentId, int $amountReceived): bool
{
    $db->beginTransaction();
    try {
        $find = $db->prepare('SELECT order_number, total_amount, payment_status, stripe_payment_intent_id FROM orders WHERE id = ? FOR UPDATE');
        $find->execute([$orderId]);
        $order = $find->fetch();
        if (!is_array($order) || !is_string($order['stripe_payment_intent_id'])
            || !hash_equals($order['stripe_payment_intent_id'], $paymentIntentId)
            || (int) round((float) $order['total_amount'] * 100) !== $amountReceived) {
            $db->rollBack();
            return false;
        }
        if ($order['payment_status'] === 'Paid') {
            $db->commit();
            return true;
        }
        if ($order['payment_status'] !== 'Authorized') {
            $db->rollBack();
            return false;
        }
        $db->prepare('UPDATE orders SET payment_status = ? WHERE id = ?')->execute(['Paid', $orderId]);
        data_audit($db, 'order.payment_captured', 'order', $orderId, ['orderNumber' => $order['order_number']]);
        $db->commit();
        return true;
    } catch (Throwable $error) {
        if ($db->inTransaction()) $db->rollBack();
        throw $error;
    }
}

function data_stripe_expire_order(PDO $db, string $sessionId): void
{
    $db->beginTransaction();
    try {
        $find = $db->prepare('SELECT id, order_number, payment_status, status FROM orders WHERE stripe_checkout_session_id = ? FOR UPDATE');
        $find->execute([$sessionId]);
        $order = $find->fetch();
        if (!is_array($order) || $order['payment_status'] !== 'Awaiting Payment' || $order['status'] === 'Cancelled') {
            $db->commit();
            return;
        }
        $db->prepare(
            'UPDATE products p INNER JOIN order_items i ON i.product_id = p.id SET p.stock_count = p.stock_count + i.quantity WHERE i.order_id = ?'
        )->execute([$order['id']]);
        $db->prepare('UPDATE orders SET payment_status = ?, status = ? WHERE id = ?')
            ->execute(['Payment Failed', 'Cancelled', $order['id']]);
        data_audit($db, 'order.payment_expired', 'order', (string) $order['id'], ['orderNumber' => $order['order_number']]);
        $db->commit();
    } catch (Throwable $error) {
        if ($db->inTransaction()) $db->rollBack();
        throw $error;
    }
}

function data_stripe_signature_is_valid(string $payload, string $signatureHeader, string $secret): bool
{
    $timestamp = null;
    $signatures = [];
    foreach (explode(',', $signatureHeader) as $component) {
        [$key, $value] = array_pad(explode('=', trim($component), 2), 2, '');
        if ($key === 't' && ctype_digit($value)) $timestamp = (int) $value;
        if ($key === 'v1' && preg_match('/^[a-f0-9]{64}$/i', $value)) $signatures[] = $value;
    }
    if ($timestamp === null || abs(time() - $timestamp) > 300 || $signatures === []) return false;
    $expected = hash_hmac('sha256', $timestamp . '.' . $payload, $secret);
    foreach ($signatures as $signature) {
        if (hash_equals($expected, $signature)) return true;
    }
    return false;
}

$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? ''));
$resource = $_GET['resource'] ?? '';
if (!is_string($resource)) {
    data_respond(400, ['error' => 'invalid_resource', 'message' => 'The requested resource is invalid.']);
}

if ($resource === 'stripe-webhook' && $method === 'POST') {
    $payload = file_get_contents('php://input');
    $signature = (string) ($_SERVER['HTTP_STRIPE_SIGNATURE'] ?? '');
    try {
        $secret = data_stripe_webhook_secret();
        if (!is_string($payload) || strlen($payload) > 1048576 || !data_stripe_signature_is_valid($payload, $signature, $secret)) {
            data_respond(400, ['error' => 'invalid_webhook_signature', 'message' => 'The Stripe event signature is invalid.']);
        }
        $event = json_decode($payload, true);
        if (!is_array($event) || !is_string($event['id'] ?? null) || !is_string($event['type'] ?? null) || !is_array($event['data']['object'] ?? null)) {
            data_respond(400, ['error' => 'invalid_webhook_event', 'message' => 'The Stripe event payload is invalid.']);
        }
        $db = data_db();
        $seen = $db->prepare('SELECT event_id FROM stripe_webhook_events WHERE event_id = ?');
        $seen->execute([$event['id']]);
        if ($seen->fetchColumn() !== false) data_respond(200, ['received' => true]);
        $object = $event['data']['object'];
        if ($event['type'] === 'checkout.session.completed') {
            $sessionId = $object['id'] ?? '';
            $orderId = $object['metadata']['order_id'] ?? '';
            $paymentIntentId = $object['payment_intent'] ?? '';
            if (
                !is_string($sessionId) || !preg_match('/^cs_(test|live)_[A-Za-z0-9]+$/', $sessionId)
                || !is_string($orderId) || !preg_match('/^[a-f0-9]{32}$/', $orderId)
                || !is_string($paymentIntentId) || !preg_match('/^pi_[A-Za-z0-9]+$/', $paymentIntentId)
            ) {
                data_respond(400, ['error' => 'invalid_checkout_event', 'message' => 'The Stripe checkout event is incomplete.']);
            }
            $intent = data_stripe_request('GET', '/v1/payment_intents/' . rawurlencode($paymentIntentId));
            if (($intent['status'] ?? '') === 'requires_capture') {
                if (!data_stripe_authorize_order($db, $orderId, $sessionId, $paymentIntentId, (int) ($intent['amount_capturable'] ?? 0))) {
                    throw new RuntimeException('The Stripe card authorization did not match its order.');
                }
            } elseif (($intent['status'] ?? '') === 'succeeded') {
                if (!data_stripe_mark_order_paid($db, $orderId, $paymentIntentId, (int) ($intent['amount_received'] ?? 0))) {
                    throw new RuntimeException('The captured Stripe payment did not match its order.');
                }
            } elseif (($intent['status'] ?? '') !== 'canceled') {
                throw new RuntimeException('The Stripe card authorization did not match its order.');
            }
        } elseif ($event['type'] === 'payment_intent.succeeded') {
            $paymentIntentId = $object['id'] ?? '';
            $orderId = $object['metadata']['order_id'] ?? '';
            if (
                !is_string($paymentIntentId) || !preg_match('/^pi_[A-Za-z0-9]+$/', $paymentIntentId)
                || !is_string($orderId) || !preg_match('/^[a-f0-9]{32}$/', $orderId)
                || !data_stripe_mark_order_paid($db, $orderId, $paymentIntentId, (int) ($object['amount_received'] ?? 0))
            ) {
                throw new RuntimeException('The captured Stripe payment did not match its order.');
            }
        } elseif ($event['type'] === 'checkout.session.expired') {
            $sessionId = $object['id'] ?? '';
            if (is_string($sessionId) && preg_match('/^cs_(test|live)_[A-Za-z0-9]+$/', $sessionId)) {
                data_stripe_expire_order($db, $sessionId);
            }
        }
        $db->prepare('INSERT IGNORE INTO stripe_webhook_events (event_id) VALUES (?)')->execute([$event['id']]);
        data_respond(200, ['received' => true]);
    } catch (Throwable $error) {
        error_log('Ambients Stripe webhook processing failed: ' . $error->getMessage());
        data_respond(502, ['error' => 'webhook_processing_failed', 'message' => 'The Stripe event could not be processed.']);
    }
}

if ($resource === 'checkout-result' && $method === 'GET') {
    $sessionId = data_string($_GET, 'session_id', 255);
    if (!preg_match('/^cs_(test|live)_[A-Za-z0-9]+$/', $sessionId)) {
        data_respond(400, ['error' => 'invalid_checkout_session', 'message' => 'The checkout session is invalid.']);
    }
    try {
        $session = data_stripe_request('GET', '/v1/checkout/sessions/' . rawurlencode($sessionId));
        $orderId = $session['metadata']['order_id'] ?? '';
        $paymentIntentId = $session['payment_intent'] ?? '';
        if (($session['status'] ?? '') !== 'complete' || !is_string($orderId) || !preg_match('/^[a-f0-9]{32}$/', $orderId)
            || !is_string($paymentIntentId) || !preg_match('/^pi_[A-Za-z0-9]+$/', $paymentIntentId)) {
            data_respond(409, ['error' => 'checkout_not_complete', 'message' => 'The card authorization has not completed.']);
        }
        $intent = data_stripe_request('GET', '/v1/payment_intents/' . rawurlencode($paymentIntentId));
        if (($intent['status'] ?? '') !== 'requires_capture') {
            data_respond(409, ['error' => 'checkout_not_authorized', 'message' => 'The card could not be authorized. Please contact the pharmacy.']);
        }
        $db = data_db();
        if (!data_stripe_authorize_order($db, $orderId, $sessionId, $paymentIntentId, (int) ($intent['amount_capturable'] ?? 0))) {
            data_respond(409, ['error' => 'order_authorization_mismatch', 'message' => 'The payment authorization could not be matched to the order. Contact the pharmacy before retrying.']);
        }
        $find = $db->prepare('SELECT order_number, total_amount, payment_status FROM orders WHERE id = ? AND stripe_checkout_session_id = ?');
        $find->execute([$orderId, $sessionId]);
        $order = $find->fetch();
        if (!is_array($order)) data_respond(404, ['error' => 'order_not_found', 'message' => 'The authorized order was not found.']);
        data_respond(200, [
            'orderNumber' => $order['order_number'],
            'totalAmount' => (float) $order['total_amount'],
            'paymentStatus' => $order['payment_status'],
        ]);
    } catch (Throwable $error) {
        error_log('Ambients Stripe checkout confirmation failed: ' . $error->getMessage());
        data_respond(502, ['error' => 'checkout_confirmation_failed', 'message' => 'The payment authorization could not be confirmed. Contact the pharmacy before retrying.']);
    }
}

if ($resource === 'checkout-cancel' && $method === 'POST') {
    $body = data_read_json();
    $orderId = data_string($body, 'orderId', 64);
    if (!preg_match('/^[a-f0-9]{32}$/', $orderId)) {
        data_respond(400, ['error' => 'invalid_order_id', 'message' => 'The order identifier is invalid.']);
    }
    $db = data_db();
    $find = $db->prepare('SELECT stripe_checkout_session_id, payment_status FROM orders WHERE id = ?');
    $find->execute([$orderId]);
    $order = $find->fetch();
    if (!is_array($order) || $order['payment_status'] !== 'Awaiting Payment' || !is_string($order['stripe_checkout_session_id'])) {
        data_respond(409, ['error' => 'checkout_not_cancellable', 'message' => 'This checkout can no longer be cancelled.']);
    }
    try {
        $session = data_stripe_request('GET', '/v1/checkout/sessions/' . rawurlencode($order['stripe_checkout_session_id']));
        if (($session['status'] ?? '') === 'complete') {
            data_respond(409, ['error' => 'checkout_already_complete', 'message' => 'Payment may already be authorized. Refresh the page to confirm its status.']);
        }
        if (($session['status'] ?? '') === 'open') {
            data_stripe_request('POST', '/v1/checkout/sessions/' . rawurlencode($order['stripe_checkout_session_id']) . '/expire');
        } elseif (($session['status'] ?? '') !== 'expired') {
            data_respond(409, ['error' => 'checkout_not_cancellable', 'message' => 'This checkout can no longer be cancelled.']);
        }
        data_stripe_expire_order($db, $order['stripe_checkout_session_id']);
        data_respond(200, ['cancelled' => true]);
    } catch (Throwable $error) {
        error_log('Ambients Stripe checkout cancellation failed: ' . $error->getMessage());
        data_respond(409, ['error' => 'checkout_cancel_failed', 'message' => 'Checkout could not be cancelled. If you completed payment, contact the pharmacy.']);
    }
}

if ($resource === 'payment-config' && $method === 'GET') {
    try {
        $config = data_config();
        $secretReady = is_string($config['stripe_secret_key'] ?? null)
            && preg_match('/^sk_(test|live)_[A-Za-z0-9]+$/', $config['stripe_secret_key']) === 1;
        $webhookReady = is_string($config['stripe_webhook_secret'] ?? null)
            && preg_match('/^whsec_[A-Za-z0-9]+$/', $config['stripe_webhook_secret']) === 1;
        data_respond(200, ['stripeConfigured' => $secretReady && $webhookReady && function_exists('curl_init')]);
    } catch (Throwable $error) {
        error_log('Ambients payment configuration status failed: ' . $error->getMessage());
        data_respond(503, ['error' => 'payment_config_unavailable', 'message' => 'Payment configuration status is unavailable.']);
    }
}

if ($resource === 'chat') {
    if ($method === 'POST') {
        $origin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
        if ($origin !== '') {
            $originParts = parse_url($origin);
            $requestHostHeader = (string) ($_SERVER['HTTP_HOST'] ?? '');
            $requestHost = parse_url('//' . $requestHostHeader, PHP_URL_HOST);
            $requestPort = parse_url('//' . $requestHostHeader, PHP_URL_PORT);
            $requestScheme = strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''));
            if ($requestScheme === '') {
                $https = (string) ($_SERVER['HTTPS'] ?? '');
                $requestScheme = $https !== '' && strtolower($https) !== 'off' ? 'https' : 'http';
            }
            $originScheme = is_array($originParts) ? strtolower((string) ($originParts['scheme'] ?? '')) : '';
            $originHost = is_array($originParts) ? ($originParts['host'] ?? null) : null;
            $originPort = is_array($originParts) ? ($originParts['port'] ?? null) : null;
            $effectiveRequestPort = $requestPort ?? ($requestScheme === 'https' ? 443 : 80);
            $effectiveOriginPort = $originPort ?? ($originScheme === 'https' ? 443 : 80);
            if (!is_string($originHost) || !is_string($requestHost)
                || strcasecmp($originHost, $requestHost) !== 0
                || $originScheme !== $requestScheme
                || $effectiveOriginPort !== $effectiveRequestPort) {
                data_respond(403, ['error' => 'chat_origin_rejected', 'message' => 'This chat request could not be verified. Reload the page and try again.']);
            }
        }

        $body = data_read_json(8192);
        if (data_string($body, 'website', 200, false) !== '') {
            data_respond(400, ['error' => 'chat_request_rejected', 'message' => 'The chat request could not be accepted.']);
        }
        $action = data_string($body, 'action', 16);
        $db = data_db();

        if ($action === 'read') {
            $conversationId = filter_var($body['conversation'] ?? null, FILTER_VALIDATE_INT);
            $token = data_string($body, 'token', 64);
            if ($conversationId === false || $conversationId < 1 || preg_match('/^[a-f0-9]{64}$/', $token) !== 1) {
                data_respond(400, ['error' => 'invalid_chat_link', 'message' => 'This chat session is invalid. Start a new conversation.']);
            }
            $find = $db->prepare('SELECT id, status FROM chat_conversations WHERE id = ? AND visitor_token_hash = ? LIMIT 1');
            $find->execute([(int) $conversationId, hash('sha256', $token)]);
            $conversation = $find->fetch();
            if (!is_array($conversation)) {
                data_respond(404, ['error' => 'chat_not_found', 'message' => 'This chat session could not be found. Start a new conversation.']);
            }
            $db->prepare(
                "UPDATE chat_messages SET read_at = UTC_TIMESTAMP() WHERE conversation_id = ? AND sender_type = 'staff' AND read_at IS NULL"
            )->execute([(int) $conversationId]);
            data_respond(200, [
                'conversation' => ['id' => (int) $conversation['id'], 'status' => $conversation['status']],
                'messages' => data_chat_message_rows($db, (int) $conversationId),
            ]);
        }

        if ($action === 'start') {
            $visitorName = data_string($body, 'name', 100);
            $visitorEmail = strtolower(data_string($body, 'email', 254, false));
            $visitorPhone = data_string($body, 'phone', 40, false);
            $visitorId = data_string($body, 'visitorId', 64, false);
            if ($visitorId !== '' && preg_match('/^[a-f0-9]{64}$/', $visitorId) !== 1) {
                data_respond(400, ['error' => 'invalid_visitor_id', 'message' => 'The visitor session could not be linked to this conversation. Reload the page and try again.']);
            }
            if ($visitorEmail !== '' && filter_var($visitorEmail, FILTER_VALIDATE_EMAIL) === false) {
                data_respond(400, ['error' => 'invalid_chat_email', 'message' => 'Enter a valid email address or leave it blank.']);
            }
            $message = data_string($body, 'message', 2000);
            data_chat_rate_limit($db, 'start', 10, 3600);

            $token = bin2hex(random_bytes(32));
            $db->beginTransaction();
            try {
                $create = $db->prepare(
                    "INSERT INTO chat_conversations (visitor_name, visitor_email, visitor_phone, visitor_token_hash, visitor_id_hash, last_visitor_message_at)
                     VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())"
                );
                $create->execute([
                    $visitorName,
                    $visitorEmail,
                    $visitorPhone,
                    hash('sha256', $token),
                    $visitorId === '' ? null : hash('sha256', $visitorId),
                ]);
                $conversationId = (int) $db->lastInsertId();
                $db->prepare(
                    "INSERT INTO chat_messages (conversation_id, sender_type, sender_name, body)
                     VALUES (?, 'visitor', ?, ?)"
                )->execute([$conversationId, $visitorName, $message]);
                if ($visitorEmail !== '') {
                    $nameParts = preg_split('/\s+/u', trim($visitorName), 2) ?: [$visitorName];
                    $createLead = $db->prepare(
                        "INSERT INTO leads (first_name, last_name, email, phone, lead_source, status, marketing_consent)
                         VALUES (?, ?, ?, ?, 'Live chat', 'New', 0)
                         ON DUPLICATE KEY UPDATE phone = IF(phone = '', VALUES(phone), phone)"
                    );
                    $createLead->execute([$nameParts[0], $nameParts[1] ?? '', $visitorEmail, $visitorPhone]);
                }
                $db->commit();
            } catch (Throwable $error) {
                if ($db->inTransaction()) $db->rollBack();
                error_log('Ambients live-chat conversation could not be created: ' . $error->getMessage());
                data_respond(503, ['error' => 'chat_create_failed', 'message' => 'Your conversation could not be started. Please try again.']);
            }
            data_respond(201, [
                'token' => $token,
                'conversation' => ['id' => $conversationId, 'status' => 'open'],
                'messages' => data_chat_message_rows($db, $conversationId),
            ]);
        }

        if ($action === 'message') {
            $conversationId = filter_var($body['conversation'] ?? null, FILTER_VALIDATE_INT);
            $token = data_string($body, 'token', 64);
            $message = data_string($body, 'message', 2000);
            if ($conversationId === false || $conversationId < 1 || preg_match('/^[a-f0-9]{64}$/', $token) !== 1) {
                data_respond(400, ['error' => 'invalid_chat_link', 'message' => 'This chat session is invalid. Start a new conversation.']);
            }
            data_chat_rate_limit($db, 'message', 60, 60);
            $db->beginTransaction();
            try {
                $find = $db->prepare(
                    'SELECT id, visitor_name, status, last_visitor_message_at FROM chat_conversations WHERE id = ? AND visitor_token_hash = ? FOR UPDATE'
                );
                $find->execute([(int) $conversationId, hash('sha256', $token)]);
                $conversation = $find->fetch();
                if (!is_array($conversation)) {
                    $db->rollBack();
                    data_respond(404, ['error' => 'chat_not_found', 'message' => 'This chat session could not be found. Start a new conversation.']);
                }
                if ($conversation['status'] !== 'open') {
                    $db->rollBack();
                    data_respond(409, ['error' => 'chat_closed', 'message' => 'This conversation is closed. Start a new chat if you need more help.']);
                }
                if (is_string($conversation['last_visitor_message_at'])
                    && strtotime((string) $conversation['last_visitor_message_at'] . ' UTC') > time() - 2) {
                    $db->rollBack();
                    data_respond(429, ['error' => 'chat_message_too_fast', 'message' => 'Please wait a moment before sending another message.']);
                }
                $db->prepare(
                    "INSERT INTO chat_messages (conversation_id, sender_type, sender_name, body)
                     VALUES (?, 'visitor', ?, ?)"
                )->execute([(int) $conversationId, $conversation['visitor_name'], $message]);
                $db->prepare(
                    'UPDATE chat_conversations SET last_visitor_message_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP() WHERE id = ?'
                )->execute([(int) $conversationId]);
                $db->commit();
            } catch (Throwable $error) {
                if ($db->inTransaction()) $db->rollBack();
                error_log('Ambients live-chat message could not be saved: ' . $error->getMessage());
                data_respond(503, ['error' => 'chat_message_failed', 'message' => 'Your message could not be sent. Please try again.']);
            }
            data_respond(200, [
                'conversation' => ['id' => (int) $conversationId, 'status' => 'open'],
                'messages' => data_chat_message_rows($db, (int) $conversationId),
            ]);
        }

        data_respond(400, ['error' => 'invalid_chat_action', 'message' => 'Choose whether to start a conversation or send a message.']);
    }

    data_respond(405, ['error' => 'method_not_allowed', 'message' => 'Use POST to access or send a chat message.']);
}

if ($resource === 'visitor-session' && $method === 'POST') {
    $origin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
    if ($origin !== '') {
        $originParts = parse_url($origin);
        $requestHostHeader = (string) ($_SERVER['HTTP_HOST'] ?? '');
        $requestHost = parse_url('//' . $requestHostHeader, PHP_URL_HOST);
        $requestPort = parse_url('//' . $requestHostHeader, PHP_URL_PORT);
        $requestScheme = strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''));
        if ($requestScheme === '') {
            $https = (string) ($_SERVER['HTTPS'] ?? '');
            $requestScheme = $https !== '' && strtolower($https) !== 'off' ? 'https' : 'http';
        }
        $originScheme = is_array($originParts) ? strtolower((string) ($originParts['scheme'] ?? '')) : '';
        $originHost = is_array($originParts) ? ($originParts['host'] ?? null) : null;
        $originPort = is_array($originParts) ? ($originParts['port'] ?? null) : null;
        $effectiveRequestPort = $requestPort ?? ($requestScheme === 'https' ? 443 : 80);
        $effectiveOriginPort = $originPort ?? ($originScheme === 'https' ? 443 : 80);
        if (!is_string($originHost) || !is_string($requestHost)
            || strcasecmp($originHost, $requestHost) !== 0
            || $originScheme !== $requestScheme
            || $effectiveOriginPort !== $effectiveRequestPort) {
            data_respond(403, ['error' => 'visitor_origin_rejected', 'message' => 'This visitor session could not be verified. Reload the page and try again.']);
        }
    }

    $body = data_read_json(4096);
    $sessionToken = data_string($body, 'sessionToken', 64);
    $visitorToken = data_string($body, 'visitorToken', 64);
    if (preg_match('/^[a-f0-9]{64}$/', $sessionToken) !== 1 || preg_match('/^[a-f0-9]{64}$/', $visitorToken) !== 1) {
        data_respond(400, ['error' => 'invalid_visitor_session', 'message' => 'This visitor session is invalid. Reload the page and try again.']);
    }
    $pagePath = data_string($body, 'path', 500);
    if ($pagePath[0] !== '/' || str_starts_with($pagePath, '//') || strpbrk($pagePath, "?#\r\n") !== false) {
        data_respond(400, ['error' => 'invalid_visitor_path', 'message' => 'The visitor page could not be recorded.']);
    }
    $pageTitle = data_string($body, 'title', 720, false);
    $productId = data_string($body, 'productId', 64, false);
    if ($productId !== '' && preg_match('/^[a-zA-Z0-9._-]+$/', $productId) !== 1) {
        data_respond(400, ['error' => 'invalid_product_activity', 'message' => 'The product activity could not be recorded.']);
    }
    $referrerDomain = strtolower(data_string($body, 'referrerDomain', 253, false));
    if ($referrerDomain !== '' && preg_match('/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/', $referrerDomain) !== 1) {
        data_respond(400, ['error' => 'invalid_visitor_referrer', 'message' => 'The visitor referral source could not be recorded.']);
    }
    $language = data_string($body, 'language', 35, false);
    if ($language !== '' && preg_match('/^[a-zA-Z0-9-]+$/', $language) !== 1) {
        data_respond(400, ['error' => 'invalid_visitor_language', 'message' => 'The visitor language could not be recorded.']);
    }

    $countryHeader = strtoupper((string) ($_SERVER['HTTP_CF_IPCOUNTRY'] ?? ''));
    $countryCode = preg_match('/^[A-Z]{2}$/', $countryHeader) === 1 && !in_array($countryHeader, ['XX', 'T1'], true)
        ? $countryHeader
        : null;
    $sessionHash = hash('sha256', $sessionToken);
    $visitorHash = hash('sha256', $visitorToken);
    $db = data_db();
    data_chat_rate_limit($db, 'visitor-session', 240, 3600, $sessionHash);
    $exists = $db->prepare('SELECT 1 FROM visitor_sessions WHERE session_token_hash = ? LIMIT 1');
    $exists->execute([$sessionHash]);
    if ($exists->fetchColumn() === false) {
        data_chat_rate_limit($db, 'visitor-session-new', 300, 3600);
    }

    $db->beginTransaction();
    try {
        $find = $db->prepare('SELECT current_path, last_seen FROM visitor_sessions WHERE session_token_hash = ? FOR UPDATE');
        $find->execute([$sessionHash]);
        $previousSession = $find->fetch();
        $previousPath = is_array($previousSession) ? $previousSession['current_path'] : false;
        $isNewSession = $previousSession === false;
        if (!$isNewSession) {
            $db->prepare(
                'UPDATE visitor_page_views SET dwell_seconds = LEAST(3600, dwell_seconds + LEAST(60, GREATEST(0, TIMESTAMPDIFF(SECOND, ?, UTC_TIMESTAMP()))))
                 WHERE session_token_hash = ? ORDER BY id DESC LIMIT 1'
            )->execute([$previousSession['last_seen'], $sessionHash]);
        }
        $upsert = $db->prepare(
            "INSERT INTO visitor_sessions
                (session_token_hash, visitor_token_hash, current_path, referrer_domain, country_code, language, first_seen, last_seen)
             VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
             ON DUPLICATE KEY UPDATE
                visitor_token_hash = VALUES(visitor_token_hash),
                current_path = VALUES(current_path),
                referrer_domain = IF(referrer_domain = '', VALUES(referrer_domain), referrer_domain),
                country_code = COALESCE(VALUES(country_code), country_code),
                language = IF(VALUES(language) = '', language, VALUES(language)),
                last_seen = UTC_TIMESTAMP()"
        );
        $upsert->execute([$sessionHash, $visitorHash, $pagePath, $referrerDomain, $countryCode, $language]);

        if ($isNewSession || $previousPath !== $pagePath) {
            $db->prepare(
                'INSERT INTO visitor_page_views (session_token_hash, page_path, page_title, product_id, viewed_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP())'
            )->execute([$sessionHash, $pagePath, $pageTitle, $productId === '' ? null : $productId]);
            $oldestKept = $db->prepare(
                'SELECT id FROM visitor_page_views WHERE session_token_hash = ? ORDER BY id DESC LIMIT 1 OFFSET 49'
            );
            $oldestKept->execute([$sessionHash]);
            $oldestId = $oldestKept->fetchColumn();
            if ($oldestId !== false) {
                $db->prepare('DELETE FROM visitor_page_views WHERE session_token_hash = ? AND id < ?')
                    ->execute([$sessionHash, (int) $oldestId]);
            }
        } else {
            $latestView = $db->prepare('SELECT id FROM visitor_page_views WHERE session_token_hash = ? ORDER BY id DESC LIMIT 1');
            $latestView->execute([$sessionHash]);
            $latestViewId = $latestView->fetchColumn();
            if ($latestViewId !== false) {
                if ($pageTitle === '') {
                    $db->prepare('UPDATE visitor_page_views SET product_id = ? WHERE id = ? AND session_token_hash = ?')
                        ->execute([$productId === '' ? null : $productId, (int) $latestViewId, $sessionHash]);
                } else {
                    $db->prepare('UPDATE visitor_page_views SET page_title = ?, product_id = ? WHERE id = ? AND session_token_hash = ?')
                        ->execute([$pageTitle, $productId === '' ? null : $productId, (int) $latestViewId, $sessionHash]);
                }
            }
        }
        $db->exec('DELETE FROM visitor_sessions WHERE last_seen < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY) LIMIT 1000');
        $db->commit();
    } catch (Throwable $error) {
        if ($db->inTransaction()) $db->rollBack();
        error_log('Ambients visitor session could not be saved: ' . $error->getMessage());
        data_respond(503, ['error' => 'visitor_session_unavailable', 'message' => 'Visitor sessions are temporarily unavailable.']);
    }
    data_respond(204, []);
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

if ($resource === 'email-open' && $method === 'GET') {
    $token = $_GET['token'] ?? '';
    if (is_string($token) && preg_match('/^[a-f0-9]{64}$/', $token) === 1) {
        try {
            data_db()->prepare(
                'UPDATE email_campaign_recipients SET opened_at = UTC_TIMESTAMP() WHERE open_token_hash = ? AND opened_at IS NULL'
            )->execute([hash('sha256', $token)]);
        } catch (Throwable $error) {
            error_log('Ambients campaign open event could not be recorded: ' . $error->getMessage());
        }
    }
    header('Content-Type: image/gif');
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('X-Robots-Tag: noindex, nofollow');
    echo base64_decode('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=');
    exit;
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
    'email-settings', 'email-test', 'email-send', 'email-activity', 'email-activity-details', 'email-thread', 'email-inbox', 'email-recipient-leads',
    'email-message-trash', 'email-message-restore', 'email-message-purge', 'email-message-seen', 'email-message-details',
    'email-drafts', 'email-draft', 'email-draft-trash', 'email-draft-restore',
    'email-draft-purge', 'email-draft-remove', 'email-campaigns',
    'email-campaign-audience', 'email-campaign-save', 'email-campaign-test-send', 'email-campaign-launch',
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

    if ($method === 'GET' && $resource === 'email-recipient-leads') {
        data_require_permission('integrations');
        if (($_SESSION['admin_role'] ?? '') === 'admin') {
            data_respond(200, ['recipients' => []]);
        }
        $db = data_db();
        $includeUnassignedNew = in_array('new_leads', $_SESSION['admin_permissions'] ?? [], true);
        $query = $db->prepare(
            'SELECT id, first_name, last_name, email FROM leads
             WHERE assigned_staff_id = ?' . ($includeUnassignedNew ? " OR (assigned_staff_id IS NULL AND status = 'New')" : '') . '
             ORDER BY first_name, last_name, id'
        );
        $query->execute([(int) ($_SESSION['staff_id'] ?? 0)]);
        $recipients = array_map(static fn (array $row): array => [
            'id' => (int) $row['id'],
            'name' => trim((string) $row['first_name'] . ' ' . (string) $row['last_name']),
            'email' => data_mask_contact_email((string) $row['email']),
        ], $query->fetchAll());
        data_respond(200, ['recipients' => $recipients]);
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
        $page = filter_var($_GET['page'] ?? '1', FILTER_VALIDATE_INT);
        $searchTerm = $_GET['search'] ?? '';
        if ($page === false || $page < 1 || $page > 100000 || !is_string($searchTerm) || strlen($searchTerm) > 128 || preg_match('/[\r\n\x00]/', $searchTerm) === 1) {
            data_respond(400, ['error' => 'invalid_mail_query', 'message' => 'The mailbox search or page number is invalid.']);
        }
        $isOperator = ($_SESSION['admin_role'] ?? '') !== 'admin';
        if ($isOperator && data_contains_contact_details($searchTerm)) {
            data_respond(400, ['error' => 'invalid_mail_search', 'message' => 'Search by subject text, not by email addresses or phone numbers.']);
        }
        try {
            $folders = data_imap_folders($settings);
            $folder = data_imap_resolve_folder($folders, $folderKind);
            $result = $folder === null ? ['messages' => [], 'total' => 0] : data_imap_folder_messages($settings, $folder, $page, $searchTerm, 20, $isOperator);
            $messages = $result['messages'];
            if ($isOperator) {
                foreach ($messages as &$mailMessage) {
                    $mailMessage['from'] = data_mask_mail_text((string) $mailMessage['from']);
                    $mailMessage['subject'] = data_mask_mail_text((string) $mailMessage['subject']);
                    $mailMessage['body'] = data_mask_mail_text((string) $mailMessage['body']);
                    $mailMessage['messageId'] = '';
                    $mailMessage['inReplyTo'] = '';
                    $mailMessage['references'] = '';
                }
                unset($mailMessage);
            }
            data_respond(200, [
                'mailboxMessages' => $messages,
                'total' => $result['total'],
                'page' => $page,
                'pageSize' => 20,
                'folderAvailable' => $folder !== null,
            ]);
        } catch (Throwable $error) {
            error_log('Ambients Hostinger IMAP inbox sync failed: ' . $error->getMessage());
            data_respond(502, ['error' => 'mail_inbox_unavailable', 'message' => 'The Hostinger inbox could not be synchronized. Verify the mailbox password and IMAP service.']);
        }
    }

    if ($resource === 'email-message-seen' && $method === 'POST') {
        data_require_permission('integrations');
        $body = data_read_json(2048);
        $uid = $body['id'] ?? null;
        $folder = $body['folder'] ?? null;
        $seen = $body['seen'] ?? null;
        if (!is_string($uid) || !ctype_digit($uid) || !is_string($folder) || !in_array($folder, ['inbox', 'sent', 'trash'], true) || !is_bool($seen)) {
            data_respond(400, ['error' => 'invalid_message_update', 'message' => 'The mailbox message update is invalid.']);
        }
        $settings = data_mail_settings();
        if ($settings === []) data_respond(409, ['error' => 'mail_not_configured', 'message' => 'Configure the Hostinger mailbox before changing message status.']);
        try {
            data_imap_set_seen($settings, $uid, $folder, $seen);
        } catch (Throwable $error) {
            error_log('Ambients Hostinger message read status update failed: ' . $error->getMessage());
            data_respond(502, ['error' => 'mail_message_update_failed', 'message' => 'The message read status could not be updated. Refresh the folder and try again.']);
        }
        data_respond(200, ['updated' => true]);
    }

    if ($resource === 'email-message-details' && $method === 'POST') {
        data_require_permission('integrations');
        $body = data_read_json(2048);
        $uid = $body['id'] ?? null;
        $folder = $body['folder'] ?? null;
        if (!is_string($uid) || !ctype_digit($uid) || !is_string($folder) || !in_array($folder, ['inbox', 'sent', 'trash'], true)) {
            data_respond(400, ['error' => 'invalid_message_id', 'message' => 'The selected mailbox message is invalid.']);
        }
        $settings = data_mail_settings();
        if ($settings === []) data_respond(409, ['error' => 'mail_not_configured', 'message' => 'Configure the Hostinger mailbox before opening message details.']);
        try {
            $details = data_imap_message_details($settings, $uid, $folder);
        } catch (Throwable $error) {
            error_log('Ambients Hostinger message details fetch failed: ' . $error->getMessage());
            $message = match ($error->getMessage()) {
                'imap_literal_too_large' => 'This message is too large to load in the CRM.',
                'imap_attachments_too_large' => 'This message has more than 4 MB of attachments.',
                'imap_too_many_attachments' => 'This message has more than ten attachments.',
                default => 'The full message and its attachments could not be loaded.',
            };
            data_respond(502, ['error' => 'mail_message_details_failed', 'message' => $message]);
        }
        if (($_SESSION['admin_role'] ?? '') !== 'admin') {
            $details['body'] = data_mask_mail_text((string) $details['body']);
            $details['attachments'] = [];
        }
        data_respond(200, $details);
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
        $isOperator = ($_SESSION['admin_role'] ?? '') !== 'admin';
        $deleted = $resource === 'email-draft-trash';
        $statement = data_db()->prepare(
            'SELECT id, recipient_email, recipient_lead_id, reply_uid, reply_folder, subject, body, cc, bcc, thread_headers, attachments, email_design, updated_at FROM email_drafts WHERE deleted_at IS ' . ($deleted ? 'NOT NULL' : 'NULL') . ' ORDER BY updated_at DESC LIMIT 100'
        );
        $statement->execute();
        $rows = $statement->fetchAll();
        data_respond(200, ['drafts' => array_map(static function (array $row) use ($isOperator): array {
            $recipient = (string) $row['recipient_email'];
            $draftBody = data_mail_decrypt_content($row['body']);
            if ($isOperator) {
                $recipient = $recipient === '' ? '' : data_mask_contact_email($recipient);
                $draftBody = data_mask_mail_text($draftBody);
            }
            return [
            'id' => (string) $row['id'],
            'recipientEmail' => $recipient,
            'recipientLeadId' => $row['recipient_lead_id'] === null ? null : (int) $row['recipient_lead_id'],
            'replyMailbox' => $row['reply_uid'] === null ? null : ['id' => (string) $row['reply_uid'], 'folder' => $row['reply_folder']],
            'subject' => $isOperator ? data_mask_mail_text((string) $row['subject']) : $row['subject'],
            'body' => $draftBody,
            'cc' => $isOperator ? [] : (json_decode(data_mail_decrypt_content($row['cc']), true) ?: []),
            'bcc' => $isOperator ? [] : (json_decode(data_mail_decrypt_content($row['bcc']), true) ?: []),
            'threadHeaders' => $isOperator ? [] : (json_decode(data_mail_decrypt_content($row['thread_headers']), true) ?: []),
            'attachments' => $isOperator ? [] : (json_decode(data_mail_decrypt_content($row['attachments']), true) ?: []),
            'emailDesign' => in_array($row['email_design'], ['plain', 'card'], true) ? $row['email_design'] : 'plain',
            'updatedAt' => $row['updated_at'],
            ];
        }, $rows)]);
    }

    if ($method === 'POST' && $resource === 'email-draft') {
        data_require_permission('integrations');
        $body = data_read_json(6 * 1024 * 1024);
        $isOperator = ($_SESSION['admin_role'] ?? '') !== 'admin';
        $db = data_db();
        $recipientLeadId = null;
        $replyUid = null;
        $replyFolder = null;
        $replyThreadHeaders = null;
        if ($isOperator) {
            $settings = data_mail_settings();
            $recipientDetails = data_agent_mail_recipient($db, $body, $settings);
            $recipient = $recipientDetails['recipient'];
            $recipientLeadId = $recipientDetails['leadId'];
            $replyUid = $recipientDetails['replyUid'];
            $replyFolder = $recipientDetails['replyFolder'];
            $replyThreadHeaders = $recipientDetails['threadHeaders'];
        } else {
            $recipient = strtolower(data_string($body, 'recipientEmail', 254, false));
        }
        $subject = data_string($body, 'subject', 180, false);
        $emailDesign = data_string($body, 'emailDesign', 16, false);
        if ($emailDesign === '') {
            $emailDesign = 'plain';
        }
        if (!in_array($emailDesign, ['plain', 'card'], true)) {
            data_respond(400, ['error' => 'invalid_email_design', 'message' => 'Choose either the designed card or plain email layout.']);
        }
        $draftBody = $body['body'] ?? '';
        if (!is_string($draftBody) || strlen($draftBody) > 24000) {
            data_respond(400, ['error' => 'invalid_draft', 'message' => 'The draft message must be 24,000 bytes or less.']);
        }
        if ($recipient !== '' && !filter_var($recipient, FILTER_VALIDATE_EMAIL)) {
            data_respond(400, ['error' => 'invalid_recipient', 'message' => 'Enter a valid recipient email address.']);
        }
        try {
            $cc = data_mail_address_list($body['cc'] ?? '', 'cc');
            $bcc = data_mail_address_list($body['bcc'] ?? '', 'bcc');
            $attachments = data_mail_attachments($body['attachments'] ?? []);
            $threadHeaders = $isOperator
                ? ($replyThreadHeaders ?? [])
                : data_mail_thread_headers($body['threadHeaders'] ?? []);
        } catch (Throwable $error) {
            $message = match ($error->getMessage()) {
                'attachments_too_large' => 'Attachments must total 4 MB or less.',
                'invalid_attachments' => 'Add up to five valid attachments, each with a supported file name.',
                'too_many_cc', 'too_many_bcc' => 'Use no more than ten addresses in each CC or BCC field.',
                'invalid_cc', 'invalid_bcc' => 'Check the email addresses in the CC and BCC fields.',
                default => 'The reply thread metadata is invalid.',
            };
            data_respond(400, ['error' => 'invalid_draft', 'message' => $message]);
        }
        if ($isOperator && ($cc !== [] || $bcc !== [] || $attachments !== [])) {
            data_respond(403, ['error' => 'agent_email_restrictions', 'message' => 'Agent drafts cannot include additional recipients or attachments.']);
        }
        if (count($cc) + count($bcc) > 20) {
            data_respond(400, ['error' => 'too_many_recipients', 'message' => 'Use no more than 20 total CC and BCC addresses.']);
        }
        $draftId = filter_var($body['id'] ?? null, FILTER_VALIDATE_INT);
        $encryptedBody = data_mail_encrypt_content($draftBody);
        $encryptedCc = data_mail_encrypt_content(json_encode($cc, JSON_UNESCAPED_SLASHES) ?: '[]');
        $encryptedBcc = data_mail_encrypt_content(json_encode($bcc, JSON_UNESCAPED_SLASHES) ?: '[]');
        $encryptedThread = data_mail_encrypt_content(json_encode($threadHeaders, JSON_UNESCAPED_SLASHES) ?: '{}');
        $encryptedAttachments = data_mail_encrypt_content(json_encode($attachments, JSON_UNESCAPED_SLASHES) ?: '[]');
        if ($draftId !== false && $draftId !== null && $draftId > 0) {
            $update = $db->prepare('UPDATE email_drafts SET recipient_email = ?, recipient_lead_id = ?, reply_uid = ?, reply_folder = ?, subject = ?, body = ?, cc = ?, bcc = ?, thread_headers = ?, attachments = ?, email_design = ? WHERE id = ? AND deleted_at IS NULL');
            $update->execute([$recipient, $recipientLeadId, $replyUid, $replyFolder, $subject, $encryptedBody, $encryptedCc, $encryptedBcc, $encryptedThread, $encryptedAttachments, $emailDesign, $draftId]);
            if ($update->rowCount() === 0) {
                $exists = $db->prepare('SELECT id FROM email_drafts WHERE id = ? AND deleted_at IS NULL');
                $exists->execute([$draftId]);
                if ($exists->fetchColumn() === false) {
                    data_respond(404, ['error' => 'draft_not_found', 'message' => 'The draft was not found.']);
                }
            }
        } else {
            $db->prepare('INSERT INTO email_drafts (recipient_email, recipient_lead_id, reply_uid, reply_folder, subject, body, cc, bcc, thread_headers, attachments, email_design) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')->execute([
                $recipient, $recipientLeadId, $replyUid, $replyFolder, $subject, $encryptedBody, $encryptedCc, $encryptedBcc, $encryptedThread, $encryptedAttachments, $emailDesign,
            ]);
            $draftId = (int) $db->lastInsertId();
        }
        $responseRecipient = $isOperator && $recipient !== '' ? data_mask_contact_email($recipient) : $recipient;
        data_respond(200, ['saved' => true, 'draft' => [
            'id' => (string) $draftId, 'recipientEmail' => $responseRecipient, 'recipientLeadId' => $recipientLeadId,
            'replyMailbox' => $replyUid === null ? null : ['id' => $replyUid, 'folder' => $replyFolder],
            'subject' => $isOperator ? data_mask_mail_text($subject) : $subject,
            'body' => $isOperator ? data_mask_mail_text($draftBody) : $draftBody,
            'cc' => $isOperator ? [] : $cc, 'bcc' => $isOperator ? [] : $bcc, 'threadHeaders' => $isOperator ? [] : $threadHeaders,
            'attachments' => $isOperator ? [] : $attachments, 'emailDesign' => $emailDesign,
        ]]);
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
        $body = data_read_json(6 * 1024 * 1024);
        $db = data_db();
        $isOperator = ($_SESSION['admin_role'] ?? '') !== 'admin';
        $settings = data_mail_settings();
        if ($settings === [] || empty($settings['verified'])) {
            data_respond(409, ['error' => 'mail_not_configured', 'message' => 'Configure and test the Hostinger connection before sending email.']);
        }
        $recipientDetails = null;
        if ($isOperator || isset($body['leadId']) || isset($body['replyMailbox'])) {
            $recipientDetails = data_agent_mail_recipient($db, $body, $settings);
            $recipient = $recipientDetails['recipient'];
        } else {
            $recipient = strtolower(data_string($body, 'recipientEmail', 254));
        }
        $subject = data_string($body, 'subject', 180);
        $emailDesign = data_string($body, 'emailDesign', 16, false);
        if ($emailDesign === '') {
            $emailDesign = 'plain';
        }
        if (!in_array($emailDesign, ['plain', 'card'], true)) {
            data_respond(400, ['error' => 'invalid_email_design', 'message' => 'Choose either the designed card or plain email layout.']);
        }
        $message = $body['body'] ?? null;
        if (!is_string($message) || trim($message) === '' || strlen($message) > 24000) {
            data_respond(400, ['error' => 'invalid_email_content', 'message' => 'Enter a message of 24,000 bytes or less.']);
        }
        if ($isOperator) {
            $contactDetailTypes = data_contact_detail_types($subject . "\n" . $message);
            if ($contactDetailTypes !== []) {
                data_audit($db, 'security.contact_details_blocked', 'staff', (string) ($_SESSION['staff_id'] ?? 0), [
                    'channel' => 'email',
                    'detectedTypes' => $contactDetailTypes,
                ]);
                data_respond(400, ['error' => 'contact_details_not_allowed', 'message' => 'Agent emails cannot include email addresses or phone-number-like contact details in the subject or message. The administrator has been alerted.']);
            }
            $ccValue = $body['cc'] ?? '';
            $bccValue = $body['bcc'] ?? '';
            $attachmentsValue = $body['attachments'] ?? [];
            if (!is_string($ccValue) || trim($ccValue) !== ''
                || !is_string($bccValue) || trim($bccValue) !== ''
                || !is_array($attachmentsValue) || $attachmentsValue !== []) {
                data_respond(403, ['error' => 'agent_email_restrictions', 'message' => 'Agent emails cannot include additional recipients or attachments.']);
            }
        }
        if (!filter_var($recipient, FILTER_VALIDATE_EMAIL)) {
            data_respond(400, ['error' => 'invalid_recipient', 'message' => 'Enter a valid recipient email address.']);
        }
        if (preg_match('/[\r\n\x00]/', $subject) === 1 || preg_match('/\x00/', $message) === 1) {
            data_respond(400, ['error' => 'invalid_email_content', 'message' => 'The email subject or message contains unsupported characters.']);
        }
        try {
            $cc = data_mail_address_list($body['cc'] ?? '', 'cc');
            $bcc = data_mail_address_list($body['bcc'] ?? '', 'bcc');
            $attachments = data_mail_attachments($body['attachments'] ?? []);
            $threadHeaders = $isOperator
                ? ($recipientDetails['replyUid'] !== null ? $recipientDetails['threadHeaders'] : [])
                : ($recipientDetails !== null && $recipientDetails['replyUid'] !== null
                    ? $recipientDetails['threadHeaders']
                    : data_mail_thread_headers($body['threadHeaders'] ?? []));
        } catch (Throwable $error) {
            $message = match ($error->getMessage()) {
                'attachments_too_large' => 'Attachments must total 4 MB or less.',
                'invalid_attachments' => 'Add up to five valid attachments, each with a supported file name.',
                'too_many_cc', 'too_many_bcc' => 'Use no more than ten addresses in each CC or BCC field.',
                'invalid_cc', 'invalid_bcc' => 'Check the email addresses in the CC and BCC fields.',
                default => 'The reply thread metadata is invalid.',
            };
            data_respond(400, ['error' => 'invalid_email', 'message' => $message]);
        }
        if (count($cc) + count($bcc) > 20) {
            data_respond(400, ['error' => 'too_many_recipients', 'message' => 'Use no more than 20 total CC and BCC addresses.']);
        }
        $db->prepare('INSERT INTO email_activity (recipient_email, subject, body, status, cc, bcc, thread_headers, attachments, sender_staff_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')->execute([
            $recipient,
            $subject,
            data_mail_encrypt_content($message),
            'Queued',
            data_mail_encrypt_content(json_encode($cc, JSON_UNESCAPED_SLASHES) ?: '[]'),
            data_mail_encrypt_content(json_encode($bcc, JSON_UNESCAPED_SLASHES) ?: '[]'),
            data_mail_encrypt_content(json_encode($threadHeaders, JSON_UNESCAPED_SLASHES) ?: '{}'),
            data_mail_encrypt_content(json_encode($attachments, JSON_UNESCAPED_SLASHES) ?: '[]'),
            $isOperator ? (int) ($_SESSION['staff_id'] ?? 0) : null,
        ]);
        $activityId = $db->lastInsertId();
        try {
            $messageId = data_mail_send(
                $settings,
                $recipient,
                $subject,
                data_campaign_plain_text($message),
                null,
                $cc,
                $bcc,
                $threadHeaders,
                $attachments,
                $emailDesign === 'card' ? data_mail_card_html($subject, $message) : data_campaign_html($message)
            );
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
            $references = preg_split('/\s+/', trim($threadHeaders['References'] ?? ''), -1, PREG_SPLIT_NO_EMPTY) ?: [];
            $threadRootMessageId = $references[0] ?? ($threadHeaders['In-Reply-To'] ?? null);
            if (is_string($threadRootMessageId) && strlen($threadRootMessageId) > 998) {
                $threadRootMessageId = null;
            }
            $db->prepare('UPDATE email_activity SET status = ?, message_id = ?, thread_root_message_id = ? WHERE id = ?')
                ->execute(['Sent', $messageId, $threadRootMessageId, $activityId]);
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

    if ($method === 'GET' && $resource === 'email-activity-details') {
        data_require_permission('integrations');
        $id = $_GET['id'] ?? '';
        if (!is_string($id) || !ctype_digit($id)) {
            data_respond(400, ['error' => 'invalid_activity_id', 'message' => 'The selected email activity is invalid.']);
        }
        $statement = data_db()->prepare('SELECT attachments, message_id FROM email_activity WHERE id = ? LIMIT 1');
        $statement->execute([$id]);
        $row = $statement->fetch();
        if (!is_array($row)) {
            data_respond(404, ['error' => 'activity_not_found', 'message' => 'The selected email activity was not found.']);
        }
        $isOperator = ($_SESSION['admin_role'] ?? '') !== 'admin';
        data_respond(200, [
            'attachments' => $isOperator ? [] : (json_decode(data_mail_decrypt_content($row['attachments']), true) ?: []),
            'messageId' => $isOperator ? null : $row['message_id'],
        ]);
    }

    if ($method === 'GET' && $resource === 'email-thread') {
        data_require_permission('integrations');
        $isOperator = ($_SESSION['admin_role'] ?? '') !== 'admin';
        if ($isOperator) {
            $replyId = $_GET['replyId'] ?? '';
            if (!is_string($replyId) || !ctype_digit($replyId)) {
                data_respond(400, ['error' => 'invalid_thread_id', 'message' => 'The selected inbox message is invalid.']);
            }
            try {
                $replyMetadata = data_imap_reply_metadata(data_mail_settings(), $replyId);
            } catch (Throwable $error) {
                error_log('Ambients Hostinger thread metadata lookup failed: ' . $error->getMessage());
                data_respond(502, ['error' => 'mail_thread_unavailable', 'message' => 'The inbox conversation could not be loaded. Refresh the inbox and try again.']);
            }
            $threadReferences = preg_split('/\s+/', trim((string) ($replyMetadata['threadHeaders']['References'] ?? '')), -1, PREG_SPLIT_NO_EMPTY) ?: [];
            $messageId = $threadReferences[0] ?? '';
        } else {
            $messageId = $_GET['messageId'] ?? '';
        }
        if (!is_string($messageId) || strlen($messageId) > 998
            || preg_match('/^<[^<>\r\n]{1,990}>$/', $messageId) !== 1) {
            if ($isOperator) data_respond(200, ['messages' => []]);
            data_respond(400, ['error' => 'invalid_thread_id', 'message' => 'The email conversation reference is invalid.']);
        }
        $statement = data_db()->prepare(
            'SELECT id, recipient_email, subject, body, status, sent_at, cc, bcc, thread_headers, message_id
             FROM email_activity WHERE thread_root_message_id = ? ORDER BY sent_at ASC, id ASC LIMIT 100'
        );
        $statement->execute([$messageId]);
        $rows = $statement->fetchAll();
        data_respond(200, ['messages' => array_map(static function (array $row) use ($isOperator): array {
            $recipient = (string) $row['recipient_email'];
            $body = data_mail_decrypt_content($row['body']);
            if ($isOperator) {
                $recipient = data_mask_contact_email($recipient);
                $body = data_mask_mail_text($body);
            }
            return [
            'id' => (string) $row['id'],
            'recipientEmail' => $recipient,
            'subject' => $isOperator ? data_mask_mail_text((string) $row['subject']) : $row['subject'],
            'body' => $body,
            'cc' => $isOperator ? [] : (json_decode(data_mail_decrypt_content($row['cc']), true) ?: []),
            'bcc' => $isOperator ? [] : (json_decode(data_mail_decrypt_content($row['bcc']), true) ?: []),
            'threadHeaders' => $isOperator ? [] : (json_decode(data_mail_decrypt_content($row['thread_headers']), true) ?: []),
            'messageId' => $isOperator ? null : $row['message_id'],
            'status' => $row['status'],
            'sentAt' => $row['sent_at'],
            ];
        }, $rows)]);
    }

    if ($method === 'GET' && $resource === 'email-activity') {
        data_require_permission('integrations');
        $page = filter_var($_GET['page'] ?? '1', FILTER_VALIDATE_INT);
        $search = $_GET['search'] ?? '';
        if ($page === false || $page < 1 || $page > 100000 || !is_string($search)
            || strlen($search) > 128 || preg_match('/[\r\n\x00]/', $search) === 1) {
            data_respond(400, ['error' => 'invalid_activity_query', 'message' => 'The sent email search or page number is invalid.']);
        }
        $db = data_db();
        $isOperator = ($_SESSION['admin_role'] ?? '') !== 'admin';
        if ($isOperator && data_contains_contact_details($search)) {
            data_respond(400, ['error' => 'invalid_activity_search', 'message' => 'Search sent messages by subject text, not by email addresses or phone numbers.']);
        }
        $where = '';
        $parameters = [];
        if (trim($search) !== '') {
            $where = $isOperator ? ' WHERE subject LIKE ?' : ' WHERE recipient_email LIKE ? OR subject LIKE ?';
            $term = '%' . trim($search) . '%';
            $parameters = $isOperator ? [$term] : [$term, $term];
        }
        $count = $db->prepare('SELECT COUNT(*) FROM email_activity' . $where);
        $count->execute($parameters);
        $total = (int) $count->fetchColumn();
        $statusCounts = $db->query(
            "SELECT
                COALESCE(SUM(status = 'Sent'), 0) AS sent_count,
                COALESCE(SUM(status = 'Failed'), 0) AS failed_count,
                COALESCE(SUM(status = 'Queued'), 0) AS queued_count
             FROM email_activity"
        );
        $counts = $statusCounts->fetch() ?: [];
        $pageCount = max(1, (int) ceil($total / 20));
        $page = min($page, $pageCount);
        $query = $db->prepare(
            'SELECT id, recipient_email, subject, body, status, sent_at, cc, bcc, thread_headers, message_id
             FROM email_activity' . $where . ' ORDER BY id DESC LIMIT 20 OFFSET ' . (($page - 1) * 20)
        );
        $query->execute($parameters);
        $rows = $query->fetchAll();
        data_respond(200, ['messages' => array_map(static function (array $row) use ($isOperator): array {
            $recipient = (string) $row['recipient_email'];
            $body = data_mail_decrypt_content($row['body']);
            if ($isOperator) {
                $recipient = data_mask_contact_email($recipient);
                $body = data_mask_mail_text($body);
            }
            return [
            'id' => (string) $row['id'],
            'recipientEmail' => $recipient,
            'subject' => $isOperator ? data_mask_mail_text((string) $row['subject']) : $row['subject'],
            'body' => $body,
            'cc' => $isOperator ? [] : (json_decode(data_mail_decrypt_content($row['cc']), true) ?: []),
            'bcc' => $isOperator ? [] : (json_decode(data_mail_decrypt_content($row['bcc']), true) ?: []),
            'threadHeaders' => $isOperator ? [] : (json_decode(data_mail_decrypt_content($row['thread_headers']), true) ?: []),
            'messageId' => $isOperator ? null : $row['message_id'],
            'status' => $row['status'],
            'sentAt' => $row['sent_at'],
            ];
        }, $rows), 'total' => $total, 'page' => $page, 'pageSize' => 20,
            'sentCount' => (int) ($counts['sent_count'] ?? 0),
            'failedCount' => (int) ($counts['failed_count'] ?? 0),
            'queuedCount' => (int) ($counts['queued_count'] ?? 0)]);
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
        $campaignStaffId = data_campaign_actor_staff_id();
        $filters = [];
        foreach (['country', 'status', 'source'] as $filter) {
            $filters[$filter] = $_GET[$filter] ?? '';
        }
        try {
            $filters = data_campaign_filters($filters);
        } catch (Throwable $error) {
            data_respond(400, ['error' => 'invalid_campaign_audience', 'message' => 'The campaign audience filter is invalid.']);
        }
        $db = data_db();
        $recipients = data_campaign_recipient_snapshot($db, $filters, $campaignStaffId);
        $facetSql = "SELECT DISTINCT country, status, lead_source
                     FROM leads WHERE marketing_consent = 1 AND TRIM(email) <> ''";
        $facets = $campaignStaffId === null
            ? $db->query($facetSql . ' ORDER BY country, status, lead_source')->fetchAll()
            : (function () use ($db, $facetSql, $campaignStaffId): array {
                $query = $db->prepare($facetSql . ' AND assigned_staff_id = ? ORDER BY country, status, lead_source');
                $query->execute([$campaignStaffId]);
                return $query->fetchAll();
            })();
        data_respond(200, [
            'audienceCount' => count($recipients),
            'audienceLimit' => 5000,
            'countries' => array_values(array_unique(array_filter(array_column($facets, 'country'), static fn ($value): bool => is_string($value) && trim($value) !== ''))),
            'statuses' => array_values(array_unique(array_filter(array_column($facets, 'status'), static fn ($value): bool => is_string($value) && trim($value) !== ''))),
            'sources' => array_values(array_unique(array_filter(array_column($facets, 'lead_source'), static fn ($value): bool => is_string($value) && trim($value) !== ''))),
        ]);
    }

    if ($method === 'GET' && $resource === 'email-campaigns') {
        $campaignStaffId = data_campaign_actor_staff_id();
        $db = data_db();
        $campaignSql = 'SELECT id, name, subject, body, status, scheduled_at, recipient_count, sent_count, failed_count, unsubscribed_count, audience_filter, track_opens, created_at, completed_at,
                    (SELECT COUNT(*) FROM email_campaign_recipients r WHERE r.campaign_id = email_campaigns.id AND r.opened_at IS NOT NULL) AS open_count
             FROM email_campaigns';
        if ($campaignStaffId === null) {
            $rows = $db->query($campaignSql . ' ORDER BY id DESC LIMIT 100')->fetchAll();
        } else {
            $query = $db->prepare($campaignSql . ' WHERE created_by_staff_id = ? ORDER BY id DESC LIMIT 100');
            $query->execute([$campaignStaffId]);
            $rows = $query->fetchAll();
        }
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
            'openCount' => (int) $row['open_count'],
            'audienceFilter' => data_campaign_filters(json_decode(data_mail_decrypt_content($row['audience_filter']), true) ?: []),
            'trackOpens' => (bool) $row['track_opens'],
            'createdAt' => $row['created_at'],
            'completedAt' => $row['completed_at'],
        ], $rows)]);
    }

    if ($method === 'POST' && $resource === 'email-campaign-save') {
        $db = data_db();
        $campaignStaffId = data_campaign_actor_staff_id();
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
        $campaignContactDetailTypes = data_contact_detail_types($subject . "\n" . $message);
        $usesEmailMergeField = preg_match('/\{\{\s*email\s*\}\}/i', $subject . "\n" . $message) === 1;
        if ($campaignStaffId !== null && ($campaignContactDetailTypes !== [] || $usesEmailMergeField)) {
            if ($usesEmailMergeField && !in_array('email', $campaignContactDetailTypes, true)) {
                $campaignContactDetailTypes[] = 'email';
            }
            data_audit($db, 'security.contact_details_blocked', 'staff', (string) $campaignStaffId, [
                'channel' => 'email campaign',
                'detectedTypes' => $campaignContactDetailTypes,
            ]);
            data_respond(400, ['error' => 'contact_details_not_allowed', 'message' => 'Agent campaigns cannot include email addresses or phone-number-like contact details in the subject or message. The administrator has been alerted.']);
        }
        try {
            $audienceFilter = data_campaign_filters($body['audienceFilter'] ?? []);
        } catch (Throwable $error) {
            data_respond(400, ['error' => 'invalid_campaign_audience', 'message' => 'The campaign audience filters are invalid.']);
        }
        $trackOpens = $body['trackOpens'] ?? false;
        if (!is_bool($trackOpens)) data_respond(400, ['error' => 'invalid_campaign_tracking', 'message' => 'Open tracking must be enabled or disabled.']);
        $campaignId = $body['id'] ?? null;
        if ($campaignId === null) {
            $db->prepare('INSERT INTO email_campaigns (name, subject, body, status, audience_filter, track_opens, created_by_staff_id) VALUES (?, ?, ?, ?, ?, ?, ?)')->execute([
                $name,
                $subject,
                data_mail_encrypt_content($message),
                'draft',
                data_mail_encrypt_content(json_encode($audienceFilter, JSON_UNESCAPED_SLASHES) ?: '{}'),
                $trackOpens ? 1 : 0,
                $campaignStaffId,
            ]);
            $campaignId = (string) $db->lastInsertId();
        } else {
            $campaignId = filter_var($campaignId, FILTER_VALIDATE_INT);
            if ($campaignId === false || $campaignId < 1) {
                data_respond(400, ['error' => 'invalid_campaign_id', 'message' => 'The selected campaign is invalid.']);
            }
            $updateSql = "UPDATE email_campaigns SET name = ?, subject = ?, body = ?, audience_filter = ?, track_opens = ? WHERE id = ? AND status = 'draft'";
            if ($campaignStaffId !== null) $updateSql .= ' AND created_by_staff_id = ?';
            $update = $db->prepare($updateSql);
            $parameters = [
                $name,
                $subject,
                data_mail_encrypt_content($message),
                data_mail_encrypt_content(json_encode($audienceFilter, JSON_UNESCAPED_SLASHES) ?: '{}'),
                $trackOpens ? 1 : 0,
                $campaignId,
            ];
            if ($campaignStaffId !== null) $parameters[] = $campaignStaffId;
            $update->execute($parameters);
            $existsSql = "SELECT COUNT(*) FROM email_campaigns WHERE id = ? AND status = 'draft'";
            if ($campaignStaffId !== null) $existsSql .= ' AND created_by_staff_id = ?';
            $exists = $db->prepare($existsSql);
            $exists->execute($campaignStaffId === null ? [$campaignId] : [$campaignId, $campaignStaffId]);
            if ((int) $exists->fetchColumn() !== 1) {
                data_respond(409, ['error' => 'campaign_not_editable', 'message' => 'Only draft campaigns can be edited.']);
            }
        }
        data_respond(200, ['saved' => true, 'campaignId' => (string) $campaignId]);
    }

    if ($method === 'POST' && $resource === 'email-campaign-test-send') {
        data_require_admin('admin');
        $body = data_read_json(32768);
        $subject = $body['subject'] ?? null;
        $message = $body['body'] ?? null;
        if (!is_string($subject) || trim($subject) === '' || strlen($subject) > 180
            || !is_string($message) || trim($message) === '' || strlen($message) > 20000
            || preg_match('/[\r\n\x00]/', $subject) === 1 || preg_match('/\x00/', $message) === 1) {
            data_respond(400, ['error' => 'invalid_campaign', 'message' => 'Enter a valid subject and message before sending a test.']);
        }
        $settings = data_mail_settings();
        if ($settings === [] || empty($settings['verified'])) {
            data_respond(409, ['error' => 'mail_not_verified', 'message' => 'Verify Hostinger SMTP and IMAP before sending a test email.']);
        }
        $sample = ['first_name' => 'Alex', 'last_name' => 'Morgan', 'email' => $settings['emailAccount'], 'country' => 'South Africa'];
        try {
            $renderedSubject = data_campaign_merge_fields($subject, $sample);
            $formattedMessage = data_campaign_merge_fields($message, $sample);
            data_mail_send(
                $settings,
                $settings['emailAccount'],
                $renderedSubject,
                data_campaign_plain_text($formattedMessage),
                null,
                [],
                [],
                [],
                [],
                data_campaign_html($formattedMessage)
            );
        } catch (Throwable $error) {
            error_log('Ambients email campaign test send failed: ' . $error->getMessage());
            data_respond(502, ['error' => 'campaign_test_failed', 'message' => 'The test email was not accepted by Hostinger. Check the mailbox connection and try again.']);
        }
        data_respond(200, ['sent' => true, 'recipient' => $settings['emailAccount'], 'message' => 'Hostinger accepted the test email for sending.']);
    }

    if (in_array($resource, ['email-campaign-launch', 'email-campaign-schedule', 'email-campaign-cancel'], true) && $method === 'POST') {
        $campaignStaffId = data_campaign_actor_staff_id();
        $body = data_read_json(2048);
        $campaignId = filter_var($body['id'] ?? null, FILTER_VALIDATE_INT);
        if ($campaignId === false || $campaignId < 1) {
            data_respond(400, ['error' => 'invalid_campaign_id', 'message' => 'The selected campaign is invalid.']);
        }
        $db = data_db();

        if ($resource === 'email-campaign-cancel') {
            $db->beginTransaction();
            try {
                $findSql = 'SELECT status, created_by_staff_id FROM email_campaigns WHERE id = ?';
                if ($campaignStaffId !== null) $findSql .= ' AND created_by_staff_id = ?';
                $findSql .= ' FOR UPDATE';
                $find = $db->prepare($findSql);
                $find->execute($campaignStaffId === null ? [$campaignId] : [$campaignId, $campaignStaffId]);
                $campaign = $find->fetch();
                if (!is_array($campaign) || $campaign['status'] !== 'scheduled') {
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
        $ownerSql = 'SELECT created_by_staff_id FROM email_campaigns WHERE id = ?';
        if ($campaignStaffId !== null) $ownerSql .= ' AND created_by_staff_id = ?';
        $owner = $db->prepare($ownerSql);
        $owner->execute($campaignStaffId === null ? [$campaignId] : [$campaignId, $campaignStaffId]);
        if ($owner->fetchColumn() === false) {
            data_respond(404, ['error' => 'campaign_not_found', 'message' => 'The campaign was not found.']);
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
        $batch = data_campaign_process_batch($settings, 5, $campaignStaffId === null ? null : $campaignId);
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
        $_SESSION['admin_permissions'] = data_staff_permissions(json_decode((string) $staff['permissions'], true)) ?? [];
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
            'permissions' => ['leads', 'new_leads', 'orders', 'products', 'integrations', 'chat'],
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

if ($method === 'DELETE' && $resource === 'staff') {
    data_require_admin('admin');
    $body = data_read_json();
    $rawIds = $body['ids'] ?? null;
    if (!is_array($rawIds) || $rawIds === [] || count($rawIds) > 100) {
        data_respond(400, ['error' => 'invalid_staff_ids', 'message' => 'Select one or more valid agent accounts to remove.']);
    }
    $staffIds = [];
    foreach ($rawIds as $rawId) {
        $staffId = filter_var($rawId, FILTER_VALIDATE_INT);
        if ($staffId === false || $staffId < 1) {
            data_respond(400, ['error' => 'invalid_staff_ids', 'message' => 'The selected agent accounts are invalid.']);
        }
        $staffIds[] = (int) $staffId;
    }
    $staffIds = array_values(array_unique($staffIds));
    sort($staffIds);
    $placeholders = implode(', ', array_fill(0, count($staffIds), '?'));
    $db = data_db();

    try {
        $db->beginTransaction();
        $findStaff = $db->prepare(
            "SELECT id, email, display_name, role FROM staff_users WHERE id IN ($placeholders) ORDER BY id FOR UPDATE"
        );
        $findStaff->execute($staffIds);
        $staffRows = $findStaff->fetchAll();
        if (count($staffRows) !== count($staffIds)) {
            $db->rollBack();
            data_respond(404, ['error' => 'staff_not_found', 'message' => 'One or more selected agent accounts no longer exist. Refresh the agent list and try again.']);
        }
        foreach ($staffRows as $staffRow) {
            if ($staffRow['role'] !== 'operator' || strcasecmp((string) $staffRow['email'], (string) $_SESSION['admin_email']) === 0
                || (int) $staffRow['id'] === (int) ($_SESSION['staff_id'] ?? 0)) {
                $db->rollBack();
                data_respond(409, ['error' => 'staff_account_protected', 'message' => 'A selected account is protected and cannot be removed.']);
            }
        }

        $unassignedLeads = 0;
        $unassignLeads = $db->prepare('UPDATE leads SET assigned_staff_id = NULL WHERE assigned_staff_id = ?');
        $clearLeadNotifications = $db->prepare('DELETE FROM lead_assignment_notifications WHERE staff_id = ?');
        $findChats = $db->prepare(
            "SELECT id, owner_staff_id FROM chat_conversations WHERE owner_type = 'agent' AND owner_staff_id IN ($placeholders) AND status = 'open' FOR UPDATE"
        );
        $findChats->execute($staffIds);
        $openChats = $findChats->fetchAll();
        $returnChats = $db->prepare(
            "UPDATE chat_conversations SET owner_type = 'queue', owner_staff_id = NULL WHERE owner_type = 'agent' AND owner_staff_id IN ($placeholders) AND status = 'open'"
        );
        $returnChats->execute($staffIds);
        $insertNotice = $db->prepare(
            "INSERT INTO chat_messages (conversation_id, sender_type, sender_name, body)
             VALUES (?, 'system', 'Ambienta support', ?)"
        );
        $staffNames = [];
        foreach ($staffRows as $staffRow) {
            $staffId = (int) $staffRow['id'];
            $staffNames[$staffId] = trim((string) $staffRow['display_name']) ?: 'the assigned agent';
            $unassignLeads->execute([$staffId]);
            $unassignedLeads += $unassignLeads->rowCount();
            $clearLeadNotifications->execute([$staffId]);
            $db->prepare('DELETE FROM staff_presence WHERE staff_id = ?')->execute([$staffId]);
        }
        foreach ($openChats as $chat) {
            $name = $staffNames[(int) $chat['owner_staff_id']] ?? 'the assigned agent';
            $insertNotice->execute([
                (int) $chat['id'],
                'This conversation was returned to the shared queue because ' . $name . '\'s account was removed.',
            ]);
        }
        $returnedChats = count($openChats);

        foreach ($staffRows as $staffRow) {
            data_audit($db, 'staff.deleted', 'staff', (string) $staffRow['id'], [
                'email' => $staffRow['email'],
                'displayName' => $staffRow['display_name'],
            ]);
        }
        $deleteStaff = $db->prepare("DELETE FROM staff_users WHERE id IN ($placeholders)");
        $deleteStaff->execute($staffIds);
        if ($deleteStaff->rowCount() !== count($staffIds)) {
            throw new RuntimeException('staff_delete_incomplete');
        }
        $db->commit();
        data_respond(200, [
            'deleted' => count($staffIds),
            'unassignedLeads' => $unassignedLeads,
            'returnedChats' => $returnedChats,
        ]);
    } catch (Throwable $error) {
        if ($db->inTransaction()) $db->rollBack();
        error_log('Ambients staff account removal failed: ' . $error->getMessage());
        data_respond(500, ['error' => 'staff_delete_failed', 'message' => 'The selected agent accounts could not be removed.']);
    }
}

if ($method === 'GET') {
    data_require_admin();
    $db = data_db();
    if ($resource === 'visitor-sessions') {
        data_require_permission('chat');
        $sessionId = data_string($_GET, 'session', 64, false);
        if ($sessionId !== '') {
            if (preg_match('/^[a-f0-9]{64}$/', $sessionId) !== 1) {
                data_respond(400, ['error' => 'invalid_visitor_session', 'message' => 'The visitor session identifier is invalid.']);
            }
            $find = $db->prepare(
                'SELECT s.session_token_hash, s.visitor_token_hash, s.current_path, s.referrer_domain, s.country_code, s.language, s.first_seen, s.last_seen,
                        current_view.page_title AS current_title, current_view.product_id AS current_product_id,
                        current_product.name AS current_product_name,
                        cc.id AS chat_id, cc.status AS chat_status, cc.owner_type, cc.owner_staff_id, owner.display_name AS chat_owner_name
                 FROM visitor_sessions s
                 LEFT JOIN visitor_page_views current_view ON current_view.id = (
                     SELECT pv.id FROM visitor_page_views pv WHERE pv.session_token_hash = s.session_token_hash ORDER BY pv.id DESC LIMIT 1
                 )
                 LEFT JOIN products current_product ON current_product.id = current_view.product_id
                 LEFT JOIN chat_conversations cc ON cc.id = (
                     SELECT c.id FROM chat_conversations c WHERE c.visitor_id_hash = s.visitor_token_hash ORDER BY c.updated_at DESC, c.id DESC LIMIT 1
                 )
                 LEFT JOIN staff_users owner ON owner.id = cc.owner_staff_id
                 WHERE s.session_token_hash = ? LIMIT 1'
            );
            $find->execute([$sessionId]);
            $session = $find->fetch();
            if (!is_array($session)) {
                data_respond(404, ['error' => 'visitor_session_not_found', 'message' => 'This visitor session is no longer available.']);
            }
            $views = $db->prepare(
                'SELECT pv.page_path AS path, pv.page_title AS title, pv.product_id AS productId, p.name AS productName,
                        pv.dwell_seconds AS dwellSeconds, pv.viewed_at AS viewedAt
                 FROM visitor_page_views pv LEFT JOIN products p ON p.id = pv.product_id
                 WHERE pv.session_token_hash = ? ORDER BY pv.id DESC LIMIT 50'
            );
            $views->execute([$sessionId]);
            data_respond(200, [
                'session' => [
                    'id' => $session['session_token_hash'],
                    'visitorId' => substr((string) $session['visitor_token_hash'], 0, 10),
                    'currentPath' => $session['current_path'],
                    'currentTitle' => $session['current_title'] ?: $session['current_path'],
                    'currentProduct' => $session['current_product_name'] ?: $session['current_product_id'],
                    'referrerDomain' => $session['referrer_domain'],
                    'countryCode' => $session['country_code'],
                    'language' => $session['language'],
                    'firstSeen' => $session['first_seen'],
                    'lastSeen' => $session['last_seen'],
                    'active' => strtotime((string) $session['last_seen'] . ' UTC') >= time() - 90,
                    'durationSeconds' => data_visitor_session_duration((string) $session['first_seen'], (string) $session['last_seen']),
                    'chatId' => $session['chat_id'] === null ? null : (int) $session['chat_id'],
                    'chatStatus' => $session['chat_status'],
                    'chatOwner' => $session['owner_type'] === 'queue' ? 'Waiting for staff' : ($session['owner_type'] === 'admin' ? 'Administrator' : ($session['chat_owner_name'] ?: 'Agent')),
                    'chatEngaged' => $session['owner_type'] !== null && $session['owner_type'] !== 'queue',
                ],
                'pages' => array_reverse($views->fetchAll()),
            ]);
        }

        $filter = data_string($_GET, 'status', 8, false);
        if ($filter === '') $filter = 'recent';
        if (!in_array($filter, ['active', 'recent'], true)) {
            data_respond(400, ['error' => 'invalid_visitor_filter', 'message' => 'Choose active or recent visitor sessions.']);
        }
        $where = $filter === 'active'
            ? 'WHERE s.last_seen >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 90 SECOND)'
            : 'WHERE s.last_seen >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR)';
        $activeSummary = $db->query(
            'SELECT COUNT(*) AS sessions, COUNT(DISTINCT visitor_token_hash) AS visitors
             FROM visitor_sessions WHERE last_seen >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 90 SECOND)'
        )->fetch();
        $recentSummary = $db->query(
            'SELECT COUNT(*) AS sessions, COUNT(DISTINCT visitor_token_hash) AS visitors
             FROM visitor_sessions WHERE last_seen >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR)'
        )->fetch();
        $query = $db->query(
            'SELECT s.session_token_hash, s.visitor_token_hash, s.current_path, s.referrer_domain, s.country_code, s.language,
                    s.first_seen, s.last_seen,
                    current_view.page_title AS current_title, current_view.product_id AS current_product_id, current_product.name AS current_product_name,
                    (SELECT COUNT(*) FROM visitor_page_views pv WHERE pv.session_token_hash = s.session_token_hash) AS page_count,
                    cc.id AS chat_id, cc.status AS chat_status, cc.owner_type, cc.owner_staff_id, owner.display_name AS chat_owner_name
             FROM visitor_sessions s
             LEFT JOIN visitor_page_views current_view ON current_view.id = (
                 SELECT pv.id FROM visitor_page_views pv WHERE pv.session_token_hash = s.session_token_hash ORDER BY pv.id DESC LIMIT 1
             )
             LEFT JOIN products current_product ON current_product.id = current_view.product_id
             LEFT JOIN chat_conversations cc ON cc.id = (
                 SELECT c.id FROM chat_conversations c WHERE c.visitor_id_hash = s.visitor_token_hash ORDER BY c.updated_at DESC, c.id DESC LIMIT 1
             )
             LEFT JOIN staff_users owner ON owner.id = cc.owner_staff_id
             ' . $where . ' ORDER BY s.last_seen DESC LIMIT 200'
        );
        data_respond(200, [
            'sessions' => array_map(static fn (array $row): array => [
                'id' => $row['session_token_hash'],
                'visitorId' => substr((string) $row['visitor_token_hash'], 0, 10),
                'currentPath' => $row['current_path'],
                'currentTitle' => $row['current_title'] ?: $row['current_path'],
                'currentProduct' => $row['current_product_name'] ?: $row['current_product_id'],
                'referrerDomain' => $row['referrer_domain'],
                'countryCode' => $row['country_code'],
                'language' => $row['language'],
                'firstSeen' => $row['first_seen'],
                'lastSeen' => $row['last_seen'],
                'active' => strtotime((string) $row['last_seen'] . ' UTC') >= time() - 90,
                'pageCount' => (int) $row['page_count'],
                'durationSeconds' => data_visitor_session_duration((string) $row['first_seen'], (string) $row['last_seen']),
                'chatId' => $row['chat_id'] === null ? null : (int) $row['chat_id'],
                'chatStatus' => $row['chat_status'],
                'chatOwner' => $row['owner_type'] === 'queue' ? 'Waiting for staff' : ($row['owner_type'] === 'admin' ? 'Administrator' : ($row['chat_owner_name'] ?: 'Agent')),
                'chatEngaged' => $row['owner_type'] !== null && $row['owner_type'] !== 'queue',
            ], $query->fetchAll()),
            'summary' => [
                'activeSessions' => (int) ($activeSummary['sessions'] ?? 0),
                'activeVisitors' => (int) ($activeSummary['visitors'] ?? 0),
                'recentSessions' => (int) ($recentSummary['sessions'] ?? 0),
                'recentVisitors' => (int) ($recentSummary['visitors'] ?? 0),
            ],
        ]);
    }
    if ($resource === 'chat-admin') {
        data_require_permission('chat');
        $isPrimaryAdmin = ($_SESSION['admin_role'] ?? '') === 'admin';
        $staffId = (int) ($_SESSION['staff_id'] ?? 0);
        $agentsMayClaim = data_chat_agents_can_claim($db);
        $conversationValue = data_string($_GET, 'conversation', 20, false);
        if ($conversationValue !== '') {
            $conversationId = filter_var($conversationValue, FILTER_VALIDATE_INT);
            if ($conversationId === false || $conversationId < 1) {
                data_respond(400, ['error' => 'invalid_chat_id', 'message' => 'The conversation identifier is invalid.']);
            }
            $find = $db->prepare(
                'SELECT c.id, c.visitor_name, c.visitor_email, c.visitor_phone, c.status, c.created_at, c.updated_at,
                        c.owner_type, c.owner_staff_id, owner.display_name AS owner_name
                 FROM chat_conversations c LEFT JOIN staff_users owner ON owner.id = c.owner_staff_id
                 WHERE c.id = ? LIMIT 1'
            );
            $find->execute([(int) $conversationId]);
            $conversation = $find->fetch();
            if (!is_array($conversation)) {
                data_respond(404, ['error' => 'chat_not_found', 'message' => 'The conversation could not be found.']);
            }
            if (!$isPrimaryAdmin && !data_chat_conversation_accessible($db, $conversation)) {
                data_respond(404, ['error' => 'chat_not_found', 'message' => 'This conversation is not available to your account.']);
            }
            $db->prepare(
                "UPDATE chat_messages SET read_at = UTC_TIMESTAMP() WHERE conversation_id = ? AND sender_type = 'visitor' AND read_at IS NULL"
            )->execute([(int) $conversationId]);
            data_respond(200, [
                'conversation' => [
                    'id' => (int) $conversation['id'],
                    'visitorName' => $conversation['visitor_name'],
                    'visitorEmail' => $conversation['visitor_email'],
                    'visitorPhone' => $conversation['visitor_phone'],
                    'status' => $conversation['status'],
                    'createdAt' => $conversation['created_at'],
                    'updatedAt' => $conversation['updated_at'],
                    'ownerType' => $conversation['owner_type'],
                    'ownerStaffId' => $conversation['owner_staff_id'] === null ? null : (int) $conversation['owner_staff_id'],
                    'ownerName' => $conversation['owner_type'] === 'queue' ? 'Waiting for staff' : ($conversation['owner_type'] === 'admin' ? 'Administrator' : ($conversation['owner_name'] ?: 'Agent')),
                    'canClaim' => !$isPrimaryAdmin && $conversation['owner_type'] !== 'agent' && $conversation['status'] === 'open' && $agentsMayClaim,
                ],
                'messages' => data_chat_message_rows($db, (int) $conversationId),
            ]);
        }

        $status = data_string($_GET, 'status', 8, false);
        if ($status === '') $status = 'open';
        if (!in_array($status, ['open', 'closed', 'all'], true)) {
            data_respond(400, ['error' => 'invalid_chat_status', 'message' => 'Choose open, closed, or all conversations.']);
        }
        $search = data_string($_GET, 'q', 100, false);
        $where = [];
        $parameters = [];
        if ($status !== 'all') {
            $where[] = 'c.status = ?';
            $parameters[] = $status;
        }
        if ($search !== '') {
            $where[] = '(c.visitor_name LIKE ? OR c.visitor_email LIKE ? OR c.visitor_phone LIKE ?)';
            $parameters[] = '%' . $search . '%';
            $parameters[] = '%' . $search . '%';
            $parameters[] = '%' . $search . '%';
        }
        if (!$isPrimaryAdmin) {
            $where[] = "((c.owner_type = 'agent' AND c.owner_staff_id = ?) OR (c.owner_type IN ('queue', 'admin') AND c.status = 'open' AND ? = 1))";
            $parameters[] = $staffId;
            $parameters[] = (int) $agentsMayClaim;
        }
        $whereSql = $where === [] ? '' : ' WHERE ' . implode(' AND ', $where);
        $query = $db->prepare(
            'SELECT c.id, c.visitor_name, c.visitor_email, c.visitor_phone, c.status, c.created_at, c.updated_at,
                    c.owner_type, c.owner_staff_id, owner.display_name AS owner_name,
                    (SELECT body FROM chat_messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) AS last_message,
                    (SELECT sender_type FROM chat_messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) AS last_sender,
                    (SELECT COUNT(*) FROM chat_messages WHERE conversation_id = c.id AND sender_type = \'visitor\' AND read_at IS NULL) AS unread_count
             FROM chat_conversations c LEFT JOIN staff_users owner ON owner.id = c.owner_staff_id' . $whereSql . ' ORDER BY c.updated_at DESC, c.id DESC LIMIT 100'
        );
        $query->execute($parameters);
        $assignableAgents = [];
        if ($isPrimaryAdmin) {
            $staffRows = $db->query('SELECT id, display_name, email, permissions FROM staff_users WHERE is_active = 1 ORDER BY display_name, email')->fetchAll();
            foreach ($staffRows as $staffRow) {
                $permissions = data_staff_permissions(json_decode((string) $staffRow['permissions'], true));
                if ($permissions !== null && in_array('chat', $permissions, true)) {
                    $assignableAgents[] = [
                        'id' => (int) $staffRow['id'],
                        'displayName' => $staffRow['display_name'] ?: $staffRow['email'],
                    ];
                }
            }
        }
        data_respond(200, ['conversations' => array_map(static fn (array $row): array => [
            'id' => (int) $row['id'],
            'visitorName' => $row['visitor_name'],
            'visitorEmail' => $row['visitor_email'],
            'visitorPhone' => $row['visitor_phone'],
            'status' => $row['status'],
            'createdAt' => $row['created_at'],
            'updatedAt' => $row['updated_at'],
            'lastMessage' => $row['last_message'],
            'lastSender' => $row['last_sender'],
            'unreadCount' => (int) $row['unread_count'],
            'ownerType' => $row['owner_type'],
            'ownerStaffId' => $row['owner_staff_id'] === null ? null : (int) $row['owner_staff_id'],
            'ownerName' => $row['owner_type'] === 'queue' ? 'Waiting for staff' : ($row['owner_type'] === 'admin' ? 'Administrator' : ($row['owner_name'] ?: 'Agent')),
            'canClaim' => !$isPrimaryAdmin && $row['owner_type'] !== 'agent' && $row['status'] === 'open' && $agentsMayClaim,
        ], $query->fetchAll()), 'adminOnline' => data_chat_admin_online($db), 'agentsMayClaimWhenAdminOnline' => $agentsMayClaim && data_chat_admin_online($db), 'assignableAgents' => $assignableAgents]);
    }
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
            data_require_lead_access($db, (int) $id, true);
            $find = $db->prepare(
                'SELECT l.id, l.first_name, l.last_name, l.email, l.phone, l.country, l.address, l.postal_code, l.lead_source, l.status, l.marketing_consent, l.marketing_consent_at, l.created_at,
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
            $historicalOrders = [];
            $sourceRecords = [];
            if ($canViewOrders) {
                $orderQuery = $db->prepare('SELECT * FROM orders WHERE email = ? ORDER BY placed_at DESC LIMIT 100');
                $orderQuery->execute([$lead['email']]);
                $orders = array_map(static fn (array $row): array => data_staff_order_row($db, $row), $orderQuery->fetchAll());
                $historyQuery = $db->prepare(
                    'SELECT id, order_number, placed_at, items, tracking_number, carrier, delivery_address, source_sheet
                     FROM lead_order_history WHERE lead_id = ? ORDER BY placed_at DESC, id DESC LIMIT 100'
                );
                $historyQuery->execute([$id]);
                $historicalOrders = array_map(static fn (array $row): array => [
                    'id' => (int) $row['id'],
                    'orderNumber' => $row['order_number'],
                    'placedAt' => $row['placed_at'],
                    'items' => (string) ($row['items'] ?? ''),
                    'trackingNumber' => $row['tracking_number'],
                    'carrier' => $row['carrier'],
                    'deliveryAddress' => $row['delivery_address'],
                    'sourceSheet' => $row['source_sheet'],
                ], $historyQuery->fetchAll());
            }
            if (($_SESSION['admin_role'] ?? '') === 'admin') {
                $sourceQuery = $db->prepare(
                    'SELECT id, source_file, source_sheet, source_row, data
                     FROM lead_source_records WHERE lead_id = ? ORDER BY source_file, source_sheet, source_row, id LIMIT 500'
                );
                $sourceQuery->execute([$id]);
                $sourceRecords = array_map('data_lead_source_record_row', $sourceQuery->fetchAll());
            }
            data_respond(200, [
                'lead' => data_lead_row($lead),
                'orders' => $orders,
                'historicalOrders' => $historicalOrders,
                'sourceRecords' => $sourceRecords,
                'activities' => data_lead_activities($db, (int) $id),
            ]);
        }
        $listSql = 'SELECT l.id, l.first_name, l.last_name, l.email, l.phone, l.country, l.address, l.postal_code, l.lead_source, l.status, l.marketing_consent, l.marketing_consent_at, l.created_at,
                    l.assigned_staff_id, (SELECT display_name FROM staff_users WHERE id = l.assigned_staff_id) AS assigned_staff_name,
                    COUNT(o.id) AS order_count, MAX(o.placed_at) AS last_order_at,
                    COUNT(CASE WHEN o.status <> \'Cancelled\' THEN 1 END) AS active_order_count,
                    (SELECT COUNT(*) FROM lead_activities la WHERE la.lead_id = l.id AND la.activity_type = \'call\') AS call_count
             FROM leads l LEFT JOIN orders o ON o.email = l.email';
        if (($_SESSION['admin_role'] ?? '') === 'operator') {
            $canViewNewLeads = in_array('new_leads', $_SESSION['admin_permissions'] ?? [], true);
            $listSql .= $canViewNewLeads
                ? " WHERE l.assigned_staff_id = ? OR (l.assigned_staff_id IS NULL AND l.status = 'New')"
                : ' WHERE l.assigned_staff_id = ?';
            $listSql .= ' GROUP BY l.id ORDER BY l.id DESC';
            $listQuery = $db->prepare($listSql);
            $listQuery->execute([(int) ($_SESSION['staff_id'] ?? 0)]);
            $rows = $listQuery->fetchAll();
        } else {
            $rows = $db->query($listSql . ' GROUP BY l.id ORDER BY l.id DESC')->fetchAll();
        }
        data_respond(200, ['leads' => array_map('data_lead_row', $rows)]);
    }
    if ($resource === 'lead-assignment-notifications') {
        data_require_permission('leads');
        $staffId = (int) ($_SESSION['staff_id'] ?? 0);
        if (($_SESSION['admin_role'] ?? '') !== 'operator' || $staffId < 1) {
            data_respond(200, ['notifications' => []]);
        }
        $query = $db->prepare(
            'SELECT n.id, n.lead_id, n.assigned_by_name, n.assigned_at,
                    l.first_name, l.last_name, l.status
             FROM lead_assignment_notifications n
             INNER JOIN leads l ON l.id = n.lead_id
             WHERE n.staff_id = ? AND n.read_at IS NULL AND l.assigned_staff_id = n.staff_id
             ORDER BY n.id DESC LIMIT 50'
        );
        $query->execute([$staffId]);
        $notifications = array_map(static fn (array $row): array => [
            'id' => (int) $row['id'],
            'leadId' => (int) $row['lead_id'],
            'firstName' => (string) $row['first_name'],
            'lastName' => (string) $row['last_name'],
            'status' => (string) $row['status'],
            'assignedByName' => (string) $row['assigned_by_name'],
            'assignedAt' => (string) $row['assigned_at'],
        ], $query->fetchAll());
        data_respond(200, ['notifications' => $notifications]);
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
            data_respond(200, ['order' => data_staff_order_row($db, $order)]);
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
            'orders' => array_map(static fn (array $row): array => data_staff_order_row($db, $row), $rows),
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
    if ($resource === 'security-alerts') {
        data_require_admin('admin');
        $afterId = null;
        if (isset($_GET['afterId'])) {
            $afterId = filter_var($_GET['afterId'], FILTER_VALIDATE_INT);
            if ($afterId === false || $afterId < 0) {
                data_respond(400, ['error' => 'invalid_alert_cursor', 'message' => 'The security alert cursor is invalid.']);
            }
        }
        if ($afterId === null) {
            $rows = $db->query(
                "SELECT id, actor_email, entity_id, details, created_at
                 FROM admin_audit_log
                 WHERE action = 'security.contact_details_blocked'
                 ORDER BY id DESC LIMIT 50"
            )->fetchAll();
            $rows = array_reverse($rows);
        } else {
            $statement = $db->prepare(
                "SELECT id, actor_email, entity_id, details, created_at
                 FROM admin_audit_log
                 WHERE action = 'security.contact_details_blocked' AND id > ?
                 ORDER BY id ASC LIMIT 50"
            );
            $statement->execute([$afterId]);
            $rows = $statement->fetchAll();
        }
        foreach ($rows as &$row) {
            $row['details'] = $row['details'] === null ? null : json_decode($row['details'], true);
        }
        unset($row);
        data_respond(200, ['alerts' => $rows]);
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
            $presenceQuery = $db->prepare(
                'SELECT session_started_at, last_seen_at, current_section
                 FROM staff_presence WHERE staff_id = ? LIMIT 1'
            );
            $presenceQuery->execute([$staffId]);
            $presence = $presenceQuery->fetch();
            $now = time();
            $sessionStartedAt = is_array($presence) ? (string) $presence['session_started_at'] : null;
            $lastSeenAt = is_array($presence) ? (string) $presence['last_seen_at'] : null;
            $sessionStartedTimestamp = $sessionStartedAt !== null ? strtotime($sessionStartedAt . ' UTC') : false;
            $lastSeenTimestamp = $lastSeenAt !== null ? strtotime($lastSeenAt . ' UTC') : false;
            $isOnline = (bool) $staffProfile['is_active']
                && $lastSeenTimestamp !== false
                && $lastSeenTimestamp >= $now - 120;
            $staffProfile['presence'] = [
                'online' => $isOnline,
                'durationSeconds' => $isOnline && $sessionStartedTimestamp !== false
                    ? max(0, $now - $sessionStartedTimestamp)
                    : 0,
                'lastSessionDurationSeconds' => !$isOnline && $sessionStartedTimestamp !== false && $lastSeenTimestamp !== false
                    ? max(0, $lastSeenTimestamp - $sessionStartedTimestamp)
                    : 0,
                'sessionStartedAt' => $sessionStartedAt,
                'lastSeenAt' => $lastSeenAt,
                'currentSection' => $isOnline ? $presence['current_section'] : null,
            ];
            $emailActivity = $db->prepare(
                'SELECT id, recipient_email, subject, body, status, sent_at
                 FROM email_activity WHERE sender_staff_id = ? ORDER BY id DESC LIMIT 500'
            );
            $emailActivity->execute([$staffId]);
            $staffProfile['sentEmails'] = array_map(static function (array $email): array {
                return [
                    'id' => (int) $email['id'],
                    'recipientEmail' => $email['recipient_email'],
                    'subject' => $email['subject'],
                    'bodyPreview' => substr(data_campaign_plain_text(data_mail_decrypt_content($email['body'])), 0, 360),
                    'status' => $email['status'],
                    'sentAt' => $email['sent_at'],
                ];
            }, $emailActivity->fetchAll());
            $staffActivity = $db->prepare(
                "SELECT a.id, a.action, a.entity_type, a.entity_id, a.details, a.created_at,
                        o.order_number, o.customer_name, o.total_amount, o.status AS order_status
                 FROM admin_audit_log a
                 LEFT JOIN orders o ON a.entity_type = 'order' AND a.entity_id = o.id
                 WHERE LOWER(a.actor_email) = LOWER(?)
                    OR (a.entity_type = 'staff' AND a.entity_id = ?)
                    OR LOWER(CASE WHEN JSON_VALID(a.details)
                        THEN JSON_UNQUOTE(JSON_EXTRACT(a.details, '$.actingAs'))
                        ELSE NULL END) = LOWER(?)
                 ORDER BY a.id DESC LIMIT 500"
            );
            $staffActivity->execute([(string) $staffProfile['email'], (string) $staffId, (string) $staffProfile['email']]);
            $staffProfile['activity'] = array_map(static function (array $activity): array {
                return [
                    'id' => (int) $activity['id'],
                    'action' => $activity['action'],
                    'entityType' => $activity['entity_type'],
                    'entityId' => $activity['entity_id'],
                    'details' => $activity['details'] === null ? null : json_decode($activity['details'], true),
                    'createdAt' => $activity['created_at'],
                    'order' => $activity['order_number'] === null ? null : [
                        'orderNumber' => $activity['order_number'],
                        'customerName' => $activity['customer_name'],
                        'totalAmount' => (float) $activity['total_amount'],
                        'status' => $activity['order_status'],
                    ],
                ];
            }, $staffActivity->fetchAll());
            $leadActivities = $db->prepare(
                'SELECT id, lead_id, activity_type, created_at
                 FROM lead_activities WHERE LOWER(author_email) = LOWER(?) ORDER BY id DESC LIMIT 500'
            );
            $leadActivities->execute([(string) $staffProfile['email']]);
            foreach ($leadActivities->fetchAll() as $activity) {
                $staffProfile['activity'][] = [
                    'id' => 'lead-' . (int) $activity['id'],
                    'action' => 'lead.activity_' . $activity['activity_type'],
                    'entityType' => 'lead',
                    'entityId' => (string) $activity['lead_id'],
                    'details' => null,
                    'createdAt' => $activity['created_at'],
                    'order' => null,
                ];
            }
            usort($staffProfile['activity'], static fn (array $left, array $right): int =>
                strcmp((string) $right['createdAt'], (string) $left['createdAt'])
            );
            $staffProfile['activity'] = array_slice($staffProfile['activity'], 0, 500);
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
    if ($resource === 'staff-presence') {
        data_require_admin('admin');
        $rows = $db->query(
            'SELECT s.id, s.display_name, s.email, s.is_active, p.session_started_at, p.last_seen_at, p.current_section
             FROM staff_users s LEFT JOIN staff_presence p ON p.staff_id = s.id
             ORDER BY s.display_name, s.email'
        )->fetchAll();
        $now = time();
        data_respond(200, [
            'admin' => (static function () use ($db, $now): array {
                $row = $db->query("SELECT session_started_at, last_seen_at, current_section FROM staff_presence WHERE staff_id = 0 LIMIT 1")->fetch();
                $online = is_array($row) && strtotime((string) $row['last_seen_at'] . ' UTC') >= $now - 120;
                return [
                    'online' => $online,
                    'durationSeconds' => $online ? max(0, $now - strtotime((string) $row['session_started_at'] . ' UTC')) : 0,
                    'currentSection' => $online ? $row['current_section'] : null,
                ];
            })(),
            'staff' => array_map(static function (array $row) use ($now): array {
                $lastSeen = is_string($row['last_seen_at']) ? strtotime($row['last_seen_at'] . ' UTC') : false;
                $online = $lastSeen !== false && $lastSeen >= $now - 120 && (bool) $row['is_active'];
                return [
                    'id' => (int) $row['id'],
                    'displayName' => $row['display_name'],
                    'email' => $row['email'],
                    'active' => (bool) $row['is_active'],
                    'online' => $online,
                    'durationSeconds' => $online && is_string($row['session_started_at'])
                        ? max(0, $now - strtotime($row['session_started_at'] . ' UTC'))
                        : 0,
                    'currentSection' => $online ? $row['current_section'] : null,
                    'lastSeenAt' => $row['last_seen_at'],
                ];
            }, $rows),
        ]);
    }
    if ($resource === 'crm-routing-settings') {
        data_require_admin('admin');
        $allowAgents = $db->query(
            "SELECT setting_value FROM crm_routing_settings
             WHERE setting_key = 'agents_may_claim_chat_when_admin_online' LIMIT 1"
        )->fetchColumn() === '1';
        data_respond(200, ['agentsMayClaimWhenAdminOnline' => $allowAgents]);
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
                $canViewNewLeads = in_array('new_leads', $_SESSION['admin_permissions'] ?? [], true);
                $leadCountQuery = $db->prepare($canViewNewLeads
                    ? "SELECT COUNT(*) FROM leads WHERE assigned_staff_id = ? OR (assigned_staff_id IS NULL AND status = 'New')"
                    : 'SELECT COUNT(*) FROM leads WHERE assigned_staff_id = ?');
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
            'recentOrders' => array_map(static fn (array $row): array => data_staff_order_row($db, $row), $recent),
        ]);
    }
    data_respond(404, ['error' => 'not_found', 'message' => 'The requested resource was not found.']);
}

if ($method === 'POST' && $resource === 'staff-presence') {
    data_require_admin();
    $body = data_read_json(2048);
    $section = data_string($body, 'section', 32);
    $validSections = ['overview', 'orders', 'inventory', 'leads', 'chat', 'email', 'integrations', 'profile', 'staff', 'audit'];
    if (!in_array($section, $validSections, true)) {
        data_respond(400, ['error' => 'invalid_presence_section', 'message' => 'Choose a valid CRM section.']);
    }
    if (($_SESSION['admin_role'] ?? '') !== 'admin') {
        $sectionPermissions = ['orders' => 'orders', 'inventory' => 'products', 'leads' => 'leads', 'chat' => 'chat', 'email' => 'integrations', 'integrations' => 'integrations'];
        if (in_array($section, ['staff', 'audit'], true)
            || (isset($sectionPermissions[$section]) && !in_array($sectionPermissions[$section], $_SESSION['admin_permissions'] ?? [], true))) {
            data_respond(403, ['error' => 'invalid_presence_section', 'message' => 'You cannot report activity in that CRM section.']);
        }
    }
    $presenceId = ($_SESSION['admin_role'] ?? '') === 'admin' ? 0 : (int) ($_SESSION['staff_id'] ?? 0);
    if ($presenceId < 0 || ($presenceId === 0 && ($_SESSION['admin_role'] ?? '') !== 'admin')) {
        data_respond(401, ['error' => 'invalid_staff_session', 'message' => 'Sign in again to update your presence.']);
    }
    $db = data_db();
    $db->beginTransaction();
    try {
        $db->query(
            "SELECT setting_value FROM crm_routing_settings
             WHERE setting_key = 'agents_may_claim_chat_when_admin_online' FOR UPDATE"
        )->fetchColumn();
        $upsert = $db->prepare(
            'INSERT INTO staff_presence (staff_id, session_started_at, last_seen_at, current_section)
             VALUES (?, UTC_TIMESTAMP(), UTC_TIMESTAMP(), ?)
             ON DUPLICATE KEY UPDATE
                session_started_at = IF(last_seen_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 120 SECOND), UTC_TIMESTAMP(), session_started_at),
                last_seen_at = UTC_TIMESTAMP(),
                current_section = VALUES(current_section)'
        );
        $upsert->execute([$presenceId, $section]);
        $db->commit();
    } catch (Throwable $error) {
        if ($db->inTransaction()) $db->rollBack();
        error_log('Ambients staff presence could not be updated: ' . $error->getMessage());
        data_respond(503, ['error' => 'staff_presence_unavailable', 'message' => 'Staff presence is temporarily unavailable.']);
    }
    data_respond(204, []);
}

if ($method === 'POST' && $resource === 'crm-routing-settings') {
    data_require_admin('admin');
    $body = data_read_json(2048);
    if (!isset($body['agentsMayClaimWhenAdminOnline']) || !is_bool($body['agentsMayClaimWhenAdminOnline'])) {
        data_respond(400, ['error' => 'invalid_routing_setting', 'message' => 'Choose whether chat-enabled agents may claim chats while the administrator is online.']);
    }
    $db = data_db();
    $db->prepare(
        "INSERT INTO crm_routing_settings (setting_key, setting_value)
         VALUES ('agents_may_claim_chat_when_admin_online', ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)"
    )->execute([$body['agentsMayClaimWhenAdminOnline'] ? '1' : '0']);
    data_audit($db, 'chat.routing_setting_updated', 'chat', 'routing', [
        'agentsMayClaimWhenAdminOnline' => $body['agentsMayClaimWhenAdminOnline'],
    ]);
    data_respond(200, ['agentsMayClaimWhenAdminOnline' => $body['agentsMayClaimWhenAdminOnline']]);
}

if ($method === 'POST' && $resource === 'chat-admin') {
    data_require_permission('chat');
    $body = data_read_json(4096);
    $action = data_string($body, 'action', 16);
    $conversationId = filter_var($body['conversation'] ?? null, FILTER_VALIDATE_INT);
    if ($conversationId === false || $conversationId < 1) {
        data_respond(400, ['error' => 'invalid_chat_id', 'message' => 'The conversation identifier is invalid.']);
    }

    $db = data_db();
    $db->beginTransaction();
    try {
        $isPrimaryAdmin = ($_SESSION['admin_role'] ?? '') === 'admin';
        $staffId = (int) ($_SESSION['staff_id'] ?? 0);
        $staffName = trim((string) ($_SESSION['admin_display_name'] ?? ''));
        if ($staffName === '') $staffName = (string) ($_SESSION['admin_email'] ?? 'Ambients team');
        $assignedStaffId = null;
        $agent = null;

        if ($action === 'claim') {
            $claimingAgent = $db->prepare('SELECT is_active, permissions FROM staff_users WHERE id = ? FOR UPDATE');
            $claimingAgent->execute([$staffId]);
            $agentAccount = $claimingAgent->fetch();
            $agentPermissions = is_array($agentAccount)
                ? data_staff_permissions(json_decode((string) $agentAccount['permissions'], true))
                : null;
            if ($isPrimaryAdmin || !is_array($agentAccount) || !(bool) $agentAccount['is_active']
                || $agentPermissions === null || !in_array('chat', $agentPermissions, true)) {
                $db->rollBack();
                data_respond(403, ['error' => 'chat_permission_required', 'message' => 'An active account with Live chat permission is required to claim chats.']);
            }
            $db->query(
                "SELECT setting_value FROM crm_routing_settings
                 WHERE setting_key = 'agents_may_claim_chat_when_admin_online' FOR UPDATE"
            )->fetchColumn();
        } elseif ($action === 'assign') {
            if (!$isPrimaryAdmin) {
                $db->rollBack();
                data_respond(403, ['error' => 'admin_required', 'message' => 'Only the administrator can transfer chat ownership.']);
            }
            $assignedStaffId = filter_var($body['staffId'] ?? null, FILTER_VALIDATE_INT);
            if ($assignedStaffId === false || $assignedStaffId < 1) {
                $db->rollBack();
                data_respond(400, ['error' => 'invalid_chat_assignment', 'message' => 'Choose an active agent with live chat access.']);
            }
            $agentQuery = $db->prepare('SELECT display_name, permissions FROM staff_users WHERE id = ? AND is_active = 1 LIMIT 1 FOR UPDATE');
            $agentQuery->execute([$assignedStaffId]);
            $agent = $agentQuery->fetch();
            $agentPermissions = is_array($agent) ? data_staff_permissions(json_decode((string) $agent['permissions'], true)) : null;
            if (!is_array($agent) || $agentPermissions === null || !in_array('chat', $agentPermissions, true)) {
                $db->rollBack();
                data_respond(400, ['error' => 'invalid_chat_assignment', 'message' => 'Choose an active agent with live chat access.']);
            }
        }

        $find = $db->prepare(
            'SELECT id, status, owner_type, owner_staff_id FROM chat_conversations WHERE id = ? FOR UPDATE'
        );
        $find->execute([(int) $conversationId]);
        $conversation = $find->fetch();
        if (!is_array($conversation)) {
            $db->rollBack();
            data_respond(404, ['error' => 'chat_not_found', 'message' => 'The conversation could not be found.']);
        }

        if ($action === 'claim') {
            if (!in_array($conversation['owner_type'], ['queue', 'admin'], true) || $conversation['status'] !== 'open'
                || !data_chat_agents_can_claim($db)) {
                $db->rollBack();
                data_respond(409, ['error' => 'chat_claim_unavailable', 'message' => 'This chat is no longer available to claim. Refresh the inbox and try again.']);
            }
            $db->prepare("UPDATE chat_conversations SET owner_type = 'agent', owner_staff_id = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?")
                ->execute([$staffId, (int) $conversationId]);
            $db->prepare(
                "INSERT INTO chat_messages (conversation_id, sender_type, sender_name, body)
                 VALUES (?, 'system', 'Ambienta support', ?)"
            )->execute([(int) $conversationId, $staffName . ' joined the conversation.']);
            data_audit($db, 'chat.claimed', 'chat', (string) $conversationId);
        } elseif ($action === 'takeover' || $action === 'assign') {
            if (!$isPrimaryAdmin) {
                $db->rollBack();
                data_respond(403, ['error' => 'admin_required', 'message' => 'Only the administrator can transfer chat ownership.']);
            }
            $previousOwner = $conversation['owner_type'] === 'admin' ? 'the administrator' : 'the shared queue';
            if ($conversation['owner_type'] === 'agent') {
                $ownerQuery = $db->prepare('SELECT display_name FROM staff_users WHERE id = ? LIMIT 1');
                $ownerQuery->execute([(int) $conversation['owner_staff_id']]);
                $previousOwner = (string) ($ownerQuery->fetchColumn() ?: 'the assigned agent');
            }
            if ($action === 'takeover') {
                $db->prepare("UPDATE chat_conversations SET owner_type = 'admin', owner_staff_id = NULL, updated_at = UTC_TIMESTAMP() WHERE id = ?")
                    ->execute([(int) $conversationId]);
                $handoff = 'Administrator took over the conversation from ' . ($previousOwner !== '' ? $previousOwner : 'the agent') . '.';
            } else {
                if ($conversation['owner_type'] === 'agent' && (int) $conversation['owner_staff_id'] === (int) $assignedStaffId) {
                    $db->rollBack();
                    data_respond(409, ['error' => 'chat_already_assigned', 'message' => 'This agent already owns the conversation.']);
                }
                $db->prepare("UPDATE chat_conversations SET owner_type = 'agent', owner_staff_id = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?")
                    ->execute([(int) $assignedStaffId, (int) $conversationId]);
                $handoff = 'Administrator transferred this conversation from ' . $previousOwner . ' to ' . ($agent['display_name'] ?: 'an agent') . '.';
            }
            $db->prepare(
                "INSERT INTO chat_messages (conversation_id, sender_type, sender_name, body)
                 VALUES (?, 'system', 'Ambienta support', ?)"
            )->execute([(int) $conversationId, $handoff]);
            data_audit($db, 'chat.' . $action, 'chat', (string) $conversationId, ['previousOwner' => $previousOwner]);
        } elseif ($action === 'reply') {
            $message = data_string($body, 'message', 2000);
            if ($conversation['status'] !== 'open') {
                $db->rollBack();
                data_respond(409, ['error' => 'chat_closed', 'message' => 'Reopen this conversation before replying.']);
            }
            if (!$isPrimaryAdmin && ($conversation['owner_type'] !== 'agent' || (int) $conversation['owner_staff_id'] !== $staffId)) {
                $db->rollBack();
                data_respond(409, ['error' => 'chat_not_owned', 'message' => 'Claim this chat before replying. Another staff member may already own it.']);
            }
            $contactDetailTypes = $isPrimaryAdmin ? [] : data_contact_detail_types($message);
            if ($contactDetailTypes !== []) {
                data_audit($db, 'security.contact_details_blocked', 'staff', (string) $staffId, [
                    'channel' => 'chat',
                    'conversationId' => (int) $conversationId,
                    'detectedTypes' => $contactDetailTypes,
                ]);
                $db->commit();
                data_respond(400, ['error' => 'contact_details_not_allowed', 'message' => 'Your reply was not sent because it contains an email address or phone-number-like contact detail. The administrator has been alerted.']);
            }
            if ($isPrimaryAdmin && $conversation['owner_type'] !== 'admin') {
                $previousOwner = $conversation['owner_type'] === 'admin' ? 'the administrator' : 'the shared queue';
                if ($conversation['owner_type'] === 'agent') {
                    $ownerQuery = $db->prepare('SELECT display_name FROM staff_users WHERE id = ? LIMIT 1');
                    $ownerQuery->execute([(int) $conversation['owner_staff_id']]);
                    $previousOwner = (string) ($ownerQuery->fetchColumn() ?: 'the assigned agent');
                }
                $handoff = 'Administrator took over the conversation from ' . ($previousOwner !== '' ? $previousOwner : 'the agent') . '.';
                $db->prepare("UPDATE chat_conversations SET owner_type = 'admin', owner_staff_id = NULL WHERE id = ?")
                    ->execute([(int) $conversationId]);
                $db->prepare(
                    "INSERT INTO chat_messages (conversation_id, sender_type, sender_name, body)
                     VALUES (?, 'system', 'Ambienta support', ?)"
                )->execute([(int) $conversationId, $handoff]);
            }
            $db->prepare(
                "INSERT INTO chat_messages (conversation_id, sender_type, sender_name, body)
                 VALUES (?, 'staff', ?, ?)"
            )->execute([(int) $conversationId, $staffName, $message]);
            $db->prepare('UPDATE chat_conversations SET updated_at = UTC_TIMESTAMP() WHERE id = ?')
                ->execute([(int) $conversationId]);
            data_audit($db, 'chat.replied', 'chat', (string) $conversationId);
        } elseif ($action === 'close' || $action === 'reopen') {
            if (!$isPrimaryAdmin && ($conversation['owner_type'] !== 'agent' || (int) $conversation['owner_staff_id'] !== $staffId)) {
                $db->rollBack();
                data_respond(409, ['error' => 'chat_not_owned', 'message' => 'Only the staff member currently handling this chat can change its status.']);
            }
            $nextStatus = $action === 'close' ? 'closed' : 'open';
            $db->prepare('UPDATE chat_conversations SET status = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?')
                ->execute([$nextStatus, (int) $conversationId]);
            data_audit($db, 'chat.' . $action, 'chat', (string) $conversationId);
        } else {
            $db->rollBack();
            data_respond(400, ['error' => 'invalid_chat_action', 'message' => 'Choose claim, reply, transfer, close, or reopen.']);
        }

        $db->commit();
    } catch (Throwable $error) {
        if ($db->inTransaction()) $db->rollBack();
        error_log('Ambients CRM chat action failed: ' . $error->getMessage());
        data_respond(503, ['error' => 'chat_action_failed', 'message' => 'The chat update could not be saved. Please try again.']);
    }
    data_respond(200, ['status' => $action === 'close' ? 'closed' : ($action === 'reopen' ? 'open' : 'open')]);
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
        $db->prepare('INSERT INTO staff_users (email, display_name, password_hash, role, permissions, is_active, must_change_password, created_by) VALUES (?, ?, ?, ?, ?, 1, 0, ?)')
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
    $find = $db->prepare('SELECT id, email, display_name, is_active, permissions FROM staff_users WHERE id = ?');
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
        $updates[] = 'must_change_password = 0';
        $auditDetails['passwordReset'] = true;
    }
    if ($updates === []) data_respond(400, ['error' => 'invalid_staff_update', 'message' => 'No account changes were provided.']);
    $currentPermissions = data_staff_permissions(json_decode((string) $staff['permissions'], true)) ?? [];
    $targetPermissions = isset($permissions) && is_array($permissions) ? $permissions : $currentPermissions;
    $shouldRequeueChats = (array_key_exists('isActive', $body) && $body['isActive'] === false)
        || !in_array('chat', $targetPermissions, true);
    $updates[] = 'session_version = session_version + 1';
    $parameters[] = $id;
    try {
        $db->beginTransaction();
        $db->prepare('UPDATE staff_users SET ' . implode(', ', $updates) . ' WHERE id = ?')->execute($parameters);
        $db->prepare(
            'UPDATE staff_presence SET last_seen_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 121 SECOND) WHERE staff_id = ?'
        )->execute([$id]);
        if ($shouldRequeueChats) {
            $ownedChats = $db->prepare("SELECT id FROM chat_conversations WHERE owner_type = 'agent' AND owner_staff_id = ? AND status = 'open' FOR UPDATE");
            $ownedChats->execute([$id]);
            $chatIds = array_map('intval', $ownedChats->fetchAll(PDO::FETCH_COLUMN));
            if ($chatIds !== []) {
                $db->prepare("UPDATE chat_conversations SET owner_type = 'queue', owner_staff_id = NULL WHERE owner_type = 'agent' AND owner_staff_id = ? AND status = 'open'")
                    ->execute([$id]);
                $notice = 'This conversation was returned to the shared queue because ' . ($staff['display_name'] ?: 'the assigned agent') . ' is no longer available.';
                $insertNotice = $db->prepare(
                    "INSERT INTO chat_messages (conversation_id, sender_type, sender_name, body)
                     VALUES (?, 'system', 'Ambienta support', ?)"
                );
                foreach ($chatIds as $chatId) {
                    $insertNotice->execute([$chatId, $notice]);
                }
                data_audit($db, 'chat.agent_unavailable', 'staff', (string) $id, ['returnedChats' => count($chatIds)]);
            }
        }
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

if ($method === 'POST' && $resource === 'checkout-session') {
    $body = data_read_json();
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
    if (!in_array($couponCode, ['AURA10', 'SAVE10', 'CRYPTO5', 'FREESHIP', ''], true)) {
        data_respond(400, ['error' => 'invalid_coupon', 'message' => 'The coupon code is invalid.']);
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

    try {
        data_stripe_webhook_secret();
    } catch (Throwable $error) {
        data_respond(503, ['error' => 'stripe_not_configured', 'message' => 'Stripe checkout is not ready yet. Please choose pay on delivery/pickup.']);
    }

    $db = data_db();
    $db->beginTransaction();
    $sessionId = '';
    try {
        $subtotalCents = 0;
        $items = [];
        $productQuery = $db->prepare('SELECT id, name, category, price, stock_count FROM products WHERE id = ? AND is_active = 1 FOR UPDATE');
        foreach ($requestedItems as $productId => $quantity) {
            $productQuery->execute([$productId]);
            $product = $productQuery->fetch();
            if (!$product || (int) $product['stock_count'] < $quantity) {
                throw new DomainException('An item is unavailable or has insufficient stock.');
            }
            $unitPriceCents = (int) round((float) $product['price'] * 100);
            $subtotalCents += $unitPriceCents * $quantity;
            $items[] = [
                'id' => (string) $product['id'],
                'name' => (string) $product['name'],
                'category' => (string) $product['category'],
                'quantity' => $quantity,
                'unitPriceCents' => $unitPriceCents,
            ];
        }

        $discountRate = in_array($couponCode, ['AURA10', 'SAVE10'], true) ? 0.10 : ($couponCode === 'CRYPTO5' ? 0.05 : 0.0);
        $discountCents = (int) round($subtotalCents * $discountRate);
        $shippingCents = $deliveryMethod === 'Express Courier' && $subtotalCents < 3500 && $couponCode !== 'FREESHIP' ? 1200 : 0;
        $totalCents = max(0, $subtotalCents - $discountCents + $shippingCents);
        if ($totalCents < 50) {
            throw new DomainException('The order total is too small for card checkout.');
        }
        $orderId = bin2hex(random_bytes(16));
        $orderNumber = 'ORD-' . gmdate('Ymd') . '-' . strtoupper(bin2hex(random_bytes(3)));
        $description = implode(', ', array_map(
            static fn (array $item): string => $item['name'] . ' × ' . $item['quantity'],
            $items
        ));
        if ($shippingCents > 0) $description .= ' · Express delivery';
        if ($discountCents > 0) $description .= ' · Coupon ' . $couponCode;
        $session = data_stripe_request('POST', '/v1/checkout/sessions', [
            'mode' => 'payment',
            'payment_method_types[0]' => 'card',
            'success_url' => 'https://ambienta.io/?checkout_result={CHECKOUT_SESSION_ID}',
            'cancel_url' => 'https://ambienta.io/?checkout_cancelled=1&order_id=' . rawurlencode($orderId),
            'customer_email' => $email,
            'expires_at' => time() + 3600,
            'line_items[0][price_data][currency]' => 'usd',
            'line_items[0][price_data][product_data][name]' => 'Ambienta order ' . $orderNumber,
            'line_items[0][price_data][product_data][description]' => substr($description, 0, 500),
            'line_items[0][price_data][unit_amount]' => $totalCents,
            'line_items[0][quantity]' => 1,
            'payment_intent_data[capture_method]' => 'manual',
            'payment_intent_data[metadata][order_id]' => $orderId,
            'metadata[order_id]' => $orderId,
            'metadata[order_number]' => $orderNumber,
        ]);
        $sessionId = is_string($session['id'] ?? null) ? $session['id'] : '';
        $sessionUrl = is_string($session['url'] ?? null) ? $session['url'] : '';
        if (!preg_match('/^cs_(test|live)_[A-Za-z0-9]+$/', $sessionId) || !str_starts_with($sessionUrl, 'https://checkout.stripe.com/')) {
            throw new RuntimeException('Stripe returned an invalid checkout session.');
        }

        $placedAt = gmdate('Y-m-d H:i:s');
        $db->prepare(
            'INSERT INTO orders (id, order_number, customer_name, email, phone, delivery_method, delivery_address, subtotal, shipping_fee, discount_amount, coupon_code, total_amount, payment_method, payment_status, stripe_checkout_session_id, status, placed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )->execute([
            $orderId, $orderNumber, $customerName, $email, $phone, $deliveryMethod, $deliveryAddress,
            $subtotalCents / 100, $shippingCents / 100, $discountCents / 100, $couponCode === '' ? null : $couponCode,
            $totalCents / 100, 'Credit / Debit Card', 'Awaiting Payment', $sessionId, 'Pending', $placedAt,
        ]);
        $insertItem = $db->prepare(
            'INSERT INTO order_items (order_id, product_id, product_name, category, quantity, unit_price) VALUES (?, ?, ?, ?, ?, ?)'
        );
        $reserveStock = $db->prepare('UPDATE products SET stock_count = stock_count - ? WHERE id = ? AND stock_count >= ?');
        foreach ($items as $item) {
            $insertItem->execute([$orderId, $item['id'], $item['name'], $item['category'], $item['quantity'], $item['unitPriceCents'] / 100]);
            $reserveStock->execute([$item['quantity'], $item['id'], $item['quantity']]);
            if ($reserveStock->rowCount() !== 1) {
                throw new DomainException('Stock changed while creating the order. Please try again.');
            }
        }
        $nameParts = preg_split('/\s+/', $customerName, 2) ?: [$customerName];
        $db->prepare(
            "INSERT INTO leads (first_name, last_name, email, phone, lead_source) VALUES (?, ?, ?, ?, 'Online Order')
             ON DUPLICATE KEY UPDATE id = id"
        )->execute([$nameParts[0], $nameParts[1] ?? '', $email, $phone]);
        data_audit($db, 'order.checkout_started', 'order', $orderId, ['orderNumber' => $orderNumber, 'total' => $totalCents / 100]);
        $db->commit();
        data_respond(201, ['url' => $sessionUrl, 'orderNumber' => $orderNumber]);
    } catch (DomainException $error) {
        if ($db->inTransaction()) $db->rollBack();
        if ($sessionId !== '') {
            try {
                data_stripe_request('POST', '/v1/checkout/sessions/' . rawurlencode($sessionId) . '/expire');
            } catch (Throwable $expireError) {
                error_log('Ambients orphan Stripe checkout session could not be expired: ' . $expireError->getMessage());
            }
        }
        data_respond(409, ['error' => 'checkout_conflict', 'message' => $error->getMessage()]);
    } catch (Throwable $error) {
        if ($db->inTransaction()) $db->rollBack();
        if ($sessionId !== '') {
            try {
                data_stripe_request('POST', '/v1/checkout/sessions/' . rawurlencode($sessionId) . '/expire');
            } catch (Throwable $expireError) {
                error_log('Ambients orphan Stripe checkout session could not be expired: ' . $expireError->getMessage());
            }
        }
        error_log('Ambients Stripe checkout session creation failed: ' . $error->getMessage());
        $message = $error->getMessage() === 'Stripe is not configured.'
            ? 'Secure card checkout is not configured yet. Please choose pay on delivery/pickup.'
            : 'Secure card checkout could not be started. Please try again or choose pay on delivery/pickup.';
        data_respond(503, ['error' => 'checkout_unavailable', 'message' => $message]);
    }
}

if ($method === 'POST' && $resource === 'order-mark-paid') {
    data_require_admin('admin');
    $body = data_read_json();
    $orderId = data_string($body, 'orderId', 64);
    $db = data_db();
    $db->beginTransaction();
    try {
        $find = $db->prepare('SELECT * FROM orders WHERE id = ? FOR UPDATE');
        $find->execute([$orderId]);
        $order = $find->fetch();
        if (!is_array($order)) {
            $db->rollBack();
            data_respond(404, ['error' => 'order_not_found', 'message' => 'The order was not found.']);
        }
        if (!in_array($order['payment_method'], [
            'Credit / Debit Card',
            'PayPal',
            'Cryptocurrency (USDC / BTC / ETH / SOL)',
        ], true) || !$order['payment_link_sent_at']) {
            $db->rollBack();
            data_respond(409, ['error' => 'payment_link_not_sent', 'message' => 'Send a payment link before marking this order as paid.']);
        }
        if ($order['status'] === 'Cancelled') {
            $db->rollBack();
            data_respond(409, ['error' => 'order_cancelled', 'message' => 'A cancelled order cannot be marked as paid.']);
        }
        if ($order['payment_status'] !== 'Paid') {
            $db->prepare('UPDATE orders SET payment_status = ? WHERE id = ?')->execute(['Paid', $orderId]);
            data_audit($db, 'order.payment_marked_paid', 'order', $orderId, [
                'orderNumber' => $order['order_number'],
                'paymentMethod' => $order['payment_method'],
            ]);
        }
        $db->commit();
        $savedOrder = $db->prepare('SELECT * FROM orders WHERE id = ?');
        $savedOrder->execute([$orderId]);
        data_respond(200, ['order' => data_order_row($db, $savedOrder->fetch())]);
    } catch (Throwable $error) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        error_log('Ambients payment status update failed: ' . $error->getMessage());
        data_respond(500, ['error' => 'payment_status_failed', 'message' => 'The payment status could not be updated.']);
    }
}

if ($method === 'POST' && $resource === 'order-payment-link') {
    data_require_admin('admin');
    $body = data_read_json();
    $orderId = data_string($body, 'orderId', 64);
    $previewOnly = $body['previewOnly'] ?? false;
    if (!is_bool($previewOnly)) {
        data_respond(400, ['error' => 'invalid_preview_mode', 'message' => 'The payment email mode is invalid.']);
    }
    $paymentLink = $previewOnly
        ? 'https://example.invalid/demo-payment'
        : data_string($body, 'paymentLinkUrl', 2048);
    $paymentLinkType = data_string($body, 'paymentLinkType', 32, false);
    if ($paymentLinkType === '') {
        $paymentLinkType = 'provider';
    }
    if (!in_array($paymentLinkType, ['provider', 'paypal', 'crypto_wallet', 'custom'], true)) {
        data_respond(400, ['error' => 'invalid_payment_link_type', 'message' => 'Choose a supported payment link type.']);
    }
    $paymentLinkName = data_string($body, 'paymentLinkName', 80, false);
    $paymentCryptoAsset = data_string($body, 'paymentCryptoAsset', 8, false);
    $paymentCryptoNetwork = data_string($body, 'paymentCryptoNetwork', 32, false);
    if ($paymentLinkType === 'custom' && trim($paymentLinkName) === '') {
        data_respond(400, ['error' => 'payment_link_name_required', 'message' => 'Enter a name for the custom payment link.']);
    }
    if (preg_match('/[\r\n\x00-\x1F\x7F]/', $paymentLinkName) === 1) {
        data_respond(400, ['error' => 'invalid_payment_link_name', 'message' => 'The custom payment link name cannot contain line breaks or control characters.']);
    }
    $emailTemplate = data_string($body, 'emailTemplate', 40, false);
    if ($emailTemplate === '') {
        $emailTemplate = 'payment_request';
    }
    $paymentEmailTemplates = [
        'payment_request' => [
            'subject' => 'Payment instructions',
            'intro' => 'Thank you for your order. We have reviewed order %s; please complete payment to continue.',
            'closing' => 'If you have questions, reply to this email and our team will be happy to help.',
        ],
        'payment_request_formal' => [
            'subject' => 'Payment instructions',
            'intro' => 'Your order %s has been reviewed. Please use the secure link below to submit the outstanding payment.',
            'closing' => 'Please contact our team by replying to this email if you require assistance.',
        ],
        'payment_reminder' => [
            'subject' => 'Payment reminder',
            'intro' => 'This is a friendly reminder that payment for order %s is still outstanding.',
            'closing' => 'If you have already paid, please disregard this reminder or reply to this email so our team can assist.',
        ],
        'payment_reminder_final' => [
            'subject' => 'Final payment reminder',
            'intro' => 'Our records show that payment for order %s is still outstanding. Please review and complete payment using the secure link below.',
            'closing' => 'If you have already completed payment or need help, please reply to this email so our team can review your order.',
        ],
        'payment_link_updated' => [
            'subject' => 'Updated payment link',
            'intro' => 'Here is the updated secure payment link for order %s. Please use this link instead of any earlier payment link.',
            'closing' => 'If you have already paid using an earlier link, please reply to this email so our team can verify your order.',
        ],
    ];
    if (!array_key_exists($emailTemplate, $paymentEmailTemplates)) {
        data_respond(400, ['error' => 'invalid_email_template', 'message' => 'Choose a supported payment email template.']);
    }
    $emailDesign = data_string($body, 'emailDesign', 16, false);
    if ($emailDesign === '') {
        $emailDesign = 'card';
    }
    if (!in_array($emailDesign, ['card', 'plain'], true)) {
        data_respond(400, ['error' => 'invalid_email_design', 'message' => 'Choose either the designed card or plain email layout.']);
    }
    $additionalMessage = data_string($body, 'additionalMessage', 2000, false);
    $qrCodeImage = '';
    if ($emailDesign === 'card') {
        $qrCodeDataUrl = data_string($body, 'qrCodeDataUrl', 100000);
        if (!preg_match('/^data:image\/png;base64,([A-Za-z0-9+\/=]+)$/', $qrCodeDataUrl, $qrMatch)) {
            data_respond(400, ['error' => 'invalid_payment_qr', 'message' => 'A valid payment QR code could not be generated.']);
        }
        $decodedQrCodeImage = base64_decode($qrMatch[1], true);
        $qrDimensions = is_string($decodedQrCodeImage) && strlen($decodedQrCodeImage) >= 24
            ? unpack('Nwidth/Nheight', substr($decodedQrCodeImage, 16, 8))
            : false;
        if (!is_string($decodedQrCodeImage)
            || substr($decodedQrCodeImage, 0, 8) !== "\x89PNG\r\n\x1a\n"
            || !is_array($qrDimensions)
            || $qrDimensions['width'] < 100
            || $qrDimensions['width'] > 512
            || $qrDimensions['height'] < 100
            || $qrDimensions['height'] > 512
        ) {
            data_respond(400, ['error' => 'invalid_payment_qr', 'message' => 'The payment QR code image is invalid.']);
        }
        $qrCodeImage = $decodedQrCodeImage;
    }

    $settings = data_mail_settings();
    if ($settings === [] || empty($settings['verified'])) {
        data_respond(409, ['error' => 'mail_not_configured', 'message' => 'Configure and test the Hostinger connection before sending payment links.']);
    }

    $db = data_db();
    $db->beginTransaction();
    try {
        $find = $db->prepare('SELECT * FROM orders WHERE id = ? FOR UPDATE');
        $find->execute([$orderId]);
        $order = $find->fetch();
        if (!is_array($order)) {
            $db->rollBack();
            data_respond(404, ['error' => 'order_not_found', 'message' => 'The order was not found.']);
        }
        if (!in_array($order['payment_method'], [
            'Credit / Debit Card',
            'PayPal',
            'Cryptocurrency (USDC / BTC / ETH / SOL)',
        ], true)) {
            $db->rollBack();
            data_respond(409, ['error' => 'payment_link_not_supported', 'message' => 'Payment links are only available for card, PayPal, and cryptocurrency orders.']);
        }
        $linkParts = filter_var($paymentLink, FILTER_VALIDATE_URL) ? parse_url($paymentLink) : false;
        $isHttpsPaymentLink = is_array($linkParts)
            && strtolower((string) ($linkParts['scheme'] ?? '')) === 'https'
            && isset($linkParts['host'])
            && !isset($linkParts['user'])
            && !isset($linkParts['pass']);
        $cryptoNetworkMatches = match ($paymentCryptoAsset) {
            'BTC' => $paymentCryptoNetwork === 'Bitcoin',
            'ETH' => $paymentCryptoNetwork === 'Ethereum (ERC-20)',
            'USDT' => in_array($paymentCryptoNetwork, ['Ethereum (ERC-20)', 'TRON (TRC-20)'], true),
            default => false,
        };
        $isCryptoWalletAddress = $cryptoNetworkMatches && match ([$paymentCryptoAsset, $paymentCryptoNetwork]) {
            ['BTC', 'Bitcoin'] => preg_match('/^(?:1|3)[a-km-zA-HJ-NP-Z1-9]{25,34}$/', $paymentLink) === 1
                || preg_match('/^bc1[a-z0-9]{25,60}$/', $paymentLink) === 1,
            ['ETH', 'Ethereum (ERC-20)'], ['USDT', 'Ethereum (ERC-20)'] => preg_match('/^0x[a-fA-F0-9]{40}$/', $paymentLink) === 1,
            ['USDT', 'TRON (TRC-20)'] => preg_match('/^T[1-9A-HJ-NP-Za-km-z]{33}$/', $paymentLink) === 1,
            default => false,
        };
        $isValidPaymentLink = match ($paymentLinkType) {
            'provider', 'paypal', 'custom' => $isHttpsPaymentLink,
            'crypto_wallet' => $isCryptoWalletAddress,
            default => false,
        };
        if (!$previewOnly && (
            preg_match('/[\r\n\x00]/', $paymentLink) === 1
            || !$isValidPaymentLink
        )) {
            $db->rollBack();
            data_respond(400, [
                'error' => 'invalid_payment_link',
                'message' => match ($paymentLinkType) {
                    'crypto_wallet' => 'Choose BTC, ETH, or USDT with a supported network and enter a wallet address matching that asset and network.',
                    'custom' => 'Enter a valid external HTTPS URL for the custom payment link.',
                    default => 'Enter a valid PayPal, payment-provider, or custom HTTPS link.',
                },
            ]);
        }
        if ($order['payment_status'] === 'Paid' || $order['status'] === 'Cancelled') {
            $db->rollBack();
            data_respond(409, ['error' => 'order_not_payable', 'message' => 'A payment link cannot be sent for a paid or cancelled order.']);
        }

        $template = $paymentEmailTemplates[$emailTemplate];
        $paymentLinkLabel = $previewOnly
            ? 'Demo preview link (not for payment)'
            : ($paymentLinkType === 'custom'
            ? trim($paymentLinkName)
            : ($paymentLinkType === 'crypto_wallet'
                ? $paymentCryptoAsset . ' wallet address (' . $paymentCryptoNetwork . ')'
                : ($paymentLinkType === 'paypal'
                    ? 'PayPal payment link'
                    : ($paymentLinkType === 'provider' ? 'Payment provider link' : 'Custom link'))));
        $emailPaymentMethod = $previewOnly
            ? 'Demo preview only'
            : ($paymentLinkType === 'crypto_wallet'
            ? $paymentCryptoAsset . ' on ' . $paymentCryptoNetwork
            : ($paymentLinkType === 'paypal'
                ? 'PayPal'
                : ($paymentLinkType === 'custom' ? trim($paymentLinkName) : $order['payment_method'])));
        $subject = ($previewOnly ? '[DEMO PREVIEW] ' : '')
            . $template['subject'] . ' for Ambient order ' . $order['order_number'];
        $paymentInstructions = $previewOnly
            ? 'This is a demo-only preview. The included invalid link and QR code cannot accept payment.'
            : match ($paymentLinkType) {
                'crypto_wallet' => "Send only {$paymentCryptoAsset} on {$paymentCryptoNetwork}. The QR code contains the wallet destination only; the order total is shown in USD, so confirm the exact crypto amount before sending. Verify the asset, network, and full wallet address.",
                'paypal' => 'Use the PayPal link below and confirm the order total before approving payment.',
                'custom' => 'Use the custom payment link below. Check the link name and destination before completing payment.',
                default => match ($order['payment_method']) {
                    'Credit / Debit Card' => 'Complete your card payment using the secure provider link below. Enter payment details only on the provider checkout page; please do not reply to this email with card details.',
                    'PayPal' => 'Use the secure provider link below to continue to PayPal and complete payment. Confirm the order total before approving the payment.',
                    'Cryptocurrency (USDC / BTC / ETH / SOL)' => 'Use the secure provider link below to review the available cryptocurrency and network, then follow the provider checkout instructions. Confirm the selected asset and network before completing payment.',
                    default => '',
                },
            };
        $intro = sprintf($template['intro'], $order['order_number']);
        $closing = $template['closing'];
        $plainBody = "Hello {$order['customer_name']},\n\n"
            . $intro . "\n\n"
            . "ORDER SUMMARY\n"
            . "Order: {$order['order_number']}\n"
            . "Payment method: {$emailPaymentMethod}\n"
            . "Total due: $" . number_format((float) $order['total_amount'], 2) . "\n\n"
            . $paymentInstructions . "\n\n"
            . "{$paymentLinkLabel}:\n{$paymentLink}\n";
        if ($additionalMessage !== '') {
            $plainBody .= "\nMessage from Ambient:\n{$additionalMessage}\n";
        }
        $plainBody .= "\n{$closing}\n\nWarm regards,\nAmbient";
        $recipient = (string) $order['email'];
        if ($previewOnly) {
            $adminEmail = strtolower((string) ($_SESSION['admin_email'] ?? ''));
            if (!filter_var($adminEmail, FILTER_VALIDATE_EMAIL)) {
                $db->rollBack();
                data_respond(409, ['error' => 'admin_email_unavailable', 'message' => 'The signed-in administrator email is unavailable for a demo preview.']);
            }
            $recipient = $adminEmail;
            $plainBody = "DEMO PREVIEW ONLY — sent to the signed-in administrator, not the customer.\n"
                . "This is not a payment request. Do not use the example.invalid link to pay.\n\n"
                . $plainBody;
        }
        $safeName = htmlspecialchars((string) $order['customer_name'], ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $safeOrderNumber = htmlspecialchars((string) $order['order_number'], ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $safeIntro = htmlspecialchars($intro, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $safeClosing = htmlspecialchars($closing, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $safeInstructions = htmlspecialchars($paymentInstructions, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $safeLink = htmlspecialchars($paymentLink, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $safePaymentLinkLabel = htmlspecialchars($paymentLinkLabel, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $safeAdditionalMessage = htmlspecialchars($additionalMessage, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $safeEmailPaymentMethod = htmlspecialchars($emailPaymentMethod, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $safeTotal = number_format((float) $order['total_amount'], 2);
        $htmlBody = '<div style="margin:0;padding:28px 12px;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#172033">'
            . '<div style="max-width:560px;margin:0 auto;overflow:hidden;border:1px solid #cbdcf0;border-radius:18px;background:#ffffff">'
            . '<div style="padding:24px 28px;background:#123b68;color:#ffffff">'
            . '<p style="margin:0;font-size:11px;font-weight:bold;letter-spacing:2px;color:#bfdbfe">AMBIENT · ORDER PAYMENT</p>'
            . '<h1 style="margin:12px 0 0;font-size:23px;line-height:1.3;color:#ffffff">Payment details</h1>'
            . '</div><div style="padding:26px 28px">'
            . '<p style="margin:0 0 10px;font-size:15px;line-height:1.6">Hello ' . $safeName . ',</p>'
            . '<p style="margin:0 0 20px;font-size:14px;line-height:1.65;color:#475569">' . $safeIntro . '</p>'
            . '<div style="margin:0 0 20px;padding:17px 18px;border:1px solid #cbdcf0;border-radius:12px;background:#f1f7fc">'
            . '<p style="margin:0 0 10px;font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#356a9e">Order summary</p>'
            . '<table role="presentation" style="width:100%;border-collapse:collapse;font-size:13px;line-height:1.6">'
            . '<tr><td style="padding:3px 0;color:#64748b">Order</td><td style="padding:3px 0;text-align:right;font-weight:bold;color:#172033">' . $safeOrderNumber . '</td></tr>'
            . '<tr><td style="padding:3px 0;color:#64748b">Payment</td><td style="padding:3px 0;text-align:right;color:#172033">' . $safeEmailPaymentMethod . '</td></tr>'
            . '<tr><td style="padding:8px 0 0;color:#647873">Total due</td><td style="padding:8px 0 0;text-align:right;font-size:18px;font-weight:bold;color:#123b68">$' . $safeTotal . '</td></tr>'
            . '</table></div>'
            . '<p style="margin:0 0 16px;font-size:13px;line-height:1.65;color:#334155">' . $safeInstructions . '</p>'
            . '<div style="margin:0 0 20px;padding:20px;border:1px solid #cbdcf0;border-radius:14px;text-align:center;background:#ffffff">'
            . '<p style="margin:0 0 12px;font-size:12px;font-weight:bold;color:#172033">' . $safePaymentLinkLabel . '</p>'
            . '<img src="cid:ambienta-payment-qr" width="180" height="180" alt="QR code for ' . $safePaymentLinkLabel . '" style="display:block;width:180px;height:180px;margin:0 auto 12px;border:0">'
            . '<p style="margin:0;font-size:11px;line-height:1.5;color:#64748b">Scan to open the payment link or copy the payment details below.</p>'
            . '<div style="margin-top:14px;padding:11px 12px;border-radius:8px;background:#f1f7fc;font-size:12px;line-height:1.6;overflow-wrap:anywhere">'
            . ($isHttpsPaymentLink
                ? '<a href="' . $safeLink . '" style="display:inline-block;padding:11px 20px;border-radius:8px;background:#123b68;color:#ffffff;font-weight:bold;text-decoration:none">' . ($previewOnly ? 'Open demo link' : 'Continue to payment') . '</a><br><a href="' . $safeLink . '" style="display:inline-block;margin-top:10px;color:#1d4ed8;text-decoration:underline">' . $safePaymentLinkLabel . '</a>'
                : '<code style="font-family:Consolas,monospace;color:#172033">' . $safeLink . '</code>')
            . '</div></div>'
            . ($safeAdditionalMessage !== '' ? '<div style="margin:0 0 20px;padding:14px 16px;border-left:3px solid #60a5fa;background:#f1f7fc;font-size:13px;line-height:1.65;color:#334155">' . nl2br($safeAdditionalMessage, false) . '</div>' : '')
            . '<p style="margin:0 0 10px;font-size:13px;line-height:1.65;color:#334155">' . $safeClosing . '</p>'
            . '<p style="margin:18px 0 0;font-size:13px;line-height:1.6;color:#172033">Warm regards,<br><strong>Ambient</strong></p>'
            . '</div><div style="padding:15px 28px;border-top:1px solid #e2e8f0;background:#f8fafc;font-size:10px;line-height:1.5;color:#64748b">'
            . 'Please verify the order, amount, payment destination, and crypto network before confirming payment. Never share card details or wallet recovery phrases by email.'
            . '</div></div></div>';
        if ($previewOnly) {
            $htmlBody = '<div style="max-width:560px;margin:12px auto;padding:12px 16px;border:1px solid #f59e0b;border-radius:10px;background:#fffbeb;color:#92400e;font-family:Arial,Helvetica,sans-serif;font-size:13px"><strong>DEMO PREVIEW ONLY</strong> — sent to the signed-in administrator, not the customer. Do not use the example.invalid link to pay.</div>' . $htmlBody;
        }

        $db->prepare(
            'INSERT INTO email_activity (recipient_email, subject, body, status, cc, bcc, thread_headers, attachments) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )->execute([
            $recipient,
            $subject,
            data_mail_encrypt_content($plainBody),
            'Queued',
            data_mail_encrypt_content('[]'),
            data_mail_encrypt_content('[]'),
            data_mail_encrypt_content('{}'),
            data_mail_encrypt_content('[]'),
        ]);
        $activityId = $db->lastInsertId();
        try {
            $messageId = data_mail_send(
                $settings,
                $recipient,
                $subject,
                $plainBody,
                null,
                [],
                [],
                [],
                [],
                $emailDesign === 'card' ? $htmlBody : null,
                $emailDesign === 'card' ? [[
                    'contentType' => 'image/png',
                    'name' => 'payment-qr.png',
                    'contentId' => 'ambienta-payment-qr',
                    'content' => $qrCodeImage,
                ]] : []
            );
        } catch (Throwable $error) {
            $db->prepare('UPDATE email_activity SET status = ? WHERE id = ?')->execute(['Failed', $activityId]);
            $db->commit();
            $settings['verified'] = false;
            try {
                data_mail_write_settings($settings);
            } catch (Throwable $settingsError) {
                error_log('Ambients Hostinger connection state could not be updated after a payment-link send failure.');
            }
            error_log('Ambients Hostinger payment-link email send failed: ' . $error->getMessage());
            data_respond(502, ['error' => 'mail_send_failed', 'message' => $previewOnly
                ? 'Hostinger did not accept the demo preview. Verify the connection and try again.'
                : 'Hostinger did not accept the payment-link email. Verify the connection and try again.']);
        }

        if (!$previewOnly) {
            $db->prepare('UPDATE orders SET payment_link_url = ?, payment_link_type = ?, payment_link_name = ?, payment_crypto_asset = ?, payment_crypto_network = ?, payment_link_sent_at = UTC_TIMESTAMP() WHERE id = ?')
                ->execute([
                    $paymentLink,
                    $paymentLinkType,
                    $paymentLinkType === 'custom' ? trim($paymentLinkName) : null,
                    $paymentLinkType === 'crypto_wallet' ? $paymentCryptoAsset : null,
                    $paymentLinkType === 'crypto_wallet' ? $paymentCryptoNetwork : null,
                    $orderId,
                ]);
        }
        $db->prepare('UPDATE email_activity SET status = ?, message_id = ? WHERE id = ?')
            ->execute(['Sent', $messageId, $activityId]);
        data_audit($db, $previewOnly ? 'order.payment_email_preview_sent' : 'order.payment_link_sent', 'order', $orderId, [
            'orderNumber' => $order['order_number'],
            'paymentMethod' => $order['payment_method'],
            'previewOnly' => $previewOnly,
            'emailDesign' => $emailDesign,
            'recipient' => $recipient,
        ]);
        $db->commit();

        $savedOrder = $db->prepare('SELECT * FROM orders WHERE id = ?');
        $savedOrder->execute([$orderId]);
        data_respond(201, [
            'sent' => true,
            'logged' => true,
            'message' => $previewOnly
                ? 'Hostinger accepted the demo preview email for the signed-in administrator. No customer email or order payment link was changed.'
                : 'Hostinger accepted the payment-link email.',
            'order' => data_order_row($db, $savedOrder->fetch()),
        ]);
    } catch (Throwable $error) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        error_log('Ambients payment-link order update failed: ' . $error->getMessage());
        data_respond(500, ['error' => 'payment_link_failed', 'message' => 'The order could not be updated after sending. Check Hostinger sent mail before retrying.']);
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
    if (!in_array($deliveryMethod, ['Regular Shipping', 'Express Shipping'], true)) {
        data_respond(400, ['error' => 'invalid_delivery', 'message' => 'Select regular or express shipping.']);
    }
    if (!is_array($body['items'] ?? null) || count($body['items']) < 1 || count($body['items']) > 30) {
        data_respond(400, ['error' => 'invalid_items', 'message' => 'The order items are invalid.']);
    }
    $paymentMethod = $body['paymentMethod'] ?? '';
    if (!is_string($paymentMethod) || !in_array($paymentMethod, [
        'Credit / Debit Card',
        'PayPal',
        'Cryptocurrency (USDC / BTC / ETH / SOL)',
    ], true)) {
        data_respond(400, ['error' => 'invalid_payment_method', 'message' => 'Select card, PayPal, or cryptocurrency.']);
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
        $shippingFee = $deliveryMethod === 'Express Shipping' && $subtotal < 35 && $couponCode !== 'FREESHIP' ? 12.00 : 0.00;
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
            $totalAmount,
            $paymentMethod,
            'Awaiting Payment',
            'Pending',
            $placedAt,
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
    foreach ($leads as $lead) {
        if (!is_array($lead)) {
            data_respond(400, ['error' => 'invalid_lead', 'message' => 'A submitted lead is invalid.']);
        }
        data_require_permission(($lead['leadSource'] ?? null) === 'CSV Upload' ? 'import_leads' : 'add_leads');
    }

    $db = data_db();
    $canEditContactDetails = ($_SESSION['admin_role'] ?? '') === 'admin';
    $assignedStaffId = $canEditContactDetails ? null : (int) ($_SESSION['staff_id'] ?? 0);
    $insert = $db->prepare(
        'INSERT INTO leads (first_name, last_name, email, phone, country, address, postal_code, lead_source, marketing_consent, marketing_consent_at, assigned_staff_id, import_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, IF(? = 1, CURRENT_TIMESTAMP, NULL), ?, ?)
         ON DUPLICATE KEY UPDATE first_name = IF(? = 1 AND VALUES(first_name) <> \'\', VALUES(first_name), first_name),
           last_name = IF(? = 1 AND VALUES(last_name) <> \'\', VALUES(last_name), last_name),
           phone = IF(? = 1 AND (phone REGEXP \'^[0-9]{5}(-[0-9]{4})?$\' OR VALUES(phone) <> \'\'), VALUES(phone), phone),
           country = IF(? = 1 AND VALUES(country) <> \'\', VALUES(country), country),
           address = IF(? = 1 AND address = \'\', VALUES(address), address),
           postal_code = IF(? = 1 AND (postal_code = \'\' OR postal_code REGEXP \'^[0-9]{1,9}[.]0+$\'), VALUES(postal_code), postal_code),
           marketing_consent = IF(VALUES(marketing_consent) = 1, 1, marketing_consent),
           marketing_consent_at = IF(VALUES(marketing_consent) = 1, CURRENT_TIMESTAMP, marketing_consent_at),
           assigned_staff_id = IF(assigned_staff_id IS NULL, VALUES(assigned_staff_id), assigned_staff_id)'
    );
    $findSql = 'SELECT l.id, l.first_name, l.last_name, l.email, l.phone, l.country, l.address, l.postal_code, l.lead_source, l.status, l.marketing_consent, l.marketing_consent_at, l.created_at,
                l.assigned_staff_id, (SELECT display_name FROM staff_users WHERE id = l.assigned_staff_id) AS assigned_staff_name,
                COUNT(o.id) AS order_count, MAX(o.placed_at) AS last_order_at,
                COUNT(CASE WHEN o.status <> \'Cancelled\' THEN 1 END) AS active_order_count,
                (SELECT COUNT(*) FROM lead_activities la WHERE la.lead_id = l.id AND la.activity_type = \'call\') AS call_count
         FROM leads l LEFT JOIN orders o ON o.email = l.email
         WHERE ';
    $findByEmail = $db->prepare($findSql . 'l.email = ? GROUP BY l.id LIMIT 1');
    $findByImportKey = $db->prepare($findSql . 'l.import_key = ? GROUP BY l.id LIMIT 1');
    $findAddressOnlyContact = $db->prepare(
        'SELECT id, import_key FROM leads
         WHERE email IS NULL AND phone = ? AND LOWER(first_name) = LOWER(?) AND LOWER(last_name) = LOWER(?)
           AND LOWER(address) = LOWER(?) LIMIT 1 FOR UPDATE'
    );
    $findImportKeyOwner = $db->prepare('SELECT id FROM leads WHERE import_key = ? LIMIT 1 FOR UPDATE');
    $updateAddressOnlyImportKey = $db->prepare('UPDATE leads SET import_key = ? WHERE id = ?');
    $existingOwnerByEmail = $db->prepare('SELECT assigned_staff_id FROM leads WHERE email = ?');
    $existingOwnerByImportKey = $db->prepare('SELECT assigned_staff_id FROM leads WHERE import_key = ?');
    $priorConsentByEmail = $db->prepare('SELECT marketing_consent FROM leads WHERE email = ?');
    $priorConsentByImportKey = $db->prepare('SELECT marketing_consent FROM leads WHERE import_key = ?');
    $saved = [];
    $db->beginTransaction();
    try {
        foreach ($leads as $lead) {
            if (!is_array($lead)) {
                data_respond(400, ['error' => 'invalid_lead', 'message' => 'A submitted lead is invalid.']);
            }
            $firstName = data_string($lead, 'firstName', 100, false);
            $lastName = data_string($lead, 'lastName', 100, false);
            $email = strtolower(data_string($lead, 'email', 254, false));
            $phone = data_string($lead, 'phone', 40, false);
            $country = data_string($lead, 'country', 100, false);
            $address = $canEditContactDetails ? data_string($lead, 'address', 500, false) : '';
            $postalCodeInput = $canEditContactDetails ? data_string($lead, 'postalCode', 24, false) : '';
            $postalCode = $postalCodeInput;
            if (preg_match('/^(\d{1,9})\.0+$/', $postalCodeInput, $postalParts) === 1) {
                $postalDigits = $postalParts[1];
                $isUnitedStates = in_array(strtolower($country), ['us', 'usa', 'united states', 'united states of america'], true)
                    || preg_match('/(?:,\s*|\s+)(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)(?:,|$)/i', $address) === 1;
                if ($isUnitedStates && strlen($postalDigits) === 9) {
                    $postalCode = substr($postalDigits, 0, 5) . '-' . substr($postalDigits, 5);
                } elseif ($isUnitedStates && strlen($postalDigits) < 5) {
                    $postalCode = str_pad($postalDigits, 5, '0', STR_PAD_LEFT);
                } else {
                    $postalCode = $postalDigits;
                }
            }
            if (preg_match('/^\d{5}(?:-\d{4})?$/', $phone) === 1) {
                if ($postalCode === '') $postalCode = $phone;
                $phone = '';
            }
            $marketingConsent = $lead['marketingConsent'] ?? false;
            if (!is_bool($marketingConsent)) {
                data_respond(400, ['error' => 'invalid_consent', 'message' => 'Marketing consent must be explicitly true or false.']);
            }
            $phoneDigits = preg_replace('/\D/', '', $phone) ?? '';
            $hasAddressOnlyIdentity = $address !== '' || $postalCode !== '';
            if (($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL))
                || ($email === '' && strlen($phoneDigits) < 7 && !$hasAddressOnlyIdentity)) {
                data_respond(400, ['error' => 'invalid_contact', 'message' => 'Each lead must have a valid email, phone number, or address.']);
            }
            $importKey = null;
            if ($email === '') {
                $nameKey = strtolower(trim($firstName)) . '|' . strtolower(trim($lastName)) . '|';
                $identitySuffix = data_lead_import_identity_suffix($phone, $address, $postalCodeInput);
                $importKey = hash('sha256', $nameKey . $identitySuffix);

                if (strlen($phoneDigits) < 7 && $address !== '') {
                    $findAddressOnlyContact->execute([$phone, $firstName, $lastName, $address]);
                    $existingAddressContact = $findAddressOnlyContact->fetch();
                    if (is_array($existingAddressContact) && $existingAddressContact['import_key'] !== $importKey) {
                        $findImportKeyOwner->execute([$importKey]);
                        $importKeyOwner = $findImportKeyOwner->fetchColumn();
                        if ($importKeyOwner === false || (int) $importKeyOwner === (int) $existingAddressContact['id']) {
                            $updateAddressOnlyImportKey->execute([$importKey, (int) $existingAddressContact['id']]);
                        }
                    }
                }
            }
            $identityValue = $email === '' ? $importKey : $email;
            $priorConsentQuery = $email === '' ? $priorConsentByImportKey : $priorConsentByEmail;
            $priorConsentQuery->execute([$identityValue]);
            $wasOptedIn = (bool) $priorConsentQuery->fetchColumn();
            $source = in_array($lead['leadSource'] ?? '', ['CSV Upload', 'Manual Entry'], true)
                ? $lead['leadSource']
                : 'Manual Entry';
            $existingOwnerQuery = $email === '' ? $existingOwnerByImportKey : $existingOwnerByEmail;
            $existingOwnerQuery->execute([$identityValue]);
            $ownerId = $existingOwnerQuery->fetchColumn();
            if ($ownerId !== false && !$canEditContactDetails && $ownerId !== null && (int) $ownerId !== $assignedStaffId) {
                data_respond(404, ['error' => 'lead_not_found', 'message' => 'A submitted contact lead is not available to this agent.']);
            }
            $canEditValue = (int) $canEditContactDetails;
            $insert->execute([
                $firstName,
                $lastName,
                $email === '' ? null : $email,
                $phone,
                $country,
                $address,
                $postalCode,
                $source,
                (int) $marketingConsent,
                (int) $marketingConsent,
                $assignedStaffId,
                $importKey,
                $canEditValue,
                $canEditValue,
                $canEditValue,
                $canEditValue,
                $canEditValue,
                $canEditValue,
            ]);
            $findQuery = $email === '' ? $findByImportKey : $findByEmail;
            $findQuery->execute([$identityValue]);
            $savedLead = $findQuery->fetch();
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

if ($method === 'POST' && $resource === 'lead-history') {
    data_require_permission('import_leads');
    if (($_SESSION['admin_role'] ?? '') !== 'admin') {
        data_respond(403, ['error' => 'admin_required', 'message' => 'Only a superadmin can import historical order records.']);
    }
    $body = data_read_json();
    $records = $body['orders'] ?? null;
    if (!is_array($records) || count($records) < 1 || count($records) > 100) {
        data_respond(400, ['error' => 'invalid_history', 'message' => 'Provide between 1 and 100 historical order records.']);
    }

    $normalizedRecords = [];
    foreach ($records as $index => $record) {
        if (!is_array($record)) {
            data_respond(400, ['error' => 'invalid_history_record', 'message' => 'A historical order record is invalid.']);
        }
        $email = strtolower(data_string($record, 'email', 254, false));
        $phone = data_string($record, 'phone', 40, false);
        $firstName = data_string($record, 'firstName', 100, false);
        $lastName = data_string($record, 'lastName', 100, false);
        $postalCode = data_string($record, 'postalCode', 24, false);
        if (preg_match('/^\d{5}(?:-\d{4})?$/', $phone) === 1) {
            if ($postalCode === '') $postalCode = $phone;
            $phone = '';
        }
        $deliveryAddress = data_string($record, 'deliveryAddress', 500, false);
        if (($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL))
            || ($email === '' && strlen(preg_replace('/\D/', '', $phone) ?? '') < 7
                && $postalCode === '' && $deliveryAddress === '')) {
            data_respond(400, ['error' => 'invalid_history_contact', 'message' => 'Each historical order needs an email, phone, or address/postal code.']);
        }
        $orderNumber = data_string($record, 'orderNumber', 100, false);
        $dateInput = data_string($record, 'placedAt', 32, false);
        $items = data_string($record, 'items', 2000, false);
        $trackingNumber = data_string($record, 'trackingNumber', 180, false);
        $carrier = data_string($record, 'carrier', 120, false);
        $sourceKey = data_string($record, 'sourceKey', 255, false);
        $sourceSheet = data_string($record, 'sourceSheet', 64, false);
        if ($orderNumber === '' && $dateInput === '' && $items === '' && $trackingNumber === '') {
            data_respond(400, ['error' => 'empty_history_record', 'message' => 'A historical order must include an order number, date, item, or tracking number.']);
        }
        $placedAt = null;
        if ($dateInput !== '') {
            if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?$/', $dateInput, $dateParts)
                || !checkdate((int) $dateParts[2], (int) $dateParts[3], (int) $dateParts[1])
                || (isset($dateParts[4]) && ((int) $dateParts[4] > 23 || (int) $dateParts[5] > 59 || (int) $dateParts[6] > 59))) {
                data_respond(400, ['error' => 'invalid_history_date', 'message' => 'Historical order dates must use YYYY-MM-DD or YYYY-MM-DD HH:MM:SS.']);
            }
            $placedAt = substr($dateInput, 0, 10) . ' ' . (isset($dateParts[4]) && $dateParts[4] !== '' ? substr($dateInput, 11) : '00:00:00');
        }
        $normalizedRecords[] = [
            'row' => $index + 1,
            'email' => $email,
            'phone' => $phone,
            'postalCode' => $postalCode,
            'firstName' => $firstName,
            'lastName' => $lastName,
            'orderNumber' => $orderNumber,
            'placedAt' => $placedAt,
            'items' => $items,
            'trackingNumber' => $trackingNumber,
            'carrier' => $carrier,
            'deliveryAddress' => $deliveryAddress,
            'sourceKey' => $sourceKey,
            'sourceSheet' => $sourceSheet,
        ];
    }

    $db = data_db();
    $findByEmail = $db->prepare('SELECT id, address, postal_code FROM leads WHERE email = ? LIMIT 1 FOR UPDATE');
    $findByImportKey = $db->prepare('SELECT id, address, postal_code FROM leads WHERE import_key = ? LIMIT 1 FOR UPDATE');
    $findByPhoneAndName = $db->prepare(
        'SELECT id, address, postal_code FROM leads WHERE phone = ? AND LOWER(first_name) = LOWER(?) AND LOWER(last_name) = LOWER(?) LIMIT 1 FOR UPDATE'
    );
    $saveHistory = $db->prepare(
        'INSERT INTO lead_order_history (lead_id, source_key, source_sheet, order_number, placed_at, items, tracking_number, carrier, delivery_address)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           source_sheet = COALESCE(source_sheet, VALUES(source_sheet)),
           order_number = COALESCE(order_number, VALUES(order_number)),
           placed_at = COALESCE(placed_at, VALUES(placed_at)),
           items = COALESCE(items, VALUES(items)),
           tracking_number = COALESCE(tracking_number, VALUES(tracking_number)),
           carrier = COALESCE(carrier, VALUES(carrier)),
           delivery_address = COALESCE(delivery_address, VALUES(delivery_address))'
    );
    $updateAddress = $db->prepare("UPDATE leads SET address = ? WHERE id = ? AND address = ''");
    $updatePostalCode = $db->prepare("UPDATE leads SET postal_code = ? WHERE id = ? AND postal_code = ''");
    $db->beginTransaction();
    try {
        foreach ($normalizedRecords as $record) {
            $lead = false;
            if ($record['email'] !== '') {
                $findByEmail->execute([$record['email']]);
                $lead = $findByEmail->fetch();
            }
            if (!$lead && strlen(preg_replace('/\D/', '', $record['phone']) ?? '') >= 7) {
                $importKey = hash(
                    'sha256',
                    strtolower(trim($record['firstName'])) . '|'
                        . strtolower(trim($record['lastName'])) . '|'
                        . (preg_replace('/\D/', '', $record['phone']) ?? '')
                );
                $findByImportKey->execute([$importKey]);
                $lead = $findByImportKey->fetch();
                if (!$lead && $record['firstName'] !== '' && $record['lastName'] !== '') {
                    $findByPhoneAndName->execute([$record['phone'], $record['firstName'], $record['lastName']]);
                    $lead = $findByPhoneAndName->fetch();
                }
            }
            if (!$lead && $record['email'] === '' && strlen(preg_replace('/\D/', '', $record['phone']) ?? '') < 7) {
                $identitySuffix = data_lead_import_identity_suffix(
                    $record['phone'],
                    $record['deliveryAddress'],
                    $record['postalCode']
                );
                $importKey = hash(
                    'sha256',
                    strtolower(trim($record['firstName'])) . '|'
                        . strtolower(trim($record['lastName'])) . '|'
                        . $identitySuffix
                );
                $findByImportKey->execute([$importKey]);
                $lead = $findByImportKey->fetch();
            }
            if (!$lead) {
                $db->rollBack();
                data_respond(404, [
                    'error' => 'history_contact_not_found',
                    'message' => 'A historical order could not be matched to an imported contact; no records in this batch were saved.',
                    'row' => $record['row'],
                ]);
            }
            $sourceIdentity = $record['sourceKey'] !== ''
                ? strtolower(trim($record['sourceKey']))
                : implode('|', [
                    (string) $lead['id'],
                    strtolower(trim($record['orderNumber'])),
                    (string) ($record['placedAt'] ?? ''),
                    strtolower(trim($record['items'])),
                    strtolower(trim($record['trackingNumber'])),
                ]);
            $saveHistory->execute([
                (int) $lead['id'],
                hash('sha256', $sourceIdentity),
                $record['sourceSheet'] !== '' ? $record['sourceSheet'] : null,
                $record['orderNumber'] !== '' ? $record['orderNumber'] : null,
                $record['placedAt'],
                $record['items'] !== '' ? $record['items'] : null,
                $record['trackingNumber'] !== '' ? $record['trackingNumber'] : null,
                $record['carrier'] !== '' ? $record['carrier'] : null,
                $record['deliveryAddress'] !== '' ? $record['deliveryAddress'] : null,
            ]);
            if ($record['deliveryAddress'] !== '' && $lead['address'] === '') {
                $updateAddress->execute([$record['deliveryAddress'], (int) $lead['id']]);
            }
            if ($record['postalCode'] !== '' && $lead['postal_code'] === '') {
                $updatePostalCode->execute([$record['postalCode'], (int) $lead['id']]);
            }
        }
        $db->commit();
    } catch (Throwable $error) {
        if ($db->inTransaction()) $db->rollBack();
        error_log('Ambients historical order import failed: ' . $error->getMessage());
        data_respond(500, ['error' => 'history_import_failed', 'message' => 'Historical order records could not be saved.']);
    }
    data_audit($db, 'lead.history_imported', 'lead', 'bulk', ['recordCount' => count($normalizedRecords)]);
    data_respond(201, ['imported' => count($normalizedRecords)]);
}

if ($method === 'POST' && $resource === 'lead-source-records') {
    data_require_permission('import_leads');
    if (($_SESSION['admin_role'] ?? '') !== 'admin') {
        data_respond(403, ['error' => 'admin_required', 'message' => 'Only a superadmin can retain source workbook details.']);
    }
    $body = data_read_json(2097152);
    $records = $body['records'] ?? null;
    if (!is_array($records) || count($records) < 1 || count($records) > 100) {
        data_respond(400, ['error' => 'invalid_source_records', 'message' => 'Provide between 1 and 100 source detail records.']);
    }

    $db = data_db();
    $findByEmail = $db->prepare('SELECT id FROM leads WHERE email = ? LIMIT 1 FOR UPDATE');
    $findByImportKey = $db->prepare('SELECT id FROM leads WHERE import_key = ? LIMIT 1 FOR UPDATE');
    $findByPhoneAndName = $db->prepare(
        'SELECT id FROM leads WHERE phone = ? AND LOWER(first_name) = LOWER(?) AND LOWER(last_name) = LOWER(?) LIMIT 1 FOR UPDATE'
    );
    $saveSourceRecord = $db->prepare(
        'INSERT INTO lead_source_records (lead_id, source_key, source_file, source_sheet, source_row, data)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           source_file = VALUES(source_file),
           source_sheet = VALUES(source_sheet),
           source_row = VALUES(source_row),
           data = VALUES(data)'
    );
    $normalizedRecords = [];
    foreach ($records as $index => $record) {
        if (!is_array($record)) {
            data_respond(400, ['error' => 'invalid_source_record', 'message' => 'A submitted source detail record is invalid.']);
        }
        $email = strtolower(data_string($record, 'email', 254, false));
        $phone = data_string($record, 'phone', 40, false);
        $firstName = data_string($record, 'firstName', 100, false);
        $lastName = data_string($record, 'lastName', 100, false);
        $address = data_string($record, 'address', 500, false);
        $postalCode = data_string($record, 'postalCode', 24, false);
        $sourceKey = data_string($record, 'sourceKey', 255);
        $sourceFile = data_string($record, 'sourceFile', 255);
        $sourceSheet = data_string($record, 'sourceSheet', 128);
        $sourceRow = filter_var($record['sourceRow'] ?? null, FILTER_VALIDATE_INT);
        $data = $record['data'] ?? null;
        if (($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL))
            || ($email === '' && strlen(preg_replace('/\D/', '', $phone) ?? '') < 7 && $address === '' && $postalCode === '')
            || $sourceRow === false || $sourceRow < 1 || !is_array($data) || count($data) > 100) {
            data_respond(400, ['error' => 'invalid_source_record', 'message' => 'Source detail data or contact provenance is invalid.']);
        }

        $safeData = [];
        foreach ($data as $key => $value) {
            if (!is_string($key) || strlen($key) > 255 || !is_string($value) || strlen($value) > 8000) {
                data_respond(400, ['error' => 'invalid_source_field', 'message' => 'A source detail field is invalid or too large.']);
            }
            if (preg_match('/(?:payment|credit|debit|card|(?:^|[^a-z])cc(?:[^a-z]|$)|cvv|cvc|ccv|security.?code|expir(?:y|ation)|medical|medication|prescription|diagnos|symptom|patient)/i', $key) === 1
                || data_has_possible_payment_card_number($value, $key)) {
                continue;
            }
            $safeData[$key] = $value;
        }
        $encodedData = json_encode($safeData, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if (!is_string($encodedData) || strlen($encodedData) > 16000) {
            data_respond(400, ['error' => 'source_record_too_large', 'message' => 'A source detail record exceeds the allowed size.']);
        }
        $normalizedRecords[] = [
            'row' => $index + 1,
            'email' => $email,
            'phone' => $phone,
            'firstName' => $firstName,
            'lastName' => $lastName,
            'address' => $address,
            'postalCode' => $postalCode,
            'sourceKey' => $sourceKey,
            'sourceFile' => $sourceFile,
            'sourceSheet' => $sourceSheet,
            'sourceRow' => $sourceRow,
            'data' => $encodedData,
        ];
    }

    $db->beginTransaction();
    try {
        foreach ($normalizedRecords as $record) {
            $lead = false;
            if ($record['email'] !== '') {
                $findByEmail->execute([$record['email']]);
                $lead = $findByEmail->fetch();
            }
            $phoneDigits = preg_replace('/\D/', '', $record['phone']) ?? '';
            if (!$lead && strlen($phoneDigits) >= 7) {
                $importKey = hash(
                    'sha256',
                    strtolower(trim($record['firstName'])) . '|'
                        . strtolower(trim($record['lastName'])) . '|' . $phoneDigits
                );
                $findByImportKey->execute([$importKey]);
                $lead = $findByImportKey->fetch();
                if (!$lead && $record['firstName'] !== '' && $record['lastName'] !== '') {
                    $findByPhoneAndName->execute([$record['phone'], $record['firstName'], $record['lastName']]);
                    $lead = $findByPhoneAndName->fetch();
                }
            }
            if (!$lead && $record['email'] === '' && strlen($phoneDigits) < 7) {
                $identitySuffix = data_lead_import_identity_suffix(
                    $record['phone'],
                    $record['address'],
                    $record['postalCode']
                );
                $importKey = hash(
                    'sha256',
                    strtolower(trim($record['firstName'])) . '|'
                        . strtolower(trim($record['lastName'])) . '|' . $identitySuffix
                );
                $findByImportKey->execute([$importKey]);
                $lead = $findByImportKey->fetch();
            }
            if (!$lead) {
                $db->rollBack();
                data_respond(404, [
                    'error' => 'source_contact_not_found',
                    'message' => 'A source detail record could not be matched to an imported contact; no records in this batch were saved.',
                    'row' => $record['row'],
                ]);
            }
            $identity = implode('|', [
                $record['sourceKey'],
                $record['sourceFile'],
                $record['sourceSheet'],
                (string) $record['sourceRow'],
                (string) $lead['id'],
            ]);
            $saveSourceRecord->execute([
                (int) $lead['id'],
                hash('sha256', $identity),
                $record['sourceFile'],
                $record['sourceSheet'],
                $record['sourceRow'],
                $record['data'],
            ]);
        }
        $db->commit();
    } catch (Throwable $error) {
        if ($db->inTransaction()) $db->rollBack();
        error_log('Ambients lead source detail import failed: ' . $error->getMessage());
        data_respond(500, ['error' => 'source_import_failed', 'message' => 'Source detail records could not be saved.']);
    }
    data_audit($db, 'lead.source_records_imported', 'lead', 'bulk', ['recordCount' => count($normalizedRecords)]);
    data_respond(201, ['imported' => count($normalizedRecords)]);
}

if ($method === 'POST' && $resource === 'lead-assignment-notifications') {
    data_require_permission('leads');
    if (($_SESSION['admin_role'] ?? '') !== 'operator' || (int) ($_SESSION['staff_id'] ?? 0) < 1) {
        data_respond(403, ['error' => 'agent_required', 'message' => 'Only an active agent can acknowledge lead assignment notifications.']);
    }
    $body = data_read_json(8192);
    $rawIds = $body['ids'] ?? null;
    if (!is_array($rawIds) || count($rawIds) < 1 || count($rawIds) > 50) {
        data_respond(400, ['error' => 'invalid_notification_ids', 'message' => 'Select between 1 and 50 valid notifications.']);
    }
    $notificationIds = [];
    foreach ($rawIds as $rawId) {
        $notificationId = filter_var($rawId, FILTER_VALIDATE_INT);
        if ($notificationId === false || $notificationId < 1) {
            data_respond(400, ['error' => 'invalid_notification_ids', 'message' => 'The notification identifiers are invalid.']);
        }
        $notificationIds[] = (int) $notificationId;
    }
    $notificationIds = array_values(array_unique($notificationIds));
    $placeholders = implode(', ', array_fill(0, count($notificationIds), '?'));
    $db = data_db();
    $update = $db->prepare(
        "UPDATE lead_assignment_notifications SET read_at = UTC_TIMESTAMP()
         WHERE staff_id = ? AND read_at IS NULL AND id IN ({$placeholders})"
    );
    $update->execute([(int) $_SESSION['staff_id'], ...$notificationIds]);
    data_respond(200, ['markedRead' => $update->rowCount()]);
}

if ($method === 'POST' && $resource === 'lead-assignments') {
    data_require_admin('admin');
    $body = data_read_json(262144);
    $rawIds = $body['leadIds'] ?? null;
    $mode = $body['mode'] ?? null;
    if (!is_array($rawIds) || count($rawIds) < 1 || count($rawIds) > 500
        || !in_array($mode, ['manual', 'least_loaded'], true)) {
        data_respond(400, ['error' => 'invalid_lead_assignments', 'message' => 'Provide up to 500 lead IDs and a valid assignment mode.']);
    }
    $leadIds = [];
    foreach ($rawIds as $rawId) {
        $leadId = filter_var($rawId, FILTER_VALIDATE_INT);
        if ($leadId === false || $leadId < 1) {
            data_respond(400, ['error' => 'invalid_lead_assignments', 'message' => 'One or more lead identifiers are invalid.']);
        }
        $leadIds[] = (int) $leadId;
    }
    $leadIds = array_values(array_unique($leadIds));
    sort($leadIds);
    if ($mode === 'manual') {
        $assignedStaffId = $body['assignedStaffId'] ?? null;
        if ($assignedStaffId !== null && (!is_int($assignedStaffId) || $assignedStaffId < 1)) {
            data_respond(400, ['error' => 'invalid_lead_assignment', 'message' => 'Choose an active agent or leave the leads unassigned.']);
        }
    } else {
        $assignedStaffId = null;
    }

    $db = data_db();
    $db->beginTransaction();
    try {
        $staffRows = $db->query(
            'SELECT id, email, display_name, role, is_active, permissions
             FROM staff_users WHERE role = \'operator\' AND is_active = 1 ORDER BY id FOR UPDATE'
        )->fetchAll();
        $eligibleAgents = [];
        foreach ($staffRows as $staffRow) {
            if (data_staff_can_handle_leads($staffRow)) {
                $staffId = (int) $staffRow['id'];
                $eligibleAgents[$staffId] = [
                    'id' => $staffId,
                    'displayName' => trim((string) $staffRow['display_name']) ?: (string) $staffRow['email'],
                    'email' => (string) $staffRow['email'],
                ];
            }
        }
        if ($mode === 'least_loaded' && $eligibleAgents === []) {
            $db->rollBack();
            data_respond(409, ['error' => 'no_eligible_lead_agents', 'message' => 'No active agent with Leads permission is available for assignment.']);
        }
        if ($mode === 'manual' && $assignedStaffId !== null && !isset($eligibleAgents[$assignedStaffId])) {
            $db->rollBack();
            data_respond(400, ['error' => 'invalid_lead_assignment', 'message' => 'Choose an active agent with Leads permission or leave the leads unassigned.']);
        }

        $leadPlaceholders = implode(', ', array_fill(0, count($leadIds), '?'));
        $findLeads = $db->prepare(
            "SELECT l.id, l.assigned_staff_id, s.display_name AS previous_staff_name, s.email AS previous_staff_email
             FROM leads l LEFT JOIN staff_users s ON s.id = l.assigned_staff_id
             WHERE l.id IN ({$leadPlaceholders}) ORDER BY l.id FOR UPDATE"
        );
        $findLeads->execute($leadIds);
        $leadRows = $findLeads->fetchAll();
        if (count($leadRows) !== count($leadIds)) {
            $db->rollBack();
            data_respond(404, ['error' => 'lead_not_found', 'message' => 'One or more selected leads no longer exist. Refresh the table and try again.']);
        }
        if ($mode === 'least_loaded') {
            foreach ($leadRows as $leadRow) {
                if ($leadRow['assigned_staff_id'] !== null) {
                    $db->rollBack();
                    data_respond(409, ['error' => 'lead_already_assigned', 'message' => 'Least-loaded assignment only accepts unassigned leads. Refresh the unassigned queue and try again.']);
                }
            }
            $agentIds = array_keys($eligibleAgents);
            $agentPlaceholders = implode(', ', array_fill(0, count($agentIds), '?'));
            $loadQuery = $db->prepare(
                "SELECT assigned_staff_id, COUNT(*) AS lead_count FROM leads
                 WHERE assigned_staff_id IN ({$agentPlaceholders}) GROUP BY assigned_staff_id"
            );
            $loadQuery->execute($agentIds);
            $workload = array_fill_keys($agentIds, 0);
            foreach ($loadQuery->fetchAll() as $load) {
                $workload[(int) $load['assigned_staff_id']] = (int) $load['lead_count'];
            }
        } else {
            $workload = [];
        }

        $updateLead = $db->prepare('UPDATE leads SET assigned_staff_id = ? WHERE id = ?');
        $notifyAgent = $db->prepare(
            'INSERT INTO lead_assignment_notifications (staff_id, lead_id, assigned_by_name)
             VALUES (?, ?, ?)'
        );
        $clearStaleNotifications = $db->prepare(
            'DELETE FROM lead_assignment_notifications WHERE lead_id = ? AND read_at IS NULL AND staff_id <> ?'
        );
        $actorName = trim((string) ($_SESSION['admin_display_name'] ?? ''));
        if ($actorName === '') $actorName = (string) ($_SESSION['admin_email'] ?? 'Administrator');
        $assignments = [];
        $changedCount = 0;
        foreach ($leadRows as $leadRow) {
            $leadId = (int) $leadRow['id'];
            $previousStaffId = $leadRow['assigned_staff_id'] === null ? null : (int) $leadRow['assigned_staff_id'];
            if ($mode === 'least_loaded') {
                $minimumLoad = min($workload);
                $candidateIds = array_keys(array_filter($workload, static fn (int $load): bool => $load === $minimumLoad));
                sort($candidateIds);
                $nextStaffId = (int) $candidateIds[0];
                $workload[$nextStaffId]++;
            } else {
                $nextStaffId = $assignedStaffId;
            }
            $changed = $previousStaffId !== $nextStaffId;
            if ($changed) {
                $updateLead->execute([$nextStaffId, $leadId]);
                $changedCount++;
                $previousName = $previousStaffId === null
                    ? null
                    : (trim((string) $leadRow['previous_staff_name']) ?: (string) $leadRow['previous_staff_email']);
                $nextName = $nextStaffId === null ? null : $eligibleAgents[$nextStaffId]['displayName'];
                data_audit($db, 'lead.assignment_changed', 'lead', (string) $leadId, [
                    'previousStaffId' => $previousStaffId,
                    'previousStaffName' => $previousName,
                    'assignedStaffId' => $nextStaffId,
                    'assignedStaffName' => $nextName,
                    'strategy' => $mode,
                    'actorName' => $actorName,
                ]);
                $clearStaleNotifications->execute([$leadId, $nextStaffId ?? 0]);
                if ($nextStaffId !== null) {
                    $notifyAgent->execute([$nextStaffId, $leadId, $actorName]);
                }
            }
            $assignments[] = [
                'leadId' => $leadId,
                'assignedStaffId' => $nextStaffId,
                'assignedStaffName' => $nextStaffId === null ? null : $eligibleAgents[$nextStaffId]['displayName'],
            ];
        }
        $db->commit();
    } catch (Throwable $error) {
        if ($db->inTransaction()) $db->rollBack();
        error_log('Ambients bulk lead assignment failed: ' . $error->getMessage());
        data_respond(500, ['error' => 'lead_assignment_failed', 'message' => 'No selected leads were assigned. Please try again.']);
    }
    data_respond(200, [
        'assignedCount' => $changedCount,
        'processedCount' => count($assignments),
        'assignments' => $assignments,
    ]);
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
    $email = $emailProvided ? strtolower(data_string($body, 'email', 254, false)) : null;
    if ($emailProvided && $email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        data_respond(400, ['error' => 'invalid_email', 'message' => 'Provide a valid email address.']);
    }
    $phoneProvided = array_key_exists('phone', $body);
    $phone = $phoneProvided ? data_string($body, 'phone', 40, false) : null;
    $countryProvided = array_key_exists('country', $body);
    $country = $countryProvided ? data_string($body, 'country', 100, false) : null;
    $addressProvided = array_key_exists('address', $body);
    $address = $addressProvided ? data_string($body, 'address', 500, false) : null;
    $postalCodeProvided = array_key_exists('postalCode', $body);
    $postalCode = $postalCodeProvided ? data_string($body, 'postalCode', 24, false) : null;
    if ($phoneProvided && preg_match('/^\d{5}(?:-\d{4})?$/', $phone) === 1) {
        if (!$postalCodeProvided || $postalCode === '') {
            $postalCode = $phone;
            $postalCodeProvided = true;
        }
        $phone = '';
    }
    $contactDetailsProvided = $firstNameProvided || $lastNameProvided || $emailProvided || $phoneProvided || $countryProvided || $addressProvided || $postalCodeProvided;
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
    $validStatuses = ['New', 'Cold', 'Contacted', 'Qualified', 'Customer', 'Inactive'];
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
            $activeStaff = $db->prepare('SELECT id, email, display_name, role, is_active, permissions FROM staff_users WHERE id = ? FOR UPDATE');
            $activeStaff->execute([$assignedStaffId]);
            $staffRow = $activeStaff->fetch();
            if (!is_array($staffRow) || !data_staff_can_handle_leads($staffRow)) {
                $db->rollBack();
                data_respond(400, ['error' => 'invalid_lead_assignment', 'message' => 'Choose an active agent with Leads permission or leave the lead unassigned.']);
            }
        }
        $find = $db->prepare(
            'SELECT l.id, l.first_name, l.last_name, l.email, l.phone, l.country, l.address, l.postal_code,
                    l.status, l.marketing_consent, l.assigned_staff_id,
                    s.display_name AS assigned_staff_name, s.email AS assigned_staff_email
             FROM leads l LEFT JOIN staff_users s ON s.id = l.assigned_staff_id
             WHERE l.id = ? FOR UPDATE'
        );
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
        $emailValue = $emailProvided ? ($email === '' ? null : $email) : $current['email'];
        $phoneValue = $phoneProvided ? $phone : (string) ($current['phone'] ?? '');
        $addressValue = $addressProvided ? $address : (string) ($current['address'] ?? '');
        $postalCodeValue = $postalCodeProvided ? $postalCode : (string) ($current['postal_code'] ?? '');
        $finalFirstName = $firstNameProvided ? $firstName : (string) $current['first_name'];
        $finalLastName = $lastNameProvided ? $lastName : (string) $current['last_name'];
        $hasAddressOnlyIdentity = $addressValue !== '' || $postalCodeValue !== '';
        if ($emailValue === null
            && strlen(preg_replace('/\D/', '', $phoneValue) ?? '') < 7
            && !$hasAddressOnlyIdentity) {
            $db->rollBack();
            data_respond(400, ['error' => 'invalid_contact', 'message' => 'A lead must have an email, phone, address, or postal code.']);
        }
        if ($emailProvided && $emailValue !== $current['email']) {
            if ($emailValue !== null) {
                $duplicate = $db->prepare('SELECT id FROM leads WHERE email = ? AND id <> ? LIMIT 1 FOR UPDATE');
                $duplicate->execute([$emailValue, $id]);
                if ($duplicate->fetchColumn()) {
                    $db->rollBack();
                    data_respond(409, ['error' => 'lead_email_in_use', 'message' => 'Another lead already uses this email address.']);
                }
                $existingOrder = $db->prepare('SELECT id FROM orders WHERE email = ? LIMIT 1 FOR UPDATE');
                $existingOrder->execute([$emailValue]);
                if ($existingOrder->fetchColumn()) {
                    $db->rollBack();
                    data_respond(409, ['error' => 'lead_email_has_orders', 'message' => 'This email address is already associated with other order history.']);
                }
            } elseif ($current['email'] !== null) {
                $existingOrder = $db->prepare('SELECT id FROM orders WHERE email = ? LIMIT 1 FOR UPDATE');
                $existingOrder->execute([$current['email']]);
                if ($existingOrder->fetchColumn()) {
                    $db->rollBack();
                    data_respond(409, ['error' => 'lead_email_has_orders', 'message' => 'An email address linked to order history cannot be removed.']);
                }
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
        if ($emailProvided && $emailValue !== $current['email']) {
            $updates[] = 'email = ?';
            $parameters[] = $emailValue;
            $changedContactFields[] = 'email';
            if ($emailValue !== null && $current['email'] !== null) {
                $db->prepare('UPDATE orders SET email = ? WHERE email = ?')->execute([$emailValue, $current['email']]);
            }
            if ($emailValue !== null) {
                $updates[] = 'import_key = NULL';
            }
        }
        if ($emailValue === null && ($firstNameProvided || $lastNameProvided || $phoneProvided || $emailProvided || $addressProvided || $postalCodeProvided)) {
            $phoneDigits = preg_replace('/\D/', '', $phoneValue) ?? '';
            $identitySuffix = data_lead_import_identity_suffix($phoneValue, $addressValue, $postalCodeValue);
            $finalImportKey = hash('sha256', strtolower(trim($finalFirstName)) . '|' . strtolower(trim($finalLastName)) . '|' . $identitySuffix);
            $duplicateKey = $db->prepare('SELECT id FROM leads WHERE import_key = ? AND id <> ? LIMIT 1 FOR UPDATE');
            $duplicateKey->execute([$finalImportKey, $id]);
            if ($duplicateKey->fetchColumn()) {
                $db->rollBack();
                data_respond(409, ['error' => 'lead_contact_in_use', 'message' => 'Another contact already has these identifying details.']);
            }
            $updates[] = 'import_key = ?';
            $parameters[] = $finalImportKey;
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
        if ($addressProvided && $address !== $current['address']) {
            $updates[] = 'address = ?';
            $parameters[] = $address;
            $changedContactFields[] = 'address';
        }
        if ($postalCodeProvided && $postalCode !== $current['postal_code']) {
            $updates[] = 'postal_code = ?';
            $parameters[] = $postalCode;
            $changedContactFields[] = 'postalCode';
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
            $previousStaffId = $current['assigned_staff_id'] === null ? null : (int) $current['assigned_staff_id'];
            if ($previousStaffId !== $assignedStaffId) {
                $updates[] = 'assigned_staff_id = ?';
                $parameters[] = $assignedStaffId;
                $previousName = $previousStaffId === null
                    ? null
                    : (trim((string) $current['assigned_staff_name']) ?: (string) $current['assigned_staff_email']);
                $nextName = null;
                if ($assignedStaffId !== null) {
                    $nextName = trim((string) ($staffRow['display_name'] ?? '')) ?: (string) ($staffRow['email'] ?? '');
                }
                data_audit($db, 'lead.assignment_changed', 'lead', (string) $id, [
                    'previousStaffId' => $previousStaffId,
                    'previousStaffName' => $previousName,
                    'assignedStaffId' => $assignedStaffId,
                    'assignedStaffName' => $nextName,
                    'strategy' => 'manual',
                    'actorName' => (string) ($_SESSION['admin_display_name'] ?? $_SESSION['admin_email'] ?? 'Administrator'),
                ]);
                $db->prepare(
                    'DELETE FROM lead_assignment_notifications WHERE lead_id = ? AND read_at IS NULL AND staff_id <> ?'
                )->execute([(int) $id, $assignedStaffId ?? 0]);
                if ($assignedStaffId !== null) {
                    $db->prepare(
                        'INSERT INTO lead_assignment_notifications (staff_id, lead_id, assigned_by_name)
                         VALUES (?, ?, ?)'
                    )->execute([
                        $assignedStaffId,
                        (int) $id,
                        (string) ($_SESSION['admin_display_name'] ?? $_SESSION['admin_email'] ?? 'Administrator'),
                    ]);
                }
            }
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
        'SELECT l.id, l.first_name, l.last_name, l.email, l.phone, l.country, l.address, l.postal_code, l.lead_source, l.status, l.marketing_consent, l.marketing_consent_at, l.created_at,
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

if ($method === 'POST' && $resource === 'order-capture') {
    data_require_admin('admin');
    $body = data_read_json();
    $orderId = data_string($body, 'orderId', 64);
    $db = data_db();
    $find = $db->prepare('SELECT * FROM orders WHERE id = ? FOR UPDATE');
    $db->beginTransaction();
    try {
        $find->execute([$orderId]);
        $order = $find->fetch();
        if (!is_array($order)) {
            $db->rollBack();
            data_respond(404, ['error' => 'order_not_found', 'message' => 'The order was not found.']);
        }
        if ($order['payment_status'] === 'Paid') {
            $db->commit();
            data_respond(200, ['order' => data_order_row($db, $order)]);
        }
        if ($order['payment_method'] !== 'Credit / Debit Card' || $order['payment_status'] !== 'Authorized'
            || !is_string($order['stripe_payment_intent_id']) || $order['stripe_payment_intent_id'] === '') {
            $db->rollBack();
            data_respond(409, ['error' => 'payment_not_capturable', 'message' => 'This order does not have an authorized Stripe card payment to capture.']);
        }
        $intent = data_stripe_request(
            'POST',
            '/v1/payment_intents/' . rawurlencode($order['stripe_payment_intent_id']) . '/capture',
            [],
            'ambienta-order-capture-' . $orderId
        );
        if (($intent['status'] ?? '') !== 'succeeded') {
            $db->rollBack();
            data_respond(409, ['error' => 'payment_capture_failed', 'message' => 'Stripe did not confirm the card payment capture.']);
        }
        $update = $db->prepare('UPDATE orders SET payment_status = ? WHERE id = ? AND payment_status = ?');
        $update->execute(['Paid', $orderId, 'Authorized']);
        if ($update->rowCount() === 1) {
            data_audit($db, 'order.payment_captured', 'order', $orderId, ['orderNumber' => $order['order_number']]);
        }
        $db->commit();
        $find->execute([$orderId]);
        $savedOrder = $find->fetch();
        if (!is_array($savedOrder)) data_respond(404, ['error' => 'order_not_found', 'message' => 'The order could not be reloaded.']);
        data_respond(200, ['order' => data_order_row($db, $savedOrder)]);
    } catch (Throwable $error) {
        if ($db->inTransaction()) $db->rollBack();
        error_log('Ambients Stripe payment capture failed: ' . $error->getMessage());
        data_respond(502, ['error' => 'payment_capture_failed', 'message' => 'Stripe could not capture this authorization. Confirm its status in Stripe before retrying.']);
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
        $find = $db->prepare('SELECT status, carrier, tracking_number, payment_status, payment_method, stripe_checkout_session_id, stripe_payment_intent_id FROM orders WHERE id = ? FOR UPDATE');
        $find->execute([$id]);
        $current = $find->fetch();
        if (!$current) {
            $db->rollBack();
            data_respond(404, ['error' => 'order_not_found', 'message' => 'The order was not found.']);
        }
        $nextCarrier = $carrierProvided ? ($carrier === '' ? null : $carrier) : $current['carrier'];
        $nextTrackingNumber = $trackingNumberProvided ? ($trackingNumber === '' ? null : $trackingNumber) : $current['tracking_number'];
        $nextPaymentStatus = $current['payment_status'];
        if ($current['status'] !== 'Cancelled' && $status === 'Cancelled') {
            if ($current['payment_status'] === 'Paid') {
                $db->rollBack();
                data_respond(409, ['error' => 'refund_required', 'message' => 'Record a refund with the payment provider before cancelling the paid order.']);
            }
            if ($current['payment_status'] === 'Awaiting Payment' && is_string($current['stripe_checkout_session_id'])) {
                data_stripe_request(
                    'POST',
                    '/v1/checkout/sessions/' . rawurlencode($current['stripe_checkout_session_id']) . '/expire',
                    [],
                    'ambienta-order-cancel-' . $id
                );
                $nextPaymentStatus = 'Payment Failed';
            } elseif ($current['payment_status'] === 'Authorized' && is_string($current['stripe_payment_intent_id'])) {
                $intent = data_stripe_request(
                    'POST',
                    '/v1/payment_intents/' . rawurlencode($current['stripe_payment_intent_id']) . '/cancel',
                    [],
                    'ambienta-order-cancel-' . $id
                );
                if (($intent['status'] ?? '') !== 'canceled') {
                    $db->rollBack();
                    data_respond(409, ['error' => 'authorization_cancel_failed', 'message' => 'The card authorization could not be cancelled in Stripe.']);
                }
                $nextPaymentStatus = 'Payment Failed';
            }
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
        $update = $db->prepare('UPDATE orders SET status = ?, carrier = ?, tracking_number = ?, payment_status = ? WHERE id = ?');
        $update->execute([$status, $nextCarrier, $nextTrackingNumber, $nextPaymentStatus, $id]);
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
