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
        $defaults = $this->shiftService()->getDefaults();
        $dayMode = (string) ($defaults['day_mode'] ?? 'both');
        if ($dayMode === 'evening_only') {
            return 24;
        }
        return 0;
    }

    public function getMorningEndHour(): int
    {
        $defaults = $this->shiftService()->getDefaults();
        $dayMode = (string) ($defaults['day_mode'] ?? 'both');
        if ($dayMode === 'morning_only') {
            return 24;
        }
        $split = (string) ($defaults['split_time'] ?? '12:00');
        return (int) substr($split, 0, 2);
    }

    /**
     * يحدد نوع التذكرة (morning/evening) والمبلغ الافتراضي.
     *
     * إصلاح جذري (2026-06): مصدر الحقيقة لم يعد ساعات system_settings القديمة،
     * بل جدول shifts عبر ShiftService. هذا يمنع ظهور تذاكر/سندات ما بعد منتصف الليل
     * تحت الفترة المسائية عندما يكون اليوم مُعرّفاً كفترة صباحية 00:00→12:00.
     *
     * @return array{type:string, amount:float}
     */
    public function resolveTicketTypeAndAmount(?DateTimeInterface $when = null): array
    {
        $when = $when ?? new DateTimeImmutable();

        try {
            $shift = $this->shiftService()->resolveOrCreateShift($when);
            $shiftType = (string) ($shift['shift_type'] ?? '');
            if ($shiftType === 'morning') {
                return ['type' => 'morning', 'amount' => $this->getMorningPrice()];
            }
            if ($shiftType === 'evening') {
                return ['type' => 'evening', 'amount' => $this->getEveningPrice()];
            }
        } catch (Throwable $e) {
            // fallback أدناه حفاظاً على التوافق إذا تعذّر الوصول إلى shifts.
        }

        $defaults = $this->shiftService()->getDefaults();
        $dayMode = (string) ($defaults['day_mode'] ?? 'both');
        if ($dayMode === 'morning_only') {
            return ['type' => 'morning', 'amount' => $this->getMorningPrice()];
        }
        if ($dayMode === 'evening_only') {
            return ['type' => 'evening', 'amount' => $this->getEveningPrice()];
        }

        $time = $when->format('H:i');
        $split = (string) ($defaults['split_time'] ?? '12:00');
        if (strcmp($time, $split) < 0) {
            return ['type' => 'morning', 'amount' => $this->getMorningPrice()];
        }
        return ['type' => 'evening', 'amount' => $this->getEveningPrice()];
    }

    // -------------------------------------------------------------
    // 🆕 Migration 014 - حدود الفترات وقواعد ترتيب التسديد
    // -------------------------------------------------------------

    // -------------------------------------------------------------
    // 🆕 Migration 016 - الانتقال إلى ShiftService
    // -------------------------------------------------------------
    // الدوال أدناه تبقى كـ wrappers للتوافق العكسي مع الكود القديم
    // (AccountingModel, ReportsModel ...) خلال مرحلة الانتقال.
    // التطبيق الفعلي تحوّل إلى ShiftService الذي يقرأ من جدول shifts
    // (مصدر الحقيقة الجديد) بدلاً من system_settings.
    //
    // ⚠️ هذه الدوال ستُحذف من SettingsService في المرحلة 4
    // بعد ترحيل جميع المستدعيات إلى ShiftService.
    // -------------------------------------------------------------

    /** كاش لـ ShiftService لتفادي إنشاء instance جديد في كل استدعاء */
    private ?ShiftService $shiftService = null;

    private function shiftService(): ShiftService
    {
        return $this->shiftService ??= new ShiftService($this->conn, $this);
    }

    /**
     * @deprecated استخدم ShiftService::getShiftBoundariesForDate(date('Y-m-d'))
     * تُحتفظ بها للتوافق مع كود قديم في الواجهة.
     */
    public function getShiftBoundaries(): array
    {
        $defaults = $this->shiftService()->getDefaults();
        $split    = $defaults['split_time']; // HH:MM

        return [
            'morning_start' => '00:00',
            'morning_end'   => $split,
            'evening_start' => $split,
            'evening_end'   => '23:59',
            // الفجوة الليلية لم تعد موجودة في النموذج الجديد
            'overnight_belongs_to' => 'morning_same_day',
        ];
    }

    /**
     * @deprecated استخدم ShiftService::resolveShiftFor() أو resolveOrCreateShift()
     * يُرجع شكلاً مبسّطاً متوافقاً مع المستدعيات القديمة.
     *
     * المنطق:
     *   1. محاولة قراءة الفترة من جدول shifts (المصدر الجديد).
     *   2. إذا لم تُوجد، نستنتج من الافتراضي بدون إنشاء سجل (لتفادي
     *      آثار جانبية في مسارات القراءة فقط).
     */
    public function resolveShiftFor(DateTimeInterface $when): array
    {
        $shift = $this->shiftService()->resolveShiftFor($when);
        if ($shift !== null) {
            return [
                'shift_type'   => (string) $shift['shift_type'],
                'shift_date'   => (string) $shift['shift_date'],
                'in_dead_zone' => false,
            ];
        }

        // Fallback: استنتاج من الافتراضي بدون لمس قاعدة البيانات
        $dateStr = $when->format('Y-m-d');
        $timeStr = $when->format('H:i');
        $split   = $this->shiftService()->getDefaults()['split_time'];

        $type = strcmp($timeStr, $split) < 0 ? 'morning' : 'evening';
        return [
            'shift_type'   => $type,
            'shift_date'   => $dateStr,
            'in_dead_zone' => false,
        ];
    }

    /**
     * @deprecated استخدم ShiftService::getPreviousShiftRef()
     */
    public function getPreviousShift(string $shiftType, string $shiftDate): array
    {
        return $this->shiftService()->getPreviousShiftRef($shiftType, $shiftDate);
    }

    /**
     * @deprecated استخدم ShiftService::describeShift()
     */
    public function describeShift(string $shiftType, string $shiftDate): string
    {
        return $this->shiftService()->describeShift($shiftType, $shiftDate);
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
