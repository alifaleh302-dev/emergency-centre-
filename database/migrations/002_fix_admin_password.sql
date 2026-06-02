-- =====================================================================
-- Migration 002: إصلاح hash كلمة مرور admin
-- =====================================================================
-- السياق: في migration 001 تم إدخال hash عبر Python bcrypt + psycopg2،
-- مما تسبّب في ضياع علامة `$` الأولى من الـ hash بسبب أن PostgreSQL
-- يُفسّر `$1, $2...` كـ placeholders أصلية. النتيجة: كان password_hash
-- المُخزَّن `2y$10$V8sCa...` بدلاً من `$2y$10$V8sCa...` — مما جعل
-- `password_verify` يرجع FALSE دوماً، و AuthController يسقط على
-- hash_equals (مقارنة نصية صريحة) فيفشل تسجيل الدخول.
--
-- الحل: إعادة تعيين hash كلمة المرور باستخدام hash صالح مولَّد من PHP
-- password_hash('Admin@123', PASSWORD_BCRYPT)  -- cost=12
-- كلمة المرور: Admin@123
-- =====================================================================

UPDATE users
SET password_hash = '$2y$12$ssOttzwwdtH7K6bHC1zicuxPVffwFzCq6UnxiTBH21sLoMjV9q6lu'
WHERE username = 'admin';

-- تحقق:
-- SELECT username, password_hash FROM users WHERE username='admin';
-- يجب أن تبدأ القيمة بـ: $2y$12$  (ستة أحرف مع $ في البداية)
