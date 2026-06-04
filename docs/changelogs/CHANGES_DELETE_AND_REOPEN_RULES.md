# تغييرات: قواعد حذف السندات + ضوابط التسديد + إعادة فتح الفترات

## نظرة عامة
هذه الوثيقة توثّق ثلاث مجموعات من التعديلات السلوكية على نظام مركز الطوارئ:

1. **إجراءات حذف السندات** — تحديث تلقائي للتسلسل وعداد `document_types`.
2. **ضوابط التسديد الصارمة** — التحقق من إقفال الفترة السابقة قبل أي تسديد.
3. **إعادة فتح الفترة الأخيرة** — مع تطبيق إجراءات الحذف على سند التحصيل المرتبط.

---

## أولاً — إجراءات حذف السندات

**الملف:** `src/Models/AdminModel.php`

عند حذف فاتورة (سند) من خلال `AdminController::deleteRecord` (`POST /api/admin/delete`)، يقوم النظام تلقائياً بـ:

1. **إنقاص رقم التسلسل** لكل الفواتير اللاحقة من نفس **مجموعة التسلسل** بمقدار `1`:
   - السندات من نوع `A` تحمل عدّاداً مستقلاً وتُعاد ترقيمها ضمن `doc_type=A` فقط.
   - السندات من نوعَي `B` و `C` يتشاركان عدّاداً واحداً (يُخزَّن تحت سجل `doc_name='B'`)، وتُعاد ترقيمها معاً.

2. **إنقاص العدّاد** `document_types.current_serial` بمقدار `1` لسجل العدّاد المعني (`A` أو `B`).

3. إعادة الترقيم تتم **بترتيب تصاعدي** (`ORDER BY serial_number ASC`) لكي لا تخرق قيد `UNIQUE(doc_type_id, serial_number)` أثناء التحديثات.

4. كل ذلك يجري ضمن **معاملة (Transaction)** واحدة مع `SELECT ... FOR UPDATE` على سجل العدّاد لمنع التسابق.

5. عند وجود علاقة قوية `related_invoice_id` (سندَا A↔B في الإعفاء الجزئي)، فإن FK `ON DELETE CASCADE` يحذف السند المرتبط تلقائياً ويتم تطبيق نفس إعادة الترقيم عليه أيضاً.

### مدخل API:
```
POST /api/admin/delete
{ "table": "invoices", "id": 123 }
```

### ملاحظة:
- إجراء **إلغاء الفاتورة** (Soft Delete عبر `cancelInvoice`) **لم يتغيّر** ولا يُعيد الترقيم — السندات الملغاة تحتفظ بأرقامها بسبب قيد `UNIQUE`.
- إعادة الترقيم تُطبَّق فقط عند **الحذف الفعلي** (Hard Delete).

---

## ثانياً — ضوابط التسديد في نظام أمين الصندوق

**الملف:** `src/Models/AccountingModel.php` (دالة `findBlockingPreviousShift`)

قبل أي تسديد، يفرض النظام شرطين متسلسلَين على الفترة السابقة:

1. **اكتمال السداد**: لا توجد أي فاتورة معلّقة (`doc_type_id IS NULL AND accountant_id IS NULL`) ضمن نطاق الفترة السابقة.
2. **الإقفال الرسمي**: يوجد سجل في `shifts_closures` بحالة `status='locked'` يطابق `(shift_type, shift_date)` للفترة السابقة.

### الاستثناء الوحيد:
إذا كانت الفترة السابقة **فارغة تماماً** (لا توجد بها أي تذكرة معاينة في `examination_tickets`)، فلا يُشترط إقفالها لأن `closeShift` يرفض إقفال فترة فارغة.

### رسائل الخطأ:
- إذا وُجدت فواتير معلّقة: `لا يمكن تسديد هذه الفاتورة قبل إكمال تسديد فواتير الفترة [اسم الفترة] (N فاتورة معلّقة).`
- إذا كانت الفترة غير مُقفلة (مع وجود تذاكر): `لا يمكن تسديد أي فاتورة في الفترة الحالية قبل إقفال [اسم الفترة].`

### مدخل API:
يُطبَّق تلقائياً داخل `POST /api/accounting/pay_invoice`. يُمكن استعلامه مسبقاً عبر `GET /api/accounting/previous_shift_check?invoice_id=X`.

---

## ثالثاً — إعادة فتح الفترة المالية الأخيرة

**الملفات:**
- `src/Models/AdminModel.php` — `reopenLatestShift($closureId, $userId)`
- `src/Controllers/AdminController.php` — `reopenShift($data)`
- `src/Controllers/AccountingController.php` — `reopenShift($data)`
- `public/api/index.php` — مساران جديدان
- `public/assets/js/modules/daily_journal.js` — زر "🔓 إعادة فتح"

### القواعد المُطبَّقة:
1. **السماح بإعادة فتح الإقفال الأخير فقط** (آخر سجل في `shifts_closures` بحسب `closed_at DESC, id DESC`).
2. **حذف سند التحصيل الإجمالي (A)** المرتبط بهذه الفترة، مع تطبيق "إجراءات حذف السندات" (تحديث تسلسل لاحق + عدّاد `document_types`).
3. **فك ارتباط التذاكر** عبر `UPDATE examination_tickets SET shift_closure_id = NULL`، لتعود التذاكر قابلة للإقفال مجدداً.
4. **حذف سجل الإقفال** من `shifts_closures`.
5. كل ذلك ضمن **معاملة واحدة** ذرّية.

### مداخل API:
```
POST /api/accounting/reopen_shift   ← لأمين الصندوق (دور: أمين صندوق)
POST /api/admin/reopen_shift         ← لمدير النظام (دور: مدير النظام)

body: { "closure_id": 10 }
```

### الواجهة الأمامية:
في صفحة **اليومية** (Daily Journal)، يظهر زر **"🔓 إعادة فتح"** بجانب صف الإقفال الأخير فقط في اليوم المعروض. عند الضغط:
- تأكيد المستخدم برسالة تحذيرية واضحة.
- يستدعي `accounting/reopen_shift` ويُعيد تحميل اليومية بعد النجاح.

---

## رابعاً — Migration على قاعدة البيانات

**الملف:** `database/migrations/015_reopen_shift_and_audit_action.sql`

```sql
ALTER TABLE audit_logs
    DROP CONSTRAINT IF EXISTS audit_logs_action_check;

ALTER TABLE audit_logs
    ADD CONSTRAINT audit_logs_action_check
    CHECK (action::text = ANY (ARRAY[
        'CREATE','UPDATE','DELETE','LOGIN','LOGOUT',
        'CANCEL','EXPORT','IMPORT','VIEW',
        'REOPEN','OTHER'
    ]::character varying[]));
```

السبب: إضافة الإجراء `REOPEN` كقيمة مسموحة في عمود `audit_logs.action` (المُدير يسجّل عملية إعادة الفتح في سجل التدقيق).

---

## ملف التوافق الزمني (Atomicity)

كل العمليات الحرجة تجري داخل معاملات SQL:

| العملية | المعاملة |
|---------|----------|
| حذف فاتورة + إعادة ترقيم | `BEGIN / FOR UPDATE / DELETE / UPDATE×N / COMMIT` |
| إعادة فتح فترة | `BEGIN / FOR UPDATE / UPDATE tickets / DELETE closure / DELETE invoice / COMMIT` |
| فحص التسديد الصارم | قراءة فقط (لا معاملة) |

---

## اختبار سريع للتحقق

```sql
-- قبل الحذف:
SELECT serial_number, invoice_id, doc_type_id FROM invoices
WHERE doc_type_id = 1 ORDER BY serial_number;

-- بعد حذف فاتورة برقم تسلسلي 5:
-- يجب أن تكون الفواتير 6, 7, 8 → 5, 6, 7
-- وعداد document_types.current_serial لـ doc_name='A' ينخفض بـ 1
SELECT current_serial FROM document_types WHERE doc_name = 'A';
```
