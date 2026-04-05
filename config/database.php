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

            $dsn = sprintf(
                'pgsql:host=%s;port=%s;dbname=%s',
                $config['host'],
                $config['port'],
                $config['database']
            );

            $this->conn = new PDO($dsn, $config['username'], $config['password'], $options);
            $this->conn->exec("SET client_encoding TO 'UTF8'");

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
                'port' => (string) ($parsed['port'] ?? 5432),
                'database' => ltrim($parsed['path'], '/'),
                'username' => $parsed['user'] ?? '',
                'password' => $parsed['pass'] ?? '',
            ];
        }

        $driver = $this->normalizeDriver(getenv('DB_CONNECTION') ?: 'pgsql');

        return [
            'driver' => $driver,
            'host' => getenv('DB_HOST') ?: '127.0.0.1',
            'port' => getenv('DB_PORT') ?: '5432',
            'database' => getenv('DB_NAME') ?: (getenv('DB_DATABASE') ?: 'emergency_centre'),
            'username' => getenv('DB_USER') ?: (getenv('DB_USERNAME') ?: 'postgres'),
            'password' => getenv('DB_PASSWORD') ?: '',
        ];
    }

    private function normalizeDriver(string $driver): string
    {
        $driver = strtolower(trim($driver));

        return match ($driver) {
            'pgsql', 'postgres', 'postgresql' => 'pgsql',
            default => 'pgsql',
        };
    }
}
