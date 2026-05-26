-- =====================================================================
-- Migration 003: UUID → INT AUTO INCREMENT (SERIAL) Migration
-- Date: 2026-05-26
-- Purpose: تحويل جميع المفاتيح الأساسية والأجنبية من UUID إلى INT
--          (SERIAL auto-increment) لتبسيط واجهة لوحة المدير وأداء الاستعلامات.
--
-- ⚠️  WARNING: هذه عملية مدمّرة - تحذف الجداول الحالية وتعيد إنشاءها.
-- ✅ يجب الاحتفاظ بنسخة احتياطية من جدول users (username/password_hash) قبل التشغيل.
--
-- بعد التشغيل ستحصل على:
--  - users.user_id           INT SERIAL
--  - roles.role_id           INT SERIAL  (1=طبيب 2=أمين 3=استقبال 4=مختبر 5=مدير)
--  - patients.patient_id     INT SERIAL
--  - visits.visit_id         INT SERIAL
--  - invoices.invoice_id     INT SERIAL
--  - ... وغيرها
-- =====================================================================

-- 0) تنظيف كامل (Drop existing schema objects)
DROP TABLE IF EXISTS audit_logs           CASCADE;
DROP TABLE IF EXISTS notifications        CASCADE;
DROP TABLE IF EXISTS medical_results      CASCADE;
DROP TABLE IF EXISTS appointments         CASCADE;
DROP TABLE IF EXISTS examination_tickets  CASCADE;
DROP TABLE IF EXISTS invoice_details      CASCADE;
DROP TABLE IF EXISTS invoices             CASCADE;
DROP TABLE IF EXISTS visits               CASCADE;
DROP TABLE IF EXISTS services_master      CASCADE;
DROP TABLE IF EXISTS service_categories   CASCADE;
DROP TABLE IF EXISTS document_types       CASCADE;
DROP TABLE IF EXISTS emergency_case_types CASCADE;
DROP TABLE IF EXISTS patients             CASCADE;
DROP TABLE IF EXISTS users                CASCADE;
DROP TABLE IF EXISTS roles                CASCADE;

DROP FUNCTION IF EXISTS set_updated_at() CASCADE;

-- 1) Trigger function لتحديث updated_at تلقائياً
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- 2) Roles  (المفتاح INT - يتطابق مع role_code تماماً للبساطة)
-- =====================================================================
CREATE TABLE roles (
    role_id      SERIAL PRIMARY KEY,
    role_code    SMALLINT NOT NULL UNIQUE CHECK (role_code BETWEEN 1 AND 999),
    role_name    VARCHAR(50)  NOT NULL UNIQUE,
    script_url   VARCHAR(255) NOT NULL,
    description  TEXT,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER trg_roles_updated_at BEFORE UPDATE ON roles
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- بذر الأدوار الافتراضية - مع جعل role_id = role_code للبساطة
INSERT INTO roles (role_id, role_code, role_name, script_url) VALUES
    (1, 1, 'طبيب عام',     'doctor_module.js'),
    (2, 2, 'أمين صندوق',   'accounting_module.js'),
    (3, 3, 'استقبال',      'reception.js'),
    (4, 4, 'فني مختبر',    'technical.js'),
    (5, 5, 'مدير النظام',  'admin_module.js');
-- مزامنة sequence ليبدأ من 6
SELECT setval('roles_role_id_seq', 5, true);

-- =====================================================================
-- 3) Users
-- =====================================================================
CREATE TABLE users (
    user_id        SERIAL PRIMARY KEY,
    username       VARCHAR(50)  NOT NULL UNIQUE CHECK (char_length(username) >= 3),
    password_hash  VARCHAR(255) NOT NULL CHECK (char_length(password_hash) >= 20),
    full_name      VARCHAR(100) NOT NULL,
    email          VARCHAR(255) UNIQUE,
    phone          VARCHAR(30),
    role_id        INTEGER REFERENCES roles(role_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at  TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_users_role_id   ON users(role_id);
CREATE INDEX idx_users_is_active ON users(is_active);
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- إعادة إدراج المستخدمين الأربعة الموجودين (نفس username/password/full_name)
-- IDs الجديدة 1..4 بحسب ترتيب role_code
INSERT INTO users (user_id, username, password_hash, full_name, email, phone, role_id, is_active) VALUES
    (1, 'user2',    '$2y$10$MmHJCslUeVTiKBsD.5OkveHfyx.PO49RwW/L3zfAiLgjgoHbLEUIi', 'راشد المنعي',         NULL,                     NULL,           1, TRUE),
    (2, 'dr_ahmad', '$2y$10$oLoOKo1o86eh.5cR6S4Jt.HO0NWbhhZHMIPVGBt1Ntzx4A3t5eTvG', 'د. أحمد علي (محدّث)', 'dr.ahmad@clinic.local', '0700100099',   1, TRUE),
    (3, 'user3',    '$2y$10$5K.8ANGTqw5EhR9.2f149.bCxPsn7a4uiPHAlWISCFQtqFyiwnBtW', 'Ali Faleh',            NULL,                     '٧٧١٤٣٧٧١٦',  2, TRUE),
    (4, 'ali',      '$2y$10$Ofqx4n9CdEBv//iknKNy0O048Bwyz5GMwb6vPs1y0x4/TebVx7FrG', 'Rashed Yahya',         NULL,                     '771391168',    5, TRUE);
SELECT setval('users_user_id_seq', 4, true);

-- =====================================================================
-- 4) Patients
-- =====================================================================
CREATE TABLE patients (
    patient_id   SERIAL PRIMARY KEY,
    full_name    VARCHAR(150) NOT NULL CHECK (char_length(trim(full_name)) > 0),
    gender       VARCHAR(10)  CHECK (gender IN ('Male','Female')),
    birth_date   DATE CHECK (birth_date IS NULL OR birth_date <= CURRENT_DATE),
    national_id  VARCHAR(30) UNIQUE,
    phone        VARCHAR(20),
    place1       VARCHAR(50),
    place2       VARCHAR(50),
    notes        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_patients_full_name  ON patients(full_name);
CREATE INDEX idx_patients_created_at ON patients(created_at DESC);
CREATE TRIGGER trg_patients_updated_at BEFORE UPDATE ON patients
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =====================================================================
-- 5) Emergency Case Types
-- =====================================================================
CREATE TABLE emergency_case_types (
    case_type_id SERIAL PRIMARY KEY,
    case_code    SMALLINT NOT NULL UNIQUE CHECK (case_code BETWEEN 1 AND 999),
    case_name    VARCHAR(100) NOT NULL UNIQUE,
    description  TEXT,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER trg_emergency_case_types_updated_at BEFORE UPDATE ON emergency_case_types
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
INSERT INTO emergency_case_types (case_type_id, case_code, case_name) VALUES
    (1, 1, 'طوارئ باطنية'),
    (2, 2, 'تسمم غذائي'),
    (3, 3, 'سقوط'),
    (4, 4, 'حوادث سير'),
    (5, 5, 'حروق');
SELECT setval('emergency_case_types_case_type_id_seq', 5, true);

-- =====================================================================
-- 6) Document Types
-- =====================================================================
CREATE TABLE document_types (
    doc_type_id    SERIAL PRIMARY KEY,
    doc_code       SMALLINT NOT NULL UNIQUE CHECK (doc_code BETWEEN 1 AND 999),
    doc_name       VARCHAR(50) NOT NULL UNIQUE,
    current_serial INTEGER NOT NULL DEFAULT 0 CHECK (current_serial >= 0),
    description    TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER trg_document_types_updated_at BEFORE UPDATE ON document_types
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
INSERT INTO document_types (doc_type_id, doc_code, doc_name) VALUES
    (1, 1, 'A'),
    (2, 2, 'B'),
    (3, 3, 'C'),
    (4, 4, 'T');
SELECT setval('document_types_doc_type_id_seq', 4, true);

-- =====================================================================
-- 7) Service Categories
-- =====================================================================
CREATE TABLE service_categories (
    category_id    SERIAL PRIMARY KEY,
    category_name  VARCHAR(100) NOT NULL,
    department     VARCHAR(50)  NOT NULL CHECK (department IN ('Laboratory','Radiology','Nursing','Pharmacy','Emergency','Other')),
    description    TEXT,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (category_name, department)
);
CREATE INDEX idx_service_categories_department ON service_categories(department);
CREATE TRIGGER trg_service_categories_updated_at BEFORE UPDATE ON service_categories
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
INSERT INTO service_categories (category_id, category_name, department) VALUES
    (1, 'فحوصات دم عامة',  'Laboratory'),
    (2, 'وظائف كبد وكلى',  'Laboratory'),
    (3, 'كشافات عادية',    'Radiology'),
    (4, 'خدمات الطوارئ',   'Nursing');
SELECT setval('service_categories_category_id_seq', 4, true);

-- =====================================================================
-- 8) Services Master
-- =====================================================================
CREATE TABLE services_master (
    service_id     SERIAL PRIMARY KEY,
    category_id    INTEGER REFERENCES service_categories(category_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    service_name   VARCHAR(150) NOT NULL,
    center_share   NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (center_share   >= 0),
    ministry_share NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (ministry_share >= 0),
    total_price    NUMERIC(11,2) GENERATED ALWAYS AS (center_share + ministry_share) STORED,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (category_id, service_name)
);
CREATE INDEX idx_services_master_category_id ON services_master(category_id);
CREATE INDEX idx_services_master_is_active   ON services_master(is_active);
CREATE TRIGGER trg_services_master_updated_at BEFORE UPDATE ON services_master
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =====================================================================
-- 9) Visits
-- =====================================================================
CREATE TABLE visits (
    visit_id       SERIAL PRIMARY KEY,
    patient_id     INTEGER NOT NULL REFERENCES patients(patient_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    doctor_id      INTEGER REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
    case_type_id   INTEGER REFERENCES emergency_case_types(case_type_id) ON UPDATE CASCADE ON DELETE SET NULL,
    visit_date     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    notes          VARCHAR(300),
    diagnosis      VARCHAR(150),
    type_case      VARCHAR(60),
    status         VARCHAR(20) NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Completed','Cancelled')),
    cancelled_at   TIMESTAMPTZ,
    cancelled_by   INTEGER REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
    cancel_reason  VARCHAR(255),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_visits_cancel_consistency CHECK (
        (status = 'Cancelled' AND cancelled_at IS NOT NULL)
        OR (status <> 'Cancelled' AND cancelled_at IS NULL)
    )
);
CREATE INDEX idx_visits_patient_id    ON visits(patient_id);
CREATE INDEX idx_visits_doctor_id     ON visits(doctor_id);
CREATE INDEX idx_visits_case_type_id  ON visits(case_type_id);
CREATE INDEX idx_visits_status        ON visits(status);
CREATE INDEX idx_visits_visit_date    ON visits(visit_date DESC);
CREATE INDEX idx_visits_cancelled_by  ON visits(cancelled_by);
CREATE TRIGGER trg_visits_updated_at BEFORE UPDATE ON visits
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =====================================================================
-- 10) Invoices
-- =====================================================================
CREATE TABLE invoices (
    invoice_id      SERIAL PRIMARY KEY,
    serial_number   INTEGER NOT NULL CHECK (serial_number > 0),
    doc_type_id     INTEGER REFERENCES document_types(doc_type_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    visit_id        INTEGER REFERENCES visits(visit_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    total           NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (total >= 0),
    exemption_value NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (exemption_value >= 0),
    net_amount      NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (net_amount >= 0),
    accountant_id   INTEGER REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
    paid_at         TIMESTAMPTZ,
    cancelled_at    TIMESTAMPTZ,
    cancelled_by    INTEGER REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
    cancel_reason   VARCHAR(255),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_invoices_exemption_le_total   CHECK (exemption_value <= total),
    CONSTRAINT chk_invoices_net_amount           CHECK (net_amount = total - exemption_value),
    CONSTRAINT chk_invoices_paid_requires_acct   CHECK (paid_at IS NULL OR accountant_id IS NOT NULL),
    UNIQUE (doc_type_id, serial_number)
);
CREATE INDEX idx_invoices_visit_id      ON invoices(visit_id);
CREATE INDEX idx_invoices_doc_type_id   ON invoices(doc_type_id);
CREATE INDEX idx_invoices_accountant_id ON invoices(accountant_id);
CREATE INDEX idx_invoices_paid_at       ON invoices(paid_at DESC);
CREATE INDEX idx_invoices_created_at    ON invoices(created_at DESC);
CREATE INDEX idx_invoices_cancelled_at  ON invoices(cancelled_at);
CREATE INDEX idx_invoices_cancelled_by  ON invoices(cancelled_by);
CREATE TRIGGER trg_invoices_updated_at BEFORE UPDATE ON invoices
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =====================================================================
-- 11) Invoice Details
-- =====================================================================
CREATE TABLE invoice_details (
    detail_id              SERIAL PRIMARY KEY,
    invoice_id             INTEGER NOT NULL REFERENCES invoices(invoice_id) ON UPDATE CASCADE ON DELETE CASCADE,
    service_id             INTEGER NOT NULL REFERENCES services_master(service_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    service_price_at_time  NUMERIC(10,2) NOT NULL CHECK (service_price_at_time >= 0),
    quantity               INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (invoice_id, service_id)
);
CREATE INDEX idx_invoice_details_invoice_id ON invoice_details(invoice_id);
CREATE INDEX idx_invoice_details_service_id ON invoice_details(service_id);
CREATE TRIGGER trg_invoice_details_updated_at BEFORE UPDATE ON invoice_details
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =====================================================================
-- 12) Examination Tickets
-- =====================================================================
CREATE TABLE examination_tickets (
    ticket_id     SERIAL PRIMARY KEY,
    visit_id      INTEGER NOT NULL UNIQUE REFERENCES visits(visit_id) ON UPDATE CASCADE ON DELETE CASCADE,
    serial_number INTEGER NOT NULL UNIQUE CHECK (serial_number > 0),
    ticket_type   VARCHAR(20) NOT NULL CHECK (ticket_type IN ('morning','evening')),
    notes         TEXT,
    amount        NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (amount >= 0),
    issued_by     INTEGER REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_examination_tickets_ticket_type ON examination_tickets(ticket_type);
CREATE INDEX idx_examination_tickets_issued_by   ON examination_tickets(issued_by);
CREATE INDEX idx_examination_tickets_created_at  ON examination_tickets(created_at DESC);
CREATE TRIGGER trg_examination_tickets_updated_at BEFORE UPDATE ON examination_tickets
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =====================================================================
-- 13) Appointments
-- =====================================================================
CREATE TABLE appointments (
    appointment_id   SERIAL PRIMARY KEY,
    patient_id       INTEGER NOT NULL REFERENCES patients(patient_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    doctor_id        INTEGER REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
    appointment_date TIMESTAMPTZ NOT NULL,
    reason           TEXT,
    status           VARCHAR(20) NOT NULL DEFAULT 'Scheduled' CHECK (status IN ('Scheduled','Attended','Missed','Cancelled')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_appointments_future_or_past CHECK (appointment_date >= created_at - INTERVAL '1 day')
);
CREATE INDEX idx_appointments_patient_id       ON appointments(patient_id);
CREATE INDEX idx_appointments_doctor_id        ON appointments(doctor_id);
CREATE INDEX idx_appointments_appointment_date ON appointments(appointment_date);
CREATE INDEX idx_appointments_status           ON appointments(status);
CREATE TRIGGER trg_appointments_updated_at BEFORE UPDATE ON appointments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =====================================================================
-- 14) Medical Results
-- =====================================================================
CREATE TABLE medical_results (
    result_id    SERIAL PRIMARY KEY,
    visit_id     INTEGER NOT NULL REFERENCES visits(visit_id) ON UPDATE CASCADE ON DELETE CASCADE,
    service_id   INTEGER REFERENCES services_master(service_id) ON UPDATE CASCADE ON DELETE SET NULL,
    uploaded_by  INTEGER REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
    result_data  TEXT,
    file_path    VARCHAR(255),
    metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_medical_results_visit_id    ON medical_results(visit_id);
CREATE INDEX idx_medical_results_service_id  ON medical_results(service_id);
CREATE INDEX idx_medical_results_uploaded_by ON medical_results(uploaded_by);
CREATE INDEX idx_medical_results_metadata_gin ON medical_results USING GIN (metadata);
CREATE TRIGGER trg_medical_results_updated_at BEFORE UPDATE ON medical_results
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =====================================================================
-- 15) Notifications
-- =====================================================================
CREATE TABLE notifications (
    notification_id SERIAL PRIMARY KEY,
    target_role     VARCHAR(50)  NOT NULL,
    target_user_id  INTEGER REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE CASCADE,
    title           VARCHAR(150) NOT NULL,
    body            TEXT NOT NULL,
    event_type      VARCHAR(50)  NOT NULL,
    reference_id    INTEGER,
    payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_read         BOOLEAN NOT NULL DEFAULT FALSE,
    read_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_notifications_read_consistency CHECK (
        (is_read = TRUE  AND read_at IS NOT NULL)
        OR (is_read = FALSE AND read_at IS NULL)
    )
);
CREATE INDEX idx_notifications_target_role     ON notifications(target_role);
CREATE INDEX idx_notifications_target_user_id  ON notifications(target_user_id);
CREATE INDEX idx_notifications_is_read         ON notifications(is_read);
CREATE INDEX idx_notifications_event_type      ON notifications(event_type);
CREATE INDEX idx_notifications_created_at      ON notifications(created_at DESC);
CREATE INDEX idx_notifications_payload_gin     ON notifications USING GIN (payload);
CREATE INDEX idx_notifications_unread_by_role  ON notifications(target_role, created_at DESC) WHERE is_read = FALSE;
CREATE TRIGGER trg_notifications_updated_at BEFORE UPDATE ON notifications
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =====================================================================
-- 16) Audit Logs
-- =====================================================================
CREATE TABLE audit_logs (
    log_id       SERIAL PRIMARY KEY,
    user_id      INTEGER REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
    username     VARCHAR(100),
    action       VARCHAR(30) NOT NULL CHECK (action IN ('CREATE','UPDATE','DELETE','LOGIN','LOGOUT','CANCEL','EXPORT','IMPORT','VIEW','OTHER')),
    table_name   VARCHAR(80),
    record_id    VARCHAR(100),
    old_values   JSONB,
    new_values   JSONB,
    ip_address   VARCHAR(60),
    user_agent   VARCHAR(255),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_audit_logs_user_id     ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action      ON audit_logs(action);
CREATE INDEX idx_audit_logs_table_name  ON audit_logs(table_name);
CREATE INDEX idx_audit_logs_created_at  ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_record      ON audit_logs(table_name, record_id);

-- ✅ Done
