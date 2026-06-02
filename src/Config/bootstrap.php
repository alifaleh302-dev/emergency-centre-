<?php
declare(strict_types=1);

// BASE_PATH = جذر المشروع (parent of src/)
if (!defined('BASE_PATH')) {
    define('BASE_PATH', dirname(__DIR__, 2));
}

// SRC_PATH = مجلد كود PHP (src/)
if (!defined('SRC_PATH')) {
    define('SRC_PATH', dirname(__DIR__));
}

// Polyfill minimal mbstring functions to keep the app usable even if the
// mbstring extension is not loaded on the host (Render sometimes ships a
// slim PHP image). These simple shims use byte-level operations which are
// sufficient for our short UI strings and validation lengths.
if (!function_exists('mb_substr')) {
    function mb_substr($str, $start, $length = null, $encoding = null) {
        if ($length === null) { return substr((string) $str, (int) $start); }
        return substr((string) $str, (int) $start, (int) $length);
    }
}
if (!function_exists('mb_strlen')) {
    function mb_strlen($str, $encoding = null) {
        return strlen((string) $str);
    }
}
if (!function_exists('mb_strtolower')) {
    function mb_strtolower($str, $encoding = null) { return strtolower((string) $str); }
}

(function (string $basePath): void {
    $envPath = $basePath . '/.env';
    if (!is_file($envPath) || !is_readable($envPath)) {
        return;
    }

    $lines = file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if ($lines === false) {
        return;
    }

    foreach ($lines as $line) {
        $trimmed = trim($line);
        if ($trimmed === '' || str_starts_with($trimmed, '#') || !str_contains($trimmed, '=')) {
            continue;
        }

        [$key, $value] = explode('=', $trimmed, 2);
        $key = trim($key);
        $value = trim($value);

        if ($key === '' || getenv($key) !== false) {
            continue;
        }

        if (
            (str_starts_with($value, '"') && str_ends_with($value, '"')) ||
            (str_starts_with($value, "'") && str_ends_with($value, "'"))
        ) {
            $value = substr($value, 1, -1);
        }

        putenv($key . '=' . $value);
        $_ENV[$key] = $value;
        $_SERVER[$key] = $value;
    }
})(BASE_PATH);

spl_autoload_register(function (string $class): void {
    $directories = [
        SRC_PATH . '/Config',
        SRC_PATH . '/Controllers',
        SRC_PATH . '/Models',
        SRC_PATH . '/Utils',
    ];

    foreach ($directories as $directory) {
        $candidates = [
            $directory . '/' . $class . '.php',
            $directory . '/' . strtolower($class) . '.php',
        ];

        foreach ($candidates as $file) {
            if (is_file($file)) {
                require_once $file;
                return;
            }
        }
    }
});

date_default_timezone_set(getenv('APP_TIMEZONE') ?: 'UTC');

$debugMode = filter_var(getenv('APP_DEBUG') ?: 'false', FILTER_VALIDATE_BOOLEAN);
ini_set('display_errors', $debugMode ? '1' : '0');
error_reporting(E_ALL);

if (session_status() === PHP_SESSION_NONE) {
    $isHttps = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';

    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.cookie_httponly', '1');
    ini_set('session.cookie_samesite', 'Lax');
    ini_set('session.cookie_secure', $isHttps ? '1' : '0');

    session_name('emergency_center_session');
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'domain' => '',
        'secure' => $isHttps,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);

    session_start();
}

set_exception_handler(function (Throwable $exception) use ($debugMode): void {
    http_response_code(500);
    header('Content-Type: application/json; charset=UTF-8');

    $response = [
        'success' => false,
        'message' => 'حدث خطأ داخلي غير متوقع في الخادم.',
    ];

    if ($debugMode) {
        $response['debug'] = $exception->getMessage();
    }

    echo json_encode($response, JSON_UNESCAPED_UNICODE);
    exit;
});
