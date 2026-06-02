-- 006_departments_and_services_integration.sql
-- إنشاء جدول الأقسام وربطه بتصنيفات الخدمات مع ترحيل البيانات القديمة

BEGIN;

CREATE TABLE IF NOT EXISTS departments (
    department_id   SERIAL PRIMARY KEY,
    department_name VARCHAR(120) NOT NULL,
    department_code VARCHAR(50)  NOT NULL,
    sort_order      INTEGER      NOT NULL DEFAULT 100,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_departments_name UNIQUE (department_name),
    CONSTRAINT uq_departments_code UNIQUE (department_code)
);

CREATE INDEX IF NOT EXISTS idx_departments_sort_order ON departments(sort_order);
CREATE INDEX IF NOT EXISTS idx_departments_active ON departments(is_active);

DROP TRIGGER IF EXISTS trg_departments_updated_at ON departments;
CREATE TRIGGER trg_departments_updated_at
BEFORE UPDATE ON departments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO departments (department_name, department_code, sort_order, is_active)
VALUES
    ('المختبر', 'Laboratory', 10, TRUE),
    ('الأشعة', 'Radiology', 20, TRUE),
    ('التمريض', 'Nursing', 30, TRUE),
    ('الصيدلية', 'Pharmacy', 40, TRUE),
    ('الطوارئ', 'Emergency', 50, TRUE),
    ('أخرى', 'Other', 60, TRUE)
ON CONFLICT (department_code) DO UPDATE
SET
    department_name = EXCLUDED.department_name,
    sort_order = EXCLUDED.sort_order,
    is_active = EXCLUDED.is_active,
    updated_at = CURRENT_TIMESTAMP;

INSERT INTO departments (department_name, department_code, sort_order, is_active)
SELECT DISTINCT sc.department, sc.department, 900, TRUE
FROM service_categories sc
WHERE NOT EXISTS (
    SELECT 1 FROM departments d WHERE d.department_code = sc.department
)
ON CONFLICT (department_code) DO NOTHING;

ALTER TABLE service_categories
    ADD COLUMN IF NOT EXISTS department_id INTEGER;

UPDATE service_categories sc
SET department_id = d.department_id
FROM departments d
WHERE sc.department_id IS NULL
  AND sc.department = d.department_code;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'service_categories'
          AND column_name = 'department_id'
    ) AND NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_service_categories_department_id'
          AND conrelid = 'service_categories'::regclass
    ) THEN
        ALTER TABLE service_categories
            ADD CONSTRAINT fk_service_categories_department_id
            FOREIGN KEY (department_id)
            REFERENCES departments(department_id)
            ON UPDATE CASCADE
            ON DELETE RESTRICT;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_service_categories_department_id
    ON service_categories(department_id);

ALTER TABLE service_categories
    ALTER COLUMN department_id SET NOT NULL;

COMMIT;
