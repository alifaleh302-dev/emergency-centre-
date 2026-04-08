<?php
declare(strict_types=1);

class ExaminationTicketModel
{
    private PDO $conn;
    private string $driver;

    public function __construct(PDO $db, string $driver = 'pgsql')
    {
        $this->conn = $db;
        $this->driver = $driver;
    }

    public function createTicket(int $visitId, string $notes, float $amount): array
    {
        $ticketType = $this->determineTicketType();

        $this->conn->beginTransaction();
        try {
            // Lock serial counter
            $lockStmt = $this->conn->prepare("SELECT doc_type_id, current_serial FROM Document_Types WHERE doc_name = 'T' FOR UPDATE");
            $lockStmt->execute();
            $serialDoc = $lockStmt->fetch();

            $maxStmt = $this->conn->prepare('SELECT COALESCE(MAX(serial_number), 0) FROM Examination_Tickets');
            $maxStmt->execute();
            $actualMax = (int) $maxStmt->fetchColumn();

            $baseSerial = max((int) $serialDoc['current_serial'], $actualMax);
            $newSerial = $baseSerial + 1;

            // Update counter
            $this->conn->prepare('UPDATE Document_Types SET current_serial = ? WHERE doc_type_id = ?')
                ->execute([$newSerial, $serialDoc['doc_type_id']]);

            // Insert ticket
            $sql = "INSERT INTO Examination_Tickets (visit_id, serial_number, ticket_type, notes, amount)
                    VALUES (:visit_id, :serial, :type, :notes, :amount)";
            if ($this->driver === 'pgsql') {
                $sql .= ' RETURNING ticket_id';
            }
            $stmt = $this->conn->prepare($sql);
            $stmt->execute([
                ':visit_id' => $visitId,
                ':serial' => $newSerial,
                ':type' => $ticketType,
                ':notes' => $notes,
                ':amount' => $amount,
            ]);

            $ticketId = $this->driver === 'pgsql'
                ? (int) $stmt->fetchColumn()
                : (int) $this->conn->lastInsertId();

            $this->conn->commit();

            return [
                'ticket_id' => $ticketId,
                'serial_number' => $newSerial,
                'ticket_type' => $ticketType,
            ];
        } catch (\Throwable $e) {
            if ($this->conn->inTransaction()) $this->conn->rollBack();
            throw $e;
        }
    }

    public function getByVisitId(int $visitId): ?array
    {
        $stmt = $this->conn->prepare('SELECT * FROM Examination_Tickets WHERE visit_id = :vid LIMIT 1');
        $stmt->execute([':vid' => $visitId]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function hasTicket(int $visitId): bool
    {
        $stmt = $this->conn->prepare('SELECT 1 FROM Examination_Tickets WHERE visit_id = :vid LIMIT 1');
        $stmt->execute([':vid' => $visitId]);
        return (bool) $stmt->fetchColumn();
    }

    private function determineTicketType(): string
    {
        $hour = (int) date('G'); // 0-23
        // morning: 5:00 - 12:00, evening: 12:01 - 4:59
        return ($hour >= 5 && $hour < 12) ? 'morning' : 'evening';
    }
}
