<?php
declare(strict_types=1);

/**
 * AuditService
 * مركز تسجيل كل عمليات الأدمن الحساسة في جدول audit_logs
 * يتم استدعاؤه من AdminController عند كل عملية CREATE / UPDATE / DELETE / CANCEL / LOGIN / EXPORT.
 */
class AuditService
{
    private PDO $conn;

    public function __construct(PDO $conn)
    {
        $this->conn = $conn;
    }

    public function log(
        int|string|null $userId,
        string $username,
        string $action,
        ?string $tableName = null,
        int|string|null $recordId = null,
        ?array $oldValues = null,
        ?array $newValues = null
    ): void {
        try {
            $stmt = $this->conn->prepare(
                'INSERT INTO audit_logs (user_id, username, action, table_name, record_id, old_values, new_values, ip_address, user_agent)
                 VALUES (:user_id, :username, :action, :table_name, :record_id, :old_values, :new_values, :ip, :ua)'
            );
            $stmt->execute([
                ':user_id'    => $userId === null ? null : (string) $userId,
                ':username'   => mb_substr($username, 0, 100),
                ':action'     => mb_substr($action, 0, 30),
                ':table_name' => $tableName,
                ':record_id'  => $recordId === null ? null : (string) $recordId,
                ':old_values' => $oldValues !== null ? json_encode($this->safeValues($oldValues), JSON_UNESCAPED_UNICODE) : null,
                ':new_values' => $newValues !== null ? json_encode($this->safeValues($newValues), JSON_UNESCAPED_UNICODE) : null,
                ':ip'         => mb_substr((string) ($_SERVER['REMOTE_ADDR'] ?? ''), 0, 60),
                ':ua'         => mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255),
            ]);
        } catch (Throwable $e) {
            // لا نُفشل العملية الأصلية بسبب فشل تسجيل اللوج
            error_log('AuditService failed: ' . $e->getMessage());
        }
    }

    /**
     * يخفي الحقول الحساسة قبل حفظها في السجل
     */
    private function safeValues(array $values): array
    {
        $sensitive = ['password_hash', 'password'];
        foreach ($sensitive as $key) {
            if (array_key_exists($key, $values)) {
                $values[$key] = '••••••';
            }
        }
        return $values;
    }
}
