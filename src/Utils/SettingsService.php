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
    // 🆕 Migration 014 - حدود الفترات وقواعد ترتيب التسديد
    // -------------------------------------------------------------

    public function getShiftBoundaries(): array
    {
        $rows = $this->getMany([
            'shift_morning_start', 'shift_morning_end',
            'shift_evening_start', 'shift_evening_end',
            'shift_overnight_belongs_to',
        ]);

        $normalize = static function (?string $value, string $default): string {
            $value = trim((string) ($value ?? ''));
            if ($value === '') return $default;
            if (preg_match('/^(\d{1,2})(?::(\d{2}))?$/', $value, $m)) {
                $h = max(0, min(23, (int) $m[1]));
                $mn = isset($m[2]) ? max(0, min(59, (int) $m[2])) : 0;
                return sprintf('%02d:%02d', $h, $mn);
            }
            return $default;
        };

        return [
            'morning_start' => $normalize($rows['shift_morning_start'] ?? null, '05:00'),
            'morning_end'   => $normalize($rows['shift_morning_end'] ?? null, '12:00'),
            'evening_start' => $normalize($rows['shift_evening_start'] ?? null, '12:00'),
            'evening_end'   => $normalize($rows['shift_evening_end'] ?? null, '23:00'),
            'overnight_belongs_to' => in_array(
                $rows['shift_overnight_belongs_to'] ?? 'evening_prev_day',
                ['evening_prev_day', 'dead_zone', 'morning_same_day'],
                true
            ) ? ($rows['shift_overnight_belongs_to'] ?? 'evening_prev_day') : 'evening_prev_day',
        ];
    }

    public function resolveShiftFor(DateTimeInterface $when): array
    {
        $b = $this->getShiftBoundaries();
        $timeStr = $when->format('H:i');
        $dateStr = $when->format('Y-m-d');

        if (strcmp($timeStr, $b['morning_start']) >= 0 && strcmp($timeStr, $b['morning_end']) < 0) {
            return ['shift_type' => 'morning', 'shift_date' => $dateStr, 'in_dead_zone' => false];
        }

        if (strcmp($timeStr, $b['evening_start']) >= 0 && strcmp($timeStr, $b['evening_end']) < 0) {
            return ['shift_type' => 'evening', 'shift_date' => $dateStr, 'in_dead_zone' => false];
        }

        switch ($b['overnight_belongs_to']) {
            case 'morning_same_day':
                if (strcmp($timeStr, $b['morning_start']) < 0) {
                    return ['shift_type' => 'morning', 'shift_date' => $dateStr, 'in_dead_zone' => false];
                }
                $nextDay = (new DateTimeImmutable($dateStr))->modify('+1 day')->format('Y-m-d');
                return ['shift_type' => 'morning', 'shift_date' => $nextDay, 'in_dead_zone' => false];
            case 'dead_zone':
                return ['shift_type' => 'evening', 'shift_date' => $dateStr, 'in_dead_zone' => true];
            case 'evening_prev_day':
            default:
                if (strcmp($timeStr, $b['morning_start']) < 0) {
                    $prevDay = (new DateTimeImmutable($dateStr))->modify('-1 day')->format('Y-m-d');
                    return ['shift_type' => 'evening', 'shift_date' => $prevDay, 'in_dead_zone' => false];
                }
                return ['shift_type' => 'evening', 'shift_date' => $dateStr, 'in_dead_zone' => false];
        }
    }

    public function getPreviousShift(string $shiftType, string $shiftDate): array
    {
        if (!in_array($shiftType, ['morning', 'evening'], true)) {
            throw new InvalidArgumentException('نوع الفترة غير صالح.');
        }
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $shiftDate)) {
            throw new InvalidArgumentException('صيغة تاريخ الفترة غير صالحة.');
        }

        if ($shiftType === 'evening') {
            return ['shift_type' => 'morning', 'shift_date' => $shiftDate];
        }

        $prevDay = (new DateTimeImmutable($shiftDate))->modify('-1 day')->format('Y-m-d');
        return ['shift_type' => 'evening', 'shift_date' => $prevDay];
    }

    public function describeShift(string $shiftType, string $shiftDate): string
    {
        $label = $shiftType === 'morning' ? 'الصباحية' : 'المسائية';
        return "الفترة {$label} ليوم {$shiftDate}";
    }

    public function isPaymentOrderEnforced(): bool
    {
        $value = strtolower((string) ($this->get('enforce_shift_payment_order', 'true') ?? 'true'));
        return in_array($value, ['true', '1', 'yes', 'on'], true);
    }

    public function allowsZeroPreviousImplicitClose(): bool
    {
        $value = strtolower((string) ($this->get('allow_zero_invoices_implicit_close', 'true') ?? 'true'));
        return in_array($value, ['true', '1', 'yes', 'on'], true);
    }

    public function allowsAdminPaymentOverride(): bool
    {
        $value = strtolower((string) ($this->get('allow_admin_payment_override', 'true') ?? 'true'));
        return in_array($value, ['true', '1', 'yes', 'on'], true);
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
