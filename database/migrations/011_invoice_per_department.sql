-- =====================================================================
-- 011_invoice_per_department.sql
-- ربط السندات بالأقسام لتمكين فصل السندات بحسب القسم
-- =====================================================================
-- المنطق:
--   • السندات قبل هذه المرحلة كانت مجمّعة (سند واحد لكل زيارة)
--     ويحتوي على خدمات من أقسام متعددة (مختبر/أشعة/...).
--   • بعد التعديل، تقوم DoctorController::sendOrders بإنشاء سند منفصل
--     لكل قسم داخل نفس Database Transaction.
--   • لذلك نُضيف عمود department_id (Nullable) ليكون السند مرتبطاً
--     مباشرةً بقسم واحد، مع الإبقاء على NULL للسندات التاريخية القديمة.
-- =====================================================================

BEGIN;

-- 1) إضافة عمود department_id إلى جدول invoices (Nullable للتوافق مع البيانات السابقة)
ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS department_id INTEGER;

-- 2) ربط العمود بجدول departments عبر Foreign Key مع تجنّب التكرار
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_invoices_department_id'
          AND conrelid = 'invoices'::regclass
    ) THEN
        ALTER TABLE invoices
            ADD CONSTRAINT fk_invoices_department_id
            FOREIGN KEY (department_id)
            REFERENCES departments(department_id)
            ON UPDATE CASCADE
            ON DELETE RESTRICT;
    END IF;
END $$;

-- 3) فهرس لرفع أداء استعلامات اليومية والفلترة بالقسم
CREATE INDEX IF NOT EXISTS idx_invoices_department_id
    ON invoices(department_id)
    WHERE department_id IS NOT NULL;

-- 4) ترحيل ذكي للبيانات القديمة:
--    لكل فاتورة قديمة (department_id IS NULL) نحاول استنباط القسم
--    من invoice_details → services_master → service_categories.department_id.
--    إذا كانت الفاتورة تحتوي خدمات من قسم واحد فقط، نُسجّل ذلك القسم.
--    إذا كانت من أقسام متعددة (الحالة القديمة)، نُبقيها NULL ونعتبرها
--    "سند مختلط تاريخي" (لا يجب أن يحصل بعد التعديل).
UPDATE invoices i
SET department_id = sub.dept_id
FROM (
    SELECT id_inv.invoice_id,
           MAX(sc.department_id) AS dept_id,
           COUNT(DISTINCT sc.department_id) AS distinct_depts
    FROM invoice_details id_inv
    JOIN services_master sm ON sm.service_id = id_inv.service_id
    JOIN service_categories sc ON sc.category_id = sm.category_id
    GROUP BY id_inv.invoice_id
    HAVING COUNT(DISTINCT sc.department_id) = 1
) sub
WHERE i.invoice_id = sub.invoice_id
  AND i.department_id IS NULL;

COMMIT;
