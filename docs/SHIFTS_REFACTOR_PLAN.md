# 📋 خطة إعادة هيكلة نظام إدارة الفترات المالية

> **الحالة:** مسودّة للمراجعة قبل البدء بالتنفيذ
> **المستودع:** `alifaleh302-dev/emergency-centre-`
> **الفرع المستهدف:** `main`
> **آخر مراجعة للنظام:** بناءً على Migrations حتى `015_reopen_shift_and_audit_action.sql` و JS modules الحالية
> **اللغة:** عربي / PHP 8 + PostgreSQL + Vanilla JS

---

## 1. الوضع الحالي (Baseline) — ماذا يوجد فعلاً اليوم؟

قبل أي قرار إصلاح، إليك توصيف دقيق لما هو **موجود ومنفّذ بالفعل** في الكود وقاعدة البيانات:

### 1.1 الجداول الموجودة المتعلّقة بالفترات

| الجدول | الغرض الحالي | ملاحظة |
|--------|--------------|--------|
| `shifts_closures` | **سجل عمليات الإقفال** (وليس تعريف الفترات نفسها). يخزّن نوع الفترة، تاريخها، نطاق التذاكر، الحصص، السند الإجمالي، ومن نفّذ الإقفال. | عمود `status VARCHAR(10) CHECK IN ('open','locked')` — يُحرَّر يدوياً كنص. |
| `system_settings` (مجموعة `shifts`) | يخزّن حدود الفترات كقيم نصية عامّة (`shift_morning_start`, `shift_morning_end`, `shift_evening_start`, `shift_evening_end`, `shift_overnight_belongs_to`). | الإعدادات **عامّة وثابتة** — لا تختلف من يوم لآخر، ولا يوجد جدول يحفظ "الحدود التي كانت سارية في يوم معيّن". |
| `examination_tickets.shift_closure_id` | يربط كل تذكرة بسجل الإقفال الذي ضمّها. | NULL يعني تذكرة لم تُقفل بعد. |
| `invoices.shift_closure_id` | يربط فقط **السند الإجمالي A** الناتج عن الإقفال بسجل الإقفال. | الفواتير العادية (سندات الأقسام) **لا تُربط** بالفترة حالياً. |
| `visits` | لا تحتوي على أي ربط مباشر بالفترة. | فجوة هندسية — انظر §11. |

### 1.2 الإعدادات الفعلية في قاعدة بيانات Render حالياً

```
shift_morning_start         = 00:00
shift_morning_end           = 12:00
shift_evening_start         = 12:00
shift_evening_end           = 23:00     ← يخلق فجوة بين 23:00 و 00:00
shift_overnight_belongs_to  = morning_same_day
enforce_shift_payment_order = true
allow_zero_invoices_implicit_close = true
allow_admin_payment_override = true
```

### 1.3 منطق تحديد الفترة (`SettingsService::resolveShiftFor`)

ملف `src/Utils/SettingsService.php`، الدالة تأخذ `DateTimeInterface` وتُرجع `['shift_type', 'shift_date', 'in_dead_zone']` بناءً على:
- الإعدادات النصية من `system_settings`.
- خيار `shift_overnight_belongs_to` لمعالجة الفجوة الليلية.

> ⚠️ **مشكلة جوهرية:** هذه الدالة لا تعرف شيئاً عن "حدود اليوم نفسه". إذا غيّر المدير الإعدادات اليوم، فإن جميع التقارير التاريخية تُعاد حسابها بالحدود الجديدة → **التقارير لا تبقى صحيحة بنسبة 100% عند تغيير الإعدادات** (وهو ما يخالف صراحةً المتطلّب §5).

### 1.4 الإقفال اليدوي (موجود)

- المسار: `POST /api/accounting/close_shift`.
- المتحكّم: `AccountingController::closeShift()` → `AccountingModel::closeShift()`.
- يُولّد سند **A إجمالي** لمجموع تذاكر الفترة، ويربط التذاكر بسجل `shifts_closures`.
- **لكنه يرفض الإقفال إذا لم توجد تذاكر** (`'لا توجد تذاكر في الفترة المحددة لإقفالها.'`) — هذا غير متوافق مع المتطلب §9.2 الذي يطلب أن يفحص النظام **الفواتير المعلّقة** لا التذاكر.
- لا يفحص حالياً وجود فواتير معلّقة (سندات أقسام B/C) قبل السماح بالإقفال.

### 1.5 الإقفال التلقائي (غير موجود)

- 🛑 **لا يوجد cron job، ولا scheduler، ولا hook عند بدء/نهاية الفترة.**
- لا يوجد كود يقفل الفترة عند بلوغ `shift_morning_end` أو `shift_evening_end`.
- لا يوجد منطق يولّد سند A إجمالي للسندات/الفواتير المعلّقة عند انتهاء الفترة.

### 1.6 إعادة الفتح (موجود لكن مقيّد بآخر فترة)

- مسار الأمين: `POST /api/accounting/reopen_shift` (دالة `AccountingController::reopenShift`).
- مسار المدير: `POST /api/admin/reopen_shift` (دالة `AdminController::reopenShift` → `AdminModel::reopenLatestShift`).
- يسمح فقط بإعادة فتح **آخر سجل في `shifts_closures`** (الأحدث `closed_at DESC`).
- يحذف سند الإقفال A، ويفصل التذاكر، ويحذف سجل الإقفال.

### 1.7 شاشة اليومية وشاشة المعلومية اليومية

- `daily_journal.js` (899 سطر): شاشة اليومية — تعرض السندات المدفوعة ليوم محدّد، وتعرض صف الإقفال بزر "🔒 إقفال الفترة" + "🔓 إعادة فتح".
- `daily_info.js` (863 سطر): شاشة المعلومية اليومية — ملخص يومي بأعمدة لكل فترة (ص / م / ج).
- **الشاشتان منفصلتان منطقياً ولا تتشاركان نفس مصدر البيانات المُجمَّع** (كل واحدة تنادي API مختلفاً).

### 1.8 مركز الجداول (Admin Tables Center)

- `AdminModel::getSchema()` يقرأ تلقائياً من `information_schema`.
- `shifts_closures` يظهر تلقائياً كجدول قابل للتعديل (CRUD).
- حقل `status` يُعرَض حالياً **كحقل نصّي حر** لأنه `VARCHAR(10)` وليس `USER-DEFINED ENUM` — منطق `getTableMeta` يُملأ `enum_values` فقط لأنواع ENUM الحقيقية.

---

## 2. الفجوات بين الواقع والمتطلّب

| # | المتطلب | الحالة الحالية | الفجوة |
|---|---------|---------------|---------|
| 2 | التقسيم الافتراضي 12:00 ص → 12:00 ظ → 12:00 ص بدون فجوة | يوجد فجوة بين 23:00 و 00:00 يعالجها `shift_overnight_belongs_to` | يجب إزالة المفهوم بالكامل واعتماد حدّ واحد فقط بين الفترتين |
| 3 | شريط تمرير دائري ذكي مع نقطة بداية ثابتة + نقطة تقسيم متحركة | غير موجود — الحقول 4 منفصلة (start/end لكل فترة) | يجب إعادة بناء واجهة الإعدادات كاملة |
| 4 | حفظ حدود كل يوم في جدول `الفترات` | يوجد فقط `shifts_closures` (سجل إقفال، ليس تعريف) | يحتاج جدول جديد أو إعادة تصميم |
| 5 | التقارير تعتمد على حدود اليوم المحفوظة | تعتمد على إعدادات نظام عامة متغيّرة | يلزم تحويل كل استعلامات التقارير |
| 6.أ | الإقفال التلقائي عند انتهاء وقت الفترة | غير موجود إطلاقاً | يلزم بناء آلية lazy-close أو scheduler |
| 6.ب | الإقفال اليدوي يتحقق من الفواتير المعلّقة | يتحقق من وجود التذاكر فقط، لا الفواتير | يلزم تشديد الفحص |
| 7 | شاشة اليومية + المعلومية اليومية متكاملتان مع فلتر بالفترة | منفصلتان منطقياً، فلتر الفترة جزئي في daily_journal | يلزم توحيد مصدر البيانات وإضافة فلتر |
| 8 | تعديل حقل `status` في `shifts_closures` ليصبح Select (مفتوحة/مغلقة) | حقل نصي حر في الواجهة | يلزم تحسين getTableMeta أو إضافة override |
| 9.1 | الإقفال التلقائي يسدّد المعلّقات كـ A | غير موجود | جزء من 6.أ |
| 9.2 | الإقفال اليدوي يمنع وجود فواتير معلّقة | غير موجود | جزء من 6.ب |
| 9.3 | فواتير جديدة بعد الإقفال اليدوي قبل بدء الفترة التالية | السلوك غير محدد | جزء من 9.4 |
| 9.4 | إعادة فتح آخر فترة بشرط عدم بدء الفترة التالية | الشرط الزمني غير مطبق | يلزم إضافة فحص زمني |
| ⚙️ | قرار: ربط الفترة بالفاتورة مباشرة أم بالزيارة؟ | الربط حالياً جزئي (فقط للسند A الإجمالي) | قرار هندسي مطلوب — انظر §11 |

---

## 3. القرار الهندسي الحاسم: ربط الفترة بالزيارة (Visit) لا بالفاتورة

**التوصية:** ربط الفترة المالية بـ `visits.shift_id` (ثم ترث الفواتير، المختبر، الخدمات نفس الفترة).

### المبرّرات

1. **التماسك المنطقي:** زيارة واحدة قد تُولّد عدة فواتير (B+C+لاحقاً سند تسوية). إن ربطنا الفترة بكل فاتورة قد نجد فواتير من نفس الزيارة في فترتين مختلفتين عندما يتأخر الإصدار — وهذا منطقياً مستحيل لزيارة واحدة.
2. **التقارير الإحصائية:** عدد المترددين، عدد الفحوصات، الخدمات المنفّذة — كلها تُحسب من الزيارة لا من الفاتورة. ربط الزيارة بالفترة يجعل GROUP BY ثابتاً.
3. **حالة 9.3:** عندما يُنشئ الطبيب طلب خدمة بعد الإقفال اليدوي وقبل بدء الفترة التالية — لو ربطنا بالفاتورة لاحتاج كل سند فحص منفصل لتسوية. لو ربطنا بالزيارة، تكفي تسوية واحدة على مستوى الزيارة.
4. **سهولة الترقية:** `visits` يحتوي `visit_date` يمكن استخدامه لتحديد الفترة بأثر رجعي إذا لزم الأمر.

### القاعدة

> **زيارة واحدة = فترة واحدة بالضبط.** الفترة تُسجَّل لحظة إنشاء الزيارة وتبقى ثابتة. كل العناصر التابعة (فواتير، فحوصات، نتائج، خدمات) ترث نفس `shift_id` تلقائياً عبر JOIN على `visits`.

### الاستثناء الوحيد

`invoices.shift_closure_id` يبقى موجوداً **فقط للسند الإجمالي A الناتج عن الإقفال** (سند بلا `visit_id`). هذا السلوك الحالي صحيح ولا يتغيّر.

---

## 4. التصميم الجديد للبيانات (Database Design)

### 4.1 جدول جديد: `shifts` (تعريف الفترات اليومية)

```sql
CREATE TABLE shifts (
    shift_id          SERIAL PRIMARY KEY,
    shift_date        DATE NOT NULL,                         -- يوم الفترة
    shift_type        VARCHAR(10) NOT NULL                   -- صباحي / مسائي
                      CHECK (shift_type IN ('morning','evening')),

    -- حدود الفترة (TIME) — مأخوذة من إعدادات اليوم
    start_time        TIME NOT NULL,                         -- بداية الفترة
    end_time          TIME NOT NULL,                         -- نهاية الفترة (نهاية حصرية)

    -- وضع التقسيم لذلك اليوم
    day_mode          VARCHAR(20) NOT NULL DEFAULT 'both'
                      CHECK (day_mode IN ('both','morning_only','evening_only')),

    -- حالة الفترة
    status            VARCHAR(10) NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','closed')),

    -- ربط بعملية الإقفال (إن وُجدت)
    closure_id        INTEGER REFERENCES shifts_closures(id)
                      ON UPDATE CASCADE ON DELETE SET NULL,

    -- تواريخ التقنية
    auto_closed       BOOLEAN NOT NULL DEFAULT FALSE,        -- TRUE إذا أُقفلت تلقائياً
    closed_at         TIMESTAMPTZ,
    closed_by         INTEGER REFERENCES users(user_id),

    created_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- لا تكرار لنفس النوع في نفس اليوم
    CONSTRAINT uq_shifts_date_type UNIQUE (shift_date, shift_type)
);

CREATE INDEX idx_shifts_date     ON shifts(shift_date DESC);
CREATE INDEX idx_shifts_status   ON shifts(status);
CREATE INDEX idx_shifts_closure  ON shifts(closure_id) WHERE closure_id IS NOT NULL;
```

> **لماذا جدول جديد منفصل؟** لأن `shifts_closures` هو "سجل عملية الإقفال" (event log)، بينما `shifts` هو "تعريف الفترة" (master). الجداران مختلفان دلالياً وعلاقتهما 1:0..1.

### 4.2 إضافة عمود ربط الفترة بالزيارة

```sql
ALTER TABLE visits
    ADD COLUMN shift_id INTEGER REFERENCES shifts(shift_id)
        ON UPDATE CASCADE ON DELETE SET NULL;

CREATE INDEX idx_visits_shift_id ON visits(shift_id) WHERE shift_id IS NOT NULL;
```

> الفواتير، نتائج المختبر، والخدمات تصل للفترة عبر JOIN على الزيارة — لا حاجة لأعمدة جديدة فيها.

### 4.3 جدول `system_settings` — تنظيف الإعدادات القديمة

الاحتفاظ بـ `shift_morning_start` و `shift_evening_start` فقط (للقيم الافتراضية عند إنشاء يوم جديد بدون سجل صريح في `shifts`):

```sql
-- إزالة الإعدادات التي لم تعد ضرورية
DELETE FROM system_settings WHERE setting_key IN (
    'shift_morning_end',                -- يُستنتج من evening_start
    'shift_evening_end',                -- دائماً 24:00 (نهاية اليوم)
    'shift_overnight_belongs_to'        -- لم تعد هناك فجوة ليلية
);

-- تحديث المتبقّي
UPDATE system_settings SET setting_value = '00:00' WHERE setting_key = 'shift_morning_start';
UPDATE system_settings SET setting_value = '12:00' WHERE setting_key = 'shift_evening_start';

-- إضافة إعداد جديد: حدّ التقسيم الافتراضي (نقطة التقسيم على الشريط الدائري)
INSERT INTO system_settings (setting_key, setting_value, setting_group, description) VALUES
    ('shift_default_split_time', '12:00', 'shifts',
     'نقطة التقسيم الافتراضية بين الفترة الصباحية والمسائية (HH:MM 24h) — تُستخدم لإنشاء يوم جديد إذا لم يكن مُعرَّفاً في جدول shifts'),
    ('shift_default_day_mode', 'both', 'shifts',
     'وضع التقسيم الافتراضي للأيام: both | morning_only | evening_only')
ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value;
```

### 4.4 Migration 016 — اقتراح الترتيب الفعلي

```
database/migrations/016_shifts_master_table_and_visit_link.sql
```

محتوياتها بالترتيب:
1. إنشاء `shifts`.
2. إضافة `visits.shift_id`.
3. تنظيف `system_settings` (الإعدادات الجديدة).
4. **Backfill (ترحيل البيانات التاريخية):** إنشاء سجلات `shifts` من `shifts_closures` الموجودة + ربط الزيارات التاريخية:

```sql
-- 4.1 إنشاء سجلات shifts من shifts_closures التاريخية
INSERT INTO shifts (shift_date, shift_type, start_time, end_time, day_mode,
                    status, closure_id, closed_at, closed_by, auto_closed)
SELECT sc.shift_date,
       sc.shift_type,
       CASE sc.shift_type WHEN 'morning' THEN '00:00'::time ELSE '12:00'::time END,
       CASE sc.shift_type WHEN 'morning' THEN '12:00'::time ELSE '24:00'::time END,
       'both',
       'closed',
       sc.id,
       sc.closed_at,
       sc.closed_by,
       FALSE
FROM shifts_closures sc
ON CONFLICT (shift_date, shift_type) DO NOTHING;

-- 4.2 ربط الزيارات التاريخية بفتراتها (استنتاج من visit_date)
UPDATE visits v
SET shift_id = s.shift_id
FROM shifts s
WHERE v.shift_id IS NULL
  AND s.shift_date = DATE(v.visit_date)
  AND EXTRACT(HOUR FROM v.visit_date) * 60 + EXTRACT(MINUTE FROM v.visit_date)
        BETWEEN EXTRACT(HOUR FROM s.start_time) * 60 + EXTRACT(MINUTE FROM s.start_time)
            AND EXTRACT(HOUR FROM s.end_time)   * 60 + EXTRACT(MINUTE FROM s.end_time) - 1;
```

---

## 5. منطق طبقة التطبيق (PHP)

### 5.1 خدمة جديدة: `ShiftService` (تحلّ محل جزء من `SettingsService`)

ملف جديد: `src/Utils/ShiftService.php`

المسؤوليات:
- `resolveOrCreateShift(DateTimeInterface $when): array` → تُرجع `shift_id` المطابق للوقت، وتُنشئ السجل تلقائياً من الإعدادات الافتراضية إن لم يكن موجوداً.
- `getShiftBoundariesForDate(string $date): array` → تُرجع حدود اليوم من `shifts` (لا من `system_settings`).
- `getCurrentShift(): ?array` → الفترة المفتوحة الحالية.
- `isShiftActive(int $shiftId): bool` → هل ما زالت ضمن نافذتها الزمنية؟
- `getNextShiftStartTime(int $shiftId): DateTimeImmutable` → متى تبدأ الفترة التالية (لمنع إعادة الفتح بعد بدئها).

### 5.2 تعديلات على `AccountingModel`

#### أ. `closeShift()` — الإقفال اليدوي (المتطلب §6.ب + §9.2)

```php
public function closeShift(string $shiftType, int $closedBy, ?string $date = null): array
{
    // الخطوة الجديدة (1): التحقق من عدم وجود فواتير معلّقة في هذه الفترة
    $pendingCount = $this->countPendingInvoicesInShift($shiftType, $shiftDate);
    if ($pendingCount > 0) {
        throw new RuntimeException(
            "يوجد {$pendingCount} فاتورة معلّقة في هذه الفترة. يجب تسويتها قبل الإقفال اليدوي."
        );
    }

    // ... باقي المنطق الحالي (سند A إجمالي للتذاكر) ...

    // الخطوة الجديدة (2): تحديث shifts.status = 'closed'
    $this->markShiftClosed($shiftType, $shiftDate, $closedBy, $autoClosed = false);
}
```

#### ب. دالة جديدة: `autoCloseShift()` — الإقفال التلقائي (المتطلب §6.أ + §9.1)

```php
public function autoCloseShift(int $shiftId): array
{
    // 1. جلب الفترة + التحقق أنها مفتوحة + انتهى وقتها
    // 2. تسديد جميع الفواتير المعلّقة في الفترة كسند A "دفع كامل":
    //    - لكل فاتورة معلّقة: ضبط accountant_id = SYSTEM_USER_ID و paid_at = NOW()
    //    - تصنيف Document_Type A
    // 3. توليد سند A إجمالي للتذاكر (نفس منطق closeShift الحالي)
    // 4. تحديث shifts.status='closed', auto_closed=TRUE
    // 5. تسجيل في audit_logs بـ action='AUTO_CLOSE'
}
```

#### ج. دالة جديدة: `runAutoClosurePass()` — الباحث الدوري

```php
/**
 * يُستدعى من cron أو من middleware (lazy):
 *   - يبحث عن جميع الفترات التي:
 *       status='open' AND (shift_date + end_time) < NOW()
 *   - يستدعي autoCloseShift لكل واحدة.
 */
public function runAutoClosurePass(): array;
```

### 5.3 آلية تنفيذ الإقفال التلقائي

**خياران (يُقترح تطبيق الاثنين معاً):**

| الخيار | الوصف | مزايا | عيوب |
|--------|------|-------|------|
| **A. Lazy (Hook)** | استدعاء `runAutoClosurePass()` في بداية كل طلب `accounting/*` أو `doctor/send_orders` | لا يحتاج بنية تحتية إضافية، يعمل على Render | تأخير صغير عند أول طلب بعد انتهاء الفترة |
| **B. Cron Job** | جدولة وظيفة كل 5 دقائق (Render Cron Job أو endpoint محمي يستدعيه ping خارجي) | إقفال فوري حتى بدون نشاط مستخدمين | يحتاج إعداد إضافي |

**التوصية:** البدء بـ Lazy + إضافة Cron لاحقاً.

### 5.4 إعادة فتح الفترة (المتطلب §9.4)

تحديث `AdminModel::reopenLatestShift()` ليُضيف فحصاً زمنياً:

```php
// الفحص الجديد: لا يُسمح بإعادة الفتح إذا بدأت الفترة التالية
$nextShiftStart = $this->shiftService->getNextShiftStartTime($shiftId);
if (new DateTimeImmutable() >= $nextShiftStart) {
    throw new RuntimeException(
        'لا يمكن إعادة فتح هذه الفترة لأن الفترة التالية قد بدأت بالفعل.'
    );
}
```

### 5.5 ربط الزيارة بالفترة عند الإنشاء

في `DoctorController::newPatient()` و `existingPatientVisit()`:

```php
// عند INSERT INTO visits، أضف:
$shift = $this->shiftService->resolveOrCreateShift(new DateTimeImmutable());
// ثم: shift_id = $shift['shift_id']
```

### 5.6 تعديل التقارير لاستخدام جدول `shifts`

كل استعلامات `GROUP BY shift` الحالية في:
- `AccountingModel::getDailyJournal`
- `ReportsModel` (أي دالة فيها CASE WHEN على الساعات)
- `daily_info.js` API endpoint (`reports/daily_info`)

يجب أن تتحوّل من:
```sql
-- القديم: يعتمد على الإعدادات الحالية
CASE WHEN EXTRACT(HOUR FROM i.created_at) < 12 THEN 'morning' ELSE 'evening' END
```
إلى:
```sql
-- الجديد: يعتمد على حدود اليوم المحفوظة
JOIN visits v ON v.visit_id = i.visit_id
JOIN shifts s ON s.shift_id = v.shift_id
... GROUP BY s.shift_type
```

---

## 6. الواجهة الأمامية — الشريط الدائري الذكي (المتطلب §3)

### 6.1 المكان

ضمن `public/assets/js/modules/admin.js`، تبويب الإعدادات → مجموعة "الفترات والإقفال" — يستبدل الحقول الأربعة الحالية (start/end لكل فترة) بمكوّن واحد.

### 6.2 المواصفات التقنية

- **SVG دائرة كاملة 360°** = 24 ساعة (كل 15° = ساعة).
- **نقطة ثابتة** عند 12:00 ص (الأعلى — زاوية 0°/360°).
- **نقطة متحركة** قابلة للسحب على المحيط.
- **قوسان ملوّنان**:
  - أصفر فاتح: الفترة الصباحية (من 12:00 ص إلى نقطة التقسيم).
  - أزرق فاتح: الفترة المسائية (من نقطة التقسيم إلى 12:00 ص).
- **عرض الوقت** المرتبط بالنقطة المتحركة (HH:MM).
- **حالات خاصة**:
  - نقطة عند الأعلى (مع اتجاه عقارب الساعة → الزاوية = 0° لكن بعد دورة) = يوم كامل صباحي → `day_mode = 'morning_only'`.
  - نقطة عند الأعلى (عكس عقارب الساعة) = يوم كامل مسائي → `day_mode = 'evening_only'`.
  - أي موضع آخر = `day_mode = 'both'`.

### 6.3 الحفظ

عند الحفظ يُرسل JSON إلى endpoint جديد:

```
POST /api/admin/shifts/save_boundaries
Body: {
    shift_date: "2026-06-05",     // اليوم المعدّل (افتراضياً اليوم الحالي)
    split_time: "13:30",          // نقطة التقسيم
    day_mode: "both"              // أو "morning_only" أو "evening_only"
}
```

هذا الـ endpoint:
1. يحسب `start_time`/`end_time` للفترتين بناءً على `split_time` و `day_mode`.
2. يُدخل/يُحدّث سجلين في جدول `shifts` (أو سجل واحد في وضعَي الأحادي).
3. **لا يلمس** البيانات التاريخية ولا الفترات المُقفلة.

### 6.4 ملاحظة UX

- اللوحة تعرض **اليوم الحالي افتراضياً** ولكن تسمح باختيار تاريخ (للأيام المستقبلية أو الماضي **غير المُقفل**).
- لا يُسمح بتعديل حدود يوم تحوي فيه فترة `status='closed'`.

---

## 7. شاشة اليومية والمعلومية اليومية (المتطلب §7)

### 7.1 توحيد مصدر البيانات

- استخراج منطق التجميع المشترك إلى endpoint واحد:
  `GET /api/reports/daily_view?date=YYYY-MM-DD&shift_type=morning|evening|all`
- شاشة اليومية تستهلك التفاصيل (الصفوف).
- شاشة المعلومية اليومية تستهلك الإجماليات (المجاميع).
- الاثنان يحتجّان على نفس مصدر — يضمن التطابق.

### 7.2 فلتر الفترة في شاشة اليومية

في `daily_journal.js`:
- إضافة Dropdown أعلى الجدول: `[ كل الفترات | الصباحية | المسائية ]`.
- يتفاعل مع filterParam = `shift_type` في API.
- البيانات تُجلب من `shifts` (حسب الحدود المحفوظة لليوم المعروض).

### 7.3 زر الإقفال اليدوي

- يبقى في شاشة اليومية كما هو، لكن:
  - عند الضغط، يُجرى Pre-flight check يستدعي `/api/accounting/previous_shift_check` لاكتشاف الفواتير المعلّقة.
  - إذا وُجدت، يُعرَض Modal يَسرد الفواتير المعلّقة ويمنع الإقفال.

---

## 8. مركز الجداول — تعديل حقل `status` ليصبح Select (المتطلب §8)

### 8.1 المسار

`AdminModel::getTableMeta()` → يجب أن يكتشف الـ CHECK constraints على الأعمدة النصية ويحوّلها إلى enum_values.

### 8.2 التنفيذ المقترح

استعلام جديد في `getTableMeta` يقرأ `pg_constraint` و `information_schema.check_constraints` لاستنتاج القيم المسموحة:

```php
private function getCheckConstraintEnumValues(string $table, string $column): array
{
    $sql = "
        SELECT cc.check_clause
        FROM information_schema.check_constraints cc
        JOIN information_schema.constraint_column_usage ccu
            ON cc.constraint_name = ccu.constraint_name
        WHERE ccu.table_name = :table AND ccu.column_name = :column
    ";
    // استخراج القيم من نص check_clause بـ regex مثل: ((status)::text = ANY (ARRAY['open'::character varying, 'closed'::character varying]))
    // إرجاع ['open', 'closed']
}
```

ثم في `getTableMeta`، إذا كان العمود نصياً ووجدت قيم من check constraint:
```php
$columns[$name]['enum_values'] = $checkEnumValues;
$columns[$name]['control_hint'] = 'select';
```

### 8.3 طبقة العرض (frontend)

`admin.js` يفحص حالياً `column.enum_values.length > 0` لرسم Select — لا حاجة لتغيير الواجهة بعد إصلاح Backend.

### 8.4 تعريب القيم في الواجهة

إضافة Map في `admin.js`:
```js
const ENUM_LABELS = {
    'shifts.status':         { open: 'مفتوحة', closed: 'مغلقة', locked: 'مغلقة' },
    'shifts_closures.status':{ open: 'مفتوحة', locked: 'مغلقة' },
    // ... باقي الأعمدة
};
```

---

## 9. سجل التدقيق (Audit Log) — توسيع الإجراءات

إضافة action جديدة `AUTO_CLOSE` في `audit_logs.action` CHECK constraint:

```sql
ALTER TABLE audit_logs DROP CONSTRAINT audit_logs_action_check;
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_action_check
CHECK (action::text = ANY (ARRAY[
    'CREATE','UPDATE','DELETE','LOGIN','LOGOUT','CANCEL',
    'EXPORT','IMPORT','VIEW','REOPEN',
    'AUTO_CLOSE',         -- 🆕 الإقفال التلقائي
    'OTHER'
]::text[]));
```

كل عملية إقفال (يدوي/تلقائي) أو إعادة فتح تُسجَّل تلقائياً.

---

## 10. ترتيب التنفيذ (Roadmap)

> الترتيب صارم — كل مرحلة تعتمد على ما قبلها.

### 🟢 المرحلة 1 — البنية التحتية (Migrations)
1. كتابة `016_shifts_master_table_and_visit_link.sql` (§4.4).
2. اختبار Backfill على نسخة من DB.
3. تطبيق على Render.

### 🟢 المرحلة 2 — طبقة الخدمات (Services)
4. إنشاء `src/Utils/ShiftService.php` (§5.1).
5. تعديل `SettingsService` لإزالة `getShiftBoundaries()` (تستبدل بـ `ShiftService::getShiftBoundariesForDate`).

### 🟢 المرحلة 3 — تعديل المنطق المالي
6. تعديل `AccountingModel::closeShift()` للتحقق من المعلّقات (§5.2.أ).
7. إضافة `AccountingModel::autoCloseShift()` + `runAutoClosurePass()` (§5.2.ب-ج).
8. تشغيل Lazy Hook في `public/api/index.php` (§5.3).
9. تعديل `AdminModel::reopenLatestShift()` لإضافة الفحص الزمني (§5.4).

### 🟢 المرحلة 4 — ربط الزيارات
10. تعديل `DoctorController::newPatient` + `existingPatientVisit` (§5.5).
11. تعديل جميع التقارير لاستخدام `visits.shift_id` (§5.6).

### 🟢 المرحلة 5 — الواجهة الأمامية (Admin)
12. بناء مكوّن الشريط الدائري في `admin.js` (§6).
13. تعديل `AdminModel::getTableMeta` لدعم CHECK enums (§8).
14. إضافة تعريب القيم في `admin.js` (§8.4).

### 🟢 المرحلة 6 — شاشة اليومية والمعلومية اليومية
15. توحيد مصدر البيانات في endpoint واحد (§7.1).
16. إضافة فلتر الفترة في `daily_journal.js` (§7.2).
17. تعديل `daily_info.js` لاستهلاك نفس المصدر (§7.1).

### 🟢 المرحلة 7 — Audit Log
18. تطبيق ترقية `audit_logs.action` (§9).

### 🟢 المرحلة 8 — اختبارات وتوثيق
19. اختبار سيناريوهات: إقفال يدوي مع/بدون معلّقات، إقفال تلقائي، إعادة فتح قبل/بعد بدء الفترة التالية، يوم كامل صباحي، يوم كامل مسائي.
20. تحديث `README.md` وإضافة `docs/changelogs/CHANGES_SHIFTS_REFACTOR.md`.

---

## 11. سيناريوهات حرجة (Edge Cases)

| السيناريو | السلوك المتوقع |
|-----------|----------------|
| طبيب يُنشئ زيارة بعد إقفال يدوي وقبل بدء الفترة التالية | تُنشَأ الزيارة بـ `shift_id` المُقفل (الفترة السابقة). يلزم Toast: "تم تسجيل الزيارة في الفترة السابقة المُقفلة." |
| إعادة فتح آخر فترة بعد بدء الفترة التالية | يُرفض الطلب برسالة: "بدأت الفترة التالية — لا يمكن إعادة الفتح." يجب أيضاً عند بدء الفترة التالية تلقائياً، تسديد سندات الفترة السابقة كما في §5.2.ب. |
| تغيير حدود يوم بعد أن أُقفلت إحدى فتراته | يُرفض التعديل: "لا يمكن تعديل حدود يوم تحوي فيه فترة مغلقة." |
| يوم لم يُعرَّف في `shifts` (لا توجد إعدادات صريحة) | `ShiftService::resolveOrCreateShift` يُنشئ سجلَين تلقائياً من الإعدادات الافتراضية (`shift_default_split_time`). |
| `day_mode='morning_only'` لكن وقت الإنشاء في "ما بعد الظهر" | الفترة موجودة (00:00 → 24:00 morning) — الزيارة تُربط بها بشكل صحيح. |
| تذكرة قديمة محذوف منها `shift_closure_id` بسبب reopen | تظهر مجدداً كقابلة للإقفال. هذا السلوك الحالي صحيح ويبقى. |

---

## 12. ملخّص التغييرات على الملفات

| الملف | نوع التغيير |
|-------|-------------|
| `database/migrations/016_shifts_master_table_and_visit_link.sql` | 🆕 جديد |
| `database/migrations/017_audit_log_auto_close_action.sql` | 🆕 جديد |
| `src/Utils/ShiftService.php` | 🆕 جديد |
| `src/Utils/SettingsService.php` | ✏️ تنظيف الدوال المنقولة لـ ShiftService |
| `src/Models/AccountingModel.php` | ✏️ closeShift + autoCloseShift + runAutoClosurePass + استعلامات التقارير |
| `src/Models/AdminModel.php` | ✏️ reopenLatestShift + getTableMeta (CHECK enums) |
| `src/Models/DoctorModel.php` | ✏️ ربط الزيارة بـ shift_id |
| `src/Models/ReportsModel.php` | ✏️ كل GROUP BY على الفترة |
| `src/Controllers/AdminController.php` | ✏️ + endpoint `/admin/shifts/save_boundaries` |
| `src/Controllers/AccountingController.php` | ✏️ pre-flight check قبل closeShift |
| `src/Controllers/DoctorController.php` | ✏️ تمرير shift_id عند إنشاء الزيارة |
| `public/api/index.php` | ✏️ + lazy hook + المسارات الجديدة |
| `public/assets/js/modules/admin.js` | ✏️ مكوّن الشريط الدائري + Select للحالة |
| `public/assets/js/modules/daily_journal.js` | ✏️ فلتر الفترة + Pre-flight |
| `public/assets/js/modules/daily_info.js` | ✏️ توحيد المصدر |
| `docs/changelogs/CHANGES_SHIFTS_REFACTOR.md` | 🆕 جديد |
| `README.md` | ✏️ قسم جديد عن نظام الفترات الجديد |

---

## 13. نقاط تحتاج تأكيداً من صاحب المشروع قبل البدء

1. **القرار الهندسي (§3):** هل توافق على ربط الفترة بـ `visits` (الموصى به)؟ إجابتي هي نعم.
3. **آلية الإقفال التلقائي (§5.3):** Lazy Hook فقط، أم Lazy + Cron؟ إجابتي هي Lazy Ho9k.
4. **شكل الشريط الدائري (§6):** هل يكفي SVG مخصّص، أم تفضّل مكتبة جاهزة (مثل [RoundSlider](https://github.com/soundar24/roundSlider))؟إجابتي هي RoundSlider.
5. **مستخدم النظام للإقفال التلقائي:** أي `user_id` يُسجَّل في `closed_by` عند autoClose؟ يُقترح إنشاء مستخدم خاص `system` (user_id=0 أو -1). نعم إنشئ مستخدم خاص.
6. **هل تريد دعم حدود مختلفة للفترات لكل يوم في الإعداد المُسبق المتقدّم؟** أم نكتفي بحفظ يوم واحد (اليوم الحالي) ونعتبر باقي الأيام تأخذ الافتراضي؟ (المتطلب §4 يقول "حدود قد تختلف من يوم لآخر" — الجدول الجديد يدعم ذلك تلقائياً.).من الافضل تسجيل الإعدادت عند تعديلاها فقط ينشئ سجل جديد مع توثيق التاريخ و ومنها نستطع إنشاء الاستعلامات التقارير بناء على التواريخ ، يعتمد بإنشاء دوال ذكية تحسب فروق التاريخ و > و < وهكذا الخ ..

---

> 📝 **هذه الخطة جاهزة للمراجعة. بعد موافقتك على النقاط أعلاه، يمكن البدء بتنفيذ المرحلة 1 (Migrations) ورفعها على `main` مباشرةً.**
