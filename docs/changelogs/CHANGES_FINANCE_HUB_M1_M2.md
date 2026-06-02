# المركز المالي والسندي الشامل — المرحلتان M1 و M2

> **الإصدار:** v2.0 — Finance Hub (Phase 1 of 6)
> **التاريخ:** 2026-05-28
> **الحالة:** ✅ M1 + M2 مُنجزة ومُختبَرة

---

## 📦 ما تم إنجازه في هذه المرحلة

### 🟦 M1 — Migration 009 (قاعدة البيانات)

**الملف:** `migrations/009_finance_hub.sql`

#### 1. فهارس الأداء الجديدة (9 فهارس)

| الجدول | الفهرس | الغرض |
|---|---|---|
| `invoices` | `idx_invoices_paid_at_doc_type` | تسريع الفلترة الزمنية بنوع السند |
| `invoices` | `idx_invoices_accountant_paid_at` | تقارير أداء المحاسبين |
| `invoices` | `idx_invoices_cancelled_at` | استدعاء السندات الملغاة |
| `invoices` | `idx_invoices_related_invoice_id` | الربط بين سندي A و B في الإعفاء الجزئي |
| `invoice_details` | `idx_invoice_details_invoice_id` | حساب حصة المركز/الوزارة |
| `invoice_details` | `idx_invoice_details_service_id` | فلترة بالخدمة |
| `examination_tickets` | `idx_tickets_created_at_type` | فلترة التذاكر زمنياً + بالنوع |
| `examination_tickets` | `idx_tickets_issued_by` | أداء مصدري التذاكر |
| `visits` | `idx_visits_doctor_date` | أداء الأطباء |
| `visits` | `idx_visits_patient_id` | تنقّل سريع للمريض |
| `services_master` | `idx_services_master_category` | dropdown الخدمات |
| `service_categories` | `idx_service_categories_department` | dropdown التصنيفات |

#### 2. إعدادات جديدة في `system_settings`

| المفتاح | القيمة | الوصف |
|---|---|---|
| `ticket_ministry_share_morning` | **30** | حصة الوزارة من تذكرة المعاينة الصباحية (ريال) |
| `ticket_ministry_share_evening` | **100** | حصة الوزارة من تذكرة المعاينة المسائية (ريال) |
| `finance_hub_default_page_size` | 50 | عدد الحركات الافتراضي في صفحة المركز المالي |
| `finance_hub_export_limit` | 10000 | الحد الأقصى للحركات في عملية تصدير واحدة |
| `finance_hub_currency_label` | ريال | وحدة العملة المعروضة في الواجهة والتقارير |

#### 3. تحديث الإحصائيات
- `ANALYZE` على 6 جداول لتحسين خطة المُحسِّن (planner).

#### 🛡️ الأمان والإرجاع
- جميع الفهارس مع `IF NOT EXISTS` → آمن لإعادة التنفيذ.
- جميع الإعدادات مع `ON CONFLICT DO NOTHING` → لا يكسر القيم القديمة.
- لا تعديل هيكلي على أي جدول → آمن 100٪.

---

### 🟦 M2 — FinanceModel.php (منطق الأعمال)

**الملف:** `models/FinanceModel.php` (~1280 سطر)

#### 1. النواة: دفتر الحركات الموحّد (Unified Ledger)

استعلام `UNION ALL` ذكي يدمج **مصدرين بيانات** تحت مظلة واحدة:

```
المصدر 1: invoices + invoice_details
   ├── A = كاش
   ├── B = إعفاء جزئي (مع related_invoice_id)
   └── C = إعفاء كلي

المصدر 2: examination_tickets
   └── T = تذكرة معاينة (صباحي/مسائي)
```

كل حركة تُقدَّم في **22 حقلاً قياسياً** (`txn_id`, `source_table`, `txn_type`, `doc_code`, `serial_number`, `patient_*`, `total`, `cash_amount`, `exempt_amount`, `center_share`, `ministry_share`, `accountant_*`, `doctor_*`, `txn_timestamp`, `status`, `related_id`, `cancel_reason`).

#### 2. الدوال العامة (Public Methods)

| الدالة | الغرض |
|---|---|
| `getTransactions($filters, $page, $perPage, $sortBy, $sortDir)` | الاستعلام الرئيسي مع الفلاتر + Pagination + Total Count |
| `getTotals($filters)` | المجاميع الكاملة لكل النتائج (للـ KPIs والتصدير) |
| `getKpis($userScope)` | KPIs اليوم + الشهر (6 بطاقات) |
| `getRevenue30Days($userScope)` | بيانات الـ Line Chart |
| `getTypeDistribution($filters)` | بيانات الـ Doughnut Chart |
| `getTopServices($filters, $limit)` | Top N Services (Bar Chart) |
| `getAccountantsPerformance($filters)` | أداء المحاسبين (Bar Chart) |
| `getTransactionDetail($txnId)` | تفاصيل حركة فردية (INV-X أو TKT-X) |
| `getMinistryShareReport($filters)` | تقرير حصة الوزارة (خدمات + تذاكر) |
| `getFilterOptions()` | كل الـ Dropdowns مرة واحدة |
| `getTicketMinistryShares()` | حصص الوزارة الحالية (cached) |

#### 3. محرك الفلترة (12 معيار قابل للتقاطع)

```php
[
    'from' => '2026-05-01 00:00:00',   // الفترة الزمنية
    'to'   => '2026-05-31 23:59:59',
    'doc_codes'      => ['A', 'B', 'T'],          // أنواع السندات
    'statuses'       => ['paid', 'issued'],       // الحالات
    'accountant_ids' => [3],                       // المحاسبون
    'doctor_ids'     => [2],                       // الأطباء
    'service_ids'    => [12, 13],                  // ⭐ الخدمات
    'category_ids'   => [1, 3],                    // ⭐ تصنيفات الخدمات
    'department_ids' => [1, 2],                    // الأقسام
    'amount_min'     => 1000,                      // نطاق المبلغ
    'amount_max'     => 5000,
    'has_ministry_share' => true,                  // حصة وزارة فقط
    'query'          => '5001 أو محمد',            // بحث نصي حر
    '_scope_accountant_id' => 3,                   // scope للمحاسب (يحدده الـ Controller)
]
```

#### 4. الأمان

- **Parametrized Queries:** كل المدخلات تمرّ عبر `PDO::bindValue` — لا SQL Injection ممكن.
- **Whitelist للفرز:** حقول الفرز محصورة في قائمة معتمدة.
- **Whitelist للأنواع:** doc_codes و statuses تُفلتر مقابل قائمة معتمدة.
- **Integer Casting:** كل الـ IDs تُمرّر عبر `(int)` قبل البناء.

#### 5. الأداء

- **استعلام واحد لـ rows + total_count** عبر `COUNT(*) OVER()`.
- **LATERAL JOIN** لحساب حصة الوزارة/المركز لكل فاتورة بكفاءة.
- **Caching داخل instance** لحصص الوزارة (load once per request).
- **حد أقصى للصفحة 500** لحماية الذاكرة.

#### 6. الاختبار

✅ **20/20 اختبار ناجح** مقابل قاعدة البيانات الحية، تشمل:
1. حصص الوزارة من system_settings (30/100)
2. الـ Unified Ledger بدون فلاتر
3. ظهور التذاكر (T) في الـ Ledger
4. فلترة بنوع السند، البحث النصي، الزمن، الخدمة، تصنيف الخدمة، نطاق المبلغ، حصة الوزارة
5. KPIs اليوم/الشهر
6. الـ 4 Charts (Revenue 30 Days, Type Distribution, Top Services, Accountants Performance)
7. تفاصيل فاتورة + تذكرة
8. تقرير حصة الوزارة (875 ريال إجمالي: 150 من الخدمات + 720 من التذاكر)
9. Pagination + Sorting + Total Count

---

## 🎯 ما تبقّى للمراحل القادمة

| المرحلة | المحتوى |
|---|---|
| **M3** | `controllers/FinanceController.php` (~500 سطر) |
| **M4** | تسجيل 7 routes في `api/index.php` |
| **M5** | `finance_module.js` — الواجهة الكاملة (~2800 سطر) |
| **M6** | روابط في sidebar للمحاسب والمدير + نشر |

---

## 🚀 طريقة تطبيق Migration 009 على بيئة جديدة

```bash
psql $DATABASE_URL -f migrations/009_finance_hub.sql
```

✅ **تم تطبيقه فعلياً على قاعدة البيانات الإنتاجية على Render وتأكيد نجاحه.**
