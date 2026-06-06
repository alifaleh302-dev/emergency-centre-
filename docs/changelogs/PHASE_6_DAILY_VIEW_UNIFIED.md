# 📋 المرحلة 6 — توحيد شاشة اليومية والمعلومية اليومية

> **المرجع:** `docs/SHIFTS_REFACTOR_PLAN.md` — §7 + §10 (المرحلة 6)
> **النطاق:** خطوات 15 / 16 / 17 فقط (المراحل 1-5 سبق تنفيذها، 7-8 لاحقاً)
> **الفرع:** `main`

---

## 1. الهدف

ضمان أن شاشتي **اليومية** (`daily_journal.js`) و**المعلومية اليومية** (`daily_info.js`) تستهلكان **نفس مصدر البيانات المُجمَّع**، فلا تتعارض الأرقام بين الواجهتين، وإتاحة فلترة الفترة (صباحي/مسائي/الكل) على شاشة اليومية.

## 2. ما الذي تغيّر بالضبط؟

### 2.1 Backend — إضافة Endpoint موحَّد

ملف: `src/Controllers/ReportsController.php`

- إضافة دالة جديدة `getDailyView()` تخدم المسار:
  ```
  GET /api/reports/daily_view?date=YYYY-MM-DD&shift_type=morning|evening|all&department_id=N
  ```
- الحمولة المُرجَعة (موحّدة):
  ```json
  {
    "report_date": "YYYY-MM-DD",
    "shift_filter": "morning|evening|all",
    "department_id": 0,
    "shift_boundaries": [ /* حدود الفترات من جدول shifts */ ],
    "journal":    { "invoices": [...], "shift_totals": [...], "closures": [...] },
    "daily_info": { "header": {}, "shift_settings": {},
                    "morning": {}, "evening": {},
                    "totals": {}, "ticket_serials": {}, "serial_ranges": {} }
  }
  ```
- شاشة اليومية تستهلك `journal` (الصفوف التفصيلية)؛ شاشة المعلومية اليومية تستهلك `daily_info` (الإجماليات).
- عند `shift_type=morning|evening`:
  - فلترة سندات اليومية بحسب فترة كل سند (مُستنتَجة من حدود اليوم في `shifts`).
  - تصفير قسم الفترة الأخرى في `daily_info` لتطابق الفلترة على المستوى الإجمالي.

### 2.2 تسجيل Route الجديد

ملف: `public/api/index.php`

```php
'reports/daily_view' => ['methods' => ['GET'],
    'handler' => fn () => (new ReportsController())->getDailyView()],
```

### 2.3 Frontend — شاشة اليومية

ملف: `public/assets/js/modules/daily_journal.js`

- إضافة **Dropdown فلتر الفترة** في الـ Toolbar:
  ```
  [ كل الفترات | الصباحية | المسائية ]
  ```
- إضافة `state.shiftType` (افتراضي `'all'`).
- استبدال استدعاء `accounting/daily_journal` بـ `reports/daily_view`.
- استخراج `journal` من الحمولة الموحّدة وعرضه بنفس الواجهة السابقة (المخرَج البصري لم يتغيّر).

### 2.4 Frontend — شاشة المعلومية اليومية

ملف: `public/assets/js/modules/daily_info.js`

- `loadReport()` يستهلك الآن `reports/daily_view?shift_type=all` كمحاولة أولى.
- استخراج كائن `daily_info` من الحمولة الموحّدة.
- **Fallback تلقائي** إلى المسار القديم `reports/daily_info` للتوافق الخلفي في حال نشر المستودع على بيئة لم تُحدَّث بعد.

## 3. ضمانات التطابق بين الشاشتين

- كلتا الشاشتين تستدعيان نفس Controller (`ReportsController::getDailyView`).
- نفس `ReportsModel::getInvoiceData()` و `AccountingModel::getDailyJournal()` يستخدمان جدول `shifts` كمصدر لحدود اليوم (لا `system_settings`)، تماشياً مع المرحلتين 1-2 سابقاً.
- فلتر الفترة على اليومية مُتسق مع تصفير قسم الفترة الأخرى في المعلومية اليومية.

## 4. التوافق العكسي

- المسار القديم `GET /api/reports/daily_info` لا يزال يعمل كما هو.
- المسار القديم `GET /api/accounting/daily_journal` لا يزال يعمل كما هو (لم يُحذف).
- لا حاجة لأي Migration جديدة لهذه المرحلة.

## 5. الفحص

```
php -l src/Controllers/ReportsController.php  → OK
php -l public/api/index.php                   → OK
node -c public/assets/js/modules/daily_journal.js → OK
node -c public/assets/js/modules/daily_info.js    → OK
```

## 6. ما الذي لم يُنفَّذ في هذه الجلسة

- المرحلة 7 (Audit Log: ترقية CHECK constraint بإضافة `AUTO_CLOSE`).
- المرحلة 8 (اختبارات + تحديث README).

ستُنفَّذ هاتان المرحلتان في جلسة لاحقة كما اتفقنا.
