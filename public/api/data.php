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
            price DECIMAL(10,2) NOT NULL,
            stock_count INT UNSIGNED NOT NULL,
            is_active TINYINT(1) NOT NULL DEFAULT 1
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

    if ((int) $db->query('SELECT COUNT(*) FROM products')->fetchColumn() === 0) {
        $products = [
            ['cat-sleep-1', 'Deep Sleep Botanical Night Calm Formula', 'Sleep', 24.00, 180],
            ['cat-sleep-2', 'Magnesium L-Threonate Neuro Rest', 'Sleep', 32.00, 95],
            ['cat-sleep-3', 'Valerian Root & L-Theanine Night Tincture', 'Sleep', 21.50, 64],
            ['cat-wl-1', 'Metabolic Vitality Clean Thermogenic Support', 'Weight Loss', 38.00, 140],
            ['cat-wl-2', 'Semaglutide Clinical Metabolic Kit', 'Weight Loss', 149.00, 45],
            ['cat-wl-3', 'Appetite Control Organic Glucomannan Fiber', 'Weight Loss', 24.50, 88],
            ['cat-ef-1', 'High Potency Active Methyl B-Complex', 'Energy & Focus', 22.00, 110],
            ['cat-ef-2', 'CoQ10 Ubiquinol 200mg Cellular Vitality', 'Energy & Focus', 39.00, 72],
            ['cat-hrt-1', 'Lisinopril Cardiovascular Care 20mg', 'Heart & Circulation', 12.00, 95],
            ['cat-hrt-2', 'Clinical Grade Omega-3 EPA/DHA Pure Triglyceride', 'Heart & Circulation', 34.00, 68],
            ['cat-dig-1', 'Probiotic Ultra 50 Billion CFU Gut Defense', 'Digestive Health', 36.00, 82],
            ['cat-dig-2', 'Omeprazole Delayed Release 20mg', 'Digestive Health', 18.00, 50],
            ['cat-wel-1', 'Liposomal Vitamin C 1000mg Immune Shield', 'Daily Wellness', 24.00, 115],
            ['cat-wel-2', 'Vitamin D3 + K2 (MK-7) Synergy Drops', 'Daily Wellness', 19.50, 77],
            ['cat-pain-1', 'Curcumin C3 Complex Anti-Inflammatory 500mg', 'Pain & Recovery', 31.00, 65],
            ['cat-pain-2', 'Arnica & Menthol Botanical Cooling Muscle Rub', 'Pain & Recovery', 17.50, 48],
        ];
        $insert = $db->prepare('INSERT INTO products (id, name, category, price, stock_count) VALUES (?, ?, ?, ?, ?)');
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
    ];
}

$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? ''));
$resource = $_GET['resource'] ?? '';
if (!is_string($resource)) {
    data_respond(400, ['error' => 'invalid_resource', 'message' => 'The requested resource is invalid.']);
}

if ($method === 'GET') {
    data_require_admin();
    $db = data_db();
    if ($resource === 'leads') {
        $rows = $db->query('SELECT id, first_name, last_name, email, phone, lead_source, created_at FROM leads ORDER BY id DESC')->fetchAll();
        data_respond(200, ['leads' => array_map('data_lead_row', $rows)]);
    }
    if ($resource === 'orders') {
        $rows = $db->query('SELECT * FROM orders ORDER BY placed_at DESC')->fetchAll();
        data_respond(200, ['orders' => array_map(static fn (array $row): array => data_order_row($db, $row), $rows)]);
    }
    data_respond(404, ['error' => 'not_found', 'message' => 'The requested resource was not found.']);
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
    $update = $db->prepare('UPDATE orders SET status = ?, carrier = ?, tracking_number = ? WHERE id = ?');
    $update->execute([$status, $carrier === '' ? null : $carrier, $trackingNumber === '' ? null : $trackingNumber, $id]);
    if ($update->rowCount() === 0) {
        $exists = $db->prepare('SELECT id FROM orders WHERE id = ?');
        $exists->execute([$id]);
        if (!$exists->fetch()) {
            data_respond(404, ['error' => 'order_not_found', 'message' => 'The order was not found.']);
        }
    }
    data_respond(200, ['updated' => true]);
}

header('Allow: GET, POST, PATCH');
data_respond(405, ['error' => 'method_not_allowed', 'message' => 'The requested method is not allowed.']);
