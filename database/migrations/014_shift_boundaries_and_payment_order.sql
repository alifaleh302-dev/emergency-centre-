-- =====================================================================
-- 014_shift_boundaries_and_payment_order.sql
-- إعدادات حدود الفترات + تصنيف الإعدادات + تفعيل قيد ترتيب التسديد
-- =====================================================================

BEGIN;

ALTER TABLE system_settings
    ADD COLUMN IF NOT EXISTS setting_group VARCHAR(50);

UPDATE system_settings
SET setting_group = CASE
    WHEN setting_key LIKE 'header_%' THEN 'header'
    WHEN setting_key LIKE 'ticket_%' THEN 'tickets'
    WHEN setting_key LIKE 'finance_hub_%' THEN 'finance'
    WHEN setting_key LIKE 'shift_%'
      OR setting_key IN (
          'enforce_shift_payment_order',
          'allow_zero_invoices_implicit_close',
          'allow_admin_payment_override'
      ) THEN 'shifts'
    ELSE 'general'
END
WHERE setting_group IS NULL OR BTRIM(setting_group) = '';

ALTER TABLE system_settings
    ALTER COLUMN setting_group SET DEFAULT 'general';

UPDATE system_settings
SET setting_group = 'general'
WHERE setting_group IS NULL OR BTRIM(setting_group) = '';

ALTER TABLE system_settings
    ALTER COLUMN setting_group SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_system_settings_group
    ON system_settings(setting_group);

INSERT INTO system_settings (setting_key, setting_value, description, setting_group) VALUES
    ('shift_morning_start',  '05:00', 'بداية الفترة الصباحية (HH:MM 24h)', 'shifts'),
    ('shift_morning_end',    '12:00', 'نهاية الفترة الصباحية (HH:MM 24h)', 'shifts'),
    ('shift_evening_start',  '12:00', 'بداية الفترة المسائية (HH:MM 24h)', 'shifts'),
    ('shift_evening_end',    '23:00', 'نهاية الفترة المسائية (HH:MM 24h)', 'shifts'),
    ('shift_overnight_belongs_to', 'evening_prev_day', 'الفترة الليلية بين shift_evening_end و shift_morning_start تنتمي لأي فترة', 'shifts'),
    ('enforce_shift_payment_order', 'true', 'منع تسديد فواتير فترة لاحقة قبل إكمال فواتير الفترة السابقة', 'shifts'),
    ('allow_zero_invoices_implicit_close', 'true', 'اعتبار الفترة السابقة الفارغة مُقفلة ضمنياً', 'shifts'),
    ('allow_admin_payment_override', 'true', 'السماح للمدير بتجاوز قيد ترتيب التسديد مع تسجيل audit log', 'shifts')
ON CONFLICT (setting_key) DO UPDATE
SET setting_group = EXCLUDED.setting_group,
    description = COALESCE(NULLIF(system_settings.description, ''), EXCLUDED.description);

CREATE INDEX IF NOT EXISTS idx_invoices_pending_created_at
    ON invoices(created_at)
    WHERE doc_type_id IS NULL AND accountant_id IS NULL;

COMMIT;
