# إصلاح خطأ SQLSTATE عند إقفال الفترة + تقسيم تذاكر المعاينة (مشاركة/مشتركة)

## ملخص التعديل
ثلاث مشكلات أُصلحت في هذا التحديث:

1. **خطأ `SQLSTATE` عند محاولة إقفال الفترة**
   كانت دالة إقفال الفترة تفشل برسالة SQLSTATE بسبب استدعاء خاطئ لـ
   `PDO::lastInsertId()` على sequence لم يُستخدم في الجلسة الحالية.

2. **إقفال جميع الفترات السابقة بأثر رجعي**
   تم إقفال كل الفترات السابقة في قاعدة البيانات (ما عدا فترات اليوم)
   عبر سكربت SQL ذرّي يحاكي منطق `AccountingModel::closeShift`.

3. **تذاكر المعاينة في تقرير المعلومية اليومية**
   كان كامل مبلغ التذكرة يُحسب كحصة مركز (مشاركة المجتمع) فقط، وحصة
   المشتركة (الوزارة) دائماً صفر — رغم أن الإعدادات `ticket_ministry_share_morning`
   و `ticket_ministry_share_evening` تحدد حصة الوزارة لكل تذكرة.

---

## التفاصيل والإصلاحات

### 1) إصلاح SQLSTATE في `AccountingModel::closeShift`

**المشكلة:**
الدالة المساعدة `insertedIdFromLastStmt(string $column = 'id')` كانت
تتجاهل المعامل `$column` وتستدعي دائماً:
```php
$this->conn->lastInsertId('invoices_invoice_id_seq');
```

في PostgreSQL، `lastInsertId($seqName)` يُترجم داخلياً إلى
`SELECT currval($seqName)`، والذي يرمي خطأ:
```
SQLSTATE[55000]: object_not_in_prerequisite_state:
currval of sequence "invoices_invoice_id_seq" is not yet defined in this session
```

عندما يُستدعى بعد إدراج في `shifts_closures` (لا في `invoices`)، لأن
الـ sequence الخاص بـ invoices لم يُستخدم بعد في تلك الجلسة.

**الإصلاح في `src/Models/AccountingModel.php`:**
- إعادة كتابة `insertedIdFromLastStmt()` لتختار اسم sequence الصحيح
  بناءً على اسم العمود (`invoice_id` → `invoices_invoice_id_seq` …).
- في خطوة إقفال الفترة (`closeShift`)، استخدام
  `lastInsertId('shifts_closures_id_seq')` مباشرة بدلاً من الاعتماد على
  الدالة العامة، مع fallback آمن: استعلام صريح لآخر صف بنفس
  `shift_type + shift_date` (داخل نفس المعاملة).
- إضافة فحص نهائي يرمي استثناءً واضحاً إذا فشل الحصول على المعرّف.

### 2) إقفال الفترات السابقة بأثر رجعي

نُفّذ سكربت Python يحاكي منطق `closeShift` PHP بدقة:
- جلب التذاكر المفتوحة (`shift_closure_id IS NULL`) لكل (تاريخ + نوع)
  قبل تاريخ اليوم (UTC).
- إنشاء سجل في `shifts_closures` مع نطاق التسلسل، عدد التذاكر، حصص
  المركز والوزارة.
- إنشاء سند A إجمالي مرتبط بالإقفال (`shift_closure_id` على الفاتورة).
- ربط التذاكر بـ `shift_closure_id` الجديد.
- كذلك إصلاح السجلات القديمة في `shifts_closures` التي كان
  `closing_invoice_id` فيها `NULL` (سجلات قديمة بدون سند A) بإنشاء
  السندات المفقودة وربطها.

### 3) تقسيم مبلغ تذاكر المعاينة في تقرير المعلومية اليومية

**المشكلة:**
في `src/Models/ReportsModel.php::getTicketData()`:
```php
$result[$shift]['center_amount']   = (float) $row['ticket_amount']; // كل المبلغ
$result[$shift]['ministry_amount'] = 0.0;                            // صفر دائماً!
```
نتيجة: في تقرير المعلومية اليومية يظهر كل مبلغ التذكرة في صف
"مشاركة المجتمع"، وصف "المشتركة" يبقى فارغاً حتى لو كانت حصة الوزارة
معرّفة في `system_settings`.

**الإصلاح:**
- إضافة دالة `getTicketMinistryShareSettings()` تجلب
  `ticket_ministry_share_morning` و `ticket_ministry_share_evening` من
  `system_settings`.
- داخل `getTicketData()`، لكل فترة:
  ```
  ministry_amount = عدد_التذاكر × حصة_الوزارة_للتذكرة
  center_amount   = إجمالي_المبلغ - ministry_amount
  ```
- حماية رياضية: إذا كانت حصة الوزارة أكبر من الإجمالي (إعدادات
  خاطئة)، تُقيَّد عند الإجمالي ولا تنزل حصة المركز تحت الصفر.

**المثال (بناءً على الإعدادات الحالية):**
- تذكرة مسائية: 500 ريال. حصة الوزارة 100 ريال.
  → مشاركة المجتمع: 400، المشتركة: 100.
- تذكرة صباحية: 100 ريال. حصة الوزارة 30 ريال.
  → مشاركة المجتمع: 70، المشتركة: 30.

---

## الملفات المُعدَّلة

| الملف | الوصف |
|------|------|
| `src/Models/AccountingModel.php` | إصلاح `insertedIdFromLastStmt` + `closeShift` |
| `src/Models/ReportsModel.php`    | تقسيم تذاكر المعاينة بين مشاركة/مشتركة |

## بيانات قاعدة البيانات المُعدَّلة (لا يلزم تشغيل migration)

- 4 سجلات في `shifts_closures` تم تحديث `closing_invoice_id` لها.
- 1 سجل جديد في `shifts_closures` للفترة 2026-06-03 المسائية.
- 4 سندات A جديدة في `invoices` لإقفالات سابقة.
- 2 تذكرة في `examination_tickets` للفترة 2026-06-03 ربطت بالإقفال.
