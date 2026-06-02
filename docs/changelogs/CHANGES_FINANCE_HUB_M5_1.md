# CHANGES — Finance Hub M5.1 (Frontend Foundation)

> بناء **الجزء الأساسي** من واجهة المركز المالي والسندي الشامل في ملف `finance_module.js` واحد، يربط بالـ 7 APIs المُسجَّلة في المرحلة M4.
>
> هذه المرحلة (M5.1) تغطي الأساس الجوهري للواجهة. الميزات المتقدمة (التصدير، الطباعة، إدارة الأعمدة، العروض المحفوظة، تقرير الوزارة) مؤجلة إلى المرحلة **M5.2** في الجلسة القادمة.

---

## نطاق المرحلة M5.1

### ✅ ما تم تنفيذه

1. **الحالة العامة + Utilities + CSS** كاملة وجاهزة للاستخدام في M5.2 لاحقاً.
2. **`viewHub()`** — نقطة الدخول الرئيسية للواجهة.
3. **6 KPIs ديناميكية** (إجمالي اليوم، الكاش، الإعفاءات، التذاكر، حصة الوزارة الشهرية، صافي المركز).
4. **4 رسوم بيانية بـ Chart.js**:
   - Line: إيرادات آخر 30 يوم
   - Doughnut: توزيع أنواع الحركات (A/B/C/T)
   - Bar Horizontal: أعلى 10 خدمات
   - Bar: أداء المحاسبين
5. **لوحة فلترة كاملة** (12 معيار):
   - من/إلى تاريخ
   - نوع السند (multi-select)
   - الحالة (multi-select)
   - المحاسب / الطبيب / القسم (multi)
   - تصنيف الخدمة / الخدمة (multi) ⭐
   - أدنى/أعلى مبلغ
   - بحث حر (debounced 450ms)
   - "حركات فيها حصة وزارة فقط" (checkbox)
6. **9 Quick Presets**: اليوم / الأسبوع / الشهر / السنة / الإعفاءات / التذاكر / الكاش / حصة الوزارة / الملغاة.
7. **شبكة بيانات (Unified Grid)**:
   - 13 عمود افتراضي.
   - Sort (DESC ↔ ASC) على: `serial_number`, `patient_name`, `total`, `cash_amount`, `exempt_amount`, `txn_timestamp`.
   - Pagination server-side: 25 / 50 / 100 / 200 + سهام أول/سابق/أرقام/تالي/أخير.
   - Multi-select + "تحديد كل الصفحة".
   - **صف المجاميع** (tfoot) لكل صفحة.
   - شارات ملوّنة لأنواع الحركات والحالات.
   - الصفوف الملغاة بـ `text-decoration: line-through`.
8. **Drawer التفاصيل** (sidedrawer منزلق):
   - يفتح بنقرة 👁️ على أي حركة.
   - يعرض: بيانات السند + المريض + الموظفون + الخدمات + السند المرتبط (للإعفاء الجزئي) + الإجماليات + Audit Trail.
   - قوالب منفصلة للفواتير والتذاكر.

### 🔜 ما هو مؤجل إلى M5.2

| الميزة | الملاحظات |
|---|---|
| Column Manager | إظهار/إخفاء/إعادة ترتيب الأعمدة (Modal مع أسهم ⬆⬇) |
| Saved Views | حفظ/تحميل/حذف عروض مخصصة في `localStorage` |
| XLSX Export (4 أوراق) | تصدير منسّق: Summary + Transactions + Pivot + Ministry |
| Print Templates | طباعة سند مفرد + تقرير دفعة (بالترويسة الرسمية) |
| Ministry Report Modal | تقرير حصة الوزارة التفصيلي + تصدير + طباعة |

---

## الملفات المُضافة

| الملف | نوع | الأسطر |
|---|---|---|
| `finance_module.js` | جديد | 1,350 سطر |
| `CHANGES_FINANCE_HUB_M5_1.md` | جديد | هذا الملف |

---

## بنية `finance_module.js`

| # | القسم | الوصف |
|---|---|---|
| 1 | `FinanceState` | الحالة العامة (filters, options, rows, charts, columns) |
| 2 | `FINANCE_COLUMN_CATALOG` | كاتالوج الأعمدة الافتراضي (15 عمود) |
| 3 | `injectFinanceStyles()` | حقن أنماط CSS (KPIs + Grid + Drawer + Dark Mode) |
| 4 | `FinanceUtils` | utilities (fmtMoney, fmtDateTime, esc, debounce, typeClass...) |
| 5 | `Finance.viewHub()` + Overview | الشاشة الرئيسية + KPIs + Charts |
| 6 | Filters Panel | لوحة الفلاتر + Quick Presets + Debounced Search |
| 7 | Data Grid | شبكة البيانات + Sort + Pagination + Select |
| 8 | Detail Drawer | Drawer جانبي لتفاصيل الحركة |
| 9 | Public Exposure | تعريض `window.Finance` للاستدعاء العالمي |

---

## الـ APIs المستهلكة في M5.1

| Endpoint | الاستخدام |
|---|---|
| `GET  /api/finance/filter_options` | تعبئة الـ dropdowns عند فتح الواجهة |
| `POST /api/finance/overview` | تحديث الـ 6 KPIs و الـ 4 Charts |
| `POST /api/finance/transactions` | جلب الـ Unified Ledger مع الفلاتر والتقسيم |
| `POST /api/finance/transaction_detail` | تحميل تفاصيل حركة في الـ Drawer |

الـ 3 APIs الباقية (`export`, `ministry_report`, `print_voucher`) ستُستهلَك في M5.2.

---

## كيفية الاختبار اليدوي

الموديول يُعرّض `window.Finance` عالمياً ولا يُسجَّل في القائمة الجانبية تلقائياً (هذا مؤجل إلى M6).

للاختبار اليدوي من Console المتصفح أو من أي موديول آخر:

```javascript
// أولاً حمّل الملف:
const s = document.createElement('script');
s.src = 'finance_module.js';
document.body.appendChild(s);

// بعد التحميل، افتح الواجهة:
Finance.viewHub();
```

---

## التحقق النحوي

```
$ node -c finance_module.js
✅ Syntax OK
```

---

## الاعتمادات (External Dependencies)

كلها محمّلة بالفعل في `index.html`:
- ✅ Bootstrap 5.3 + Bootstrap Icons
- ✅ Chart.js 4.4
- ✅ `main_core.js` (`Core.apiCall`, `Core.showAlert`, `Core.navigateTo`)

**لا حاجة لأي مكتبات إضافية.**

---

## الخطوة التالية المتوقعة (M5.2)

في الجلسة القادمة سيُنفَّذ الجزء الثاني من M5:
1. **Column Manager** عبر Modal مع أسهم ترتيب.
2. **Saved Views** في localStorage مع UI لاستعراضها.
3. **XLSX Export** مع 4 أوراق منسّقة.
4. **Print Templates** لسند مفرد + تقرير دفعة.
5. **Ministry Report Modal** كامل.

بعدها، **M6** ستربط الواجهة بالقائمة الجانبية (للمحاسب والمدير).

---

**نهاية الوثيقة — M5.1 جاهزة للنشر ✅**
