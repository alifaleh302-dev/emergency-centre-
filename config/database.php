<?php
// config/database.php

class Database {
    // نصيحة: عند الرفع على Render، يفضل وضع هذه القيم في متغيرات البيئة (Environment Variables)
    private $host ="postgresql://emergencycenterdb_user:rbRGd6GUfvDvhEccTrgJzgSOIGwOj5T3@dpg-d742ar5m5p6s73f0spv0-a/emergencycenterdb";// "postgresql://emergencycenterdb_user:rbRGd6GUfvDvhEccTrgJzgSOIGwOj5T3@dpg-d742ar5m5p6s73f0spv0-a.ohio-postgres.render.com/emergencycenterdb"; // ستجده في إعدادات قاعدة البيانات بـ Render
    private $db_name = "emergencycenterdb";          // اسم القاعدة (غالباً ما يكون بحروف صغيرة في Postgres)
    private $username = "emergencycenterdb_user";                   // اسم المستخدم من Render
    private $password = "rbRGd6GUfvDvhEccTrgJzgSOIGwOj5T3";              // كلمة المرور من Render
    private $port = "5432";                          // المنفذ الافتراضي لـ PostgreSQL
    public $conn;

    public function getConnection() {
        $this->conn = null;
        try {
            // تغيير التعريف إلى pgsql وإضافة المنفذ
            $dsn = "pgsql:host=" . $this->host . ";port=" . $this->port . ";dbname=" . $this->db_name;
            
            $this->conn = new PDO($dsn, $this->username, $this->password);
            
            // تفعيل وضع الأخطاء (ضروري جداً لالتقاط أخطاء الـ Triggers التي وضعناها)
            $this->conn->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
            
            // تأكيد التعامل مع النصوص بترميز UTF8
            $this->conn->exec("SET client_encoding TO 'UTF8'");

        } catch(PDOException $exception) {
            header('Content-Type: application/json');
            echo json_encode([
                "success" => false, 
                "message" => "خطأ في الاتصال بقاعدة البيانات: " . $exception->getMessage()
            ]);
            exit;
        }
        return $this->conn;
    }
}
?>
