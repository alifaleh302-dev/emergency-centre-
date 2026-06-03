# تعديلات: فصل السندات حسب القسم + إقفال فترات التذاكر

> 🗓️ تاريخ التغيير: 2026-06-03
> 🔖 الإصدار: feature/invoice-split-and-shift-closure
> 🏷️ Migrations: **011** (department_id) + **012** (shifts_closures)

---

## 🎯 ملخص تنفيذي

نُفّذت ثلاث متطلبات أساسية من وثيقة المتطلبات:

1. **فصل السندات حسب القسم** — عند إرسال الطبيب لطلبات من أقسام متعددة، يُنشئ النظام الآن **سنداً مالياً منفصلاً لكل قسم** بدلاً من سند واحد مُجمَّع.
2. **واجهة "اليومية"** — شاشة جديدة لأمين الصندوق تعرض جميع سندات اليوم مرتبة (سندات A أولاً ثم فاصل بصري ثم B/C)، مع زر "تفاصيل" يفتح Modal بخدمات السند.
3. **إقفال الفترة (Shift Closing)** — جدول `shifts_closures` جديد، صف مدمج في "اليومية" يعرض إجماليات تذاكر الفترة (صباحي/مسائي) مع زر "إقفال". عند الإقفال يُولَّد سند A إجمالي ويُمنع إصدار تذاكر جديدة لفترة سابقة غير مُقفلة.

---

## 🗄️ تعديلات قاعدة البيانات

### Migration 011 — `database/migrations/011_invoice_per_department.sql`

```sql
ALTER TABLE invoices ADD COLUMN department_id INTEGER
    REFERENCES departments(department_id);
CREATE INDEX idx_invoices_department_id ON invoices(department_id) WHERE department_id IS NOT NULL;
```

- العمود **Nullable** للتوافق مع البيانات القديمة.
- ترحيل ذكي: السندات التاريخية التي تحتوي خدمات من قسم واحد يتم تعيين `department_id` لها تلقائياً.

### Migration 012 — `database/migrations/012_shifts_closures.sql`

```sql
CREATE TABLE shifts_closures (
    id SERIAL PRIMARY KEY,
    shift_type VARCHAR(10),         -- 'morning' / 'evening'
    shift_date DATE,
    start_ticket_no INTEGER,
    end_ticket_no INTEGER,
    tickets_count INTEGER,
    center_share NUMERIC(12,2),
    ministry_share NUMERIC(12,2),
    total_amount NUMERIC(12,2),
    closing_invoice_id INTEGER REFERENCES invoices(invoice_id),
    closed_by INTEGER REFERENCES users(user_id),
    closed_at TIMESTAMPTZ,
    status VARCHAR(10) DEFAULT 'locked',
    UNIQUE (shift_type, shift_date)
);

ALTER TABLE examination_tickets ADD COLUMN shift_closure_id INTEGER
    REFERENCES shifts_closures(id);
ALTER TABLE invoices ADD COLUMN shift_closure_id INTEGER
    REFERENCES shifts_closures(id);
```

---

## 🔧 تعديلات الكود

### Backend

| الملف | التغيير |
|---|---|
| `src/Models/DoctorModel.php` | إضافة `createPendingInvoiceForDepartment()` + `getServicesGroupedByDepartment()` |
| `src/Controllers/DoctorController.php` | إعادة كتابة `sendOrders()` لتجمّع الخدمات حسب القسم وتُنشئ سنداً منفصلاً لكل قسم داخل نفس الـ Transaction |
| `src/Models/AccountingModel.php` | إضافة `getDailyJournal()`, `getInvoiceServiceDetails()`, `getShiftTicketsSummary()`, `hasOpenShiftBefore()`, `getTicketShareSettings()`, `closeShift()`, `getShiftClosuresForDate()` |
| `src/Controllers/AccountingController.php` | إضافة 3 endpoints: `getDailyJournal()`, `getInvoiceServices()`, `closeShift()` |
| `src/Models/ExaminationTicketModel.php` | إضافة `hasOpenShiftBefore()` + فحص داخل `autoIssue()` لمنع إصدار تذاكر قبل إقفال الفترة السابقة |
| `public/api/index.php` | تسجيل 3 مسارات جديدة: `accounting/daily_journal`, `accounting/invoice_services`, `accounting/close_shift` |

### Frontend

| الملف | الوصف |
|---|---|
| `public/assets/js/modules/daily_journal.js` | **جديد** — واجهة اليومية الكاملة مع Modal للتفاصيل + زر الإقفال |

---

## 🔄 آلية العمل الجديدة

### عند إرسال طلبات الطبيب

```
[الطبيب يضغط "إرسال الطلبات"]
   ↓
allOrderIds = [s1, s2, s3, s4]
   ↓
getServicesGroupedByDepartment(ids) → [
    {service_id: 1, dept_id: 1 (المختبر), ...},
    {service_id: 2, dept_id: 1 (المختبر), ...},
    {service_id: 3, dept_id: 2 (الأشعة), ...},
    {service_id: 4, dept_id: 3 (التمريض), ...}
]
   ↓
$grouped = [1 => [s1, s2], 2 => [s3], 3 => [s4]]
   ↓
BEGIN TRANSACTION
   ├─ createPendingInvoiceForDepartment(visit, 1) → invoice_id #100 (المختبر)
   │      ├─ addInvoiceDetail(100, s1)
   │      └─ addInvoiceDetail(100, s2)
   │
   ├─ createPendingInvoiceForDepartment(visit, 2) → invoice_id #101 (الأشعة)
   │      └─ addInvoiceDetail(101, s3)
   │
   └─ createPendingInvoiceForDepartment(visit, 3) → invoice_id #102 (التمريض)
          └─ addInvoiceDetail(102, s4)
COMMIT
   ↓
[3 سندات منفصلة جاهزة للتحصيل في صفحة "الفواتير المستحقة"]
```

### عند إقفال الفترة

```
[أمين الصندوق يضغط "إقفال الفترة الصباحية"]
   ↓
BEGIN TRANSACTION
   ├─ SELECT FOR UPDATE: كل التذاكر الصباحية اليوم بـ shift_closure_id IS NULL
   ├─ حساب: center_share, ministry_share, total_amount
   ├─ INSERT INTO shifts_closures (...) → closure_id #5
   ├─ INSERT INTO invoices (doc_type='A', total=...,shift_closure_id=5) → invoice_id #200
   ├─ UPDATE shifts_closures SET closing_invoice_id=200 WHERE id=5
   └─ UPDATE examination_tickets SET shift_closure_id=5 WHERE ticket_id IN (...)
COMMIT
   ↓
[سند A إجمالي رقم 200 + تذاكر مُقفلة. لا يمكن إصدار تذاكر صباحية تعود لأمس بعد الآن]
```

### قاعدة منع الإصدار (Validation)

داخل `ExaminationTicketModel::autoIssue()`:

```php
if ($this->hasOpenShiftBefore($ticketType)) {
    throw new RuntimeException(
        'يجب إقفال الفترة [نوع] السابقة قبل إصدار تذاكر جديدة.'
    );
}
```

> ✅ تذاكر اليوم الحالي مسموح إصدارها حتى بدون إقفال (لأن الإقفال يتم في **نهاية** الفترة).
> ❌ تذاكر فترة سابقة (يوم أمس أو أقدم) لم تُقفل بعد → يُرفض إصدار أي تذكرة جديدة من نفس النوع.

---

## 🛣️ المسارات الجديدة في API

| الطريقة | المسار | الوصف |
|---|---|---|
| `GET`  | `/api/accounting/daily_journal?date=YYYY-MM-DD&department_id=N` | بيانات اليومية الكاملة |
| `GET`  | `/api/accounting/invoice_services?invoice_id=N` | خدمات سند محدد (للـ Modal) |
| `POST` | `/api/accounting/close_shift` | إقفال فترة (body: `{shift_type, date?}`) |

---

## 🧪 خطوات التحقق بعد النشر

1. **اختبار فصل السندات**:
   ```
   - سجل دخول كطبيب → افتح زيارة → أرسل طلبات من المختبر + الأشعة معاً
   - دخول كأمين صندوق → "الفواتير المستحقة" يجب أن تظهر فاتورتين منفصلتين بدلاً من واحدة
   ```

2. **اختبار واجهة اليومية**:
   ```
   - فتح موديول "اليومية"
   - التحقق من ظهور سندات A أولاً ثم الفاصل البصري ثم B/C
   - النقر على "عرض" → يجب فتح Modal بخدمات السند
   ```

3. **اختبار إقفال الفترة**:
   ```
   - افتح زيارة جديدة → تُصدر تذكرة تلقائياً (مثلاً مسائية)
   - في "اليومية" يظهر صف ذهبي للفترة المسائية + زر "إقفال الفترة"
   - النقر يولّد سند A إجمالي، ويختفي صف الفترة، ويظهر صف أخضر للإقفال المنجز
   ```

4. **اختبار قاعدة المنع**:
   ```
   - افحص تذاكر فترة أمس غير المُقفلة (إن وجدت)
   - حاول إصدار تذكرة من نفس النوع اليوم → يجب أن تظهر رسالة:
     "يجب إقفال الفترة [الصباحية/المسائية] السابقة قبل إصدار تذاكر جديدة."
   ```

---

## ⚠️ ملاحظات هامة

- **التوافق مع الخلف**: العمود `department_id` في `invoices` **Nullable**؛ السندات القديمة قبل الـ migration لن تتأثر، وسيظهر في "اليومية" قسمها كـ "غير محدد" إذا لم يُربط تلقائياً.
- **سلوك الإقفال**: حسب قرار المستخدم، يُربط **التذاكر فقط** بـ `shift_closure_id`؛ سندات الأقسام التي تُسدد فردياً (مثل سند المختبر) لا تتأثر بالإقفال.
- **حصص الوزارة**: تُحسب من `system_settings`:
  - `ticket_ministry_share_morning` (الافتراضي: 30 ريال/تذكرة)
  - `ticket_ministry_share_evening` (الافتراضي: 100 ريال/تذكرة)
- **حصة المركز** = `total_amount - ministry_share`

---

## 🔐 الأمان والـ Concurrency

- جميع العمليات الحرجة (الإقفال + الإصدار) محمية بـ `SELECT ... FOR UPDATE` لمنع الـ race conditions.
- `UNIQUE (shift_type, shift_date)` في `shifts_closures` يمنع الإقفال المزدوج لنفس النوع في نفس اليوم.
- جميع المعاملات (Transactions) تستخدم `try/catch` مع `rollBack()` تلقائي عند الفشل.
