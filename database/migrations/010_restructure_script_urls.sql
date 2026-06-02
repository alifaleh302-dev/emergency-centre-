-- ──────────────────────────────────────────────────────────────────────────
-- Migration 010: تحديث Roles.script_url لمسارات JS الجديدة
-- ──────────────────────────────────────────────────────────────────────────
-- بعد إعادة هيكلة المجلدات إلى public/assets/js/modules/، يجب تحديث
-- المسارات المخزَّنة في جدول Roles ليتطابق مع الأماكن الجديدة للملفات.
--
-- ملاحظة: هذا التحديث آمن لإعادة التشغيل (idempotent).
-- ──────────────────────────────────────────────────────────────────────────

UPDATE Roles SET script_url = 'assets/js/modules/doctor.js'
WHERE script_url IN ('doctor_module.js', 'assets/js/modules/doctor.js');

UPDATE Roles SET script_url = 'assets/js/modules/accounting.js'
WHERE script_url IN ('accounting_module.js', 'assets/js/modules/accounting.js');

UPDATE Roles SET script_url = 'assets/js/modules/admin.js'
WHERE script_url IN ('admin_module.js', 'assets/js/modules/admin.js');

-- إذا تم لاحقاً إضافة وحدات للاستقبال والمختبر:
-- UPDATE Roles SET script_url = 'assets/js/modules/reception.js'
--   WHERE script_url IN ('reception.js', 'assets/js/modules/reception.js');
-- UPDATE Roles SET script_url = 'assets/js/modules/technical.js'
--   WHERE script_url IN ('technical.js', 'assets/js/modules/technical.js');

-- التحقق
-- SELECT role_id, role_name, script_url FROM Roles ORDER BY role_id;
