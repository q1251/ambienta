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
            lead_source VARCHAR(24) NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY leads_email (email)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    $db->exec(
        "CREATE TABLE IF NOT EXISTS products (
            id VARCHAR(64) NOT NULL PRIMARY KEY,
            name VARCHAR(180) NOT NULL,
            category VARCHAR(32) NOT NULL,
            description TEXT NOT NULL,
            rx_required TINYINT(1) NOT NULL DEFAULT 0,
            dosage VARCHAR(120) NOT NULL DEFAULT '',
            sku VARCHAR(80) NOT NULL DEFAULT '',
            ndc_code VARCHAR(32) NULL,
            image VARCHAR(500) NULL,
            min_stock_threshold INT UNSIGNED NOT NULL DEFAULT 0,
            cost_price DECIMAL(10,2) NULL,
            copay_price DECIMAL(10,2) NULL,
            price DECIMAL(10,2) NOT NULL,
            stock_count INT UNSIGNED NOT NULL,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            last_restocked DATE NULL,
            UNIQUE KEY products_sku (sku)
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
            KEY orders_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    $db->exec(
        "CREATE TABLE IF NOT EXISTS order_items (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            order_id VARCHAR(64) NOT NULL,
            product_id VARCHAR(64) NOT NULL,
            product_name VARCHAR(180) NOT NULL,
            category VARCHAR(32) NOT NULL,
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

    $databaseName = (string) $db->query('SELECT DATABASE()')->fetchColumn();
    $legacyColumns = [
        'category' => "VARCHAR(32) NOT NULL DEFAULT 'Daily Wellness'",
        'description' => 'TEXT NULL',
        'rx_required' => 'TINYINT(1) NOT NULL DEFAULT 0',
        'dosage' => "VARCHAR(120) NOT NULL DEFAULT ''",
        'sku' => "VARCHAR(80) NOT NULL DEFAULT ''",
        'ndc_code' => 'VARCHAR(32) NULL',
        'image' => 'VARCHAR(500) NULL',
        'min_stock_threshold' => 'INT UNSIGNED NOT NULL DEFAULT 0',
        'cost_price' => 'DECIMAL(10,2) NULL',
        'copay_price' => 'DECIMAL(10,2) NULL',
        'last_restocked' => 'DATE NULL',
    ];
    foreach ($legacyColumns as $column => $definition) {
        $check = $db->prepare('SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?');
        $check->execute([$databaseName, 'products', $column]);
        if ((int) $check->fetchColumn() === 0) {
            $db->exec("ALTER TABLE products ADD COLUMN `$column` $definition");
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
}

function data_require_admin(): void
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
        || !is_int($lastActivity)
        || $lastActivity < time() - 28800
    ) {
        data_respond(401, ['error' => 'unauthorized', 'message' => 'Sign in to access this resource.']);
    }
    $_SESSION['last_activity'] = time();
}

function data_read_json(): array
{
    $contentType = strtolower(trim(explode(';', (string) ($_SERVER['CONTENT_TYPE'] ?? ''))[0]));
    if ($contentType !== 'application/json') {
        data_respond(415, ['error' => 'unsupported_media_type', 'message' => 'Requests must use application/json.']);
    }
    $raw = file_get_contents('php://input');
    if ($raw === false || strlen($raw) > 262144) {
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

function data_lead_row(array $row): array
{
    return [
        'id' => (int) $row['id'],
        'firstName' => $row['first_name'],
        'lastName' => $row['last_name'],
        'email' => $row['email'],
        'phone' => $row['phone'],
        'leadSource' => $row['lead_source'],
        'createdAt' => $row['created_at'],
    ];
}

function data_product_row(array $row): array
{
    $stock = (int) $row['stock_count'];
    return [
        'id' => $row['id'],
        'name' => $row['name'],
        'category' => $row['category'],
        'description' => $row['description'],
        'rxRequired' => (bool) $row['rx_required'],
        'dosage' => $row['dosage'],
        'sku' => $row['sku'],
        'ndcCode' => $row['ndc_code'],
        'image' => $row['image'],
        'price' => (float) $row['price'],
        'costPrice' => $row['cost_price'] === null ? null : (float) $row['cost_price'],
        'copayPrice' => $row['copay_price'] === null ? null : (float) $row['copay_price'],
        'stockCount' => $stock,
        'minStockThreshold' => (int) $row['min_stock_threshold'],
        'inStock' => $stock > 0 && (bool) $row['is_active'],
        'lastRestocked' => $row['last_restocked'],
    ];
}

function data_audit(PDO $db, string $action, string $entityType, string $entityId, array $details = []): void
{
    $encoded = json_encode($details, JSON_UNESCAPED_SLASHES);
    if ($encoded === false) {
        throw new RuntimeException('Audit detail encoding failed.');
    }
    $actor = is_string($_SESSION['admin_email'] ?? null) ? $_SESSION['admin_email'] : 'unknown';
    $db->prepare(
        'INSERT INTO admin_audit_log (actor_email, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)'
    )->execute([$actor, $action, $entityType, $entityId, $encoded]);
}

function data_product_input(array $body, bool $isUpdate): array
{
    $id = $isUpdate ? data_string($body, 'id', 64) : data_string($body, 'id', 64);
    $name = data_string($body, 'name', 180);
    $category = data_string($body, 'category', 32);
    $description = data_string($body, 'description', 3000, false);
    $dosage = data_string($body, 'dosage', 120, false);
    $sku = data_string($body, 'sku', 80);
    $ndc = data_string($body, 'ndcCode', 32, false);
    $image = data_string($body, 'image', 500, false);
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
    if (($cost !== null && (!is_numeric($cost) || (float) $cost < 0)) || ($copay !== null && (!is_numeric($copay) || (float) $copay < 0))) {
        data_respond(400, ['error' => 'invalid_price', 'message' => 'Cost and copay must be non-negative amounts.']);
    }
    if (!is_bool($body['rxRequired'] ?? null)) {
        data_respond(400, ['error' => 'invalid_product', 'message' => 'Prescription status must be specified.']);
    }
    $validCategories = ['Sleep', 'Weight Loss', 'Energy & Focus', 'Heart & Circulation', 'Digestive Health', 'Daily Wellness', 'Pain & Recovery'];
    if (!in_array($category, $validCategories, true)) {
        data_respond(400, ['error' => 'invalid_category', 'message' => 'Choose a supported product category.']);
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
        'image' => $image === '' ? null : $image,
        'price' => round((float) $price, 2),
        'costPrice' => $cost === null ? null : round((float) $cost, 2),
        'copayPrice' => $copay === null ? null : round((float) $copay, 2),
        'stockCount' => $stock,
        'minStockThreshold' => $minimum,
        'inStock' => $stock > 0,
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

if ($method === 'GET' && $resource === 'catalog') {
    $db = data_db();
    $rows = $db->query('SELECT * FROM products WHERE is_active = 1 ORDER BY name')->fetchAll();
    data_respond(200, ['products' => array_map('data_product_row', $rows)]);
}

if ($method === 'GET') {
    data_require_admin();
    $db = data_db();
    if ($resource === 'leads') {
        $rows = $db->query('SELECT id, first_name, last_name, email, phone, lead_source, created_at FROM leads ORDER BY id DESC')->fetchAll();
        data_respond(200, ['leads' => array_map('data_lead_row', $rows)]);
    }
    if ($resource === 'orders') {
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
            $where[] = '(order_number LIKE ? OR customer_name LIKE ? OR email LIKE ?)';
            array_push($parameters, '%' . $query . '%', '%' . $query . '%', '%' . $query . '%');
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
        $rows = $db->query('SELECT id, actor_email, action, entity_type, entity_id, details, created_at FROM admin_audit_log ORDER BY id DESC LIMIT 200')->fetchAll();
        foreach ($rows as &$row) {
            $row['details'] = $row['details'] === null ? null : json_decode($row['details'], true);
        }
        unset($row);
        data_respond(200, ['entries' => $rows]);
    }
    data_respond(404, ['error' => 'not_found', 'message' => 'The requested resource was not found.']);
}

if ($method === 'POST' && $resource === 'products') {
    data_require_admin();
    $body = data_read_json();
    $product = data_product_input($body, false);
    $db = data_db();
    $db->beginTransaction();
    try {
        $db->prepare(
            'INSERT INTO products (id, name, category, description, rx_required, dosage, sku, ndc_code, image, price, cost_price, copay_price, stock_count, min_stock_threshold, is_active, last_restocked)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)'
        )->execute([
            $product['id'], $product['name'], $product['category'], $product['description'],
            (int) $product['rxRequired'], $product['dosage'], $product['sku'], $product['ndcCode'],
            $product['image'], $product['price'], $product['costPrice'], $product['copayPrice'],
            $product['stockCount'], $product['minStockThreshold'], $product['stockCount'] > 0 ? gmdate('Y-m-d') : null,
        ]);
        data_audit($db, 'product.created', 'product', $product['id'], ['sku' => $product['sku']]);
        $db->commit();
    } catch (Throwable $error) {
        if ($db->inTransaction()) $db->rollBack();
        if ($error instanceof PDOException && (string) $error->getCode() === '23000') {
            data_respond(409, ['error' => 'product_conflict', 'message' => 'The product ID or SKU is already in use.']);
        }
        error_log('Ambients product creation failed: ' . $error->getMessage());
        data_respond(500, ['error' => 'product_create_failed', 'message' => 'The product could not be saved.']);
    }
    $find = $db->prepare('SELECT * FROM products WHERE id = ?');
    $find->execute([$product['id']]);
    data_respond(201, ['product' => data_product_row($find->fetch())]);
}

if ($method === 'PATCH' && $resource === 'products') {
    data_require_admin();
    $body = data_read_json();
    $db = data_db();
    if (isset($body['bulkPercent'])) {
        $percent = $body['bulkPercent'];
        $category = data_string($body, 'category', 32);
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

    $product = data_product_input($body, true);
    $db->beginTransaction();
    try {
        $update = $db->prepare(
            'UPDATE products SET name = ?, category = ?, description = ?, rx_required = ?, dosage = ?, sku = ?, ndc_code = ?, image = ?,
             price = ?, cost_price = ?, copay_price = ?, stock_count = ?, min_stock_threshold = ?, is_active = 1,
             last_restocked = IF(stock_count < ?, CURDATE(), last_restocked) WHERE id = ? AND is_active = 1'
        );
        $update->execute([
            $product['name'], $product['category'], $product['description'], (int) $product['rxRequired'],
            $product['dosage'], $product['sku'], $product['ndcCode'], $product['image'], $product['price'],
            $product['costPrice'], $product['copayPrice'], $product['stockCount'], $product['minStockThreshold'],
            $product['stockCount'], $product['id'],
        ]);
        if ($update->rowCount() === 0) {
            $check = $db->prepare('SELECT id FROM products WHERE id = ? AND is_active = 1');
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
    data_require_admin();
    $id = data_string($_GET, 'id', 64);
    $db = data_db();
    $db->beginTransaction();
    try {
        $update = $db->prepare('UPDATE products SET is_active = 0 WHERE id = ? AND is_active = 1');
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
            $totalAmount, 'Cash on Delivery / Pickup', 'Pending Verification', 'Submitted', $placedAt,
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
             ON DUPLICATE KEY UPDATE first_name = VALUES(first_name), last_name = VALUES(last_name), phone = VALUES(phone)"
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
    data_require_admin();
    $body = data_read_json();
    $leads = $body['leads'] ?? null;
    if (!is_array($leads) || count($leads) < 1 || count($leads) > 500) {
        data_respond(400, ['error' => 'invalid_leads', 'message' => 'Provide between 1 and 500 contact leads.']);
    }

    $db = data_db();
    $insert = $db->prepare(
        'INSERT INTO leads (first_name, last_name, email, phone, lead_source) VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE first_name = VALUES(first_name), last_name = VALUES(last_name), phone = VALUES(phone)'
    );
    $find = $db->prepare('SELECT id, first_name, last_name, email, phone, lead_source, created_at FROM leads WHERE email = ?');
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
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                data_respond(400, ['error' => 'invalid_email', 'message' => 'A lead has an invalid email address.']);
            }
            $source = in_array($lead['leadSource'] ?? '', ['CSV Upload', 'Manual Entry'], true)
                ? $lead['leadSource']
                : 'Manual Entry';
            $insert->execute([$firstName, $lastName, $email, $phone, $source]);
            $find->execute([$email]);
            $saved[] = data_lead_row($find->fetch());
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

if ($method === 'POST' && $resource === 'order-notes') {
    data_require_admin();
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
    data_require_admin();
    $body = data_read_json();
    $id = data_string($body, 'id', 64);
    $status = data_string($body, 'status', 32);
    $allowedStatuses = ['Submitted', 'Pharmacist Review', 'Dispensing', 'Ready for Pickup', 'Shipped', 'Completed', 'Cancelled'];
    if (!in_array($status, $allowedStatuses, true)) {
        data_respond(400, ['error' => 'invalid_status', 'message' => 'The order status is invalid.']);
    }
    $carrier = data_string($body, 'carrier', 120, false);
    $trackingNumber = data_string($body, 'trackingNumber', 180, false);
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
        $allowedTransitions = [
            'Submitted' => ['Submitted', 'Pharmacist Review', 'Dispensing', 'Cancelled'],
            'Pharmacist Review' => ['Pharmacist Review', 'Dispensing', 'Cancelled'],
            'Dispensing' => ['Dispensing', 'Ready for Pickup', 'Shipped', 'Cancelled'],
            'Ready for Pickup' => ['Ready for Pickup', 'Completed', 'Cancelled'],
            'Shipped' => ['Shipped', 'Completed'],
            'Completed' => ['Completed'],
            'Cancelled' => ['Cancelled'],
        ];
        if (!in_array($status, $allowedTransitions[$current['status']] ?? [], true)) {
            $db->rollBack();
            data_respond(409, ['error' => 'invalid_transition', 'message' => 'The order cannot move from its current status to the selected status.']);
        }
        $update = $db->prepare('UPDATE orders SET status = ?, carrier = ?, tracking_number = ? WHERE id = ?');
        $update->execute([$status, $carrier === '' ? null : $carrier, $trackingNumber === '' ? null : $trackingNumber, $id]);
        if ($current['status'] !== 'Cancelled' && $status === 'Cancelled') {
            $restock = $db->prepare(
                'UPDATE products p INNER JOIN order_items i ON i.product_id = p.id SET p.stock_count = p.stock_count + i.quantity WHERE i.order_id = ?'
            );
            $restock->execute([$id]);
        }
        if ($current['status'] !== $status) {
            data_audit($db, 'order.status_changed', 'order', $id, ['from' => $current['status'], 'to' => $status]);
        }
        if ($current['carrier'] !== ($carrier === '' ? null : $carrier) || $current['tracking_number'] !== ($trackingNumber === '' ? null : $trackingNumber)) {
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
