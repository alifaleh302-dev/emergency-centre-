-- =====================================================================
-- Migration 021: Soft Delete for Core Tables
-- Date: 2026-06-09
-- Purpose: تطبيق الحذف الذكي (Soft Delete) على الجداول الأساسية
-- =====================================================================

BEGIN;

ALTER TABLE patients ADD COLUMN IF NOT EXISTS is_deleted     BOOLEAN     NOT NULL DEFAULT FALSE;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS deleted_at     TIMESTAMPTZ;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS deleted_by     INTEGER;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS deleted_reason VARCHAR(255);
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'patients_deleted_by_fkey') THEN
        ALTER TABLE patients
            ADD CONSTRAINT patients_deleted_by_fkey
            FOREIGN KEY (deleted_by) REFERENCES users(user_id)
            ON UPDATE CASCADE ON DELETE SET NULL;
    END IF;
END$$;
CREATE INDEX IF NOT EXISTS idx_patients_is_deleted ON patients(is_deleted) WHERE is_deleted = FALSE;

ALTER TABLE services_master ADD COLUMN IF NOT EXISTS is_deleted     BOOLEAN     NOT NULL DEFAULT FALSE;
ALTER TABLE services_master ADD COLUMN IF NOT EXISTS deleted_at     TIMESTAMPTZ;
ALTER TABLE services_master ADD COLUMN IF NOT EXISTS deleted_by     INTEGER;
ALTER TABLE services_master ADD COLUMN IF NOT EXISTS deleted_reason VARCHAR(255);
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'services_master_deleted_by_fkey') THEN
        ALTER TABLE services_master
            ADD CONSTRAINT services_master_deleted_by_fkey
            FOREIGN KEY (deleted_by) REFERENCES users(user_id)
            ON UPDATE CASCADE ON DELETE SET NULL;
    END IF;
END$$;
CREATE INDEX IF NOT EXISTS idx_services_master_is_deleted ON services_master(is_deleted) WHERE is_deleted = FALSE;

ALTER TABLE service_categories ADD COLUMN IF NOT EXISTS is_deleted     BOOLEAN     NOT NULL DEFAULT FALSE;
ALTER TABLE service_categories ADD COLUMN IF NOT EXISTS deleted_at     TIMESTAMPTZ;
ALTER TABLE service_categories ADD COLUMN IF NOT EXISTS deleted_by     INTEGER;
ALTER TABLE service_categories ADD COLUMN IF NOT EXISTS deleted_reason VARCHAR(255);
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_categories_deleted_by_fkey') THEN
        ALTER TABLE service_categories
            ADD CONSTRAINT service_categories_deleted_by_fkey
            FOREIGN KEY (deleted_by) REFERENCES users(user_id)
            ON UPDATE CASCADE ON DELETE SET NULL;
    END IF;
END$$;
CREATE INDEX IF NOT EXISTS idx_service_categories_is_deleted ON service_categories(is_deleted) WHERE is_deleted = FALSE;

ALTER TABLE departments ADD COLUMN IF NOT EXISTS is_deleted     BOOLEAN     NOT NULL DEFAULT FALSE;
ALTER TABLE departments ADD COLUMN IF NOT EXISTS deleted_at     TIMESTAMPTZ;
ALTER TABLE departments ADD COLUMN IF NOT EXISTS deleted_by     INTEGER;
ALTER TABLE departments ADD COLUMN IF NOT EXISTS deleted_reason VARCHAR(255);
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'departments_deleted_by_fkey') THEN
        ALTER TABLE departments
            ADD CONSTRAINT departments_deleted_by_fkey
            FOREIGN KEY (deleted_by) REFERENCES users(user_id)
            ON UPDATE CASCADE ON DELETE SET NULL;
    END IF;
END$$;
CREATE INDEX IF NOT EXISTS idx_departments_is_deleted ON departments(is_deleted) WHERE is_deleted = FALSE;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'visits_status_check'
          AND conrelid = 'visits'::regclass
    ) THEN
        ALTER TABLE visits DROP CONSTRAINT visits_status_check;
    END IF;

    ALTER TABLE visits
        ADD CONSTRAINT visits_status_check
        CHECK (status::text = ANY (ARRAY['Active'::varchar, 'Completed'::varchar, 'Cancelled'::varchar, 'Deleted'::varchar]::text[]));
END$$;

CREATE INDEX IF NOT EXISTS idx_visits_visible
    ON visits(visit_date DESC)
    WHERE status::text NOT IN ('Deleted', 'Cancelled');

COMMIT;
