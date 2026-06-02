-- =====================================================================
-- Migration 005: Visit close modal + Header settings + Auto ticket
-- Date: 2026-05-27
-- Purpose:
--   1) أعمدة جديدة في visits لاستيعاب نموذج "إغلاق الزيارة" الجديد:
--      - clinic_name        (العيادة - اختياري)
--      - final_notes        (الملاحظات النهائية - إجباري عند الإغلاق)
--      - closed_by          (id الطبيب الذي أغلق الزيارة)
--      - closed_by_name     (الاسم الكامل وقت الإغلاق - للحفظ التاريخي)
--      - closed_at          (لحظة الإغلاق)
--
--   2) إعدادات الترويسة (Dynamic Header) في system_settings:
--      تُحفظ كقيم نصية ويستطيع مدير النظام لاحقاً تعديلها من واجهة الإعدادات.
--
--   3) التأكد من وجود قيد "زيارة نشطة واحدة لكل مريض"
--      (uq_visits_one_active_per_patient) - هذا القيد موجود من migration 003.
--
--   4) لا حاجة لأي تعديل على examination_tickets - بنيتها كافية، لكن
--      الإصدار الآن سيكون تلقائياً من سيرفر PHP وليس من الطبيب.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) أعمدة جديدة في visits (آمنة: IF NOT EXISTS)
-- ---------------------------------------------------------------------
ALTER TABLE visits
    ADD COLUMN IF NOT EXISTS clinic_name      VARCHAR(150),
    ADD COLUMN IF NOT EXISTS final_notes      TEXT,
    ADD COLUMN IF NOT EXISTS closed_by        INTEGER,
    ADD COLUMN IF NOT EXISTS closed_by_name   VARCHAR(150),
    ADD COLUMN IF NOT EXISTS closed_at        TIMESTAMPTZ;

-- FK اختياري للحفظ المرجعي (لا نلغيه عند حذف المستخدم)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'visits_closed_by_fkey'
    ) THEN
        ALTER TABLE visits
            ADD CONSTRAINT visits_closed_by_fkey
            FOREIGN KEY (closed_by) REFERENCES users(user_id)
            ON UPDATE CASCADE ON DELETE SET NULL;
    END IF;
END$$;

-- فهرس مساعد لإغلاقات اليوم
CREATE INDEX IF NOT EXISTS idx_visits_closed_at ON visits(closed_at DESC);

-- ---------------------------------------------------------------------
-- 2) إعدادات الترويسة الديناميكية
-- ---------------------------------------------------------------------
INSERT INTO system_settings (setting_key, setting_value, description) VALUES
    ('header_country',      'الجمهورية اليمنية',                              'اسم الدولة في ترويسة النماذج'),
    ('header_ministry',     'وزارة الصحة العامة والسكان',                     'اسم الوزارة في ترويسة النماذج'),
    ('header_office',       'مكتب الصحة والبيئة م/ حجة',                      'اسم المكتب/المحافظة في الترويسة'),
    ('header_directorate',  'مكتب الصحة والبيئة بمديرية كحلان عفار',          'اسم المديرية في الترويسة'),
    ('header_center',       'مركز طوارئ الطرق',                                'اسم المركز/المنشأة الصحية في الترويسة'),
    ('header_admin',        'إدارة مشاركة المجتمع',                            'الإدارة المسؤولة في الترويسة'),
    ('header_form_title',   'تذكرة معاينة',                                    'عنوان النموذج المطبوع'),
    ('header_logo_url',     '',                                                'رابط شعار المؤسسة (اختياري)'),
    ('header_footer_note',  'ملاحظة: لا تقبل تذكرة المعاينة بدون ختم إدارة مشاركة المجتمع.', 'ملاحظة أسفل النموذج المطبوع'),
    ('header_side_note',    '',                                                'نص جانبي صغير (اختياري) على هامش النموذج')
ON CONFLICT (setting_key) DO NOTHING;

-- مفاتيح أسعار التذاكر — إن لم تكن موجودة من قبل (مزروعة في seed سابق)
INSERT INTO system_settings (setting_key, setting_value, description) VALUES
    ('ticket_price_morning',      '100', 'سعر تذكرة المعاينة الصباحية (ريال)'),
    ('ticket_price_evening',      '500', 'سعر تذكرة المعاينة المسائية (ريال)'),
    ('ticket_morning_start_hour', '5',   'ساعة بداية الفترة الصباحية (0-23)'),
    ('ticket_morning_end_hour',   '12',  'ساعة نهاية الفترة الصباحية (0-23)')
ON CONFLICT (setting_key) DO NOTHING;

-- ---------------------------------------------------------------------
-- 3) (تأكيدي) قيد زيارة نشطة واحدة لكل مريض
-- ---------------------------------------------------------------------
-- هذا القيد موجود من migration 003 - فقط نتحقق من وجوده
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE indexname = 'uq_visits_one_active_per_patient'
    ) THEN
        CREATE UNIQUE INDEX uq_visits_one_active_per_patient
            ON visits(patient_id)
            WHERE status = 'Active';
    END IF;
END$$;

-- =====================================================================
-- نهاية الترقية 005
-- =====================================================================
