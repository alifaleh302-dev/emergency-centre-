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
                if (mb_strpos($serviceName, 'تخطيط') !== false) {
                    return 'ecg';
                }
                if (
                    mb_strpos($serviceName, 'تلف') !== false
                    || mb_strpos($serviceName, 'سونار') !== false
                    || mb_strpos($serviceName, 'إيكو') !== false
                    || mb_strpos($serviceName, 'ايكو') !== false
                    || mb_strpos($serviceName, 'تليفزيوني') !== false
                    || mb_strpos($serviceName, 'تلفزيوني') !== false
                ) {
                    return 'tv_xray';
                }
                return 'xray';

            case 'Nursing':
                if (
                    mb_strpos($serviceName, 'مجارح') !== false
                    || mb_strpos($serviceName, 'ضماد') !== false
                    || mb_strpos($serviceName, 'جرح') !== false
                    || mb_strpos($serviceName, 'خياطة') !== false
                ) {
                    return 'mojara';
                }
                return 'other';

            default:
                return 'other';
        }
    }

    /**
     * بنية الأعمدة الفارغة في التقرير.
     */
    private function emptyColumns(): array
    {
        return [
            'mojara'   => 0.0,
            'ruqood'   => 0.0,
            'amaliyat' => 0.0,
            'lab'      => 0.0,
            'ecg'      => 0.0,
            'xray'     => 0.0,
            'qararat'  => 0.0,
            'tv_xray'  => 0.0,
            'asnan'    => 0.0,
            'tickets'  => 0.0,
            'other'    => 0.0,
            'total'    => 0.0,
        ];
    }

    private function emptySections(): array
    {
        return [
            'visitors' => $this->emptyColumns(),
            'center'   => $this->emptyColumns(),
            'ministry' => $this->emptyColumns(),
            'exempt'   => $this->emptyColumns(),
        ];
    }

    private function createEmptyResult(): array
    {
        return [
            'morning' => $this->emptySections(),
            'evening' => $this->emptySections(),
        ];
    }

    /**
     * جلب إعدادات الفترة الصباحية.
     */
    public function getShiftSettings(): array
    {
        $stmt = $this->conn->query(
            "SELECT setting_key, setting_value FROM system_settings
             WHERE setting_key IN ('ticket_morning_start_hour','ticket_morning_end_hour')"
        );
        $rows = $stmt->fetchAll(PDO::FETCH_KEY_PAIR);

        return [
            'morning_start' => (int) ($rows['ticket_morning_start_hour'] ?? 5),
            'morning_end'   => (int) ($rows['ticket_morning_end_hour'] ?? 12),
        ];
    }

    /**
     * جلب إعدادات الترويسة.
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
     * تحديد الفترة (صباحية/مسائية) اعتماداً على ساعة السند.
     */
    private function getShift(string $timestamp, int $mStart, int $mEnd): string
    {
        $hour = (int) date('G', strtotime($timestamp));
        return ($hour >= $mStart && $hour < $mEnd) ? 'morning' : 'evening';
    }

    /**
     * يوزّع المبالغ الخاصة بكل فاتورة على تفاصيلها حتى نضمن:
     * - الكاش = حصة المركز فقط.
     * - المشتركة = حصة الوزارة كاملة وثابتة.
     * - الإعفاء = الجزء المعفى من حصة المركز فقط.
     *
     * ملاحظة مهمة:
     * لا نعتمد على center_share_at_time أو total_at_time لأنها غير موجودة
     * في المخطط الحالي. لذلك نستخرج الإجمالي من service_price_at_time * quantity،
     * ونستخدم ministry_share_at_time مع fallback إلى services_master.ministry_share
     * عند الحاجة، خصوصاً لسندات C القديمة.
     */
    public function getInvoiceData(string $reportDate, int $mStart, int $mEnd): array
    {
        $sql = "
            SELECT
                i.invoice_id,
                i.paid_at,
                i.net_amount,
                i.exemption_value,
                dt.doc_name,
                id.detail_id,
                id.quantity,
                sm.service_name,
                d.department_code,
                id.service_price_at_time,
                id.ministry_share_at_time,
                COALESCE(sm.ministry_share, 0) AS ministry_share_master
            FROM invoices i
            JOIN document_types dt  ON i.doc_type_id = dt.doc_type_id
            JOIN invoice_details id ON id.invoice_id = i.invoice_id
            JOIN services_master sm ON id.service_id = sm.service_id
            JOIN service_categories sc ON sm.category_id = sc.category_id
            JOIN departments d ON sc.department_id = d.department_id
            WHERE i.cancelled_at IS NULL
              AND DATE(i.paid_at) = :report_date
              AND dt.doc_name IN ('A', 'C')
            ORDER BY i.invoice_id, id.detail_id
        ";

        $stmt = $this->conn->prepare($sql);
        $stmt->execute([':report_date' => $reportDate]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $result = $this->createEmptyResult();
        if (!$rows) {
            return $result;
        }

        $grouped = [];
        foreach ($rows as $row) {
            $grouped[(int) $row['invoice_id']][] = $row;
        }

        foreach ($grouped as $invoiceRows) {
            $first = $invoiceRows[0];
            $shift = $this->getShift((string) $first['paid_at'], $mStart, $mEnd);
            $docName = (string) $first['doc_name'];

            $prepared = [];
            $invoiceMinistryTotal = 0.0;
            $invoiceCenterRawTotal = 0.0;

            foreach ($invoiceRows as $row) {
                $gross = (float) $row['service_price_at_time'] * (int) $row['quantity'];
                $storedMinistry = (float) ($row['ministry_share_at_time'] ?? 0);
                $fallbackMinistry = (float) ($row['ministry_share_master'] ?? 0) * (int) $row['quantity'];
                $ministry = $storedMinistry > 0 ? $storedMinistry : $fallbackMinistry;
                $ministry = min($ministry, $gross);
                $rawCenter = max($gross - $ministry, 0.0);

                $prepared[] = [
                    'department_code' => (string) $row['department_code'],
                    'service_name'    => (string) $row['service_name'],
                    'quantity'        => (float) $row['quantity'],
                    'gross'           => $gross,
                    'ministry'        => $ministry,
                    'raw_center'      => $rawCenter,
                ];

                $invoiceMinistryTotal += $ministry;
                $invoiceCenterRawTotal += $rawCenter;
            }

            $centerCollectedTotal = 0.0;
            $exemptTotal = 0.0;

            if ($docName === 'A') {
                // الصافي المدفوع يتضمن حصة الوزارة؛ لذا حصة المركز = المدفوع - الوزارة.
                $centerCollectedTotal = max((float) $first['net_amount'] - $invoiceMinistryTotal, 0.0);
                $centerCollectedTotal = min($centerCollectedTotal, $invoiceCenterRawTotal);
                $exemptTotal = max($invoiceCenterRawTotal - $centerCollectedTotal, 0.0);
            } elseif ($docName === 'C') {
                // في الإعفاء الكلي لا يوجد كاش للمركز، وتظل حصة الوزارة ثابتة بحسب الخدمة.
                $centerCollectedTotal = 0.0;
                $exemptTotal = $invoiceCenterRawTotal;
            }

            foreach ($prepared as $detail) {
                $col = $this->mapServiceToColumn($detail['department_code'], $detail['service_name']);
                $rawCenter = $detail['raw_center'];
                $ratio = $invoiceCenterRawTotal > 0 ? ($rawCenter / $invoiceCenterRawTotal) : 0.0;
                $centerAllocated = $ratio > 0 ? $centerCollectedTotal * $ratio : 0.0;
                $exemptAllocated = $ratio > 0 ? $exemptTotal * $ratio : 0.0;

                $result[$shift]['visitors'][$col] += $detail['quantity'];
                $result[$shift]['visitors']['total'] += $detail['quantity'];

                $result[$shift]['center'][$col] += $centerAllocated;
                $result[$shift]['center']['total'] += $centerAllocated;

                $result[$shift]['ministry'][$col] += $detail['ministry'];
                $result[$shift]['ministry']['total'] += $detail['ministry'];

                $result[$shift]['exempt'][$col] += $exemptAllocated;
                $result[$shift]['exempt']['total'] += $exemptAllocated;
            }
        }

        return $result;
    }

    /**
     * بيانات تذاكر المعاينة + توزيعها إلى حصة مركز/وزارة.
     */
    public function getTicketData(string $reportDate): array
    {
        $settingsStmt = $this->conn->query(
            "SELECT setting_key, setting_value FROM system_settings
             WHERE setting_key IN ('ticket_ministry_share_morning', 'ticket_ministry_share_evening')"
        );
        $ticketSettings = $settingsStmt->fetchAll(PDO::FETCH_KEY_PAIR) ?: [];

        $sql = "
            SELECT
                t.ticket_type AS shift,
                COUNT(*) AS ticket_count,
                SUM(t.amount) AS ticket_amount,
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
            'morning' => [
                'count' => 0,
                'amount' => 0.0,
                'center_amount' => 0.0,
                'ministry_amount' => 0.0,
                'serial_from' => null,
                'serial_to' => null,
            ],
            'evening' => [
                'count' => 0,
                'amount' => 0.0,
                'center_amount' => 0.0,
                'ministry_amount' => 0.0,
                'serial_from' => null,
                'serial_to' => null,
            ],
        ];

        foreach ($rows as $row) {
            $shift = ($row['shift'] === 'morning') ? 'morning' : 'evening';
            $count = (int) $row['ticket_count'];
            $amount = (float) $row['ticket_amount'];
            $perTicketMinistry = (float) (
                $shift === 'morning'
                    ? ($ticketSettings['ticket_ministry_share_morning'] ?? 30)
                    : ($ticketSettings['ticket_ministry_share_evening'] ?? 100)
            );
            $ministryAmount = min($amount, $count * $perTicketMinistry);
            $centerAmount = max($amount - $ministryAmount, 0.0);

            $result[$shift]['count'] = $count;
            $result[$shift]['amount'] = $amount;
            $result[$shift]['center_amount'] = $centerAmount;
            $result[$shift]['ministry_amount'] = $ministryAmount;
            $result[$shift]['serial_from'] = $row['serial_from'];
            $result[$shift]['serial_to'] = $row['serial_to'];
        }

        return $result;
    }

    /**
     * نطاقات الأرقام التسلسلية للسندات.
     */
    public function getSerialRanges(string $reportDate): array
    {
        $sql = "
            SELECT
                dt.doc_name,
                MIN(i.serial_number) AS serial_from,
                MAX(i.serial_number) AS serial_to,
                COUNT(*) AS doc_count
            FROM invoices i
            JOIN document_types dt ON i.doc_type_id = dt.doc_type_id
            WHERE i.cancelled_at IS NULL
              AND DATE(i.paid_at) = :report_date
              AND dt.doc_name IN ('A', 'B', 'C')
            GROUP BY dt.doc_name
        ";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute([':report_date' => $reportDate]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $result = ['A' => null, 'B' => null, 'C' => null, 'L' => null];
        foreach ($rows as $row) {
            $result[$row['doc_name']] = [
                'from'  => $row['serial_from'],
                'to'    => $row['serial_to'],
                'count' => (int) $row['doc_count'],
            ];
        }

        try {
            $sqlL = "
                SELECT
                    MIN(serial_number) AS serial_from,
                    MAX(serial_number) AS serial_to,
                    COUNT(*) AS doc_count
                FROM laboratory_documents
                WHERE DATE(created_at) = :report_date
            ";
            $stmtL = $this->conn->prepare($sqlL);
            $stmtL->execute([':report_date' => $reportDate]);
            $rowL = $stmtL->fetch(PDO::FETCH_ASSOC);

            if ($rowL && $rowL['serial_from'] !== null) {
                $result['L'] = [
                    'from'  => $rowL['serial_from'],
                    'to'    => $rowL['serial_to'],
                    'count' => (int) $rowL['doc_count'],
                ];
            }
        } catch (\Throwable $e) {
            // جدول المختبر قد لا يكون موجوداً في بعض البيئات.
        }

        return $result;
    }
}
