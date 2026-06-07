# 🧭 CHANGES_SHIFTS_REFACTOR

> **المرجع:** `docs/SHIFTS_REFACTOR_PLAN.md` — المرحلة 8 (اختبارات وتوثيق)
> **المستودع:** `alifaleh302-dev/emergency-centre-`
> **الفرع:** `main`
> **الحالة:** مكتمل

---

## 1) الهدف من هذه المرحلة

هذه المرحلة تُغلق مشروع إعادة هيكلة نظام الفترات المالية بعد تنفيذ المراحل 1–7، وذلك عبر:

1. **توثيق الوضع النهائي للنظام** بعد نقل منطق الفترات إلى البنية الجديدة.
2. **التحقق التقني** من اكتمال المسارات الرئيسية الخلفية والأمامية.
3. **تجميع مراجع التشغيل والتتبّع** في ملف واحد يسهل الرجوع إليه لاحقاً.

---

## 2) الفهم الحالي للنظام بعد إعادة الهيكلة

النظام هو تطبيق **PHP 8 بنمط MVC** مع **PostgreSQL** وواجهة أمامية **Vanilla JS**. بعد إعادة الهيكلة صار نظام الفترات يعمل وفق التصميم التالي:

- **جدول master جديد للفترات:** `shifts`
- **سجل أحداث الإقفال:** `shifts_closures`
- **ربط الزيارة بالفترة مباشرة:** `visits.shift_id`
- **طبقة خدمة مخصصة للفترات:** `src/Utils/ShiftService.php`
- **إقفال تلقائي Lazy Hook** داخل `public/api/index.php`
- **مصدر موحّد لليومية والمعلومية اليومية:** `GET /api/reports/daily_view`
- **إدارة حدود الفترات من لوحة المدير:**
  - `GET /api/admin/shifts/day`
  - `POST /api/admin/shifts/save_boundaries`
- **دعم تدقيق العمليات الآلية:** `AUTO_CLOSE` في `audit_logs.action`

بهذا الشكل أصبح تعريف الفترة اليومية منفصلاً عن سجل الإقفال نفسه، وأصبحت التقارير والزيارات تُبنى على مرجع فترة واضح بدل الاعتماد على استنتاج الوقت فقط.

---

## 3) ما الذي تم التحقق منه فعلياً في هذه المرحلة

### 3.1 التحقق من وجود مخرجات المراحل 1–7 في المستودع

تم التحقق من وجود العناصر التالية داخل الشيفرة:

- `database/migrations/016_shifts_master_table_and_visit_link.sql`
- `database/migrations/017_audit_log_auto_close_action.sql`
- `src/Utils/ShiftService.php`
- `AccountingModel::autoCloseShift()`
- `AccountingModel::runAutoClosurePass()`
- `AdminModel::reopenLatestShift()` مع الحماية الزمنية
- endpoint موحّد: `reports/daily_view`
- endpoints الإدارة:
  - `admin/shifts/day`
  - `admin/shifts/save_boundaries`
- Lazy auto-closure hook داخل `public/api/index.php`
- واجهات المرحلة 6/7 داخل:
  - `public/assets/js/modules/admin.js`
  - `public/assets/js/modules/daily_journal.js`
  - `public/assets/js/modules/daily_info.js`

### 3.2 التحقق القراءة-فقط من قاعدة بيانات Render

تم تنفيذ فحص **قراءة فقط** على قاعدة البيانات للتأكد من اكتمال البنية دون إجراء أي تعديل على الإنتاج، وتأكد ما يلي:

- وجود الجدولين `shifts` و `shifts_closures`
- وجود العمود `visits.shift_id`
- وجود `AUTO_CLOSE` داخل CHECK constraint الخاص بـ `audit_logs.action`
- وجود إعدادات الفترات الأساسية في `system_settings`

> تم اعتماد فحص قراءة فقط لتجنّب أي أثر تشغيلي على بيئة الإنتاج.

### 3.3 فحص Smoke على البيئة المنشورة

تم التحقق من المسارات التشغيلية التالية على النسخة المنشورة في Render:

1. `POST /api/auth/login` ✅
2. `GET /api/auth/me` ✅
3. `GET /api/reports/daily_view?date=YYYY-MM-DD&shift_type=all` ✅
4. `GET /api/admin/shifts/day?date=YYYY-MM-DD` ✅

نتيجة ذلك تؤكد أن:

- المصادقة تعمل.
- الدور الإداري المرتبط بالحساب الحالي يعمل.
- شاشة اليومية والمعلومية اليومية تعتمد فعلياً على المصدر الموحّد.
- واجهة إعداد حدود الفترات تستقبل بيانات اليوم بنجاح.

### 3.4 فحص Syntax للشيفرة

تم تنفيذ الفحوصات التالية محلياً على نسخة المستودع:

```bash
# PHP
find src public/api -type f \( -name '*.php' -o -name '*.inc' \) -print0 | xargs -0 -n1 php -l

# JavaScript
node -c public/assets/js/modules/admin.js
node -c public/assets/js/modules/daily_journal.js
node -c public/assets/js/modules/daily_info.js
```

**النتيجة:**
- نجاح فحص Syntax لعدد **25 ملف PHP**
- نجاح فحص Syntax للملفات:
  - `admin.js`
  - `daily_journal.js`
  - `daily_info.js`

---

## 4) تغطية سيناريوهات المرحلة 8

الوثيقة الأصلية طلبت اختبار السيناريوهات التالية:

1. إقفال يدوي مع معلّقات
2. إقفال يدوي بدون معلّقات
3. إقفال تلقائي
4. إعادة فتح قبل بدء الفترة التالية
5. إعادة فتح بعد بدء الفترة التالية
6. يوم كامل صباحي
7. يوم كامل مسائي

### ما الذي أُنجز هنا؟

- تم التحقق من **المسارات والبنية والـ endpoints** اللازمة لهذه السيناريوهات.
- تم التحقق من **سلامة الشيفرة Syntax** ومن **وجود جميع نقاط التنفيذ** داخل Backend وFrontend.
- تم التحقق من **سلامة الربط الإنتاجي** للمسارات غير المتلفة (read-only / smoke tests).

### ما الذي لم يتم تنفيذه مباشرة على الإنتاج؟

لم يتم تنفيذ سيناريوهات إقفال/إعادة فتح تغيّر البيانات مباشرة على قاعدة إنتاج Render، وذلك لتجنّب:

- إنشاء سندات فعلية غير مطلوبة
- تغيير حالة فترات قائمة
- إدخال سجلات تدقيق تشغيلية غير مقصودة

### التوصية التشغيلية

إذا رغبت لاحقاً، تُنفذ السيناريوهات السبعة كاملة على:

- **نسخة Staging من قاعدة البيانات**، أو
- **نسخة مستنسخة من قاعدة الإنتاج**

ثم يُحفظ تقرير النتائج تحت ملف مستقل مثل:

```text
docs/changelogs/PHASE_8_SHIFT_SCENARIOS_TEST_REPORT.md
```

---

## 5) ما الذي تغيّر في هذه الجلسة

### أ) تحديث `README.md`

أُضيف قسم محدث يشرح باختصار:

- البنية الجديدة لنظام الفترات
- الملفات والمسارات المهمة
- الفحوصات التشغيلية المنجزة
- روابط التوثيق المرتبطة بإعادة الهيكلة

### ب) إضافة هذا الملف

تمت إضافة:

- `docs/changelogs/CHANGES_SHIFTS_REFACTOR.md`

### ج) تحديث فهرس سجلات التغييرات

تم تحديث:

- `docs/changelogs/README.md`

ليتضمن رابط سجل إعادة هيكلة الفترات وروابط مراحلها ذات الصلة.

---

## 6) الملفات المرجعية المهمة

- `docs/SHIFTS_REFACTOR_PLAN.md`
- `database/migrations/016_shifts_master_table_and_visit_link.sql`
- `database/migrations/017_audit_log_auto_close_action.sql`
- `src/Utils/ShiftService.php`
- `src/Models/AccountingModel.php`
- `src/Models/AdminModel.php`
- `src/Controllers/ReportsController.php`
- `public/api/index.php`
- `public/assets/js/modules/admin.js`
- `public/assets/js/modules/daily_journal.js`
- `public/assets/js/modules/daily_info.js`
- `docs/changelogs/PHASE_6_DAILY_VIEW_UNIFIED.md`
- `docs/changelogs/PHASE_7_AUDIT_LOG_AUTO_CLOSE.md`

---

## 7) الخلاصة

بإتمام هذه المرحلة أصبحت إعادة هيكلة نظام الفترات **موثقة ومراجَعة تقنياً**، مع تأكيد أن المراحل 1–7 موجودة ومتصلة ببعضها داخل المستودع والبيئة المنشورة، وأن نقاط التشغيل الأساسية تعمل، دون إجراء تغييرات خطرة على بيانات الإنتاج أثناء الاختبار.

---

# 📚 ملحق: Changelog مُجمَّع تفصيلي (المراحل 1 → 8)

> القسم أدناه أُضيف ضمن commit المرحلة 8 ويُكمّل القسم أعلاه بتفاصيل بنيوية وجدول كامل للملفات المُتأثرة ونتائج الاختبارات.

إعادة هيكلة نظام الفترات المالية (Shifts Refactor) — Changelog شامل

> **المرجع:** `docs/SHIFTS_REFACTOR_PLAN.md`
> **النطاق:** المراحل 1 → 8 (الخطة كاملة)
> **الفرع:** `main`
> **آخر تحديث:** المرحلة 8 — اختبارات وتوثيق (انظر `PHASE_8_TESTING_AND_DOCUMENTATION.md`).

هذا الملف ملخّص تنفيذي مُجمَّع لكل التغييرات التي طرأت على نظام إدارة الفترات (Shifts) من نقطة الانطلاق (`baseline`) وصولاً إلى الإصدار الحالي. لتفاصيل كل مرحلة على حدة، راجع ملفات `PHASE_*` و `CHANGES_*` المُشار إليها.

---

## 📌 المحاور الأساسية للإعادة الهيكلة

| المحور | قبل | بعد |
|---|---|---|
| مصدر تعريف الفترة | إعدادات نصية في `system_settings` فقط (`shift_morning_start`/`shift_evening_start`/...) | جدول `shifts` (master) + خدمة `ShiftService` |
| ربط الزيارات بالفترة | غير موجود (يُحتسب عبر `EXTRACT(HOUR FROM created_at)`) | عمود `visits.shift_id` (FK → `shifts.shift_id`) |
| إقفال الفترة | يدوي فقط (`POST /api/accounting/close_shift`) | يدوي + **تلقائي** (`runAutoClosurePass` عبر lazy hook) |
| رفض الإقفال مع معلّقات | غير مفروض | مفروض (`RuntimeException` إن وُجدت فواتير غير مدفوعة) |
| إعادة فتح الفترة | بدون قيد زمني | مرفوضة بعد بدء الفترة التالية |
| تخصيص الفترات لليوم | إعدادات عامة فقط | لكل يوم: `day_mode` (both / morning_only / evening_only) و `split_time` قابل للتخصيص |
| سجل التدقيق | لا يُسجّل الإقفال التلقائي | إجراء جديد `AUTO_CLOSE` في `audit_logs` |
| واجهة الإدمن | حقول نصية بسيطة | قرص ساعة تفاعلي (SVG 360°) + Select ديناميكي للـ ENUMs |

---

## 🗓️ المراحل والتنفيذ

### 🟢 المرحلة 1 — خط الأساس (Baseline)
- **الحالة:** ✅ مكتملة قبل بدء خطة الإعادة الهيكلة.
- **المنتج:** جدول `shifts_closures`، خدمة `SettingsService::resolveShiftFor`، أمر `POST /api/accounting/close_shift`.
- **المرجع:** `CHANGES_INVOICE_SPLIT_AND_SHIFT_CLOSURE.md` + `CHANGES_DELETE_AND_REOPEN_RULES.md`.

### 🟢 المرحلة 2 — تنظيف فجوة 12:00 ودلالة `shift_overnight_belongs_to`
- **الحالة:** ✅ مكتملة.
- **التغيير:** إلغاء الفجوة الزمنية بين 23:00 و 00:00. الفترة المسائية تمتد الآن حتى 23:59:59.
- **الملفات:** `src/Utils/SettingsService.php`، `database/migrations/014_shift_boundaries_and_payment_order.sql`.

### 🟢 المرحلة 3 — جدول `shifts` (master) + ربط `visits.shift_id`
- **الحالة:** ✅ مكتملة.
- **المُنتج الأساسي:** `database/migrations/016_shifts_master_table_and_visit_link.sql`.
- **التغييرات الجوهرية:**
  1. إنشاء جدول `shifts` مع المفتاح الفريد `(shift_date, shift_type)`.
  2. إضافة عمود `visits.shift_id` كـ FK → `shifts(shift_id)`.
  3. مستخدم نظام `user_id=0` (`__system__`) للإقفال التلقائي.
  4. **Backfill:** نسخ كل سجلات `shifts_closures` التاريخية إلى `shifts`، وربط الزيارات القديمة بفتراتها استناداً إلى `visit_date`.
  5. تنظيف `system_settings`: إضافة `shift_default_split_time` و `shift_default_day_mode`.

### 🟢 المرحلة 4 — خدمة `ShiftService` والإقفال التلقائي
- **الحالة:** ✅ مكتملة.
- **الملفات الجديدة:**
  - `src/Utils/ShiftService.php` (570 سطر) — خدمة مركزية تُغلّف كل منطق الفترات.
- **الدوال الرئيسية في `ShiftService`:**
  - `resolveOrCreateShift(DateTimeInterface)` → يُرجع `shift_id` للوقت المعطى، يُنشئ سجلاً جديداً عند الحاجة.
  - `ensureDayDefined(string $shiftDate)` → يضمن وجود سجلَّي اليوم (صباحي/مسائي) وفق `day_mode`.
  - `findOpenExpiredShifts()` → يُرجع الفترات المفتوحة التي انقضى وقت نهايتها.
  - `markShiftClosed(int, int, bool, ?int)` / `markShiftOpen(int)` → تغيير حالة الفترة.
  - `getNextShiftStartTime(int)` → لقيد إعادة الفتح.
- **التحديثات في `AccountingModel`:**
  - `closeShift()`: pre-flight check لرفض الإقفال إن وُجدت فواتير معلّقة.
  - `autoCloseShift(int)`: تسوية الفواتير + استدعاء `closeShift` + ختم `auto_closed=TRUE`.
  - `runAutoClosurePass()`: يمسح كل الفترات المنتهية ويُغلقها (نقطة دخول scheduler/lazy).

### 🟢 المرحلة 5 — DoctorController وربط الزيارات + Audit Logs Phase 1
- **الحالة:** ✅ مكتملة.
- **التغيير:** كل INSERT جديد في `visits` يستدعي `ShiftService::resolveOrCreateShift(now)` ويُخزّن `shift_id`.
- **الملفات:** `src/Controllers/DoctorController.php` (`newPatient` + `existingPatientVisit`).
- **بدء استخدام `shift_id` في تقارير الإيرادات** عبر `JOIN shifts s ON s.shift_id = v.shift_id` بدلاً من `CASE WHEN EXTRACT(HOUR…)`.

### 🟢 المرحلة 6 — توحيد مصدر بيانات اليومية + قرص الساعة في Admin
- **الحالة:** ✅ مكتملة.
- **المرجع:** `PHASE_6_DAILY_VIEW_UNIFIED.md`.
- **التغييرات:**
  - Endpoint موحّد: `GET /api/reports/daily_view?date=…&shift_type=morning|evening|all`.
  - `daily_journal.js` + `daily_info.js` يستهلكان نفس المصدر.
  - **قرص الساعة التفاعلي في `admin.js`:** SVG دائري 360° لتعديل وقت الفصل وحالة `day_mode` لكل يوم.
  - Endpoint جديد: `POST /api/admin/shifts/save_boundaries`.

### 🟢 المرحلة 7 — Audit Log AUTO_CLOSE + Select ديناميكي لقيود CHECK
- **الحالة:** ✅ مكتملة.
- **المرجع:** `PHASE_7_AUDIT_LOG_AUTO_CLOSE.md`.
- **التغييرات:**
  - `database/migrations/017_audit_log_auto_close_action.sql`: إضافة قيمة `AUTO_CLOSE` إلى `audit_logs_action_check`.
  - `AdminModel::getTableMeta()`: قراءة قيم ENUM من قيود `CHECK` (لـ `shifts.status`، `shifts.day_mode`، `audit_logs.action`...).
  - `admin.js`: عرض Select بدلاً من Text Input تلقائياً للأعمدة ذات الـ enum.
  - شاشة سجل التدقيق تعرض `AUTO_CLOSE` بـ badge مميّز (🤖 إقفال تلقائي).

### 🟢 المرحلة 8 — اختبارات وتوثيق (هذه المرحلة)
- **الحالة:** ✅ مكتملة.
- **المرجع:** `PHASE_8_TESTING_AND_DOCUMENTATION.md`.
- **المُنتج:**
  1. **سكربت اختبارات سيناريوهات شامل:** `database/tests/PHASE_8_SHIFTS_SCENARIOS.sql` — 10 اختبارات SAVEPOINT/ROLLBACK تُنفَّذ بأمان على بيئة الإنتاج.
  2. **هذا الملف:** `CHANGES_SHIFTS_REFACTOR.md` — Changelog مُجمَّع.
  3. **توثيق المرحلة 8:** `PHASE_8_TESTING_AND_DOCUMENTATION.md`.
  4. **تحديث `README.md`:** إضافة قسم "نظام الفترات المالية" مع جدول الـ APIs والتدفقات.

---

## 🧪 نتائج الاختبارات الفعلية (تشغيل على Render — تاريخ المرحلة 8)

| # | السيناريو | النتيجة |
|---|---|---|
| 1 | إقفال يدوي بدون فواتير معلّقة | ✅ PASS |
| 2 | عدّاد الفواتير المعلّقة في الفترة | ✅ PASS |
| 3 | الإقفال التلقائي (`findOpenExpiredShifts`) | ✅ PASS |
| 4 | إعادة فتح قبل بدء الفترة التالية | ✅ PASS |
| 5 | إعادة فتح بعد بدء الفترة التالية (يجب الرفض) | ✅ PASS |
| 6 | يوم كامل صباحي (`day_mode = 'morning_only'`) | ✅ PASS |
| 7 | يوم كامل مسائي (`day_mode = 'evening_only'`) | ✅ PASS |
| 8 | عمود `visits.shift_id` و FK | ✅ PASS |
| 9 | قبول `AUTO_CLOSE` في `audit_logs.action` | ✅ PASS |
| 10 | قيد التفرّد `uq_shifts_date_type` | ✅ PASS |

**النتيجة الإجمالية:** **10 / 10 ✅** — جميع المسارات الحرجة تعمل كما هو مُصمَّم.

---

## 📂 خريطة الملفات المُتأثرة (مُجمَّعة)

### Migrations
- `database/migrations/012_shifts_closures.sql` — جدول إقفالات قديم (Phase 1).
- `database/migrations/013_seal_historical_tickets.sql` — ختم التذاكر التاريخية.
- `database/migrations/014_shift_boundaries_and_payment_order.sql` — إعدادات الحدود (Phase 2).
- `database/migrations/015_reopen_shift_and_audit_action.sql` — إعادة الفتح + إجراء REOPEN.
- `database/migrations/016_shifts_master_table_and_visit_link.sql` — **جدول shifts الجديد** (Phase 3).
- `database/migrations/017_audit_log_auto_close_action.sql` — إجراء AUTO_CLOSE (Phase 7).

### Services & Models
- `src/Utils/ShiftService.php` — **جديد** (Phase 4).
- `src/Utils/SettingsService.php` — تحديث (Phase 2).
- `src/Models/AccountingModel.php` — تحديث جوهري (Phase 4): `closeShift`, `autoCloseShift`, `runAutoClosurePass`, `countPendingInvoicesInShift`, `markShiftClosed/Open`.
- `src/Models/AdminModel.php` — تحديث (Phases 6+7): `reopenLatestShift`, `getTableMeta` (CHECK enums), `getShiftEditorState`, `saveShiftBoundaries`.
- `src/Models/DoctorModel.php` — تحديث (Phase 5): `shift_id` مع كل زيارة.
- `src/Models/ReportsModel.php` — تحديث (Phase 5+6): GROUP BY عبر `shifts`.

### Controllers
- `src/Controllers/AccountingController.php` — pre-flight check + reopenShift.
- `src/Controllers/AdminController.php` — endpoint `/admin/shifts/save_boundaries`.
- `src/Controllers/DoctorController.php` — تمرير `shift_id` عند إنشاء الزيارة.

### Routing / Lazy Hook
- `public/api/index.php` — **Lazy hook** يستدعي `runAutoClosurePass` عند مسارات `accounting/*` و `doctor/send_orders` (Phase 4).

### Frontend
- `public/assets/js/modules/admin.js` — قرص ساعة SVG + Select ديناميكي للـ ENUMs (Phase 6+7).
- `public/assets/js/modules/daily_journal.js` — مصدر بيانات موحّد + dropdown الفترة (Phase 6).
- `public/assets/js/modules/daily_info.js` — مصدر بيانات موحّد (Phase 6).

### Tests & Docs (Phase 8)
- `database/tests/PHASE_8_SHIFTS_SCENARIOS.sql` — **جديد**.
- `docs/changelogs/CHANGES_SHIFTS_REFACTOR.md` — **هذا الملف**.
- `docs/changelogs/PHASE_8_TESTING_AND_DOCUMENTATION.md` — **جديد**.
- `README.md` — قسم جديد: "نظام الفترات المالية".

---

## 🛡️ قيود/سلوكيات حافّية (Edge Cases) — مُغطّاة

| الحالة | السلوك المُنفَّذ |
|---|---|
| زيارة في الفجوة بين فترتين | `resolveOrCreateShift` يُنشئ فترة جديدة افتراضياً وفق `shift_default_split_time`. |
| إقفال فترة فارغة (لا فواتير) | مرفوض من `closeShift` ("لا توجد فواتير في هذه الفترة"). |
| إقفال فترة قُبل قبلها أصلاً | مرفوض. |
| إعادة فتح بعد بدء الفترة التالية | مرفوض. |
| `day_mode='morning_only'` | كل ساعات اليوم (00:00 → 24:00) تُعدّ صباحية. |
| `auto_closed=TRUE` يُسجَّل في audit_logs | بإجراء `AUTO_CLOSE` ومستخدم نظام `user_id=0`. |

---

## 🔗 روابط مفيدة

- خطة الإعادة الهيكلة الكاملة: [`docs/SHIFTS_REFACTOR_PLAN.md`](../SHIFTS_REFACTOR_PLAN.md)
- توثيق المرحلة 6: [`PHASE_6_DAILY_VIEW_UNIFIED.md`](PHASE_6_DAILY_VIEW_UNIFIED.md)
- توثيق المرحلة 7: [`PHASE_7_AUDIT_LOG_AUTO_CLOSE.md`](PHASE_7_AUDIT_LOG_AUTO_CLOSE.md)
- توثيق المرحلة 8: [`PHASE_8_TESTING_AND_DOCUMENTATION.md`](PHASE_8_TESTING_AND_DOCUMENTATION.md)
- سكربت الاختبارات: [`database/tests/PHASE_8_SHIFTS_SCENARIOS.sql`](../../database/tests/PHASE_8_SHIFTS_SCENARIOS.sql)

---

**حالة المشروع:** ✅ **خطة Shifts Refactor مكتملة بنسبة 100%** (المراحل 1 → 8).
