<?php
declare(strict_types=1);

require_once __DIR__ . '/BaseController.php';
require_once __DIR__ . '/../Models/ReportsModel.php';
require_once __DIR__ . '/../Models/AccountingModel.php';
require_once __DIR__ . '/../Utils/ShiftService.php';

/**
 * ReportsController - تحكم تقرير المعلومية اليومية + اليومية الموحّدة
 *
 * 🆕 المرحلة 6 (SHIFTS_REFACTOR_PLAN §7.1):
 *   تمت إضافة endpoint موحّد `daily_view` لتغذية كلٍّ من شاشة اليومية
 *   وشاشة المعلومية اليومية من نفس مصدر البيانات بحيث تكون النتائج
 *   متطابقة عددياً ومنطقياً. الشاشتان تستهلكان أقساماً مختلفة من
 *   نفس الحمولة (journal / daily_info / shift_totals / closures).
 */
class ReportsController extends BaseController
{
    private PDO $conn;
    private ReportsModel $model;
    private AccountingModel $accountingModel;
    private ShiftService $shiftService;
    private string $driver;

    public function __construct()
    {
        $database = new Database();
        $this->conn = $database->getConnection();
        $this->driver = $database->getDriver();
        $this->model = new ReportsModel($this->conn, $this->driver);
        $this->accountingModel = new AccountingModel($this->conn, $this->driver);
        $this->shiftService = new ShiftService($this->conn);
    }

    /**
     * GET /api/reports/daily_info?date=YYYY-MM-DD
     */
    public function getDailyInfo(): void
    {
        try {
            $user = $this->requireAuth();
            if (!$user) {
                return;
            }

            $date = $_GET['date'] ?? date('Y-m-d');
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
                $date = date('Y-m-d');
            }

            $shiftSettings = $this->model->getShiftSettings($date);

            $headerSettings = $this->model->getHeaderSettings();
            $invoiceData    = $this->model->getInvoiceData($date, $shiftSettings);
            $ticketData     = $this->model->getTicketData($date, $shiftSettings);
            $serialRanges   = $this->model->getSerialRanges($date, $shiftSettings);

            foreach (['morning', 'evening'] as $shift) {
                $invoiceData[$shift]['visitors']['tickets'] = (float) $ticketData[$shift]['count'];
                $invoiceData[$shift]['visitors']['total']  += (float) $ticketData[$shift]['count'];

                $invoiceData[$shift]['center']['tickets']  += (float) $ticketData[$shift]['center_amount'];
                $invoiceData[$shift]['center']['total']    += (float) $ticketData[$shift]['center_amount'];

                $invoiceData[$shift]['ministry']['tickets'] += (float) $ticketData[$shift]['ministry_amount'];
                $invoiceData[$shift]['ministry']['total']   += (float) $ticketData[$shift]['ministry_amount'];
            }

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

    /**
     * GET /api/reports/daily_view?date=YYYY-MM-DD&shift_type=morning|evening|all&department_id=N
     *
     * 🆕 المرحلة 6 (SHIFTS_REFACTOR_PLAN §7.1) — مصدر بيانات موحَّد لشاشتي
     * اليومية والمعلومية اليومية. يضمن أن كلتا الشاشتين تعرضان نفس الأرقام.
     *
     * الحمولة:
     *   - report_date       : التاريخ المطلوب (YYYY-MM-DD)
     *   - shift_filter      : 'morning' | 'evening' | 'all'
     *   - shift_boundaries  : حدود الفترات لذلك اليوم من جدول `shifts`
     *   - journal           : { invoices, shift_totals, closures } (لشاشة اليومية)
     *   - daily_info        : { header, shift_settings, morning, evening, totals,
     *                           ticket_serials, serial_ranges } (لشاشة المعلومية اليومية)
     */
    public function getDailyView(): void
    {
        try {
            $user = $this->requireAuth();
            if (!$user) {
                return;
            }

            $date = isset($_GET['date']) ? trim((string) $_GET['date']) : '';
            if ($date === '' || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
                $date = date('Y-m-d');
            }

            $shiftFilter = isset($_GET['shift_type']) ? strtolower(trim((string) $_GET['shift_type'])) : 'all';
            if (!in_array($shiftFilter, ['morning', 'evening', 'all'], true)) {
                $shiftFilter = 'all';
            }

            $deptId = isset($_GET['department_id']) ? (int) $_GET['department_id'] : 0;
            $deptId = $deptId > 0 ? $deptId : 0;

            // ---------------------------------------------------------------
            // (1) حدود الفترات لذلك اليوم من جدول shifts (المصدر الوحيد للحدود)
            // ---------------------------------------------------------------
            try {
                $boundaries = $this->shiftService->getShiftBoundariesForDate($date);
            } catch (\Throwable $e) {
                $boundaries = [];
            }

            // إنشاء فترات اليوم إن لم تكن موجودة (حتى لا تظهر الشاشة فارغة
            // لمجرد أن المستخدم اختار يوماً لم تُسجَّل فيه بيانات بعد).
            if (empty($boundaries)) {
                try {
                    $this->shiftService->ensureDayDefined($date);
                    $boundaries = $this->shiftService->getShiftBoundariesForDate($date);
                } catch (\Throwable $e) {
                    // نتجاهل ونكمل — البيانات القديمة قد لا تعتمد على shifts بعد.
                }
            }

            // ---------------------------------------------------------------
            // (2) الجزء الخاص بشاشة اليومية (Journal)
            // ---------------------------------------------------------------
            $journal = $this->buildJournalSection($date, $deptId, $shiftFilter);

            // ---------------------------------------------------------------
            // (3) الجزء الخاص بشاشة المعلومية اليومية (Daily Info)
            // ---------------------------------------------------------------
            $dailyInfo = $this->buildDailyInfoSection($date, $shiftFilter);

            $this->success([
                'report_date'      => $date,
                'shift_filter'     => $shiftFilter,
                'department_id'    => $deptId,
                'shift_boundaries' => $boundaries,
                'journal'          => $journal,
                'daily_info'       => $dailyInfo,
            ]);
        } catch (\Throwable $e) {
            error_log('reports/daily_view: ' . $e->getMessage());
            $this->error('تعذّر تحميل بيانات اليومية الموحَّدة.', 500);
        }
    }

    /**
     * يبني جزء "اليومية" (سندات + فترات + إقفالات) داخل الحمولة الموحّدة.
     */
    private function buildJournalSection(string $date, int $deptId, string $shiftFilter): array
    {
        $rows = $this->accountingModel->getDailyJournal($date, $deptId > 0 ? $deptId : null);

        $invoiceRows = [];
        foreach ($rows as $row) {
            $docName = (string) $row['doc_name'];
            $hasRelated = !empty($row['related_invoice_id']);

            if ($docName === 'A' && !$hasRelated) {
                $typeLabel = 'دفع كامل (A)';
                $amount = (float) $row['net_amount'];
            } elseif ($docName === 'A' && $hasRelated) {
                $typeLabel = 'دفع جزئي (A)';
                $amount = (float) $row['net_amount'];
            } elseif ($docName === 'B' && $hasRelated) {
                $typeLabel = 'إعفاء جزئي (B)';
                $amount = (float) $row['exemption_value'];
            } elseif ($docName === 'C') {
                $typeLabel = 'إعفاء كلي (C)';
                $amount = (float) $row['exemption_value'];
            } else {
                $typeLabel = $docName;
                $amount = (float) $row['net_amount'];
            }

            $invoiceRows[] = [
                'invoice_id'      => (int) $row['invoice_id'],
                'serial_number'   => (int) $row['serial_number'],
                'doc_name'        => $docName,
                'type_label'      => $typeLabel,
                'group_order'     => (int) $row['group_order'],
                'patient_name'    => (string) $row['patient_name'],
                'department_id'   => $row['department_id'] !== null ? (int) $row['department_id'] : null,
                'department_name' => (string) $row['department_name'],
                'department_code' => (string) $row['department_code'],
                'amount'          => $amount,
                'total'           => (float) $row['total'],
                'exemption_value' => (float) $row['exemption_value'],
                'net_amount'      => (float) $row['net_amount'],
                'cashier'         => (string) $row['cashier'],
                'time'            => (string) $row['time'],
                // نعتمد الفترة المحفوظة على الزيارة أولاً، ثم نلجأ لتحليل الوقت كحل احتياطي.
                'shift_type'      => in_array((string) ($row['visit_shift_type'] ?? ''), ['morning', 'evening'], true)
                    ? (string) $row['visit_shift_type']
                    : $this->classifyInvoiceShift((string) ($row['time'] ?? ''), $date),
            ];
        }

        // فلترة بحسب الفترة المطلوبة (إن اختار المستخدم فترة محددة)
        if ($shiftFilter !== 'all') {
            $invoiceRows = array_values(array_filter(
                $invoiceRows,
                static fn ($r) => ($r['shift_type'] === $shiftFilter)
            ));
        }

        // إجماليات التذاكر للفترات المفتوحة
        $shiftRows = [];
        $settings = $this->accountingModel->getTicketShareSettings();
        $shiftTypesToFetch = $shiftFilter === 'all' ? ['morning', 'evening'] : [$shiftFilter];

        foreach ($shiftTypesToFetch as $type) {
            $summary = $this->accountingModel->getShiftTicketsSummary($type, $date);
            if ($summary === null) {
                continue;
            }
            $count = (int) $summary['tickets_count'];
            $totalAmount = (float) $summary['total_amount'];
            $ministryPerTicket = $type === 'morning'
                ? (float) ($settings['ticket_ministry_share_morning'] ?? 0.0)
                : (float) ($settings['ticket_ministry_share_evening'] ?? 0.0);
            $ministryShare = round($ministryPerTicket * $count, 2);
            $centerShare = max(0.0, $totalAmount - $ministryShare);
            $shiftRows[] = [
                'shift_type'     => $type,
                'shift_label'    => $type === 'morning' ? 'صباحي' : 'مسائي',
                'start_no'       => (int) $summary['start_no'],
                'end_no'         => (int) $summary['end_no'],
                'tickets_count'  => $count,
                'total_amount'   => $totalAmount,
                'center_share'   => $centerShare,
                'ministry_share' => $ministryShare,
            ];
        }

        // إقفالات اليوم
        $closures = $this->accountingModel->getShiftClosuresForDate($date);
        if ($shiftFilter !== 'all') {
            $closures = array_values(array_filter(
                $closures,
                static fn ($c) => ((string) ($c['shift_type'] ?? '')) === $shiftFilter
            ));
        }

        return [
            'invoices'     => $invoiceRows,
            'shift_totals' => $shiftRows,
            'closures'     => $closures,
        ];
    }

    /**
     * يبني جزء "المعلومية اليومية" داخل الحمولة الموحّدة.
     *
     * عند تطبيق فلتر الفترة (morning/evening) يتم تصفير القسم المُستثنى
     * كي تكون الإجماليات متّسقة مع ما تعرضه شاشة اليومية بعد الفلترة.
     */
    private function buildDailyInfoSection(string $date, string $shiftFilter): array
    {
        $shiftSettings = $this->model->getShiftSettings($date);

        $headerSettings = $this->model->getHeaderSettings();
        $invoiceData    = $this->model->getInvoiceData($date, $shiftSettings);
        $ticketData     = $this->model->getTicketData($date, $shiftSettings);
        $serialRanges   = $this->model->getSerialRanges($date, $shiftSettings);

        foreach (['morning', 'evening'] as $shift) {
            $invoiceData[$shift]['visitors']['tickets'] = (float) $ticketData[$shift]['count'];
            $invoiceData[$shift]['visitors']['total']  += (float) $ticketData[$shift]['count'];

            $invoiceData[$shift]['center']['tickets']  += (float) $ticketData[$shift]['center_amount'];
            $invoiceData[$shift]['center']['total']    += (float) $ticketData[$shift]['center_amount'];

            $invoiceData[$shift]['ministry']['tickets'] += (float) $ticketData[$shift]['ministry_amount'];
            $invoiceData[$shift]['ministry']['total']   += (float) $ticketData[$shift]['ministry_amount'];
        }

        // تطبيق فلتر الفترة على المعلومية اليومية: نُصفّر القسم المُستثنى
        if ($shiftFilter === 'morning' || $shiftFilter === 'evening') {
            $other = $shiftFilter === 'morning' ? 'evening' : 'morning';
            $invoiceData[$other] = $this->zeroOutShiftSections($invoiceData[$other]);
            $ticketData[$other]  = $this->zeroOutTicketShift($ticketData[$other]);
            $serialRanges        = $this->filterSerialRangesByShift($serialRanges, $shiftFilter);
        }

        $totals = $this->computeTotals($invoiceData);

        return [
            'header'         => $headerSettings,
            'shift_settings' => $shiftSettings,
            'morning'        => $invoiceData['morning'],
            'evening'        => $invoiceData['evening'],
            'totals'         => $totals,
            'ticket_serials' => $ticketData,
            'serial_ranges'  => $serialRanges,
        ];
    }

    /**
     * يصنّف فترة سند بناءً على وقت الدفع وحدود اليوم في جدول shifts.
     * يدعم الدقائق بدقة، وليس الساعة فقط.
     */
    private function classifyInvoiceShift(string $timeStr, string $date): string
    {
        $normalizedTime = null;

        $normalized = strtoupper(trim($timeStr));
        $dt = DateTimeImmutable::createFromFormat('h:i A', $normalized)
            ?: DateTimeImmutable::createFromFormat('h:i:s A', $normalized)
            ?: DateTimeImmutable::createFromFormat('H:i', $normalized)
            ?: DateTimeImmutable::createFromFormat('H:i:s', $normalized);
        if ($dt instanceof DateTimeImmutable) {
            $normalizedTime = $dt->format('H:i');
        } elseif (preg_match('/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(AM|PM)?$/i', $normalized, $m)) {
            $hour = (int) $m[1];
            $minute = isset($m[2]) ? (int) $m[2] : 0;
            $ampm = strtoupper((string) ($m[3] ?? ''));
            if ($ampm === 'AM') {
                $hour = ($hour === 12) ? 0 : $hour;
            } elseif ($ampm === 'PM') {
                $hour = ($hour === 12) ? 12 : ($hour + 12);
            }
            $normalizedTime = sprintf('%02d:%02d', $hour, $minute);
        }

        if ($normalizedTime === null) {
            return 'morning';
        }

        try {
            $boundaries = $this->shiftService->getShiftBoundariesForDate($date);
            if (empty($boundaries)) {
                $this->shiftService->ensureDayDefined($date);
                $boundaries = $this->shiftService->getShiftBoundariesForDate($date);
            }

            foreach ($boundaries as $b) {
                $shiftType = (string) ($b['shift_type'] ?? '');
                $start = substr((string) ($b['start_time'] ?? ''), 0, 5);
                $end = substr((string) ($b['end_time'] ?? ''), 0, 5);
                if ($shiftType === 'morning' && ($end === '23:59' || $end === '23:59:59')) {
                    return 'morning';
                }
                if ($shiftType === 'evening' && $start === '00:00') {
                    return 'evening';
                }
                if ($start !== '' && $end !== '' && strcmp($normalizedTime, $start) >= 0 && strcmp($normalizedTime, $end) < 0) {
                    return $shiftType === 'morning' ? 'morning' : 'evening';
                }
            }
        } catch (\Throwable $e) {
            // ignore
        }

        return strcmp($normalizedTime, '12:00') < 0 ? 'morning' : 'evening';
    }

    /**
     * يُصفِّر جميع أعمدة فترة محدّدة (تستخدم عند تطبيق فلتر الفترة).
     */
    private function zeroOutShiftSections(array $shiftData): array
    {
        foreach ($shiftData as $section => $cols) {
            if (!is_array($cols)) continue;
            foreach ($cols as $k => $_) {
                $shiftData[$section][$k] = 0.0;
            }
        }
        return $shiftData;
    }

    private function zeroOutTicketShift(array $ticketShift): array
    {
        return [
            'count'           => 0,
            'amount'          => 0.0,
            'center_amount'   => 0.0,
            'ministry_amount' => 0.0,
            'serial_from'     => null,
            'serial_to'       => null,
        ];
    }

    /**
     * يحتفظ فقط بنطاقات التسلسل الخاصة بالفترة المطلوبة (مع إعادة بناء total).
     */
    private function filterSerialRangesByShift(array $serialRanges, string $shiftFilter): array
    {
        $other = $shiftFilter === 'morning' ? 'evening' : 'morning';
        foreach ($serialRanges as $doc => &$ranges) {
            if (!is_array($ranges)) continue;
            if (array_key_exists($other, $ranges)) {
                $ranges[$other] = null;
            }
            // إعادة بناء total ليطابق الفترة المختارة فقط
            $picked = $ranges[$shiftFilter] ?? null;
            $ranges['total'] = $picked;
            $ranges['from']  = $picked['from']  ?? null;
            $ranges['to']    = $picked['to']    ?? null;
            $ranges['count'] = $picked['count'] ?? 0;
        }
        unset($ranges);
        return $serialRanges;
    }

    private function computeTotals(array $data): array
    {
        $sections = ['visitors', 'center', 'ministry', 'exempt'];
        $result = [];

        foreach ($sections as $sec) {
            $result[$sec] = [];
            $mData = $data['morning'][$sec] ?? [];
            $eData = $data['evening'][$sec] ?? [];

            $keys = array_unique(array_merge(array_keys($mData), array_keys($eData)));
            foreach ($keys as $col) {
                $result[$sec][$col] = (float) ($mData[$col] ?? 0.0) + (float) ($eData[$col] ?? 0.0);
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

        return ['authenticated' => true];
    }

    private function getBearerToken(): ?string
    {
        $headers = getallheaders();
        $auth = $headers['Authorization'] ?? $headers['authorization'] ?? '';
        if (preg_match('/Bearer\s+(.+)/i', $auth, $m)) {
            return $m[1];
        }
        return null;
    }
}
