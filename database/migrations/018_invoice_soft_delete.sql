-- ===========================================================================
-- Migration 018: Invoice Soft Delete (حذف منطقي للفواتير)
-- ===========================================================================
-- الهدف:
--   تحويل آلية حذف الفواتير من حذف فعلي (DELETE) إلى حذف منطقي (Soft Delete)،
--   لتجنب أخطاء FK المرتبطة (مثل: تعذر حذف السجل لوجود بيانات مرتبطة به)،
--   مع الإبقاء على آلية إنقاص الأرقام التسلسلية للفواتير اللاحقة بمقدار 1.
--
-- التغييرات:
--   1) إضافة أعمدة (is_deleted, deleted_at, deleted_by, deleted_reason).
--   2) السماح بأن يكون serial_number = NULL للفواتير المحذوفة منطقياً.
--   3) استبدال CHECK ( serial_number > 0 ) بقيد مرن يقبل NULL.
--   4) إسقاط UNIQUE (doc_type_id, serial_number) واستبدالها بـ
--      UNIQUE INDEX جزئي يستثني الصفوف المحذوفة (is_deleted = FALSE).
--   5) فهرس لتسريع استعلامات استبعاد الفواتير المحذوفة.
-- ===========================================================================

BEGIN;

-- 1) أعمدة الحذف المنطقي
ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS is_deleted     BOOLEAN     NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS deleted_at     TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS deleted_by     INTEGER     NULL,
    ADD COLUMN IF NOT EXISTS deleted_reason VARCHAR(255) NULL;

-- 2) FK لتسجيل من قام بالحذف (SET NULL لو حُذف المستخدم)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_invoices_deleted_by'
          AND conrelid = 'public.invoices'::regclass
    ) THEN
        ALTER TABLE invoices
            ADD CONSTRAINT fk_invoices_deleted_by
            FOREIGN KEY (deleted_by) REFERENCES users(user_id)
            ON UPDATE CASCADE ON DELETE SET NULL;
    END IF;
END $$;

-- 3) جعل serial_number قابلاً للقيمة NULL (للفواتير المحذوفة منطقياً)
ALTER TABLE invoices ALTER COLUMN serial_number DROP NOT NULL;

-- 4) إعادة تشكيل قيد CHECK على serial_number ليقبل NULL
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_serial_number_check;
ALTER TABLE invoices
    ADD CONSTRAINT invoices_serial_number_check
    CHECK (serial_number IS NULL OR serial_number > 0);

-- 5) قيد فحص متّسق: الفاتورة المحذوفة منطقياً يجب أن يكون serial_number = NULL،
--    والفاتورة غير المحذوفة يجب أن يكون لها serial_number صالح.
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS chk_invoices_deleted_state;
ALTER TABLE invoices
    ADD CONSTRAINT chk_invoices_deleted_state
    CHECK (
        (is_deleted = FALSE AND serial_number IS NOT NULL)
        OR
        (is_deleted = TRUE  AND serial_number IS NULL)
    );

-- 6) قيد متّسق بين is_deleted و deleted_at
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS chk_invoices_deleted_at;
ALTER TABLE invoices
    ADD CONSTRAINT chk_invoices_deleted_at
    CHECK (
        (is_deleted = FALSE AND deleted_at IS NULL)
        OR
        (is_deleted = TRUE  AND deleted_at IS NOT NULL)
    );

-- 7) استبدال UNIQUE (doc_type_id, serial_number) بفهرس جزئي
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_doc_type_id_serial_number_key;
DROP INDEX IF EXISTS invoices_doc_type_id_serial_number_key;

CREATE UNIQUE INDEX IF NOT EXISTS ux_invoices_doctype_serial_active
    ON invoices (doc_type_id, serial_number)
    WHERE is_deleted = FALSE AND serial_number IS NOT NULL;

-- 8) فهرس لتسريع الاستعلامات التي تستثني الفواتير المحذوفة
CREATE INDEX IF NOT EXISTS ix_invoices_is_deleted ON invoices (is_deleted);

-- 9) فهرس على deleted_at للاستعلامات الزمنية
CREATE INDEX IF NOT EXISTS ix_invoices_deleted_at ON invoices (deleted_at)
    WHERE deleted_at IS NOT NULL;

COMMIT;
