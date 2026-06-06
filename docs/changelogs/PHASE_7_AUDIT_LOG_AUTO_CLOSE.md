# 🛡️ المرحلة 7 — سجل التدقيق (Audit Log) ودعم `AUTO_CLOSE`

> **المرجع:** `docs/SHIFTS_REFACTOR_PLAN.md` — §9 + §10 (المرحلة 7) — الخطوة رقم 18 من خارطة الطريق.
> **النطاق:** ترقية قيد `audit_logs_action_check` بإضافة الإجراء `AUTO_CLOSE`، وتطبيع طبقة العرض الإدارية لاستهلاك جميع الأفعال المعتمدة (بما فيها `AUTO_CLOSE` و `REOPEN`).
> **الفرع:** `main`
> **الجلسة السابقة:** المرحلة 6 — توحيد مصدر بيانات اليومية والمعلومية اليومية (`PHASE_6_DAILY_VIEW_UNIFIED.md`).

---

## 1. الهدف

ربط الإقفال التلقائي للفترات (الذي أُضيف في المرحلتين 3-4) ربطاً كاملاً مع **سجل التدقيق** (`audit_logs`)، بحيث:

1. تُقبل قيمة `AUTO_CLOSE` على مستوى قاعدة البيانات (CHECK constraint).
2. تُكتب كل عملية إقفال تلقائي كسجل تدقيق مستقل قابل للتدقيق لاحقاً.
3. تُعرض هذه السجلات في **شاشة سجل التدقيق الإدارية** بشكل مترجَم، مع تمييز بصري عن الإقفال البشري.
4. تُتاح الفلترة على نوع العملية `AUTO_CLOSE` (إلى جانب باقي الأنواع المنصوص عليها في CHECK constraint).

## 2. حالة المرحلة عند بداية الجلسة

| البند | الحالة قبل المرحلة 7 |
|---|---|
| `database/migrations/017_audit_log_auto_close_action.sql` | ✅ موجود في المستودع (commit `fb10fc1`) ومطبَّق على قاعدة بيانات Render. |
| `AccountingModel::autoCloseShift()` يكتب action='AUTO_CLOSE' عبر `AuditService` | ✅ موجود ويعمل. |
| `ADMIN_ENUM_LABELS['audit_logs.action'].AUTO_CLOSE = 'إقفال تلقائي'` | ✅ موجود (مضاف ضمن المرحلة 5). |
| شاشة `viewAuditLog` تترجم `AUTO_CLOSE` وتلوّنه | ❌ خريطة `actionLabel/actionBadge` المحلية كانت تغطي 6 أفعال فقط — كانت `AUTO_CLOSE` تظهر كنص خام `AUTO_CLOSE` دون ترجمة وبلون رمادي عام. |
| Dropdown فلتر "نوع العملية" يحتوي `AUTO_CLOSE` | ❌ كان يحتوي 5 خيارات فقط (CREATE/UPDATE/DELETE/CANCEL/EXPORT). |
| سجلات `AUTO_CLOSE` فعلية في قاعدة البيانات | ✅ سجل واحد على الأقل (`record_id=7` بتاريخ 2026-06-06) — أي أن الـ pipeline يعمل end-to-end. |

> النتيجة: العمل الخلفي (DB + Backend) كان مكتملاً، لكن **طبقة العرض الإدارية** كانت لا تعكس ذلك للمستخدم النهائي. هذا ما أكملته المرحلة 7.

## 3. ما الذي تغيّر بالضبط في هذه الجلسة

### 3.1 Frontend — `public/assets/js/modules/admin.js`

#### (أ) تطبيع خرائط `actionBadge` و `actionLabel` في `viewAuditLog`

- استُبدلت الخريطتان المحليتان (المحدودتان بـ 6 أفعال) بمصدر موحَّد:
  - **اللون:** خريطة `actionBadge` موسَّعة لتغطية كل الأفعال الـ12 المعتمدة في CHECK constraint (`CREATE / UPDATE / DELETE / LOGIN / LOGOUT / CANCEL / EXPORT / IMPORT / VIEW / REOPEN / AUTO_CLOSE / OTHER`).
  - **التسمية:** تُقرأ مباشرة من `ADMIN_ENUM_LABELS['audit_logs.action']` (المصدر الواحد للحقيقة) — أي تعديل لاحق على هذه الخريطة سينعكس على كامل شاشة سجل التدقيق دون الحاجة لتعديل HTML.

#### (ب) تمييز بصري لسجلات `AUTO_CLOSE`

- أيقونة 🤖 (`bi-robot`) قبل النص داخل الـ badge لتمييز الإقفال الآلي.
- شارة فرعية صغيرة (**نظام**) بجانب اسم المستخدم (`__system__`) لتأكيد أن الفاعل ليس بشرياً.
- لون "warning" المُتدرج (نفس لون `REOPEN`) للتأكيد على أنها عملية تلقائية تستحق المراجعة وليست عملية روتينية.

#### (ج) Dropdown فلتر العملية أصبح ديناميكياً

- بدلاً من قائمة `<option>` ثابتة (5 خيارات فقط)، يُبنى الـ dropdown الآن من `ADMIN_ENUM_LABELS['audit_logs.action']` بـ `Object.entries(...).map(...)`.
- يُحافظ على الخيار المُختار سابقاً (`AdminData._auditFilters.action`) كـ `selected` بعد إعادة الرسم.
- النتيجة: 12 خيار مرتَّبين بنفس ترتيب الخريطة (تطابق ترتيب CHECK constraint).

### 3.2 لا تغييرات على Backend / قاعدة البيانات

- `database/migrations/017_audit_log_auto_close_action.sql` كما هو (سبق تطبيقه).
- `AdminModel::getAuditLogs()` بالفعل يدعم فلتر `action` بشكل عام دون قيود — أي قيمة من `ADMIN_ENUM_LABELS` تعمل تلقائياً.
- `AuditService::log()` و `AccountingModel::logAuditAction()` كما هما.

### 3.3 توثيق

- إضافة هذا الملف: `docs/changelogs/PHASE_7_AUDIT_LOG_AUTO_CLOSE.md`.

## 4. التحقق

### 4.1 على قاعدة البيانات (Render)

```sql
-- قيد CHECK يتضمن AUTO_CLOSE
SELECT pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid = 'audit_logs'::regclass AND conname = 'audit_logs_action_check';
-- ⇒ ... ARRAY['CREATE',...,'REOPEN','AUTO_CLOSE','OTHER'] ✅

-- إدراج تجريبي مباشر
INSERT INTO audit_logs (user_id, username, action, table_name, record_id, new_values)
VALUES (NULL, '__phase7_smoketest__', 'AUTO_CLOSE', 'shifts', '0', '{}'::jsonb);
-- ⇒ INSERT 0 1 ✅
```

### 4.2 سجل فعلي قائم

```text
log_id=104 | username=__system__ | action=AUTO_CLOSE | table=shifts | record_id=7 | 2026-06-06 13:07:37
```

→ يثبت أن `AccountingModel::autoCloseShift()` يكتب السجل بنجاح في الإنتاج.

### 4.3 على الواجهة (Frontend syntax)

```bash
node -c public/assets/js/modules/admin.js   # → OK
```

### 4.4 سيناريو يدوي مقترح (UI)

1. الدخول كـ admin → "سجل التدقيق".
2. مشاهدة السجل `#104` يظهر بـ:
   - Badge أصفر (warning) فيه أيقونة 🤖 ثم نص **"إقفال تلقائي"**.
   - اسم المستخدم `__system__` مع شارة فرعية **"نظام"**.
3. فتح Dropdown "نوع العملية" → يجب أن يحتوي 12 خياراً مرتَّبة (الكل / إنشاء / تحديث / حذف / دخول / خروج / إلغاء / تصدير / استيراد / عرض / إعادة فتح / إقفال تلقائي / أخرى).
4. اختيار "إقفال تلقائي" → تطبيق → ظهور السجلات الآلية فقط.

## 5. التوافق الخلفي

- لا تغيير في أي مسار API ولا في أي عمود قاعدة بيانات.
- لا تأثير على سجلات `AUTO_CLOSE` القائمة (السجل `#104` يُعرض الآن مترجَماً بدلاً من النص الخام).
- لا حاجة لأي migration جديدة.

## 6. ما الذي لم يُنفَّذ في هذه الجلسة

- **المرحلة 8:** اختبارات تكاملية + تحديث `README.md` بفصل عن نظام الفترات الجديد + جمع الـ changelogs في فهرس واحد.

ستُنفَّذ المرحلة 8 في جلسة لاحقة كما اتفقنا.

---

**المراجع:**
- `docs/SHIFTS_REFACTOR_PLAN.md` §9 (Audit Log) و §10 (خارطة الطريق — الموجة 7).
- `database/migrations/017_audit_log_auto_close_action.sql`.
- `src/Models/AccountingModel.php::autoCloseShift()` (سطور ~1199-1275).
- `public/assets/js/modules/admin.js::viewAuditLog()` (سطور ~1810-1900).
