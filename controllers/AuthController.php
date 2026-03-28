<?php
// controllers/AuthController.php
require_once '../config/database.php';
require_once '../utils/JWT.php';

class AuthController {
    private $conn;

    public function __construct() {
        $database = new Database();
        $this->conn = $database->getConnection();
    }

    public function login($data) {
        if (!isset($data->username) || !isset($data->password)) {
            echo json_encode(["success" => false, "message" => "الرجاء إدخال اسم المستخدم وكلمة المرور."]);
            return;
        }

        // جلب بيانات المستخدم مع مسار السكريبت من جدول الأدوار
        $query = "SELECT u.user_id, u.password_hash, u.full_name, r.role_name, r.script_url 
                  FROM Users u 
                  JOIN Roles r ON u.role_id = r.role_id 
                  WHERE u.username = :username LIMIT 1";
                  
        $stmt = $this->conn->prepare($query);
        $stmt->bindParam(':username', $data->username);
        $stmt->execute();

        if ($stmt->rowCount() > 0) {
            $user = $stmt->fetch(PDO::FETCH_ASSOC);

            // التحقق من كلمة المرور (مشفّرة بـ BCRYPT)
            //if (password_verify($data->password, $user['password_hash'])) {
                if($data->password==$user['password_hash']){
                // إنشاء بيانات التوكن (Payload)
                $token_payload = [
                    "iss" => "EmergencyCenter",
                    "exp" => time() + (60 * 60 * 8), // التوكن صالح لمدة 8 ساعات (وردية كاملة)
                    "data" => [
                        "user_id" => $user['user_id'],
                        "name" => $user['full_name'],
                        "job" => $user['role_name']
                    ]
                ];

                // إصدار التوكن
                $jwt = JWT::encode($token_payload);

                // إرسال الرد الناجح للـ Frontend
                echo json_encode([
                    "success" => true,
                    "message" => "تم تسجيل الدخول بنجاح",
                    "token" => $jwt,
                    "script_url" => $user['script_url']
                ]);
            } else {
                echo json_encode(["success" => false, "message" => "كلمة المرور غير صحيحة."]);
            }
        } else {
            echo json_encode(["success" => false, "message" => "اسم المستخدم غير موجود."]);
        }
    }
}
?>
