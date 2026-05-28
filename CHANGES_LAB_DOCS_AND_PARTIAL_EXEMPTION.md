# تحديث: نظام السندات والمستندات (Bonds & Vouchers System)

تاريخ التحديث: 2026-05-28
الترقية: `migrations/007_lab_documents_and_partial_exemption.sql`

---

## أولاً: أتمتة مستندات المختبر (Laboratory Documents)

**المتطلب**: مع كل طلب فحص يرسله الطبيب إلى قسم المختبر، يجب على النظام
تلقائياً إنشاء مستند جديد (استمارة فحص) وتصنيفه برمجياً من نوع `laboratory`.

### ما تم إنجازه

1. **نوع مستند جديد `L`** في جدول `document_types` بوصف
   "مستندات المختبر (استمارة فحص تُصدر تلقائياً)".

2. **جدول جديد `laboratory_documents`** يحفظ كل استمارة فحص مع:
   - `lab_doc_id` (PK)
   - `visit_id` (FK → visits, ON DELETE CASCADE)
   - `invoice_id` (FK → invoices, ON DELETE SET NULL)
   - `serial_number` (تسلسل خاص بنوع L، يدار عبر `current_serial`)
   - `doc_type_id` (FK → document_types، دائماً نوع L)
   - `doc_category` (CHECK = 'laboratory')
   - `services_count`, `notes`, `issued_by`, `created_at`, `updated_at`

3. **منطق التوليد التلقائي** في:
   - `DoctorModel::getServiceDetailsById()` يعيد الآن `department_code`
     للسماح بمعرفة هل الخدمة تتبع المختبر.
   - `DoctorModel::createLaboratoryDocument()` (جديدة) تخصص رقم تسلسلي آمن
     وتدرج صفّاً جديداً في `laboratory_documents`.
   - `DoctorController::sendRequests()` يحصي خدمات المختبر داخل الطلب،
     وإن وُجدت ≥ 1 يستدعي `createLaboratoryDocument` داخل نفس المعاملة
     بعد إنشاء فاتورة الطلب وقبل الـ COMMIT.
   - يُرسل إشعار `new_lab_document` إلى دور "فني مختبر".

4. **رد API الجديد** من `doctor/send_requests` أصبح يتضمن:
   ```json
   {
     "success": true,
     "message": "تم إرسال الطلبات وحفظها بنجاح",
     "data": {
       "invoice_id": 71,
       "lab_document_id": 5,
       "laboratory_services_count": 3
     }
   }
   ```

---

## ثانياً: معالجة آلية الإعفاء الجزئي (Partial Exemption Bug)

**المشكلة السابقة**: عند وجود مبلغ معفى جزئياً، كان النظام ينشئ سند B
وحيد يحمل في صف واحد `net_amount` (الكاش) و`exemption_value` (الإعفاء)،
متجاهلاً إنشاء سند مستقل للمبلغ المدفوع نقداً.

**الحل المُطبَّق**: عند تنفيذ أي عملية إعفاء جزئي، يُولّد النظام الآن
**سندين تلقائياً**:

1. **سند نوع `A`**: يحمل المبلغ المدفوع نقداً (Cash):
   - `total = exemption_value (الكاش)`, `net_amount = الكاش`, `exemption_value = 0`
   - يحتفظ بفواتير `invoice_details` الأصلية (قائمة الخدمات).

2. **سند نوع `B`**: يحمل المبلغ المعفي (Exempted):
   - `total = الإعفاء`, `exemption_value = الإعفاء`, `net_amount = 0`
   - صفّ منفصل تماماً في `invoices` بتسلسل مستقل ضمن تسلسل B.

### الربط البرمجي (Strong Relationship)

أُضيف عمود `related_invoice_id` إلى جدول `invoices` بمفتاح أجنبي ذاتي
مع `ON DELETE CASCADE`:

```sql
ALTER TABLE invoices
    ADD COLUMN related_invoice_id INTEGER
    REFERENCES invoices(invoice_id)
    ON UPDATE CASCADE
    ON DELETE CASCADE;
```

- `A.related_invoice_id = B.invoice_id`
- `B.related_invoice_id = A.invoice_id`

ذلك يضمن:
- ✅ إلغاء أحد السندين يؤدي تلقائياً لإلغاء الشريك (لا تتفكك العملية).
- ✅ تتبّع السندين معاً في التقارير والإحصائيات كعملية مالية واحدة.
- ✅ منع الإشارة الذاتية بقيد `chk_invoices_no_self_ref`.
- ✅ فهرس جزئي `idx_invoices_related_invoice_id` للأداء.

### تحديثات الكود

- **`AccountingModel::processPayment()`** أُعيد بناؤها لتعيد مصفوفة
  بدلاً من `int` واحد:
  - حالة `A`/`C`: `['A' => serial]` أو `['C' => serial]`
  - حالة `B`: `['A' => serialA, 'B' => serialB, 'invoice_id_A' => x, 'invoice_id_B' => y]`
- **`AccountingModel::allocateSerial()`** دالة مساعدة جديدة تتعامل مع
  قفل سجل `document_types` + حماية MAX() من السباق.
- **`AccountingController::payInvoice()`** تعيد للواجهة:
  ```json
  {
    "success": true,
    "serial_number": 5,           // رقم سند الكاش للعرض الرئيسي
    "cash_serial": 5,
    "exempt_serial": 4,
    "invoice_id_A": 71,
    "invoice_id_B": 72,
    "serials": { "A": 5, "B": 4 },
    "message": "تم السداد بنجاح — توليد سندين: كاش (A) + إعفاء (B) مترابطين"
  }
  ```
- **`AccountingController::getDailyTreasury()`** يُميّز:
  - `A` بلا related = "كاش" (دفع كامل).
  - `A` مع related = "كاش (إعفاء جزئي)" — يُحسب ضمن `total_cash` و
    `total_payments`، ولا يُكرَّر عدّه في عداد الإعفاء الجزئي.
  - `B` مع related = "إعفاء جزئي" — يُحسب ضمن `total_partial_exemption`.
  - `C` = "إعفاء كلي".
  - `B` بلا related (سندات قديمة قبل الترقية) = "إعفاء جزئي (قديم)" مع
    حساب net+exemption معاً للحفاظ على الإحصائيات التاريخية.
- **`accounting_module.js`**:
  - أثناء حساب الخصم: يعرض `A:#5 + B:#4` للإعفاء الجزئي حتى يرى أمين
    الصندوق رقمَي السندَين القادمَين.
  - بعد السداد الناجح: تنبيه واضح يذكر كلا الرقمين.

---

## كيفية التطبيق

1. تطبيق ترقية قاعدة البيانات:
   ```bash
   psql $DATABASE_URL -f migrations/007_lab_documents_and_partial_exemption.sql
   ```
2. سحب آخر تعديلات الكود ودفعها للسيرفر (Render يعيد البناء تلقائياً
   عند الـ push على main).

---

## ملخص العلاقات الجديدة (ER)

```
invoices ──┐  (related_invoice_id, ON DELETE CASCADE)
           └──> invoices  ──── سندي A و B مترابطان في الإعفاء الجزئي

visits ────┐
           ├──> invoices ────> invoice_details ────> services_master
           │
           └──> laboratory_documents ────> document_types (L)
                       │
                       └────> invoices (مرجع اختياري للفاتورة المرتبطة)
```
