-- =====================================================================
-- 016_shifts_master_table_and_visit_link.sql
-- إنشاء جدول `shifts` كمصدر تعريف الفترات اليومية + ربط الزيارات به
-- + تنظيف إعدادات system_settings + Backfill للبيانات التاريخية
-- =====================================================================
-- المنطق الجديد (وفقاً لخطة SHIFTS_REFACTOR_PLAN.md):
--
--   • جدول `shifts` يحفظ "تعريف" الفترة لكل يوم (بداية/نهاية، الوضع، الحالة).
--   • `visits.shift_id` يربط كل زيارة بفترتها (قرار هندسي: الفترة ترتبط بالزيارة).
--   • نموذج اليوم الافتراضي: صباحية 00:00→12:00 + مسائية 12:00→24:00 (لا فجوة).
--   • مستخدم النظام (user_id=0) يُحجَز لعمليات الإقفال التلقائي.
--   • Backfill: ينشئ سجلات shifts من shifts_closures القديمة، ويربط الزيارات
--     التاريخية بفتراتها استناداً إلى visit_date.
-- =====================================================================

BEGIN;

-- =====================================================================
-- 1) مستخدم النظام (user_id = 0) للإقفال التلقائي
-- =====================================================================
-- نُدخل سجل "نظام" بمعرّف صفر ليُسجَّل كـ closed_by في عمليات الإقفال التلقائي.
-- نستخدم OVERRIDING SYSTEM VALUE فقط إذا كان user_id من نوع IDENTITY،
-- وإلا INSERT عادي ثم نتأكد ألا يُولّد الـ sequence هذا الرقم.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM users WHERE user_id = 0) THEN
        INSERT INTO users (user_id, username, password_hash, full_name, email, phone, role_id, is_active)
        VALUES (
            0,
            '__system__',
            -- كلمة سر معطّلة (hash لا يطابق أي قيمة)
            '$2y$10$DISABLED.SYSTEM.ACCOUNT.NEVER.LOGIN.XXXXXXXXXXXXXXXXXXXXXX',
            'مستخدم النظام (الإقفال التلقائي)',
            NULL,
            NULL,
            -- نستخدم role_id الخاص بأمين الصندوق (2) كأقرب مطابقة منطقية
            (SELECT role_id FROM roles WHERE role_code = 2 LIMIT 1),
            FALSE
        );
    ELSE
        -- لو موجود سابقاً، تأكّد من أنه معطّل
        UPDATE users
           SET is_active = FALSE,
               username  = '__system__',
               full_name = 'مستخدم النظام (الإقفال التلقائي)'
         WHERE user_id = 0;
    END IF;
END $$;

-- =====================================================================
-- 2) جدول `shifts` — تعريف الفترات اليومية (Master)
-- =====================================================================
CREATE TABLE IF NOT EXISTS shifts (
    shift_id          SERIAL PRIMARY KEY,

    -- تاريخ يوم الفترة
    shift_date        DATE NOT NULL,

    -- نوع الفترة (صباحية / مسائية)
    shift_type        VARCHAR(10) NOT NULL
                      CHECK (shift_type IN ('morning','evening')),

    -- حدود الفترة لذلك اليوم (TIME WITHOUT TZ)
    -- ملاحظة: end_time = '24:00:00' غير صالحة في TIME، لذا نستخدم '00:00:00'
    --        لليوم التالي ونعتمد على day_mode لمنع الالتباس. ولأن PostgreSQL
    --        يقبل '24:00' في TIME ويحوّلها داخلياً، نسمح بها أيضاً.
    start_time        TIME NOT NULL,
    end_time          TIME NOT NULL,

    -- وضع التقسيم لذلك اليوم
    --   both          = اليوم مقسّم لفترتين
    --   morning_only  = اليوم كله صباحي (لا توجد فترة مسائية)
    --   evening_only  = اليوم كله مسائي (لا توجد فترة صباحية)
    day_mode          VARCHAR(20) NOT NULL DEFAULT 'both'
                      CHECK (day_mode IN ('both','morning_only','evening_only')),

    -- حالة الفترة
    status            VARCHAR(10) NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','closed')),

    -- ربط بسجل الإقفال (shifts_closures) إن وُجد
    closure_id        INTEGER,

    -- بيانات الإقفال
    auto_closed       BOOLEAN     NOT NULL DEFAULT FALSE,
    closed_at         TIMESTAMPTZ,
    closed_by         INTEGER,

    -- تواريخ تقنية
    created_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- لا يوجد سوى سجل واحد لكل (تاريخ، نوع)
    CONSTRAINT uq_shifts_date_type UNIQUE (shift_date, shift_type)
);

-- المفاتيح الأجنبية تُضاف بعد إنشاء الجدول لتفادي مشاكل الترتيب
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_shifts_closure_id'
          AND conrelid = 'shifts'::regclass
    ) THEN
        ALTER TABLE shifts
            ADD CONSTRAINT fk_shifts_closure_id
            FOREIGN KEY (closure_id)
            REFERENCES shifts_closures(id)
            ON UPDATE CASCADE ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_shifts_closed_by'
          AND conrelid = 'shifts'::regclass
    ) THEN
        ALTER TABLE shifts
            ADD CONSTRAINT fk_shifts_closed_by
            FOREIGN KEY (closed_by)
            REFERENCES users(user_id)
            ON UPDATE CASCADE ON DELETE SET NULL;
    END IF;
END $$;

-- الفهارس
CREATE INDEX IF NOT EXISTS idx_shifts_date     ON shifts(shift_date DESC);
CREATE INDEX IF NOT EXISTS idx_shifts_status   ON shifts(status);
CREATE INDEX IF NOT EXISTS idx_shifts_closure  ON shifts(closure_id) WHERE closure_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shifts_type     ON shifts(shift_type);
CREATE INDEX IF NOT EXISTS idx_shifts_date_status ON shifts(shift_date, status);

-- Trigger لتحديث updated_at تلقائياً (إن وُجدت الدالة المساعدة)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at'
    ) THEN
        DROP TRIGGER IF EXISTS trg_shifts_updated_at ON shifts;
        CREATE TRIGGER trg_shifts_updated_at
        BEFORE UPDATE ON shifts
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
END $$;

COMMENT ON TABLE  shifts             IS 'تعريف الفترات اليومية (Master). كل سجل = فترة محددة في يوم محدد بحدودها وحالتها.';
COMMENT ON COLUMN shifts.shift_date  IS 'تاريخ يوم الفترة';
COMMENT ON COLUMN shifts.shift_type  IS 'نوع الفترة: morning أو evening';
COMMENT ON COLUMN shifts.start_time  IS 'وقت بداية الفترة (TIME)';
COMMENT ON COLUMN shifts.end_time    IS 'وقت نهاية الفترة (TIME) — حصري (exclusive)';
COMMENT ON COLUMN shifts.day_mode    IS 'وضع تقسيم اليوم: both / morning_only / evening_only';
COMMENT ON COLUMN shifts.status      IS 'حالة الفترة: open (مفتوحة) / closed (مغلقة)';
COMMENT ON COLUMN shifts.closure_id  IS 'مرجع لسجل shifts_closures الناتج عن الإقفال (إن وُجد)';
COMMENT ON COLUMN shifts.auto_closed IS 'TRUE إذا أُقفلت الفترة تلقائياً عبر runAutoClosurePass';

-- =====================================================================
-- 3) ربط الزيارات بالفترة (visits.shift_id)
-- =====================================================================
ALTER TABLE visits
    ADD COLUMN IF NOT EXISTS shift_id INTEGER;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_visits_shift_id'
          AND conrelid = 'visits'::regclass
    ) THEN
        ALTER TABLE visits
            ADD CONSTRAINT fk_visits_shift_id
            FOREIGN KEY (shift_id)
            REFERENCES shifts(shift_id)
            ON UPDATE CASCADE ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_visits_shift_id
    ON visits(shift_id)
    WHERE shift_id IS NOT NULL;

COMMENT ON COLUMN visits.shift_id IS 'الفترة المالية التي تنتمي إليها الزيارة (تُحدَّد لحظة الإنشاء وتبقى ثابتة)';

-- =====================================================================
-- 4) تنظيف system_settings — الإعدادات الجديدة لنظام الفترات
-- =====================================================================
-- نحتفظ بـ shift_morning_start و shift_evening_start فقط كقيم افتراضية
-- لإنشاء أيام جديدة. نُضيف shift_default_split_time و shift_default_day_mode.
-- نُلغي المفاتيح التي لم تعد ضرورية.

-- 4.1) ضبط القيم الافتراضية للحقول الباقية
UPDATE system_settings
   SET setting_value = '00:00',
       description   = 'بداية اليوم — نقطة ثابتة لا تتغيّر (دائماً 00:00).'
 WHERE setting_key = 'shift_morning_start';

UPDATE system_settings
   SET setting_value = '12:00',
       description   = 'نقطة التقسيم الافتراضية بين الفترة الصباحية والمسائية (HH:MM 24h).'
 WHERE setting_key = 'shift_evening_start';

-- 4.2) إضافة الإعدادات الجديدة
INSERT INTO system_settings (setting_key, setting_value, description, setting_group) VALUES
    ('shift_default_split_time', '12:00',
     'نقطة التقسيم الافتراضية بين الفترة الصباحية والمسائية (HH:MM 24h) — تُستخدم عند إنشاء يوم جديد لم يُعرَّف في جدول shifts.',
     'shifts'),
    ('shift_default_day_mode', 'both',
     'وضع التقسيم الافتراضي للأيام الجديدة: both | morning_only | evening_only',
     'shifts'),
    ('shift_auto_close_enabled', 'true',
     'تفعيل الإقفال التلقائي للفترات المنتهية (سيتم تطبيقه في المرحلة 3).',
     'shifts'),
    ('shift_system_user_id', '0',
     'معرّف مستخدم النظام الذي يُسجَّل في closed_by عند الإقفال التلقائي.',
     'shifts')
ON CONFLICT (setting_key) DO UPDATE
SET setting_value = EXCLUDED.setting_value,
    setting_group = EXCLUDED.setting_group,
    description   = COALESCE(NULLIF(system_settings.description, ''), EXCLUDED.description);

-- 4.3) إلغاء الإعدادات القديمة التي لم تعد ضرورية
-- ملاحظة: نتركها كـ تحذير (description) بدلاً من حذفها فوراً لتفادي كسر أي كود
-- قديم لم يُحدَّث بعد. سيتم حذفها في migration لاحقة بعد التأكد من عدم الاستخدام.
UPDATE system_settings
   SET description = '[DEPRECATED — سيُحذف في migration لاحقة] ' || COALESCE(description, '')
 WHERE setting_key IN ('shift_morning_end', 'shift_evening_end', 'shift_overnight_belongs_to')
   AND description NOT LIKE '[DEPRECATED%';

-- =====================================================================
-- 5) Backfill — إنشاء سجلات shifts من shifts_closures التاريخية
-- =====================================================================
-- لكل سجل في shifts_closures، نُنشئ سجل shifts مكافئ بحالة 'closed'.
-- الحدود تُؤخذ من الافتراضي (00:00→12:00 صباحاً، 12:00→24:00 مساءً).
INSERT INTO shifts (
    shift_date, shift_type, start_time, end_time,
    day_mode, status, closure_id, closed_at, closed_by, auto_closed,
    created_at, updated_at
)
SELECT
    sc.shift_date,
    sc.shift_type,
    CASE sc.shift_type
        WHEN 'morning' THEN TIME '00:00:00'
        ELSE             TIME '12:00:00'
    END AS start_time,
    CASE sc.shift_type
        WHEN 'morning' THEN TIME '12:00:00'
        ELSE             TIME '23:59:59'   -- نهاية اليوم (بدلاً من 24:00 غير الصالحة في TIME)
    END AS end_time,
    'both'        AS day_mode,
    'closed'      AS status,
    sc.id         AS closure_id,
    sc.closed_at,
    sc.closed_by,
    FALSE         AS auto_closed,
    sc.created_at,
    sc.updated_at
FROM shifts_closures sc
ON CONFLICT (shift_date, shift_type) DO NOTHING;

-- =====================================================================
-- 6) Backfill — ربط الزيارات التاريخية بفتراتها
-- =====================================================================
-- نربط كل زيارة بـ shift_id المطابق لتاريخها ووقتها.
-- المنطق:
--   - DATE(visit_date) = shifts.shift_date
--   - وقت الزيارة ضمن [start_time, end_time)
UPDATE visits v
SET shift_id = s.shift_id
FROM shifts s
WHERE v.shift_id IS NULL
  AND s.shift_date = DATE(v.visit_date AT TIME ZONE COALESCE(current_setting('TIMEZONE', true), 'Asia/Aden'))
  AND (v.visit_date AT TIME ZONE COALESCE(current_setting('TIMEZONE', true), 'Asia/Aden'))::time >= s.start_time
  AND (v.visit_date AT TIME ZONE COALESCE(current_setting('TIMEZONE', true), 'Asia/Aden'))::time <  s.end_time;

-- =====================================================================
-- 7) Backfill إضافي — إنشاء فترة "اليوم الحالي" إن لم تكن موجودة
-- =====================================================================
-- للتأكد من أن النظام لديه فترة مفتوحة قابلة للاستخدام مباشرة بعد تطبيق
-- الـ migration بدون الحاجة لانتظار إنشائها lazily من ShiftService.
DO $$
DECLARE
    today_date   DATE := CURRENT_DATE;
    split_time   TIME := '12:00:00';
    settings_val TEXT;
BEGIN
    -- محاولة قراءة shift_default_split_time من الإعدادات
    SELECT setting_value INTO settings_val
      FROM system_settings
     WHERE setting_key = 'shift_default_split_time'
     LIMIT 1;
    IF settings_val IS NOT NULL AND settings_val ~ '^\d{1,2}:\d{2}$' THEN
        split_time := settings_val::time;
    END IF;

    -- إدخال الفترة الصباحية لليوم الحالي
    INSERT INTO shifts (shift_date, shift_type, start_time, end_time, day_mode, status)
    VALUES (today_date, 'morning', TIME '00:00:00', split_time, 'both', 'open')
    ON CONFLICT (shift_date, shift_type) DO NOTHING;

    -- إدخال الفترة المسائية لليوم الحالي
    INSERT INTO shifts (shift_date, shift_type, start_time, end_time, day_mode, status)
    VALUES (today_date, 'evening', split_time, TIME '23:59:59', 'both', 'open')
    ON CONFLICT (shift_date, shift_type) DO NOTHING;
END $$;

-- =====================================================================
-- 8) ربط زيارات اليوم الحالي إن لم تكن مربوطة بعد
-- =====================================================================
UPDATE visits v
SET shift_id = s.shift_id
FROM shifts s
WHERE v.shift_id IS NULL
  AND s.shift_date = CURRENT_DATE
  AND DATE(v.visit_date AT TIME ZONE COALESCE(current_setting('TIMEZONE', true), 'Asia/Aden')) = CURRENT_DATE
  AND (v.visit_date AT TIME ZONE COALESCE(current_setting('TIMEZONE', true), 'Asia/Aden'))::time >= s.start_time
  AND (v.visit_date AT TIME ZONE COALESCE(current_setting('TIMEZONE', true), 'Asia/Aden'))::time <  s.end_time;

COMMIT;

-- =====================================================================
-- التحقق بعد التطبيق (للقراءة فقط — يمكن تشغيلها يدوياً)
-- =====================================================================
-- SELECT COUNT(*) AS total_shifts FROM shifts;
-- SELECT COUNT(*) AS visits_linked FROM visits WHERE shift_id IS NOT NULL;
-- SELECT shift_date, shift_type, status, day_mode FROM shifts ORDER BY shift_date DESC, shift_type ASC LIMIT 20;
