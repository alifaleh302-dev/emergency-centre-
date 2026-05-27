<?php
declare(strict_types=1);

/**
 * SchemaCache — كاش ثابت على القرص لمخطط قاعدة البيانات.
 *
 * الفكرة:
 *   • getSchema() في AdminModel كان يُنفِّذ عشرات الاستعلامات على information_schema
 *     لكل طلب HTTP، حتى لو لم يتغير المخطط (يتغير المخطط فقط عند migration).
 *   • هذا الكاش يحفظ النتيجة في ملف tmp مع TTL قابل للتعديل.
 *   • لا اعتماد على Redis/APCu، يعمل في أي بيئة استضافة بما فيها Render.
 *   • آمن تماماً: لو حدث أي خطأ في القراءة، نرجع null ونعيد البناء.
 */
class SchemaCache
{
    private const DEFAULT_TTL = 300; // 5 دقائق — كافٍ بين النشرات

    private string $path;
    private int $ttl;

    public function __construct(?string $path = null, ?int $ttl = null)
    {
        // أولوية: APP_SCHEMA_CACHE_PATH > /tmp > sys_get_temp_dir
        $defaultPath = (getenv('APP_SCHEMA_CACHE_PATH') ?: sys_get_temp_dir())
            . '/emergency_centre_schema.cache';
        $this->path = $path ?? $defaultPath;
        $this->ttl  = $ttl ?? (int) (getenv('APP_SCHEMA_CACHE_TTL') ?: self::DEFAULT_TTL);
    }

    public function get(): ?array
    {
        try {
            if (!is_file($this->path)) {
                return null;
            }
            $mtime = filemtime($this->path);
            if ($mtime === false || (time() - $mtime) > $this->ttl) {
                return null;
            }
            $raw = @file_get_contents($this->path);
            if ($raw === false || $raw === '') {
                return null;
            }
            $decoded = json_decode($raw, true);
            return is_array($decoded) ? $decoded : null;
        } catch (Throwable $e) {
            return null;
        }
    }

    public function set(array $schema): void
    {
        try {
            $encoded = json_encode($schema, JSON_UNESCAPED_UNICODE);
            if ($encoded === false) {
                return;
            }
            // الكتابة الذرية: ملف مؤقت ثم rename
            $tmp = $this->path . '.tmp.' . bin2hex(random_bytes(4));
            if (@file_put_contents($tmp, $encoded, LOCK_EX) !== false) {
                @rename($tmp, $this->path);
            }
        } catch (Throwable $e) {
            // فشل الكتابة ليس خطأ يُوقف الطلب
        }
    }

    public function invalidate(): void
    {
        if (is_file($this->path)) {
            @unlink($this->path);
        }
    }

    public function getPath(): string
    {
        return $this->path;
    }
}
