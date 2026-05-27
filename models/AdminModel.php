<?php
declare(strict_types=1);

class AdminModel
{
    private PDO $conn;
    private string $driver;
    private ?array $schemaCache = null;
    private ?SchemaCache $persistentCache = null;

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
        'emergency_case_types' => 'أنواع الحالات',
        'medical_results' => 'النتائج الطبية',
        'notifications' => 'الإشعارات',
        'examination_tickets' => 'تذاكر المعاينة',
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
        'center_share' => 'نسبة المركز',
        'ministry_share' => 'نسبة الوزارة',
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
    ];

    public function __construct(PDO $db, string $driver = 'pgsql')
    {
        $this->conn = $db;
        $this->driver = $driver;
        // Phase 1: كاش schema بين الطلبات (ملف بـ TTL)
        if (class_exists('SchemaCache')) {
            $this->persistentCache = new SchemaCache();
        }
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
                (SELECT COUNT(*) FROM Invoices WHERE accountant_id IS NULL AND cancelled_at IS NULL) AS pending_invoices_count,
                (SELECT COUNT(*) FROM Invoices WHERE accountant_id IS NOT NULL AND cancelled_at IS NULL AND COALESCE(paid_at, created_at) >= CURRENT_DATE AND COALESCE(paid_at, created_at) < CURRENT_DATE + INTERVAL '1 day') AS paid_invoices_today,
                (SELECT COUNT(*) FROM Invoices WHERE cancelled_at IS NOT NULL) AS cancelled_invoices_count,
                (SELECT COALESCE(SUM(net_amount), 0) FROM Invoices WHERE accountant_id IS NOT NULL AND cancelled_at IS NULL AND COALESCE(paid_at, created_at) >= CURRENT_DATE AND COALESCE(paid_at, created_at) < CURRENT_DATE + INTERVAL '1 day') AS revenue_today,
                (SELECT COALESCE(SUM(net_amount), 0) FROM Invoices WHERE accountant_id IS NOT NULL AND cancelled_at IS NULL AND COALESCE(paid_at, created_at) >= DATE_TRUNC('month', CURRENT_DATE) AND COALESCE(paid_at, created_at) < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month') AS revenue_month,
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

    public function deleteRecord(string $table, int|string $id): void
    {
        $meta = $this->requireTableMeta($table);
        $pk = $meta['primary_key'];
        if (!$this->recordExists($table, $pk, $id)) {
            throw new InvalidArgumentException('السجل المطلوب حذفه غير موجود.');
        }

        $stmt = $this->conn->prepare('DELETE FROM ' . $this->quoteIdentifier($table) . ' WHERE ' . $this->quoteIdentifier($pk) . ' = :id');
        $stmt->execute([':id' => (string) $id]);
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

        $columnStmt = $this->conn->prepare("SELECT column_name, data_type, is_nullable, column_default, udt_name, is_identity
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
            $enumValues = $dataType === 'USER-DEFINED' ? $this->getEnumValues($udtName) : [];
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
                'is_primary' => $name === $primaryKey,
                'is_foreign' => isset($foreignKeys[$name]),
                'foreign' => $foreignKeys[$name] ?? null,
                'foreign_options' => isset($foreignKeys[$name]) ? $this->getReferenceOptions($foreignKeys[$name]['table'], $foreignKeys[$name]['column']) : [],
                'is_boolean' => $isBoolean,
                'is_numeric' => $isNumeric,
                'is_date_like' => $isDateLike,
                'enum_values' => $enumValues,
                'searchable' => $isBoolean || $isNumeric || $isDateLike || in_array($dataType, ['character varying', 'character', 'text', 'USER-DEFINED'], true),
                'visible_in_list' => $name !== 'password_hash',
                'editable' => !$this->isSystemManagedColumn($name, $row['column_default']),
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

    private function getReferenceOptions(string $table, string $idColumn): array
    {
        $labelColumn = $this->detectLabelColumn($table);
        $sql = 'SELECT ' . $this->quoteIdentifier($idColumn) . ' AS value, ' . $this->quoteIdentifier($labelColumn) . ' AS label FROM ' . $this->quoteIdentifier($table) . ' ORDER BY ' . $this->quoteIdentifier($labelColumn) . ' ASC LIMIT 300';
        $stmt = $this->conn->query($sql);
        return $stmt->fetchAll() ?: [];
    }

    private function detectLabelColumn(string $table): string
    {
        $columns = $this->conn->prepare("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=:table ORDER BY ordinal_position ASC");
        $columns->execute([':table' => $table]);
        $list = $columns->fetchAll(PDO::FETCH_COLUMN) ?: [];
        $candidates = ['full_name', 'role_name', 'case_name', 'category_name', 'service_name', 'doc_name', 'title', 'username', 'name'];
        foreach ($candidates as $candidate) {
            if (in_array($candidate, $list, true)) {
                return $candidate;
            }
        }
        return isset($list[1]) ? (string) $list[1] : (string) ($list[0] ?? 'id');
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
             FROM Invoices
             WHERE accountant_id IS NOT NULL
               AND cancelled_at IS NULL
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
             JOIN Services_Master s ON id.service_id = s.service_id
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
     */
    public function cancelInvoice(int|string $invoiceId, int|string $adminId, string $reason): array
    {
        $stmt = $this->conn->prepare(
            'UPDATE Invoices SET cancelled_at = NOW(), cancelled_by = :by, cancel_reason = :r, updated_at = NOW()
             WHERE invoice_id = :id AND cancelled_at IS NULL
             RETURNING invoice_id, serial_number, net_amount'
        );
        $stmt->execute([':id' => (string) $invoiceId, ':by' => (string) $adminId, ':r' => mb_substr($reason, 0, 255)]);
        $row = $stmt->fetch();
        if (!$row) {
            throw new InvalidArgumentException('الفاتورة غير موجودة أو ملغاة مسبقاً.');
        }
        return $row;
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
        $where = ['i.accountant_id IS NOT NULL', 'i.cancelled_at IS NULL'];
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
