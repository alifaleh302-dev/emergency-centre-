<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/bootstrap.php';

ini_set('log_errors', '1');
ini_set('error_log', '/dev/stderr');

header('Access-Control-Allow-Origin: ' . (getenv('APP_CORS_ORIGIN') ?: '*'));
header('Content-Type: application/json; charset=UTF-8');
header('Access-Control-Allow-Methods: GET, POST, PUT, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$rawBody = file_get_contents('php://input');
$data = null;

if ($rawBody !== false && trim($rawBody) !== '') {
    $contentType = $_SERVER['CONTENT_TYPE'] ?? '';
    if (str_contains($contentType, 'application/json')) {
        try {
            $data = json_decode($rawBody, false, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException $exception) {
            http_response_code(400);
            echo json_encode([
                'success' => false,
                'message' => 'تم إرسال JSON غير صالح.',
            ], JSON_UNESCAPED_UNICODE);
            exit;
        }
    }
}

$requestPath = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) ?: '';
$path = trim($requestPath, '/');
$apiSegment = strpos($path, 'api/');
if ($apiSegment !== false) {
    $path = substr($path, $apiSegment + 4);
}
$path = trim($path, '/');

$doctorHandler = function (string $methodName, bool $passData = true) use ($data): void {
    $userData = AuthMiddleware::checkAccess(['طبيب عام']);
    $controller = new DoctorController((int) $userData['user_id']);

    if ($passData) {
        $controller->{$methodName}($data);
        return;
    }

    $controller->{$methodName}();
};

$accountingHandler = function (string $methodName, bool $passData = true) use ($data): void {
    $userData = AuthMiddleware::checkAccess(['أمين صندوق']);
    $controller = new AccountingController((int) $userData['user_id']);

    if ($passData) {
        $controller->{$methodName}($data);
        return;
    }

    $controller->{$methodName}();
};

$adminHandler = function (string $methodName, bool $passData = true) use ($data): void {
    $userData = AuthMiddleware::checkAccess(['مدير النظام']);
    $controller = new AdminController((int) $userData['user_id']);

    if ($passData) {
        $controller->{$methodName}($data);
        return;
    }

    $controller->{$methodName}();
};

$routes = [
    'auth/login' => ['methods' => ['POST'], 'handler' => fn () => (new AuthController())->login($data)],
    'auth/me' => ['methods' => ['GET'], 'handler' => function (): void {
        $userData = AuthMiddleware::checkAccess();
        echo json_encode([
            'success' => true,
            'data' => [
                'id_user' => $userData['user_id'],
                'name' => $userData['name'],
                'job' => $userData['job'],
            ],
        ], JSON_UNESCAPED_UNICODE);
    }],

    'doctor/search_patient' => ['methods' => ['POST'], 'handler' => fn () => $doctorHandler('searchPatient')],
    'doctor/new_patient' => ['methods' => ['POST'], 'handler' => fn () => $doctorHandler('newPatient')],
    'doctor/existing_patient_visit' => ['methods' => ['POST'], 'handler' => fn () => $doctorHandler('existingPatientVisit')],
    'doctor/waiting_list' => ['methods' => ['GET'], 'handler' => fn () => $doctorHandler('getWaitingList', false)],
    'doctor/send_orders' => ['methods' => ['POST'], 'handler' => fn () => $doctorHandler('sendOrders')],
    'doctor/final_diagnosis' => ['methods' => ['POST'], 'handler' => fn () => $doctorHandler('finalDiagnosis')],
    'doctor/sent_orders' => ['methods' => ['GET'], 'handler' => fn () => $doctorHandler('getSentOrders', false)],
    'doctor/services_list' => ['methods' => ['GET'], 'handler' => fn () => $doctorHandler('getServicesList', false)],
    'doctor/medical_archive' => ['methods' => ['GET'], 'handler' => fn () => $doctorHandler('getMedicalArchive', false)],
    'doctor/create_ticket' => ['methods' => ['POST'], 'handler' => fn () => $doctorHandler('createTicket')],

    'accounting/pending' => ['methods' => ['GET'], 'handler' => fn () => $accountingHandler('getPendingInvoices', false)],
    'accounting/next_serials' => ['methods' => ['GET'], 'handler' => fn () => $accountingHandler('getNextSerials', false)],
    'accounting/pay_invoice' => ['methods' => ['POST'], 'handler' => fn () => $accountingHandler('payInvoice')],
    'accounting/daily_treasury' => ['methods' => ['GET'], 'handler' => fn () => $accountingHandler('getDailyTreasury', false)],
    'accounting/revenues_drilldown' => ['methods' => ['POST'], 'handler' => fn () => $accountingHandler('getRevenuesDrilldown')],

    'admin/schema' => ['methods' => ['GET'], 'handler' => fn () => $adminHandler('getSchema', false)],
    'admin/dashboard' => ['methods' => ['GET'], 'handler' => fn () => $adminHandler('getDashboard', false)],
    'admin/list' => ['methods' => ['POST'], 'handler' => fn () => $adminHandler('listRecords')],
    'admin/record' => ['methods' => ['POST'], 'handler' => fn () => $adminHandler('getRecord')],
    'admin/save' => ['methods' => ['POST'], 'handler' => fn () => $adminHandler('saveRecord')],
    'admin/delete' => ['methods' => ['POST'], 'handler' => fn () => $adminHandler('deleteRecord')],

    'notifications/unread' => ['methods' => ['GET'], 'handler' => function (): void {
        $userData = AuthMiddleware::checkAccess();
        $db = new Database();
        $model = new NotificationModel($db->getConnection());
        $notifications = $model->getUnread($userData['job']);
        $count = $model->countUnread($userData['job']);
        echo json_encode(['success' => true, 'count' => $count, 'data' => $notifications], JSON_UNESCAPED_UNICODE);
    }],
    'notifications/read' => ['methods' => ['POST'], 'handler' => function (): void {
        $userData = AuthMiddleware::checkAccess();
        $db = new Database();
        $model = new NotificationModel($db->getConnection());
        $model->markAllRead($userData['job']);
        echo json_encode(['success' => true], JSON_UNESCAPED_UNICODE);
    }],

    'realtime/config' => ['methods' => ['GET'], 'handler' => function (): void {
        $userData = AuthMiddleware::checkAccess();
        $service = new PusherService();
        echo json_encode([
            'success' => true,
            'data' => $service->getClientConfigForUser($userData),
        ], JSON_UNESCAPED_UNICODE);
    }],
    'realtime/pusher/auth' => ['methods' => ['POST'], 'handler' => function (): void {
        $userData = AuthMiddleware::checkAccess();
        $socketId = trim((string) ($_POST['socket_id'] ?? ''));
        $channelName = trim((string) ($_POST['channel_name'] ?? ''));

        if ($socketId === '' || $channelName === '') {
            http_response_code(422);
            echo json_encode([
                'success' => false,
                'message' => 'بيانات المصادقة اللحظية غير مكتملة.',
            ], JSON_UNESCAPED_UNICODE);
            return;
        }

        try {
            $service = new PusherService();
            echo json_encode($service->authorizePrivateChannel($socketId, $channelName, $userData), JSON_UNESCAPED_UNICODE);
        } catch (Throwable $exception) {
            http_response_code(403);
            echo json_encode([
                'success' => false,
                'message' => $exception->getMessage(),
            ], JSON_UNESCAPED_UNICODE);
        }
    }],
];

if (!isset($routes[$path])) {
    http_response_code(404);
    echo json_encode([
        'success' => false,
        'message' => 'المسار المطلوب غير موجود في الـ API: ' . $path,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$route = $routes[$path];
$requestMethod = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
if (!in_array($requestMethod, $route['methods'], true)) {
    http_response_code(405);
    echo json_encode([
        'success' => false,
        'message' => 'طريقة الطلب غير مسموحة لهذا المسار.',
        'allowed_methods' => $route['methods'],
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$route['handler']();
