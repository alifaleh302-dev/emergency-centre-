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
    -- 1. إدخال الأدوار (Roles)
    INSERT INTO Roles (role_name, script_url) VALUES 
    (\'طبيب عام\', \'doctor_module.js\'),
    (\'أمين صندوق\', \'accounting_module.js\'),
    (\'استقبال\', \'reception.js\'),
    (\'فني مختبر\', \'technical.js\');

    -- 2. إدخال المستخدمين (كلمة المرور: 123456)
    INSERT INTO Users (username, password_hash, full_name, role_id) VALUES 
    (\'dr_ahmed\', \'$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi\', \'د. أحمد منصور\', 1),
    (\'acc_ali\', \'$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi\', \'علي عبدالله\', 2);

    -- 3. إدخال تصنيفات الخدمات
    INSERT INTO Service_Categories (category_name, department) VALUES 
    (\'فحوصات دم عامة\', \'Laboratory\'), 
    (\'وظائف كبد وكلى\', \'Laboratory\'), 
    (\'كشافات عادية\', \'Radiology\'), 
    (\'خدمات الطوارئ\', \'Nursing\');

    -- 4. إدخال الخدمات الطبية
    INSERT INTO Services_Master (category_id, service_name, center_share, ministry_share) VALUES 
    (1, \'CBC - صورة دم كاملة\', 2000.00, 500.00),
    (1, \'Fasting Blood Sugar - سكر\', 800.00, 200.00),
    (3, \'Chest X-Ray - كشافة صدر\', 3000.00, 500.00),
    (4, \'خياطة جرح (غرز صغيرة)\', 2500.00, 500.00),
    (4, \'تركيب كانيولا ومغذية\', 1000.00, 500.00);

    -- 5. إدخال أنواع حالات الطوارئ
    INSERT INTO Emergency_Case_Types (case_name) VALUES 
    (\'طوارئ باطنية\'), (\'تسمم غذائي\'), (\'سقوط\'), (\'حوادث سير\'), (\'حروق\');

    -- 6. إدخال المرضى
    INSERT INTO Patients (full_name, gender, birth_date, place1, place2) VALUES 
    (\'يحيى صالح المنعي\', \'Male\', \'1990-05-15\', \'عمران\', \'حارة النصر\'),
    (\'سالم عبدالله القحطاني\', \'Male\', \'1985-10-20\', \'السبعين\', \'حدة\'),
    (\'فاطمة أحمد المذحجي\', \'Female\', \'1995-02-10\', \'الصافية\', \'تعز\'),
    (\'خديجة سعيد اليافعي\', \'Female\', \'2000-08-30\', \'السبعين\', \'الاصبحي\');

    -- 7. إدخال أنواع المستندات
    INSERT INTO Document_Types (doc_name, current_serial) VALUES 
    (\'A\', 100), (\'B\', 200), (\'C\', 300);

    -- 8. إدخال الزيارات (Visits)
    INSERT INTO Visits (patient_id, doctor_id, notes, diagnosis, type_case, status, case_type_id) VALUES 
    (1, 1, \'راحة تامة\', \'أزمة ربو خفيفة\', \'طوارئ باطنية\', \'Completed\', 1),
    (2, 1, \'مراجعة بعد يومين\', \'كدمات في القدم\', \'سقوط\', \'Completed\', 3),
    (3, 1, \'المريضة تتألم بشدة\', \'اشتباه حروق درجة ثانية\', \'حروق\', \'Active\', 5),
    (4, 1, \'غثيان مستمر\', \'تسمم غذائي\', \'تسمم غذائي\', \'Active\', 2);

    -- 9. إدخال الفواتير
    INSERT INTO Invoices (serial_number, doc_type_id, visit_id, total, exemption_value, net_amount, accountant_id) VALUES 
    (101, 1, 1, 3500.00, 0.00, 3500.00, 2),
    (201, 2, 2, 6500.00, 1500.00, 5000.00, 2),
    (0, NULL, 3, 4000.00, 0.00, 0.00, NULL);

    -- 10. تفاصيل الفواتير
    INSERT INTO Invoice_Details (invoice_id, service_id, service_price_at_time) VALUES 
    (1, 1, 2500.00), (1, 2, 1000.00),
    (2, 3, 3500.00), (2, 4, 3000.00),
    (3, 3, 3500.00), (3, 5, 500.00);

    -- تحديث الـ Sequences لضمان عمل الـ Auto-increment بشكل صحيح بعد الإدخال اليدوي
    SELECT setval(\'roles_role_id_seq\', (SELECT MAX(role_id) FROM Roles));
    SELECT setval(\'users_user_id_seq\', (SELECT MAX(user_id) FROM Users));
    SELECT setval(\'patients_patient_id_seq\', (SELECT MAX(patient_id) FROM Patients));
    SELECT setval(\'emergency_case_types_case_type_id_seq\', (SELECT MAX(case_type_id) FROM Emergency_Case_Types));
    SELECT setval(\'visits_visit_id_seq\', (SELECT MAX(visit_id) FROM Visits));
    SELECT setval(\'document_types_doc_type_id_seq\', (SELECT MAX(doc_type_id) FROM Document_Types));
    SELECT setval(\'invoices_invoice_id_seq\', (SELECT MAX(invoice_id) FROM Invoices));
    SELECT setval(\'service_categories_category_id_seq\', (SELECT MAX(category_id) FROM Service_Categories));
    SELECT setval(\'services_master_service_id_seq\', (SELECT MAX(service_id) FROM Services_Master));
    SELECT setval(\'invoice_details_detail_id_seq\', (SELECT MAX(detail_id) FROM Invoice_Details));
    ';

    $db->exec($sql);
    echo "<h2 style='color: green;'>✅ تم إدخال البيانات الافتراضية وتحديث التسلسلات بنجاح!</h2>";

} catch (PDOException $e) {
    echo "<h2 style='color: red;'>❌ فشل إدخال البيانات:</h2>";
    echo "<pre>" . $e->getMessage() . "</pre>";
}
?>
