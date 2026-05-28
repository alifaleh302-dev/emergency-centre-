-- ============================================================================
-- Migration 009: المركز المالي والسندي الشامل (Financial Hub)
-- ============================================================================
-- الهدف:
--   1. إضافة فهارس أداء على جداول الحركات المالية لتسريع استعلامات
--      دفتر الحركات الموحّد (Unified Ledger) في المركز المالي الجديد.
--   2. إضافة إعدادات حصة الوزارة للتذاكر (صباحي/مسائي) في system_settings
--      لتكون قابلة للتخصيص من واجهة الإدارة دون الحاجة لتعديل الكود.
--   3. إعدادات إضافية للمركز المالي (الصفحة الافتراضية، حد التصدير).
--
-- ملاحظة:
--   - جميع الفهارس مع IF NOT EXISTS لضمان أمان إعادة التنفيذ.
--   - INSERT ... ON CONFLICT DO NOTHING لتجنب الكسر عند إعادة التنفيذ.
--   - لا تعديلات هيكلية على جداول البيانات الموجودة → آمنة 100%.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. فهارس الأداء — Invoices
-- ----------------------------------------------------------------------------
--   فهارس مركّبة تخدم الفلترة الزمنية المقترنة بنوع السند، وهو
--   النمط الأكثر تكراراً في المركز المالي (مثال: "كل سندات الكاش
--   في الفترة من-إلى").

-- (paid_at, doc_type_id) — استعلامات الإيراد بنوع السند خلال فترة
CREATE INDEX IF NOT EXISTS idx_invoices_paid_at_doc_type
    ON invoices(paid_at, doc_type_id)
    WHERE doc_type_id IS NOT NULL;

-- (accountant_id, paid_at) — حركات محاسب محدد + فلترة زمنية
CREATE INDEX IF NOT EXISTS idx_invoices_accountant_paid_at
    ON invoices(accountant_id, paid_at)
    WHERE doc_type_id IS NOT NULL;

-- (cancelled_at) — استدعاء السندات الملغاة فقط
CREATE INDEX IF NOT EXISTS idx_invoices_cancelled_at
    ON invoices(cancelled_at)
    WHERE cancelled_at IS NOT NULL;

-- (related_invoice_id) — التنقل بين سندي الإعفاء الجزئي (A↔B)
CREATE INDEX IF NOT EXISTS idx_invoices_related_invoice_id
    ON invoices(related_invoice_id)
    WHERE related_invoice_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. فهارس الأداء — Invoice Details
-- ----------------------------------------------------------------------------

-- (invoice_id) — التجميع لحساب center_share / ministry_share
CREATE INDEX IF NOT EXISTS idx_invoice_details_invoice_id
    ON invoice_details(invoice_id);

-- (service_id) — تقارير الخدمات (Top Services + فلترة بالخدمة)
CREATE INDEX IF NOT EXISTS idx_invoice_details_service_id
    ON invoice_details(service_id);

-- ----------------------------------------------------------------------------
-- 3. فهارس الأداء — Examination Tickets (التذاكر إيراد مستقل)
-- ----------------------------------------------------------------------------

-- (created_at, ticket_type) — تذاكر فترة محددة حسب النوع (صباحي/مسائي)
CREATE INDEX IF NOT EXISTS idx_tickets_created_at_type
    ON examination_tickets(created_at, ticket_type);

-- (issued_by) — أداء المحاسب في إصدار التذاكر
CREATE INDEX IF NOT EXISTS idx_tickets_issued_by
    ON examination_tickets(issued_by)
    WHERE issued_by IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 4. فهارس الأداء — Visits (للـ JOIN مع الأطباء/الحالات)
-- ----------------------------------------------------------------------------

-- (doctor_id, visit_date) — أداء الأطباء وتقاريرهم
CREATE INDEX IF NOT EXISTS idx_visits_doctor_date
    ON visits(doctor_id, visit_date);

-- (patient_id) — التنقل المتكرر من فاتورة/تذكرة إلى المريض
CREATE INDEX IF NOT EXISTS idx_visits_patient_id
    ON visits(patient_id);

-- ----------------------------------------------------------------------------
-- 5. فهارس الأداء — Services Master & Categories (لفلاتر القائمة)
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_services_master_category
    ON services_master(category_id)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_service_categories_department
    ON service_categories(department_id)
    WHERE is_active = TRUE;

-- ----------------------------------------------------------------------------
-- 6. إعدادات المركز المالي في system_settings
-- ----------------------------------------------------------------------------
--   ⭐ حصة الوزارة للتذاكر (قابلة للتخصيص مستقبلاً):
--      صباحي = 30 ريال (من تذكرة 100)
--      مسائي = 100 ريال (من تذكرة 500)

INSERT INTO system_settings (setting_key, setting_value, description) VALUES
    ('ticket_ministry_share_morning', '30',
     'حصة الوزارة من تذكرة المعاينة الصباحية (ريال يمني)'),
    ('ticket_ministry_share_evening', '100',
     'حصة الوزارة من تذكرة المعاينة المسائية (ريال يمني)'),
    ('finance_hub_default_page_size', '50',
     'عدد الحركات الافتراضي في صفحة المركز المالي الشامل'),
    ('finance_hub_export_limit', '10000',
     'الحد الأقصى لعدد الحركات في عملية تصدير XLSX واحدة'),
    ('finance_hub_currency_label', 'ريال',
     'وحدة العملة المعروضة في الواجهة والتقارير المالية')
ON CONFLICT (setting_key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 7. تحديث الإحصائيات (Analyze) — يحسّن خطة المُحسِّن (planner)
-- ----------------------------------------------------------------------------

ANALYZE invoices;
ANALYZE invoice_details;
ANALYZE examination_tickets;
ANALYZE visits;
ANALYZE services_master;
ANALYZE service_categories;

COMMIT;

-- ============================================================================
-- نهاية Migration 009
-- ============================================================================
