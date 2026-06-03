-- =====================================================================
-- 013_seal_historical_tickets.sql
-- إقفال أتوماتيكي للتذاكر التاريخية (قبل تشغيل migration 012)
-- =====================================================================
-- الهدف:
--   • قبل migration 012 لم يكن لدينا نظام إقفال للفترات.
--   • التذاكر الموجودة بتواريخ سابقة (قبل اليوم) لم يكن مفترضاً أن تُقفل،
--     لكن منطقياً يجب أن تُعتبر "بيانات تاريخية مكتومة".
--   • هذا الـ migration يولّد سجل إقفال "تاريخي" واحد لكل (نوع، تاريخ)
--     يحتوي تذاكر غير مُقفلة، ويربط التذاكر بهذا السجل لتجنّب إعاقة
--     النظام الجديد عند إصدار تذاكر اليوم.
--
-- يتم استخدام مستخدم نظام افتراضي للإقفال (المدير = role_id 5، أول مستخدم).
-- =====================================================================

BEGIN;

DO $$
DECLARE
    sys_user_id INTEGER;
    rec RECORD;
    closure_id INTEGER;
    morning_share NUMERIC(10,2);
    evening_share NUMERIC(10,2);
    ministry_per_ticket NUMERIC(10,2);
    center_share_val NUMERIC(12,2);
    ministry_share_val NUMERIC(12,2);
BEGIN
    -- 1) إيجاد مستخدم نظام للإقفال (المدير أو أي مستخدم نشط)
    SELECT user_id INTO sys_user_id
    FROM users
    WHERE is_active = TRUE
    ORDER BY (CASE WHEN role_id = 5 THEN 0 ELSE 1 END), user_id
    LIMIT 1;

    IF sys_user_id IS NULL THEN
        RAISE EXCEPTION 'لم يتم العثور على مستخدم نشط لإجراء الإقفال التاريخي.';
    END IF;

    -- 2) جلب حصص الوزارة من system_settings
    SELECT (setting_value)::NUMERIC INTO morning_share
    FROM system_settings WHERE setting_key = 'ticket_ministry_share_morning';
    SELECT (setting_value)::NUMERIC INTO evening_share
    FROM system_settings WHERE setting_key = 'ticket_ministry_share_evening';

    morning_share := COALESCE(morning_share, 0);
    evening_share := COALESCE(evening_share, 0);

    -- 3) لكل (نوع، تاريخ < اليوم) فيه تذاكر غير مُقفلة، أنشئ سجل إقفال تاريخي
    FOR rec IN
        SELECT
            ticket_type,
            DATE(created_at AT TIME ZONE 'UTC') AS shift_date,
            MIN(serial_number) AS start_no,
            MAX(serial_number) AS end_no,
            COUNT(*)::INTEGER AS tickets_count,
            COALESCE(SUM(amount), 0) AS total_amount
        FROM examination_tickets
        WHERE shift_closure_id IS NULL
          AND DATE(created_at AT TIME ZONE 'UTC') < CURRENT_DATE
        GROUP BY ticket_type, DATE(created_at AT TIME ZONE 'UTC')
        ORDER BY shift_date, ticket_type
    LOOP
        ministry_per_ticket := CASE WHEN rec.ticket_type = 'morning'
                                    THEN morning_share ELSE evening_share END;
        ministry_share_val  := ministry_per_ticket * rec.tickets_count;
        center_share_val    := GREATEST(0, rec.total_amount - ministry_share_val);

        -- تحقق من عدم وجود إقفال سابق لهذا اليوم/النوع
        IF EXISTS (
            SELECT 1 FROM shifts_closures
            WHERE shift_type = rec.ticket_type AND shift_date = rec.shift_date
        ) THEN
            -- إذا وُجد سجل سابق، نربط التذاكر به ونتجاوز الإنشاء
            UPDATE examination_tickets et
            SET shift_closure_id = (
                SELECT id FROM shifts_closures
                WHERE shift_type = rec.ticket_type AND shift_date = rec.shift_date
                LIMIT 1
            )
            WHERE et.shift_closure_id IS NULL
              AND et.ticket_type = rec.ticket_type
              AND DATE(et.created_at AT TIME ZONE 'UTC') = rec.shift_date;
            CONTINUE;
        END IF;

        -- إنشاء سجل إقفال تاريخي (بدون closing_invoice_id لأنه تاريخي)
        INSERT INTO shifts_closures (
            shift_type, shift_date, start_ticket_no, end_ticket_no,
            tickets_count, center_share, ministry_share, total_amount,
            closing_invoice_id, closed_by, status
        ) VALUES (
            rec.ticket_type, rec.shift_date, rec.start_no, rec.end_no,
            rec.tickets_count, center_share_val, ministry_share_val, rec.total_amount,
            NULL,  -- لا يوجد سند تحصيل (إقفال تاريخي بدون توليد سند)
            sys_user_id, 'locked'
        ) RETURNING id INTO closure_id;

        -- ربط التذاكر بسجل الإقفال
        UPDATE examination_tickets
        SET shift_closure_id = closure_id
        WHERE shift_closure_id IS NULL
          AND ticket_type = rec.ticket_type
          AND DATE(created_at AT TIME ZONE 'UTC') = rec.shift_date;

        RAISE NOTICE 'تم إقفال تاريخي: % | تاريخ %: تذاكر من % إلى % (% تذكرة) إجمالي %',
                     rec.ticket_type, rec.shift_date, rec.start_no, rec.end_no,
                     rec.tickets_count, rec.total_amount;
    END LOOP;

END $$;

COMMIT;
