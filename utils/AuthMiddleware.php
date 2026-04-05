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

        $userRole = $decoded['data']['job'];
        if (!empty($allowedRoles) && !in_array($userRole, $allowedRoles, true)) {
            self::deny('ليس لديك صلاحية للوصول إلى هذا المورد.', 403);
        }

        $_SESSION['user_id'] = (int) $decoded['data']['user_id'];
        $_SESSION['name'] = (string) $decoded['data']['name'];
        $_SESSION['job'] = (string) $decoded['data']['job'];
        $_SESSION['session_fingerprint'] = self::buildFingerprint();
        $_SESSION['jwt_fingerprint'] = hash('sha256', $token);
        $_SESSION['last_activity_at'] = time();

        return $decoded['data'];
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
