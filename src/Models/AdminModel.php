<?php
declare(strict_types=1);

class AdminModel
{
    private PDO $conn;
    private string $driver;
    private ?array $schemaCache = null;
    private ?SchemaCache $persistentCache = null;
    private ?bool $settingsGroupColumnExists = null;
    private ShiftService $shiftService;

    private array $tableLabels = [
        'users' => 'المستخدمون',
        'roles' => 'الأدوار والصلاحيات',
        'patients' => 'المرضى',
        'visits' => 'الزيارات',
        'invoices' => 'الفواتير',
        'invoice_details' => 'تفاصيل الفواتير',
        'document_types' => 'أنواع المستندات',
        'services_master' => 'الخدمات',
        'service_categories' => 'تصنيفات الخدمات',
        'departments' => 'الأقسام',
        'emergency_case_types' => 'أنواع الحالات',
        'medical_results' => 'النتائج الطبية',
        'notifications' => 'الإشعارات',
        'examination_tickets' => 'تذاكر المعاينة',
        'system_settings' => 'إعدادات النظام',
    ];

    private array $columnLabels = [
        'user_id' => 'المعرف',
        'username' => 'اسم المستخدم',
        'password_hash' => 'كلمة المرور',
        'full_name' => 'الاسم الكامل',
        'role_id' => 'الدور',
        'role_name' => 'اسم الدور',
        'script_url' => 'ملف الواجهة',
        'patient_id' => 'المريض',
        'gender' => 'النوع',
        'birth_date' => 'تاريخ الميلاد',
        'place1' => 'العنوان 1',
        'place2' => 'العنوان 2',
        'doctor_id' => 'الطبيب',
        'case_type_id' => 'نوع الحالة',
        'visit_id' => 'الزيارة',
        'visit_date' => 'تاريخ الزيارة',
        'type_case' => 'تصنيف الحالة',
        'notes' => 'الملاحظات',
        'diagnosis' => 'التشخيص',
        'status' => 'الحالة',
        'invoice_id' => 'الفاتورة',
        'serial_number' => 'الرقم التسلسلي',
        'doc_type_id' => 'نوع السند',
        'doc_name' => 'رمز السند',
        'total' => 'الإجمالي',
        'exemption_value' => 'الإعفاء',
        'net_amount' => 'الصافي',
        'accountant_id' => 'المحاسب',
        'created_at' => 'تاريخ الإنشاء',
        'paid_at' => 'وقت السداد',
        'detail_id' => 'المعرف',
        'service_id' => 'الخدمة',
        'service_price_at_time' => 'السعر وقت الطلب',
        'service_name' => 'اسم الخدمة',
        'category_id' => 'التصنيف',
        'category_name' => 'اسم التصنيف',
        'department' => 'القسم',
        'department_id' => 'القسم',
        'department_name' => 'اسم القسم',
        'department_code' => 'رمز القسم',
        'sort_order' => 'ترتيب العرض',
        'center_share' => 'المشاركة',
        'ministry_share' => 'المشتركة',
        'case_name' => 'اسم الحالة',
        'result_id' => 'المعرف',
        'result_text' => 'النتيجة',
        'notification_id' => 'المعرف',
        'target_role' => 'الدور المستهدف',
        'title' => 'العنوان',
        'body' => 'المحتوى',
        'event_type' => 'نوع الحدث',
        'reference_id' => 'المرجع',
        'is_read' => 'مقروء',
        'ticket_id' => 'المعرف',
        'ticket_type' => 'نوع التذكرة',
        'amount' => 'المبلغ',
        'current_serial' => 'آخر تسلسل',
        'setting_key' => 'مفتاح الإعداد',
        'setting_value' => 'القيمة',
        'setting_group' => 'تصنيف الإعداد',
        'description' => 'الوصف',
        'updated_by' => 'آخر تعديل بواسطة',
    ];

    public function __construct(PDO $db, string $driver = 'pgsql')
    {
        $this->conn = $db;
        $this->driver = $driver;
        $this->shiftService = new ShiftService($db);
        // Phase 1: كاش schema بين الطلبات (ملف بـ TTL)
        if (class_exists('SchemaCache')) {
            $this->persistentCache = new SchemaCache();
        }
    }

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

    public function getSchema(): array
    {
        // كاش داخل الطلب (موجود مسبقاً)
        if ($this->schemaCache !== null) {
            return $this->schemaCache;
        }

        // Phase 1: كاش بين الطلبات على القرص (TTL=5min افتراضي)
        if ($this->persistentCache !== null) {
            $cached = $this->persistentCache->get();
            if ($cached !== null && !empty($cached)) {
                $this->schemaCache = $cached;
                return $cached;
            }
        }

        $tables = $this->conn->query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name ASC")->fetchAll(PDO::FETCH_COLUMN) ?: [];
        $schema = [];
        foreach ($tables as $table) {
            $schema[] = $this->getTableMeta((string) $table);
        }

        $this->schemaCache = $schema;

        // حفظ في الكاش الدائم
        if ($this->persistentCache !== null) {
            $this->persistentCache->set($schema);
        }

        return $schema;
    }

    /**
     * Phase 1: إبطال الكاش — يُستدعى عند أي migration أو تغيير في schema.
     */
    public function invalidateSchemaCache(): void
    {
        $this->schemaCache = null;
        if ($this->persistentCache !== null) {
            $this->persistentCache->invalidate();
        }
    }

    public function getDashboardStats(): array
    {
        // Phase 1: دمج كل العدادات في استعلام واحد بدل 15 round-trip
        // كل عدّاد يُحسب عبر FILTER (CASE WHEN ...) داخل نفس scan
        $statsSql = "
            SELECT
                (SELECT COUNT(*) FROM Users) AS users_count,
                (SELECT COUNT(*) FROM Users WHERE role_id IS NOT NULL AND COALESCE(is_active, TRUE) = TRUE) AS active_users_count,
                (SELECT COUNT(*) FROM Patients) AS patients_count,
                (SELECT COUNT(*) FROM Patients WHERE created_at >= CURRENT_DATE AND created_at < CURRENT_DATE + INTERVAL '1 day') AS patients_today,
                (SELECT COUNT(*) FILTER (WHERE status = 'Active') FROM Visits) AS active_visits_count,
                (SELECT COUNT(*) FILTER (WHERE status = 'Completed') FROM Visits) AS completed_visits_count,
                (SELECT COUNT(*) FROM Visits WHERE visit_date >= CURRENT_DATE AND visit_date < CURRENT_DATE + INTERVAL '1 day') AS visits_today,
                (SELECT COUNT(*) FROM Invoices i WHERE accountant_id IS NULL AND {$this->activeInvoiceCondition('i')}) AS pending_invoices_count,
                (SELECT COUNT(*) FROM Invoices i WHERE accountant_id IS NOT NULL AND {$this->activeInvoiceCondition('i')} AND COALESCE(paid_at, created_at) >= CURRENT_DATE AND COALESCE(paid_at, created_at) < CURRENT_DATE + INTERVAL '1 day') AS paid_invoices_today,
                (SELECT COUNT(*) FROM Invoices WHERE cancelled_at IS NOT NULL) AS cancelled_invoices_count,
                (SELECT COALESCE(SUM(net_amount), 0) FROM Invoices i WHERE accountant_id IS NOT NULL AND {$this->activeInvoiceCondition('i')} AND COALESCE(paid_at, created_at) >= CURRENT_DATE AND COALESCE(paid_at, created_at) < CURRENT_DATE + INTERVAL '1 day') AS revenue_today,
                (SELECT COALESCE(SUM(net_amount), 0) FROM Invoices i WHERE accountant_id IS NOT NULL AND {$this->activeInvoiceCondition('i')} AND COALESCE(paid_at, created_at) >= DATE_TRUNC('month', CURRENT_DATE) AND COALESCE(paid_at, created_at) < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month') AS revenue_month,
                (SELECT COUNT(*) FROM Examination_Tickets WHERE created_at >= CURRENT_DATE AND created_at < CURRENT_DATE + INTERVAL '1 day') AS tickets_today,
                (SELECT COUNT(*) FROM Notifications WHERE created_at >= CURRENT_DATE AND created_at < CURRENT_DATE + INTERVAL '1 day') AS notifications_today
        ";
        $row = $this->conn->query($statsSql)->fetch() ?: [];

        $schema = $this->getSchema();
        $stats = [
            'tables_count' => count($schema),
            'users_count' => (int) ($row['users_count'] ?? 0),
            'active_users_count' => (int) ($row['active_users_count'] ?? 0),
            'patients_count' => (int) ($row['patients_count'] ?? 0),
            'patients_today' => (int) ($row['patients_today'] ?? 0),
            'active_visits_count' => (int) ($row['active_visits_count'] ?? 0),
            'completed_visits_count' => (int) ($row['completed_visits_count'] ?? 0),
            'visits_today' => (int) ($row['visits_today'] ?? 0),
            'pending_invoices_count' => (int) ($row['pending_invoices_count'] ?? 0),
            'paid_invoices_today' => (int) ($row['paid_invoices_today'] ?? 0),
            'cancelled_invoices_count' => (int) ($row['cancelled_invoices_count'] ?? 0),
            'revenue_today' => (float) ($row['revenue_today'] ?? 0),
            'revenue_month' => (float) ($row['revenue_month'] ?? 0),
            'tickets_today' => (int) ($row['tickets_today'] ?? 0),
            'notifications_today' => (int) ($row['notifications_today'] ?? 0),
        ];

        // Phase 1: تجميع عدّ كل الجداول في استعلام UNION واحد بدل N استعلام
        $tableSummaries = $this->getTableCountsBulk($schema);
        usort($tableSummaries, fn(array $a, array $b) => $b['count'] <=> $a['count']);

        return [
            'stats' => $stats,
            'tables' => $tableSummaries,
        ];
    }

    /**
     * Phase 1: عدّ صفوف كل الجداول في استعلام واحد (UNION ALL) بدل N استعلام منفصل.
     * كل جدول يصبح SELECT صغير وكلها تُجمَّع في round-trip واحد.
     */
    private function getTableCountsBulk(array $schema): array
    {
        if (empty($schema)) {
            return [];
        }

        $unions = [];
        foreach ($schema as $meta) {
            $tableQuoted = $this->quoteIdentifier($meta['table']);
            // SQL literal للاسم — آمن لأن أسماء الجداول مصدرها information_schema (موثوق)
            $tableLiteral = "'" . str_replace("'", "''", $meta['table']) . "'";
            $unions[] = "SELECT {$tableLiteral} AS t, (SELECT COUNT(*) FROM {$tableQuoted}) AS c";
        }
        $sql = implode(' UNION ALL ', $unions);

        $counts = [];
        try {
            $stmt = $this->conn->query($sql);
            foreach ($stmt->fetchAll() as $row) {
                $counts[$row['t']] = (int) $row['c'];
            }
        } catch (Throwable $e) {
            // fallback آمن: نرجع 0 لكل الجداول بدل ما نوقف لوحة الإدارة
            foreach ($schema as $meta) {
                $counts[$meta['table']] = 0;
            }
        }

        $summaries = [];
        foreach ($schema as $meta) {
            $summaries[] = [
                'table' => $meta['table'],
                'label' => $meta['label'],
                'count' => $counts[$meta['table']] ?? 0,
                'primary_key' => $meta['primary_key'],
            ];
        }
        return $summaries;
    }

    public function getTableRows(string $table, int $page, int $perPage, string $search = '', array $filters = [], ?string $sortBy = null, string $sortDir = 'DESC'): array
    {
        $meta = $this->requireTableMeta($table);
        $columns = $meta['columns'];
        $perPage = max(1, min($perPage, 100));
        $page = max(1, $page);
        $sortBy = $sortBy && isset($columns[$sortBy]) ? $sortBy : $meta['primary_key'];
        $sortDir = strtoupper($sortDir) === 'ASC' ? 'ASC' : 'DESC';

        $where = [];
        $params = [];

        $search = trim($search);
        if ($search !== '') {
            $searchClauses = [];
            foreach ($columns as $column) {
                if ($column['name'] === 'password_hash') {
                    continue;
                }
                if (!$column['searchable']) {
                    continue;
                }
                $searchClauses[] = $this->searchableExpression($column['name']) . ' ILIKE :search';
            }
            if (!empty($searchClauses)) {
                $where[] = '(' . implode(' OR ', $searchClauses) . ')';
                $params[':search'] = '%' . $search . '%';
            }
        }

        foreach ($filters as $columnName => $filterValue) {
            if (!isset($columns[$columnName]) || $columnName === 'password_hash') {
                continue;
            }
            $column = $columns[$columnName];
            $safeColumn = $this->quoteIdentifier($columnName);
            $paramBase = ':f_' . preg_replace('/[^a-zA-Z0-9_]/', '_', $columnName);

            if (is_array($filterValue)) {
                $from = trim((string) ($filterValue['from'] ?? ''));
                $to = trim((string) ($filterValue['to'] ?? ''));
                if ($from !== '') {
                    $where[] = $safeColumn . ' >= ' . $paramBase . '_from';
                    $params[$paramBase . '_from'] = $from;
                }
                if ($to !== '') {
                    $where[] = $safeColumn . ' <= ' . $paramBase . '_to';
                    $params[$paramBase . '_to'] = $to;
                }
                continue;
            }

            $value = trim((string) $filterValue);
            if ($value === '') {
                continue;
            }

            if ($column['is_boolean']) {
                $where[] = $safeColumn . ' = ' . $paramBase;
                $params[$paramBase] = in_array(strtolower($value), ['1', 'true', 'yes', 'نعم'], true);
            } elseif ($column['is_numeric']) {
                $where[] = $safeColumn . ' = ' . $paramBase;
                $params[$paramBase] = $value;
            } elseif ($column['is_date_like']) {
                $where[] = 'CAST(' . $safeColumn . ' AS DATE) = ' . $paramBase;
                $params[$paramBase] = $value;
            } else {
                $where[] = $safeColumn . ' ILIKE ' . $paramBase;
                $params[$paramBase] = '%' . $value . '%';
            }
        }

        $fromSql = ' FROM ' . $this->quoteIdentifier($table);
        if (!empty($where)) {
            $fromSql .= ' WHERE ' . implode(' AND ', $where);
        }

        $countStmt = $this->conn->prepare('SELECT COUNT(*)' . $fromSql);
        $countStmt->execute($params);
        $total = (int) $countStmt->fetchColumn();

        $offset = ($page - 1) * $perPage;
        $sql = 'SELECT *' . $fromSql
            . ' ORDER BY ' . $this->quoteIdentifier($sortBy) . ' ' . $sortDir
            . ' LIMIT ' . $perPage . ' OFFSET ' . $offset;
        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll() ?: [];

        foreach ($rows as &$row) {
            foreach ($columns as $columnName => $column) {
                if ($columnName === 'password_hash' && array_key_exists($columnName, $row)) {
                    $row[$columnName] = '••••••';
                }
            }
        }

        return [
            'rows' => $rows,
            'meta' => [
                'page' => $page,
                'per_page' => $perPage,
                'total' => $total,
                'pages' => (int) ceil($total / $perPage),
                'table' => $table,
                'label' => $meta['label'],
                'primary_key' => $meta['primary_key'],
                'default_sort' => $sortBy,
            ],
        ];
    }

    /**
     * جلب سجل واحد بواسطة المفتاح الأساسي (INT بعد الترحيل 003).
     */
    public function getRecord(string $table, int|string $id): array
    {
        $meta = $this->requireTableMeta($table);
        $pk = $meta['primary_key'];
        $stmt = $this->conn->prepare('SELECT * FROM ' . $this->quoteIdentifier($table) . ' WHERE ' . $this->quoteIdentifier($pk) . ' = :id LIMIT 1');
        $stmt->execute([':id' => (string) $id]);
        $row = $stmt->fetch();
        if (!$row) {
            throw new InvalidArgumentException('السجل المطلوب غير موجود.');
        }
        if (array_key_exists('password_hash', $row)) {
            $row['password_hash'] = '';
        }
        return $row;
    }

    /**
     * حفظ سجل (INSERT/UPDATE) مع مفاتيح SERIAL
     * + إنشاء/تحديث تلقائي لـ created_at / updated_at
     */
    public function saveRecord(string $table, array $record, int|string|null $id = null): array
    {
        $meta = $this->requireTableMeta($table);
        $pk = $meta['primary_key'];
        $columns = $meta['columns'];
        $isCreate = $id === null;

        $prepared = [];
        foreach ($columns as $columnName => $column) {
            // تجاهل الأعمدة المدارة تلقائياً من قاعدة البيانات:
            // (أ) المفتاح الأساسي بتوليد تلقائي SERIAL (nextval)
            // (ب) أعمدة الطوابع الزمنية created_at / updated_at
            if ($columnName === $pk && $column['auto_increment']) {
                continue;
            }
            if (in_array($columnName, ['created_at', 'updated_at'], true)) {
                continue;
            }
            if (!empty($column['is_generated'])) {
                continue;
            }
            if (!array_key_exists($columnName, $record)) {
                continue;
            }

            $value = $record[$columnName];
            if ($table === 'users' && $columnName === 'password_hash') {
                $value = trim((string) $value);
                if ($value === '') {
                    // عند التعديل نترك القديمة، عند الإنشاء سيفشل NOT NULL ويعيد خطأ واضحاً
                    continue;
                }
                $prepared[$columnName] = password_hash($value, PASSWORD_BCRYPT);
                continue;
            }

            $prepared[$columnName] = $this->normalizeValue($column, $value);
        }

        if ($table === 'service_categories' && isset($prepared['department_id']) && isset($columns['department'])) {
            $prepared['department'] = $this->resolveLegacyDepartmentValue((int) $prepared['department_id']);
        }

        if ($isCreate) {
            foreach ($columns as $columnName => $column) {
                if ($columnName === $pk && $column['auto_increment']) {
                    continue;
                }
                if (in_array($columnName, ['created_at', 'updated_at'], true)) {
                    continue;
                }
                if (!$column['nullable'] && !$column['has_default'] && !array_key_exists($columnName, $prepared)) {
                    throw new InvalidArgumentException('الحقل ' . ($column['label'] ?? $columnName) . ' مطلوب.');
                }
            }

            if (empty($prepared)) {
                throw new InvalidArgumentException('لا توجد بيانات صالحة للحفظ.');
            }

            // بناء الأعمدة والعلامات، مع إضافة created_at / updated_at تلقائياً إن وجدت
            $insertColumns = array_keys($prepared);
            $columnExpressions = array_map(fn(string $columnName) => $this->quoteIdentifier($columnName), $insertColumns);
            $placeholders = array_map(fn(string $columnName) => ':' . $columnName, $insertColumns);

            foreach (['created_at', 'updated_at'] as $tsColumn) {
                if (isset($columns[$tsColumn])) {
                    $columnExpressions[] = $this->quoteIdentifier($tsColumn);
                    $placeholders[] = 'NOW()';
                }
            }

            $sql = 'INSERT INTO ' . $this->quoteIdentifier($table)
                . ' (' . implode(', ', $columnExpressions) . ')'
                . ' VALUES (' . implode(', ', $placeholders) . ') RETURNING ' . $this->quoteIdentifier($pk);
            $stmt = $this->conn->prepare($sql);
            $stmt->execute($this->prefixParams($prepared));
            $newId = $stmt->fetchColumn();
            if ($newId === false || $newId === null || $newId === '') {
                throw new RuntimeException('تعذر الحصول على معرّف السجل الجديد.');
            }
            return $this->getRecord($table, (string) $newId);
        }

        if (!$this->recordExists($table, $pk, $id)) {
            throw new InvalidArgumentException('السجل المطلوب تعديله غير موجود.');
        }

        // عند التحديث: حتّى لو لم رسالة حقول أخرى، على الأقل نحدّث updated_at
        $setClauses = [];
        foreach (array_keys($prepared) as $columnName) {
            $setClauses[] = $this->quoteIdentifier($columnName) . ' = :' . $columnName;
        }
        if (isset($columns['updated_at'])) {
            $setClauses[] = $this->quoteIdentifier('updated_at') . ' = NOW()';
        }

        if (empty($setClauses)) {
            return $this->getRecord($table, (string) $id);
        }

        $sql = 'UPDATE ' . $this->quoteIdentifier($table)
            . ' SET ' . implode(', ', $setClauses)
            . ' WHERE ' . $this->quoteIdentifier($pk) . ' = :_id';
        $params = $this->prefixParams($prepared);
        $params[':_id'] = (string) $id;
        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);
        return $this->getRecord($table, (string) $id);
    }

    public function deleteRecord(string $table, int|string $id, ?int $userId = null): void
    {
        $meta = $this->requireTableMeta($table);
        $pk = $meta['primary_key'];
        if (!$this->recordExists($table, $pk, $id)) {
            throw new InvalidArgumentException('السجل المطلوب حذفه غير موجود.');
        }

        // 🔁 معالجة خاصة لحذف السندات (الفواتير) — حذف منطقي (Soft Delete):
        //   عند حذف فاتورة يتم:
        //     (0) تحويلها إلى حالة "محذوفة" (is_deleted=TRUE, serial_number=NULL).
        //     (1) إنقاص رقم التسلسل بمقدار 1 لكل الفواتير اللاحقة من نفس "مجموعة التسلسل"
        //         (A بمفرده، B و C يتشاركان تسلسلاً واحداً يُخزَّن تحت سجل doc_name='B').
        //     (2) إنقاص العداد current_serial في document_types بمقدار 1 لسجل التسلسل المعني.
        //   الفائدة: تجنب أخطاء FK (تعذر حذف السجل لوجود بيانات مرتبطة به).
        if (strtolower($table) === 'invoices') {
            $this->deleteInvoiceWithSerialAdjustment((int) $id, $userId);
            return;
        }

        $stmt = $this->conn->prepare('DELETE FROM ' . $this->quoteIdentifier($table) . ' WHERE ' . $this->quoteIdentifier($pk) . ' = :id');
        $stmt->execute([':id' => (string) $id]);
    }

    /**
     * 🆕 حذف فاتورة (سند) مع تطبيق الإجراءات التلقائية:
     *   • إنقاص serial_number لكل الفواتير اللاحقة من نفس مجموعة التسلسل (-1).
     *   • إنقاص current_serial في جدول document_types (-1).
     *
     * مجموعات التسلسل المستخدمة في النظام:
     *   - A (كاش): يستخدم عداد doc_name='A' ويشمل سجلات doc_type=A فقط.
     *   - B/C (إعفاء): يتشاركان عداد doc_name='B' ويشملان سجلات doc_type IN (B, C).
     *   - T (تذاكر معاينة): مستقل (لا يمر عبر deleteRecord لأنه على جدول examination_tickets).
     *   - L (مستندات مختبر): مستقل أيضاً.
     *
     * يُنفَّذ ضمن معاملة + FOR UPDATE على سجل document_types لمنع التسابق.
     * يستخدم تأجيل قيد UNIQUE (DEFERRABLE) عبر تنفيذ التحديثات بترتيب تنازلي
     * للحفاظ على فرادة (doc_type_id, serial_number) أثناء عملية إعادة الترقيم.
     *
     * المنطق:
     *   - حذف الفاتورة أولاً (يحرّر الرقم التسلسلي للفاتورة).
     *   - إعادة ترقيم الفواتير اللاحقة من الأصغر إلى الأكبر يميناً (kept+1 -> kept).
     *   - تحديث العداد في document_types.
     */
    public function deleteInvoiceWithSerialAdjustment(int $invoiceId, ?int $userId = null): void
    {
        if ($this->conn->inTransaction()) {
            // المعاملة الحالية تكفي
            $this->performInvoiceDeleteWithAdjustment($invoiceId, $userId);
            return;
        }

        $this->conn->beginTransaction();
        try {
            $this->performInvoiceDeleteWithAdjustment($invoiceId, $userId);
            $this->conn->commit();
        } catch (Throwable $e) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            throw $e;
        }
    }

    private function performInvoiceDeleteWithAdjustment(int $invoiceId, ?int $userId = null): void
    {
        // 1) جلب بيانات الفاتورة قبل الحذف المنطقي
        $infoStmt = $this->conn->prepare(
            'SELECT i.invoice_id, i.serial_number, i.doc_type_id, i.related_invoice_id, i.is_deleted, dt.doc_name
             FROM invoices i
             LEFT JOIN document_types dt ON dt.doc_type_id = i.doc_type_id
             WHERE i.invoice_id = :id
             FOR UPDATE'
        );
        $infoStmt->execute([':id' => (string) $invoiceId]);
        $invoice = $infoStmt->fetch(PDO::FETCH_ASSOC);

        if (!$invoice) {
            throw new InvalidArgumentException('الفاتورة المطلوب حذفها غير موجودة.');
        }

        // حماية: لا نعيد حذف فاتورة محذوفة أصلاً
        if (!empty($invoice['is_deleted'])) {
            throw new InvalidArgumentException('هذه الفاتورة محذوفة مسبقاً.');
        }

        $serialNumber = $invoice['serial_number'] !== null ? (int) $invoice['serial_number'] : null;
        $docTypeId    = $invoice['doc_type_id']  !== null ? (int) $invoice['doc_type_id']  : null;
        $docName      = $invoice['doc_name'] !== null ? (string) $invoice['doc_name'] : '';

        // 2) جلب بيانات السند المرتبط (B↔A في حالة الإعفاء الجزئي) — لإجراء حذف منطقي له أيضاً
        $relatedInvoiceId = $invoice['related_invoice_id'] !== null ? (int) $invoice['related_invoice_id'] : null;
        $relatedInfo = null;
        if ($relatedInvoiceId !== null) {
            $relStmt = $this->conn->prepare(
                'SELECT i.invoice_id, i.serial_number, i.doc_type_id, i.is_deleted, dt.doc_name
                 FROM invoices i
                 LEFT JOIN document_types dt ON dt.doc_type_id = i.doc_type_id
                 WHERE i.invoice_id = :id
                 FOR UPDATE'
            );
            $relStmt->execute([':id' => (string) $relatedInvoiceId]);
            $rel = $relStmt->fetch(PDO::FETCH_ASSOC);
            if ($rel && empty($rel['is_deleted'])) {
                $relatedInfo = [
                    'invoice_id'   => (int) $rel['invoice_id'],
                    'serial_number'=> $rel['serial_number'] !== null ? (int) $rel['serial_number'] : null,
                    'doc_type_id'  => $rel['doc_type_id']  !== null ? (int) $rel['doc_type_id']  : null,
                    'doc_name'     => (string) ($rel['doc_name'] ?? ''),
                ];
            }
        }

        // 3) حذف منطقي (Soft Delete) للفاتورة:
        //    - is_deleted = TRUE
        //    - serial_number = NULL (تحرير الرقم وتجنب تعارض الفهرس الجزئي UNIQUE)
        //    - deleted_at = NOW(), deleted_by = userId
        //    - shift_closure_id = NULL (فصلها عن أي إقفال سابق إن وُجد)
        //    ملاحظة: invoice_details تبقى مرتبطة (للسجل التاريخي والمراجعة)
        $delStmt = $this->conn->prepare(
            'UPDATE invoices
                SET is_deleted    = TRUE,
                    serial_number = NULL,
                    deleted_at    = NOW(),
                    deleted_by    = :uid,
                    shift_closure_id = NULL,
                    updated_at    = NOW()
              WHERE invoice_id = :id'
        );
        $delStmt->execute([
            ':uid' => $userId !== null ? (string) $userId : null,
            ':id'  => (string) $invoiceId,
        ]);

        // 4) حذف منطقي للسند المرتبط (إن وُجد) — لأن CASCADE لم يعد ينطبق على UPDATE
        if ($relatedInfo !== null) {
            $delRelStmt = $this->conn->prepare(
                'UPDATE invoices
                    SET is_deleted    = TRUE,
                        serial_number = NULL,
                        deleted_at    = NOW(),
                        deleted_by    = :uid,
                        shift_closure_id = NULL,
                        updated_at    = NOW()
                  WHERE invoice_id = :id AND is_deleted = FALSE'
            );
            $delRelStmt->execute([
                ':uid' => $userId !== null ? (string) $userId : null,
                ':id'  => (string) $relatedInfo['invoice_id'],
            ]);
        }

        // 5) تطبيق إعادة الترقيم للسند المحذوف (إن كان يحمل رقماً تسلسلياً)
        if ($docTypeId !== null && $serialNumber !== null && $serialNumber > 0 && $docName !== '') {
            $this->adjustSerialsAfterDeletion($docName, $serialNumber);
        }

        // 6) تطبيق إعادة الترقيم للسند المرتبط (إن وُجد)
        if ($relatedInfo !== null
            && $relatedInfo['doc_type_id'] !== null
            && $relatedInfo['serial_number'] !== null
            && $relatedInfo['doc_name'] !== '') {
            $this->adjustSerialsAfterDeletion($relatedInfo['doc_name'], $relatedInfo['serial_number']);
        }
    }

    /**
     * يطبّق إعادة الترقيم بعد حذف سند برقم تسلسلي محدد:
     *   - يخفّض رقم كل سند لاحق ضمن نفس مجموعة التسلسل بمقدار 1.
     *   - يخفّض عداد document_types.current_serial بمقدار 1.
     *
     * @param string $docName اسم نوع السند المحذوف (A | B | C | T | L ...)
     * @param int    $deletedSerial الرقم التسلسلي للسند الذي تم حذفه
     */
    private function adjustSerialsAfterDeletion(string $docName, int $deletedSerial): void
    {
        // تحديد مجموعة التسلسل + سجل العداد في document_types
        // A: مجموعة [A]، العداد على سجل A
        // B/C: مجموعة [B, C]، العداد على سجل B (مشترك)
        // T/L وغيرها: مجموعة [نفسها]، العداد على سجلها
        $serialDocName = ($docName === 'C') ? 'B' : $docName;

        // جلب معرفات أنواع المستندات في نفس المجموعة + قفل سجل العداد
        $counterStmt = $this->conn->prepare(
            "SELECT doc_type_id, current_serial FROM document_types
             WHERE doc_name = :doc_name FOR UPDATE"
        );
        $counterStmt->execute([':doc_name' => $serialDocName]);
        $counterRow = $counterStmt->fetch(PDO::FETCH_ASSOC);
        if (!$counterRow) {
            // لا يوجد سجل عداد — لا شيء لنفعله
            return;
        }
        $counterDocTypeId = (int) $counterRow['doc_type_id'];
        $currentSerial    = (int) $counterRow['current_serial'];

        // جلب جميع doc_type_id في نفس المجموعة
        if ($serialDocName === 'B') {
            $groupStmt = $this->conn->prepare(
                "SELECT doc_type_id FROM document_types WHERE doc_name IN ('B','C')"
            );
            $groupStmt->execute();
        } else {
            $groupStmt = $this->conn->prepare(
                "SELECT doc_type_id FROM document_types WHERE doc_name = :doc_name"
            );
            $groupStmt->execute([':doc_name' => $serialDocName]);
        }
        $groupTypeIds = array_map(static fn($r) => (int) $r['doc_type_id'], $groupStmt->fetchAll(PDO::FETCH_ASSOC));
        if (empty($groupTypeIds)) {
            return;
        }

        $placeholders = implode(',', array_fill(0, count($groupTypeIds), '?'));

        // إعادة ترقيم الفواتير اللاحقة: من الأصغر إلى الأكبر، كل واحدة تأخذ (serial_number - 1)
        // ترتيب تصاعدي يضمن عدم خرق قيد UNIQUE(doc_type_id, serial_number) أثناء التحديث.
        $selStmt = $this->conn->prepare(
            "SELECT invoice_id, serial_number FROM invoices
             WHERE doc_type_id IN ($placeholders) AND serial_number > ?
             ORDER BY serial_number ASC"
        );
        $selStmt->execute(array_merge($groupTypeIds, [$deletedSerial]));
        $rowsToShift = $selStmt->fetchAll(PDO::FETCH_ASSOC);

        if (!empty($rowsToShift)) {
            $updateStmt = $this->conn->prepare(
                'UPDATE invoices SET serial_number = :new_serial WHERE invoice_id = :id'
            );
            foreach ($rowsToShift as $row) {
                $oldSerial = (int) $row['serial_number'];
                $newSerial = $oldSerial - 1;
                if ($newSerial <= 0) {
                    // حماية: لا نسمح بقيم غير صالحة
                    continue;
                }
                $updateStmt->execute([
                    ':new_serial' => $newSerial,
                    ':id'         => (string) $row['invoice_id'],
                ]);
            }
        }

        // إنقاص العداد بمقدار 1 (مع حماية ضد الذهاب تحت الصفر)
        if ($currentSerial > 0) {
            $decStmt = $this->conn->prepare(
                'UPDATE document_types SET current_serial = current_serial - 1, updated_at = NOW()
                 WHERE doc_type_id = :id AND current_serial > 0'
            );
            $decStmt->execute([':id' => (string) $counterDocTypeId]);
        }
    }

    /**
     * 🆕 إعادة فتح الفترة المالية الأخيرة
     *
     * القواعد:
     *   • يُسمح بإعادة فتح "الإقفال الأخير" فقط (آخر سجل في shifts_closures).
     *   • عند إعادة الفتح:
     *      - يُحذف السند الإجمالي (A) المرتبط بهذا الإقفال،
     *        مع تطبيق إجراءات حذف السندات (تحديث التسلسل + العداد).
     *      - تُفصل التذاكر عن الإقفال (shift_closure_id = NULL) لتعود قابلة للإقفال مجدداً.
     *      - يُحذف سجل الإقفال من shifts_closures.
     *
     * @return array بيانات وصفية عن الفترة التي أُعيد فتحها
     */
    public function reopenLatestShift(int $closureId, int $userId): array
    {
        $this->conn->beginTransaction();
        try {
            // 1) قفل وجلب بيانات الإقفال المطلوب
            $stmt = $this->conn->prepare(
                "SELECT id, shift_type, shift_date, closing_invoice_id, closed_at, status
                 FROM shifts_closures WHERE id = :id FOR UPDATE"
            );
            $stmt->execute([':id' => (string) $closureId]);
            $closure = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$closure) {
                throw new InvalidArgumentException('الفترة المطلوب إعادة فتحها غير موجودة.');
            }

            // 2) التأكد من أنه الإقفال الأخير (لا يوجد إقفال أحدث منه)
            $latestStmt = $this->conn->prepare(
                "SELECT id, shift_type, shift_date, closed_at FROM shifts_closures
                 ORDER BY closed_at DESC, id DESC LIMIT 1"
            );
            $latestStmt->execute();
            $latest = $latestStmt->fetch(PDO::FETCH_ASSOC);
            if (!$latest || (int) $latest['id'] !== (int) $closure['id']) {
                throw new InvalidArgumentException(
                    'لا يمكن إعادة فتح هذه الفترة لأنها ليست الفترة الأخيرة. يُسمح بإعادة فتح آخر فترة مُقفلة فقط.'
                );
            }

            try {
                $shiftRowStmt = $this->conn->prepare(
                    "SELECT shift_id FROM shifts
                     WHERE shift_type = :st AND shift_date = :sd LIMIT 1"
                );
                $shiftRowStmt->execute([
                    ':st' => (string) $closure['shift_type'],
                    ':sd' => (string) $closure['shift_date'],
                ]);
                $shiftRow = $shiftRowStmt->fetch(PDO::FETCH_ASSOC);
                if ($shiftRow) {
                    $shiftService = new ShiftService($this->conn);
                    $nextStart = $shiftService->getNextShiftStartTime((int) $shiftRow['shift_id']);
                    if ($nextStart !== null && new DateTimeImmutable() >= $nextStart) {
                        throw new InvalidArgumentException(
                            'لا يمكن إعادة فتح هذه الفترة لأن الفترة التالية قد بدأت بالفعل.'
                        );
                    }
                }
            } catch (InvalidArgumentException $e) {
                throw $e;
            } catch (Throwable $e) {
                error_log('reopenLatestShift time check failed: ' . $e->getMessage());
            }

            $closingInvoiceId = $closure['closing_invoice_id'] !== null ? (int) $closure['closing_invoice_id'] : null;

            // 3) فك ارتباط التذاكر بهذا الإقفال (تعود قابلة للإقفال مجدداً)
            $unbindStmt = $this->conn->prepare(
                'UPDATE examination_tickets SET shift_closure_id = NULL
                 WHERE shift_closure_id = :cid'
            );
            $unbindStmt->execute([':cid' => (string) $closureId]);
            $ticketsUnbound = $unbindStmt->rowCount();

            // 4) حذف سجل الإقفال أولاً لتفادي تعارض FK closing_invoice_id
            //    (FK في invoices.shift_closure_id لها ON DELETE SET NULL)
            $delClosure = $this->conn->prepare('DELETE FROM shifts_closures WHERE id = :id');
            $delClosure->execute([':id' => (string) $closureId]);

            // 5) حذف سند التحصيل الإجمالي (A) المرتبط بهذه الفترة
            //    مع تطبيق إجراءات حذف السندات (تحديث التسلسل + عداد document_types).
            $deletedInvoice = null;
            if ($closingInvoiceId !== null) {
                // التحقق من وجود الفاتورة (قد تكون محذوفة سابقاً)
                $existsStmt = $this->conn->prepare('SELECT serial_number FROM invoices WHERE invoice_id = :id');
                $existsStmt->execute([':id' => (string) $closingInvoiceId]);
                $row = $existsStmt->fetch(PDO::FETCH_ASSOC);
                if ($row) {
                    $deletedInvoice = [
                        'invoice_id'    => $closingInvoiceId,
                        'serial_number' => (int) $row['serial_number'],
                    ];
                    // داخل نفس المعاملة
                    $this->performInvoiceDeleteWithAdjustment($closingInvoiceId);
                }
            }

            try {
                $openShiftStmt = $this->conn->prepare(
                    "UPDATE shifts
                        SET status      = 'open',
                            closed_at   = NULL,
                            closed_by   = NULL,
                            auto_closed = FALSE,
                            closure_id  = NULL,
                            updated_at  = CURRENT_TIMESTAMP
                      WHERE shift_type = :st AND shift_date = :sd"
                );
                $openShiftStmt->execute([
                    ':st' => (string) $closure['shift_type'],
                    ':sd' => (string) $closure['shift_date'],
                ]);
            } catch (Throwable $e) {
                error_log('reopenLatestShift: failed to update shifts.status: ' . $e->getMessage());
            }

            $this->conn->commit();

            return [
                'closure_id'        => (int) $closure['id'],
                'shift_type'        => (string) $closure['shift_type'],
                'shift_date'        => (string) $closure['shift_date'],
                'tickets_unbound'   => (int) $ticketsUnbound,
                'deleted_invoice'   => $deletedInvoice,
                'reopened_by'       => $userId,
            ];
        } catch (Throwable $e) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            throw $e;
        }
    }

    private function getTableMeta(string $table): array
    {
        $pkQuery = "SELECT kcu.column_name
                    FROM information_schema.table_constraints tc
                    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
                    WHERE tc.table_schema='public' AND tc.table_name = :table AND tc.constraint_type = 'PRIMARY KEY'
                    ORDER BY kcu.ordinal_position LIMIT 1";
        $pkStmt = $this->conn->prepare($pkQuery);
        $pkStmt->execute([':table' => $table]);
        $primaryKey = (string) ($pkStmt->fetchColumn() ?: 'id');

        $fkQuery = "SELECT kcu.column_name, ccu.table_name AS ref_table, ccu.column_name AS ref_column
                    FROM information_schema.table_constraints tc
                    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
                    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
                    WHERE tc.table_schema='public' AND tc.table_name = :table AND tc.constraint_type = 'FOREIGN KEY'";
        $fkStmt = $this->conn->prepare($fkQuery);
        $fkStmt->execute([':table' => $table]);
        $foreignKeys = [];
        foreach ($fkStmt->fetchAll() ?: [] as $fk) {
            $foreignKeys[$fk['column_name']] = [
                'table' => $fk['ref_table'],
                'column' => $fk['ref_column'],
            ];
        }

        $columnStmt = $this->conn->prepare("SELECT column_name, data_type, is_nullable, column_default, udt_name, is_identity, is_generated
                                           FROM information_schema.columns
                                           WHERE table_schema='public' AND table_name=:table
                                           ORDER BY ordinal_position ASC");
        $columnStmt->execute([':table' => $table]);
        $columnRows = $columnStmt->fetchAll() ?: [];
        $columns = [];
        foreach ($columnRows as $row) {
            $name = (string) $row['column_name'];
            $dataType = (string) $row['data_type'];
            $udtName = (string) ($row['udt_name'] ?? '');
            $isBoolean = $dataType === 'boolean';
            $isNumeric = in_array($dataType, ['smallint', 'integer', 'bigint', 'numeric', 'decimal', 'real', 'double precision'], true);
            $isDateLike = in_array($dataType, ['date', 'timestamp without time zone', 'timestamp with time zone', 'time without time zone', 'time with time zone'], true);
            $enumValues = $dataType === 'USER-DEFINED'
                ? $this->getEnumValues($udtName)
                : $this->getCheckConstraintEnumValues($table, $name);
            $columns[$name] = [
                'name' => $name,
                'label' => $this->columnLabels[$name] ?? $this->humanize($name),
                'data_type' => $dataType,
                'udt_name' => $udtName,
                'nullable' => $row['is_nullable'] === 'YES',
                'default' => $row['column_default'],
                'has_default' => $row['column_default'] !== null,
                // يعرف العمود على أنه "تلقائي" إذا كان يستخدم:
                //   - SERIAL/BIGSERIAL  (nextval)
                //   - UUID تلقائي    (gen_random_uuid / uuid_generate_v4)
                //   - IDENTITY columns (column_default + identity_generation)
                // يعرف العمود على أنه SERIAL / IDENTITY / AUTO_INCREMENT
                'auto_increment' => $this->isAutoGeneratedDefault((string) ($row['column_default'] ?? ''))
                    || (isset($row['is_identity']) && $row['is_identity'] === 'YES'),
                'is_generated' => isset($row['is_generated']) && $row['is_generated'] !== 'NEVER',
                'is_primary' => $name === $primaryKey,
                'is_foreign' => isset($foreignKeys[$name]),
                'foreign' => $foreignKeys[$name] ?? null,
                'foreign_options' => isset($foreignKeys[$name]) ? $this->getReferenceOptions($foreignKeys[$name]['table'], $foreignKeys[$name]['column']) : [],
                'is_boolean' => $isBoolean,
                'is_numeric' => $isNumeric,
                'is_date_like' => $isDateLike,
                'enum_values' => $enumValues,
                'control_hint' => !empty($enumValues) ? 'select' : null,
                'searchable' => !$this->isLegacyShadowColumn($table, $name)
                    && ($isBoolean || $isNumeric || $isDateLike || in_array($dataType, ['character varying', 'character', 'text', 'USER-DEFINED'], true)),
                'visible_in_list' => $name !== 'password_hash' && !$this->isLegacyShadowColumn($table, $name),
                'editable' => !$this->isSystemManagedColumn($name, $row['column_default'])
                    && !$this->isLegacyShadowColumn($table, $name)
                    && !(isset($row['is_generated']) && $row['is_generated'] !== 'NEVER'),
            ];
        }

        return [
            'table' => $table,
            'label' => $this->tableLabels[$table] ?? $this->humanize($table),
            'primary_key' => $primaryKey,
            'columns' => $columns,
        ];
    }

    private function getEnumValues(string $enumType): array
    {
        if ($enumType === '') {
            return [];
        }
        $stmt = $this->conn->prepare("SELECT e.enumlabel
                                     FROM pg_type t
                                     JOIN pg_enum e ON t.oid = e.enumtypid
                                     JOIN pg_namespace n ON n.oid = t.typnamespace
                                     WHERE n.nspname = 'public' AND t.typname = :enum_type
                                     ORDER BY e.enumsortorder ASC");
        $stmt->execute([':enum_type' => $enumType]);
        return $stmt->fetchAll(PDO::FETCH_COLUMN) ?: [];
    }

    private function getCheckConstraintEnumValues(string $table, string $column): array
    {
        $sql = "SELECT pg_get_constraintdef(c.oid) AS constraint_def
                FROM pg_constraint c
                JOIN pg_class t      ON t.oid = c.conrelid
                JOIN pg_namespace n  ON n.oid = t.relnamespace
                JOIN pg_attribute a  ON a.attrelid = t.oid AND a.attnum = ANY (c.conkey)
                WHERE c.contype = 'c'
                  AND n.nspname = 'public'
                  AND t.relname = :table
                  AND a.attname = :column";

        $stmt = $this->conn->prepare($sql);
        $stmt->execute([
            ':table' => $table,
            ':column' => $column,
        ]);

        $values = [];
        foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) ?: [] as $constraintDef) {
            $constraintText = (string) $constraintDef;
            if ($constraintText === '' || !str_contains($constraintText, "'")) {
                continue;
            }
            $literals = $this->extractQuotedLiterals($constraintText);
            if (count($literals) < 2) {
                continue;
            }
            foreach ($literals as $literal) {
                $values[$literal] = $literal;
            }
        }

        return array_values($values);
    }

    private function extractQuotedLiterals(string $text): array
    {
        if (!preg_match_all("/'((?:''|[^'])*)'/", $text, $matches)) {
            return [];
        }

        $values = [];
        foreach ($matches[1] as $match) {
            $value = str_replace("''", "'", (string) $match);
            if ($value === '' || preg_match('/^\\d+(?:\\.\\d+)?$/', $value)) {
                continue;
            }
            $values[] = $value;
        }

        return $values;
    }

    public function getReferenceOptionsForField(string $table, string $columnName): array
    {
        $meta = $this->requireTableMeta($table);
        $column = $meta['columns'][$columnName] ?? null;
        if (!$column || empty($column['foreign'])) {
            throw new InvalidArgumentException('الحقل المطلوب لا يدعم القيم المرجعية الحية.');
        }

        return $this->getReferenceOptions($column['foreign']['table'], $column['foreign']['column']);
    }

    public function getShiftDayDefinition(string $shiftDate): array
    {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $shiftDate)) {
            throw new InvalidArgumentException('صيغة التاريخ غير صالحة (المتوقع YYYY-MM-DD).');
        }

        $defaults = $this->shiftService->getDefaults();
        $rows = $this->shiftService->getShiftBoundariesForDate($shiftDate);

        if (empty($rows)) {
            $this->shiftService->ensureDayDefined($shiftDate);
            $rows = $this->shiftService->getShiftBoundariesForDate($shiftDate);
        }

        $config = $this->buildShiftEditorConfig($shiftDate, $rows, $defaults);

        return [
            'shift_date' => $shiftDate,
            'defaults' => $defaults,
            'rows' => $rows,
            'config' => $config,
            'has_closed_shift' => !empty(array_filter($rows, fn(array $row): bool => (string) ($row['status'] ?? '') === 'closed')),
        ];
    }

    public function saveShiftBoundaries(string $shiftDate, string $splitTime, string $dayMode, int $updatedBy): array
    {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $shiftDate)) {
            throw new InvalidArgumentException('صيغة التاريخ غير صالحة (المتوقع YYYY-MM-DD).');
        }

        $splitTime = $this->normalizeShiftTime($splitTime);
        if (!in_array($dayMode, ['both', 'morning_only', 'evening_only'], true)) {
            throw new InvalidArgumentException('وضع اليوم غير صالح.');
        }

        if ($this->shiftService->hasClosedShiftOnDate($shiftDate)) {
            throw new RuntimeException('لا يمكن تعديل حدود يوم تحوي فيه فترة مغلقة.');
        }

        $desiredRows = $this->buildShiftRowsForDate($shiftDate, $splitTime, $dayMode);
        $desiredTypes = array_column($desiredRows, 'shift_type');
        $activeShiftIds = [];

        $this->conn->beginTransaction();
        try {
            $currentStmt = $this->conn->prepare(
                "SELECT shift_id, shift_type, shift_date, start_time, end_time, day_mode, status
                 FROM shifts
                 WHERE shift_date = :sd
                 ORDER BY start_time ASC
                 FOR UPDATE"
            );
            $currentStmt->execute([':sd' => $shiftDate]);
            $currentRows = $currentStmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

            foreach ($currentRows as $row) {
                if ((string) ($row['status'] ?? '') === 'closed') {
                    throw new RuntimeException('لا يمكن تعديل حدود يوم تحوي فيه فترة مغلقة.');
                }
            }

            $existingByType = [];
            foreach ($currentRows as $row) {
                $existingByType[(string) $row['shift_type']] = $row;
            }

            $insertStmt = $this->conn->prepare(
                "INSERT INTO shifts (shift_date, shift_type, start_time, end_time, day_mode, status)
                 VALUES (:sd, :shift_type, :start_time, :end_time, :day_mode, 'open')
                 RETURNING shift_id"
            );
            $updateStmt = $this->conn->prepare(
                "UPDATE shifts
                    SET start_time = :start_time,
                        end_time = :end_time,
                        day_mode = :day_mode,
                        updated_at = CURRENT_TIMESTAMP
                  WHERE shift_id = :shift_id"
            );

            foreach ($desiredRows as $row) {
                $shiftType = $row['shift_type'];
                if (isset($existingByType[$shiftType])) {
                    $updateStmt->execute([
                        ':start_time' => $row['start_time'],
                        ':end_time' => $row['end_time'],
                        ':day_mode' => $row['day_mode'],
                        ':shift_id' => $existingByType[$shiftType]['shift_id'],
                    ]);
                    $activeShiftIds[$shiftType] = (int) $existingByType[$shiftType]['shift_id'];
                    continue;
                }

                $insertStmt->execute([
                    ':sd' => $shiftDate,
                    ':shift_type' => $shiftType,
                    ':start_time' => $row['start_time'],
                    ':end_time' => $row['end_time'],
                    ':day_mode' => $row['day_mode'],
                ]);
                $activeShiftIds[$shiftType] = (int) $insertStmt->fetchColumn();
            }

            $this->reassignVisitsForShiftDate($shiftDate, $splitTime, $dayMode, $activeShiftIds);

            $obsoleteRows = array_filter(
                $currentRows,
                fn(array $row): bool => !in_array((string) $row['shift_type'], $desiredTypes, true)
            );
            if (!empty($obsoleteRows)) {
                $deleteStmt = $this->conn->prepare('DELETE FROM shifts WHERE shift_id = :shift_id');
                foreach ($obsoleteRows as $row) {
                    $deleteStmt->execute([':shift_id' => $row['shift_id']]);
                }
            }

            $this->conn->commit();
        } catch (Throwable $exception) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            throw $exception;
        }

        $snapshot = $this->getShiftDayDefinition($shiftDate);

        return [
            'saved_by' => $updatedBy,
            'shift_date' => $shiftDate,
            'split_time' => $splitTime,
            'day_mode' => $dayMode,
            'rows' => $snapshot['rows'],
            'config' => $snapshot['config'],
        ];
    }

    private function buildShiftEditorConfig(string $shiftDate, array $rows, array $defaults): array
    {
        $dayMode = (string) ($defaults['day_mode'] ?? 'both');
        $splitTime = (string) ($defaults['split_time'] ?? '12:00');
        $status = 'open';

        if (!empty($rows)) {
            $firstRow = $rows[0];
            $dayMode = (string) ($firstRow['day_mode'] ?? $dayMode);
            $status = !empty(array_filter($rows, fn(array $row): bool => (string) ($row['status'] ?? '') === 'closed'))
                ? 'closed'
                : 'open';

            if ($dayMode === 'both') {
                foreach ($rows as $row) {
                    if ((string) ($row['shift_type'] ?? '') === 'morning') {
                        $splitTime = substr((string) ($row['end_time'] ?? $splitTime), 0, 5);
                        break;
                    }
                }
            }
        }

        return [
            'shift_date' => $shiftDate,
            'split_time' => $splitTime,
            'day_mode' => $dayMode,
            'status' => $status,
        ];
    }

    private function normalizeShiftTime(string $value): string
    {
        $trimmed = trim($value);
        if (!preg_match('/^(?:[01]?\d|2[0-3]):[0-5]\d$/', $trimmed)) {
            throw new InvalidArgumentException('صيغة الوقت غير صالحة (المتوقع HH:MM).');
        }
        return str_pad(substr($trimmed, 0, 2), 2, '0', STR_PAD_LEFT) . ':' . substr($trimmed, 3, 2);
    }

    private function buildShiftRowsForDate(string $shiftDate, string $splitTime, string $dayMode): array
    {
        $endOfDay = '23:59:59';
        $splitWithSeconds = $splitTime . ':00';

        return match ($dayMode) {
            'morning_only' => [[
                'shift_date' => $shiftDate,
                'shift_type' => 'morning',
                'start_time' => '00:00:00',
                'end_time' => $endOfDay,
                'day_mode' => 'morning_only',
            ]],
            'evening_only' => [[
                'shift_date' => $shiftDate,
                'shift_type' => 'evening',
                'start_time' => '00:00:00',
                'end_time' => $endOfDay,
                'day_mode' => 'evening_only',
            ]],
            default => [
                [
                    'shift_date' => $shiftDate,
                    'shift_type' => 'morning',
                    'start_time' => '00:00:00',
                    'end_time' => $splitWithSeconds,
                    'day_mode' => 'both',
                ],
                [
                    'shift_date' => $shiftDate,
                    'shift_type' => 'evening',
                    'start_time' => $splitWithSeconds,
                    'end_time' => $endOfDay,
                    'day_mode' => 'both',
                ],
            ],
        };
    }

    private function reassignVisitsForShiftDate(string $shiftDate, string $splitTime, string $dayMode, array $activeShiftIds): void
    {
        if ($dayMode === 'morning_only') {
            if (empty($activeShiftIds['morning'])) {
                return;
            }
            $stmt = $this->conn->prepare(
                'UPDATE visits SET shift_id = :shift_id WHERE CAST(visit_date AS DATE) = :shift_date'
            );
            $stmt->execute([
                ':shift_id' => $activeShiftIds['morning'],
                ':shift_date' => $shiftDate,
            ]);
            return;
        }

        if ($dayMode === 'evening_only') {
            if (empty($activeShiftIds['evening'])) {
                return;
            }
            $stmt = $this->conn->prepare(
                'UPDATE visits SET shift_id = :shift_id WHERE CAST(visit_date AS DATE) = :shift_date'
            );
            $stmt->execute([
                ':shift_id' => $activeShiftIds['evening'],
                ':shift_date' => $shiftDate,
            ]);
            return;
        }

        if (empty($activeShiftIds['morning']) || empty($activeShiftIds['evening'])) {
            return;
        }

        $stmt = $this->conn->prepare(
            "UPDATE visits
                SET shift_id = CASE
                    WHEN CAST(visit_date AS TIME) < :split_time THEN :morning_shift_id
                    ELSE :evening_shift_id
                END
              WHERE CAST(visit_date AS DATE) = :shift_date"
        );
        $stmt->execute([
            ':split_time' => $splitTime . ':00',
            ':morning_shift_id' => $activeShiftIds['morning'],
            ':evening_shift_id' => $activeShiftIds['evening'],
            ':shift_date' => $shiftDate,
        ]);
    }

    public function getSystemSettingsCatalog(): array
    {
        $rows = $this->getExistingSystemSettings();
        $definitions = $this->systemSettingDefinitions();
        $groupMeta = $this->systemSettingGroups();
        $settings = [];
        $groupCounts = [];
        $lastUpdatedAt = null;

        foreach ($rows as $row) {
            $key = (string) $row['setting_key'];
            $definition = $definitions[$key] ?? [];
            $groupKey = $this->inferSettingGroup($key, isset($row['setting_group']) ? (string) $row['setting_group'] : null);
            $group = $groupMeta[$groupKey] ?? $groupMeta['general'];
            $control = (string) ($definition['control'] ?? $this->inferSettingControl($key, (string) ($row['setting_value'] ?? '')));
            $value = (string) ($row['setting_value'] ?? '');
            $description = trim((string) ($row['description'] ?? ''));
            $updatedAt = isset($row['updated_at']) ? (string) $row['updated_at'] : null;

            if ($this->isHiddenSystemSetting($key, $description)) {
                continue;
            }

            $settings[] = [
                'key' => $key,
                'label' => (string) ($definition['label'] ?? $this->humanize($key)),
                'group' => $groupKey,
                'group_label' => (string) $group['label'],
                'value' => $value,
                'raw_value' => $value,
                'description' => $description !== '' ? $description : (string) ($definition['hint'] ?? ''),
                'hint' => (string) ($definition['hint'] ?? $description),
                'control' => $control,
                'unit' => (string) ($definition['unit'] ?? ''),
                'placeholder' => (string) ($definition['placeholder'] ?? ''),
                'min' => $definition['min'] ?? null,
                'max' => $definition['max'] ?? null,
                'step' => $definition['step'] ?? null,
                'allow_empty' => (bool) ($definition['allow_empty'] ?? true),
                'options' => array_values($definition['options'] ?? []),
                'updated_at' => $updatedAt,
                'updated_by' => $row['updated_by'] ?? null,
            ];

            $groupCounts[$groupKey] = ($groupCounts[$groupKey] ?? 0) + 1;
            if ($updatedAt !== null && ($lastUpdatedAt === null || strcmp($updatedAt, $lastUpdatedAt) > 0)) {
                $lastUpdatedAt = $updatedAt;
            }
        }

        usort($settings, function (array $a, array $b) use ($groupMeta): int {
            $aGroup = $groupMeta[$a['group']]['order'] ?? 999;
            $bGroup = $groupMeta[$b['group']]['order'] ?? 999;
            if ($aGroup === $bGroup) {
                return strcmp($a['label'], $b['label']);
            }
            return $aGroup <=> $bGroup;
        });

        $groups = [];
        foreach ($groupMeta as $key => $meta) {
            $groups[] = [
                'key' => $key,
                'label' => $meta['label'],
                'description' => $meta['description'],
                'icon' => $meta['icon'],
                'accent' => $meta['accent'],
                'count' => $groupCounts[$key] ?? 0,
                'order' => $meta['order'],
            ];
        }

        usort($groups, fn(array $a, array $b): int => ($a['order'] ?? 999) <=> ($b['order'] ?? 999));

        return [
            'groups' => $groups,
            'settings' => $settings,
            'stats' => [
                'total_settings' => count($settings),
                'groups_count' => count(array_filter($groups, fn(array $group): bool => ($group['count'] ?? 0) > 0)),
                'last_updated_at' => $lastUpdatedAt,
                'has_group_column' => $this->systemSettingsHasGroupColumn(),
            ],
        ];
    }

    public function getSystemSettingsSnapshot(array $keys = []): array
    {
        $rows = $this->getExistingSystemSettings($keys);
        $snapshot = [];
        foreach ($rows as $row) {
            $snapshot[(string) $row['setting_key']] = [
                'value' => (string) ($row['setting_value'] ?? ''),
                'description' => (string) ($row['description'] ?? ''),
                'group' => $this->inferSettingGroup((string) $row['setting_key'], isset($row['setting_group']) ? (string) $row['setting_group'] : null),
            ];
        }
        ksort($snapshot);
        return $snapshot;
    }

    public function saveSystemSettings(array $items, int|string|null $updatedBy = null): array
    {
        if (empty($items)) {
            throw new InvalidArgumentException('لا توجد إعدادات مطلوبة للحفظ.');
        }

        $definitions = $this->systemSettingDefinitions();
        $existing = $this->getExistingSystemSettings(array_keys($items));
        $hasGroupColumn = $this->systemSettingsHasGroupColumn();
        $saved = [];

        $this->conn->beginTransaction();
        try {
            foreach ($items as $key => $value) {
                if (!is_string($key) || trim($key) === '') {
                    throw new InvalidArgumentException('مفتاح الإعداد غير صالح.');
                }

                $normalizedKey = trim($key);
                $definition = $definitions[$normalizedKey] ?? $this->buildFallbackSettingDefinition($normalizedKey, $existing[$normalizedKey]['setting_value'] ?? null, $existing[$normalizedKey]['setting_group'] ?? null);
                $normalizedValue = $this->normalizeSystemSettingValue($definition, $value);
                $groupKey = (string) ($definition['group'] ?? $this->inferSettingGroup($normalizedKey, $existing[$normalizedKey]['setting_group'] ?? null));
                $description = (string) ($definition['hint'] ?? ($existing[$normalizedKey]['description'] ?? ''));

                if (isset($existing[$normalizedKey])) {
                    if ($hasGroupColumn) {
                        $stmt = $this->conn->prepare(
                            'UPDATE system_settings
                             SET setting_value = :value,
                                 setting_group = :setting_group,
                                 updated_at = NOW(),
                                 updated_by = :updated_by
                             WHERE setting_key = :key'
                        );
                        $stmt->execute([
                            ':value' => $normalizedValue,
                            ':setting_group' => $groupKey,
                            ':updated_by' => $updatedBy === null ? null : (string) $updatedBy,
                            ':key' => $normalizedKey,
                        ]);
                    } else {
                        $stmt = $this->conn->prepare(
                            'UPDATE system_settings
                             SET setting_value = :value,
                                 updated_at = NOW(),
                                 updated_by = :updated_by
                             WHERE setting_key = :key'
                        );
                        $stmt->execute([
                            ':value' => $normalizedValue,
                            ':updated_by' => $updatedBy === null ? null : (string) $updatedBy,
                            ':key' => $normalizedKey,
                        ]);
                    }
                } else {
                    if ($hasGroupColumn) {
                        $stmt = $this->conn->prepare(
                            'INSERT INTO system_settings (setting_key, setting_value, description, setting_group, updated_at, updated_by)
                             VALUES (:key, :value, :description, :setting_group, NOW(), :updated_by)'
                        );
                        $stmt->execute([
                            ':key' => $normalizedKey,
                            ':value' => $normalizedValue,
                            ':description' => $description,
                            ':setting_group' => $groupKey,
                            ':updated_by' => $updatedBy === null ? null : (string) $updatedBy,
                        ]);
                    } else {
                        $stmt = $this->conn->prepare(
                            'INSERT INTO system_settings (setting_key, setting_value, description, updated_at, updated_by)
                             VALUES (:key, :value, :description, NOW(), :updated_by)'
                        );
                        $stmt->execute([
                            ':key' => $normalizedKey,
                            ':value' => $normalizedValue,
                            ':description' => $description,
                            ':updated_by' => $updatedBy === null ? null : (string) $updatedBy,
                        ]);
                    }
                }

                $saved[$normalizedKey] = [
                    'value' => $normalizedValue,
                    'group' => $groupKey,
                    'description' => $description,
                ];
            }

            $this->conn->commit();
        } catch (Throwable $exception) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            throw $exception;
        }

        ksort($saved);

        return [
            'saved' => $saved,
            'updated_count' => count($saved),
        ];
    }

    private function systemSettingGroups(): array
    {
        return [
            'shifts' => [
                'label' => 'الفترات والإقفال',
                'description' => 'حدود الفترات، ترتيب السداد، وسياسات التجاوز الإداري.',
                'icon' => 'bi-clock-history',
                'accent' => 'primary',
                'order' => 1,
            ],
            'tickets' => [
                'label' => 'التذاكر والتسعير',
                'description' => 'أسعار التذاكر، ساعات الصباح، وحصص التذكرة.',
                'icon' => 'bi-ticket-perforated',
                'accent' => 'success',
                'order' => 2,
            ],
            'finance' => [
                'label' => 'المركز المالي',
                'description' => 'إعدادات العرض، التصدير، ووحدة العملة.',
                'icon' => 'bi-cash-stack',
                'accent' => 'warning',
                'order' => 3,
            ],
            'header' => [
                'label' => 'الترويسة والطباعة',
                'description' => 'بيانات النماذج المطبوعة والترويسة الرسمية.',
                'icon' => 'bi-card-heading',
                'accent' => 'info',
                'order' => 4,
            ],
            'general' => [
                'label' => 'عام',
                'description' => 'إعدادات عامة أو غير مصنفة.',
                'icon' => 'bi-sliders2',
                'accent' => 'secondary',
                'order' => 5,
            ],
        ];
    }

    private function systemSettingDefinitions(): array
    {
        return [
            'shift_default_split_time' => ['label' => 'وقت تقسيم اليوم الافتراضي', 'group' => 'shifts', 'control' => 'time', 'hint' => 'الوقت الافتراضي لتقسيم اليوم الجديد بين الصباحية والمسائية.', 'allow_empty' => false],
            'shift_default_day_mode' => [
                'label' => 'وضع اليوم الافتراضي',
                'group' => 'shifts',
                'control' => 'select',
                'hint' => 'الوضع الذي يُستخدم عند إنشاء يوم جديد لم تُحفظ حدوده بعد.',
                'options' => [
                    ['value' => 'both', 'label' => 'صباحي + مسائي'],
                    ['value' => 'morning_only', 'label' => 'اليوم كله صباحي'],
                    ['value' => 'evening_only', 'label' => 'اليوم كله مسائي'],
                ],
                'allow_empty' => false,
            ],
            'shift_auto_close_enabled' => ['label' => 'تفعيل الإقفال التلقائي', 'group' => 'shifts', 'control' => 'toggle', 'hint' => 'إقفال الفترات المفتوحة تلقائياً بعد انتهاء وقتها.', 'allow_empty' => false],
            'shift_system_user_id' => ['label' => 'معرّف مستخدم النظام', 'group' => 'shifts', 'control' => 'number', 'hint' => 'المستخدم الذي يُسجَّل كمنفذ لعمليات الإقفال التلقائي.', 'allow_empty' => false, 'min' => 0, 'step' => 1],
            'enforce_shift_payment_order' => ['label' => 'فرض ترتيب السداد بين الفترات', 'group' => 'shifts', 'control' => 'toggle', 'hint' => 'منع تسديد فترة لاحقة قبل استكمال الفترة السابقة.', 'allow_empty' => false],
            'allow_zero_invoices_implicit_close' => ['label' => 'اعتبار الفترة الفارغة مغلقة تلقائياً', 'group' => 'shifts', 'control' => 'toggle', 'hint' => 'يسمح بالسداد الفوري إذا كانت الفترة السابقة بلا فواتير.', 'allow_empty' => false],
            'allow_admin_payment_override' => ['label' => 'السماح بتجاوز المدير', 'group' => 'shifts', 'control' => 'toggle', 'hint' => 'مع تسجيل إلزامي في سجل التدقيق.', 'allow_empty' => false],
            'ticket_price_morning' => ['label' => 'سعر التذكرة الصباحية', 'group' => 'tickets', 'control' => 'number', 'unit' => 'ريال', 'min' => 0, 'step' => 1, 'allow_empty' => false],
            'ticket_price_evening' => ['label' => 'سعر التذكرة المسائية', 'group' => 'tickets', 'control' => 'number', 'unit' => 'ريال', 'min' => 0, 'step' => 1, 'allow_empty' => false],
            'ticket_morning_start_hour' => ['label' => 'ساعة بداية التذكرة الصباحية', 'group' => 'tickets', 'control' => 'number', 'min' => 0, 'max' => 23, 'step' => 1, 'allow_empty' => false],
            'ticket_morning_end_hour' => ['label' => 'ساعة نهاية التذكرة الصباحية', 'group' => 'tickets', 'control' => 'number', 'min' => 0, 'max' => 23, 'step' => 1, 'allow_empty' => false],
            'ticket_ministry_share_morning' => ['label' => 'حصة الوزارة من التذكرة الصباحية', 'group' => 'tickets', 'control' => 'number', 'unit' => 'ريال', 'min' => 0, 'step' => 1, 'allow_empty' => false],
            'ticket_ministry_share_evening' => ['label' => 'حصة الوزارة من التذكرة المسائية', 'group' => 'tickets', 'control' => 'number', 'unit' => 'ريال', 'min' => 0, 'step' => 1, 'allow_empty' => false],
            'finance_hub_default_page_size' => ['label' => 'عدد السجلات الافتراضي', 'group' => 'finance', 'control' => 'number', 'min' => 10, 'max' => 200, 'step' => 5, 'allow_empty' => false],
            'finance_hub_export_limit' => ['label' => 'حد التصدير الأقصى', 'group' => 'finance', 'control' => 'number', 'min' => 100, 'max' => 100000, 'step' => 100, 'allow_empty' => false],
            'finance_hub_currency_label' => ['label' => 'اسم العملة المعروضة', 'group' => 'finance', 'control' => 'text', 'placeholder' => 'مثال: ريال', 'allow_empty' => false],
            'header_country' => ['label' => 'اسم الدولة', 'group' => 'header', 'control' => 'text', 'allow_empty' => false],
            'header_ministry' => ['label' => 'اسم الوزارة', 'group' => 'header', 'control' => 'text', 'allow_empty' => false],
            'header_office' => ['label' => 'اسم المكتب / المحافظة', 'group' => 'header', 'control' => 'text', 'allow_empty' => false],
            'header_directorate' => ['label' => 'اسم المديرية', 'group' => 'header', 'control' => 'text', 'allow_empty' => false],
            'header_center' => ['label' => 'اسم المركز', 'group' => 'header', 'control' => 'text', 'allow_empty' => false],
            'header_admin' => ['label' => 'الإدارة المسؤولة', 'group' => 'header', 'control' => 'text', 'allow_empty' => false],
            'header_form_title' => ['label' => 'عنوان النموذج', 'group' => 'header', 'control' => 'text', 'allow_empty' => false],
            'header_logo_url' => ['label' => 'رابط الشعار', 'group' => 'header', 'control' => 'url', 'placeholder' => 'https://example.com/logo.png', 'allow_empty' => true],
            'header_footer_note' => ['label' => 'ملاحظة أسفل النموذج', 'group' => 'header', 'control' => 'textarea', 'allow_empty' => true],
            'header_side_note' => ['label' => 'ملاحظة جانبية', 'group' => 'header', 'control' => 'textarea', 'allow_empty' => true],
        ];
    }

    private function getExistingSystemSettings(array $keys = []): array
    {
        $columns = ['setting_key', 'setting_value', 'description', 'updated_at', 'updated_by'];
        if ($this->systemSettingsHasGroupColumn()) {
            $columns[] = 'setting_group';
        }

        $sql = 'SELECT ' . implode(', ', array_map(fn(string $column): string => $this->quoteIdentifier($column), $columns))
            . ' FROM system_settings';
        $params = [];
        if (!empty($keys)) {
            $placeholders = [];
            foreach (array_values($keys) as $index => $key) {
                $placeholder = ':key_' . $index;
                $placeholders[] = $placeholder;
                $params[$placeholder] = (string) $key;
            }
            $sql .= ' WHERE setting_key IN (' . implode(', ', $placeholders) . ')';
        }
        $sql .= ' ORDER BY ' . ($this->systemSettingsHasGroupColumn() ? $this->quoteIdentifier('setting_group') . ', ' : '') . $this->quoteIdentifier('setting_key') . ' ASC';

        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);

        $rows = [];
        foreach ($stmt->fetchAll() ?: [] as $row) {
            $rows[(string) $row['setting_key']] = $row;
        }

        return $rows;
    }

    private function systemSettingsHasGroupColumn(): bool
    {
        if ($this->settingsGroupColumnExists !== null) {
            return $this->settingsGroupColumnExists;
        }

        $stmt = $this->conn->prepare(
            "SELECT 1
             FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'system_settings'
               AND column_name = 'setting_group'
             LIMIT 1"
        );
        $stmt->execute();
        $this->settingsGroupColumnExists = (bool) $stmt->fetchColumn();

        return $this->settingsGroupColumnExists;
    }

    private function inferSettingGroup(string $key, ?string $storedGroup = null): string
    {
        $candidate = trim((string) ($storedGroup ?? ''));
        $groups = $this->systemSettingGroups();
        if ($candidate !== '' && isset($groups[$candidate])) {
            return $candidate;
        }

        if (str_starts_with($key, 'header_')) {
            return 'header';
        }
        if (str_starts_with($key, 'ticket_')) {
            return 'tickets';
        }
        if (str_starts_with($key, 'finance_hub_')) {
            return 'finance';
        }
        if (str_starts_with($key, 'shift_') || in_array($key, ['enforce_shift_payment_order', 'allow_zero_invoices_implicit_close', 'allow_admin_payment_override'], true)) {
            return 'shifts';
        }

        return 'general';
    }

    private function inferSettingControl(string $key, string $value): string
    {
        if (preg_match('/^(true|false)$/i', trim($value))) {
            return 'toggle';
        }
        if (preg_match('/^\d{1,2}:\d{2}$/', trim($value))) {
            return 'time';
        }
        if (is_numeric($value)) {
            return 'number';
        }
        if (str_contains($key, 'url')) {
            return 'url';
        }
        if (str_contains($key, 'note') || str_contains($key, 'description')) {
            return 'textarea';
        }
        return 'text';
    }

    private function isHiddenSystemSetting(string $key, string $description = ''): bool
    {
        $legacyKeys = [
            'shift_morning_start',
            'shift_morning_end',
            'shift_evening_start',
            'shift_evening_end',
            'shift_overnight_belongs_to',
        ];

        if (in_array($key, $legacyKeys, true)) {
            return true;
        }

        return str_starts_with($description, '[DEPRECATED');
    }

    private function buildFallbackSettingDefinition(string $key, mixed $value = null, mixed $group = null): array
    {
        $stringValue = $value === null ? '' : (string) $value;
        return [
            'label' => $this->humanize($key),
            'group' => $this->inferSettingGroup($key, is_string($group) ? $group : null),
            'control' => $this->inferSettingControl($key, $stringValue),
            'hint' => '',
            'allow_empty' => true,
        ];
    }

    private function normalizeSystemSettingValue(array $definition, mixed $value): string
    {
        $control = (string) ($definition['control'] ?? 'text');
        $allowEmpty = (bool) ($definition['allow_empty'] ?? true);

        if ($control === 'toggle') {
            $boolValue = filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
            if ($boolValue === null) {
                throw new InvalidArgumentException('قيمة الإعداد ' . ($definition['label'] ?? '') . ' يجب أن تكون نعم أو لا.');
            }
            return $boolValue ? 'true' : 'false';
        }

        $stringValue = trim((string) ($value ?? ''));
        if ($stringValue === '') {
            if ($allowEmpty) {
                return '';
            }
            throw new InvalidArgumentException('الإعداد ' . ($definition['label'] ?? '') . ' لا يقبل قيمة فارغة.');
        }

        if ($control === 'time') {
            if (!preg_match('/^(\d{1,2}):(\d{2})$/', $stringValue, $matches)) {
                throw new InvalidArgumentException('تنسيق الوقت غير صحيح في ' . ($definition['label'] ?? '') . '.');
            }
            $hour = (int) $matches[1];
            $minute = (int) $matches[2];
            if ($hour < 0 || $hour > 23 || $minute < 0 || $minute > 59) {
                throw new InvalidArgumentException('قيمة الوقت غير صحيحة في ' . ($definition['label'] ?? '') . '.');
            }
            return sprintf('%02d:%02d', $hour, $minute);
        }

        if ($control === 'number') {
            if (!is_numeric($stringValue)) {
                throw new InvalidArgumentException('الإعداد ' . ($definition['label'] ?? '') . ' يجب أن يكون رقمياً.');
            }
            $number = (float) $stringValue;
            $min = isset($definition['min']) ? (float) $definition['min'] : null;
            $max = isset($definition['max']) ? (float) $definition['max'] : null;
            if ($min !== null && $number < $min) {
                throw new InvalidArgumentException('قيمة ' . ($definition['label'] ?? '') . ' أقل من الحد الأدنى المسموح.');
            }
            if ($max !== null && $number > $max) {
                throw new InvalidArgumentException('قيمة ' . ($definition['label'] ?? '') . ' أعلى من الحد الأقصى المسموح.');
            }
            $step = $definition['step'] ?? null;
            if ($step === 1 || $step === '1') {
                return (string) ((int) round($number));
            }
            $formatted = rtrim(rtrim(number_format($number, 2, '.', ''), '0'), '.');
            return $formatted === '' ? '0' : $formatted;
        }

        if ($control === 'select') {
            $allowed = array_map(fn(array $option): string => (string) ($option['value'] ?? ''), $definition['options'] ?? []);
            if (!in_array($stringValue, $allowed, true)) {
                throw new InvalidArgumentException('القيمة المختارة في ' . ($definition['label'] ?? '') . ' غير مدعومة.');
            }
            return $stringValue;
        }

        return $stringValue;
    }

    private function getReferenceOptions(string $table, string $idColumn): array
    {
        $labelColumn = $this->detectLabelColumn($table);
        $tableColumns = $this->getTableColumnNames($table);

        $orderParts = [];
        if (in_array('sort_order', $tableColumns, true)) {
            $orderParts[] = $this->quoteIdentifier('sort_order') . ' ASC';
        }
        $orderParts[] = $this->quoteIdentifier($labelColumn) . ' ASC';

        $where = [];
        if (in_array('is_active', $tableColumns, true)) {
            $where[] = 'COALESCE(' . $this->quoteIdentifier('is_active') . ', TRUE) = TRUE';
        }

        $sql = 'SELECT ' . $this->quoteIdentifier($idColumn) . ' AS value, ' . $this->quoteIdentifier($labelColumn) . ' AS label FROM ' . $this->quoteIdentifier($table);
        if (!empty($where)) {
            $sql .= ' WHERE ' . implode(' AND ', $where);
        }
        $sql .= ' ORDER BY ' . implode(', ', $orderParts) . ' LIMIT 300';

        $stmt = $this->conn->query($sql);
        return $stmt->fetchAll() ?: [];
    }

    private function detectLabelColumn(string $table): string
    {
        $list = $this->getTableColumnNames($table);
        $candidates = ['department_name', 'full_name', 'role_name', 'case_name', 'category_name', 'service_name', 'doc_name', 'title', 'username', 'name'];
        foreach ($candidates as $candidate) {
            if (in_array($candidate, $list, true)) {
                return $candidate;
            }
        }
        return isset($list[1]) ? (string) $list[1] : (string) ($list[0] ?? 'id');
    }

    private function getTableColumnNames(string $table): array
    {
        $columns = $this->conn->prepare("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=:table ORDER BY ordinal_position ASC");
        $columns->execute([':table' => $table]);
        return $columns->fetchAll(PDO::FETCH_COLUMN) ?: [];
    }

    private function requireTableMeta(string $table): array
    {
        foreach ($this->getSchema() as $meta) {
            if ($meta['table'] === $table) {
                return $meta;
            }
        }
        throw new InvalidArgumentException('الجدول المطلوب غير مسموح.');
    }

    private function recordExists(string $table, string $pk, int|string|null $id): bool
    {
        if ($id === null || $id === '') {
            return false;
        }
        $stmt = $this->conn->prepare('SELECT 1 FROM ' . $this->quoteIdentifier($table) . ' WHERE ' . $this->quoteIdentifier($pk) . ' = :id LIMIT 1');
        $stmt->execute([':id' => (string) $id]);
        return (bool) $stmt->fetchColumn();
    }

    private function normalizeValue(array $column, mixed $value): mixed
    {
        if ($value === '' || $value === null) {
            if ($column['nullable']) {
                return null;
            }
            throw new InvalidArgumentException('الحقل ' . $column['label'] . ' مطلوب.');
        }

        if ($column['is_boolean']) {
            $boolValue = filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
            if ($boolValue === null) {
                throw new InvalidArgumentException('الحقل ' . $column['label'] . ' يجب أن يكون نعم أو لا.');
            }
            return $boolValue ? 'true' : 'false';
        }

        if ($column['is_numeric']) {
            if (!is_numeric($value)) {
                throw new InvalidArgumentException('الحقل ' . $column['label'] . ' يجب أن يكون رقمياً.');
            }
            return $value;
        }

        if (!empty($column['enum_values'])) {
            $stringValue = (string) $value;
            if (!in_array($stringValue, $column['enum_values'], true)) {
                throw new InvalidArgumentException('القيمة المدخلة في ' . $column['label'] . ' غير صحيحة.');
            }
            return $stringValue;
        }

        return is_string($value) ? trim($value) : $value;
    }

    private function prefixParams(array $params): array
    {
        $prefixed = [];
        foreach ($params as $key => $value) {
            $prefixed[':' . $key] = $value;
        }
        return $prefixed;
    }

    private function quoteIdentifier(string $identifier): string
    {
        return '"' . str_replace('"', '""', $identifier) . '"';
    }

    private function searchableExpression(string $column): string
    {
        return 'CAST(' . $this->quoteIdentifier($column) . ' AS TEXT)';
    }

    private function scalar(string $sql): mixed
    {
        return $this->conn->query($sql)->fetchColumn();
    }

    private function humanize(string $value): string
    {
        return trim(str_replace('_', ' ', $value));
    }

    /**
     * يتحقّق إذا كان العمود تديره قاعدة البيانات تلقائياً
     * (لا ينبغي عرضه في نماذج الإدخال).
     */
    private function isSystemManagedColumn(string $name, mixed $default): bool
    {
        if (in_array($name, ['created_at', 'updated_at'], true)) {
            return true;
        }
        return is_string($default) && $this->isAutoGeneratedDefault($default);
    }

    private function isLegacyShadowColumn(string $table, string $name): bool
    {
        return $table === 'service_categories' && $name === 'department';
    }

    private function resolveLegacyDepartmentValue(int $departmentId): string
    {
        $stmt = $this->conn->prepare('SELECT department_code FROM departments WHERE department_id = :department_id LIMIT 1');
        $stmt->execute([':department_id' => $departmentId]);
        $code = $stmt->fetchColumn();
        if ($code === false || $code === null || $code === '') {
            throw new InvalidArgumentException('القسم المحدد غير موجود.');
        }
        return (string) $code;
    }

    /**
     * تعرّف الدوال الافتراضية التي تولّد قيم المفاتيح تلقائياً في PostgreSQL.
     * بعد الترحيل 003 أصبح الاعتماد الرئيسي على nextval() لـ SERIAL.
     */
    private function isAutoGeneratedDefault(string $default): bool
    {
        if ($default === '') return false;
        $normalized = strtolower($default);
        return str_contains($normalized, 'nextval(')
            || str_contains($normalized, 'identity');
    }

    // ========================================================================
    //   🆕 الميزات المضافة حديثاً للوحة الإدارة الكاملة
    // ========================================================================

    /**
     * يرفق تسميات المفاتيح الأجنبية إلى كل صف (مثلاً role_id → role_name)
     * يُنادى من داخل getTableRows لإثراء البيانات قبل عرضها.
     */
    public function enrichRowsWithForeignLabels(string $table, array $rows): array
    {
        $meta = $this->requireTableMeta($table);
        foreach ($meta['columns'] as $columnName => $column) {
            if (!$column['is_foreign'] || empty($column['foreign_options'])) {
                continue;
            }
            $optionMap = [];
            foreach ($column['foreign_options'] as $option) {
                $optionMap[(string) $option['value']] = (string) $option['label'];
            }
            foreach ($rows as &$row) {
                if (!array_key_exists($columnName, $row)) {
                    continue;
                }
                $v = $row[$columnName];
                if ($v === null || $v === '') {
                    $row['_fk_' . $columnName] = null;
                    continue;
                }
                $row['_fk_' . $columnName] = $optionMap[(string) $v] ?? null;
            }
            unset($row);
        }
        return $rows;
    }

    /**
     * بيانات الرسوم البيانية للداشبورد (آخر 30 يوم إيراد / توزيع الحالات / أكثر الخدمات / نشاط الأطباء)
     */
    public function getDashboardCharts(): array
    {
        // 1) إيراد آخر 30 يوم
        $revenueDaily = $this->conn->query(
            "SELECT TO_CHAR(DATE(COALESCE(paid_at, created_at)), 'YYYY-MM-DD') AS day,
                    COALESCE(SUM(net_amount), 0) AS total,
                    COUNT(*) AS invoices_count
             FROM Invoices i
             WHERE accountant_id IS NOT NULL
               AND {$this->activeInvoiceCondition('i')}
               AND COALESCE(paid_at, created_at) >= CURRENT_DATE - INTERVAL '29 days'
             GROUP BY day
             ORDER BY day ASC"
        )->fetchAll() ?: [];

        // 2) توزيع أنواع الحالات
        $caseTypes = $this->conn->query(
            "SELECT COALESCE(ct.case_name, 'غير محدد') AS label, COUNT(*) AS total
             FROM Visits v
             LEFT JOIN Emergency_Case_Types ct ON v.case_type_id = ct.case_type_id
             GROUP BY ct.case_name
             ORDER BY total DESC
             LIMIT 8"
        )->fetchAll() ?: [];

        // 3) أكثر الخدمات طلباً
        $topServices = $this->conn->query(
            "SELECT s.service_name AS label, COUNT(*) AS total,
                    COALESCE(SUM(id.service_price_at_time), 0) AS revenue
             FROM Invoice_Details id
             JOIN Invoices i ON id.invoice_id = i.invoice_id
             JOIN Services_Master s ON id.service_id = s.service_id
             WHERE {$this->activeInvoiceCondition('i')}
             GROUP BY s.service_name
             ORDER BY total DESC
             LIMIT 8"
        )->fetchAll() ?: [];

        // 4) نشاط الأطباء (عدد الزيارات لكل طبيب)
        $doctors = $this->conn->query(
            "SELECT u.full_name AS label,
                    COUNT(v.visit_id) AS total,
                    COUNT(CASE WHEN v.status = 'Completed' THEN 1 END) AS completed
             FROM Users u
             LEFT JOIN Visits v ON v.doctor_id = u.user_id
             WHERE u.role_id = 1
             GROUP BY u.user_id, u.full_name
             ORDER BY total DESC
             LIMIT 8"
        )->fetchAll() ?: [];

        // 5) أحدث 10 فواتير و 10 زيارات
        $recentInvoices = $this->conn->query(
            "SELECT i.invoice_id, i.serial_number, i.net_amount,
                    COALESCE(i.paid_at, i.created_at) AS ts,
                    p.full_name AS patient_name,
                    u.full_name AS accountant_name,
                    CASE WHEN i.cancelled_at IS NOT NULL THEN 'ملغاة'
                         WHEN i.accountant_id IS NOT NULL THEN 'مدفوعة'
                         ELSE 'معلقة' END AS status
             FROM Invoices i
             LEFT JOIN Visits v ON i.visit_id = v.visit_id
             LEFT JOIN Patients p ON v.patient_id = p.patient_id
             LEFT JOIN Users u ON i.accountant_id = u.user_id
             ORDER BY COALESCE(i.paid_at, i.created_at) DESC
             LIMIT 10"
        )->fetchAll() ?: [];

        $recentVisits = $this->conn->query(
            "SELECT v.visit_id, v.visit_date, v.status, v.diagnosis,
                    p.full_name AS patient_name,
                    u.full_name AS doctor_name,
                    ct.case_name
             FROM Visits v
             LEFT JOIN Patients p ON v.patient_id = p.patient_id
             LEFT JOIN Users u ON v.doctor_id = u.user_id
             LEFT JOIN Emergency_Case_Types ct ON v.case_type_id = ct.case_type_id
             ORDER BY v.visit_date DESC
             LIMIT 10"
        )->fetchAll() ?: [];

        return [
            'revenue_daily'   => $revenueDaily,
            'case_types'      => $caseTypes,
            'top_services'    => $topServices,
            'doctors_activity'=> $doctors,
            'recent_invoices' => $recentInvoices,
            'recent_visits'   => $recentVisits,
        ];
    }

    /**
     * يجلب كل السجلات بدون Pagination (للتصدير) — يطبّق نفس الفلاتر والبحث
     */
    public function getTableRowsForExport(string $table, string $search = '', array $filters = []): array
    {
        $result = $this->getTableRows($table, 1, 10000, $search, $filters, null, 'ASC');
        return [
            'rows'    => $this->enrichRowsWithForeignLabels($table, $result['rows']),
            'columns' => $this->requireTableMeta($table)['columns'],
            'label'   => $result['meta']['label'],
        ];
    }

    /**
     * تحديث كلمة مرور مستخدم
     */
    public function changeUserPassword(int|string $userId, string $newPassword): bool
    {
        if (mb_strlen($newPassword) < 6) {
            throw new InvalidArgumentException('كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل.');
        }
        $hash = password_hash($newPassword, PASSWORD_BCRYPT);
        $stmt = $this->conn->prepare('UPDATE Users SET password_hash = :h, updated_at = NOW() WHERE user_id = :id');
        return $stmt->execute([':h' => $hash, ':id' => (string) $userId]);
    }

    /**
     * تفعيل / تعطيل مستخدم
     */
    public function toggleUserActive(int|string $userId, bool $active): bool
    {
        $stmt = $this->conn->prepare('UPDATE Users SET is_active = :a, updated_at = NOW() WHERE user_id = :id');
        return $stmt->execute([':a' => $active ? 'true' : 'false', ':id' => (string) $userId]);
    }

    /**
     * إلغاء فاتورة (Soft delete)
     *
     * إذا كانت الفاتورة مرتبطة بسند آخر (A↔B في الإعفاء الجزئي)
     * نلغي السند المرتبط أيضاً حتى لا يبقى جزء من العملية المالية
     * محتسباً داخل التقارير أو المجاميع.
     */
    public function cancelInvoice(int|string $invoiceId, int|string $adminId, string $reason): array
    {
        $reason = mb_substr($reason, 0, 255);

        try {
            $this->conn->beginTransaction();

            $lookup = $this->conn->prepare(
                'SELECT invoice_id, serial_number, net_amount, related_invoice_id
                 FROM Invoices
                 WHERE invoice_id = :id AND cancelled_at IS NULL
                 FOR UPDATE'
            );
            $lookup->execute([':id' => (string) $invoiceId]);
            $row = $lookup->fetch(PDO::FETCH_ASSOC);

            if (!$row) {
                throw new InvalidArgumentException('الفاتورة غير موجودة أو ملغاة مسبقاً.');
            }

            $cancelOne = $this->conn->prepare(
                'UPDATE Invoices
                 SET cancelled_at = NOW(), cancelled_by = :by, cancel_reason = :r, updated_at = NOW()
                 WHERE invoice_id = :id AND cancelled_at IS NULL'
            );

            $cancelOne->execute([
                ':id' => (string) $invoiceId,
                ':by' => (string) $adminId,
                ':r'  => $reason,
            ]);

            $relatedCancelled = null;
            if (!empty($row['related_invoice_id'])) {
                $relatedId = (string) $row['related_invoice_id'];
                $cancelOne->execute([
                    ':id' => $relatedId,
                    ':by' => (string) $adminId,
                    ':r'  => $reason,
                ]);
                $relatedCancelled = (int) $row['related_invoice_id'];
            }

            $this->conn->commit();

            $row['invoice_id'] = (int) $row['invoice_id'];
            $row['serial_number'] = $row['serial_number'] !== null ? (int) $row['serial_number'] : null;
            $row['net_amount'] = (float) $row['net_amount'];
            $row['related_cancelled_invoice_id'] = $relatedCancelled;

            return $row;
        } catch (Throwable $e) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            throw $e;
        }
    }

    /**
     * إلغاء زيارة
     */
    public function cancelVisit(int|string $visitId, int|string $adminId, string $reason): array
    {
        $stmt = $this->conn->prepare(
            "UPDATE Visits SET status = 'Cancelled', cancelled_at = NOW(), cancelled_by = :by, cancel_reason = :r, updated_at = NOW()
             WHERE visit_id = :id AND cancelled_at IS NULL
             RETURNING visit_id, status"
        );
        try {
            $stmt->execute([':id' => (string) $visitId, ':by' => (string) $adminId, ':r' => mb_substr($reason, 0, 255)]);
        } catch (PDOException $e) {
            // إذا كانت قيمة enum غير مضافة بعد، نكتفي بتعليم cancelled_at
            $fallback = $this->conn->prepare(
                "UPDATE Visits SET cancelled_at = NOW(), cancelled_by = :by, cancel_reason = :r, updated_at = NOW()
                 WHERE visit_id = :id AND cancelled_at IS NULL
                 RETURNING visit_id, status"
            );
            $fallback->execute([':id' => (string) $visitId, ':by' => (string) $adminId, ':r' => mb_substr($reason, 0, 255)]);
            $row = $fallback->fetch();
            if (!$row) {
                throw new InvalidArgumentException('الزيارة غير موجودة أو ملغاة مسبقاً.');
            }
            return $row;
        }
        $row = $stmt->fetch();
        if (!$row) {
            throw new InvalidArgumentException('الزيارة غير موجودة أو ملغاة مسبقاً.');
        }
        return $row;
    }

    /**
     * بث إشعار يدوي إلى دور
     */
    public function broadcastNotification(string $targetRole, string $title, string $body): array
    {
        $stmt = $this->conn->prepare(
            "INSERT INTO Notifications (target_role, title, body, event_type, reference_id)
             VALUES (:role, :title, :body, 'admin_broadcast', NULL)
             RETURNING notification_id, created_at"
        );
        $stmt->execute([
            ':role'  => mb_substr($targetRole, 0, 50),
            ':title' => mb_substr($title, 0, 150),
            ':body'  => mb_substr($body, 0, 500),
        ]);
        return $stmt->fetch();
    }

    /**
     * سجل التدقيق (Audit Log) مع فلترة
     */
    public function getAuditLogs(int $page = 1, int $perPage = 25, array $filters = []): array
    {
        $where = [];
        $params = [];
        if (!empty($filters['action'])) {
            $where[] = 'action = :action';
            $params[':action'] = $filters['action'];
        }
        if (!empty($filters['table'])) {
            $where[] = 'table_name = :table';
            $params[':table'] = $filters['table'];
        }
        if (!empty($filters['username'])) {
            $where[] = 'username ILIKE :username';
            $params[':username'] = '%' . $filters['username'] . '%';
        }
        if (!empty($filters['from'])) {
            $where[] = 'created_at >= :from';
            $params[':from'] = $filters['from'];
        }
        if (!empty($filters['to'])) {
            $where[] = 'created_at <= :to';
            $params[':to'] = $filters['to'];
        }

        $whereSql = $where ? ' WHERE ' . implode(' AND ', $where) : '';
        $total = (int) $this->fetchColumnBind('SELECT COUNT(*) FROM audit_logs' . $whereSql, $params);

        $perPage = max(1, min($perPage, 100));
        $offset = ($page - 1) * $perPage;

        $sql = 'SELECT log_id, user_id, username, action, table_name, record_id, old_values, new_values, ip_address, created_at
                FROM audit_logs' . $whereSql .
               ' ORDER BY created_at DESC LIMIT ' . $perPage . ' OFFSET ' . $offset;
        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll() ?: [];

        return [
            'rows' => $rows,
            'meta' => [
                'total' => $total,
                'page'  => $page,
                'pages' => (int) ceil($total / $perPage),
                'per_page' => $perPage,
            ],
        ];
    }

    /**
     * تقرير الإيرادات حسب الخدمة
     */
    public function reportRevenueByService(?string $from = null, ?string $to = null): array
    {
        $where = ['i.accountant_id IS NOT NULL', $this->activeInvoiceCondition('i')];
        $params = [];
        if ($from) { $where[] = 'COALESCE(i.paid_at, i.created_at) >= :from'; $params[':from'] = $from; }
        if ($to)   { $where[] = 'COALESCE(i.paid_at, i.created_at) <= :to';   $params[':to']   = $to; }
        $sql = "SELECT sc.category_name AS category,
                       s.service_name   AS service,
                       COUNT(*)         AS count,
                       COALESCE(SUM(id.service_price_at_time), 0) AS revenue
                FROM Invoice_Details id
                JOIN Invoices i       ON id.invoice_id = i.invoice_id
                JOIN Services_Master s ON id.service_id = s.service_id
                LEFT JOIN Service_Categories sc ON s.category_id = sc.category_id
                WHERE " . implode(' AND ', $where) . "
                GROUP BY sc.category_name, s.service_name
                ORDER BY revenue DESC";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll() ?: [];
    }

    /**
     * تقرير أداء الأطباء
     */
    public function reportDoctorPerformance(?string $from = null, ?string $to = null): array
    {
        $where = ['u.role_id = 1'];
        $params = [];
        if ($from) { $where[] = '(v.visit_date IS NULL OR v.visit_date >= :from)'; $params[':from'] = $from; }
        if ($to)   { $where[] = '(v.visit_date IS NULL OR v.visit_date <= :to)';   $params[':to']   = $to; }
        $sql = "SELECT u.user_id, u.full_name AS doctor,
                       COUNT(v.visit_id) AS visits,
                       COUNT(CASE WHEN v.status = 'Completed' THEN 1 END) AS completed,
                       COUNT(CASE WHEN v.status = 'Active' THEN 1 END) AS active,
                       COUNT(DISTINCT v.patient_id) AS unique_patients
                FROM Users u
                LEFT JOIN Visits v ON v.doctor_id = u.user_id
                WHERE " . implode(' AND ', $where) . "
                GROUP BY u.user_id, u.full_name
                ORDER BY visits DESC";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll() ?: [];
    }

    private function fetchColumnBind(string $sql, array $params): mixed
    {
        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchColumn();
    }
}
