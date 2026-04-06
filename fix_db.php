<?php
try {
    // جلب متغيرات الاتصال من بيئة Render
    $host = getenv('DB_HOST');
    $port = getenv('DB_PORT');
    $dbname = getenv('DB_NAME');
    $user = getenv('DB_USER');
    $pass = getenv('DB_PASSWORD');

    // إنشاء الاتصال بقاعدة بيانات PostgreSQL
    $dsn = "pgsql:host=$host;port=$port;dbname=$dbname";
    $pdo = new PDO($dsn, $user, $pass, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);

    // تنفيذ أمر إضافة العمود
    $sql = "ALTER TABLE Invoices ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;";
    $pdo->exec($sql);

    echo "<h3>✅ تم إضافة العمود paid_at بنجاح إلى جدول الفواتير!</h3>";
    echo "<p>يرجى الآن حذف هذا الملف (fix_db.php) من المستودع لأسباب أمنية، ثم جرب عملية الدفع.</p>";

} catch (PDOException $e) {
    echo "<h3>❌ حدث خطأ في قاعدة البيانات:</h3>";
    echo $e->getMessage();
} catch (Exception $e) {
    echo "<h3>❌ حدث خطأ عام:</h3>";
    echo $e->getMessage();
}
