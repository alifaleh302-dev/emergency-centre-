<?php
declare(strict_types=1);
require_once  'BaseController.php'; // تأكد من صحة المسار

class AuthController extends BaseController
{
    private PDO $conn;

    public function __construct()
    {
        $database = new Database();
        $this->conn = $database->getConnection();
    }

    public function login($data): void
    {
        try {
            $this->requireFields($data, ['username', 'password']);

            $username = $this->sanitizeText($this->getField($data, 'username'), 'username', 100);
            $password = (string) $this->getField($data, 'password');

            $query = "SELECT u.user_id, u.password_hash, u.full_name, r.role_name, r.script_url
                      FROM Users u
                      JOIN Roles r ON u.role_id = r.role_id
                      WHERE u.username = :username
                      LIMIT 1";

            $stmt = $this->conn->prepare($query);
            $stmt->execute([':username' => $username]);
            $user = $stmt->fetch();

            if (!$user) {
                $this->error('اسم المستخدم غير موجود.', 401);
                return;
            }

            $storedPassword = (string) ($user['password_hash'] ?? '');
            $isStoredHash = password_get_info($storedPassword)['algo'] !== null;
            $isValidPassword = $isStoredHash
                ? password_verify($password, $storedPassword)
                : hash_equals($storedPassword, $password);

            if (!$isValidPassword) {
                $this->error('كلمة المرور غير صحيحة.', 401);
                return;
            }

            if (!$isStoredHash || password_needs_rehash($storedPassword, PASSWORD_BCRYPT)) {
                $rehashStmt = $this->conn->prepare('UPDATE Users SET password_hash = :password_hash WHERE user_id = :user_id');
                $rehashStmt->execute([
                    ':password_hash' => password_hash($password, PASSWORD_BCRYPT),
                    ':user_id' => $user['user_id'],
                ]);
            }

            $tokenPayload = [
                'iss' => 'EmergencyCenter',
                'exp' => time() + (60 * 60 * 8),
                'data' => [
                    'user_id' => (int) $user['user_id'],
                    'name' => (string) $user['full_name'],
                    'job' => (string) $user['role_name'],
                ],
            ];

            $jwt = JWT::encode($tokenPayload);

            session_regenerate_id(true);
            $_SESSION['user_id'] = (int) $user['user_id'];
            $_SESSION['name'] = (string) $user['full_name'];
            $_SESSION['job'] = (string) $user['role_name'];
            $_SESSION['session_fingerprint'] = hash('sha256', (string) ($_SERVER['HTTP_USER_AGENT'] ?? 'unknown-agent'));
            $_SESSION['jwt_fingerprint'] = hash('sha256', $jwt);
            $_SESSION['last_activity_at'] = time();

            $this->respond([
                'success' => true,
                'message' => 'تم تسجيل الدخول بنجاح',
                'token' => $jwt,
                'script_url' => (string) $user['script_url'],
            ]);
        } catch (InvalidArgumentException $exception) {
            $this->error($exception->getMessage(), 422);
        }
    }
}
