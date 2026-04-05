<?php
declare(strict_types=1);

class JWT
{
    private static function getSecretKey(): string
    {
        return getenv('JWT_SECRET') ?: 'local-dev-change-me';
    }

    public static function encode(array $payload): string
    {
        $header = ['typ' => 'JWT', 'alg' => 'HS256'];

        $base64UrlHeader = self::base64UrlEncode(json_encode($header, JSON_UNESCAPED_UNICODE));
        $base64UrlPayload = self::base64UrlEncode(json_encode($payload, JSON_UNESCAPED_UNICODE));
        $signature = hash_hmac('sha256', $base64UrlHeader . '.' . $base64UrlPayload, self::getSecretKey(), true);

        return $base64UrlHeader . '.' . $base64UrlPayload . '.' . self::base64UrlEncode($signature);
    }

    public static function decode(string $jwt)
    {
        $tokenParts = explode('.', $jwt);
        if (count($tokenParts) !== 3) {
            return false;
        }

        [$encodedHeader, $encodedPayload, $signatureProvided] = $tokenParts;
        $headerJson = self::base64UrlDecode($encodedHeader);
        $payloadJson = self::base64UrlDecode($encodedPayload);

        if ($headerJson === false || $payloadJson === false) {
            return false;
        }

        $header = json_decode($headerJson, true);
        $payload = json_decode($payloadJson, true);

        if (!is_array($header) || !is_array($payload) || ($header['alg'] ?? '') !== 'HS256') {
            return false;
        }

        $expectedSignature = self::base64UrlEncode(
            hash_hmac('sha256', $encodedHeader . '.' . $encodedPayload, self::getSecretKey(), true)
        );

        if (!hash_equals($expectedSignature, $signatureProvided)) {
            return false;
        }

        if (isset($payload['exp']) && (int) $payload['exp'] < time()) {
            return false;
        }

        return $payload;
    }

    private static function base64UrlEncode(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    private static function base64UrlDecode(string $data)
    {
        $remainder = strlen($data) % 4;
        if ($remainder > 0) {
            $data .= str_repeat('=', 4 - $remainder);
        }

        return base64_decode(strtr($data, '-_', '+/'), true);
    }
}
