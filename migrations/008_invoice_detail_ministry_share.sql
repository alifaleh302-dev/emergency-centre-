-- =====================================================================
-- Migration 008: Ministry Share per Invoice Detail
-- Date: 2026-05-28
-- Purpose:
--   إضافة عمود جديد ministry_share_at_time إلى جدول invoice_details
--   لتسجيل حصة الوزارة لكل خدمة لحظة إصدار الفاتورة.
--
--   منطق العمل (Business Rule):
--     * حصة الوزارة ثابتة لكل خدمة كما هي موثقة في services_master.
--     * تُحسب وتُخزَّن فقط عندما يصبح السند من نوع A
--       (سواء "كاش كامل" أو الجزء النقدي A الناتج عن إعفاء جزئي).
--     * تبقى = 0 لسندات B (إعفاء جزئي/كلي ضمن سند الإعفاء) و C (إعفاء كلي)
--       لأن الوزارة لا تستحق حصتها من خدمات معفاة.
--     * القيمة = services_master.ministry_share × invoice_details.quantity
--       لحظة الدفع، ولا تتأثر بأي تعديل لاحق على جدول الخدمات.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1) إضافة العمود مع قيمة افتراضية 0 وقيد عدم السالبية
-- ---------------------------------------------------------------------
ALTER TABLE invoice_details
    ADD COLUMN IF NOT EXISTS ministry_share_at_time NUMERIC(10,2) NOT NULL DEFAULT 0.00;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_invoice_details_ministry_share_nonneg'
    ) THEN
        ALTER TABLE invoice_details
            ADD CONSTRAINT chk_invoice_details_ministry_share_nonneg
            CHECK (ministry_share_at_time >= 0);
    END IF;
END$$;

-- ---------------------------------------------------------------------
-- 2) فهرس مساعد لتجميعات تقارير حصة الوزارة (اختياري لكن مفيد)
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_invoice_details_ministry_share
    ON invoice_details(invoice_id)
    WHERE ministry_share_at_time > 0;

-- ---------------------------------------------------------------------
-- 3) Backfill: تعبئة القيم تاريخياً لكل تفاصيل الفواتير من نوع A
--    (سواء كاش كامل أو الجزء النقدي من إعفاء جزئي)
-- ---------------------------------------------------------------------
UPDATE invoice_details id
SET ministry_share_at_time = sm.ministry_share * id.quantity
FROM services_master sm,
     invoices i,
     document_types dt
WHERE id.service_id = sm.service_id
  AND id.invoice_id = i.invoice_id
  AND i.doc_type_id = dt.doc_type_id
  AND dt.doc_name = 'A'
  AND id.ministry_share_at_time = 0;

COMMIT;

-- ✅ Done
