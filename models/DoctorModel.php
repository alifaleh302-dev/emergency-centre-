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
        $sql = "SELECT p.patient_id, p.full_name, p.place1, p.place2,
                       (SELECT COUNT(*) FROM Visits v WHERE v.patient_id = p.patient_id AND v.status = 'Completed') AS visit_num
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
        return $stmt->fetchAll();
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
        $sql = "INSERT INTO Invoices (serial_number, visit_id, total, exemption_value, net_amount)
                VALUES (0, :visit_id, 0, 0, 0)";

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

    public function updateFinalDiagnosis(int $visitId, string $diagnosis): bool
    {
        $sql = "UPDATE Visits SET diagnosis = :diagnosis, status = 'Completed' WHERE visit_id = :visit_id";
        $stmt = $this->conn->prepare($sql);
        return $stmt->execute([
            ':diagnosis' => $diagnosis,
            ':visit_id' => $visitId,
        ]);
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
        $sql = "SELECT sm.service_id, sm.service_name, sc.department
                FROM Services_Master sm
                JOIN Service_Categories sc ON sm.category_id = sc.category_id
                ORDER BY sm.service_name ASC";
        $stmt = $this->conn->query($sql);
        return $stmt->fetchAll();
    }

    public function getServiceDetailsById(int $serviceId): ?array
    {
        $stmt = $this->conn->prepare('SELECT service_id, total_price FROM Services_Master WHERE service_id = :service_id LIMIT 1');
        $stmt->execute([':service_id' => $serviceId]);
        $service = $stmt->fetch();

        return $service ?: null;
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

        $sql = "SELECT {$this->formatDate('v.created_at')} AS date_visit,
                       v.type_case, v.diagnosis, v.notes,
                       et.notes AS ticket_notes,
                       et.serial_number AS ticket_serial,
                       et.ticket_type,
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
