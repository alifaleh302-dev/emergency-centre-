<?php
declare(strict_types=1);

/**
 * SettingsService
 * ----------------
 * طبقة وصول موحدة لجدول system_settings.
 * تستخدم لقراءة أسعار التذاكر، حدود الفترة الصباحية، وإعدادات الترويسة
 * الديناميكية للنماذج المطبوعة (تذكرة المعاينة، إغلاق الزيارة...).
 *
 * كل القيم تُحفظ كنصوص في قاعدة البيانات؛ هذه الخدمة تتكفل بالتحويل
 * إلى int/float عند الضرورة، مع قيم افتراضية آمنة إذا غاب المفتاح.
 */
class SettingsService
{
    private PDO $conn;

    /** كاش بسيط في الذاكرة لتفادي تكرار الاستعلامات داخل نفس الطلب */
    private static array $cache = [];

    public function __construct(PDO $conn)
    {
        $this->conn = $conn;
    }

    // -------------------------------------------------------------
    // قراءة عامة
    // -------------------------------------------------------------

    public function get(string $key, ?string $default = null): ?string
    {
        if (array_key_exists($key, self::$cache)) {
            return self::$cache[$key];
        }

        $stmt = $this->conn->prepare('SELECT setting_value FROM system_settings WHERE setting_key = :k LIMIT 1');
        $stmt->execute([':k' => $key]);
        $value = $stmt->fetchColumn();

        $result = ($value === false || $value === null) ? $default : (string) $value;
        self::$cache[$key] = $result;
        return $result;
    }

    public function getInt(string $key, int $default = 0): int
    {
        $value = $this->get($key, (string) $default);
        return is_numeric($value) ? (int) $value : $default;
    }

    public function getFloat(string $key, float $default = 0.0): float
    {
        $value = $this->get($key, (string) $default);
        return is_numeric($value) ? (float) $value : $default;
    }

    /**
     * يجلب مجموعة مفاتيح كمصفوفة key=>value
     */
    public function getMany(array $keys): array
    {
        if (empty($keys)) return [];

        $placeholders = [];
        $params = [];
        foreach ($keys as $i => $k) {
            $ph = ':k' . $i;
            $placeholders[] = $ph;
            $params[$ph] = $k;
        }

        $sql = 'SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN (' . implode(',', $placeholders) . ')';
        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);

        $out = [];
        while ($row = $stmt->fetch()) {
            $out[$row['setting_key']] = (string) $row['setting_value'];
        }

        // مزامنة الكاش
        foreach ($out as $k => $v) {
            self::$cache[$k] = $v;
        }

        return $out;
    }

    // -------------------------------------------------------------
    // أسعار التذاكر + تحديد الفترة
    // -------------------------------------------------------------

    public function getMorningPrice(): float
    {
        return $this->getFloat('ticket_price_morning', 100.0);
    }

    public function getEveningPrice(): float
    {
        return $this->getFloat('ticket_price_evening', 500.0);
    }

    public function getMorningStartHour(): int
    {
        return $this->getInt('ticket_morning_start_hour', 5);
    }

    public function getMorningEndHour(): int
    {
        return $this->getInt('ticket_morning_end_hour', 12);
    }

    /**
     * يحدد نوع التذكرة (morning/evening) والمبلغ الافتراضي
     * بناءً على وقت الإنشاء وإعدادات النظام.
     *
     * @return array{type:string, amount:float}
     */
    public function resolveTicketTypeAndAmount(?DateTimeInterface $when = null): array
    {
        $hour = (int) ($when ? $when->format('G') : date('G'));
        $start = $this->getMorningStartHour();
        $end   = $this->getMorningEndHour();

        if ($hour >= $start && $hour < $end) {
            return ['type' => 'morning', 'amount' => $this->getMorningPrice()];
        }
        return ['type' => 'evening', 'amount' => $this->getEveningPrice()];
    }

    // -------------------------------------------------------------
    // إعدادات الترويسة الديناميكية للنماذج المطبوعة
    // -------------------------------------------------------------

    /**
     * يعيد كل قيم الترويسة كمصفوفة جاهزة للحقن في الواجهة.
     * يضمن وجود كل المفاتيح حتى لو غابت من DB (قيم افتراضية).
     */
    public function getHeader(): array
    {
        $keys = [
            'header_country', 'header_ministry', 'header_office',
            'header_directorate', 'header_center', 'header_admin',
            'header_form_title', 'header_logo_url',
            'header_footer_note', 'header_side_note',
        ];
        $rows = $this->getMany($keys);

        return [
            'country'      => $rows['header_country']      ?? 'الجمهورية اليمنية',
            'ministry'     => $rows['header_ministry']     ?? 'وزارة الصحة العامة والسكان',
            'office'       => $rows['header_office']       ?? 'مكتب الصحة والبيئة م/ حجة',
            'directorate'  => $rows['header_directorate']  ?? 'مكتب الصحة والبيئة بمديرية كحلان عفار',
            'center'       => $rows['header_center']       ?? 'مركز طوارئ الطرق',
            'admin'        => $rows['header_admin']        ?? 'إدارة مشاركة المجتمع',
            'form_title'   => $rows['header_form_title']   ?? 'تذكرة معاينة',
            'logo_url'     => $rows['header_logo_url']     ?? '',
            'footer_note'  => $rows['header_footer_note']  ?? '',
            'side_note'    => $rows['header_side_note']    ?? '',
        ];
    }
}
