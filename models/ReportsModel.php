<?php
declare(strict_types=1);

/**
 * ReportsModel - نموذج تقرير المعلومية اليومية
 */
class ReportsModel
{
    private PDO $conn;
    private string $driver;

    public function __construct(PDO $db, string $driver = 'pgsql')
    {
        $this->conn = $db;
        $this->driver = $driver;
    }

    /**
     * الأعمدة المقابلة في التقرير لكل قسم/خدمة
     */
    private function mapServiceToColumn(string $deptCode, string $serviceName): string
    {
        switch ($deptCode) {
            case 'Laboratory':
                return 'lab';
            case 'Emergency':
                return 'qararat';
            case 'Radiology':
                if (mb_strpos($serviceName, 'تخطيط') !== false) return 'ecg';
                if (mb_strpos($serviceName, 'تلف') !== false
                    || mb_strpos($serviceName, 'سونار') !== false
                    || mb_strpos($serviceName, 'إيكو') !== false
                    || mb_strpos($serviceName, 'ايكو') !== false
                    || mb_strpos($serviceName, 'تليفزيوني') !== false) return 'tv_xray';
                return 'xray';
            case 'Nursing':
                if (mb_strpos($serviceName, 'مجارح') !== false
                    || mb_strpos($serviceName, 'ضماد') !== false
                    || mb_strpos($serviceName, 'جرح') !== false) return 'mojara';
                return 'other';
            default:
                return 'other';
        }
    }

    /**
     * إعداد بنية البيانات الفارغة للأعمدة
     */
    private function emptyColumns(): array
    {
        return [
            'mojara'  => 0.0,
            'ruqood'  => 0.0,
            'amaliyat'=> 0.0,
            'lab'     => 0.0,
            'ecg'     => 0.0,
            'xray'    => 0.0,
            'qararat' => 0.0,
            'tv_xray' => 0.0,
            'asnan'   => 0.0,
            'tickets' => 0.0,
            'other'   => 0.0,
            'total'   => 0.0,
        ];
    }

    /**
     * جلب إعدادات الفترة الصباحية
     */
    public function getShiftSettings(): array
    {
        $stmt = $this->conn->query(
            "SELECT setting_key, setting_value FROM system_settings
             WHERE setting_key IN ('ticket_morning_start_hour','ticket_morning_end_hour')"
        );
        $rows = $stmt->fetchAll(PDO::FETCH_KEY_PAIR);
        return [
            'morning_start' => (int)($rows['ticket_morning_start_hour'] ?? 5),
            'morning_end'   => (int)($rows['ticket_morning_end_hour']   ?? 12),
        ];
    }

    /**
     * جلب إعدادات الترويسة
     */
    public function getHeaderSettings(): array
    {
        $stmt = $this->conn->query(
            "SELECT setting_key, setting_value FROM system_settings
             WHERE setting_key LIKE 'header_%'"
        );
        return $stmt->fetchAll(PDO::FETCH_KEY_PAIR) ?: [];
    }

    /**
     * تحديد الفترة (صباحية/مسائية) بناءً على وقت
     */
    private function getShift(string $timestamp, int $mStart, int $mEnd): string
    {
        $hour = (int)date('G', strtotime($timestamp));
        return ($hour >= $mStart && $hour < $mEnd) ? 'morning' : 'evening';
    }

    /**
     * الاستعلام الرئيسي لبيانات الفواتير والخدمات
     */
    public function getInvoiceData(string $reportDate, int $mStart, int $mEnd): array
    {
        // الفواتير من نوع A وC مع تفاصيل الخدمات
        $sql = "
            SELECT
                i.invoice_id,
                i.paid_at,
                dt.doc_name,
                id.service_id,
                sm.service_name,
                d.department_code,
                CAST(id.center_share_at_time * id.quantity AS FLOAT)  AS center_share_svc,
                CAST(id.ministry_share_at_time AS FLOAT)               AS ministry_share_svc,
                CAST(id.total_at_time * id.quantity AS FLOAT)          AS total_svc,
                id.quantity
            FROM invoices i
            JOIN document_types dt  ON i.doc_type_id  = dt.doc_type_id
            JOIN invoice_details id ON id.invoice_id   = i.invoice_id
            JOIN services_master sm ON id.service_id   = sm.service_id
            JOIN service_categories sc ON sm.category_id = sc.category_id
            JOIN departments d ON sc.department_id     = d.department_id
            WHERE i.cancelled_at IS NULL
              AND DATE(i.paid_at) = :report_date
              AND dt.doc_name IN ('A','C')
        ";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute([':report_date' => $reportDate]);
        $acRows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        // الفواتير من نوع B (الإعفاء الجزئي) - نجلب تفاصيل الفاتورة الأم (A)
        $sqlB = "
            SELECT
                b.invoice_id AS b_invoice_id,
                b.paid_at,
                id.service_id,
                sm.service_name,
                d.department_code,
                GREATEST(0.0,
                    CAST(id.total_at_time * id.quantity AS FLOAT)
                    - CAST(id.center_share_at_time * id.quantity AS FLOAT)
                    - CAST(id.ministry_share_at_time AS FLOAT)
                ) AS exempt_svc,
                CAST(id.total_at_time * id.quantity AS FLOAT) AS total_svc
            FROM invoices b
            JOIN document_types dt_b ON b.doc_type_id = dt_b.doc_type_id AND dt_b.doc_name = 'B'
            JOIN invoices a ON b.related_invoice_id = a.invoice_id
            JOIN invoice_details id ON id.invoice_id = a.invoice_id
            JOIN services_master sm ON id.service_id = sm.service_id
            JOIN service_categories sc ON sm.category_id = sc.category_id
            JOIN departments d ON sc.department_id = d.department_id
            WHERE b.cancelled_at IS NULL
              AND DATE(b.paid_at) = :report_date
        ";
        $stmtB = $this->conn->prepare($sqlB);
        $stmtB->execute([':report_date' => $reportDate]);
        $bRows = $stmtB->fetchAll(PDO::FETCH_ASSOC);

        // تجميع البيانات
        $result = [
            'morning' => [
                'visitors'  => $this->emptyColumns(),
                'center'    => $this->emptyColumns(),
                'ministry'  => $this->emptyColumns(),
                'exempt'    => $this->emptyColumns(),
            ],
            'evening' => [
                'visitors'  => $this->emptyColumns(),
                'center'    => $this->emptyColumns(),
                'ministry'  => $this->emptyColumns(),
                'exempt'    => $this->emptyColumns(),
            ],
        ];

        foreach ($acRows as $row) {
            $shift  = $this->getShift($row['paid_at'], $mStart, $mEnd);
            $col    = $this->mapServiceToColumn($row['department_code'], $row['service_name']);
            $isC    = ($row['doc_name'] === 'C');

            $centerAmt   = $isC ? 0.0 : (float)$row['center_share_svc'];
            $ministryAmt = $isC ? 0.0 : (float)$row['ministry_share_svc'];
            $exemptAmt   = $isC ? (float)$row['total_svc'] : 0.0;

            $result[$shift]['visitors'][$col]  += (float)$row['quantity'];
            $result[$shift]['visitors']['total'] += (float)$row['quantity'];
            $result[$shift]['center'][$col]    += $centerAmt;
            $result[$shift]['center']['total'] += $centerAmt;
            $result[$shift]['ministry'][$col]  += $ministryAmt;
            $result[$shift]['ministry']['total']+= $ministryAmt;
            $result[$shift]['exempt'][$col]    += $exemptAmt;
            $result[$shift]['exempt']['total'] += $exemptAmt;
        }

        foreach ($bRows as $row) {
            $shift     = $this->getShift($row['paid_at'], $mStart, $mEnd);
            $col       = $this->mapServiceToColumn($row['department_code'], $row['service_name']);
            $exemptAmt = (float)$row['exempt_svc'];

            $result[$shift]['exempt'][$col]    += $exemptAmt;
            $result[$shift]['exempt']['total'] += $exemptAmt;
        }

        return $result;
    }

    /**
     * بيانات تذاكر المعاينة
     */
    public function getTicketData(string $reportDate): array
    {
        $sql = "
            SELECT
                t.ticket_type AS shift,
                COUNT(*)           AS ticket_count,
                SUM(t.amount)      AS ticket_amount,
                MIN(t.serial_number) AS serial_from,
                MAX(t.serial_number) AS serial_to
            FROM examination_tickets t
            JOIN visits v ON t.visit_id = v.visit_id
            WHERE v.cancelled_at IS NULL
              AND DATE(t.created_at) = :report_date
            GROUP BY t.ticket_type
        ";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute([':report_date' => $reportDate]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $result = [
            'morning' => ['count' => 0, 'amount' => 0.0, 'serial_from' => null, 'serial_to' => null],
            'evening' => ['count' => 0, 'amount' => 0.0, 'serial_from' => null, 'serial_to' => null],
        ];
        foreach ($rows as $row) {
            $s = ($row['shift'] === 'morning') ? 'morning' : 'evening';
            $result[$s]['count']       = (int)$row['ticket_count'];
            $result[$s]['amount']      = (float)$row['ticket_amount'];
            $result[$s]['serial_from'] = $row['serial_from'];
            $result[$s]['serial_to']   = $row['serial_to'];
        }
        return $result;
    }

    /**
     * نطاقات الأرقام التسلسلية للسندات
     */
    public function getSerialRanges(string $reportDate): array
    {
        $sql = "
            SELECT
                dt.doc_name,
                MIN(i.serial_number) AS serial_from,
                MAX(i.serial_number) AS serial_to,
                COUNT(*)             AS doc_count
            FROM invoices i
            JOIN document_types dt ON i.doc_type_id = dt.doc_type_id
            WHERE i.cancelled_at IS NULL
              AND DATE(i.paid_at) = :report_date
              AND dt.doc_name IN ('A','B','C')
            GROUP BY dt.doc_name
        ";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute([':report_date' => $reportDate]);
        $rows  = $stmt->fetchAll(PDO::FETCH_ASSOC);
        $result = ['A' => null, 'B' => null, 'C' => null, 'L' => null];
        foreach ($rows as $row) {
            $result[$row['doc_name']] = [
                'from'  => $row['serial_from'],
                'to'    => $row['serial_to'],
                'count' => (int)$row['doc_count'],
            ];
        }

        // سندات المختبر (L)
        try {
            $sqlL = "
                SELECT
                    MIN(serial_number) AS serial_from,
                    MAX(serial_number) AS serial_to,
                    COUNT(*)           AS doc_count
                FROM laboratory_documents
                WHERE DATE(created_at) = :report_date
            ";
            $stmtL = $this->conn->prepare($sqlL);
            $stmtL->execute([':report_date' => $reportDate]);
            $rowL  = $stmtL->fetch(PDO::FETCH_ASSOC);
            if ($rowL && $rowL['serial_from'] !== null) {
                $result['L'] = [
                    'from'  => $rowL['serial_from'],
                    'to'    => $rowL['serial_to'],
                    'count' => (int)$rowL['doc_count'],
                ];
            }
        } catch (\Throwable $e) {
            // جدول المختبر قد لا يكون موجوداً
        }

        return $result;
    }
}
