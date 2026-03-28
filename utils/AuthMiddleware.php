<?php
// utils/AuthMiddleware.php
require_once 'JWT.php';

class AuthMiddleware {
    public static function checkAccess($allowed_roles = []) {
        // 1. جلب الترويسات من الطلب
        $headers = apache_request_headers();
        $authHeader = isset($headers['Authorization']) ? $headers['Authorization'] : '';

        // إذا كان السيرفر لا يدعم apache_request_headers نستخدم $_SERVER
        if (empty($authHeader) && isset($_SERVER['HTTP_AUTHORIZATION'])) {
            $authHeader = $_SERVER['HTTP_AUTHORIZATION'];
        }

        // 2. التحقق من وجود كلمة Bearer
        if (preg_match('/Bearer\s(\S+)/', $authHeader, $matches)) {
            $token = $matches[1];
            
            // 3. فك تشفير التوكن
            $decoded = JWT::decode($token);
            
            if ($decoded && isset($decoded['data'])) {
                $userRole = $decoded['data']['job'];
                
                // 4. التحقق من الصلاحيات (Role-Based Access)
                // إذا كانت المصفوفة فارغة، فالمسار مسموح لأي مستخدم مسجل الدخول
                if (!empty($allowed_roles) && !in_array($userRole, $allowed_roles)) {
                    http_response_code(403); // Forbidden
                    echo json_encode(["success" => false, "message" => "ليس لديك صلاحية للوصول إلى هذا المورد."]);
                    exit;
                }
                
                return $decoded['data']; // إرجاع بيانات المستخدم (رقم الطبيب مثلاً) لليُستخدم في الاستعلام
            }
        }

        // 5. في حال عدم وجود التوكن أو أنه غير صالح
        http_response_code(401); // Unauthorized
        echo json_encode(["success" => false, "message" => "جلسة غير صالحة أو منتهية، يرجى تسجيل الدخول."]);
        exit;
    }
}
?>