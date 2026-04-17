-- =====================================================================
-- Migration 001: Admin Panel Setup
-- Date: 2026-04-17
-- Purpose: إضافة الجداول والأعمدة اللازمة لـ Admin Panel
--   * audit_logs جدول لتتبّع عمليات الأدمن
--   * is_active / last_login_at / created_at على users
--   * cancelled_at / cancelled_by / cancel_reason على invoices و visits
--   * إنشاء مستخدم admin افتراضي
-- ملاحظة: كل العبارات idempotent (IF NOT EXISTS) فآمنة للتشغيل مرتين.
-- =====================================================================

-- 1) جدول سجل التدقيق
CREATE TABLE IF NOT EXISTS audit_logs (
    log_id       SERIAL PRIMARY KEY,
    user_id      INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    username     VARCHAR(100),
    action       VARCHAR(30) NOT NULL,     -- CREATE / UPDATE / DELETE / LOGIN / CANCEL / EXPORT
    table_name   VARCHAR(80),
    record_id    INTEGER,
    old_values   JSONB,
    new_values   JSONB,
    ip_address   VARCHAR(60),
    user_agent   VARCHAR(255),
    created_at   TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user    ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_table   ON audit_logs(table_name);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);

-- 2) أعمدة إضافية على Users
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active      BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at  TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at     TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP;

-- 3) أعمدة الإلغاء على Invoices (Soft Cancel)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cancelled_at  TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cancelled_by  INTEGER REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cancel_reason VARCHAR(255);

-- 4) أعمدة الإلغاء على Visits
ALTER TABLE visits ADD COLUMN IF NOT EXISTS cancelled_at  TIMESTAMPTZ;
ALTER TABLE visits ADD COLUMN IF NOT EXISTS cancelled_by  INTEGER REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE visits ADD COLUMN IF NOT EXISTS cancel_reason VARCHAR(255);

-- 5) التأكد من وجود دور "مدير النظام"
INSERT INTO roles (role_id, role_name, script_url)
VALUES (5, 'مدير النظام', 'admin_module.js')
ON CONFLICT (role_id) DO UPDATE
    SET role_name = EXCLUDED.role_name,
        script_url = EXCLUDED.script_url;

-- 6) إنشاء مستخدم admin افتراضي
--    username: admin
--    password: Admin@123   (هذا hash لها بـ bcrypt cost=10)
--    يرجى تغيير كلمة المرور فور أول تسجيل دخول!
INSERT INTO users (username, password_hash, full_name, role_id, is_active)
VALUES ('admin',
        '$2b$10$ilkOYl4l4XSAZHe8ybXLZ.bq9.P1tpRuvUycVTUqtaoUSY9CW7BF.',
        'مدير النظام الرئيسي',
        5,
        TRUE)
ON CONFLICT (username) DO UPDATE
    SET password_hash = EXCLUDED.password_hash,
        role_id       = 5,
        is_active     = TRUE,
        full_name     = EXCLUDED.full_name;

-- 7) فهرس فريد على اسم المستخدم
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'users_username_uidx') THEN
        CREATE UNIQUE INDEX users_username_uidx ON users(username);
    END IF;
END$$;

-- ✅ Done
