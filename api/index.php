<?php
// api/index.php
header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Methods: POST, GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization"); // السماح بتمرير Authorization

if ($_SERVER['REQUEST_METHOD'] == 'OPTIONS') {
    http_response_code(200);
    exit();
}

$request_uri = explode('api/', $_SERVER['REQUEST_URI']);
$path = isset($request_uri[1]) ? parse_url($request_uri[1], PHP_URL_PATH) : '';
$data = json_decode(file_get_contents("php://input"));

require_once '../utils/AuthMiddleware.php';
// توجيه الطلب (Routing)
switch ($path) {
    // --- مسارات المصادقة ---
    case 'auth/login':
        require_once '../controllers/AuthController.php';
        $auth = new AuthController();
        $auth->login($data);
        break;

    case 'auth/me':
        $userData = AuthMiddleware::checkAccess();
        echo json_encode(["success" => true, "data" => [
            "id_user" => $userData['user_id'],
            "name" => $userData['name'],
            "job" => $userData['job']
        ]]);
        break;

    // ==========================================
    // --- مسارات واجهة الطبيب ---
    // ==========================================
    
    // 1. مسار البحث الذكي
    case 'doctor/search_patient':
        $userData = AuthMiddleware::checkAccess(['طبيب عام']);
        require_once '../controllers/DoctorController.php';
        $doc = new DoctorController($userData['user_id']);
        $doc->searchPatient($data);
        break;

    // 2. مسار إضافة مريض جديد
    case 'doctor/new_patient':
        $userData = AuthMiddleware::checkAccess(['طبيب عام']);
        require_once '../controllers/DoctorController.php';
        $doc = new DoctorController($userData['user_id']);
        $doc->newPatient($data);
        break;

    // 3. مسار فتح زيارة لمريض سابق
    case 'doctor/existing_patient_visit':
        $userData = AuthMiddleware::checkAccess(['طبيب عام']);
        require_once '../controllers/DoctorController.php';
        $doc = new DoctorController($userData['user_id']);
        $doc->existingPatientVisit($data);
        break;

    // 4. مسار قائمة الانتظار (هنا كانت المشكلة!)
    case 'doctor/waiting_list':
        $userData = AuthMiddleware::checkAccess(['طبيب عام']);
        require_once '../controllers/DoctorController.php';
        $doc = new DoctorController($userData['user_id']);
        $doc->getWaitingList();
        break;

    // 5. مسار إرسال الطلبات للأقسام
    case 'doctor/send_orders':
        $userData = AuthMiddleware::checkAccess(['طبيب عام']);
        require_once '../controllers/DoctorController.php';
        $doc = new DoctorController($userData['user_id']);
        $doc->sendOrders($data);
        break;

    // 6. مسار حفظ التشخيص النهائي وإغلاق الزيارة
    case 'doctor/final_diagnosis':
        $userData = AuthMiddleware::checkAccess(['طبيب عام']);
        require_once '../controllers/DoctorController.php';
        $doc = new DoctorController($userData['user_id']);
        $doc->finalDiagnosis($data);
        break;
// مسار الطلبات المرسلة
    case 'doctor/sent_orders':
        $userData = AuthMiddleware::checkAccess(['طبيب عام']);
        require_once '../controllers/DoctorController.php';
        $doc = new DoctorController($userData['user_id']);
        $doc->getSentOrders();
        break;
        
        case 'doctor/services_list':
        $userData = AuthMiddleware::checkAccess(['طبيب عام']);
        require_once '../controllers/DoctorController.php';
        $doc = new DoctorController($userData['user_id']);
        $doc->getServicesList();
        break;
        
        // مسار السجل الطبي
    case 'doctor/medical_archive':
        $userData = AuthMiddleware::checkAccess(['طبيب عام']);
        require_once '../controllers/DoctorController.php';
        $doc = new DoctorController($userData['user_id']);
        $doc->getMedicalArchive();
        break;
        
        // ==========================================
    // --- مسارات واجهة المحاسب ---
    // ==========================================
    
    case 'accounting/pending':
        $userData = AuthMiddleware::checkAccess(['أمين صندوق']);
        require_once '../controllers/AccountingController.php';
        $acc = new AccountingController($userData['user_id']);
        $acc->getPendingInvoices();
        break;
        
        case 'accounting/next_serials':
        $userData = AuthMiddleware::checkAccess(['أمين صندوق']);
        require_once '../controllers/AccountingController.php';
        $acc = new AccountingController($userData['user_id']);
        $acc->getNextSerials();
        break;

    case 'accounting/pay_invoice':
        $userData = AuthMiddleware::checkAccess(['أمين صندوق']);
        require_once '../controllers/AccountingController.php';
        $acc = new AccountingController($userData['user_id']);
        $acc->payInvoice($data);
        break;
        
        case 'accounting/daily_treasury':
        $userData = AuthMiddleware::checkAccess(['أمين صندوق']);
        require_once '../controllers/AccountingController.php';
        $acc = new AccountingController($userData['user_id']);
        $acc->getDailyTreasury();
        break;
        
            case 'accounting/revenues_drilldown':
        $userData = AuthMiddleware::checkAccess(['أمين صندوق']);
        require_once '../controllers/AccountingController.php';
        $acc = new AccountingController($userData['user_id']);
        $acc->getRevenuesDrilldown($data); // نمرر $data لأننا سنستخدم POST
        break;

    // ------------------------------------------
    default:
        http_response_code(404);
        echo json_encode(["success" => false, "message" => "المسار المطلوب غير موجود في الـ API: " . $path]);
        break;

}
?>