<?php
declare(strict_types=1);

class AccountingModel
{
    private PDO $conn;
    private string $driver;

    public function __construct(PDO $db, string $driver = 'mysql')
    {
        $this->conn = $db;
        $this->driver = $driver;
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
        $sql = "SELECT sm.service_name AS name, id.service_price_at_time AS price
                FROM Invoice_Details id
                JOIN Services_Master sm ON id.service_id = sm.service_id
                WHERE id.invoice_id = :invoice_id";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute([':invoice_id' => $invoiceId]);
        return $stmt->fetchAll();
    }

    public function getNextSerials(): array
    {
        $stmt = $this->conn->query('SELECT doc_name, current_serial + 1 AS next_serial FROM Document_Types ORDER BY doc_type_id ASC');
        return $stmt->fetchAll();
    }

    public function processPayment(int $invoiceId, float $netAmount, float $exemptionValue, string $docTypeName, int $accountantId): int
    {
        try {
            $this->conn->beginTransaction();

            $lockStmt = $this->conn->prepare('SELECT doc_type_id, current_serial FROM Document_Types WHERE doc_name = :doc_name FOR UPDATE');
            $lockStmt->execute([':doc_name' => $docTypeName]);
            $documentType = $lockStmt->fetch();

            if (!$documentType) {
                throw new InvalidArgumentException('نوع السند المطلوب غير موجود في قاعدة البيانات.');
            }

            $newSerial = (int) $documentType['current_serial'] + 1;

            $updateSerialStmt = $this->conn->prepare('UPDATE Document_Types SET current_serial = :current_serial WHERE doc_type_id = :doc_type_id');
            $updateSerialStmt->execute([
                ':current_serial' => $newSerial,
                ':doc_type_id' => $documentType['doc_type_id'],
            ]);

            $updateInvoiceSql = "UPDATE Invoices SET
                                    net_amount = :net_amount,
                                    exemption_value = :exemption_value,
                                    doc_type_id = :doc_type_id,
                                    serial_number = :serial_number,
                                    accountant_id = :accountant_id,
                                    created_at = NOW()
                                 WHERE invoice_id = :invoice_id";
            $updateInvoiceStmt = $this->conn->prepare($updateInvoiceSql);
            $updateInvoiceStmt->execute([
                ':net_amount' => $netAmount,
                ':exemption_value' => $exemptionValue,
                ':doc_type_id' => $documentType['doc_type_id'],
                ':serial_number' => $newSerial,
                ':accountant_id' => $accountantId,
                ':invoice_id' => $invoiceId,
            ]);

            $this->conn->commit();
            return $newSerial;
        } catch (Throwable $exception) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            throw $exception;
        }
    }

    public function getDailyReceipts(): array
    {
        $sql = "SELECT i.invoice_id, p.full_name AS name, i.net_amount, i.exemption_value,
                       {$this->formatTime('i.created_at')} AS time,
                       dt.doc_name, u.full_name AS cashier
                FROM Invoices i
                JOIN Visits v ON i.visit_id = v.visit_id
                JOIN Patients p ON v.patient_id = p.patient_id
                JOIN Document_Types dt ON i.doc_type_id = dt.doc_type_id
                JOIN Users u ON i.accountant_id = u.user_id
                WHERE i.accountant_id IS NOT NULL
                  AND i.created_at >= {$this->twentyFourHoursAgo()}
                ORDER BY i.created_at DESC";
        $stmt = $this->conn->query($sql);
        return $stmt->fetchAll();
    }

    public function getRevenuesByYears(): array
    {
        $sql = "SELECT {$this->yearExpression('created_at')} AS year_val,
                       SUM(net_amount) AS total_paid,
                       SUM(exemption_value) AS total_exempt,
                       SUM(CASE WHEN doc_type_id = 1 THEN 1 ELSE 0 END) AS count_cash,
                       SUM(CASE WHEN doc_type_id = 2 THEN 1 ELSE 0 END) AS count_partial,
                       SUM(CASE WHEN doc_type_id = 3 THEN 1 ELSE 0 END) AS count_full
                FROM Invoices
                WHERE doc_type_id IS NOT NULL
                GROUP BY year_val
                ORDER BY year_val DESC";
        $stmt = $this->conn->query($sql);
        return $stmt->fetchAll();
    }

    public function getRevenuesByMonths(string $year): array
    {
        $sql = "SELECT {$this->monthExpression('created_at')} AS month_val,
                       SUM(net_amount) AS total_paid,
                       SUM(exemption_value) AS total_exempt,
                       SUM(CASE WHEN doc_type_id = 1 THEN 1 ELSE 0 END) AS count_cash,
                       SUM(CASE WHEN doc_type_id = 2 THEN 1 ELSE 0 END) AS count_partial,
                       SUM(CASE WHEN doc_type_id = 3 THEN 1 ELSE 0 END) AS count_full
                FROM Invoices
                WHERE doc_type_id IS NOT NULL AND {$this->yearExpression('created_at')} = :year
                GROUP BY month_val
                ORDER BY month_val DESC";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute([':year' => $year]);
        return $stmt->fetchAll();
    }

    public function getRevenuesByDays(string $year, string $month): array
    {
        $sql = "SELECT {$this->dayExpression('created_at')} AS day_val,
                       SUM(net_amount) AS total_paid,
                       SUM(exemption_value) AS total_exempt,
                       SUM(CASE WHEN doc_type_id = 1 THEN 1 ELSE 0 END) AS count_cash,
                       SUM(CASE WHEN doc_type_id = 2 THEN 1 ELSE 0 END) AS count_partial,
                       SUM(CASE WHEN doc_type_id = 3 THEN 1 ELSE 0 END) AS count_full
                FROM Invoices
                WHERE doc_type_id IS NOT NULL AND {$this->yearMonthExpression('created_at')} = :year_month
                GROUP BY day_val
                ORDER BY day_val DESC";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute([':year_month' => $year . '-' . str_pad($month, 2, '0', STR_PAD_LEFT)]);
        return $stmt->fetchAll();
    }

    public function searchOrGetDailyDetails(?string $date = null, ?string $query = null): array
    {
        $sql = "SELECT i.invoice_id, p.full_name AS name, i.net_amount, i.exemption_value,
                       {$this->formatDateTime('i.created_at')} AS time,
                       dt.doc_name, i.serial_number, u.full_name AS cashier
                FROM Invoices i
                JOIN Visits v ON i.visit_id = v.visit_id
                JOIN Patients p ON v.patient_id = p.patient_id
                JOIN Document_Types dt ON i.doc_type_id = dt.doc_type_id
                JOIN Users u ON i.accountant_id = u.user_id
                WHERE i.doc_type_id IS NOT NULL";
        $params = [];

        if ($date !== null && $date !== '') {
            $sql .= ' AND DATE(i.created_at) = :date';
            $params[':date'] = $date;
        }

        if ($query !== null && $query !== '') {
            $sql .= ' AND (' . $this->searchableLike('p.full_name', ':query')
                . ' OR ' . $this->castToString('i.invoice_id') . ' LIKE :query'
                . ' OR ' . $this->castToString('i.serial_number') . ' LIKE :query)';
            $params[':query'] = '%' . $query . '%';
        }

        $sql .= ' ORDER BY i.created_at DESC';

        if ($query !== null && $query !== '') {
            $sql .= ' LIMIT 100';
        }

        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
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

    private function twentyFourHoursAgo(): string
    {
        return $this->driver === 'pgsql'
            ? "(NOW() - INTERVAL '24 hours')"
            : '(NOW() - INTERVAL 24 HOUR)';
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
}
