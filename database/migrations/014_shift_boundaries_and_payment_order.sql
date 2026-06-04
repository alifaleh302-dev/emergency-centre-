-- =====================================================================
-- 014_shift_boundaries_and_payment_order.sql
-- إعدادات حدود الفترات + تفعيل قيد ترتيب تسديد الفواتير حسب الفترة
-- =====================================================================

BEGIN;

INSERT INTO system_settings (setting_key, setting_value, description) VALUES
    ('shift_morning_start',  '05:00', 'بداية الفترة الصباحية (HH:MM 24h)'),
    ('shift_morning_end',    '12:00', 'نهاية الفترة الصباحية (HH:MM 24h)'),
    ('shift_evening_start',  '12:00', 'بداية الفترة المسائية (HH:MM 24h)'),
    ('shift_evening_end',    '23:00', 'نهاية الفترة المسائية (HH:MM 24h)'),
    ('shift_overnight_belongs_to', 'evening_prev_day', 'الفترة الليلية بين shift_evening_end و shift_morning_start تنتمي لأي فترة'),
    ('enforce_shift_payment_order', 'true', 'منع تسديد فواتير فترة لاحقة قبل إكمال فواتير الفترة السابقة'),
    ('allow_zero_invoices_implicit_close', 'true', 'اعتبار الفترة السابقة الفارغة مُقفلة ضمنياً'),
    ('allow_admin_payment_override', 'true', 'السماح للمدير بتجاوز قيد ترتيب التسديد مع تسجيل audit log')
ON CONFLICT (setting_key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_invoices_pending_created_at
    ON invoices(created_at)
    WHERE doc_type_id IS NULL AND accountant_id IS NULL;

COMMIT;
