-- ============================================================================
-- Migration 004 - Phase 1 Performance Indexes
-- ============================================================================
-- آمنة بالكامل:
--   • CREATE INDEX IF NOT EXISTS  → لا تخلق فهارس مكررة
--   • CONCURRENTLY                 → لا تقفل الجداول، المستخدمون الحاليون يكملون
--   • EXTENSION IF NOT EXISTS      → لا تكرر تثبيت الإضافة
-- لا تحذف أي جدول، لا تعدل أي بيانات، لا تعدل أي عمود.
-- ============================================================================

-- pg_trgm لتسريع البحث الجزئي على أسماء المرضى (ILIKE %term%)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1) فهرس trigram على full_name للمرضى → بحث doctor/search_patient يصبح فوريًا
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patients_full_name_trgm
    ON patients USING gin (full_name gin_trgm_ops);

-- 2) فهرس جزئي للفواتير المعلقة (accounting/pending) → الأكثر استدعاءً
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_pending
    ON invoices (created_at ASC)
    WHERE accountant_id IS NULL AND doc_type_id IS NULL AND cancelled_at IS NULL;

-- 3) فهرس جزئي للفواتير المدفوعة اليوم (admin/dashboard counters)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_paid_active
    ON invoices (COALESCE(paid_at, created_at) DESC)
    WHERE accountant_id IS NOT NULL AND cancelled_at IS NULL;

-- 4) فهرس مركب للزيارات النشطة لكل طبيب (doctor/waiting_list)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_visits_doctor_active
    ON visits (doctor_id, created_at ASC)
    WHERE status = 'Active';

-- 5) فهرس للزيارات المكتملة (medical_archive)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_visits_patient_completed
    ON visits (patient_id, created_at DESC)
    WHERE status = 'Completed';

-- 6) فهرس على invoice_details(invoice_id) موجود مسبقاً، لكن نضيف service_id+invoice
-- للتجميع السريع في getInvoiceDetails (موجود بالفعل composite unique key)

-- 7) فهرس على audit_logs للفلترة بالـ user+date (admin/audit_log)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_user_date
    ON audit_logs (user_id, created_at DESC);

-- 8) ANALYZE لتحديث الإحصائيات (الـ planner)
ANALYZE patients;
ANALYZE invoices;
ANALYZE visits;
ANALYZE audit_logs;
