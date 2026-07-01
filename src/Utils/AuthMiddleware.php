<?php
declare(strict_types=1);

class AuthMiddleware
{
    public static function checkAccess(array $allowedRoles = []): array
    {
        $authHeader = self::getAuthorizationHeader();

        if (!preg_match('/Bearer\s+(\S+)/i', $authHeader, $matches)) {
            self::deny('جلسة غير صالحة أو منتهية، يرجى تسجيل الدخول.', 401);
        }

        $token = $matches[1];
        $decoded = JWT::decode($token);

        if (!$decoded || !isset($decoded['data']['user_id'], $decoded['data']['job'], $decoded['data']['name'])) {
            self::deny('جلسة غير صالحة أو منتهية، يرجى تسجيل الدخول.', 401);
        }

        if (isset($_SESSION['session_fingerprint']) && !hash_equals($_SESSION['session_fingerprint'], self::buildFingerprint())) {
            session_unset();
            session_destroy();
            self::deny('تم إنهاء الجلسة الحالية لأسباب أمنية. يرجى تسجيل الدخول مجدداً.', 401);
        }

        if (isset($_SESSION['jwt_fingerprint']) && !hash_equals($_SESSION['jwt_fingerprint'], hash('sha256', $token))) {
            self::deny('رمز الوصول الحالي لا يطابق الجلسة النشطة.', 401);
        }

        try {
            $db = new Database();
            $conn = $db->getConnection();
            $stmt = $conn->prepare(
                'SELECT u.user_id, u.full_name, r.role_name
                 FROM users u
                 JOIN roles r ON r.role_id = u.role_id
                 WHERE u.user_id = :user_id
                   AND COALESCE(u.is_active, TRUE) = TRUE
                 LIMIT 1'
            );
            $stmt->execute([':user_id' => (int) $decoded['data']['user_id']]);
            $currentUser = $stmt->fetch(PDO::FETCH_ASSOC);
        } catch (Throwable $exception) {
            self::deny('تعذر التحقق من الجلسة الحالية. يرجى تسجيل الدخول مجدداً.', 401);
        }

        if (!$currentUser) {
            session_unset();
            session_destroy();
            self::deny('الحساب الحالي غير متاح أو تم تعطيله. يرجى تسجيل الدخول مجدداً.', 401);
        }

        $userData = [
            'user_id' => (string) $currentUser['user_id'],
            'name'    => (string) $currentUser['full_name'],
            'job'     => self::normalizeRoleName((string) $currentUser['role_name']),
        ];

        $allowedRoles = array_map([self::class, 'normalizeRoleName'], $allowedRoles);
        if (!empty($allowedRoles) && !in_array($userData['job'], $allowedRoles, true)) {
            self::deny('ليس لديك صلاحية للوصول إلى هذا المورد.', 403);
        }

        $_SESSION['user_id'] = $userData['user_id'];
        $_SESSION['name'] = $userData['name'];
        $_SESSION['job'] = $userData['job'];
        $_SESSION['session_fingerprint'] = self::buildFingerprint();
        $_SESSION['jwt_fingerprint'] = hash('sha256', $token);
        $_SESSION['last_activity_at'] = time();

        return $userData;
    }

    private static function normalizeRoleName(string $roleName): string
    {
        $normalized = trim($roleName);

        return match ($normalized) {
            'امين الصندوق', 'أمين الصندوق', 'أمين صندوق' => 'أمين صندوق',
            default => $normalized,
        };
    }

    private static function getAuthorizationHeader(): string
    {
        if (function_exists('getallheaders')) {
            foreach (getallheaders() as $key => $value) {
                if (strtolower((string) $key) === 'authorization') {
                    return (string) $value;
                }
            }
        }

        if (function_exists('apache_request_headers')) {
            foreach (apache_request_headers() as $key => $value) {
                if (strtolower((string) $key) === 'authorization') {
                    return (string) $value;
                }
            }
        }

        return (string) ($_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
    }

    private static function buildFingerprint(): string
    {
        $userAgent = (string) ($_SERVER['HTTP_USER_AGENT'] ?? 'unknown-agent');
        return hash('sha256', $userAgent);
    }

    private static function deny(string $message, int $statusCode): void
    {
        http_response_code($statusCode);
        echo json_encode([
            'success' => false,
            'message' => $message,
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }
}
