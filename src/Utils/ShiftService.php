<?php
declare(strict_types=1);

/**
 * ShiftService
 * ------------
 * طبقة وصول موحّدة لجدول `shifts` (تعريف الفترات اليومية) — يحلّ محل دوال
 * الفترات التي كانت سابقاً في SettingsService.
 *
 * الفرق الجوهري عن SettingsService:
 *   - SettingsService كان يقرأ حدود "عامّة وثابتة" من system_settings،
 *     مما يجعل التقارير التاريخية تتأثّر بأي تغيير لاحق في الإعدادات.
 *   - ShiftService يقرأ "حدود اليوم نفسه" من جدول shifts، فيضمن صحّة
 *     التقارير 100% حتى لو غُيِّرت الإعدادات لاحقاً.
 *
 * المسؤوليات:
 *   1. تحديد الفترة المطابقة لوقت معيّن (resolveShiftFor / resolveOrCreateShift).
 *   2. إنشاء فترات يوم جديد من الإعدادات الافتراضية تلقائياً (lazy).
 *   3. تزويد التقارير بحدود اليوم المحفوظة.
 *   4. تحديد متى تبدأ الفترة التالية (لمنع إعادة الفتح بعد بدئها).
 *
 * الاعتمادات:
 *   - SettingsService: لقراءة القيم الافتراضية (split_time, day_mode) فقط.
 *   - PostgreSQL: TIME comparisons تستخدم SQL لتجنّب أخطاء المنطقة الزمنية.
 *
 * 🆕 Migration 016 (المرحلة 2 من خطة SHIFTS_REFACTOR_PLAN.md)
 */
class ShiftService
{
    private PDO $conn;
    private SettingsService $settings;

    /** كاش بسيط داخل نفس الطلب (key = shift_date|shift_type) */
    private array $shiftCache = [];

    /** كاش الحدود الافتراضية */
    private ?array $defaultsCache = null;

    /**
     * معرّف مستخدم النظام للإقفال التلقائي (يُسجَّل في shifts.closed_by).
     * يتطابق مع المستخدم __system__ المُنشأ في Migration 016.
     */
    public const SYSTEM_USER_ID = 0;

    public function __construct(PDO $conn, ?SettingsService $settings = null)
    {
        $this->conn = $conn;
        $this->settings = $settings ?? new SettingsService($conn);
    }

    // =================================================================
    // (1) قراءة الإعدادات الافتراضية
    // =================================================================

    /**
     * يُرجع الإعدادات الافتراضية لإنشاء أيام جديدة:
     *   - split_time:   نقطة التقسيم الافتراضية (HH:MM)
     *   - day_mode:     both | morning_only | evening_only
     *   - auto_close:   هل الإقفال التلقائي مفعّل
     *   - system_user_id: مستخدم النظام
     *
     * @return array{split_time:string, day_mode:string, auto_close_enabled:bool, system_user_id:int}
     */
    public function getDefaults(): array
    {
        if ($this->defaultsCache !== null) {
            return $this->defaultsCache;
        }

        $rows = $this->settings->getMany([
            'shift_default_split_time',
            'shift_default_day_mode',
            'shift_auto_close_enabled',
            'shift_system_user_id',
        ]);

        $splitTime = $this->normalizeTime($rows['shift_default_split_time'] ?? '12:00', '12:00');
        $dayMode   = $rows['shift_default_day_mode'] ?? 'both';
        if (!in_array($dayMode, ['both', 'morning_only', 'evening_only'], true)) {
            $dayMode = 'both';
        }
        $autoClose = $this->parseBool($rows['shift_auto_close_enabled'] ?? 'true');
        $sysUser   = isset($rows['shift_system_user_id']) && is_numeric($rows['shift_system_user_id'])
            ? (int) $rows['shift_system_user_id']
            : self::SYSTEM_USER_ID;

        return $this->defaultsCache = [
            'split_time'         => $splitTime,
            'day_mode'           => $dayMode,
            'auto_close_enabled' => $autoClose,
            'system_user_id'     => $sysUser,
        ];
    }

    // =================================================================
    // (2) تحديد الفترة المطابقة لوقت معيّن (read-only)
    // =================================================================

    /**
     * يُرجع الفترة المطابقة لوقت محدد إن وُجدت في جدول shifts.
     * لا يُنشئ سجلات جديدة — للقراءة فقط.
     *
     * @return array|null  ['shift_id', 'shift_date', 'shift_type', 'start_time', 'end_time', 'day_mode', 'status']
     */
    public function resolveShiftFor(DateTimeInterface $when): ?array
    {
        $localDate = $when->format('Y-m-d');
        $localTime = $when->format('H:i:s');

        $cacheKey = $localDate . '|' . $localTime;
        if (array_key_exists($cacheKey, $this->shiftCache)) {
            return $this->shiftCache[$cacheKey];
        }

        // ابحث عن الفترة التي يقع $localTime ضمن نطاقها لذلك التاريخ
        // ملاحظة: end_time حصري (exclusive)
        $sql = "SELECT shift_id, shift_date, shift_type, start_time, end_time,
                       day_mode, status, closure_id, auto_closed, closed_at, closed_by
                FROM shifts
                WHERE shift_date = :sd
                  AND start_time <= :tt
                  AND end_time   >  :tt
                LIMIT 1";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute([':sd' => $localDate, ':tt' => $localTime]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        $result = $row ?: null;
        $this->shiftCache[$cacheKey] = $result;
        return $result;
    }

    /**
     * يُرجع الفترة المطابقة لوقت معيّن — وينشئ سجلات اليوم من الافتراضي إن لم
     * تكن موجودة. يُستخدم عند إنشاء زيارة جديدة أو سند جديد.
     *
     * @throws RuntimeException إذا تعذّر إنشاء/تحديد الفترة (حالة استثنائية)
     * @return array  ['shift_id', 'shift_date', 'shift_type', 'start_time', 'end_time', 'day_mode', 'status', ...]
     */
    public function resolveOrCreateShift(?DateTimeInterface $when = null): array
    {
        $when = $when ?? new DateTimeImmutable();

        // محاولة 1: قراءة مباشرة
        $shift = $this->resolveShiftFor($when);
        if ($shift !== null) {
            return $shift;
        }

        // محاولة 2: إنشاء فترات اليوم من الافتراضي ثم إعادة القراءة
        $this->ensureDayDefined($when->format('Y-m-d'));
        $this->shiftCache = []; // إبطال الكاش

        $shift = $this->resolveShiftFor($when);
        if ($shift !== null) {
            return $shift;
        }

        // حالة استثنائية: day_mode لا يغطّي هذا الوقت (مثلاً morning_only ووقتنا بعد الظهر)
        // في هذه الحالة نُرجع الفترة الموجودة لذلك اليوم كأقرب تطابق منطقي.
        $stmt = $this->conn->prepare(
            "SELECT shift_id, shift_date, shift_type, start_time, end_time,
                    day_mode, status, closure_id, auto_closed, closed_at, closed_by
             FROM shifts
             WHERE shift_date = :sd
             ORDER BY start_time ASC
             LIMIT 1"
        );
        $stmt->execute([':sd' => $when->format('Y-m-d')]);
        $fallback = $stmt->fetch(PDO::FETCH_ASSOC);

        if ($fallback) {
            return $fallback;
        }

        throw new RuntimeException(
            'تعذّر تحديد الفترة المالية للوقت: ' . $when->format('Y-m-d H:i:s')
        );
    }

    /**
     * يُنشئ فترات يوم محدّد من الإعدادات الافتراضية إن لم تكن موجودة.
     * يحترم day_mode الافتراضي:
     *   - both          → فترتان (صباحية + مسائية)
     *   - morning_only  → فترة صباحية واحدة تغطّي اليوم كله
     *   - evening_only  → فترة مسائية واحدة تغطّي اليوم كله
     *
     * @return array قائمة الفترات المُنشأة (قد تكون فارغة إذا كانت موجودة مسبقاً)
     */
    public function ensureDayDefined(string $shiftDate): array
    {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $shiftDate)) {
            throw new InvalidArgumentException('صيغة التاريخ غير صالحة (المتوقع YYYY-MM-DD).');
        }

        $defaults = $this->getDefaults();
        $split    = $defaults['split_time'];
        $mode     = $defaults['day_mode'];

        // فحص الوجود
        $existsStmt = $this->conn->prepare(
            "SELECT shift_type FROM shifts WHERE shift_date = :sd"
        );
        $existsStmt->execute([':sd' => $shiftDate]);
        $existing = $existsStmt->fetchAll(PDO::FETCH_COLUMN) ?: [];

        $created = [];

        // مولّد سجلات الفترات حسب الوضع
        $rows = $this->buildDayRows($shiftDate, $mode, $split);

        $insertStmt = $this->conn->prepare(
            "INSERT INTO shifts (shift_date, shift_type, start_time, end_time, day_mode, status)
             VALUES (:sd, :st, :start, :end, :mode, 'open')
             ON CONFLICT (shift_date, shift_type) DO NOTHING
             RETURNING shift_id, shift_date, shift_type, start_time, end_time, day_mode, status"
        );

        foreach ($rows as $row) {
            if (in_array($row['shift_type'], $existing, true)) {
                continue;
            }
            $insertStmt->execute([
                ':sd'    => $row['shift_date'],
                ':st'    => $row['shift_type'],
                ':start' => $row['start_time'],
                ':end'   => $row['end_time'],
                ':mode'  => $row['day_mode'],
            ]);
            $inserted = $insertStmt->fetch(PDO::FETCH_ASSOC);
            if ($inserted) {
                $created[] = $inserted;
            }
        }

        return $created;
    }

    /**
     * يبني صفوف الفترات لإدراجها في يوم محدّد بناءً على وضع التقسيم.
     */
    private function buildDayRows(string $shiftDate, string $mode, string $splitTime): array
    {
        // ملاحظة: نستخدم 23:59:59 بدلاً من 24:00 لأن TIME في PG لا تقبل '24:00' كقيمة
        // قانونية في كل النسخ. هذه القيمة تكفي عملياً لأن start_time/end_time
        // تستخدم في مقارنة شاملة وحصرية.
        $endOfDay = '23:59:59';

        switch ($mode) {
            case 'morning_only':
                return [[
                    'shift_date' => $shiftDate,
                    'shift_type' => 'morning',
                    'start_time' => '00:00:00',
                    'end_time'   => $endOfDay,
                    'day_mode'   => 'morning_only',
                ]];

            case 'evening_only':
                return [[
                    'shift_date' => $shiftDate,
                    'shift_type' => 'evening',
                    'start_time' => '00:00:00',
                    'end_time'   => $endOfDay,
                    'day_mode'   => 'evening_only',
                ]];

            case 'both':
            default:
                $split = $this->normalizeTime($splitTime, '12:00') . ':00';
                return [
                    [
                        'shift_date' => $shiftDate,
                        'shift_type' => 'morning',
                        'start_time' => '00:00:00',
                        'end_time'   => $split,
                        'day_mode'   => 'both',
                    ],
                    [
                        'shift_date' => $shiftDate,
                        'shift_type' => 'evening',
                        'start_time' => $split,
                        'end_time'   => $endOfDay,
                        'day_mode'   => 'both',
                    ],
                ];
        }
    }

    // =================================================================
    // (3) خدمات الاستعلام للتقارير والإقفال
    // =================================================================

    /**
     * يُرجع حدود الفترات ليوم محدّد (للتقارير).
     *
     * @return array قائمة الفترات الموجودة في الجدول لذلك اليوم
     */
    public function getShiftBoundariesForDate(string $shiftDate): array
    {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $shiftDate)) {
            throw new InvalidArgumentException('صيغة التاريخ غير صالحة.');
        }

        $stmt = $this->conn->prepare(
            "SELECT shift_id, shift_date, shift_type, start_time, end_time,
                    day_mode, status, closure_id, auto_closed, closed_at, closed_by
             FROM shifts
             WHERE shift_date = :sd
             ORDER BY start_time ASC"
        );
        $stmt->execute([':sd' => $shiftDate]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    /**
     * يُرجع الفترة المفتوحة الحالية المطابقة لوقت "الآن".
     * تُستخدم في الـ middleware lazy للإقفال التلقائي.
     */
    public function getCurrentShift(): ?array
    {
        return $this->resolveShiftFor(new DateTimeImmutable());
    }

    /**
     * يفحص ما إذا كانت الفترة لا تزال ضمن نافذتها الزمنية (لم ينتهِ end_time).
     * يُستخدم في الإقفال التلقائي لمعرفة "هل انتهى وقت الفترة؟".
     */
    public function isShiftActive(int $shiftId): bool
    {
        $stmt = $this->conn->prepare(
            "SELECT shift_date, end_time, status
             FROM shifts WHERE shift_id = :id LIMIT 1"
        );
        $stmt->execute([':id' => $shiftId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            return false;
        }
        if ((string) $row['status'] !== 'open') {
            return false;
        }

        $now = new DateTimeImmutable();
        try {
            $endDt = new DateTimeImmutable($row['shift_date'] . ' ' . $row['end_time']);
        } catch (Throwable $e) {
            return false;
        }

        return $now < $endDt;
    }

    /**
     * يُرجع وقت بداية الفترة التالية لفترة محدّدة.
     * يُستخدم في AdminModel::reopenLatestShift لمنع إعادة الفتح بعد بدء الفترة التالية.
     *
     * المنطق:
     *   - إذا كانت الفترة الحالية = morning، فالتالية = evening من نفس اليوم.
     *   - إذا كانت الفترة الحالية = evening، فالتالية = morning من اليوم التالي.
     *   - إذا day_mode لا يدعم وجود فترة تالية في نفس اليوم (morning_only/evening_only)،
     *     ننتقل لليوم التالي.
     */
    public function getNextShiftStartTime(int $shiftId): ?DateTimeImmutable
    {
        $stmt = $this->conn->prepare(
            "SELECT shift_date, shift_type, end_time, day_mode
             FROM shifts WHERE shift_id = :id LIMIT 1"
        );
        $stmt->execute([':id' => $shiftId]);
        $current = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$current) {
            return null;
        }

        // محاولة 1: ابحث عن فترة لاحقة في نفس اليوم (start_time > current.end_time)
        $nextSameDay = $this->conn->prepare(
            "SELECT shift_date, start_time FROM shifts
             WHERE shift_date = :sd AND start_time >= :et
             ORDER BY start_time ASC LIMIT 1"
        );
        $nextSameDay->execute([
            ':sd' => $current['shift_date'],
            ':et' => $current['end_time'],
        ]);
        $next = $nextSameDay->fetch(PDO::FETCH_ASSOC);

        if ($next) {
            return new DateTimeImmutable($next['shift_date'] . ' ' . $next['start_time']);
        }

        // محاولة 2: أوّل فترة في يوم لاحق
        $nextNextDay = $this->conn->prepare(
            "SELECT shift_date, start_time FROM shifts
             WHERE shift_date > :sd
             ORDER BY shift_date ASC, start_time ASC LIMIT 1"
        );
        $nextNextDay->execute([':sd' => $current['shift_date']]);
        $next = $nextNextDay->fetch(PDO::FETCH_ASSOC);

        if ($next) {
            return new DateTimeImmutable($next['shift_date'] . ' ' . $next['start_time']);
        }

        // محاولة 3: لا توجد فترات تالية مُعرَّفة — نستنتج من الافتراضي
        // الفترة التالية تبدأ في بداية اليوم التالي
        $nextDate = (new DateTimeImmutable($current['shift_date']))->modify('+1 day');
        return $nextDate->setTime(0, 0, 0);
    }

    /**
     * يُرجع الفترة السابقة لفترة محدّدة (نوع وتاريخ).
     * يُستخدم في فحص ترتيب التسديد (findBlockingPreviousShift).
     *
     * @return array  ['shift_type', 'shift_date']
     */
    public function getPreviousShiftRef(string $shiftType, string $shiftDate): array
    {
        if (!in_array($shiftType, ['morning', 'evening'], true)) {
            throw new InvalidArgumentException('نوع الفترة غير صالح.');
        }
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $shiftDate)) {
            throw new InvalidArgumentException('صيغة تاريخ الفترة غير صالحة.');
        }

        // إذا كانت الفترة الحالية مسائية، فالسابقة صباحية من نفس اليوم
        if ($shiftType === 'evening') {
            return ['shift_type' => 'morning', 'shift_date' => $shiftDate];
        }

        // إذا كانت الفترة الحالية صباحية، فالسابقة مسائية من اليوم السابق
        $prevDay = (new DateTimeImmutable($shiftDate))->modify('-1 day')->format('Y-m-d');
        return ['shift_type' => 'evening', 'shift_date' => $prevDay];
    }

    /**
     * وصف نصّي للفترة (للرسائل والـ logs).
     */
    public function describeShift(string $shiftType, string $shiftDate): string
    {
        $label = $shiftType === 'morning' ? 'الصباحية' : 'المسائية';
        return "الفترة {$label} ليوم {$shiftDate}";
    }

    // =================================================================
    // (4) عمليات الإقفال — أدوات مساعدة (Read-only)
    // يستخدمها AccountingModel في المراحل اللاحقة (3+).
    // =================================================================

    /**
     * يُرجع جميع الفترات المنتهية زمنياً والتي لا تزال status='open'.
     * يُستخدم في runAutoClosurePass لاحقاً.
     */
    public function findOpenExpiredShifts(): array
    {
        // فترة منتهية = (shift_date + end_time) < NOW() المحلية
        $sql = "SELECT shift_id, shift_date, shift_type, start_time, end_time,
                       day_mode, status
                FROM shifts
                WHERE status = 'open'
                  AND (shift_date + end_time) < (NOW() AT TIME ZONE COALESCE(current_setting('TIMEZONE', true), 'Asia/Aden'))
                ORDER BY shift_date ASC, start_time ASC";
        $stmt = $this->conn->query($sql);
        return $stmt ? ($stmt->fetchAll(PDO::FETCH_ASSOC) ?: []) : [];
    }

    /**
     * يُحدّث حالة الفترة إلى 'closed' مع تسجيل بيانات الإقفال.
     * يُستدعى من AccountingModel::closeShift (المرحلة 3).
     *
     * @return bool true إذا تم التحديث (لم تكن مغلقة من قبل)
     */
    public function markShiftClosed(
        int  $shiftId,
        int  $closedBy,
        bool $autoClosed = false,
        ?int $closureId  = null
    ): bool {
        $stmt = $this->conn->prepare(
            "UPDATE shifts
                SET status      = 'closed',
                    closed_at   = CURRENT_TIMESTAMP,
                    closed_by   = :uid,
                    auto_closed = :auto,
                    closure_id  = COALESCE(:cid, closure_id),
                    updated_at  = CURRENT_TIMESTAMP
              WHERE shift_id = :id
                AND status   = 'open'"
        );
        $stmt->execute([
            ':uid'  => $closedBy,
            ':auto' => $autoClosed ? 't' : 'f',
            ':cid'  => $closureId,
            ':id'   => $shiftId,
        ]);
        return $stmt->rowCount() > 0;
    }

    /**
     * يُعيد الفترة إلى 'open' (يُستدعى من إعادة الفتح).
     */
    public function markShiftOpen(int $shiftId): bool
    {
        $stmt = $this->conn->prepare(
            "UPDATE shifts
                SET status      = 'open',
                    closed_at   = NULL,
                    closed_by   = NULL,
                    auto_closed = FALSE,
                    closure_id  = NULL,
                    updated_at  = CURRENT_TIMESTAMP
              WHERE shift_id = :id"
        );
        $stmt->execute([':id' => $shiftId]);
        return $stmt->rowCount() > 0;
    }

    /**
     * يفحص ما إذا كان يوم محدّد يحوي فترة واحدة على الأقل مُقفلة.
     * يُستخدم لمنع تعديل حدود يوم تحوي فيه فترة closed.
     */
    public function hasClosedShiftOnDate(string $shiftDate): bool
    {
        $stmt = $this->conn->prepare(
            "SELECT 1 FROM shifts
             WHERE shift_date = :sd AND status = 'closed' LIMIT 1"
        );
        $stmt->execute([':sd' => $shiftDate]);
        return $stmt->fetchColumn() !== false;
    }

    // =================================================================
    // (5) أدوات مساعدة داخلية
    // =================================================================

    /**
     * يُطبّع قيمة وقت إلى صيغة HH:MM.
     */
    private function normalizeTime(?string $value, string $default): string
    {
        $value = trim((string) ($value ?? ''));
        if ($value === '') {
            return $default;
        }
        if (preg_match('/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?$/', $value, $m)) {
            $h  = max(0, min(23, (int) $m[1]));
            $mn = isset($m[2]) ? max(0, min(59, (int) $m[2])) : 0;
            return sprintf('%02d:%02d', $h, $mn);
        }
        return $default;
    }

    /**
     * يُحوّل قيمة نصية إلى bool (yes/true/1/on).
     */
    private function parseBool(?string $value): bool
    {
        $v = strtolower(trim((string) ($value ?? '')));
        return in_array($v, ['1', 'true', 'yes', 'on'], true);
    }

    /**
     * إبطال الكاش الداخلي (يُستدعى بعد عمليات الإقفال/الفتح).
     */
    public function invalidateCache(): void
    {
        $this->shiftCache = [];
        $this->defaultsCache = null;
    }
}
