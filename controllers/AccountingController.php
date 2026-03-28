<?php
// controllers/AccountingController.php
require_once '../config/database.php';
require_once '../models/AccountingModel.php';

class AccountingController {
    private $model;
    private $cashier_id;

    public function __construct($cashier_id) {
        $db = (new Database())->getConnection();
        $this->model = new AccountingModel($db);
        $this->cashier_id = $cashier_id;
    }

    // مسار جلب الفواتير المستحقة
    public function getPendingInvoices() {
        try {
            $invoices = $this->model->getPendingInvoices();
            $result = [];
            
            foreach ($invoices as $inv) {
                // جلب التفاصيل لكل فاتورة
                $details = $this->model->getInvoiceDetails($inv['invoice_id']);
                
                $result[] = [
                    "Invoice_id" => 'INV-' . $inv['invoice_id'],
                    "name" => $inv['name'],
                    "sum" => $inv['sum'],
                    "time" => $inv['time'],
                    "order" => $details // مصفوفة الخدمات وأسعارها
                ];
            }
            
            echo json_encode(["success" => true, "data" => $result]);
        } catch (Exception $e) {
            echo json_encode(["success" => false, "message" => "حدث خطأ: " . $e->getMessage()]);
        }
    }
    
    // مسار جلب الأرقام التسلسلية المتوقعة
    public function getNextSerials() {
        try {
            $serials = $this->model->getNextSerials();
            $data = [];
            foreach($serials as $s) {
                $data[$s['doc_name']] = $s['next_serial'];
            }
            // سيرجع مثلاً: {"A": 102, "B": 201}
            echo json_encode(["success" => true, "data" => $data]);
        } catch (Exception $e) {
            echo json_encode(["success" => false, "message" => "حدث خطأ: " . $e->getMessage()]);
        }
    }

    // مسار تنفيذ تسديد الفاتورة
    public function payInvoice($data) {
        try {
            $invoice_id = preg_replace('/[^0-9]/', '', $data->Invoice_id);
            
            $serial = $this->model->processPayment(
                $invoice_id, 
                $data->net_amount, 
                $data->exemption_value, 
                $data->doc_type, 
                $this->cashier_id
            );
            
            echo json_encode(["success" => true, "message" => "تم السداد بنجاح", "serial_number" => $serial]);
        } catch (Exception $e) {
            echo json_encode(["success" => false, "message" => "حدث خطأ: " . $e->getMessage()]);
        }
    }
    
    // مسار جلب الخزينة اليومية والإحصائيات
    public function getDailyTreasury() {
        try {
            $receipts = $this->model->getDailyReceipts();
            
            // تهيئة مصفوفة الإحصائيات
            $stats = [
                "total_full_exemption" => 0, "count_full_exemption" => 0,
                "total_partial_exemption" => 0, "count_partial_exemption" => 0,
                "total_cash" => 0, "count_cash" => 0,
                "total_payments" => 0
            ];
            
            $formatted_receipts = [];
            
            foreach ($receipts as $r) {
                $type_name = "";
                
                if ($r['doc_name'] === 'A') {
                    // كاش (سند قبض)
                    $type_name = "كاش";
                    $stats['total_cash'] += $r['net_amount'];
                    $stats['count_cash']++;
                    $stats['total_payments'] += $r['net_amount'];
                } else {
                    // إعفاء (B أو C)
                    if ($r['net_amount'] == 0) {
                        // إعفاء كلي (دفع صفر)
                        $type_name = "إعفاء كلي";
                        $stats['total_full_exemption'] += $r['exemption_value'];
                        $stats['count_full_exemption']++;
                    } else {
                        // إعفاء جزئي (دفع جزء وخصم جزء)
                        $type_name = "إعفاء جزئي";
                        $stats['total_partial_exemption'] += $r['exemption_value'];
                        $stats['count_partial_exemption']++;
                        $stats['total_payments'] += $r['net_amount']; // نضيف الجزء المدفوع للخزينة
                    }
                }
                
                $formatted_receipts[] = [
                    "Invoice_id" => $r['invoice_id'],
                    "name" => $r['name'],
                    "amount" => $r['net_amount'],
                    "time" => $r['time'],
                    "cashier" => $r['cashier'],
                    "type" => $type_name
                ];
            }
            
            echo json_encode(["success" => true, "data" => [
                "receipts" => $formatted_receipts,
                "stats" => $stats
            ]]);
        } catch (Exception $e) {
            echo json_encode(["success" => false, "message" => "حدث خطأ: " . $e->getMessage()]);
        }
    }
        // مسار الإيرادات المتدرجة والبحث المالي
        // مسار الإيرادات المتدرجة والبحث المالي (محدث مع التفاصيل)
    public function getRevenuesDrilldown($data) {
        try {
            $level = isset($data->level) ? $data->level : 'years';
            $filterValue = isset($data->filterValue) ? $data->filterValue : null;
            $searchQuery = isset($data->query) ? trim($data->query) : null;
            
            $result = [];

            // إذا كان هناك نص بحث، نتجاهل التدرج وننفذ بحثاً عميقاً
            if (!empty($searchQuery)) {
                $invoices = $this->model->searchOrGetDailyDetails(null, $searchQuery);
                // --- التعديل: جلب الخدمات لكل فاتورة ---
                foreach ($invoices as &$inv) {
                    $inv['services'] = $this->model->getInvoiceDetails($inv['invoice_id']);
                }
                echo json_encode(["success" => true, "level" => "search", "data" => $invoices]);
                return;
            }

            // بناءً على المستوى المطلوب (التدرج)
            switch ($level) {
                case 'years':
                    $result = $this->model->getRevenuesByYears();
                    break;
                case 'months':
                    $result = $this->model->getRevenuesByMonths($filterValue);
                    break;
                case 'days':
                    $parts = explode('-', $filterValue);
                    $result = $this->model->getRevenuesByDays($parts[0], $parts[1]);
                    break;
                case 'details':
                    $invoices = $this->model->searchOrGetDailyDetails($filterValue, null);
                    // --- التعديل: جلب الخدمات لكل فاتورة ---
                    foreach ($invoices as &$inv) {
                        $inv['services'] = $this->model->getInvoiceDetails($inv['invoice_id']);
                    }
                    $result = $invoices;
                    break;
            }

            echo json_encode(["success" => true, "level" => $level, "data" => $result]);
        } catch (Exception $e) {
            echo json_encode(["success" => false, "message" => "حدث خطأ: " . $e->getMessage()]);
        }
    }


}
?>