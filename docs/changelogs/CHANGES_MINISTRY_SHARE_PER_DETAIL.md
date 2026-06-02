# إضافة حصة الوزارة لكل خدمة في تفاصيل الفاتورة

**التاريخ:** 2026-05-28  
**Migration:** `008_invoice_detail_ministry_share.sql`

## ملخص التغيير

أُضيف حقل جديد `ministry_share_at_time` إلى جدول `invoice_details` بهدف
تسجيل حصة الوزارة لكل خدمة لحظة قبض الفاتورة، بحيث يصبح من الممكن
استخراج إجمالي حصة الوزارة لأي فترة دون الاعتماد على القيم الحالية في
`services_master` (التي قد تتغير لاحقاً).

## منطق العمل (Business Rule)

1. **حصة الوزارة ثابتة** لكل خدمة كما هي موثقة في `services_master.ministry_share`.
2. تُحسب وتُخزَّن **فقط** على سندات نوع **A**:
   - **A كاش كامل**: كل تفاصيل الفاتورة تحصل على حصة الوزارة.
   - **A الناتج عن إعفاء جزئي**: تفاصيل سند A الأصلي تحصل على حصة الوزارة كاملة
     لكل خدمة، لأن حصة الوزارة ثابتة ولا تتأثر بانخفاض `total` للسند.
3. تبقى = **0.00** للسندات التالية:
   - **B** (سند الإعفاء الجزئي / الكلي ضمن سند الإعفاء): الوزارة لا تستحق
     حصتها من الجزء المعفي.
   - **C** (إعفاء كلي): الوزارة لا تستحق شيئاً.
4. القيمة المخزَّنة = `services_master.ministry_share × invoice_details.quantity`
   لحظة الدفع، ولا تتأثر بأي تعديل لاحق على جدول الخدمات.

## الجداول المتأثرة

### `invoice_details` (الإضافة)

| العمود | النوع | الافتراضي | القيد |
|--------|------|-----------|--------|
| `ministry_share_at_time` | `NUMERIC(10,2)` | `0.00` | `>= 0` |

تمت إضافة:
- العمود نفسه مع `NOT NULL DEFAULT 0`.
- قيد `chk_invoice_details_ministry_share_nonneg` لمنع القيم السالبة.
- فهرس جزئي `idx_invoice_details_ministry_share` لتسريع تقارير حصة الوزارة.

## الملفات المعدَّلة

### 1. `migrations/008_invoice_detail_ministry_share.sql` (جديد)
- إضافة العمود + القيد + الفهرس.
- Backfill لكل تفاصيل الفواتير الموجودة من نوع A.

### 2. `models/AccountingModel.php`
- **دالة جديدة** `applyMinistryShare(int $invoiceId)` تُحدِّث
  `ministry_share_at_time` بالقيمة الصحيحة من `services_master`.
- **`processPayment`** يستدعي الدالة الجديدة في موضعين:
  - بعد تثبيت سند A الكامل (الدفع الكاش).
  - بعد تثبيت سند A الناتج عن الإعفاء الجزئي.
  - **لا** يُستدعى لسندات C (إعفاء كلي).
- **`getInvoiceDetails`** يعيد الآن `ministry_share` (المخزَّن وقت
  الدفع) إضافة إلى `ministry_share_master` (القيمة الحالية في جدول
  الخدمات) لأغراض الواجهة والتقارير.

## نتائج الـ Backfill (بيانات الإنتاج)

```
سند A (مجارحة(2))      → ministry_share_at_time = 50.00 ✅
سند A (CBC)            → ministry_share_at_time = 50.00 ✅
سند A (مجارحة(2))      → ministry_share_at_time = 50.00 ✅
سند B (تقرير طبي)      → ministry_share_at_time =  0.00 ✅
سند C (تقرير طبي)      → ministry_share_at_time =  0.00 ✅
فواتير معلقة (NULL)    → ministry_share_at_time =  0.00 ✅ (تُحدَّث وقت الدفع)
```

## استخدام البيانات الجديدة

### مثال: إجمالي حصة الوزارة لفترة معينة

```sql
SELECT SUM(id.ministry_share_at_time) AS total_ministry_share
FROM invoice_details id
JOIN invoices i ON i.invoice_id = id.invoice_id
JOIN document_types dt ON dt.doc_type_id = i.doc_type_id
WHERE dt.doc_name = 'A'
  AND i.paid_at BETWEEN :from_date AND :to_date;
```

### مثال: تفصيل حصة الوزارة حسب الخدمة

```sql
SELECT sm.service_name,
       SUM(id.ministry_share_at_time) AS ministry_total,
       COUNT(*)                       AS times_billed
FROM invoice_details id
JOIN services_master sm ON sm.service_id = id.service_id
JOIN invoices i         ON i.invoice_id  = id.invoice_id
JOIN document_types dt  ON dt.doc_type_id = i.doc_type_id
WHERE dt.doc_name = 'A'
GROUP BY sm.service_id, sm.service_name
ORDER BY ministry_total DESC;
```

## التوافق العكسي

- جميع الفواتير القديمة من نوع A تمت تعبئة حصة الوزارة لها أثناء الـ Backfill.
- لا يتأثر أي كود قائم لأن العمود له قيمة افتراضية.
- منطق إنشاء الفواتير (`createPendingInvoice`, `addInvoiceDetail`) لم يتغيّر
  — تبقى التفاصيل تُنشأ بقيمة `0.00`، وتُحدَّث لاحقاً عند تنفيذ الدفع إذا
  أصبح السند من نوع A.
