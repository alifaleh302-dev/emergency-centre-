<?php
declare(strict_types=1);

class NotificationModel
{
    private PDO $conn;

    public function __construct(PDO $db)
    {
        $this->conn = $db;
    }

    public function create(string $targetRole, string $title, string $body, string $eventType, ?int $referenceId = null): int
    {
        $sql = "INSERT INTO Notifications (target_role, title, body, event_type, reference_id)
                VALUES (:target_role, :title, :body, :event_type, :reference_id)";
        $stmt = $this->conn->prepare($sql . ' RETURNING notification_id');
        $stmt->execute([
            ':target_role' => $targetRole,
            ':title' => $title,
            ':body' => $body,
            ':event_type' => $eventType,
            ':reference_id' => $referenceId,
        ]);
        return (int) $stmt->fetchColumn();
    }

    public function getUnread(string $role, int $limit = 20): array
    {
        $sql = "SELECT notification_id, title, body, event_type, reference_id,
                       TO_CHAR(created_at, 'HH12:MI AM') AS time
                FROM Notifications
                WHERE target_role = :role AND is_read = FALSE
                  AND created_at >= CURRENT_DATE
                ORDER BY created_at DESC
                LIMIT :lim";
        $stmt = $this->conn->prepare($sql);
        $stmt->bindValue(':role', $role);
        $stmt->bindValue(':lim', $limit, PDO::PARAM_INT);
        $stmt->execute();
        return $stmt->fetchAll();
    }

    public function countUnread(string $role): int
    {
        $stmt = $this->conn->prepare("SELECT COUNT(*) FROM Notifications WHERE target_role = :role AND is_read = FALSE AND created_at >= CURRENT_DATE");
        $stmt->execute([':role' => $role]);
        return (int) $stmt->fetchColumn();
    }

    public function markAllRead(string $role): void
    {
        $stmt = $this->conn->prepare("UPDATE Notifications SET is_read = TRUE WHERE target_role = :role AND is_read = FALSE");
        $stmt->execute([':role' => $role]);
    }
}
