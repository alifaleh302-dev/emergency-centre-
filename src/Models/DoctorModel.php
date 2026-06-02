<?php
declare(strict_types=1);

class DoctorModel
{
    private PDO $conn;
    private string $driver;

    public function __construct(PDO $db, string $driver = 'pgsql')
    {
        $this->conn = $db;
        $this->driver = $driver;
    }

    public function searchPatient(string $queryStr): array
    {
        $keywords = preg_split('/\s+/', trim($queryStr));
        // 🔎 نجلب أيضاً معلومة وجود زيارة نشطة للمريض (active_visit_id) لتعرض الواجهة حالة واضحة
        // تمنع الطبيب من محاولة فتح زيارة جديدة لمريض لديه زيارة لم تغلق بعد.
        $sql = "SELECT p.patient_id, p.full_name, p.place1, p.place2,
                       (SELECT COUNT(*) FROM Visits v WHERE v.patient_id = p.patient_id AND v.status = 'Completed') AS visit_num,
                       (SELECT v2.visit_id FROM Visits v2 WHERE v2.patient_id = p.patient_id AND v2.status = 'Active' LIMIT 1) AS active_visit_id,
                       (SELECT u.full_name FROM Visits v3 JOIN users u ON u.user_id = v3.doctor_id
                          WHERE v3.patient_id = p.patient_id AND v3.status = 'Active' LIMIT 1) AS active_visit_doctor
                FROM Patients p
                WHERE 1 = 1";
        $params = [];

        foreach ($keywords as $index => $word) {
            if ($word !== '') {
                $paramName = ':word' . $index;
                $sql .= ' AND ' . $this->caseInsensitiveLike('p.full_name', $paramName);
                $params[$paramName] = '%' . $word . '%';
            }
        }

        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll();

        // تطبيع الأعمدة لتأكيد وجود علم واضح has_active_visit
        foreach ($rows as &$row) {
            $row['has_active_visit'] = !empty($row['active_visit_id']);
            $row['active_visit_id']  = $row['active_visit_id'] !== null ? (int) $row['active_visit_id'] : null;
        }
        unset($row);
        return $rows;
    }

    public function createPatient(string $name, string $gender, string $birthDate, string $place1, string $place2): int
    {
        $sql = "INSERT INTO Patients (full_name, gender, birth_date, place1, place2)
                VALUES (:name, :gender, :birth_date, :place1, :place2)";

        return $this->insertAndGetId($sql, [
            ':name' => $name,
            ':gender' => $gender,
            ':birth_date' => $birthDate,
            ':place1' => $place1,
            ':place2' => $place2,
        ], 'patient_id');
    }

    public function patientExists(int $patientId): bool
    {
        $stmt = $this->conn->prepare('SELECT patient_id FROM Patients WHERE patient_id = :patient_id LIMIT 1');
        $stmt->execute([':patient_id' => $patientId]);
        return (bool) $stmt->fetchColumn();
    }

    /**
     * يتحقق ما إذا كان لدى المريض زيارة نشطة (مفتوحة) حالياً.
     * يدعم قيد uq_visits_one_active_per_patient على مستوى التطبيق
     * بإعطاء رسالة عربية واضحة قبل الوصول إلى محرك قاعدة البيانات.
     */
    public function hasActiveVisit(int $patientId): bool
    {
        $stmt = $this->conn->prepare(
            "SELECT visit_id FROM Visits WHERE patient_id = :pid AND status = 'Active' LIMIT 1"
        );
        $stmt->execute([':pid' => $patientId]);
        return (bool) $stmt->fetchColumn();
    }

    public function getActiveVisitIdForPatient(int $patientId): ?int
    {
        $stmt = $this->conn->prepare(
            "SELECT visit_id FROM Visits WHERE patient_id = :pid AND status = 'Active' LIMIT 1"
        );
        $stmt->execute([':pid' => $patientId]);
        $id = $stmt->fetchColumn();
        return $id === false ? null : (int) $id;
    }

    public function visitExists(int $visitId): bool
    {
        $stmt = $this->conn->prepare('SELECT visit_id FROM Visits WHERE visit_id = :visit_id LIMIT 1');
        $stmt->execute([':visit_id' => $visitId]);
        return (bool) $stmt->fetchColumn();
    }

    public function visitBelongsToDoctor(int $visitId, int $doctorId): bool
    {
        $stmt = $this->conn->prepare('SELECT visit_id FROM Visits WHERE visit_id = :visit_id AND doctor_id = :doctor_id LIMIT 1');
        $stmt->execute([
            ':visit_id' => $visitId,
            ':doctor_id' => $doctorId,
        ]);

        return (bool) $stmt->fetchColumn();
    }

    public function getCaseTypeId(string $caseName): ?int
    {
        $stmt = $this->conn->prepare('SELECT case_type_id FROM Emergency_Case_Types WHERE case_name = :case_name LIMIT 1');
        $stmt->execute([':case_name' => $caseName]);
        $row = $stmt->fetch();

        return $row ? (int) $row['case_type_id'] : null;
    }

    public function createVisit(int $patientId, int $doctorId, int $caseTypeId, string $diagnosis, string $notes, string $typeCaseName): int
    {
        $sql = "INSERT INTO Visits (patient_id, doctor_id, case_type_id, type_case, diagnosis, notes, status)
                VALUES (:patient_id, :doctor_id, :case_type_id, :type_case, :diagnosis, :notes, 'Active')";

        return $this->insertAndGetId($sql, [
            ':patient_id' => $patientId,
            ':doctor_id' => $doctorId,
            ':case_type_id' => $caseTypeId,
            ':type_case' => $typeCaseName,
            ':diagnosis' => $diagnosis,
            ':notes' => $notes,
        ], 'visit_id');
    }

    public function getWaitingList(int $doctorId): array
    {
        $sql = "SELECT v.visit_id AS visit, p.patient_id, p.full_name AS name, v.type_case,
                       {$this->formatTime('v.created_at')} AS time,
                       v.diagnosis,
                       et.serial_number AS ticket_serial,
                       et.ticket_type
                FROM Visits v
                JOIN Patients p ON v.patient_id = p.patient_id
                LEFT JOIN Examination_Tickets et ON et.visit_id = v.visit_id
                WHERE v.doctor_id = :doctor_id AND v.status = 'Active'
                ORDER BY v.created_at ASC";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute([':doctor_id' => $doctorId]);
        return $stmt->fetchAll();
    }

    public function createPendingInvoice(int $visitId): int
    {
        // الفاتورة المعلقة لا تملك سنداً محاسبياً نهائياً بعد، لكن المخطط الحالي
        // يفرض serial_number موجباً وغير صفري. لذلك نولّد رقماً مؤقتاً موجباً
        // لحين السداد، ثم يتم استبداله بالرقم الرسمي داخل AccountingModel::processPayment.
        $sql = "INSERT INTO Invoices (serial_number, visit_id, total, exemption_value, net_amount)
                SELECT COALESCE(MAX(serial_number), 0) + 1, :visit_id, 0, 0, 0
                FROM Invoices";

        return $this->insertAndGetId($sql, [':visit_id' => $visitId], 'invoice_id');
    }

    public function addInvoiceDetail(int $invoiceId, int $serviceId, float $price): bool
    {
        $sql = "INSERT INTO Invoice_Details (invoice_id, service_id, service_price_at_time)
                VALUES (:invoice_id, :service_id, :price)";
        $stmt = $this->conn->prepare($sql);

        return $stmt->execute([
            ':invoice_id' => $invoiceId,
            ':service_id' => $serviceId,
            ':price' => $price,
        ]);
    }

    public function updateInvoiceTotal(int $invoiceId, float $total): bool
    {
        $sql = 'UPDATE Invoices SET total = :total, net_amount = :total WHERE invoice_id = :invoice_id';
        $stmt = $this->conn->prepare($sql);
        return $stmt->execute([
            ':total' => $total,
            ':invoice_id' => $invoiceId,
        ]);
    }

    /**
     * يغلق الزيارة بكتابة التشخيص النهائي + الملاحظات + اسم العيادة
     * + بيانات الطبيب الذي قام بالإغلاق (محفوظة تاريخياً).
     */
    public function closeVisit(
        int $visitId,
        string $diagnosis,
        string $finalNotes,
        ?string $clinicName,
        int $closedById,
        string $closedByName
    ): bool {
        $sql = "UPDATE Visits SET
                    diagnosis      = :diagnosis,
                    final_notes    = :final_notes,
                    clinic_name    = :clinic_name,
                    closed_by      = :closed_by,
                    closed_by_name = :closed_by_name,
                    closed_at      = CURRENT_TIMESTAMP,
                    status         = 'Completed'
                WHERE visit_id = :visit_id";
        $stmt = $this->conn->prepare($sql);
        return $stmt->execute([
            ':diagnosis'      => $diagnosis,
            ':final_notes'    => $finalNotes,
            ':clinic_name'    => $clinicName !== null && $clinicName !== '' ? $clinicName : null,
            ':closed_by'      => $closedById,
            ':closed_by_name' => $closedByName,
            ':visit_id'       => $visitId,
        ]);
    }

    /**
     * تُبقى للتوافق الخلفي - تُحدث التشخيص فقط دون إغلاق.
     */
    public function updateFinalDiagnosis(int $visitId, string $diagnosis): bool
    {
        $sql = "UPDATE Visits SET diagnosis = :diagnosis, status = 'Completed' WHERE visit_id = :visit_id";
        $stmt = $this->conn->prepare($sql);
        return $stmt->execute([
            ':diagnosis' => $diagnosis,
            ':visit_id' => $visitId,
        ]);
    }

    /**
     * يجلب البيانات اللازمة لتعبئة نافذة "إغلاق الزيارة" تلقائياً:
     * اسم المريض، العمر، الجنس، نوع الحالة، التشخيص المبدئي، رقم/نوع التذكرة.
     */
    public function getVisitCloseData(int $visitId): ?array
    {
        $ageExpr = $this->driver === 'pgsql'
            ? "DATE_PART('year', AGE(p.birth_date))"
            : "TIMESTAMPDIFF(YEAR, p.birth_date, CURDATE())";

        $sql = "SELECT
                    v.visit_id,
                    v.patient_id,
                    v.type_case,
                    v.diagnosis        AS initial_diagnosis,
                    v.notes            AS initial_notes,
                    p.full_name        AS patient_name,
                    p.gender,
                    p.place1,
                    p.place2,
                    {$ageExpr}::int    AS age,
                    {$this->formatDate('v.created_at')} AS visit_date_hint,
                    et.serial_number   AS ticket_serial,
                    et.ticket_type     AS ticket_type,
                    et.amount          AS ticket_amount
                FROM Visits v
                JOIN Patients p             ON v.patient_id = p.patient_id
                LEFT JOIN Examination_Tickets et ON et.visit_id = v.visit_id
                WHERE v.visit_id = :vid
                LIMIT 1";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute([':vid' => $visitId]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function getSentOrders(int $doctorId): array
    {
        $sql = "SELECT v.visit_id, p.full_name AS name, v.type_case, COUNT(id.detail_id) AS order_count
                FROM Visits v
                JOIN Patients p ON v.patient_id = p.patient_id
                JOIN Invoices i ON v.visit_id = i.visit_id
                JOIN Invoice_Details id ON i.invoice_id = id.invoice_id
                WHERE v.doctor_id = :doctor_id
                  AND i.created_at >= {$this->todayStart()}
                GROUP BY v.visit_id, p.full_name, v.type_case
                ORDER BY MAX(i.created_at) DESC";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute([':doctor_id' => $doctorId]);
        return $stmt->fetchAll();
    }

    public function getOrderDetails(int $visitId): array
    {
        $sql = "SELECT sm.service_name AS orders,
                       {$this->formatTime('i.created_at')} AS time,
                       CASE WHEN mr.result_id IS NOT NULL THEN 'مكتمل' ELSE 'قيد الانتظار' END AS status
                FROM Invoices i
                JOIN Invoice_Details id ON i.invoice_id = id.invoice_id
                JOIN Services_Master sm ON id.service_id = sm.service_id
                LEFT JOIN Medical_Results mr ON mr.visit_id = i.visit_id AND mr.service_id = sm.service_id
                WHERE i.visit_id = :visit_id";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute([':visit_id' => $visitId]);
        return $stmt->fetchAll();
    }

    public function getAvailableServices(): array
    {
        $sql = "SELECT
                    d.department_id,
                    d.department_name,
                    d.department_code,
                    COALESCE(d.sort_order, 999) AS sort_order,
                    sm.service_id,
                    sm.service_name
                FROM departments d
                LEFT JOIN service_categories sc
                    ON sc.department_id = d.department_id
                   AND COALESCE(sc.is_active, TRUE) = TRUE
                LEFT JOIN services_master sm
                    ON sm.category_id = sc.category_id
                   AND COALESCE(sm.is_active, TRUE) = TRUE
                WHERE COALESCE(d.is_active, TRUE) = TRUE
                ORDER BY COALESCE(d.sort_order, 999) ASC, d.department_name ASC, sm.service_name ASC";
        $stmt = $this->conn->query($sql);
        return $stmt->fetchAll();
    }

    public function getServiceDetailsById(int $serviceId): ?array
    {
        // 🆕 نُضيف department_code للسماح بمعرفة هل الخدمة تخصّ المختبر
        // وذلك حتى يُولّد النظام تلقائياً مستند المختبر (Laboratory Document).
        $sql = "SELECT sm.service_id, sm.total_price, sc.department, d.department_code
                FROM Services_Master sm
                LEFT JOIN service_categories sc ON sc.category_id = sm.category_id
                LEFT JOIN departments d ON d.department_id = sc.department_id
                WHERE sm.service_id = :service_id
                LIMIT 1";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute([':service_id' => $serviceId]);
        $service = $stmt->fetch();

        return $service ?: null;
    }

    /**
     * 🧪 ينشئ مستند مختبر (استمارة فحص) تلقائياً مرتبطاً بالزيارة والفاتورة
     * من نوع doc_type=L مع تسلسل خاص به. مفتاح المستند يتبع نفس
     * نمط تأمين التسلسل المستخدم في AccountingModel::processPayment
     * (قفل سجل document_types ثم MAX(serial_number) لتفادي السباق).
     *
     * يُعاد lab_doc_id الجديد، وإن لم يكن هناك خدمات مختبر يُعاد null.
     */
    public function createLaboratoryDocument(int $visitId, int $invoiceId, int $servicesCount, int $issuedBy, ?string $notes = null): ?int
    {
        if ($servicesCount <= 0) {
            return null;
        }

        // 1) قفل سجل نوع المستند L والحصول على current_serial
        $lockStmt = $this->conn->prepare(
            "SELECT doc_type_id, current_serial FROM document_types WHERE doc_name = 'L' FOR UPDATE"
        );
        $lockStmt->execute();
        $docRow = $lockStmt->fetch();
        if (!$docRow) {
            throw new RuntimeException('نوع مستند المختبر (L) غير معرّف في قاعدة البيانات.');
        }

        $docTypeId = (int) $docRow['doc_type_id'];

        // 2) الحصول على أعلى تسلسل فعلي في laboratory_documents لنفس النوع
        $maxStmt = $this->conn->prepare(
            'SELECT COALESCE(MAX(serial_number), 0) FROM laboratory_documents WHERE doc_type_id = :doc_type_id'
        );
        $maxStmt->execute([':doc_type_id' => $docTypeId]);
        $actualMax = (int) $maxStmt->fetchColumn();

        $newSerial = max((int) $docRow['current_serial'], $actualMax) + 1;

        // 3) تحديث العداد في document_types
        $updateSerialStmt = $this->conn->prepare(
            'UPDATE document_types SET current_serial = :current_serial WHERE doc_type_id = :doc_type_id'
        );
        $updateSerialStmt->execute([
            ':current_serial' => $newSerial,
            ':doc_type_id' => $docTypeId,
        ]);

        // 4) إدراج صف جديد في laboratory_documents
        $insertSql = "INSERT INTO laboratory_documents
                        (visit_id, invoice_id, serial_number, doc_type_id, doc_category, services_count, notes, issued_by)
                     VALUES
                        (:visit_id, :invoice_id, :serial_number, :doc_type_id, 'laboratory', :services_count, :notes, :issued_by)";

        return $this->insertAndGetId($insertSql, [
            ':visit_id'       => $visitId,
            ':invoice_id'     => $invoiceId,
            ':serial_number'  => $newSerial,
            ':doc_type_id'    => $docTypeId,
            ':services_count' => $servicesCount,
            ':notes'          => $notes,
            ':issued_by'      => $issuedBy,
        ], 'lab_doc_id');
    }

    public function getMedicalArchive(): array
    {
        $sql = "SELECT p.patient_id, p.full_name AS name,
                       COUNT(v.visit_id) AS visit_num,
                       {$this->formatDate('MAX(v.created_at)')} AS last_visit_date
                FROM Patients p
                JOIN Visits v ON p.patient_id = v.patient_id
                WHERE v.status = 'Completed'
                GROUP BY p.patient_id, p.full_name
                ORDER BY MAX(v.created_at) DESC";
        $stmt = $this->conn->query($sql);
        return $stmt->fetchAll();
    }

    public function getPatientMedicalFile(int $patientId): array
    {
        $aggregate = $this->driver === 'pgsql'
            ? "STRING_AGG(sm.service_name, '، ' ORDER BY sm.service_name)"
            : "GROUP_CONCAT(sm.service_name SEPARATOR '، ')";

        $sql = "SELECT v.visit_id,
                       {$this->formatDate('v.created_at')} AS date_visit,
                       v.type_case, v.diagnosis, v.notes,
                       v.final_notes,
                       v.clinic_name,
                       v.closed_by_name,
                       et.notes AS ticket_notes,
                       et.serial_number AS ticket_serial,
                       et.ticket_type,
                       et.amount AS ticket_amount,
                       (SELECT {$aggregate}
                        FROM Invoices i
                        JOIN Invoice_Details id ON i.invoice_id = id.invoice_id
                        JOIN Services_Master sm ON id.service_id = sm.service_id
                        WHERE i.visit_id = v.visit_id) AS procedures
                FROM Visits v
                LEFT JOIN Examination_Tickets et ON et.visit_id = v.visit_id
                WHERE v.patient_id = :patient_id AND v.status = 'Completed'
                ORDER BY v.created_at DESC";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute([':patient_id' => $patientId]);
        return $stmt->fetchAll();
    }

    private function insertAndGetId(string $sql, array $params, string $returningColumn): int
    {
        if ($this->driver === 'pgsql') {
            $stmt = $this->conn->prepare($sql . ' RETURNING ' . $returningColumn);
            $stmt->execute($params);
            return (int) $stmt->fetchColumn();
        }

        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);
        return (int) $this->conn->lastInsertId();
    }

    private function caseInsensitiveLike(string $column, string $parameter): string
    {
        if ($this->driver === 'pgsql') {
            return $column . ' ILIKE ' . $parameter;
        }

        return 'LOWER(' . $column . ') LIKE LOWER(' . $parameter . ')';
    }

    private function formatTime(string $column): string
    {
        return $this->driver === 'pgsql'
            ? "TO_CHAR({$column}, 'HH12:MI AM')"
            : "DATE_FORMAT({$column}, '%h:%i %p')";
    }

    private function formatDate(string $column): string
    {
        return $this->driver === 'pgsql'
            ? "TO_CHAR({$column}, 'YYYY-MM-DD')"
            : "DATE_FORMAT({$column}, '%Y-%m-%d')";
    }

    private function todayStart(): string
    {
        return $this->driver === 'pgsql'
            ? "CURRENT_DATE"
            : 'CURDATE()';
    }
}
