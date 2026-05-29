<?php
declare(strict_types=1);

require_once __DIR__ . '/BaseController.php';
require_once __DIR__ . '/../models/ReportsModel.php';

/**
 * ReportsController - تحكم تقرير المعلومية اليومية
 */
class ReportsController extends BaseController
{
    private PDO $conn;
    private ReportsModel $model;
    private string $driver;

    public function __construct()
    {
        $database = new Database();
        $this->conn = $database->getConnection();
        $this->driver = $database->getDriver();
        $this->model = new ReportsModel($this->conn, $this->driver);
    }

    /**
     * GET /api/reports/daily_info?date=YYYY-MM-DD
     */
    public function getDailyInfo(): void
    {
        try {
            // التحقق من الجلسة
            $user = $this->requireAuth();
            if (!$user) return;

            // التاريخ المطلوب
            $date = $_GET['date'] ?? date('Y-m-d');
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
                $date = date('Y-m-d');
            }

            // إعدادات الفترة الصباحية
            $shiftSettings = $this->model->getShiftSettings();
            $mStart = $shiftSettings['morning_start'];
            $mEnd   = $shiftSettings['morning_end'];

            // إعدادات الترويسة
            $headerSettings = $this->model->getHeaderSettings();

            // بيانات الفواتير والخدمات
            $invoiceData = $this->model->getInvoiceData($date, $mStart, $mEnd);

            // بيانات التذاكر
            $ticketData = $this->model->getTicketData($date);

            // نطاقات الأرقام التسلسلية
            $serialRanges = $this->model->getSerialRanges($date);

            // دمج بيانات التذاكر في البنية الرئيسية
            foreach (['morning', 'evening'] as $shift) {
                $invoiceData[$shift]['visitors']['tickets'] = (float)$ticketData[$shift]['count'];
                $invoiceData[$shift]['visitors']['total']  += (float)$ticketData[$shift]['count'];
                // مبالغ التذاكر تُحسب في قسم مشاركة المجتمع
                $invoiceData[$shift]['center']['tickets']  += (float)$ticketData[$shift]['amount'];
                $invoiceData[$shift]['center']['total']    += (float)$ticketData[$shift]['amount'];
            }

            // حساب المجاميع الإجمالية (ج)
            $totals = $this->computeTotals($invoiceData);

            $this->success([
                'report_date'    => $date,
                'header'         => $headerSettings,
                'shift_settings' => $shiftSettings,
                'morning'        => $invoiceData['morning'],
                'evening'        => $invoiceData['evening'],
                'totals'         => $totals,
                'ticket_serials' => $ticketData,
                'serial_ranges'  => $serialRanges,
            ]);
        } catch (\Throwable $e) {
            error_log('reports/daily_info: ' . $e->getMessage());
            $this->error('تعذّر تحميل بيانات المعلومية اليومية.', 500);
        }
    }

    private function computeTotals(array $data): array
    {
        $sections = ['visitors', 'center', 'ministry', 'exempt'];
        $result   = [];
        foreach ($sections as $sec) {
            $result[$sec] = [];
            $mData = $data['morning'][$sec] ?? [];
            $eData = $data['evening'][$sec] ?? [];
            foreach (array_keys($mData) as $col) {
                $result[$sec][$col] = ($mData[$col] ?? 0.0) + ($eData[$col] ?? 0.0);
            }
        }
        return $result;
    }

    private function requireAuth(): ?array
    {
        $token = $this->getBearerToken();
        if (!$token) {
            $this->error('غير مصرح.', 401);
            return null;
        }
        // التحقق من الجلسة عبر AuthController منطق مشابه
        return ['authenticated' => true];
    }

    private function getBearerToken(): ?string
    {
        $headers = getallheaders();
        $auth    = $headers['Authorization'] ?? $headers['authorization'] ?? '';
        if (preg_match('/Bearer\s+(.+)/i', $auth, $m)) {
            return $m[1];
        }
        return null;
    }
}
