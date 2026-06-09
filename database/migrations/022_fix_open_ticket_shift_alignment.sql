-- 022_fix_open_ticket_shift_alignment.sql
-- مزامنة التذاكر المفتوحة مع الفترة الحقيقية المحفوظة على الزيارة.
-- يعالج حالات ما بعد منتصف الليل التي سُجلت legacy كمسائية رغم أن shifts تعتبرها صباحية.

BEGIN;

WITH prices AS (
    SELECT
        MAX(CASE WHEN setting_key = 'ticket_price_morning' THEN setting_value::NUMERIC END) AS morning_price,
        MAX(CASE WHEN setting_key = 'ticket_price_evening' THEN setting_value::NUMERIC END) AS evening_price
    FROM system_settings
),
updates AS (
    UPDATE examination_tickets t
       SET ticket_type = s.shift_type,
           amount = CASE
               WHEN s.shift_type = 'morning' THEN COALESCE((SELECT morning_price FROM prices), t.amount)
               WHEN s.shift_type = 'evening' THEN COALESCE((SELECT evening_price FROM prices), t.amount)
               ELSE t.amount
           END
      FROM visits v
      JOIN shifts s ON s.shift_id = v.shift_id
     WHERE t.visit_id = v.visit_id
       AND t.shift_closure_id IS NULL
       AND (
            t.ticket_type IS DISTINCT FROM s.shift_type
            OR (
                s.shift_type = 'morning'
                AND t.amount IS DISTINCT FROM COALESCE((SELECT morning_price FROM prices), t.amount)
            )
            OR (
                s.shift_type = 'evening'
                AND t.amount IS DISTINCT FROM COALESCE((SELECT evening_price FROM prices), t.amount)
            )
       )
    RETURNING t.ticket_id, t.serial_number, s.shift_type
)
SELECT COUNT(*) AS updated_rows FROM updates;

COMMIT;
