<?php
// models/DoctorModel.php

class DoctorModel {
    private $conn;

    public function __construct($db) {
        $this->conn = $db;
    }

    // 1. البحث الذكي عن مريض (استخدام ILIKE للبحث المرن)
    public function searchPatient($queryStr) {
        $keywords = preg_split('/\s+/', trim($queryStr));
        $sql = "SELECT p.patient_id, p.full_name, p.place1, p.place2, 
                (SELECT COUNT(*) FROM Visits v WHERE v.patient_id = p.patient_id AND v.status = 'Completed') as visit_num
                FROM Patients p 
                WHERE 1=1";
        $params = [];
        foreach ($keywords as $index => $word) {
            if (!empty($word)) {
                // ILIKE في Postgres تجعل البحث غير حساس لحالة الأحرف
                $sql .= " AND p.full_name ILIKE :word$index";
                $params[":word$index"] = '%' . $word . '%';
            }
        }
        
        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    // 2. إضافة مريض جديد
    public function createPatient($name, $gender, $birth_date, $place1, $place2) {
        $sql = "INSERT INTO Patients (full_name, gender, birth_date, place1, place2) 
                VALUES (:name, :gender, :birth_date, :place1, :place2)";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute([
            ':name' => $name, ':gender' => $gender, ':birth_date' => $birth_date,
            ':place1' => $place1, ':place2' => $place2
        ]);
        return $this->conn->lastInsertId();
    }

    // 3. جلب معرّف نوع الحالة
    public function getCaseTypeId($case_name) {
        $sql = "SELECT case_type_id FROM Emergency_Case_Types WHERE case_name = :case_name LIMIT 1";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute([':case_name' => $case_name]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ? $row['case_type_id'] : null;
    }

    // 4. فتح زيارة جديدة
    public function createVisit($patient_id, $doctor_id, $case_type_id, $diagnosis, $notes, $type_case_name) {
        $sql = "INSERT INTO Visits (patient_id, doctor_id, case_type_id, type_case, diagnosis, notes, status) 
                VALUES (:p_id, :d_id, :c_id, :t_name, :diag, :notes, 'Active')";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute([
            ':p_id' => $patient_id, ':d_id' => $doctor_id, ':c_id' => $case_type_id,
            ':t_name' => $type_case_name, ':diag' => $diagnosis, ':notes' => $notes
        ]);
        return $this->conn->lastInsertId();
    }

    // 5. جلب قائمة الانتظار (استخدام TO_CHAR)
    public function getWaitingList($doctor_id) {
        $sql = "SELECT v.visit_id as visit, p.full_name as name, v.type_case, 
                       TO_CHAR(v.created_at, 'HH12:MI AM') as time, v.diagnosis 
                FROM Visits v
                JOIN Patients p ON v.patient_id = p.patient_id
                WHERE v.doctor_id = :doc_id AND v.status = 'Active'";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute([':doc_id' => $doctor_id]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    // 6. دوال الفواتير والطلبات
    public function createPendingInvoice($visit_id) {
        $sql = "INSERT INTO Invoices (serial_number, visit_id, total, exemption_value, net_amount) 
                VALUES (0, :v_id, 0, 0, 0)";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute([':v_id' => $visit_id]);
        return $this->conn->lastInsertId();
    }

    public function getServiceDetails($service_name) {
        $sql = "SELECT service_id, total_price FROM Services_Master WHERE service_name = :s_name LIMIT 1";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute([':s_name' => $service_name]);
        return $stmt->fetch(PDO::FETCH_ASSOC);
    }

    public function addInvoiceDetail($invoice_id, $service_id, $price) {
        $sql = "INSERT INTO Invoice_Details (invoice_id, service_id, service_price_at_time) 
                VALUES (:i_id, :s_id, :price)";
        $stmt = $this->conn->prepare($sql);
        return $stmt->execute([':i_id' => $invoice_id, ':s_id' => $service_id, ':price' => $price]);
    }

    public function updateInvoiceTotal($invoice_id, $total) {
        $sql = "UPDATE Invoices SET total = :total, net_amount = :total WHERE invoice_id = :i_id";
        $stmt = $this->conn->prepare($sql);
        return $stmt->execute([':total' => $total, ':i_id' => $invoice_id]);
    }

    // 7. حفظ التشخيص النهائي وإغلاق الزيارة
    public function updateFinalDiagnosis($visit_id, $diagnosis) {
        $sql = "UPDATE Visits SET diagnosis = :diag, status = 'Completed' WHERE visit_id = :v_id";
        $stmt = $this->conn->prepare($sql);
        return $stmt->execute([':diag' => $diagnosis, ':v_id' => $visit_id]);
    }

    // جلب الطلبات المرسلة (استخدام INTERVAL)
    public function getSentOrders($doctor_id) {
        $sql = "SELECT v.visit_id, p.full_name as name, v.type_case, COUNT(id.detail_id) as order_count
                FROM Visits v
                JOIN Patients p ON v.patient_id = p.patient_id
                JOIN Invoices i ON v.visit_id = i.visit_id
                JOIN Invoice_Details id ON i.invoice_id = id.invoice_id
                WHERE v.doctor_id = :doc_id 
                  AND v.created_at >= (NOW() - INTERVAL '24 hours')
                GROUP BY v.visit_id, p.full_name, v.type_case
                ORDER BY v.visit_id DESC";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute([':doc_id' => $doctor_id]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    // جلب تفاصيل كل طلب وحالته
    public function getOrderDetails($visit_id) {
        $sql = "SELECT sm.service_name as orders, 
                       TO_CHAR(i.created_at, 'HH12:MI AM') as time,
                       CASE WHEN mr.result_id IS NOT NULL THEN 'مكتمل' ELSE 'قيد الانتظار' END as status
                FROM Invoices i
                JOIN Invoice_Details id ON i.invoice_id = id.invoice_id
                JOIN Services_Master sm ON id.service_id = sm.service_id
                LEFT JOIN Medical_Results mr ON mr.visit_id = i.visit_id AND mr.service_id = sm.service_id
                WHERE i.visit_id = :v_id";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute([':v_id' => $visit_id]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    public function getAvailableServices() {
        $sql = "SELECT sm.service_id, sm.service_name, sc.department 
                FROM Services_Master sm
                JOIN Service_Categories sc ON sm.category_id = sc.category_id";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute();
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    public function getServiceDetailsById($service_id) {
        $sql = "SELECT service_id, total_price FROM Services_Master WHERE service_id = :s_id LIMIT 1";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute([':s_id' => $service_id]);
        return $stmt->fetch(PDO::FETCH_ASSOC);
    }
    
    // جلب قائمة الأرشيف الطبي
    public function getMedicalArchive() {
        $sql = "SELECT p.patient_id, p.full_name as name, 
                       COUNT(v.visit_id) as visit_num, 
                       TO_CHAR(MAX(v.created_at), 'YYYY-MM-DD') as last_visit_date
                FROM Patients p
                JOIN Visits v ON p.patient_id = v.patient_id
                WHERE v.status = 'Completed'
                GROUP BY p.patient_id, p.full_name
                ORDER BY MAX(v.created_at) DESC";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute();
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    // جلب تفاصيل الملف الطبي (تعديل دالة STRING_AGG بدلاً من GROUP_CONCAT)
    public function getPatientMedicalFile($patient_id) {
        $sql = "SELECT TO_CHAR(v.created_at, 'YYYY-MM-DD') as date_visit,
                       v.type_case, v.diagnosis, v.notes,
                       (SELECT STRING_AGG(sm.service_name, '، ')
                        FROM Invoices i
                        JOIN Invoice_Details id ON i.invoice_id = id.invoice_id
                        JOIN Services_Master sm ON id.service_id = sm.service_id
                        WHERE i.visit_id = v.visit_id) as procedures
                FROM Visits v
                WHERE v.patient_id = :p_id AND v.status = 'Completed'
                ORDER BY v.created_at DESC";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute([':p_id' => $patient_id]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }
}
?>
