<?php
declare(strict_types=1);

class Database
{
    private string $driver = 'pgsql';
    private ?PDO $conn = null;

    public function getConnection(): PDO
    {
        if ($this->conn instanceof PDO) {
            return $this->conn;
        }

        $config = $this->resolveConfig();
        $this->driver = $config['driver'];

        try {
            $options = [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ];

            if ($this->driver === 'pgsql') {
                $dsn = sprintf(
                    'pgsql:host=%s;port=%s;dbname=%s',
                    $config['host'],
                    $config['port'],
                    $config['database']
                );
            } else {
                $dsn = sprintf(
                    'mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4',
                    $config['host'],
                    $config['port'],
                    $config['database']
                );
            }

            $this->conn = new PDO($dsn, $config['username'], $config['password'], $options);

            if ($this->driver === 'pgsql') {
                $this->conn->exec("SET client_encoding TO 'UTF8'");
                // 🆕 توحيد المنطقة الزمنية لجلسة قاعدة البيانات مع توقيت التطبيق المحلي.
                // قبل هذا الإصلاح كانت جلسة Render تعمل افتراضياً بـ UTC مما يجعل
                // CURRENT_DATE و DATE(timestamptz) ترجع تاريخ UTC، فتظهر فواتير
                // ما بعد منتصف الليل المحلي كأنها تعود لليوم السابق، وبالتالي تختفي
                // من واجهة "اليومية" لدى أمين الصندوق.
                $tz = getenv('APP_TIMEZONE') ?: 'Asia/Aden';
                // SET TIME ZONE لا يقبل placeholder، لذلك نحقن بقيمة آمنة بعد التحقق.
                if (preg_match('/^[A-Za-z_\/\-+0-9]{1,64}$/', $tz)) {
                    $this->conn->exec("SET TIME ZONE '" . $tz . "'");
                }
            } else {
                $this->conn->exec("SET NAMES utf8mb4");
                // محاولة ضبط المنطقة الزمنية لجلسة MySQL إذا كان توقيت دقيق متوفر.
                $tz = getenv('APP_TIMEZONE') ?: 'Asia/Aden';
                if (preg_match('/^[A-Za-z_\/\-+0-9]{1,64}$/', $tz)) {
                    try {
                        $this->conn->exec("SET time_zone = '" . $tz . "'");
                    } catch (Throwable $e) {
                        // MySQL قد لا يحتوي جداول المناطق الزمنية — تجاهل بصمت.
                    }
                }
            }

            return $this->conn;
        } catch (PDOException $exception) {
            throw new RuntimeException('فشل الاتصال بقاعدة البيانات. تحقق من متغيرات البيئة وإعدادات الخادم.');
        }
    }

    public function getDriver(): string
    {
        return $this->driver;
    }

    private function resolveConfig(): array
    {
        $databaseUrl = getenv('DATABASE_URL');
        if ($databaseUrl) {
            $parsed = parse_url($databaseUrl);
            if ($parsed === false || empty($parsed['host']) || empty($parsed['path'])) {
                throw new RuntimeException('صيغة DATABASE_URL غير صحيحة.');
            }

            $driver = $this->normalizeDriver($parsed['scheme'] ?? 'pgsql');

            return [
                'driver' => $driver,
                'host' => $parsed['host'],
                'port' => (string) ($parsed['port'] ?? ($driver === 'pgsql' ? 5432 : 3306)),
                'database' => ltrim($parsed['path'], '/'),
                'username' => $parsed['user'] ?? '',
                'password' => $parsed['pass'] ?? '',
            ];
        }

        $driver = $this->normalizeDriver(getenv('DB_CONNECTION') ?: 'pgsql');

        return [
            'driver' => $driver,
            'host' => getenv('DB_HOST') ?: '127.0.0.1',
            'port' => getenv('DB_PORT') ?: ($driver === 'pgsql' ? '5432' : '3306'),
            'database' => getenv('DB_NAME') ?: (getenv('DB_DATABASE') ?: ($driver === 'pgsql' ? 'emergency_centre' : 'emergency_center')),
            'username' => getenv('DB_USER') ?: (getenv('DB_USERNAME') ?: ($driver === 'pgsql' ? 'postgres' : 'root')),
            'password' => getenv('DB_PASSWORD') ?: '',
        ];
    }

    private function normalizeDriver(string $driver): string
    {
        $driver = strtolower(trim($driver));

        return match ($driver) {
            'pgsql', 'postgres', 'postgresql' => 'pgsql',
            'mysql' => 'mysql',
            default => 'pgsql',
        };
    }
}
