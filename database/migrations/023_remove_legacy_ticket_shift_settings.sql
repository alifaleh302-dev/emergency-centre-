-- Migration 023: إزالة إعدادات ساعات التذكرة القديمة + مزامنة التذاكر الحالية
-- الهدف:
--   1) جعل نوع التذكرة يعتمد فقط على تعريف الفترات المالية في جدول shifts
--      والإعدادات الافتراضية shift_default_*.
--   2) مزامنة التذاكر الحالية مع الفترة الفعلية المحفوظة على الزيارة.
--   3) حذف مفاتيح النظام القديمة التي كانت تسبب تعارضاً مع القرص الدائري
--      في شاشة إعدادات المدير.

BEGIN;

UPDATE examination_tickets AS t
SET ticket_type = s.shift_type,
    amount = CASE
        WHEN s.shift_type = 'morning' THEN COALESCE(
            (
                SELECT NULLIF(setting_value, '')::numeric
                FROM system_settings
                WHERE setting_key = 'ticket_price_morning'
                LIMIT 1
            ),
            100
        )
        ELSE COALESCE(
            (
                SELECT NULLIF(setting_value, '')::numeric
                FROM system_settings
                WHERE setting_key = 'ticket_price_evening'
                LIMIT 1
            ),
            500
        )
    END
FROM visits AS v
JOIN shifts AS s ON s.shift_id = v.shift_id
WHERE t.visit_id = v.visit_id
  AND (
      t.ticket_type IS DISTINCT FROM s.shift_type
      OR t.amount IS NULL
      OR (
          s.shift_type = 'morning'
          AND t.amount IS DISTINCT FROM COALESCE(
              (
                  SELECT NULLIF(setting_value, '')::numeric
                  FROM system_settings
                  WHERE setting_key = 'ticket_price_morning'
                  LIMIT 1
              ),
              100
          )
      )
      OR (
          s.shift_type = 'evening'
          AND t.amount IS DISTINCT FROM COALESCE(
              (
                  SELECT NULLIF(setting_value, '')::numeric
                  FROM system_settings
                  WHERE setting_key = 'ticket_price_evening'
                  LIMIT 1
              ),
              500
          )
      )
  );

DELETE FROM system_settings
WHERE setting_key IN (
    'ticket_morning_start_hour',
    'ticket_morning_end_hour'
);

COMMIT;
