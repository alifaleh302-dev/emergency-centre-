<?php
// models/AccountingModel.php

class AccountingModel {
    private $conn;

    public function __construct($db) {
        $this->conn = $db;
    }

    // 1. جلب الفواتير المعلقة (المعدلة لتناسب PostgreSQL)
    public function getPendingInvoices() {
        // تم استبدال DATE_FORMAT بـ TO_CHAR
        $sql = "SELECT i.invoice_id, p.full_name as name, i.total as sum, 
                       TO_CHAR(i.created_at, 'HH12:MI AM') as time
                FROM Invoices i
                JOIN Visits v ON i.visit_id = v.visit_id
                JOIN Patients p ON v.patient_id = p.patient_id
                WHERE i.doc_type_id IS NULL AND i.accountant_id IS NULL
                ORDER BY i.created_at ASC";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute();
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    // 2. جلب تفاصيل الخدمات داخل الفاتورة
    public function getInvoiceDetails($invoice_id) {
        $sql = "SELECT sm.service_name as name, id.service_price_at_time as price
                FROM Invoice_Details id
                JOIN Services_Master sm ON id.service_id = sm.service_id
                WHERE id.invoice_id = :inv_id";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute([':inv_id' => $invoice_id]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }
    
    // 3. جلب الأرقام التسلسلية المتوقعة
    public function getNextSerials() {
        $sql = "SELECT doc_name, current_serial + 1 as next_serial FROM Document_Types";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute();
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    // 4. تنفيذ الدفع (المعاملات المالية متوافقة مع Postgres)
    public function processPayment($invoice_id, $net_amount, $exemption_value, $doc_type_name, $accountant_id) {
        try {
            $this->conn->beginTransaction();

            $sequence_name = ($doc_type_name === 'A') ? 'A' : 'B';

            // زيادة العداد
            $stmt = $this->conn->prepare("UPDATE Document_Types SET current_serial = current_serial + 1 WHERE doc_name = :seq");
            $stmt->execute([':seq' => $sequence_name]);

            // جلب الرقم التسلسلي الجديد
            $stmt = $this->conn->prepare("SELECT doc_type_id, current_serial FROM Document_Types WHERE doc_name = :seq");
            $stmt->execute([':seq' => $sequence_name]);
            $docInfo = $stmt->fetch(PDO::FETCH_ASSOC);

            $doc_type_id = $docInfo['doc_type_id'];
            $new_serial = $docInfo['current_serial'];

            // تحديث الفاتورة (NOW() تعمل بشكل صحيح في Postgres)
            $sql = "UPDATE Invoices SET 
                        net_amount = :net, 
                        exemption_value = :exemp, 
                        doc_type_id = :d_id, 
                        serial_number = :serial, 
                        accountant_id = :acc_id,
                        created_at = NOW() 
                    WHERE invoice_id = :inv_id";
            $stmt = $this->conn->prepare($sql);
            $stmt->execute([
                ':net' => $net_amount,
                ':exemp' => $exemption_value,
                ':d_id' => $doc_type_id,
                ':serial' => $new_serial,
                ':acc_id' => $accountant_id,
                ':inv_id' => $invoice_id
            ]);

            $this->conn->commit();
            return $new_serial;
        } catch (Exception $e) {
            $this->conn->rollBack();
            throw $e;
        }
    }
    
    // 5. جلب مقبوضات الخزينة اليومية (تعديل صيغة الوقت والـ INTERVAL)
    public function getDailyReceipts() {
        $sql = "SELECT i.invoice_id, p.full_name as name, i.net_amount, i.exemption_value,
                       TO_CHAR(i.created_at, 'HH12:MI AM') as time,
                       dt.doc_name, u.full_name as cashier
                FROM Invoices i
                JOIN Visits v ON i.visit_id = v.visit_id
                JOIN Patients p ON v.patient_id = p.patient_id
                JOIN Document_Types dt ON i.doc_type_id = dt.doc_type_id
                JOIN Users u ON i.accountant_id = u.user_id
                WHERE i.accountant_id IS NOT NULL 
                  AND i.created_at >= (NOW() - INTERVAL '24 hours')
                ORDER BY i.created_at DESC";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute();
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    // --- دوال الإيرادات المتدرجة (تعديل دوال التاريخ) ---

    public function getRevenuesByYears() {
        $sql = "SELECT TO_CHAR(created_at, 'YYYY') as year_val,
                       SUM(net_amount) as total_paid,
                       SUM(exemption_value) as total_exempt,
                       SUM(CASE WHEN doc_type_id = 1 THEN 1 ELSE 0 END) as count_cash,
                       SUM(CASE WHEN doc_type_id = 2 THEN 1 ELSE 0 END) as count_partial,
                       SUM(CASE WHEN doc_type_id = 3 THEN 1 ELSE 0 END) as count_full
                FROM Invoices 
                WHERE doc_type_id IS NOT NULL 
                GROUP BY year_val ORDER BY year_val DESC";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute();
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    public function getRevenuesByMonths($year) {
        $sql = "SELECT TO_CHAR(created_at, 'MM') as month_val,
                       SUM(net_amount) as total_paid,
                       SUM(exemption_value) as total_exempt,
                       SUM(CASE WHEN doc_type_id = 1 THEN 1 ELSE 0 END) as count_cash,
                       SUM(CASE WHEN doc_type_id = 2 THEN 1 ELSE 0 END) as count_partial,
                       SUM(CASE WHEN doc_type_id = 3 THEN 1 ELSE 0 END) as count_full
                FROM Invoices 
                WHERE doc_type_id IS NOT NULL AND TO_CHAR(created_at, 'YYYY') = :year
                GROUP BY month_val ORDER BY month_val DESC";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute([':year' => $year]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    public function getRevenuesByDays($year, $month) {
        $sql = "SELECT TO_CHAR(created_at, 'DD') as day_val,
                       SUM(net_amount) as total_paid,
                       SUM(exemption_value) as total_exempt,
                       SUM(CASE WHEN doc_type_id = 1 THEN 1 ELSE 0 END) as count_cash,
                       SUM(CASE WHEN doc_type_id = 2 THEN 1 ELSE 0 END) as count_partial,
                       SUM(CASE WHEN doc_type_id = 3 THEN 1 ELSE 0 END) as count_full
                FROM Invoices 
                WHERE doc_type_id IS NOT NULL AND TO_CHAR(created_at, 'YYYY-MM') = :ym
                GROUP BY day_val ORDER BY day_val DESC";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute([':ym' => $year . '-' . str_pad($month, 2, '0', STR_PAD_LEFT)]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    public function searchOrGetDailyDetails($date = null, $query = null) {
        $sql = "SELECT i.invoice_id, p.full_name as name, i.net_amount, i.exemption_value,
                       TO_CHAR(i.created_at, 'YYYY-MM-DD HH12:MI AM') as time,
                       dt.doc_name, i.serial_number, u.full_name as cashier
                FROM Invoices i
                JOIN Visits v ON i.visit_id = v.visit_id
                JOIN Patients p ON v.patient_id = p.patient_id
                JOIN Document_Types dt ON i.doc_type_id = dt.doc_type_id
                JOIN Users u ON i.accountant_id = u.user_id
                WHERE i.doc_type_id IS NOT NULL ";
        $params = [];
        
        if ($date) {
            // استخدام النوع DATE للمقارنة في Postgres
            $sql .= " AND i.created_at::date = :date ORDER BY i.created_at DESC";
            $params[':date'] = $date;
        } elseif ($query) {
            // تم تحويل المعرفات إلى نص للمطابقة مع LIKE في Postgres
            $sql .= " AND (p.full_name LIKE :q OR CAST(i.invoice_id AS TEXT) LIKE :q OR CAST(i.serial_number AS TEXT) LIKE :q) ORDER BY i.created_at DESC LIMIT 100";
            $params[':q'] = '%' . $query . '%';
        }
        
        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }
}
?>
