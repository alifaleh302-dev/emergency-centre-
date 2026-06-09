<?php
declare(strict_types=1);

/**
 * ReportsModel - نموذج تقرير المعلومية اليومية
 *
 * إصلاح هام (2026-06): جميع حسابات الفترة (صباحية/مسائية) والتاريخ
 * تتم الآن على التوقيت المحلي (Asia/Aden = UTC+3) بدلاً من UTC،
 * لأن قاعدة البيانات تخزن بـ TIMESTAMPTZ بـ UTC، وعند استخراج
 * EXTRACT(HOUR) أو DATE() مباشرةً كانت النتيجة بالـ UTC مما يؤدي
 * إلى تصنيف خاطئ للفترة (مثلاً 14:00 UTC = 17:00 محلياً قد يُعد
 * صباحياً عند المقارنة بـ 12).
 */
class ReportsModel
{
    private PDO $conn;
    private string $driver;
    private string $tz;

    public function __construct(PDO $db, string $driver = 'pgsql')
    {
        $this->conn = $db;
        $this->driver = $driver;
        // التوقيت المحلي للنظام (افتراضي Asia/Aden) يمكن تجاوزه عبر APP_TIMEZONE
        $this->tz = getenv('APP_TIMEZONE') ?: 'Asia/Aden';
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
                    || mb_strpos($serviceName, 'تلفزيوني') !== false
                    || mb_strpos($serviceName, 'سونار') !== false
                    || mb_strpos($serviceName, 'إيكو') !== false
                    || mb_strpos($serviceName, 'ايكو') !== false
                    || mb_strpos($serviceName, 'تليفزيوني') !== false
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
     * الأعمدة الفارغة في التقرير
     */
    private function emptyColumns(): array
    {
        return [
            'lab'      => 0.0,
            'amaliyat' => 0.0,
            'ruqood'   => 0.0,
            'mojara'   => 0.0,
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
     * شرط الفاتورة النشطة وغير المرتبطة بسند ملغى
     */
    private function activeInvoiceCondition(string $alias = 'i'): string
    {
        // فاتورة "فعّالة" = غير ملغاة + غير محذوفة منطقياً + فاتورتها المرتبطة (إن وُجدت) فعّالة
        return "{$alias}.cancelled_at IS NULL
            AND {$alias}.is_deleted = FALSE
            AND (
                {$alias}.related_invoice_id IS NULL
                OR NOT EXISTS (
                    SELECT 1
                    FROM invoices rel
                    WHERE rel.invoice_id = {$alias}.related_invoice_id
                      AND (rel.cancelled_at IS NOT NULL OR rel.is_deleted = TRUE)
                )
            )";
    }

    /**
     * دمج أكثر من نطاق تسلسلي في نطاق واحد
     */
    private function mergeRanges(?array ...$ranges): ?array
    {
        $valid = array_values(array_filter($ranges, static fn ($r) => is_array($r) && !empty($r['from']) && !empty($r['to'])));
        if (empty($valid)) {
            return null;
        }

        $froms = array_map(static fn ($r) => (int) $r['from'], $valid);
        $tos   = array_map(static fn ($r) => (int) $r['to'], $valid);
        $count = array_sum(array_map(static fn ($r) => (int) ($r['count'] ?? 0), $valid));

        return [
            'from'  => min($froms),
            'to'    => max($tos),
            'count' => $count,
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
            'morning_start' => (int) ($rows['ticket_morning_start_hour'] ?? 5),
            'morning_end'   => (int) ($rows['ticket_morning_end_hour'] ?? 12),
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
     * تحديد الفترة (صباحية/مسائية) بناءً على وقت التوقيت المحلي.
     * يقبل timestamp بأي صيغة قابلة لـ DateTimeImmutable.
     */
    private function getShift(string $timestamp, int $mStart, int $mEnd): string
    {
        try {
            $dt = new DateTimeImmutable($timestamp);
            $dt = $dt->setTimezone(new DateTimeZone($this->tz));
            $hour = (int) $dt->format('G');
        } catch (\Throwable $e) {
            $hour = (int) date('G', strtotime($timestamp));
        }
        return ($hour >= $mStart && $hour < $mEnd) ? 'morning' : 'evening';
    }

    /**
     * تجهيز بيانات الفواتير والخدمات للتقرير اليومي.
     *
     * منطق التوزيع:
     * - حصة الوزارة ثابتة على سند A فقط.
     * - حصة المركز = المدفوع نقداً بعد خصم حصة الوزارة.
     * - الإعفاء = الجزء غير المحصل من حصة المركز، أو كامل قيمة الخدمة في سند C.
     * - أي سند مرتبط بسند ملغى يُستبعد بالكامل.
     *
     * تنبيه: نستخدم DATE(... AT TIME ZONE :tz) لاختيار الفواتير التي
     * يقع تاريخها المحلي (لا UTC) ضمن تاريخ التقرير.
     *
     * إصلاح هام (2026-06): "عدد المترددين" (visitors) لكل قسم/خدمة
     * يُحسب الآن بعدد الزيارات المميزة (DISTINCT visit_id) التي
     * استلمت خدمة من هذا القسم خلال الفترة، بدلاً من جمع كميات
     * الخدمات (quantity). فمريض واحد قد يجري عدة فحوصات مختبر
     * في زيارة واحدة، ويجب أن يُحسب مترددًا واحدًا على المختبر،
     * لا عدة مترددين بعدد الفحوصات.
     * بالنسبة للفواتير التجميعية التي لا ترتبط بزيارة
     * (visit_id IS NULL — سندات إغلاق الفترة)، نُبقي على عدّ
     * الكميات (quantity) كاحتياط لأنها لا تمثل زيارة واحدة
     * بل تجميع لعدة عمليات.
     */
    public function getInvoiceData(string $reportDate, int $mStart, int $mEnd): array
    {
        $sql = "
            SELECT
                i.invoice_id,
                i.visit_id,
                i.paid_at,
                (i.paid_at AT TIME ZONE :tz) AS paid_at_local,
                s.shift_type AS shift_type_saved,
                s.shift_date AS shift_date_saved,
                i.net_amount,
                i.exemption_value,
                i.related_invoice_id,
                dt.doc_name,
                id.detail_id,
                id.service_id,
                sm.service_name,
                COALESCE(d.department_code, 'Other') AS department_code,
                CAST(id.quantity AS FLOAT) AS quantity,
                CAST(id.service_price_at_time * id.quantity AS FLOAT) AS gross_svc,
                CAST(id.ministry_share_at_time AS FLOAT) AS ministry_svc,
                CAST(COALESCE(sm.ministry_share, 0) * id.quantity AS FLOAT) AS ministry_svc_fallback
            FROM invoices i
            LEFT JOIN visits v ON v.visit_id = i.visit_id AND v.status NOT IN ('Deleted', 'Cancelled') /* SOFT_DELETE_FILTER */
            LEFT JOIN shifts s ON s.shift_id = v.shift_id
            JOIN document_types dt ON i.doc_type_id = dt.doc_type_id
            JOIN invoice_details id ON id.invoice_id = i.invoice_id
            JOIN services_master sm ON id.service_id = sm.service_id AND COALESCE(sm.is_deleted, FALSE) = FALSE /* SOFT_DELETE_FILTER */
            LEFT JOIN service_categories sc ON sm.category_id = sc.category_id AND COALESCE(sc.is_deleted, FALSE) = FALSE /* SOFT_DELETE_FILTER */
            LEFT JOIN departments d ON sc.department_id = d.department_id AND COALESCE(d.is_deleted, FALSE) = FALSE /* SOFT_DELETE_FILTER */
            WHERE {$this->activeInvoiceCondition('i')}
              AND COALESCE(s.shift_date, DATE(i.paid_at AT TIME ZONE :tz)) = :report_date
              AND dt.doc_name IN ('A', 'B', 'C')
            ORDER BY i.invoice_id, id.detail_id
        ";

        $stmt = $this->conn->prepare($sql);
        $stmt->execute([':report_date' => $reportDate, ':tz' => $this->tz]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $result = $this->createEmptyResult();
        if (empty($rows)) {
            return $result;
        }

        $grouped = [];
        foreach ($rows as $row) {
            $invoiceId = (int) $row['invoice_id'];
            if (!isset($grouped[$invoiceId])) {
                $grouped[$invoiceId] = [
                    'invoice_id'         => $invoiceId,
                    'visit_id'           => $row['visit_id'] !== null ? (int) $row['visit_id'] : null,
                    'paid_at_local'      => (string) $row['paid_at_local'],
                    'shift_type_saved'   => $row['shift_type_saved'] !== null ? (string) $row['shift_type_saved'] : null,
                    'doc_name'           => (string) $row['doc_name'],
                    'net_amount'         => (float) $row['net_amount'],
                    'exemption_value'    => (float) $row['exemption_value'],
                    'related_invoice_id' => $row['related_invoice_id'] !== null ? (int) $row['related_invoice_id'] : null,
                    'lines'              => [],
                ];
            }

            $grossSvc = (float) $row['gross_svc'];
            $storedMinistry = (float) $row['ministry_svc'];
            $fallbackMinistry = (float) $row['ministry_svc_fallback'];
            $ministrySvc = ((string) $row['doc_name'] === 'A')
                ? min($storedMinistry > 0 ? $storedMinistry : $fallbackMinistry, $grossSvc)
                : 0.0;

            $grouped[$invoiceId]['lines'][] = [
                'column'     => $this->mapServiceToColumn((string) $row['department_code'], (string) $row['service_name']),
                'quantity'   => (float) $row['quantity'],
                'gross'      => $grossSvc,
                'ministry'   => $ministrySvc,
                'raw_center' => max($grossSvc - $ministrySvc, 0.0),
            ];
        }

        // مجموعات لمتابعة عدد المترددين (الزيارات المميزة) لكل (فترة × عمود)
        // وكذلك لكل (فترة × total) لاحتساب "إجمالي المترددين على الخدمات".
        // المفتاح: shift => col => [visit_id => true]
        $visitorVisits = [
            'morning' => [],
            'evening' => [],
        ];
        // أعداد إضافية من السندات التجميعية (visit_id IS NULL) — نُبقي
        // على عدّ الكميات لها كاحتياط لأنها لا تخص زيارة مفردة.
        $visitorBulk = [
            'morning' => [],
            'evening' => [],
        ];

        foreach ($grouped as $invoice) {
            // ⚠️ paid_at_local هو timestamp بدون منطقة زمنية (محول إلى التوقيت المحلي)
            // لذا نمرّره مع DateTimeZone::UTC حتى لا يعيد PHP تحويله ثم نسأل عن الساعة مباشرة.
            $shift   = in_array($invoice['shift_type_saved'] ?? null, ['morning', 'evening'], true)
                ? (string) $invoice['shift_type_saved']
                : $this->getShiftFromLocalString($invoice['paid_at_local'], $mStart, $mEnd);
            $doc     = $invoice['doc_name'];
            $lines   = $invoice['lines'];
            $visitId = $invoice['visit_id'];

            $grossTotal       = array_sum(array_map(static fn ($line) => $line['gross'], $lines));
            $rawCenterTotal   = array_sum(array_map(static fn ($line) => $line['raw_center'], $lines));
            $rawMinistryTotal = array_sum(array_map(static fn ($line) => $line['ministry'], $lines));

            $ministryCollectedTotal = 0.0;
            $centerCollectedTotal   = 0.0;
            $distributionBaseTotal  = 0.0;

            if ($doc === 'A') {
                $ministryCollectedTotal = $rawMinistryTotal;
                $centerCollectedTotal   = max($invoice['net_amount'] - $ministryCollectedTotal, 0.0);
                $centerCollectedTotal   = min($centerCollectedTotal, $rawCenterTotal);
                $distributionBaseTotal  = $rawCenterTotal;
            } elseif ($doc === 'B') {
                // توافق عكسي مع سندات B القديمة التي كانت تحمل التفاصيل نفسها.
                $ministryCollectedTotal = 0.0;
                $centerCollectedTotal   = min(max($invoice['net_amount'], 0.0), $grossTotal);
                $distributionBaseTotal  = $grossTotal;
            } else {
                // سند C = إعفاء كلي
                $ministryCollectedTotal = 0.0;
                $centerCollectedTotal   = 0.0;
                $distributionBaseTotal  = $grossTotal;
            }

            $centerRatio = $distributionBaseTotal > 0 ? ($centerCollectedTotal / $distributionBaseTotal) : 0.0;

            foreach ($lines as $line) {
                $col = $line['column'];

                if ($doc === 'A') {
                    $centerSvc   = $line['raw_center'] * $centerRatio;
                    $ministrySvc = $line['ministry'];
                    $exemptSvc   = max($line['raw_center'] - $centerSvc, 0.0);
                } elseif ($doc === 'B') {
                    $centerSvc   = $line['gross'] * $centerRatio;
                    $ministrySvc = 0.0;
                    $exemptSvc   = max($line['gross'] - $centerSvc, 0.0);
                } else {
                    $centerSvc   = 0.0;
                    $ministrySvc = 0.0;
                    $exemptSvc   = $line['gross'];
                }

                // ---- عدد المترددين: زيارات مميزة لكل عمود ----
                // إذا كان للفاتورة visit_id (الحالة المعتادة): نسجّل الزيارة
                // في مجموعة العمود وفي مجموعة الإجمالي (total) لتلك الفترة،
                // فلا يُحسب المريض مرتين لنفس العمود مهما تعدّدت سطور الفاتورة.
                // إذا كانت الفاتورة تجميعية (visit_id = NULL): نضيف الكمية
                // مباشرة إلى العدّاد الاحتياطي.
                if ($visitId !== null) {
                    if (!isset($visitorVisits[$shift][$col])) {
                        $visitorVisits[$shift][$col] = [];
                    }
                    $visitorVisits[$shift][$col][$visitId] = true;

                    if (!isset($visitorVisits[$shift]['total'])) {
                        $visitorVisits[$shift]['total'] = [];
                    }
                    // ملاحظة: "total" لكل فترة يجمع المترددين عبر جميع الأقسام
                    // مع تكرار من زار أكثر من قسم (متعارف عليه إحصائياً كـ
                    // "إجمالي حالات التردد على الخدمات"). لذلك نستخدم مفتاحاً
                    // مركّباً (visit_id|col) كي لا تُدمج الأعمدة لنفس الزيارة.
                    $visitorVisits[$shift]['total'][$visitId . '|' . $col] = true;
                } else {
                    if (!isset($visitorBulk[$shift][$col])) {
                        $visitorBulk[$shift][$col] = 0.0;
                    }
                    $visitorBulk[$shift][$col] += $line['quantity'];
                    if (!isset($visitorBulk[$shift]['total'])) {
                        $visitorBulk[$shift]['total'] = 0.0;
                    }
                    $visitorBulk[$shift]['total'] += $line['quantity'];
                }

                $result[$shift]['center'][$col]      += $centerSvc;
                $result[$shift]['center']['total']   += $centerSvc;

                $result[$shift]['ministry'][$col]    += $ministrySvc;
                $result[$shift]['ministry']['total'] += $ministrySvc;

                $result[$shift]['exempt'][$col]      += $exemptSvc;
                $result[$shift]['exempt']['total']   += $exemptSvc;
            }
        }

        // ----- تركيب النتيجة النهائية لعدد المترددين -----
        // visitors[col] = عدد الزيارات المميزة + عدد السندات التجميعية (إن وجدت)
        foreach (['morning', 'evening'] as $shift) {
            $cols = array_unique(array_merge(
                array_keys($visitorVisits[$shift] ?? []),
                array_keys($visitorBulk[$shift] ?? [])
            ));
            foreach ($cols as $col) {
                $distinct = isset($visitorVisits[$shift][$col]) ? count($visitorVisits[$shift][$col]) : 0;
                $bulk     = (float) ($visitorBulk[$shift][$col] ?? 0.0);
                $result[$shift]['visitors'][$col] = (float) $distinct + $bulk;
            }
        }

        return $result;
    }

    /**
     * استخراج الساعة من سلسلة timestamp محلية (بدون منطقة زمنية)
     * التي أعادتها قاعدة البيانات بعد AT TIME ZONE.
     */
    private function getShiftFromLocalString(string $localTs, int $mStart, int $mEnd): string
    {
        // النص بصيغة 'YYYY-MM-DD HH:MM:SS.fff' بدون TZ → نأخذ الساعة مباشرة
        if (preg_match('/\b(\d{1,2}):\d{2}:\d{2}/', $localTs, $m)) {
            $hour = (int) $m[1];
            return ($hour >= $mStart && $hour < $mEnd) ? 'morning' : 'evening';
        }
        // fallback
        return $this->getShift($localTs, $mStart, $mEnd);
    }

    /**
     * بيانات تذاكر المعاينة - إعادة بناء (2026-06):
     *   • الفترة (صباحي/مسائي) تُحدّد الآن بحسب الساعة المحلية فعلياً
     *     (وليس حسب ticket_type المخزن الذي قد يكون قد سُجّل تحت
     *     timezone خاطئ في الإصدارات السابقة).
     *   • التاريخ يُقارن أيضاً على التوقيت المحلي.
     *   • تُرجع أرقام التسلسل (from/to/count) لكل فترة منفصلة
     *     ومجموع اليوم total (من أول تذكرة إلى آخر تذكرة).
     */
    public function getTicketData(string $reportDate, int $mStart = 5, int $mEnd = 12): array
    {
        $sql = "
            SELECT
                COALESCE(
                    s.shift_type,
                    CASE WHEN EXTRACT(HOUR FROM t.created_at AT TIME ZONE :tz) >= :m_start
                              AND EXTRACT(HOUR FROM t.created_at AT TIME ZONE :tz) <  :m_end
                         THEN 'morning' ELSE 'evening' END
                ) AS shift,
                COUNT(*) AS ticket_count,
                SUM(t.amount) AS ticket_amount,
                MIN(t.serial_number) AS serial_from,
                MAX(t.serial_number) AS serial_to
            FROM examination_tickets t
            JOIN visits v ON t.visit_id = v.visit_id AND v.status NOT IN ('Deleted', 'Cancelled') /* SOFT_DELETE_FILTER */
            LEFT JOIN shifts s ON s.shift_id = v.shift_id
            WHERE v.cancelled_at IS NULL
              AND COALESCE(s.shift_date, DATE(t.created_at AT TIME ZONE :tz)) = :report_date
            GROUP BY 1
        ";

        $stmt = $this->conn->prepare($sql);
        $stmt->execute([
            ':report_date' => $reportDate,
            ':tz'          => $this->tz,
            ':m_start'     => $mStart,
            ':m_end'       => $mEnd,
        ]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        // جلب حصص الوزارة (المشتركة) لكل فترة من إعدادات النظام
        // المبلغ الكلّي للتذكرة يُقسّم إلى: حصة الوزارة (مشتركة) + حصة المركز (مشاركة مجتمع)
        $ticketShare = $this->getTicketMinistryShareSettings();
        $ministryPerTicket = [
            'morning' => (float) ($ticketShare['ticket_ministry_share_morning'] ?? 0.0),
            'evening' => (float) ($ticketShare['ticket_ministry_share_evening'] ?? 0.0),
        ];

        $emptyShift = static fn () => [
            'count'           => 0,
            'amount'          => 0.0,
            'center_amount'   => 0.0,
            'ministry_amount' => 0.0,
            'serial_from'     => null,
            'serial_to'       => null,
        ];

        $result = [
            'morning' => $emptyShift(),
            'evening' => $emptyShift(),
        ];

        foreach ($rows as $row) {
            $shift = ((string) $row['shift']) === 'morning' ? 'morning' : 'evening';
            $count        = (int) $row['ticket_count'];
            $totalAmount  = (float) $row['ticket_amount'];
            // حصة الوزارة (مشتركة) = عدد التذاكر × حصة الوزارة للتذكرة الواحدة
            $ministryAmt  = round($ministryPerTicket[$shift] * $count, 2);
            if ($ministryAmt > $totalAmount) {
                $ministryAmt = $totalAmount;
            }
            // حصة المركز (مشاركة المجتمع) = الإجمالي - حصة الوزارة
            $centerAmt    = max($totalAmount - $ministryAmt, 0.0);

            $result[$shift]['count']           = $count;
            $result[$shift]['amount']          = $totalAmount;
            $result[$shift]['center_amount']   = $centerAmt;
            $result[$shift]['ministry_amount'] = $ministryAmt;
            $result[$shift]['serial_from']     = $row['serial_from'];
            $result[$shift]['serial_to']       = $row['serial_to'];
        }

        return $result;
    }

    /**
     * جلب حصص الوزارة (المشتركة) من تذاكر المعاينة من إعدادات النظام.
     * تُستخدم لتقسيم مبلغ التذكرة بين (مشاركة المجتمع = حصة المركز)
     * و (المشتركة = حصة الوزارة) في تقرير المعلومية اليومية.
     */
    private function getTicketMinistryShareSettings(): array
    {
        $sql = "SELECT setting_key, setting_value
                FROM system_settings
                WHERE setting_key IN (
                    'ticket_ministry_share_morning',
                    'ticket_ministry_share_evening'
                )";
        $stmt = $this->conn->query($sql);
        $rows = $stmt ? $stmt->fetchAll(PDO::FETCH_ASSOC) : [];
        $out = [
            'ticket_ministry_share_morning' => 0.0,
            'ticket_ministry_share_evening' => 0.0,
        ];
        foreach ($rows as $r) {
            $out[$r['setting_key']] = (float) $r['setting_value'];
        }
        return $out;
    }

    /**
     * نطاقات الأرقام التسلسلية للسندات
     *
     * يُعيد لكل نوع سند (A/B/C/L والإعفاء المركّب EXEMPT) ثلاثة نطاقات:
     *   - morning : السندات الصادرة في الفترة الصباحية فقط
     *   - evening : السندات الصادرة في الفترة المسائية فقط
     *   - total   : من أول سند في اليوم إلى آخر سند (دمج الفترتين)
     *
     * بالإضافة إلى مفاتيح المستوى الأعلى (from/to/count) المبقاة
     * للتوافق العكسي مع الواجهات القديمة — وهي مطابقة لـ total.
     *
     * ⚠️ يستخدم AT TIME ZONE لتحديد الفترة والتاريخ على التوقيت المحلي.
     */
    public function getSerialRanges(string $reportDate, int $mStart = 5, int $mEnd = 12): array
    {
        // تحديد الفترة يعتمد أولاً على visits.shift_id المحفوظة، ثم fallback إلى وقت الدفع.
        $shiftExpr = "COALESCE(
            s.shift_type,
            CASE WHEN EXTRACT(HOUR FROM i.paid_at AT TIME ZONE :tz) >= :m_start
                      AND EXTRACT(HOUR FROM i.paid_at AT TIME ZONE :tz) <  :m_end
                 THEN 'morning' ELSE 'evening' END
        )";

        $sql = "
            SELECT
                dt.doc_name,
                {$shiftExpr} AS shift,
                MIN(i.serial_number) AS serial_from,
                MAX(i.serial_number) AS serial_to,
                COUNT(*) AS doc_count
            FROM invoices i
            LEFT JOIN visits v ON v.visit_id = i.visit_id AND v.status NOT IN ('Deleted', 'Cancelled') /* SOFT_DELETE_FILTER */
            LEFT JOIN shifts s ON s.shift_id = v.shift_id
            JOIN document_types dt ON i.doc_type_id = dt.doc_type_id
            WHERE {$this->activeInvoiceCondition('i')}
              AND COALESCE(s.shift_date, DATE(i.paid_at AT TIME ZONE :tz)) = :report_date
              AND dt.doc_name IN ('A', 'B', 'C')
            GROUP BY dt.doc_name, {$shiftExpr}
        ";

        $stmt = $this->conn->prepare($sql);
        $stmt->execute([
            ':report_date' => $reportDate,
            ':tz'          => $this->tz,
            ':m_start'     => $mStart,
            ':m_end'       => $mEnd,
        ]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $emptyShiftMap = static fn () => [
            'morning' => null,
            'evening' => null,
            'total'   => null,
            // مفاتيح التوافق العكسي (تشير لـ total)
            'from'    => null,
            'to'      => null,
            'count'   => 0,
        ];

        $result = [
            'A'      => $emptyShiftMap(),
            'B'      => $emptyShiftMap(),
            'C'      => $emptyShiftMap(),
            'L'      => $emptyShiftMap(),
            'EXEMPT' => $emptyShiftMap(),
        ];

        foreach ($rows as $row) {
            $docName = (string) $row['doc_name'];
            $shift   = ((string) $row['shift']) === 'morning' ? 'morning' : 'evening';
            if (!isset($result[$docName])) {
                continue;
            }
            $result[$docName][$shift] = [
                'from'  => $row['serial_from'],
                'to'    => $row['serial_to'],
                'count' => (int) $row['doc_count'],
            ];
        }

        // حساب total لكل نوع = دمج النطاقات (من أول سند إلى آخر سند)
        foreach (['A', 'B', 'C'] as $docName) {
            $total = $this->mergeRanges($result[$docName]['morning'], $result[$docName]['evening']);
            $result[$docName]['total'] = $total;
            $result[$docName]['from']  = $total['from']  ?? null;
            $result[$docName]['to']    = $total['to']    ?? null;
            $result[$docName]['count'] = $total['count'] ?? 0;
        }

        // EXEMPT = دمج B و C لكل فترة
        $result['EXEMPT']['morning'] = $this->mergeRanges($result['B']['morning'], $result['C']['morning']);
        $result['EXEMPT']['evening'] = $this->mergeRanges($result['B']['evening'], $result['C']['evening']);
        $exemptTotal = $this->mergeRanges($result['EXEMPT']['morning'], $result['EXEMPT']['evening']);
        $result['EXEMPT']['total'] = $exemptTotal;
        $result['EXEMPT']['from']  = $exemptTotal['from']  ?? null;
        $result['EXEMPT']['to']    = $exemptTotal['to']    ?? null;
        $result['EXEMPT']['count'] = $exemptTotal['count'] ?? 0;

        // L: استمارات المختبر (لكل فترة + الإجمالي = من أول سند إلى آخر سند)
        // مع AT TIME ZONE لتحديد الفترة والتاريخ بحسب التوقيت المحلي.
        try {
            $shiftExprL = "COALESCE(
                s.shift_type,
                CASE WHEN EXTRACT(HOUR FROM ld.created_at AT TIME ZONE :tz) >= :m_start
                           AND EXTRACT(HOUR FROM ld.created_at AT TIME ZONE :tz) <  :m_end
                      THEN 'morning' ELSE 'evening' END
            )";
            $sqlL = "
                SELECT
                    {$shiftExprL} AS shift,
                    MIN(ld.serial_number) AS serial_from,
                    MAX(ld.serial_number) AS serial_to,
                    COUNT(*) AS doc_count
                FROM laboratory_documents ld
                LEFT JOIN invoices i ON ld.invoice_id = i.invoice_id
                LEFT JOIN visits v ON i.visit_id = v.visit_id AND v.status NOT IN ('Deleted', 'Cancelled') /* SOFT_DELETE_FILTER */
                LEFT JOIN shifts s ON s.shift_id = v.shift_id
                WHERE COALESCE(s.shift_date, DATE(ld.created_at AT TIME ZONE :tz)) = :report_date
                  AND (ld.invoice_id IS NULL OR (i.cancelled_at IS NULL AND i.is_deleted = FALSE))
                GROUP BY {$shiftExprL}
            ";
            $stmtL = $this->conn->prepare($sqlL);
            $stmtL->execute([
                ':report_date' => $reportDate,
                ':tz'          => $this->tz,
                ':m_start'     => $mStart,
                ':m_end'       => $mEnd,
            ]);
            $rowsL = $stmtL->fetchAll(PDO::FETCH_ASSOC);

            foreach ($rowsL as $rowL) {
                if ($rowL['serial_from'] === null) continue;
                $shift = ((string) $rowL['shift']) === 'morning' ? 'morning' : 'evening';
                $result['L'][$shift] = [
                    'from'  => $rowL['serial_from'],
                    'to'    => $rowL['serial_to'],
                    'count' => (int) $rowL['doc_count'],
                ];
            }
            $lTotal = $this->mergeRanges($result['L']['morning'], $result['L']['evening']);
            $result['L']['total'] = $lTotal;
            $result['L']['from']  = $lTotal['from']  ?? null;
            $result['L']['to']    = $lTotal['to']    ?? null;
            $result['L']['count'] = $lTotal['count'] ?? 0;
        } catch (\Throwable $e) {
            // جدول المختبر قد لا يكون موجوداً في بعض البيئات.
        }

        return $result;
    }
}
