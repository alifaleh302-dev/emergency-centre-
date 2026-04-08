<?php
declare(strict_types=1);

class PusherService
{
    private string $driver;
    private string $appId;
    private string $key;
    private string $secret;
    private string $cluster;

    public function __construct()
    {
        $this->driver = strtolower(trim((string) (getenv('REALTIME_DRIVER') ?: '')));
        $this->appId = trim((string) (getenv('PUSHER_APP_ID') ?: ''));
        $this->key = trim((string) (getenv('PUSHER_APP_KEY') ?: ''));
        $this->secret = trim((string) (getenv('PUSHER_APP_SECRET') ?: ''));
        $this->cluster = trim((string) (getenv('PUSHER_APP_CLUSTER') ?: 'mt1'));
    }

    public function isEnabled(): bool
    {
        return $this->driver === 'pusher'
            && $this->appId !== ''
            && $this->key !== ''
            && $this->secret !== ''
            && $this->cluster !== '';
    }

    public function getClientConfigForUser(array $userData): array
    {
        $channel = $this->resolveRoleChannel((string) ($userData['job'] ?? ''));

        return [
            'enabled' => $this->isEnabled() && $channel !== null,
            'driver' => 'pusher',
            'key' => $this->key,
            'cluster' => $this->cluster,
            'channel' => $channel,
            'auth_endpoint' => 'realtime/pusher/auth',
        ];
    }

    public function authorizePrivateChannel(string $socketId, string $channelName, array $userData): array
    {
        if (!$this->isEnabled()) {
            throw new RuntimeException('خدمة التحديث اللحظي غير مفعلة على الخادم.');
        }

        $allowedChannel = $this->resolveRoleChannel((string) ($userData['job'] ?? ''));
        if ($allowedChannel === null || $channelName !== $allowedChannel) {
            throw new RuntimeException('غير مصرح لك بالاشتراك في هذه القناة.');
        }

        $signature = hash_hmac('sha256', $socketId . ':' . $channelName, $this->secret);

        return [
            'auth' => $this->key . ':' . $signature,
        ];
    }

    public function broadcastRoleNotification(string $targetRole, array $notification): bool
    {
        if (!$this->isEnabled()) {
            return false;
        }

        $channel = $this->resolveRoleChannel($targetRole);
        if ($channel === null) {
            return false;
        }

        return $this->trigger($channel, 'notification:new', [
            'notification' => $notification,
        ]);
    }

    public function resolveRoleChannel(string $role): ?string
    {
        return match (trim($role)) {
            'أمين صندوق' => 'private-ec-role-accounting',
            'طبيب عام' => 'private-ec-role-doctor',
            default => null,
        };
    }

    private function trigger(string $channel, string $eventName, array $payload): bool
    {
        $eventBody = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($eventBody === false) {
            return false;
        }

        $body = json_encode([
            'name' => $eventName,
            'channels' => [$channel],
            'data' => $eventBody,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        if ($body === false) {
            return false;
        }

        $path = '/apps/' . $this->appId . '/events';
        $params = [
            'auth_key' => $this->key,
            'auth_timestamp' => (string) time(),
            'auth_version' => '1.0',
            'body_md5' => md5($body),
        ];
        ksort($params);

        $query = http_build_query($params, '', '&', PHP_QUERY_RFC3986);
        $stringToSign = "POST\n{$path}\n{$query}";
        $signature = hash_hmac('sha256', $stringToSign, $this->secret);
        $url = 'https://' . $this->getApiHost() . $path . '?' . $query . '&auth_signature=' . $signature;

        if (function_exists('curl_init')) {
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_POST => true,
                CURLOPT_POSTFIELDS => $body,
                CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT => 8,
            ]);
            curl_exec($ch);
            $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);

            return $status >= 200 && $status < 300;
        }

        $context = stream_context_create([
            'http' => [
                'method' => 'POST',
                'header' => "Content-Type: application/json\r\n",
                'content' => $body,
                'timeout' => 8,
                'ignore_errors' => true,
            ],
        ]);

        @file_get_contents($url, false, $context);
        $headers = $http_response_header ?? [];
        $statusLine = $headers[0] ?? '';
        preg_match('/\s(\d{3})\s/', $statusLine, $matches);
        $status = isset($matches[1]) ? (int) $matches[1] : 0;

        return $status >= 200 && $status < 300;
    }

    private function getApiHost(): string
    {
        return $this->cluster !== ''
            ? 'api-' . $this->cluster . '.pusher.com'
            : 'api.pusherapp.com';
    }
}
