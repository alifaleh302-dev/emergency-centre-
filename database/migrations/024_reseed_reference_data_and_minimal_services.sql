-- ============================================================================
-- Migration 024: Reseed missing reference data + minimal services baseline
-- Date: 2026-06-28
-- Purpose:
--   1) إصلاح البيئات التي فقدت بياناتها المرجعية الأساسية (document_types,
--      system_settings) مما يسبب فشل فتح الزيارة/إصدار التذكرة برسالة عامة.
--   2) إضافة خدمات دنيا قابلة للاختبار فقط إذا كان جدول services_master فارغاً
--      بالكامل، حتى تعمل واجهة الطبيب وإرسال الطلبات بعد الترحيل مباشرة.
--
-- Safety:
--   - جميع عمليات الإدراج شرطية (IF NOT EXISTS / ON CONFLICT DO NOTHING).
--   - لا يتم تعديل أي بيانات موجودة مسبقاً.
--   - لا تتم إضافة الخدمات الدنيا إلا إذا كان services_master فارغاً تماماً.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1) ضمان وجود أنواع المستندات الأساسية A/B/C/T/L
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM document_types WHERE doc_name = 'A') THEN
        INSERT INTO document_types (doc_code, doc_name, current_serial, description)
        VALUES (1, 'A', 0, 'سند نقدي');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM document_types WHERE doc_name = 'B') THEN
        INSERT INTO document_types (doc_code, doc_name, current_serial, description)
        VALUES (2, 'B', 0, 'سند إعفاء');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM document_types WHERE doc_name = 'C') THEN
        INSERT INTO document_types (doc_code, doc_name, current_serial, description)
        VALUES (3, 'C', 0, 'سند إعفاء كلي');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM document_types WHERE doc_name = 'T') THEN
        INSERT INTO document_types (doc_code, doc_name, current_serial, description)
        VALUES (
            4,
            'T',
            COALESCE((SELECT MAX(serial_number) FROM examination_tickets), 0),
            'تذاكر المعاينة'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM document_types WHERE doc_name = 'L') THEN
        INSERT INTO document_types (doc_code, doc_name, current_serial, description)
        VALUES (
            5,
            'L',
            COALESCE((SELECT MAX(serial_number) FROM laboratory_documents), 0),
            'مستندات المختبر (استمارة فحص تُصدر تلقائياً)'
        );
    END IF;
END$$;

-- ----------------------------------------------------------------------------
-- 2) إعادة زرع إعدادات الترويسة وأسعار التذاكر والإعدادات المالية الأساسية
-- ----------------------------------------------------------------------------
INSERT INTO system_settings (setting_key, setting_value, description) VALUES
    ('header_country',                 'الجمهورية اليمنية',                         'اسم الدولة في ترويسة النماذج'),
    ('header_ministry',                'وزارة الصحة العامة والسكان',                'اسم الوزارة في ترويسة النماذج'),
    ('header_office',                  'مكتب الصحة والبيئة م/ حجة',                 'اسم المكتب/المحافظة في الترويسة'),
    ('header_directorate',             'مكتب الصحة والبيئة بمديرية كحلان عفار',     'اسم المديرية في الترويسة'),
    ('header_center',                  'مركز طوارئ الطرق',                           'اسم المركز/المنشأة الصحية في الترويسة'),
    ('header_admin',                   'إدارة مشاركة المجتمع',                       'الإدارة المسؤولة في الترويسة'),
    ('header_form_title',              'تذكرة معاينة',                               'عنوان النموذج المطبوع'),
    ('header_logo_url',                '',                                           'رابط شعار المؤسسة (اختياري)'),
    ('header_footer_note',             'ملاحظة: لا تقبل تذكرة المعاينة بدون ختم إدارة مشاركة المجتمع.', 'ملاحظة أسفل النموذج المطبوع'),
    ('header_side_note',               '',                                           'نص جانبي صغير (اختياري) على هامش النموذج'),
    ('ticket_price_morning',           '100',                                        'سعر تذكرة المعاينة الصباحية (ريال)'),
    ('ticket_price_evening',           '500',                                        'سعر تذكرة المعاينة المسائية (ريال)'),
    ('ticket_morning_start_hour',      '5',                                          'ساعة بداية الفترة الصباحية (0-23)'),
    ('ticket_morning_end_hour',        '12',                                         'ساعة نهاية الفترة الصباحية (0-23)'),
    ('ticket_ministry_share_morning',  '30',                                         'حصة الوزارة من تذكرة المعاينة الصباحية (ريال يمني)'),
    ('ticket_ministry_share_evening',  '100',                                        'حصة الوزارة من تذكرة المعاينة المسائية (ريال يمني)'),
    ('finance_hub_default_page_size',  '50',                                         'عدد الحركات الافتراضي في صفحة المركز المالي الشامل'),
    ('finance_hub_export_limit',       '10000',                                      'الحد الأقصى لعدد الحركات في عملية تصدير XLSX واحدة'),
    ('finance_hub_currency_label',     'ريال',                                       'وحدة العملة المعروضة في الواجهة والتقارير المالية')
ON CONFLICT (setting_key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3) إضافة خدمات دنيا للاختبار فقط إذا كان services_master فارغاً بالكامل
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM services_master LIMIT 1) THEN
        INSERT INTO services_master (category_id, service_name, center_share, ministry_share, is_active)
        SELECT sc.category_id, seed.service_name, seed.center_share, seed.ministry_share, TRUE
        FROM (
            VALUES
                ('تحاليل دم عامة',     'تحليل CBC',         1200.00, 300.00),
                ('أشعة سينية',          'أشعة صدر',          2500.00, 500.00),
                ('حقن وإبر',            'حقنة عضلية',         400.00, 100.00),
                ('أدوية مسكنات',        'باراسيتامول',        150.00,  50.00),
                ('كشف طوارئ',           'كشف طوارئ عام',      700.00, 300.00),
                ('شهادات طبية',         'شهادة طبية',         400.00, 100.00)
        ) AS seed(category_name, service_name, center_share, ministry_share)
        JOIN service_categories sc
          ON sc.category_name = seed.category_name
         AND COALESCE(sc.is_deleted, FALSE) = FALSE;
    END IF;
END$$;

COMMIT;

-- ============================================================================
-- End of Migration 024
-- ============================================================================
