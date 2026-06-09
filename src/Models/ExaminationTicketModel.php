<?php
declare(strict_types=1);

/**
 * ExaminationTicketModel
 * ----------------------
 * نظام تذاكر المعاينة - نسخة المرحلة الثانية:
 *   • التذكرة تُصدر تلقائياً عند فتح الزيارة (لا يصدرها الطبيب يدوياً).
 *   • نوع التذكرة (morning/evening) ومبلغها يُحددان آلياً من SettingsService.
 *   • تسلسل التذاكر مُدار عبر جدول document_types (doc_name = 'T') مع قفل صف
 *     لمنع تضارب التسلسلات تحت الحمل المتوازي.
 *   • قيد UNIQUE على visit_id يضمن تذكرة واحدة فقط لكل زيارة.
 */
class ExaminationTicketModel
{
    private PDO $conn;
    private string $driver;
    private SettingsService $settings;

    public function __construct(PDO $db, string $driver = 'pgsql')
    {
        $this->conn = $db;
        $this->driver = $driver;
        $this->settings = new SettingsService($db);
    }

    /**
     * إنشاء تذكرة معاينة تلقائياً للزيارة المعطاة.
     * يفترض أن المتصل يدير transaction خارجي إن أراد دمجها مع
     * عمليات أخرى (مثل createVisit). إن لم يكن هناك transaction
     * نشط، نفتح واحداً محلياً.
     *
     * @return array{ticket_id:int, serial_number:int, ticket_type:string, amount:float}
     */
    public function autoIssue(int $visitId, ?string $notes = null): array
    {
        $resolved = $this->resolveTicketTypeAndAmountForVisit($visitId);
        $ticketType = $resolved['type'];
        $amount     = $resolved['amount'];
        $notesValue = $notes !== null ? trim($notes) : '';

        // 🔧 Migration 014: لم يعد فتح الزيارة/إصدار التذكرة يتأثر
        // بقيد إقفال/ترتيب الفترات. القيد الصحيح نُقل إلى موضعه
        // الطبيعي عند تسديد الفاتورة داخل AccountingModel::processPayment.

        $manageTx = !$this->conn->inTransaction();
        if ($manageTx) {
            $this->conn->beginTransaction();
        }

        try {
            // 1) قفل عداد التسلسل
            $lockStmt = $this->conn->prepare(
                "SELECT doc_type_id, current_serial FROM document_types WHERE doc_name = 'T' FOR UPDATE"
            );
            $lockStmt->execute();
            $serialDoc = $lockStmt->fetch();

            if (!$serialDoc) {
                throw new RuntimeException('لم يتم العثور على نوع المستند T (تذاكر) في جدول document_types.');
            }

            // 2) MAX حقيقي لتعويض أي انحراف
            $maxStmt = $this->conn->prepare('SELECT COALESCE(MAX(serial_number), 0) FROM examination_tickets');
            $maxStmt->execute();
            $actualMax = (int) $maxStmt->fetchColumn();

            $baseSerial = max((int) $serialDoc['current_serial'], $actualMax);
            $newSerial  = $baseSerial + 1;

            // 3) تحديث العداد
            $this->conn->prepare('UPDATE document_types SET current_serial = ? WHERE doc_type_id = ?')
                ->execute([$newSerial, $serialDoc['doc_type_id']]);

            // 4) إدراج التذكرة
            $sql = "INSERT INTO examination_tickets (visit_id, serial_number, ticket_type, notes, amount)
                    VALUES (:visit_id, :serial, :type, :notes, :amount)";
            if ($this->driver === 'pgsql') {
                $sql .= ' RETURNING ticket_id';
            }
            $stmt = $this->conn->prepare($sql);
            $stmt->execute([
                ':visit_id' => $visitId,
                ':serial'   => $newSerial,
                ':type'     => $ticketType,
                ':notes'    => $notesValue,
                ':amount'   => $amount,
            ]);

            $ticketId = $this->driver === 'pgsql'
                ? (int) $stmt->fetchColumn()
                : (int) $this->conn->lastInsertId();

            if ($manageTx) {
                $this->conn->commit();
            }

            return [
                'ticket_id'     => $ticketId,
                'serial_number' => $newSerial,
                'ticket_type'   => $ticketType,
                'amount'        => $amount,
            ];
        } catch (\Throwable $e) {
            if ($manageTx && $this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            throw $e;
        }
    }

    /**
     * يربط التذكرة بنفس الفترة المحفوظة على الزيارة إن وُجدت.
     * هذا يمنع أي اختلاف بين visit.shift_id وبين ticket_type في حالات ما بعد منتصف الليل.
     *
     * @return array{type:string, amount:float}
     */
    private function resolveTicketTypeAndAmountForVisit(int $visitId): array
    {
        $stmt = $this->conn->prepare(
            "SELECT s.shift_type
             FROM visits v
             LEFT JOIN shifts s ON s.shift_id = v.shift_id
             WHERE v.visit_id = :vid
             LIMIT 1"
        );
        $stmt->execute([':vid' => $visitId]);
        $shiftType = (string) ($stmt->fetchColumn() ?: '');

        if ($shiftType === 'morning') {
            return ['type' => 'morning', 'amount' => $this->settings->getMorningPrice()];
        }
        if ($shiftType === 'evening') {
            return ['type' => 'evening', 'amount' => $this->settings->getEveningPrice()];
        }

        return $this->settings->resolveTicketTypeAndAmount();
    }

    public function getByVisitId(int $visitId): ?array
    {
        $stmt = $this->conn->prepare('SELECT * FROM examination_tickets WHERE visit_id = :vid LIMIT 1');
        $stmt->execute([':vid' => $visitId]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function hasTicket(int $visitId): bool
    {
        $stmt = $this->conn->prepare('SELECT 1 FROM examination_tickets WHERE visit_id = :vid LIMIT 1');
        $stmt->execute([':vid' => $visitId]);
        return (bool) $stmt->fetchColumn();
    }

    /**
     * ⚠️ Deprecated بعد Migration 014.
     * أُبقيت الدالة لأغراض تشخيصية فقط ولم تعد تُستخدم لمنع
     * فتح الزيارة. منطق الترتيب أصبح على مستوى تسديد الفواتير.
     */
    public function hasOpenShiftBefore(string $shiftType): bool
    {
        // جلسة قاعدة البيانات مضبوطة على APP_TIMEZONE (راجع Database::getConnection)
        // لذلك DATE(created_at) و CURRENT_DATE يعملان بالتوقيت المحلي للمركز.
        $sql = $this->driver === 'pgsql'
            ? "SELECT 1 FROM examination_tickets
                  WHERE ticket_type = :shift_type
                    AND shift_closure_id IS NULL
                    AND DATE(created_at) = CURRENT_DATE - INTERVAL '1 day'
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
}
