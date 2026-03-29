<?php
// config/database.php

class Database {
    private $host;
    private $db_name;
    private $username;
    private $password;
    private $port = "5432";
    public $conn;

    public function getConnection() {
        $this->conn = null;

        // جلب الرابط من متغيرات البيئة في Render
        $db_url = getenv('DATABASE_URL');

        if ($db_url) {
            // إذا كان الرابط موجوداً (عند الرفع على Render) نقوم بتفكيكه تلقائياً
            $purl = parse_url($db_url);
            $this->host = $purl["host"];
            $this->port = $purl["port"] ?? "5432";
            $this->username = $purl["user"];
            $this->password = $purl["pass"];
            $this->db_name = ltrim($purl["path"], "/");
        } else {
            // القيم الاحتياطية (للتجربة المحلية فقط) - استبدلها ببياناتك إذا كنت تجرب محلياً
            $this->host = "dpg-d742ar5m5p6s73f0spv0-a.ohio-postgres.render.com"; 
            $this->db_name = "emergencycenterdb";
            $this->username = "emergencycenterdb_user";
            $this->password = "rbRGd6GUfvDvhEccTrgJzgSOIGwOj5T3";
        }

        try {
            // صياغة الـ DSN الصحيحة لـ PostgreSQL
            $dsn = "pgsql:host=" . $this->host . ";port=" . $this->port . ";dbname=" . $this->db_name;
            
            $this->conn = new PDO($dsn, $this->username, $this->password);
            
            // تفعيل وضع الأخطاء
            $this->conn->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
            
            // تأكيد الترميز
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

                
