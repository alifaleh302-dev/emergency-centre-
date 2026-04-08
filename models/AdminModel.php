<?php
declare(strict_types=1);

class AdminModel
{
    private PDO $conn;
    private string $driver;
    private ?array $schemaCache = null;

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
    }

    public function getSchema(): array
    {
        if ($this->schemaCache !== null) {
            return $this->schemaCache;
        }

        $tables = $this->conn->query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name ASC")->fetchAll(PDO::FETCH_COLUMN) ?: [];
        $schema = [];
        foreach ($tables as $table) {
            $schema[] = $this->getTableMeta((string) $table);
        }

        $this->schemaCache = $schema;
        return $schema;
    }

    public function getDashboardStats(): array
    {
        $tableCount = count($this->getSchema());
        $stats = [
            'tables_count' => $tableCount,
            'users_count' => (int) $this->scalar('SELECT COUNT(*) FROM Users'),
            'active_users_count' => (int) $this->scalar('SELECT COUNT(*) FROM Users WHERE role_id IS NOT NULL'),
            'patients_count' => (int) $this->scalar('SELECT COUNT(*) FROM Patients'),
            'active_visits_count' => (int) $this->scalar("SELECT COUNT(*) FROM Visits WHERE status = 'Active'"),
            'completed_visits_count' => (int) $this->scalar("SELECT COUNT(*) FROM Visits WHERE status = 'Completed'"),
            'pending_invoices_count' => (int) $this->scalar('SELECT COUNT(*) FROM Invoices WHERE accountant_id IS NULL'),
            'paid_invoices_today' => (int) $this->scalar('SELECT COUNT(*) FROM Invoices WHERE accountant_id IS NOT NULL AND DATE(COALESCE(paid_at, created_at)) = CURRENT_DATE'),
            'revenue_today' => (float) $this->scalar('SELECT COALESCE(SUM(net_amount), 0) FROM Invoices WHERE accountant_id IS NOT NULL AND DATE(COALESCE(paid_at, created_at)) = CURRENT_DATE'),
            'tickets_today' => (int) $this->scalar('SELECT COUNT(*) FROM Examination_Tickets WHERE DATE(created_at) = CURRENT_DATE'),
            'notifications_today' => (int) $this->scalar('SELECT COUNT(*) FROM Notifications WHERE DATE(created_at) = CURRENT_DATE'),
        ];

        $tableSummaries = [];
        foreach ($this->getSchema() as $meta) {
            $tableSummaries[] = [
                'table' => $meta['table'],
                'label' => $meta['label'],
                'count' => (int) $this->scalar('SELECT COUNT(*) FROM ' . $this->quoteIdentifier($meta['table'])),
                'primary_key' => $meta['primary_key'],
            ];
        }

        usort($tableSummaries, fn(array $a, array $b) => $b['count'] <=> $a['count']);

        return [
            'stats' => $stats,
            'tables' => $tableSummaries,
        ];
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

    public function getRecord(string $table, int $id): array
    {
        $meta = $this->requireTableMeta($table);
        $pk = $meta['primary_key'];
        $stmt = $this->conn->prepare('SELECT * FROM ' . $this->quoteIdentifier($table) . ' WHERE ' . $this->quoteIdentifier($pk) . ' = :id LIMIT 1');
        $stmt->execute([':id' => $id]);
        $row = $stmt->fetch();
        if (!$row) {
            throw new InvalidArgumentException('السجل المطلوب غير موجود.');
        }
        if (array_key_exists('password_hash', $row)) {
            $row['password_hash'] = '';
        }
        return $row;
    }

    public function saveRecord(string $table, array $record, ?int $id = null): array
    {
        $meta = $this->requireTableMeta($table);
        $pk = $meta['primary_key'];
        $columns = $meta['columns'];
        $isCreate = $id === null;

        $prepared = [];
        foreach ($columns as $columnName => $column) {
            if ($columnName === $pk && $column['auto_increment']) {
                continue;
            }
            if (!array_key_exists($columnName, $record)) {
                continue;
            }

            $value = $record[$columnName];
            if ($table === 'users' && $columnName === 'password_hash') {
                $value = trim((string) $value);
                if ($value === '') {
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
                if (!$column['nullable'] && !$column['has_default'] && !array_key_exists($columnName, $prepared)) {
                    throw new InvalidArgumentException('الحقل ' . ($column['label'] ?? $columnName) . ' مطلوب.');
                }
            }

            if (empty($prepared)) {
                throw new InvalidArgumentException('لا توجد بيانات صالحة للحفظ.');
            }

            $insertColumns = array_keys($prepared);
            $placeholders = array_map(fn(string $columnName) => ':' . $columnName, $insertColumns);
            $sql = 'INSERT INTO ' . $this->quoteIdentifier($table)
                . ' (' . implode(', ', array_map([$this, 'quoteIdentifier'], $insertColumns)) . ')'
                . ' VALUES (' . implode(', ', $placeholders) . ') RETURNING ' . $this->quoteIdentifier($pk);
            $stmt = $this->conn->prepare($sql);
            $stmt->execute($this->prefixParams($prepared));
            $newId = (int) $stmt->fetchColumn();
            return $this->getRecord($table, $newId);
        }

        if (!$this->recordExists($table, $pk, $id)) {
            throw new InvalidArgumentException('السجل المطلوب تعديله غير موجود.');
        }

        if (empty($prepared)) {
            return $this->getRecord($table, (int) $id);
        }

        $setClauses = [];
        foreach (array_keys($prepared) as $columnName) {
            $setClauses[] = $this->quoteIdentifier($columnName) . ' = :' . $columnName;
        }
        $sql = 'UPDATE ' . $this->quoteIdentifier($table)
            . ' SET ' . implode(', ', $setClauses)
            . ' WHERE ' . $this->quoteIdentifier($pk) . ' = :_id';
        $params = $this->prefixParams($prepared);
        $params[':_id'] = $id;
        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);
        return $this->getRecord($table, (int) $id);
    }

    public function deleteRecord(string $table, int $id): void
    {
        $meta = $this->requireTableMeta($table);
        $pk = $meta['primary_key'];
        if (!$this->recordExists($table, $pk, $id)) {
            throw new InvalidArgumentException('السجل المطلوب حذفه غير موجود.');
        }

        $stmt = $this->conn->prepare('DELETE FROM ' . $this->quoteIdentifier($table) . ' WHERE ' . $this->quoteIdentifier($pk) . ' = :id');
        $stmt->execute([':id' => $id]);
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

        $columnStmt = $this->conn->prepare("SELECT column_name, data_type, is_nullable, column_default, udt_name
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
                'auto_increment' => is_string($row['column_default']) && str_contains((string) $row['column_default'], 'nextval('),
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

    private function recordExists(string $table, string $pk, ?int $id): bool
    {
        if ($id === null) {
            return false;
        }
        $stmt = $this->conn->prepare('SELECT 1 FROM ' . $this->quoteIdentifier($table) . ' WHERE ' . $this->quoteIdentifier($pk) . ' = :id LIMIT 1');
        $stmt->execute([':id' => $id]);
        return (bool) $stmt->fetchColumn();
    }

    private function normalizeValue(array $column, mixed $value): mixed
    {
        if ($value === '' || $value === null) {
            return $column['nullable'] ? null : '';
        }

        if ($column['is_boolean']) {
            return filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) ?? false;
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

    private function isSystemManagedColumn(string $name, mixed $default): bool
    {
        if ($name === 'created_at') {
            return true;
        }
        return is_string($default) && str_contains($default, 'nextval(');
    }
}
