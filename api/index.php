<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/bootstrap.php';

header('Access-Control-Allow-Origin: *');
header('Content-Type: application/json; charset=UTF-8');
header('Access-Control-Allow-Methods: GET, POST, PUT, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$rawBody = file_get_contents('php://input');
$data = null;

if ($rawBody !== false && trim($rawBody) !== '') {
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

$routes = [
    'auth/login' => fn () => (new AuthController())->login($data),
    'auth/me' => function (): void {
        $userData = AuthMiddleware::checkAccess();
        echo json_encode([
            'success' => true,
            'data' => [
                'id_user' => $userData['user_id'],
                'name' => $userData['name'],
                'job' => $userData['job'],
            ],
        ], JSON_UNESCAPED_UNICODE);
    },

    'doctor/search_patient' => fn () => $doctorHandler('searchPatient'),
    'doctor/new_patient' => fn () => $doctorHandler('newPatient'),
    'doctor/existing_patient_visit' => fn () => $doctorHandler('existingPatientVisit'),
    'doctor/waiting_list' => fn () => $doctorHandler('getWaitingList', false),
    'doctor/send_orders' => fn () => $doctorHandler('sendOrders'),
    'doctor/final_diagnosis' => fn () => $doctorHandler('finalDiagnosis'),
    'doctor/sent_orders' => fn () => $doctorHandler('getSentOrders', false),
    'doctor/services_list' => fn () => $doctorHandler('getServicesList', false),
    'doctor/medical_archive' => fn () => $doctorHandler('getMedicalArchive', false),

    'accounting/pending' => fn () => $accountingHandler('getPendingInvoices', false),
    'accounting/next_serials' => fn () => $accountingHandler('getNextSerials', false),
    'accounting/pay_invoice' => fn () => $accountingHandler('payInvoice'),
    'accounting/daily_treasury' => fn () => $accountingHandler('getDailyTreasury', false),
    'accounting/revenues_drilldown' => fn () => $accountingHandler('getRevenuesDrilldown'),
];

if (!isset($routes[$path])) {
    http_response_code(404);
    echo json_encode([
        'success' => false,
        'message' => 'المسار المطلوب غير موجود في الـ API: ' . $path,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$routes[$path]();
