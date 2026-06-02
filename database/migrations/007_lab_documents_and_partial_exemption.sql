-- =====================================================================
-- Migration 007: Laboratory Documents + Partial Exemption Split
-- Date: 2026-05-28
-- Purpose:
--   1) إضافة نوع مستند جديد (L) خاص بمستندات المختبر مع جدول
--      laboratory_documents لتسجيل استمارات الفحص التي يُصدرها
--      النظام تلقائياً عند إرسال الطبيب طلب فحص إلى قسم المختبر.
--
--   2) إصلاح خلل الإعفاء الجزئي: إضافة عمود related_invoice_id إلى
--      جدول invoices لربط سند الكاش (A) بسند الإعفاء (B) عند تنفيذ
--      عملية إعفاء جزئي. العلاقة قوية (Strong Relationship) عبر
--      مفتاح أجنبي ذاتي مع ON DELETE CASCADE — مما يضمن تتبّع
--      السندين معاً كعملية مالية واحدة.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1) إضافة نوع مستند المختبر (L) إلى document_types
-- ---------------------------------------------------------------------
INSERT INTO document_types (doc_code, doc_name, description) VALUES
    (5, 'L', 'مستندات المختبر (استمارة فحص تُصدر تلقائياً)')
ON CONFLICT (doc_name) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2) جدول laboratory_documents
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS laboratory_documents (
    lab_doc_id      SERIAL PRIMARY KEY,
    visit_id        INTEGER NOT NULL REFERENCES visits(visit_id) ON UPDATE CASCADE ON DELETE CASCADE,
    invoice_id      INTEGER REFERENCES invoices(invoice_id) ON UPDATE CASCADE ON DELETE SET NULL,
    serial_number   INTEGER NOT NULL CHECK (serial_number > 0),
    doc_type_id     INTEGER NOT NULL REFERENCES document_types(doc_type_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    doc_category    VARCHAR(30) NOT NULL DEFAULT 'laboratory' CHECK (doc_category = 'laboratory'),
    services_count  INTEGER NOT NULL DEFAULT 0 CHECK (services_count >= 0),
    notes           TEXT,
    issued_by       INTEGER REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_lab_docs_doctype_serial UNIQUE (doc_type_id, serial_number)
);

CREATE INDEX IF NOT EXISTS idx_lab_documents_visit_id    ON laboratory_documents(visit_id);
CREATE INDEX IF NOT EXISTS idx_lab_documents_invoice_id  ON laboratory_documents(invoice_id);
CREATE INDEX IF NOT EXISTS idx_lab_documents_doc_type    ON laboratory_documents(doc_type_id);
CREATE INDEX IF NOT EXISTS idx_lab_documents_created_at  ON laboratory_documents(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lab_documents_issued_by   ON laboratory_documents(issued_by);

DROP TRIGGER IF EXISTS trg_lab_documents_updated_at ON laboratory_documents;
CREATE TRIGGER trg_lab_documents_updated_at BEFORE UPDATE ON laboratory_documents
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- 3) عمود related_invoice_id في invoices لربط سندَي A و B في الإعفاء الجزئي
--    العلاقة ذاتية (self FK) مع ON DELETE CASCADE => علاقة قوية
--    (Strong Relationship) تضمن أن إلغاء أحد السندين يلغي شريكه
--    تلقائياً، فيُعاملان كعملية مالية واحدة في التقارير والمحاسبة.
-- ---------------------------------------------------------------------
ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS related_invoice_id INTEGER;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'invoices_related_invoice_id_fkey'
    ) THEN
        ALTER TABLE invoices
            ADD CONSTRAINT invoices_related_invoice_id_fkey
            FOREIGN KEY (related_invoice_id)
            REFERENCES invoices(invoice_id)
            ON UPDATE CASCADE
            ON DELETE CASCADE;
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_invoices_related_invoice_id
    ON invoices(related_invoice_id)
    WHERE related_invoice_id IS NOT NULL;

-- منع إشارة السند لنفسه
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_invoices_no_self_ref'
    ) THEN
        ALTER TABLE invoices
            ADD CONSTRAINT chk_invoices_no_self_ref
            CHECK (related_invoice_id IS NULL OR related_invoice_id <> invoice_id);
    END IF;
END$$;

COMMIT;

-- ✅ Done
