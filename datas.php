<?php
// إظهار الأخطاء للتأكد من نجاح الإدخال
ini_set('display_errors', 1);
error_reporting(E_ALL);

require_once 'config/database.php';

try {
    $database = new Database();
    $db = $database->getConnection();

    // نص الاستعلام باستخدام الاقتباس المفرد لمنع تعارض علامات $ مع PHP
    $sql = '

    -- 2. إدخال المستخدمين (كلمة المرور: 123456)
    INSERT INTO Users (username, password_hash, full_name, role_id) VALUES 
    (\'ahmed\', \'12345\', \'د. احمد القسامي  \', 1),
    (\'acc_yahya\', \'12345\', \'يحيى المنعي \', 2);
'
;

    $db->exec($sql);
    echo "<h2 style='color: green;'>✅ تم إدخال البيانات الافتراضية وتحديث التسلسلات بنجاح!</h2>";

} catch (PDOException $e) {
    echo "<h2 style='color: red;'>❌ فشل إدخال البيانات:</h2>";
    echo "<pre>" . $e->getMessage() . "</pre>";
}
?>
