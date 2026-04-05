<?php
declare(strict_types=1);

class BaseController
{
    protected function respond(array $payload, int $statusCode = 200): void
    {
        http_response_code($statusCode);
        echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    }

    protected function success(?array $data = null, string $message = '', int $statusCode = 200, array $extra = []): void
    {
        $payload = ['success' => true];

        if ($message !== '') {
            $payload['message'] = $message;
        }

        if ($data !== null) {
            $payload['data'] = $data;
        }

        if (!empty($extra)) {
            $payload = array_merge($payload, $extra);
        }

        $this->respond($payload, $statusCode);
    }

    protected function error(string $message, int $statusCode = 400, array $extra = []): void
    {
        $payload = array_merge([
            'success' => false,
            'message' => $message,
        ], $extra);

        $this->respond($payload, $statusCode);
    }

    protected function getField($data, string $field, $default = null)
    {
        if (is_object($data) && property_exists($data, $field)) {
            return $data->{$field};
        }

        if (is_array($data) && array_key_exists($field, $data)) {
            return $data[$field];
        }

        return $default;
    }

    protected function requireFields($data, array $fields): void
    {
        foreach ($fields as $field) {
            $value = $this->getField($data, $field);
            if ($value === null || (is_string($value) && trim($value) === '')) {
                throw new InvalidArgumentException("الحقل {$field} مطلوب.");
            }
        }
    }

    protected function sanitizeText($value, string $fieldName, int $maxLength = 255, bool $allowEmpty = false): string
    {
        $value = trim(strip_tags((string) ($value ?? '')));

        if ($value === '' && !$allowEmpty) {
            throw new InvalidArgumentException("الحقل {$fieldName} مطلوب.");
        }

        if (mb_strlen($value) > $maxLength) {
            throw new InvalidArgumentException("الحقل {$fieldName} يتجاوز الطول المسموح.");
        }

        return $value;
    }

    protected function sanitizeAmount($value, string $fieldName): float
    {
        if (!is_numeric($value)) {
            throw new InvalidArgumentException("الحقل {$fieldName} يجب أن يكون رقماً صحيحاً أو عشرياً.");
        }

        $amount = round((float) $value, 2);
        if ($amount < 0) {
            throw new InvalidArgumentException("الحقل {$fieldName} لا يمكن أن يكون سالباً.");
        }

        return $amount;
    }

    protected function sanitizeInteger($value, string $fieldName, int $min = 0): int
    {
        if (filter_var($value, FILTER_VALIDATE_INT) === false) {
            throw new InvalidArgumentException("الحقل {$fieldName} يجب أن يكون عدداً صحيحاً.");
        }

        $intValue = (int) $value;
        if ($intValue < $min) {
            throw new InvalidArgumentException("الحقل {$fieldName} أقل من الحد الأدنى المسموح.");
        }

        return $intValue;
    }

    protected function extractId($rawValue, string $fieldName): int
    {
        $normalized = preg_replace('/\D+/', '', (string) $rawValue);
        if ($normalized === '') {
            throw new InvalidArgumentException("تعذر استخراج المعرّف من الحقل {$fieldName}.");
        }

        return (int) $normalized;
    }

    protected function ensureAllowedValue($value, array $allowed, string $fieldName): string
    {
        $normalized = strtoupper(trim((string) $value));
        if (!in_array($normalized, $allowed, true)) {
            throw new InvalidArgumentException("القيمة المرسلة في {$fieldName} غير مسموحة.");
        }

        return $normalized;
    }
}
