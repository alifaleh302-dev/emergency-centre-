<?php
declare(strict_types=1);

require_once __DIR__ . '/BaseController.php';
require_once __DIR__ . '/../Utils/AuditService.php';
require_once __DIR__ . '/../Utils/SettingsService.php';

/**
 * FinanceController
 * -----------------------------------------------------------------------------
 * المرحلة M3 من المركز المالي والسندي الشامل.
 *
 * المسؤوليات:
 *  - استقبال طلبات واجهة المركز المالي والتحقق من المدخلات.
 *  - تطبيق الـ scope الأمني: المحاسب يرى حركاته فقط، والمدير يرى الكل.
 *  - التنسيق مع FinanceModel لجلب الـ KPIs، الـ ledger، التفاصيل، التقارير.
 *  - تجهيز بيانات التصدير والطباعة ضمن JSON (الواجهة تُولّد XLSX/HTML لاحقاً).
 *  - تسجيل العمليات الحساسة في audit_logs (تصدير/طباعة/تقارير الوزارة).
 *
 * ملاحظة: تسجيل الـ routes الفعلية في api/index.php مؤجل عمداً إلى المرحلة M4.
 */
class FinanceController extends BaseController
{
    private PDO $conn;
    private FinanceModel $model;
    private AuditService $audit;
    private SettingsService $settings;
    private string $driver;
    private int $userId;
    private string $userRole;
    private string $username;

    public function __construct(int|string $userId, ?string $userRole = null)
    {
        $database = new Database();
        $this->conn = $database->getConnection();
        $this->driver = $database->getDriver();
        $this->model = new FinanceModel($this->conn, $this->driver);
        $this->audit = new AuditService($this->conn);
        $this->settings = new SettingsService($this->conn);
        $this->userId = (int) $userId;
        $this->userRole = trim((string) ($userRole ?? ($_SESSION['job'] ?? '')));
        $this->username = trim((string) ($_SESSION['name'] ?? ('user_' . $this->userId)));
    }

    /**
     * POST /api/finance/overview
     * KPIs + charts.
     */
    public function getOverview($data): void
    {
        try {
            $filters = $this->extractFilters($data, true);
            $kpiScope = $this->buildScopeFilters();

            $payload = [
                'kpis' => $this->model->getKpis($kpiScope),
                'charts' => [
                    'revenue_30days' => $this->model->getRevenue30Days($filters),
                    'type_distribution' => $this->model->getTypeDistribution($filters),
                    'top_services' => $this->model->getTopServices($filters, 10),
                    'accountants_performance' => $this->model->getAccountantsPerformance($filters),
                ],
                'applied_filters' => $this->publicFilters($filters),
                'scope' => $this->buildScopeMeta(),
                'currency_label' => $this->getCurrencyLabel(),
            ];

            $this->success($payload);
        } catch (InvalidArgumentException $exception) {
            $this->error($exception->getMessage(), 422);
        } catch (Throwable $exception) {
            error_log('finance/overview: ' . $exception->getMessage());
            $this->error('تعذر جلب لوحة المركز المالي حالياً.', 500);
        }
    }

    /**
     * POST /api/finance/transactions
     * Unified ledger with paging / sorting / filtering.
     */
    public function getTransactions($data): void
    {
        try {
            $filters = $this->extractFilters($data, true);
            $page = $this->sanitizeInteger($this->getField($data, 'page', 1), 'page', 1);
            $perPage = $this->sanitizeInteger(
                $this->getField($data, 'per_page', $this->settings->getInt('finance_hub_default_page_size', 50)),
                'per_page',
                1
            );
            $sortBy = $this->sanitizeText($this->getField($data, 'sort_by', 'txn_timestamp'), 'sort_by', 50, true) ?: 'txn_timestamp';
            $sortDir = $this->sanitizeText($this->getField($data, 'sort_dir', 'DESC'), 'sort_dir', 8, true) ?: 'DESC';

            $result = $this->model->getTransactions($filters, $page, $perPage, $sortBy, $sortDir);
            $totals = $this->model->getTotals($filters);

            $this->success([
                'rows' => $result['rows'],
                'total_count' => $result['total_count'],
                'page' => $result['page'],
                'per_page' => $result['per_page'],
                'page_total' => $result['page_total'],
                'totals' => $totals,
                'applied_filters' => $this->publicFilters($filters),
                'sort' => [
                    'by' => $sortBy,
                    'dir' => strtoupper($sortDir) === 'ASC' ? 'ASC' : 'DESC',
                ],
                'scope' => $this->buildScopeMeta(),
            ]);
        } catch (InvalidArgumentException $exception) {
            $this->error($exception->getMessage(), 422);
        } catch (Throwable $exception) {
            error_log('finance/transactions: ' . $exception->getMessage());
            $this->error('تعذر جلب سجل الحركات الموحّد حالياً.', 500);
        }
    }

    /**
     * POST /api/finance/transaction_detail
     * Returns a single invoice/ticket detail + audit trail.
     */
    public function getTransactionDetail($data): void
    {
        try {
            $this->requireFields($data, ['txn_id']);
            $txnId = strtoupper($this->sanitizeText($this->getField($data, 'txn_id'), 'txn_id', 40));
            $this->assertTransactionAccessible($txnId);

            $detail = $this->model->getTransactionDetail($txnId);
            if ($detail === null) {
                $this->error('الحركة المطلوبة غير موجودة.', 404);
                return;
            }

            $this->success([
                'detail' => $detail,
                'audit_trail' => $this->getAuditTrail($txnId),
                'scope' => $this->buildScopeMeta(),
            ]);
        } catch (InvalidArgumentException $exception) {
            $this->error($exception->getMessage(), 422);
        } catch (RuntimeException $exception) {
            $this->error($exception->getMessage(), 403);
        } catch (Throwable $exception) {
            error_log('finance/transaction_detail: ' . $exception->getMessage());
            $this->error('تعذر جلب تفاصيل الحركة المطلوبة حالياً.', 500);
        }
    }

    /**
     * POST /api/finance/export
     * Returns prepared JSON for XLSX generation in frontend.
     */
    public function export($data): void
    {
        try {
            $filters = $this->extractFilters($data, true);
            $format = strtolower($this->sanitizeText($this->getField($data, 'format', 'xlsx'), 'format', 10, true) ?: 'xlsx');
            if (!in_array($format, ['xlsx', 'json'], true)) {
                throw new InvalidArgumentException('صيغة التصدير غير مدعومة حالياً. الصيغ المسموحة: xlsx, json');
            }

            $includeSheets = $this->normalizeSheetList($this->getField($data, 'include_sheets', ['summary', 'transactions', 'pivot', 'ministry']));
            $sortBy = $this->sanitizeText($this->getField($data, 'sort_by', 'txn_timestamp'), 'sort_by', 50, true) ?: 'txn_timestamp';
            $sortDir = $this->sanitizeText($this->getField($data, 'sort_dir', 'DESC'), 'sort_dir', 8, true) ?: 'DESC';

            $totals = $this->model->getTotals($filters);
            $exportLimit = max(1, $this->settings->getInt('finance_hub_export_limit', 10000));
            if (($totals['row_count'] ?? 0) > $exportLimit) {
                throw new InvalidArgumentException('عدد السجلات المطلوب تصديرها يتجاوز الحد المسموح (' . $exportLimit . '). يُرجى تضييق الفلاتر أولاً.');
            }

            $transactions = $this->model->getTransactions(
                $filters,
                1,
                max(1, (int) ($totals['row_count'] ?? 1)),
                $sortBy,
                $sortDir
            );

            $payload = [
                'format' => $format,
                'meta' => [
                    'generated_at' => gmdate('c'),
                    'generated_by' => $this->username,
                    'generated_by_role' => $this->userRole,
                    'currency_label' => $this->getCurrencyLabel(),
                    'rows_count' => $transactions['total_count'],
                    'scope' => $this->buildScopeMeta(),
                    'filters' => $this->publicFilters($filters),
                    'include_sheets' => $includeSheets,
                ],
                'sheets' => [],
            ];

            if (in_array('summary', $includeSheets, true)) {
                $payload['sheets']['summary'] = [
                    'label' => 'Summary',
                    'rows' => [[
                        'total_rows' => (int) ($totals['row_count'] ?? 0),
                        'total_amount' => (float) ($totals['sum_total'] ?? 0),
                        'cash_amount' => (float) ($totals['sum_cash'] ?? 0),
                        'exempt_amount' => (float) ($totals['sum_exempt'] ?? 0),
                        'ministry_share' => (float) ($totals['sum_ministry'] ?? 0),
                        'center_share' => (float) ($totals['sum_center'] ?? 0),
                        'count_cash' => (int) ($totals['count_cash'] ?? 0),
                        'count_partial' => (int) ($totals['count_partial'] ?? 0),
                        'count_full' => (int) ($totals['count_full'] ?? 0),
                        'count_tickets' => (int) ($totals['count_tickets'] ?? 0),
                        'count_cancelled' => (int) ($totals['count_cancelled'] ?? 0),
                    ]],
                ];
            }

            if (in_array('transactions', $includeSheets, true)) {
                $payload['sheets']['transactions'] = [
                    'label' => 'Transactions',
                    'columns' => $this->transactionExportColumns(),
                    'rows' => $transactions['rows'],
                    'page_total' => $transactions['page_total'],
                ];
            }

            if (in_array('pivot', $includeSheets, true)) {
                $payload['sheets']['pivot'] = [
                    'label' => 'Pivot',
                    'type_distribution' => $this->model->getTypeDistribution($filters),
                    'top_services' => $this->model->getTopServices($filters, 10),
                    'accountants_performance' => $this->model->getAccountantsPerformance($filters),
                ];
            }

            if (in_array('ministry', $includeSheets, true)) {
                $payload['sheets']['ministry'] = [
                    'label' => 'Ministry Share',
                    'report' => $this->getScopedMinistryReport($filters),
                ];
            }

            $this->logFinanceAction('EXPORT', null, [
                'operation' => 'finance_export',
                'format' => $format,
                'rows_count' => $transactions['total_count'],
                'filters' => $this->publicFilters($filters),
                'include_sheets' => $includeSheets,
            ]);

            $this->success($payload, 'تم تجهيز بيانات التصدير بنجاح.');
        } catch (InvalidArgumentException $exception) {
            $this->error($exception->getMessage(), 422);
        } catch (Throwable $exception) {
            error_log('finance/export: ' . $exception->getMessage());
            $this->error('تعذر تجهيز ملف التصدير حالياً.', 500);
        }
    }

    /**
     * GET /api/finance/filter_options
     */
    public function getFilterOptions(): void
    {
        try {
            $options = $this->model->getFilterOptions();

            if (!$this->isAdmin()) {
                $options['accountants'] = array_values(array_filter(
                    $options['accountants'] ?? [],
                    fn(array $row): bool => (int) ($row['id'] ?? 0) === $this->userId
                ));
            }

            $options['scope'] = $this->buildScopeMeta();
            $options['currency_label'] = $this->getCurrencyLabel();

            $this->success($options);
        } catch (Throwable $exception) {
            error_log('finance/filter_options: ' . $exception->getMessage());
            $this->error('تعذر جلب خيارات الفلاتر حالياً.', 500);
        }
    }

    /**
     * POST /api/finance/ministry_report
     */
    public function getMinistryReport($data): void
    {
        try {
            $filters = $this->extractFilters($data, true);
            $report = $this->getScopedMinistryReport($filters);

            $this->logFinanceAction('REPORT', null, [
                'operation' => 'finance_ministry_report',
                'filters' => $this->publicFilters($filters),
                'totals' => $report['totals'] ?? [],
            ]);

            $this->success([
                'report' => $report,
                'applied_filters' => $this->publicFilters($filters),
                'scope' => $this->buildScopeMeta(),
                'currency_label' => $this->getCurrencyLabel(),
            ]);
        } catch (InvalidArgumentException $exception) {
            $this->error($exception->getMessage(), 422);
        } catch (Throwable $exception) {
            error_log('finance/ministry_report: ' . $exception->getMessage());
            $this->error('تعذر جلب تقرير المشتركة حالياً.', 500);
        }
    }

    /**
     * POST /api/finance/print_voucher
     */
    public function printVoucher($data): void
    {
        try {
            $this->requireFields($data, ['txn_id']);
            $txnId = strtoupper($this->sanitizeText($this->getField($data, 'txn_id'), 'txn_id', 40));
            $this->assertTransactionAccessible($txnId);

            $detail = $this->model->getTransactionDetail($txnId);
            if ($detail === null) {
                $this->error('الحركة المطلوبة غير موجودة.', 404);
                return;
            }

            $payload = [
                'header' => $this->settings->getHeader(),
                'voucher' => $detail,
                'print_meta' => [
                    'printed_at' => gmdate('c'),
                    'printed_by' => $this->username,
                    'printed_by_role' => $this->userRole,
                    'currency_label' => $this->getCurrencyLabel(),
                    'template' => ($detail['source_type'] ?? '') === 'ticket' ? 'ticket_voucher' : 'invoice_voucher',
                    'scope' => $this->buildScopeMeta(),
                ],
            ];

            $this->logFinanceAction('PRINT', $txnId, [
                'operation' => 'finance_print_voucher',
                'txn_id' => $txnId,
                'source_type' => $detail['source_type'] ?? null,
            ]);

            $this->success($payload, 'تم تجهيز بيانات الطباعة بنجاح.');
        } catch (InvalidArgumentException $exception) {
            $this->error($exception->getMessage(), 422);
        } catch (RuntimeException $exception) {
            $this->error($exception->getMessage(), 403);
        } catch (Throwable $exception) {
            error_log('finance/print_voucher: ' . $exception->getMessage());
            $this->error('تعذر تجهيز بيانات الطباعة حالياً.', 500);
        }
    }

    // ---------------------------------------------------------------------
    // Helpers — Security / filters / formatting
    // ---------------------------------------------------------------------

    private function isAdmin(): bool
    {
        return $this->userRole === 'مدير النظام';
    }

    private function buildScopeFilters(): array
    {
        return $this->isAdmin() ? [] : ['_scope_accountant_id' => $this->userId];
    }

    private function buildScopeMeta(): array
    {
        return [
            'mode' => $this->isAdmin() ? 'all' : 'self',
            'user_id' => $this->userId,
            'user_role' => $this->userRole,
        ];
    }

    private function extractFilters($data, bool $applyScope = true): array
    {
        $root = $this->normalizeArray($data);
        $nested = $this->normalizeArray($this->getField($data, 'filters', []));

        $pick = function (string $key, $default = null) use ($root, $nested) {
            if (array_key_exists($key, $nested)) {
                return $nested[$key];
            }
            return $root[$key] ?? $default;
        };

        $period = strtolower(trim((string) $pick('period', '')));
        $from = $this->normalizeDateTime($pick('from'));
        $to = $this->normalizeDateTime($pick('to'), true);

        if (($from === null || $to === null) && $period !== '' && $period !== 'custom') {
            ['from' => $autoFrom, 'to' => $autoTo] = $this->resolvePeriodRange($period);
            $from = $from ?? $autoFrom;
            $to = $to ?? $autoTo;
        }

        $filters = [
            'from' => $from,
            'to' => $to,
            'doc_codes' => $this->normalizeStringList($pick('doc_codes', $pick('doc_code', []))),
            'statuses' => $this->normalizeStringList($pick('statuses', $pick('status', []))),
            'accountant_ids' => $this->normalizeIntList($pick('accountant_ids', $pick('accountant_id', []))),
            'doctor_ids' => $this->normalizeIntList($pick('doctor_ids', $pick('doctor_id', []))),
            'service_ids' => $this->normalizeIntList($pick('service_ids', $pick('service_id', []))),
            'category_ids' => $this->normalizeIntList($pick('category_ids', $pick('category_id', []))),
            'department_ids' => $this->normalizeIntList($pick('department_ids', $pick('department_id', []))),
            'amount_min' => $this->normalizeNullableAmount($pick('amount_min')),
            'amount_max' => $this->normalizeNullableAmount($pick('amount_max')),
            'has_ministry_share' => $this->normalizeBool($pick('has_ministry_share', false)),
            'query' => $this->sanitizeText($pick('query', ''), 'query', 120, true),
        ];

        if ($filters['amount_min'] !== null && $filters['amount_max'] !== null && $filters['amount_min'] > $filters['amount_max']) {
            throw new InvalidArgumentException('قيمة amount_min لا يمكن أن تكون أكبر من amount_max.');
        }

        foreach (['doc_codes', 'statuses', 'accountant_ids', 'doctor_ids', 'service_ids', 'category_ids', 'department_ids'] as $arrayKey) {
            if (empty($filters[$arrayKey])) {
                unset($filters[$arrayKey]);
            }
        }

        if ($filters['from'] === null) unset($filters['from']);
        if ($filters['to'] === null) unset($filters['to']);
        if ($filters['amount_min'] === null) unset($filters['amount_min']);
        if ($filters['amount_max'] === null) unset($filters['amount_max']);
        if ($filters['query'] === '') unset($filters['query']);
        if (empty($filters['has_ministry_share'])) unset($filters['has_ministry_share']);

        if ($applyScope && !$this->isAdmin()) {
            $filters['_scope_accountant_id'] = $this->userId;
        }

        return $filters;
    }

    private function normalizeArray(mixed $value): array
    {
        if (is_array($value)) {
            return $value;
        }

        if (is_object($value)) {
            $decoded = json_decode(json_encode($value, JSON_UNESCAPED_UNICODE), true);
            return is_array($decoded) ? $decoded : [];
        }

        return [];
    }

    private function normalizeStringList(mixed $value): array
    {
        $list = is_array($value) ? $value : (($value === null || $value === '') ? [] : [$value]);
        $out = [];

        foreach ($list as $item) {
            $clean = strtoupper(trim((string) $item));
            if ($clean !== '') {
                $out[] = $clean;
            }
        }

        return array_values(array_unique($out));
    }

    private function normalizeIntList(mixed $value): array
    {
        $list = is_array($value) ? $value : (($value === null || $value === '') ? [] : [$value]);
        $out = [];

        foreach ($list as $item) {
            if (is_numeric($item) && (int) $item > 0) {
                $out[] = (int) $item;
            }
        }

        return array_values(array_unique($out));
    }

    private function normalizeNullableAmount(mixed $value): ?float
    {
        if ($value === null || $value === '') {
            return null;
        }
        return $this->sanitizeAmount($value, 'amount');
    }

    private function normalizeBool(mixed $value): bool
    {
        if (is_bool($value)) {
            return $value;
        }

        if (is_numeric($value)) {
            return (int) $value === 1;
        }

        $normalized = strtolower(trim((string) $value));
        return in_array($normalized, ['1', 'true', 'yes', 'on'], true);
    }

    private function normalizeDateTime(mixed $value, bool $endOfDay = false): ?string
    {
        if ($value === null) {
            return null;
        }

        $raw = trim((string) $value);
        if ($raw === '') {
            return null;
        }

        $raw = str_replace('T', ' ', $raw);

        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $raw)) {
            return $raw . ($endOfDay ? ' 23:59:59' : ' 00:00:00');
        }

        if (preg_match('/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}$/', $raw)) {
            return $raw . ':00';
        }

        if (preg_match('/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/', $raw)) {
            return $raw;
        }

        $ts = strtotime($raw);
        if ($ts === false) {
            throw new InvalidArgumentException('صيغة التاريخ/الوقت غير صحيحة.');
        }

        return date('Y-m-d H:i:s', $ts);
    }

    private function resolvePeriodRange(string $period): array
    {
        $now = new DateTimeImmutable('now');
        $period = strtolower($period);

        return match ($period) {
            'today' => [
                'from' => $now->setTime(0, 0, 0)->format('Y-m-d H:i:s'),
                'to' => $now->setTime(23, 59, 59)->format('Y-m-d H:i:s'),
            ],
            'week' => [
                'from' => $now->modify('monday this week')->setTime(0, 0, 0)->format('Y-m-d H:i:s'),
                'to' => $now->modify('sunday this week')->setTime(23, 59, 59)->format('Y-m-d H:i:s'),
            ],
            'month' => [
                'from' => $now->modify('first day of this month')->setTime(0, 0, 0)->format('Y-m-d H:i:s'),
                'to' => $now->setTime(23, 59, 59)->format('Y-m-d H:i:s'),
            ],
            'year' => [
                'from' => $now->setDate((int) $now->format('Y'), 1, 1)->setTime(0, 0, 0)->format('Y-m-d H:i:s'),
                'to' => $now->setTime(23, 59, 59)->format('Y-m-d H:i:s'),
            ],
            default => ['from' => null, 'to' => null],
        };
    }

    private function publicFilters(array $filters): array
    {
        $public = $filters;
        unset($public['_scope_accountant_id']);
        return $public;
    }

    private function normalizeSheetList(mixed $value): array
    {
        $list = is_array($value) ? $value : (($value === null || $value === '') ? [] : [$value]);
        $allowed = ['summary', 'transactions', 'pivot', 'ministry'];
        $clean = [];

        foreach ($list as $item) {
            $sheet = strtolower(trim((string) $item));
            if (in_array($sheet, $allowed, true)) {
                $clean[] = $sheet;
            }
        }

        $clean = array_values(array_unique($clean));
        return !empty($clean) ? $clean : ['summary', 'transactions', 'pivot', 'ministry'];
    }

    private function transactionExportColumns(): array
    {
        return [
            ['key' => 'txn_id', 'label' => 'معرّف الحركة'],
            ['key' => 'txn_type_label', 'label' => 'نوع الحركة'],
            ['key' => 'doc_code', 'label' => 'كود السند'],
            ['key' => 'serial_number', 'label' => 'الرقم التسلسلي'],
            ['key' => 'patient_name', 'label' => 'المريض'],
            ['key' => 'total', 'label' => 'الإجمالي'],
            ['key' => 'cash_amount', 'label' => 'الكاش'],
            ['key' => 'exempt_amount', 'label' => 'الإعفاء'],
            ['key' => 'center_share', 'label' => 'المشاركة'],
            ['key' => 'ministry_share', 'label' => 'المشتركة'],
            ['key' => 'accountant_name', 'label' => 'المحاسب'],
            ['key' => 'doctor_name', 'label' => 'الطبيب'],
            ['key' => 'txn_timestamp', 'label' => 'التاريخ والوقت'],
            ['key' => 'status', 'label' => 'الحالة'],
        ];
    }

    private function getCurrencyLabel(): string
    {
        return $this->settings->get('finance_hub_currency_label', 'ريال') ?? 'ريال';
    }

    private function assertTransactionAccessible(string $txnId): void
    {
        if ($this->isAdmin()) {
            return;
        }

        $ownerId = $this->fetchTransactionOwnerId($txnId);
        if ($ownerId === null) {
            throw new RuntimeException('لا يمكنك الوصول إلى هذه الحركة أو أنها غير موجودة.');
        }

        if ($ownerId !== $this->userId) {
            throw new RuntimeException('ليس لديك صلاحية للوصول إلى هذه الحركة.');
        }
    }

    private function fetchTransactionOwnerId(string $txnId): ?int
    {
        if (!preg_match('/^(INV|TKT)-(\d+)$/', $txnId, $matches)) {
            return null;
        }

        $prefix = $matches[1];
        $id = (int) $matches[2];

        if ($prefix === 'INV') {
            $stmt = $this->conn->prepare('SELECT accountant_id FROM invoices WHERE invoice_id = :id LIMIT 1');
            $stmt->execute([':id' => $id]);
            $value = $stmt->fetchColumn();
            return $value === false || $value === null ? null : (int) $value;
        }

        $stmt = $this->conn->prepare('SELECT issued_by FROM examination_tickets WHERE ticket_id = :id LIMIT 1');
        $stmt->execute([':id' => $id]);
        $value = $stmt->fetchColumn();
        return $value === false || $value === null ? null : (int) $value;
    }

    private function getAuditTrail(string $txnId): array
    {
        if (!preg_match('/^(INV|TKT)-(\d+)$/', $txnId, $matches)) {
            return [];
        }

        $tableName = $matches[1] === 'INV' ? 'invoices' : 'examination_tickets';
        $recordId = $matches[2];
        $likeToken = '%' . $txnId . '%';

        if ($this->driver === 'pgsql') {
            $sql = "
                SELECT log_id, username, action, table_name, record_id, old_values, new_values, created_at
                FROM audit_logs
                WHERE (table_name = :tbl AND record_id = :rid)
                   OR (
                        table_name = 'finance'
                        AND (
                            COALESCE(new_values::text, '') ILIKE :needle
                            OR COALESCE(old_values::text, '') ILIKE :needle
                        )
                   )
                ORDER BY created_at DESC, log_id DESC
                LIMIT 50
            ";
        } else {
            $sql = "
                SELECT log_id, username, action, table_name, record_id, old_values, new_values, created_at
                FROM audit_logs
                WHERE (table_name = :tbl AND record_id = :rid)
                   OR (
                        table_name = 'finance'
                        AND (
                            COALESCE(CAST(new_values AS CHAR), '') LIKE :needle
                            OR COALESCE(CAST(old_values AS CHAR), '') LIKE :needle
                        )
                   )
                ORDER BY created_at DESC, log_id DESC
                LIMIT 50
            ";
        }

        $stmt = $this->conn->prepare($sql);
        $stmt->execute([
            ':tbl' => $tableName,
            ':rid' => $recordId,
            ':needle' => $likeToken,
        ]);

        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        return array_map(function (array $row): array {
            return [
                'log_id' => (int) ($row['log_id'] ?? 0),
                'username' => $row['username'] ?? null,
                'action' => $row['action'] ?? null,
                'table_name' => $row['table_name'] ?? null,
                'record_id' => $row['record_id'] ?? null,
                'old_values' => $this->decodeJsonField($row['old_values'] ?? null),
                'new_values' => $this->decodeJsonField($row['new_values'] ?? null),
                'created_at' => $row['created_at'] ?? null,
            ];
        }, $rows);
    }

    private function decodeJsonField(mixed $value): mixed
    {
        if ($value === null || $value === '') {
            return null;
        }

        if (is_array($value)) {
            return $value;
        }

        $decoded = json_decode((string) $value, true);
        return json_last_error() === JSON_ERROR_NONE ? $decoded : $value;
    }

    private function getScopedMinistryReport(array $filters): array
    {
        return $this->model->getMinistryShareReport(
            $filters,
            $this->isAdmin() ? null : $this->userId
        );
    }

    private function logFinanceAction(string $action, ?string $recordId = null, ?array $newValues = null, ?array $oldValues = null): void
    {
        $normalizedAction = match (strtoupper($action)) {
            'EXPORT' => 'EXPORT',
            'PRINT', 'REPORT' => 'VIEW',
            default => 'OTHER',
        };

        $payload = $newValues ?? [];
        if (!isset($payload['requested_action'])) {
            $payload['requested_action'] = strtoupper($action);
        }

        $this->audit->log(
            $this->userId,
            $this->username,
            $normalizedAction,
            'finance',
            $recordId,
            $oldValues,
            $payload
        );
    }
}
