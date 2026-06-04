-- =============================================================================
-- Migration 015: دعم إعادة فتح الفترات + إضافة 'REOPEN' لإجراءات سجل التدقيق
-- =============================================================================
--
-- الغرض:
--   1) إضافة الإجراء 'REOPEN' كقيمة مسموحة في audit_logs.action
--      (يُستخدم عند تسجيل عملية إعادة فتح الفترة الأخيرة في سجل التدقيق).
--
-- ملاحظات حول التعديلات الجديدة المُضافة في طبقة التطبيق (PHP)
-- والتي لا تتطلب تغييرات في الـ schema:
--   • قواعد حذف السندات (تحديث serial_number وعداد document_types) مُطبَّقة
--     في AdminModel::deleteInvoiceWithSerialAdjustment.
--   • ضوابط التسديد الصارمة (الفترة السابقة يجب أن تكون مُقفلة) مُطبَّقة
--     في AccountingModel::findBlockingPreviousShift.
--   • إعادة فتح الفترة الأخيرة فقط مُطبَّقة في AdminModel::reopenLatestShift.
--
-- المعاملات (transactions):
--   كل تعديلات طبقة التطبيق تجري داخل BEGIN/COMMIT لضمان ذرّية العملية.
-- =============================================================================

BEGIN;

-- توسيع قائمة الإجراءات المسموحة لتشمل 'REOPEN'
ALTER TABLE audit_logs
    DROP CONSTRAINT IF EXISTS audit_logs_action_check;

ALTER TABLE audit_logs
    ADD CONSTRAINT audit_logs_action_check
    CHECK (action::text = ANY (ARRAY[
        'CREATE'::character varying,
        'UPDATE'::character varying,
        'DELETE'::character varying,
        'LOGIN'::character varying,
        'LOGOUT'::character varying,
        'CANCEL'::character varying,
        'EXPORT'::character varying,
        'IMPORT'::character varying,
        'VIEW'::character varying,
        'REOPEN'::character varying,
        'OTHER'::character varying
    ]::text[]));

COMMIT;
