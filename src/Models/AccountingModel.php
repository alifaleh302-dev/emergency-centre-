<?php
declare(strict_types=1);

class AccountingModel
{
    private PDO $conn;
    private string $driver;

    public function __construct(PDO $db, string $driver = 'pgsql')
    {
        $this->conn = $db;
        $this->driver = $driver;
    }

    private function activeInvoiceCondition(string $alias = 'i'): string
    {
        return "{$alias}.cancelled_at IS NULL
            AND (
                {$alias}.related_invoice_id IS NULL
                OR NOT EXISTS (
                    SELECT 1
                    FROM invoices rel
                    WHERE rel.invoice_id = {$alias}.related_invoice_id
                      AND rel.cancelled_at IS NOT NULL
                )
            )";
    }

    public function getPendingInvoices(): array
    {
        $sql = "SELECT i.invoice_id, p.full_name AS name, i.total AS sum,
                       {$this->formatTime('i.created_at')} AS time
                FROM Invoices i
                JOIN Visits v ON i.visit_id = v.visit_id
                JOIN Patients p ON v.patient_id = p.patient_id
                WHERE i.doc_type_id IS NULL AND i.accountant_id IS NULL
                ORDER BY i.created_at ASC";
        $stmt = $this->conn->query($sql);
        return $stmt->fetchAll();
    }

    public function getPendingInvoiceById(int $invoiceId): ?array
    {
        $stmt = $this->conn->prepare('SELECT invoice_id, total FROM Invoices WHERE invoice_id = :invoice_id AND doc_type_id IS NULL AND accountant_id IS NULL LIMIT 1');
        $stmt->execute([':invoice_id' => $invoiceId]);
        $invoice = $stmt->fetch();

        return $invoice ?: null;
    }

    public function getInvoiceDetails(int $invoiceId): array
    {
        $sql = "SELECT sm.service_name           AS name,
                       id.service_price_at_time  AS price,
                       id.quantity               AS quantity,
                       sm.ministry_share         AS ministry_share_master,
                       id.ministry_share_at_time AS ministry_share
                FROM Invoice_Details id
                JOIN Services_Master sm ON id.service_id = sm.service_id
                WHERE id.invoice_id = :invoice_id";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute([':invoice_id' => $invoiceId]);
        return $stmt->fetchAll();
    }

    public function getNextSerials(): array
    {
        // A = كاش، B = إعفاء (يشمل الجزئي والكلي)
        $stmt = $this->conn->query("SELECT doc_name, current_serial + 1 AS next_serial FROM Document_Types WHERE doc_name IN ('A','B') ORDER BY doc_type_id ASC");
        return $stmt->fetchAll();
    }

    /**
     * يعالج عملية السداد ويعيد مصفوفة بأرقام السندات المُولّدة:
     *   - دفع كامل (A): يعيد ['A' => serial]
     *   - إعفاء كلي  (C): يعيد ['C' => serial]
     *   - إعفاء جزئي (B): يُنشئ سندين مترابطين بعلاقة قوية (FK)
     *      ويعيد ['A' => cashSerial, 'B' => exemptSerial]
     *
     * العلاقة القوية (Strong Relationship) في حالة الإعفاء الجزئي:
     *      يتم تخزين invoice_id لسند الكاش (A) داخل عمود
     *      related_invoice_id لسند الإعفاء (B) والعكس، مع إجبار
     *      مستوى قاعدة البيانات (ON DELETE CASCADE) ليُعامل السندان
     *      كعملية مالية واحدة في التقارير والحسابات.
     */
    public function processPayment(int $invoiceId, float $netAmount, float $exemptionValue, string $docTypeName, int $accountantId): array
    {
        try {
            $this->conn->beginTransaction();

            // جلب معرفات أنواع السندات دفعة واحدة
            $allDocsStmt = $this->conn->query("SELECT doc_type_id, doc_name FROM Document_Types WHERE doc_name IN ('A','B','C')");
            $allDocs = [];
            foreach ($allDocsStmt->fetchAll() as $row) {
                $allDocs[$row['doc_name']] = (int) $row['doc_type_id'];
            }

            if (!isset($allDocs[$docTypeName])) {
                throw new InvalidArgumentException('نوع السند المطلوب غير موجود في قاعدة البيانات.');
            }

            // جلب الفاتورة المعلقة (للتأكد من إجماليها وvisit_id)
            $pendStmt = $this->conn->prepare('SELECT invoice_id, visit_id, total FROM Invoices WHERE invoice_id = :id LIMIT 1');
            $pendStmt->execute([':id' => $invoiceId]);
            $pending = $pendStmt->fetch();
            if (!$pending) {
                throw new InvalidArgumentException('الفاتورة المطلوبة غير موجودة.');
            }
            $visitId = (int) $pending['visit_id'];
            $invoiceTotal = round((float) $pending['total'], 2);

            // =================================================================
            // حالة الدفع الكامل (A) أو الإعفاء الكلي (C) — سند واحد
            // =================================================================
            if ($docTypeName === 'A' || $docTypeName === 'C') {
                // سندات الإعفاء (B و C) تشترك بنفس تسلسل B
                $serialDocName = ($docTypeName === 'C') ? 'B' : 'A';
                $newSerial = $this->allocateSerial($serialDocName, ($docTypeName === 'C') ? [$allDocs['B'], $allDocs['C']] : [$allDocs['A']]);

                $updateInvoiceSql = "UPDATE Invoices SET
                                        total            = :total,
                                        net_amount       = :net_amount,
                                        exemption_value  = :exemption_value,
                                        doc_type_id      = :doc_type_id,
                                        serial_number    = :serial_number,
                                        accountant_id    = :accountant_id,
                                        paid_at          = NOW()
                                     WHERE invoice_id = :invoice_id";
                $stmt = $this->conn->prepare($updateInvoiceSql);
                $stmt->execute([
                    ':total'           => $invoiceTotal,
                    ':net_amount'      => $netAmount,
                    ':exemption_value' => $exemptionValue,
                    ':doc_type_id'     => $allDocs[$docTypeName],
                    ':serial_number'   => $newSerial,
                    ':accountant_id'   => $accountantId,
                    ':invoice_id'      => $invoiceId,
                ]);

                // -----------------------------------------------------------
                // حصة الوزارة لكل خدمة (Ministry Share per Service)
                // تُحسب وتُخزَّن فقط عندما يكون السند من نوع A (كاش كامل).
                // المصدر: services_master.ministry_share × invoice_details.quantity
                // سندات C (الإعفاء الكلي) لا تستحق فيها الوزارة شيئاً، فنُبقي 0.
                // -----------------------------------------------------------
                if ($docTypeName === 'A') {
                    $this->applyMinistryShare($invoiceId);
                }

                $this->conn->commit();
                return [$docTypeName => $newSerial];
            }

            // =================================================================
            // حالة الإعفاء الجزئي (B) — سندان مترابطان (A + B)
            //   1) سند A: يلتقط المبلغ المدفوع نقداً (Cash)
            //   2) سند B: يلتقط المبلغ المعفي (Exempted)
            //   يتم ربطهما بعلاقة قوية عبر related_invoice_id
            // =================================================================
            // تخصيص رقم تسلسلي لسند الكاش
            $serialA = $this->allocateSerial('A', [$allDocs['A']]);
            // تخصيص رقم تسلسلي لسند الإعفاء (مشترك مع C)
            $serialB = $this->allocateSerial('B', [$allDocs['B'], $allDocs['C']]);

            // (1) تحديث الفاتورة الأصلية لتصبح سند الكاش (A):
            //     total = المبلغ المدفوع فقط
            //     net   = المدفوع، exemption = 0
            $updateA = $this->conn->prepare("UPDATE Invoices SET
                                                total           = :total,
                                                net_amount      = :net_amount,
                                                exemption_value = 0,
                                                doc_type_id     = :doc_type_id,
                                                serial_number   = :serial_number,
                                                accountant_id   = :accountant_id,
                                                paid_at         = NOW()
                                             WHERE invoice_id = :invoice_id");
            $updateA->execute([
                ':total'         => $netAmount,
                ':net_amount'    => $netAmount,
                ':doc_type_id'   => $allDocs['A'],
                ':serial_number' => $serialA,
                ':accountant_id' => $accountantId,
                ':invoice_id'    => $invoiceId,
            ]);

            // (2) إدراج سند B جديد يرتبط بسند A عبر related_invoice_id
            $insertB = $this->conn->prepare("INSERT INTO Invoices
                            (serial_number, doc_type_id, visit_id, total, exemption_value, net_amount,
                             accountant_id, paid_at, related_invoice_id)
                         VALUES
                            (:serial_number, :doc_type_id, :visit_id, :total, :exemption_value, 0,
                             :accountant_id, NOW(), :related_invoice_id)");
            $insertB->execute([
                ':serial_number'      => $serialB,
                ':doc_type_id'        => $allDocs['B'],
                ':visit_id'           => $visitId,
                ':total'              => $exemptionValue,
                ':exemption_value'    => $exemptionValue,
                ':accountant_id'      => $accountantId,
                ':related_invoice_id' => $invoiceId,
            ]);
            $invoiceBId = (int) $this->insertedIdFromLastStmt('invoice_id');

            // (3) تحديث سند A ليرتبط أيضاً بسند B (رابط ثنائي الاتجاه)
            $linkAtoB = $this->conn->prepare('UPDATE Invoices SET related_invoice_id = :rid WHERE invoice_id = :id');
            $linkAtoB->execute([':rid' => $invoiceBId, ':id' => $invoiceId]);

            // -----------------------------------------------------------
            // حصة الوزارة لكل خدمة في حالة الإعفاء الجزئي:
            //   تُخزَّن على تفاصيل سند A الأصلية فقط (التي تحمل قائمة الخدمات).
            //   سند B الجديد لا يملك صفوف invoice_details فلا يحتاج معالجة.
            //   حصة الوزارة ثابتة لكل خدمة بحسب services_master ولا تتأثر
            //   بانخفاض total على سند A الناتج عن الإعفاء.
            // -----------------------------------------------------------
            $this->applyMinistryShare($invoiceId);

            $this->conn->commit();
            return [
                'A' => $serialA,
                'B' => $serialB,
                'invoice_id_A' => $invoiceId,
                'invoice_id_B' => $invoiceBId,
            ];
        } catch (Throwable $exception) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            throw $exception;
        }
    }

    /**
     * يخصص رقماً تسلسلياً جديداً لنوع سند ويحدّث عداد document_types
     * مع حماية من التسابق عبر SELECT ... FOR UPDATE + MAX().
     *
     * @param string $serialDocName السجل الذي يحمل العداد (A أو B)
     * @param int[]  $matchingDocTypeIds أنواع السندات المشتركة في العداد (مثلاً B+C)
     */
    /**
     * يحدّث ministry_share_at_time لكل سطر في invoice_details تابع
     * للفاتورة المحددة عبر جلب القيمة من services_master.ministry_share
     * وضربها بـ quantity.
     *
     * تُستدعى فقط عندما يصير السند من نوع A (كاش أو جزئي-A).
     */
    private function applyMinistryShare(int $invoiceId): void
    {
        $sql = "UPDATE Invoice_Details id
                SET ministry_share_at_time = sm.ministry_share * id.quantity
                FROM Services_Master sm
                WHERE id.service_id = sm.service_id
                  AND id.invoice_id = :invoice_id";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute([':invoice_id' => $invoiceId]);
    }

    private function allocateSerial(string $serialDocName, array $matchingDocTypeIds): int
    {
        $lockStmt = $this->conn->prepare('SELECT doc_type_id, current_serial FROM Document_Types WHERE doc_name = :serial_doc FOR UPDATE');
        $lockStmt->execute([':serial_doc' => $serialDocName]);
        $serialDoc = $lockStmt->fetch();
        if (!$serialDoc) {
            throw new InvalidArgumentException('سجل التسلسل ' . $serialDocName . ' غير موجود.');
        }
        $serialDocTypeId = (int) $serialDoc['doc_type_id'];

        $placeholders = implode(',', array_fill(0, count($matchingDocTypeIds), '?'));
        $maxStmt = $this->conn->prepare("SELECT COALESCE(MAX(serial_number), 0) FROM Invoices WHERE doc_type_id IN ($placeholders)");
        $maxStmt->execute($matchingDocTypeIds);
        $actualMax = (int) $maxStmt->fetchColumn();

        $newSerial = max((int) $serialDoc['current_serial'], $actualMax) + 1;

        $updateSerialStmt = $this->conn->prepare('UPDATE Document_Types SET current_serial = :current_serial WHERE doc_type_id = :doc_type_id');
        $updateSerialStmt->execute([
            ':current_serial' => $newSerial,
            ':doc_type_id'    => $serialDocTypeId,
        ]);

        return $newSerial;
    }

    /**
     * يعيد آخر معرف تم إدراجه (متوافق مع PostgreSQL و MySQL).
     */
    private function insertedIdFromLastStmt(string $column = 'id'): int
    {
        if ($this->driver === 'pgsql') {
            // في PostgreSQL: lastInsertId() يحتاج sequence name. بديل آمن:
            // نستعلم الفاتورة الأحدث لمحاسب حالي في نفس الثواني (لأننا داخل معاملة).
            // أفضل منها: جرّب lastInsertId('invoices_invoice_id_seq')
            try {
                return (int) $this->conn->lastInsertId('invoices_invoice_id_seq');
            } catch (Throwable $e) {
                $row = $this->conn->query('SELECT MAX(invoice_id) FROM invoices')->fetchColumn();
                return (int) $row;
            }
        }
        return (int) $this->conn->lastInsertId();
    }

    public function getDailyReceipts(): array
    {
        $timestamp = $this->paymentTimestamp('i');
        $sql = "SELECT i.invoice_id, p.full_name AS name, i.net_amount, i.exemption_value, i.total,
                       i.serial_number, i.related_invoice_id,
                       {$this->formatTime($timestamp)} AS time,
                       dt.doc_name, u.full_name AS cashier
                FROM Invoices i
                JOIN Visits v ON i.visit_id = v.visit_id
                JOIN Patients p ON v.patient_id = p.patient_id
                JOIN Document_Types dt ON i.doc_type_id = dt.doc_type_id
                JOIN Users u ON i.accountant_id = u.user_id
                WHERE i.accountant_id IS NOT NULL
                  AND {$this->activeInvoiceCondition('i')}
                  AND {$timestamp} >= {$this->todayStart()}
                ORDER BY {$timestamp} DESC";
        $stmt = $this->conn->query($sql);
        return $stmt->fetchAll();
    }

    public function getRevenuesByYears(): array
    {
        $timestamp = $this->paymentTimestamp();
        $sql = "SELECT {$this->yearExpression($timestamp)} AS year_val,
                       SUM(net_amount) AS total_paid,
                       SUM(exemption_value) AS total_exempt,
                       SUM(CASE WHEN doc_type_id = 1 THEN 1 ELSE 0 END) AS count_cash,
                       SUM(CASE WHEN doc_type_id = 2 THEN 1 ELSE 0 END) AS count_partial,
                       SUM(CASE WHEN doc_type_id = 3 THEN 1 ELSE 0 END) AS count_full
                FROM Invoices i
                WHERE i.doc_type_id IS NOT NULL AND {$this->activeInvoiceCondition('i')} AND {$timestamp} IS NOT NULL
                GROUP BY year_val
                ORDER BY year_val DESC";
        $stmt = $this->conn->query($sql);
        return $stmt->fetchAll();
    }

    public function getRevenuesByMonths(string $year): array
    {
        $timestamp = $this->paymentTimestamp();
        $sql = "SELECT {$this->monthExpression($timestamp)} AS month_val,
                       SUM(net_amount) AS total_paid,
                       SUM(exemption_value) AS total_exempt,
                       SUM(CASE WHEN doc_type_id = 1 THEN 1 ELSE 0 END) AS count_cash,
                       SUM(CASE WHEN doc_type_id = 2 THEN 1 ELSE 0 END) AS count_partial,
                       SUM(CASE WHEN doc_type_id = 3 THEN 1 ELSE 0 END) AS count_full
                FROM Invoices i
                WHERE i.doc_type_id IS NOT NULL AND {$this->activeInvoiceCondition('i')} AND {$this->yearExpression($timestamp)} = :year
                GROUP BY month_val
                ORDER BY month_val DESC";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute([':year' => $year]);
        return $stmt->fetchAll();
    }

    public function getRevenuesByDays(string $year, string $month): array
    {
        $timestamp = $this->paymentTimestamp();
        $sql = "SELECT {$this->dayExpression($timestamp)} AS day_val,
                       SUM(net_amount) AS total_paid,
                       SUM(exemption_value) AS total_exempt,
                       SUM(CASE WHEN doc_type_id = 1 THEN 1 ELSE 0 END) AS count_cash,
                       SUM(CASE WHEN doc_type_id = 2 THEN 1 ELSE 0 END) AS count_partial,
                       SUM(CASE WHEN doc_type_id = 3 THEN 1 ELSE 0 END) AS count_full
                FROM Invoices i
                WHERE i.doc_type_id IS NOT NULL AND {$this->activeInvoiceCondition('i')} AND {$this->yearMonthExpression($timestamp)} = :year_month
                GROUP BY day_val
                ORDER BY day_val DESC";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute([':year_month' => $year . '-' . str_pad($month, 2, '0', STR_PAD_LEFT)]);
        return $stmt->fetchAll();
    }

    public function searchOrGetDailyDetails(?string $date = null, ?string $query = null): array
    {
        $timestamp = $this->paymentTimestamp('i');
        $sql = "SELECT i.invoice_id, p.full_name AS name, i.net_amount, i.exemption_value,
                       {$this->formatDateTime($timestamp)} AS time,
                       dt.doc_name, i.serial_number, u.full_name AS cashier
                FROM Invoices i
                JOIN Visits v ON i.visit_id = v.visit_id
                JOIN Patients p ON v.patient_id = p.patient_id
                JOIN Document_Types dt ON i.doc_type_id = dt.doc_type_id
                JOIN Users u ON i.accountant_id = u.user_id
                WHERE i.doc_type_id IS NOT NULL
                  AND {$this->activeInvoiceCondition('i')}";
        $params = [];

        if ($date !== null && $date !== '') {
            $sql .= ' AND DATE(' . $timestamp . ') = :date';
            $params[':date'] = $date;
        }

        if ($query !== null && $query !== '') {
            $sql .= ' AND (' . $this->searchableLike('p.full_name', ':query')
                . ' OR ' . $this->castToString('i.invoice_id') . ' LIKE :query'
                . ' OR ' . $this->castToString('i.serial_number') . ' LIKE :query)';
            $params[':query'] = '%' . $query . '%';
        }

        $sql .= ' ORDER BY ' . $timestamp . ' DESC';

        if ($query !== null && $query !== '') {
            $sql .= ' LIMIT 100';
        }

        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    private function paymentTimestamp(string $alias = ''): string
    {
        $prefix = $alias !== '' ? $alias . '.' : '';
        return 'COALESCE(' . $prefix . 'paid_at, ' . $prefix . 'created_at)';
    }

    private function formatTime(string $column): string
    {
        return $this->driver === 'pgsql'
            ? "TO_CHAR({$column}, 'HH12:MI AM')"
            : "DATE_FORMAT({$column}, '%h:%i %p')";
    }

    private function formatDateTime(string $column): string
    {
        return $this->driver === 'pgsql'
            ? "TO_CHAR({$column}, 'YYYY-MM-DD HH12:MI AM')"
            : "DATE_FORMAT({$column}, '%Y-%m-%d %h:%i %p')";
    }

    private function todayStart(): string
    {
        return $this->driver === 'pgsql'
            ? "CURRENT_DATE"
            : 'CURDATE()';
    }

    private function yearExpression(string $column): string
    {
        return $this->driver === 'pgsql'
            ? "TO_CHAR({$column}, 'YYYY')"
            : "DATE_FORMAT({$column}, '%Y')";
    }

    private function monthExpression(string $column): string
    {
        return $this->driver === 'pgsql'
            ? "TO_CHAR({$column}, 'MM')"
            : "DATE_FORMAT({$column}, '%m')";
    }

    private function dayExpression(string $column): string
    {
        return $this->driver === 'pgsql'
            ? "TO_CHAR({$column}, 'DD')"
            : "DATE_FORMAT({$column}, '%d')";
    }

    private function yearMonthExpression(string $column): string
    {
        return $this->driver === 'pgsql'
            ? "TO_CHAR({$column}, 'YYYY-MM')"
            : "DATE_FORMAT({$column}, '%Y-%m')";
    }

    private function castToString(string $column): string
    {
        return $this->driver === 'pgsql'
            ? 'CAST(' . $column . ' AS TEXT)'
            : 'CAST(' . $column . ' AS CHAR)';
    }

    private function searchableLike(string $column, string $parameter): string
    {
        if ($this->driver === 'pgsql') {
            return $column . ' ILIKE ' . $parameter;
        }

        return 'LOWER(' . $column . ') LIKE LOWER(' . $parameter . ')';
    }

    // =====================================================================
    // 🆕 واجهة "اليومية" + إقفال الفترة (Migration 012)
    // =====================================================================

    /**
     * جلب بيانات اليومية — السندات المدفوعة/المعفاة لتاريخ محدد،
     * مرتّبة بحيث تظهر سندات A (مدفوعة كلياً/جزئياً) أولاً، ثم سندات B/C (إعفاءات).
     *
     * @param string|null $date YYYY-MM-DD (الافتراضي: اليوم)
     * @param int|null    $departmentId فلتر اختياري برقم القسم
     */
    public function getDailyJournal(?string $date = null, ?int $departmentId = null): array
    {
        $params = [];
        $whereParts = [];
        $whereParts[] = 'i.accountant_id IS NOT NULL';
        $whereParts[] = $this->activeInvoiceCondition('i');

        $timestamp = $this->paymentTimestamp('i');

        if ($date !== null && $date !== '') {
            // فلترة بتاريخ محدد (PostgreSQL/MySQL compatible)
            $whereParts[] = ($this->driver === 'pgsql'
                ? "DATE({$timestamp} AT TIME ZONE 'UTC') = :journal_date"
                : "DATE({$timestamp}) = :journal_date");
            $params[':journal_date'] = $date;
        } else {
            $whereParts[] = "{$timestamp} >= {$this->todayStart()}";
        }

        if ($departmentId !== null && $departmentId > 0) {
            $whereParts[] = 'i.department_id = :dept_id';
            $params[':dept_id'] = $departmentId;
        }

        $whereClause = implode(' AND ', $whereParts);

        // ترتيب المجموعات:
        //   group_order = 0 -> A (مدفوع)
        //   group_order = 1 -> B/C (إعفاءات)
        $sql = "SELECT i.invoice_id,
                       i.serial_number,
                       dt.doc_name,
                       i.total,
                       i.exemption_value,
                       i.net_amount,
                       i.related_invoice_id,
                       i.department_id,
                       COALESCE(d.department_name, 'غير محدد') AS department_name,
                       COALESCE(d.department_code, '') AS department_code,
                       p.full_name AS patient_name,
                       u.full_name AS cashier,
                       {$this->formatTime($timestamp)} AS time,
                       CASE WHEN dt.doc_name = 'A' THEN 0 ELSE 1 END AS group_order
                FROM Invoices i
                JOIN Visits v          ON i.visit_id = v.visit_id
                JOIN Patients p        ON v.patient_id = p.patient_id
                JOIN Document_Types dt ON i.doc_type_id = dt.doc_type_id
                JOIN Users u           ON i.accountant_id = u.user_id
                LEFT JOIN departments d ON d.department_id = i.department_id
                WHERE {$whereClause}
                ORDER BY group_order ASC, i.serial_number ASC";

        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    /**
     * جلب تفاصيل خدمات سند محدد (يستخدم في Modal "التفاصيل")
     */
    public function getInvoiceServiceDetails(int $invoiceId): array
    {
        $sql = "SELECT id.detail_id, id.service_id, sm.service_name,
                       id.service_price_at_time AS price, id.quantity
                FROM invoice_details id
                JOIN services_master sm ON sm.service_id = id.service_id
                WHERE id.invoice_id = :inv_id
                ORDER BY id.detail_id ASC";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute([':inv_id' => $invoiceId]);
        return $stmt->fetchAll();
    }

    /**
     * جلب إجماليات التذاكر غير المُقفلة لفترة وتاريخ محددين.
     * يُستخدم لعرض الصف المدمج الخاص بإقفال الفترة داخل جدول اليومية.
     *
     * @param string $shiftType 'morning' | 'evening'
     * @param string|null $date YYYY-MM-DD (الافتراضي: اليوم)
     */
    public function getShiftTicketsSummary(string $shiftType, ?string $date = null): ?array
    {
        $params = [':shift_type' => $shiftType];
        $dateFilter = '';

        if ($date !== null && $date !== '') {
            $dateFilter = ($this->driver === 'pgsql'
                ? "AND DATE(created_at AT TIME ZONE 'UTC') = :shift_date"
                : "AND DATE(created_at) = :shift_date");
            $params[':shift_date'] = $date;
        } else {
            $dateFilter = ($this->driver === 'pgsql'
                ? "AND DATE(created_at AT TIME ZONE 'UTC') = CURRENT_DATE"
                : "AND DATE(created_at) = CURDATE()");
        }

        $sql = "SELECT MIN(serial_number) AS start_no,
                       MAX(serial_number) AS end_no,
                       COUNT(*) AS tickets_count,
                       COALESCE(SUM(amount), 0) AS total_amount
                FROM examination_tickets
                WHERE ticket_type = :shift_type
                  AND shift_closure_id IS NULL
                  {$dateFilter}";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);
        $row = $stmt->fetch();
        if (!$row || (int) $row['tickets_count'] === 0) {
            return null;
        }
        return $row;
    }

    /**
     * التحقق من وجود تذاكر في فترة الأمس فقط غير مُقفلة للنوع المحدد.
     * يُستخدم لمنع إصدار تذاكر جديدة قبل إقفال فترة الأمس.
     * (تذاكر أقدم من يومين تعتبر بيانات تاريخية)
     */
    public function hasOpenShiftBefore(string $shiftType): bool
    {
        $sql = $this->driver === 'pgsql'
            ? "SELECT 1 FROM examination_tickets
                  WHERE ticket_type = :shift_type
                    AND shift_closure_id IS NULL
                    AND DATE(created_at AT TIME ZONE 'UTC') = CURRENT_DATE - INTERVAL '1 day'
                  LIMIT 1"
            : "SELECT 1 FROM examination_tickets
                  WHERE ticket_type = :shift_type
                    AND shift_closure_id IS NULL
                    AND DATE(created_at) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)
                  LIMIT 1";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute([':shift_type' => $shiftType]);
        return (bool) $stmt->fetchColumn();
    }

    /**
     * جلب إعدادات حصص الوزارة للتذاكر من system_settings.
     */
    public function getTicketShareSettings(): array
    {
        $sql = "SELECT setting_key, setting_value
                FROM system_settings
                WHERE setting_key IN (
                    'ticket_price_morning',
                    'ticket_price_evening',
                    'ticket_ministry_share_morning',
                    'ticket_ministry_share_evening'
                )";
        $stmt = $this->conn->query($sql);
        $rows = $stmt->fetchAll();
        $out = [];
        foreach ($rows as $r) {
            $out[$r['setting_key']] = (float) $r['setting_value'];
        }
        return $out;
    }

    /**
     * تنفيذ عملية إقفال الفترة بشكل ذرّي (Atomic Transaction).
     *
     * الخطوات:
     *   1) جلب وقفل التذاكر غير المُقفلة (FOR UPDATE)
     *   2) حساب حصة المركز وحصة الوزارة
     *   3) إنشاء سجل في shifts_closures
     *   4) إنشاء سند A إجمالي واحد مرتبط بالإقفال
     *   5) ربط التذاكر بـ shift_closure_id
     *
     * @return array{closure_id:int, invoice_id:int, serial_number:int, total:float}
     */
    public function closeShift(string $shiftType, int $closedBy, ?string $date = null): array
    {
        if (!in_array($shiftType, ['morning', 'evening'], true)) {
            throw new InvalidArgumentException('نوع الفترة غير صالح (يجب أن يكون morning أو evening).');
        }
        $shiftDate = $date ?: date('Y-m-d');

        $this->conn->beginTransaction();
        try {
            // التحقق من عدم وجود إقفال سابق لنفس النوع والتاريخ
            $existsStmt = $this->conn->prepare(
                'SELECT id FROM shifts_closures WHERE shift_type = :st AND shift_date = :sd LIMIT 1'
            );
            $existsStmt->execute([':st' => $shiftType, ':sd' => $shiftDate]);
            if ($existsStmt->fetchColumn()) {
                throw new RuntimeException('الفترة الحالية مُقفلة بالفعل.');
            }

            // جلب التذاكر مع قفل الصف (لمنع إصدار تذاكر متوازية خلال الإقفال)
            $dateExpr = $this->driver === 'pgsql'
                ? "DATE(created_at AT TIME ZONE 'UTC')"
                : 'DATE(created_at)';
            $lockStmt = $this->conn->prepare(
                "SELECT ticket_id, serial_number, amount
                 FROM examination_tickets
                 WHERE ticket_type = :st
                   AND shift_closure_id IS NULL
                   AND {$dateExpr} = :sd
                 ORDER BY serial_number ASC
                 FOR UPDATE"
            );
            $lockStmt->execute([':st' => $shiftType, ':sd' => $shiftDate]);
            $tickets = $lockStmt->fetchAll();

            if (empty($tickets)) {
                throw new RuntimeException('لا توجد تذاكر في الفترة المحددة لإقفالها.');
            }

            $serials = array_map(static fn ($t) => (int) $t['serial_number'], $tickets);
            $totalAmount = array_sum(array_map(static fn ($t) => (float) $t['amount'], $tickets));
            $startNo = min($serials);
            $endNo   = max($serials);
            $count   = count($tickets);

            // حساب حصة الوزارة وحصة المركز
            $settings = $this->getTicketShareSettings();
            $ministryPerTicket = $shiftType === 'morning'
                ? (float) ($settings['ticket_ministry_share_morning'] ?? 0.0)
                : (float) ($settings['ticket_ministry_share_evening'] ?? 0.0);
            $ministryShare = round($ministryPerTicket * $count, 2);
            $centerShare = round($totalAmount - $ministryShare, 2);
            if ($centerShare < 0) {
                $centerShare = 0.0;
            }

            // إنشاء سجل الإقفال أولاً (بدون closing_invoice_id)
            $insertClosure = $this->conn->prepare(
                "INSERT INTO shifts_closures (shift_type, shift_date, start_ticket_no, end_ticket_no,
                                              tickets_count, center_share, ministry_share, total_amount,
                                              closed_by, status)
                 VALUES (:st, :sd, :start, :end, :cnt, :cs, :ms, :total, :uid, 'locked')"
            );
            $insertClosure->execute([
                ':st' => $shiftType, ':sd' => $shiftDate,
                ':start' => $startNo, ':end' => $endNo, ':cnt' => $count,
                ':cs' => $centerShare, ':ms' => $ministryShare, ':total' => $totalAmount,
                ':uid' => $closedBy,
            ]);
            $closureId = (int) $this->insertedIdFromLastStmt('id');
            if ($closureId <= 0 && $this->driver === 'pgsql') {
                $closureId = (int) $this->conn->lastInsertId('shifts_closures_id_seq');
            }

            // إنشاء سند A إجمالي مرتبط بالإقفال
            //   - لا visit_id (لأنه سند تجميعي لفترة وليس لزيارة واحدة)
            //   - doc_type = 'A' (تحصيل)
            $docStmt = $this->conn->prepare("SELECT doc_type_id FROM document_types WHERE doc_name = 'A' LIMIT 1");
            $docStmt->execute();
            $docTypeIdA = (int) $docStmt->fetchColumn();
            if ($docTypeIdA <= 0) {
                throw new RuntimeException('لم يتم العثور على نوع السند A.');
            }

            $newSerial = $this->allocateSerial('A', [$docTypeIdA]);

            $insertInvoice = $this->conn->prepare(
                "INSERT INTO invoices (serial_number, doc_type_id, visit_id, total, exemption_value,
                                       net_amount, accountant_id, paid_at, shift_closure_id)
                 VALUES (:sn, :dt, NULL, :total, 0, :total, :uid, NOW(), :cid)"
            );
            $insertInvoice->execute([
                ':sn'    => $newSerial,
                ':dt'    => $docTypeIdA,
                ':total' => $totalAmount,
                ':uid'   => $closedBy,
                ':cid'   => $closureId,
            ]);
            $newInvoiceId = (int) $this->insertedIdFromLastStmt('invoice_id');
            if ($newInvoiceId <= 0 && $this->driver === 'pgsql') {
                $newInvoiceId = (int) $this->conn->lastInsertId('invoices_invoice_id_seq');
            }

            // تحديث سجل الإقفال ليربط بسند التحصيل
            $this->conn->prepare('UPDATE shifts_closures SET closing_invoice_id = :iid WHERE id = :cid')
                ->execute([':iid' => $newInvoiceId, ':cid' => $closureId]);

            // ربط التذاكر بالإقفال
            $ticketIds = array_map(static fn ($t) => (int) $t['ticket_id'], $tickets);
            $placeholders = implode(',', array_fill(0, count($ticketIds), '?'));
            $updateTickets = $this->conn->prepare(
                "UPDATE examination_tickets SET shift_closure_id = ? WHERE ticket_id IN ($placeholders)"
            );
            $updateTickets->execute(array_merge([$closureId], $ticketIds));

            $this->conn->commit();

            return [
                'closure_id'     => $closureId,
                'invoice_id'     => $newInvoiceId,
                'serial_number'  => $newSerial,
                'total_amount'   => $totalAmount,
                'center_share'   => $centerShare,
                'ministry_share' => $ministryShare,
                'tickets_count'  => $count,
                'start_no'       => $startNo,
                'end_no'         => $endNo,
            ];
        } catch (Throwable $e) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            throw $e;
        }
    }

    /**
     * جلب جميع إقفالات يوم محدد (لعرض الصفوف المدمجة في اليومية)
     */
    public function getShiftClosuresForDate(?string $date = null): array
    {
        $sd = $date ?: date('Y-m-d');
        $sql = "SELECT sc.*, i.serial_number AS closing_serial,
                       u.full_name AS closed_by_name
                FROM shifts_closures sc
                LEFT JOIN invoices i ON i.invoice_id = sc.closing_invoice_id
                LEFT JOIN users u    ON u.user_id    = sc.closed_by
                WHERE sc.shift_date = :sd
                ORDER BY sc.shift_type ASC, sc.closed_at ASC";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute([':sd' => $sd]);
        return $stmt->fetchAll();
    }
}
