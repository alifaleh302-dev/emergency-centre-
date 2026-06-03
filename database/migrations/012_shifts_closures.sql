-- =====================================================================
-- 012_shifts_closures.sql
-- إقفال فترات تذاكر المعاينة (صباحي / مسائي) وربطها بالسندات
-- =====================================================================
-- المنطق:
--   • تذاكر المعاينة (examination_tickets) لها نوعان: morning / evening
--     ولكل نوع سعر إجمالي + حصة وزارة + حصة مركز (في system_settings).
--   • عند نهاية الفترة، يقوم أمين الصندوق بـ "إقفال الفترة" (Lock Period).
--   • النظام يُولّد سند A إجمالي واحد لكل التذاكر غير المُقفلة من نفس النوع
--     ويُسجّل سجل في shifts_closures يحوي حصص المركز والوزارة بشكل مجمّع.
--   • بعد الإقفال، يُمنع إصدار تذاكر جديدة من نفس النوع لنفس اليوم.
-- =====================================================================

BEGIN;

-- =====================================================================
-- 1) جدول shifts_closures: سجل إقفالات الفترات
-- =====================================================================
CREATE TABLE IF NOT EXISTS shifts_closures (
    id                  SERIAL PRIMARY KEY,

    -- نوع الفترة (صباحي / مسائي)
    shift_type          VARCHAR(10) NOT NULL
                        CHECK (shift_type IN ('morning','evening')),

    -- تاريخ يوم الفترة (للتفرقة بين فترات أيام مختلفة)
    shift_date          DATE NOT NULL DEFAULT CURRENT_DATE,

    -- نطاق تسلسل التذاكر المضمومة في هذا الإقفال
    start_ticket_no     INTEGER NOT NULL CHECK (start_ticket_no > 0),
    end_ticket_no       INTEGER NOT NULL CHECK (end_ticket_no   > 0),
    tickets_count       INTEGER NOT NULL CHECK (tickets_count   > 0),

    -- الحصص المالية الإجمالية المحسوبة (من system_settings × عدد التذاكر)
    center_share        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (center_share   >= 0),
    ministry_share      NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (ministry_share >= 0),
    total_amount        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_amount   >= 0),

    -- ربط بسند A الإجمالي المُولَّد تلقائياً عند الإقفال
    closing_invoice_id  INTEGER REFERENCES invoices(invoice_id)
                        ON UPDATE CASCADE ON DELETE SET NULL,

    -- المستخدم الذي قام بالإقفال
    closed_by           INTEGER NOT NULL REFERENCES users(user_id)
                        ON UPDATE CASCADE ON DELETE RESTRICT,
    closed_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- حالة الفترة:
    --   'open'   = فترة محسوبة لكنها لم تُقفل رسمياً (محجوزة للحالات المستقبلية)
    --   'locked' = فترة مُقفلة نهائياً (الحالة الافتراضية عند الإنشاء)
    status              VARCHAR(10) NOT NULL DEFAULT 'locked'
                        CHECK (status IN ('open','locked')),

    created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- منع وجود أكثر من إقفال لنفس النوع في نفس اليوم
    CONSTRAINT uq_shift_closures_type_date UNIQUE (shift_type, shift_date),

    -- التأكد من اتساق نطاق التسلسل
    CONSTRAINT chk_shift_closures_range CHECK (end_ticket_no >= start_ticket_no)
);

CREATE INDEX IF NOT EXISTS idx_shifts_closures_shift_type ON shifts_closures(shift_type);
CREATE INDEX IF NOT EXISTS idx_shifts_closures_shift_date ON shifts_closures(shift_date DESC);
CREATE INDEX IF NOT EXISTS idx_shifts_closures_closed_by  ON shifts_closures(closed_by);
CREATE INDEX IF NOT EXISTS idx_shifts_closures_status     ON shifts_closures(status);

-- Trigger لتحديث updated_at تلقائياً (مع التحقق من وجود الدالة)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at'
    ) THEN
        DROP TRIGGER IF EXISTS trg_shifts_closures_updated_at ON shifts_closures;
        CREATE TRIGGER trg_shifts_closures_updated_at
        BEFORE UPDATE ON shifts_closures
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
END $$;

-- =====================================================================
-- 2) ربط التذاكر بالإقفال
-- =====================================================================
-- نضيف عمود shift_closure_id إلى examination_tickets للسماح بتحديد
-- أي تذكرة دخلت في أي إقفال (للتدقيق وتجنّب الإقفال المزدوج).
ALTER TABLE examination_tickets
    ADD COLUMN IF NOT EXISTS shift_closure_id INTEGER;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_examination_tickets_shift_closure_id'
          AND conrelid = 'examination_tickets'::regclass
    ) THEN
        ALTER TABLE examination_tickets
            ADD CONSTRAINT fk_examination_tickets_shift_closure_id
            FOREIGN KEY (shift_closure_id)
            REFERENCES shifts_closures(id)
            ON UPDATE CASCADE
            ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_examination_tickets_shift_closure_id
    ON examination_tickets(shift_closure_id)
    WHERE shift_closure_id IS NOT NULL;

-- =====================================================================
-- 3) ربط الفواتير (الاختياري) بالإقفال - للسند الإجمالي A
-- =====================================================================
-- شف ملاحظة: السندات العادية (سندات أقسام) لا تُربط بالإقفال بناءً
-- على قرار المستخدم. هذا الحقل يُستخدم فقط لسند A الإجمالي للتذاكر،
-- وأيضاً متاح للحالات المستقبلية (تدقيق شامل).
ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS shift_closure_id INTEGER;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_invoices_shift_closure_id'
          AND conrelid = 'invoices'::regclass
    ) THEN
        ALTER TABLE invoices
            ADD CONSTRAINT fk_invoices_shift_closure_id
            FOREIGN KEY (shift_closure_id)
            REFERENCES shifts_closures(id)
            ON UPDATE CASCADE
            ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_invoices_shift_closure_id
    ON invoices(shift_closure_id)
    WHERE shift_closure_id IS NOT NULL;

COMMIT;
