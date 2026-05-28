# CHANGES — Finance Hub M4 (API Routes)

> تسجيل المسارات السبعة الخاصة بالمركز المالي والسندي الشامل في الـ API Router، وربطها بـ `AuthMiddleware` لتعمل بصلاحية مشتركة بين المحاسب والمدير.

---

## نطاق المرحلة

تنفيذ **M4 فقط** كما هو مذكور في خطة الـ Financial Hub:
- إضافة 7 routes تحت بادئة `finance/` في `api/index.php`.
- تركيب handler مخصّص يطبّق سياسة الوصول: `أمين صندوق` + `مدير النظام`.
- تمرير `user_id` و `job` إلى `FinanceController` ليُطبّق الـ scope داخلياً (المحاسب يرى حركاته فقط).
- بدون أي تعديل على الواجهة الأمامية، ولا تكامل القائمة الجانبية — مؤجّل إلى M5/M6.

---

## الملفات المعدّلة

| الملف | نوع التغيير | الأسطر المضافة |
|---|---|---|
| `api/index.php` | تعديل | +20 |
| `CHANGES_FINANCE_HUB_M4.md` | جديد | — |

---

## التغيير في `api/index.php`

### Handler جديد

أضيف `$financeHandler` (بنفس نمط `$accountingHandler` و `$adminHandler`):

```php
$financeHandler = function (string $methodName, bool $passData = true) use ($data): void {
    $userData = AuthMiddleware::checkAccess(['أمين صندوق', 'مدير النظام']);
    $controller = new FinanceController(
        (string) $userData['user_id'],
        (string) $userData['job']
    );
    if ($passData) {
        $controller->{$methodName}($data);
        return;
    }
    $controller->{$methodName}();
};
```

### المسارات السبعة المضافة

| # | المسار | طريقة HTTP | الدالة في الـ Controller | الوصف |
|---|---|---|---|---|
| 1 | `finance/overview` | POST | `getOverview` | KPIs (اليوم + الشهر) + 4 charts |
| 2 | `finance/transactions` | POST | `getTransactions` | Unified Ledger مع 12 فلتر + pagination + sorting |
| 3 | `finance/transaction_detail` | POST | `getTransactionDetail` | تفاصيل حركة (فاتورة/تذكرة) + audit trail |
| 4 | `finance/export` | POST | `export` | تجهيز بيانات XLSX (4 أوراق: summary, transactions, pivot, ministry) |
| 5 | `finance/filter_options` | GET | `getFilterOptions` | dropdowns للفلاتر |
| 6 | `finance/ministry_report` | POST | `getMinistryReport` | تقرير حصة الوزارة التفصيلي |
| 7 | `finance/print_voucher` | POST | `printVoucher` | بيانات السند للطباعة (مع ترويسة `system_settings`) |

---

## الصلاحيات (RBAC) المطبّقة

| Role | الوصول |
|---|---|
| `مدير النظام` | كل البيانات بدون scope |
| `أمين صندوق` | فقط حركاته الخاصة (يُطبَّق `_scope_accountant_id` تلقائياً داخل `FinanceController`) |
| `طبيب عام` / `استقبال` / `فني مختبر` | محجوب → **HTTP 403** |
| طلب بدون JWT | محجوب → **HTTP 401** |

---

## اختبارات M4 (End-to-End)

تم تشغيل suite اختباري حقيقي على PHP built-in server بقاعدة بيانات الإنتاج (Render PG):

| # | الاختبار | النتيجة |
|---|---|---|
| 1 | admin GET `filter_options` → 200 | ✅ |
| 2 | `filter_options` يحتوي `doc_types` (4 أنواع) | ✅ |
| 3 | `filter_options` يحتوي `ticket_ministry_shares` | ✅ |
| 4 | POST على `filter_options` → 405 (Method Not Allowed) | ✅ |
| 5 | admin POST `transactions` → 200 | ✅ |
| 6 | `transactions.rows` array صحيح | ✅ |
| 7 | admin يرى `total_count > 0` | ✅ |
| 8 | cashier POST `transactions` → 200 | ✅ |
| 9 | scope يحجب حركات الآخرين عن cashier | ✅ |
| 10 | admin POST `overview` → 200 | ✅ |
| 11 | overview.kpis.today موجود | ✅ |
| 12 | overview.charts.revenue_30days موجود | ✅ |
| 13 | admin POST `transaction_detail` → 200 | ✅ |
| 14 | detail.payload موجود | ✅ |
| 15 | cashier على حركة غير مملوكة → 403 | ✅ |
| 16 | admin POST `ministry_report` → 200 | ✅ |
| 17 | ministry_report.totals.grand_total موجود | ✅ |
| 18 | admin POST `export` → 200 | ✅ |
| 19 | export.sheets.transactions موجود | ✅ |
| 20 | admin POST `print_voucher` → 200 | ✅ |
| 21 | print_voucher.header.country موجود | ✅ |
| 22 | بدون token → 401 | ✅ |
| 23 | بـ role غير مصرّح (طبيب) → 403 | ✅ |

**النتيجة: 23/23 نجاح.**

---

## ما **لم** يُنفّذ في M4 (مؤجل عمداً)

| المرحلة | الوصف |
|---|---|
| M5 | `finance_module.js` — واجهة المركز المالي الكاملة |
| M6 | روابط القائمة الجانبية في `accounting_module.js` و `admin_module.js` |

---

## الخطوة التالية المتوقعة

في الجلسة القادمة سيُنفَّذ **M5** فقط: بناء الواجهة الأمامية الكاملة في `finance_module.js` (KPIs, Charts, Unified Grid, Smart Filters, XLSX Export, Print) باستخدام الـ APIs السبعة الجاهزة الآن.
