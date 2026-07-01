<div dir="rtl" align="right">

# 🏥 نظام إدارة مركز الطوارئ الطبي

> منصة تشغيلية متكاملة لإدارة دورة العمل داخل مراكز الطوارئ الطبية — من استقبال المريض حتى الإقفال المالي اليومي.

<p align="center">
  <img alt="PHP" src="https://img.shields.io/badge/PHP-8.1%2B-777BB4?style=for-the-badge&logo=php&logoColor=white">
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-14%2B-336791?style=for-the-badge&logo=postgresql&logoColor=white">
  <img alt="MySQL" src="https://img.shields.io/badge/MySQL-8%2B-4479A1?style=for-the-badge&logo=mysql&logoColor=white">
  <img alt="Apache" src="https://img.shields.io/badge/Apache-2.4-D22128?style=for-the-badge&logo=apache&logoColor=white">
  <img alt="Docker" src="https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white">
  <img alt="Architecture" src="https://img.shields.io/badge/Architecture-MVC-2ECC71?style=for-the-badge">
  <img alt="License" src="https://img.shields.io/badge/License-Private-lightgrey?style=for-the-badge">
</p>

---

## 📖 نبذة عن المشروع

**نظام إدارة مركز الطوارئ** هو تطبيق ويب مؤسسي مصمَّم لتشغيل مراكز الطوارئ الطبية بكفاءة، مع فصل واضح بين الأدوار التشغيلية والمالية والإدارية. يعالج النظام دورة العمل الكاملة داخل المركز:

**تسجيل المريض ← فتح الزيارة ← التشخيص والطلبات الطبية ← الفوترة ← التحصيل ← إقفال الفترة ← التقارير**

بُني المشروع بلغة **PHP** وفق نمط **MVC**، مع واجهة أمامية خفيفة الوزن قائمة على **HTML + Bootstrap 5 + JavaScript** بدون أي إطار عمل ثقيل، وطبقة **API موحّدة** تخدم كل الشاشات بحسب صلاحيات المستخدم، مدعومة بـ **JWT** لتأمين الجلسات، و**PostgreSQL** كقاعدة بيانات أساسية مع دعم كامل لـ **MySQL**.

---

## 🎯 لماذا هذا النظام؟

| الميزة | القيمة التشغيلية |
|---|---|
| 🩺 **تكامل طبي–مالي** | ربط مباشر بين الزيارة الطبية والفاتورة والتحصيل |
| 🕒 **إدارة فترات ذكية** | فترات صباحية/مسائية مع إقفال يدوي وتلقائي |
| 🔐 **صلاحيات دقيقة** | فصل واضح بين الطبيب، أمين الصندوق، المدير، والمركز المالي |
| 📊 **تقارير فورية** | يوميّة، خزينة، إيرادات، أداء أطباء، حصة الوزارة |
| 🛡️ **حوكمة كاملة** | سجل تدقيق (Audit Log) لكل الحركات الحساسة |
| ⚡ **إشعارات لحظية** | تكامل اختياري مع Pusher لتحديثات فورية |
| 🐳 **جاهز للنشر** | Docker + دعم كامل لـ `DATABASE_URL` لمنصات مثل Render |

---

## 👥 الأدوار التشغيلية

<div dir="rtl">

يقدّم النظام تجربة مخصّصة لكل دور، مع تحميل ديناميكي لوحدة الواجهة المناسبة عند تسجيل الدخول:

| الدور | المهام الأساسية |
|---|---|
| 👨‍⚕️ **الطبيب العام** | البحث عن المرضى، فتح زيارة جديدة، إرسال الطلبات الطبية، التشخيص النهائي، الأرشيف الطبي |
| 💰 **أمين الصندوق** | متابعة الفواتير المعلّقة، السداد، اليومية، الخزينة، أرقام السندات، إقفال الفترات |
| 🛠️ **مدير النظام** | لوحة إدارة شاملة، إعدادات النظام، إدارة الجداول المرجعية، التقارير، سجل التدقيق، إعادة الفتح الإدارية |
| 📈 **المركز المالي** | واجهة موحّدة (مشتركة بين المحاسب والمدير) لمراجعة الحركات المالية، المؤشرات، الصادرات، وسندات الطباعة |

</div>

---

## ✨ أهم الوظائف

### 🏥 إدارة المرضى والزيارات
- إنشاء ملفات المرضى الجدد والبحث بين الحاليين.
- فتح زيارة جديدة لمريض جديد أو مريض موجود.
- منع تضارب الزيارات النشطة لنفس المريض.
- قائمة انتظار مرتبطة بكل طبيب.

### 🩺 سير العمل الطبي
- تسجيل التشخيص الأولي والنهائي.
- إرسال طلبات الخدمات الطبية والفحوصات المختبرية.
- إنشاء وثائق مختبر مرتبطة بالخدمات المرسلة.
- استعراض الأرشيف الطبي وملفات المرضى.

### 💵 الفوترة والتحصيل
- إنشاء فواتير مرتبطة بالزيارة والخدمات تلقائيًا.
- تفصيل الفواتير حسب القسم (Invoice per Department).
- سداد الفواتير مع التحقق الرياضي من المبلغ والإعفاءات (باستخدام Epsilon).
- إدارة أرقام السندات وتسلسلها المالي.
- عرض الخزينة والتفاصيل اليومية بشكل تفاعلي.

### 🕒 إدارة الفترات المالية (Shifts System)
- دعم الفترات **الصباحية** و**المسائية** لكل يوم.
- تخصيص حدود اليوم المالي عبر قرص ساعة تفاعلي.
- إقفال الفترة يدويًا مع التحقق من عدم وجود فواتير معلّقة.
- إعادة فتح الفترة ضمن نافذة زمنية آمنة.
- **إقفال تلقائي (Auto-close)** عبر Lazy Hook للفترات والزيارات المنتهية.
- ثلاثة أوضاع لليوم: `both` (فترتان)، `morning_only`، `evening_only`.

### 📊 التقارير والمتابعة
- تقرير اليومية الموحّد للتشغيل والتحصيل.
- تقارير الإيرادات (سنوي / شهري / يومي).
- تقارير أداء الأطباء.
- تقارير الحركات المالية وتوزيع الخدمات.
- تقرير حصة الوزارة (Ministry Share).
- طباعة السندات المالية.

### 🎛️ الإدارة والحوكمة
- تسجيل دخول آمن بصلاحيات مبنيّة على الدور (RBAC).
- CRUD عام مرن لكل الجداول المرجعية عبر لوحة الإدارة.
- إعدادات النظام العامة وإعدادات ترويسة الطباعة.
- **سجل تدقيق شامل** لكل الحركات الإدارية والمالية.
- بث إشعارات إدارية للموظفين.

---

## 🏗️ المعمارية التقنية

<div dir="rtl">

```
┌──────────────────────────────────────────────────────────────┐
│                    Web Browser (RTL UI)                       │
│         HTML + Bootstrap 5 + Vanilla JavaScript              │
└──────────────────────────┬───────────────────────────────────┘
                           │  HTTPS + JWT
                           ▼
┌──────────────────────────────────────────────────────────────┐
│              Apache 2.4  (DocumentRoot = public/)            │
│                             │                                │
│                             ▼                                │
│                 public/api/index.php  (API Router)           │
│  ┌────────────┬─────────────┬────────────┬────────────────┐ │
│  │   Auth     │   Doctor    │ Accounting │  Admin/Finance │ │
│  └─────┬──────┴──────┬──────┴─────┬──────┴────────┬───────┘ │
│        │             │            │               │         │
│        ▼             ▼            ▼               ▼         │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           Controllers → Models → PDO Layer           │   │
│  │      Utils: JWT · AuthMiddleware · ShiftService      │   │
│  │             AuditService · PusherService             │   │
│  └────────────────────────┬─────────────────────────────┘   │
└───────────────────────────┼──────────────────────────────────┘
                            ▼
              ┌──────────────────────────┐
              │  PostgreSQL 14+  /  MySQL 8+  │
              └──────────────────────────┘
                            │
                            ▼
              ┌──────────────────────────┐
              │  Pusher (Realtime, اختياري)  │
              └──────────────────────────┘
```

</div>

### المكوّنات الأساسية

| الوحدة | المسؤولية |
|---|---|
| `AuthController` | تسجيل الدخول، إصدار JWT، تجهيز الجلسة، معالجة إعادة التجزئة |
| `DoctorController` | المرضى، الزيارات، الطلبات، التشخيص، الأرشيف الطبي |
| `AccountingController` | الفواتير، السداد، اليومية، الخزينة، إقفال/إعادة فتح الفترات |
| `AdminController` | الإعدادات، لوحة التحكم، CRUD مرجعي، التقارير، التدقيق |
| `FinanceController` | المركز المالي الموحّد، الحركات، الصادرات، سندات الطباعة |
| `ReportsController` | اليومية والمعلومية اليومية (مصدر بيانات موحّد) |
| `ShiftService` | منطق الفترات، حدود اليوم، الإقفال التلقائي |
| `AuditService` | تسجيل الحركات الحساسة في `audit_logs` |
| `PusherService` | إعدادات ومصادقة القنوات اللحظية |
| `JWT` | إصدار وتحقق التوكن يدويًا (بدون تبعيات خارجية) |
| `AuthMiddleware` | تحقق الصلاحيات على مستوى كل Endpoint |

---

## 📁 هيكل المشروع

```
emergency-centre/
├── public/                          ← DocumentRoot (المكشوف للويب فقط)
│   ├── index.html                   ← لوحة التحكم الرئيسية
│   ├── login.html                   ← صفحة تسجيل الدخول
│   ├── .htaccess                    ← رؤوس أمنية + Rewrite
│   ├── api/
│   │   ├── index.php                ← نقطة الدخول الوحيدة للـ API
│   │   └── .htaccess
│   └── assets/
│       └── js/
│           ├── core/main.js         ← النواة المشتركة (Core)
│           └── modules/
│               ├── admin.js
│               ├── accounting.js
│               ├── daily_info.js
│               ├── daily_journal.js
│               ├── doctor.js
│               └── finance.js
│
├── src/                             ← منطق التطبيق (غير مكشوف للويب)
│   ├── Config/
│   │   ├── bootstrap.php            ← تحميل .env + Autoloader + Session
│   │   └── Database.php             ← طبقة الاتصال (PostgreSQL/MySQL)
│   ├── Controllers/                 ← 7 Controllers
│   ├── Models/                      ← 7 Models
│   └── Utils/                       ← JWT · AuthMiddleware · ShiftService ...
│
├── database/
│   ├── migrations/                  ← 25 ملف SQL بترتيب زمني
│   └── tests/                       ← سيناريوهات اختبار Shifts
│
├── docs/
│   ├── SHIFTS_REFACTOR_PLAN.md
│   └── changelogs/                  ← سجلات التغيير التفصيلية
│
├── .env.example
├── .gitignore
├── .dockerignore
├── composer.json
├── Dockerfile                       ← DocumentRoot = /var/www/html/public
└── README.md
```

**لماذا هذا التقسيم؟**
- `public/` هو المسار الوحيد المكشوف عبر HTTP — أي محاولة للوصول إلى `src/` أو `database/` تُرفض تلقائيًا.
- `src/` يفصل منطق الأعمال عن الواجهة العامة.
- `database/migrations/` يحفظ التاريخ التطويري لقاعدة البيانات بشكل قابل للتتبع.

---

## ⚙️ المتطلبات

| المتطلب | الإصدار |
|---|---|
| PHP | **8.1+** |
| PostgreSQL | **14+** (مفضّل) |
| MySQL | **8+** (بديل مدعوم) |
| Apache | **2.4+** مع `mod_rewrite` و `mod_headers` |
| Docker | اختياري لكن مُوصى به |

**امتدادات PHP المطلوبة:** `pdo`, `pdo_pgsql`, `pdo_mysql`

---

## 🚀 دليل التشغيل السريع

### 1️⃣ استنساخ المشروع

```bash
git clone https://github.com/alifaleh302-dev/emergency-centre-.git
cd emergency-centre-
```

### 2️⃣ إعداد متغيرات البيئة

```bash
cp .env.example .env
```

عدّل القيم الأساسية:

```env
APP_ENV=production
APP_DEBUG=false
APP_TIMEZONE=Asia/Aden
APP_CORS_ORIGIN=*

DB_CONNECTION=pgsql
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=emergency_centre
DB_USER=postgres
DB_PASSWORD=your_secure_password

# البديل الموصى به لبيئات النشر السحابي
DATABASE_URL=

JWT_SECRET=غيّر-هذا-المفتاح-قبل-الإنتاج-بمفتاح-قوي

# إعدادات Pusher (اختيارية)
REALTIME_DRIVER=
PUSHER_APP_ID=
PUSHER_APP_KEY=
PUSHER_APP_SECRET=
PUSHER_APP_CLUSTER=mt1
```

### 3️⃣ تهيئة قاعدة البيانات

نفّذ ملفات الترحيل بالتسلسل:

```bash
for file in database/migrations/*.sql; do
  echo "▶ Running $file"
  psql "$DATABASE_URL" -f "$file"
done
```

### 4️⃣ التشغيل عبر Docker (موصى به)

```bash
docker build -t emergency-centre .

docker run --rm -p 8080:80 \
  -e DB_CONNECTION=pgsql \
  -e DB_HOST=host.docker.internal \
  -e DB_PORT=5432 \
  -e DB_NAME=emergency_centre \
  -e DB_USER=postgres \
  -e DB_PASSWORD=your_password \
  -e JWT_SECRET=your-production-secret \
  -e APP_TIMEZONE=Asia/Aden \
  emergency-centre
```

بعد التشغيل:

| العنوان | الرابط |
|---|---|
| صفحة الدخول | `http://localhost:8080/login.html` |
| لوحة التحكم | `http://localhost:8080/index.html` |
| نقطة الـ API | `http://localhost:8080/api/...` |

### 5️⃣ التشغيل عبر Apache محليًا

- اجعل `DocumentRoot` يشير إلى مجلد `public/`.
- فعّل `mod_rewrite` و `mod_headers`.
- تأكد من `AllowOverride All` للمجلد.
- اضبط متغيرات البيئة أو ملف `.env`.

---

## 🔌 مرجع الـ API

جميع المسارات تحت البادئة `/api/` وتتطلب توكن JWT (باستثناء `auth/login`).

### 🔐 المصادقة
| Method | Endpoint | الوصف |
|---|---|---|
| `POST` | `/api/auth/login` | تسجيل الدخول وإصدار JWT |
| `GET`  | `/api/auth/me` | بيانات المستخدم الحالي |

### 👨‍⚕️ الطبيب
| Method | Endpoint | الوصف |
|---|---|---|
| `POST` | `/api/doctor/search_patient` | البحث عن مريض |
| `POST` | `/api/doctor/new_patient` | إنشاء مريض جديد وفتح زيارة |
| `POST` | `/api/doctor/existing_patient_visit` | فتح زيارة لمريض موجود |
| `GET`  | `/api/doctor/waiting_list` | قائمة انتظار الطبيب |
| `POST` | `/api/doctor/send_orders` | إرسال طلبات الخدمات |
| `POST` | `/api/doctor/final_diagnosis` | تسجيل التشخيص النهائي |
| `POST` | `/api/doctor/visit_close_data` | بيانات إغلاق الزيارة |
| `GET`  | `/api/doctor/sent_orders` | الطلبات المرسلة |
| `GET`  | `/api/doctor/services_list` | قائمة الخدمات المتاحة |
| `GET`  | `/api/doctor/case_types` | أنواع الحالات الطارئة |
| `GET`  | `/api/doctor/medical_archive` | الأرشيف الطبي |

### 💰 المحاسبة
| Method | Endpoint | الوصف |
|---|---|---|
| `GET`  | `/api/accounting/pending` | الفواتير المعلّقة |
| `GET`  | `/api/accounting/next_serials` | أرقام السندات التالية |
| `POST` | `/api/accounting/pay_invoice` | سداد فاتورة |
| `GET`  | `/api/accounting/daily_treasury` | الخزينة اليومية |
| `POST` | `/api/accounting/revenues_drilldown` | تفاصيل الإيرادات |
| `GET`  | `/api/accounting/daily_journal` | اليومية |
| `GET`  | `/api/accounting/invoice_services` | تفاصيل خدمات الفاتورة |
| `POST` | `/api/accounting/close_shift` | إقفال الفترة |
| `POST` | `/api/accounting/reopen_shift` | إعادة فتح الفترة |
| `GET`  | `/api/accounting/previous_shift_check` | فحص الفترة السابقة |

### 🛠️ الإدارة
| Method | Endpoint | الوصف |
|---|---|---|
| `GET`  | `/api/admin/dashboard` | لوحة الإحصائيات |
| `GET`  | `/api/admin/dashboard_charts` | مخططات اللوحة |
| `GET`  | `/api/admin/schema` | مخطط قاعدة البيانات |
| `GET`  | `/api/admin/settings` | إعدادات النظام |
| `POST` | `/api/admin/settings/save` | حفظ الإعدادات |
| `GET`  | `/api/admin/shifts/day` | حدود فترات اليوم |
| `POST` | `/api/admin/shifts/save_boundaries` | حفظ حدود الفترات |
| `POST` | `/api/admin/list` | سرد سجلات جدول |
| `POST` | `/api/admin/record` | جلب سجل واحد |
| `POST` | `/api/admin/save` | حفظ/تحديث سجل |
| `POST` | `/api/admin/delete` | حذف سجل |
| `POST` | `/api/admin/export` | تصدير البيانات |
| `POST` | `/api/admin/change_password` | تغيير كلمة مرور مستخدم |
| `POST` | `/api/admin/toggle_user` | تفعيل/تعطيل مستخدم |
| `POST` | `/api/admin/cancel_invoice` | إلغاء فاتورة |
| `POST` | `/api/admin/cancel_visit` | إلغاء زيارة |
| `POST` | `/api/admin/reopen_shift` | إعادة فتح فترة (إدارية) |
| `POST` | `/api/admin/broadcast` | بث إشعار |
| `POST` | `/api/admin/audit_log` | استعراض سجل التدقيق |
| `POST` | `/api/admin/reports/revenue` | تقرير الإيرادات |
| `POST` | `/api/admin/reports/doctors` | تقرير أداء الأطباء |
| `POST` | `/api/admin/pay_invoice_override` | سداد إداري تجاوزي |

### 📈 المركز المالي
| Method | Endpoint | الوصف |
|---|---|---|
| `POST` | `/api/finance/overview` | مؤشرات وملخّص |
| `POST` | `/api/finance/transactions` | قائمة الحركات |
| `POST` | `/api/finance/transaction_detail` | تفاصيل حركة |
| `POST` | `/api/finance/export` | تصدير الحركات |
| `GET`  | `/api/finance/filter_options` | خيارات الفلترة |
| `POST` | `/api/finance/ministry_report` | تقرير حصة الوزارة |
| `POST` | `/api/finance/print_voucher` | سند طباعة |

### 📊 التقارير والخدمات المساندة
| Method | Endpoint | الوصف |
|---|---|---|
| `GET`  | `/api/reports/daily_info` | معلومية يومية |
| `GET`  | `/api/reports/daily_view` | العرض اليومي الموحّد |
| `GET`  | `/api/notifications/unread` | الإشعارات غير المقروءة |
| `POST` | `/api/notifications/read` | تعليم الإشعارات كمقروءة |
| `GET`  | `/api/settings/header` | إعدادات ترويسة الطباعة |
| `GET`  | `/api/realtime/config` | إعدادات Realtime للعميل |
| `POST` | `/api/realtime/pusher/auth` | مصادقة قنوات Pusher الخاصة |

---

## 🗄️ نموذج البيانات

يشمل النظام الكيانات التشغيلية والمالية الرئيسية التالية (يتم إنشاؤها عبر ملفات الترحيل):

| المجال | الجداول |
|---|---|
| **المستخدمون والصلاحيات** | `users`, `roles` |
| **المرضى والزيارات** | `patients`, `visits`, `emergency_case_types`, `appointments` |
| **الخدمات والأقسام** | `services_master`, `service_categories`, `departments` |
| **الفوترة والمالية** | `invoices`, `invoice_details`, `document_types`, `examination_tickets` |
| **الفترات المالية** | `shifts`, `shifts_closures` |
| **المختبر والنتائج** | `laboratory_documents`, `medical_results` |
| **الحوكمة والتشغيل** | `audit_logs`, `notifications`, `system_settings` |

جميع المفاتيح الأساسية والأجنبية من نوع **INTEGER (SERIAL)** لتحقيق أداء أعلى وتبسيط الإدارة.

---

## 🛡️ الأمان والحوكمة

يلتزم النظام بمجموعة من الضوابط الأمنية على مستوى التطبيق:

- ✅ **مصادقة قوية**: JWT + جلسات PHP مع بصمة User-Agent.
- ✅ **صلاحيات مبنيّة على الدور** عبر `AuthMiddleware` لكل Endpoint.
- ✅ **إعدادات جلسة مشدّدة**: `HttpOnly`, `SameSite=Lax`, `Strict Mode`, وتفعيل `Secure` تلقائيًا على HTTPS.
- ✅ **تحقق شامل من المدخلات** في طبقة `BaseController` (Sanitization لجميع الحقول).
- ✅ **حماية العمليات المالية**: مقارنة المبالغ بـ Epsilon لتجنب أخطاء الفاصلة العائمة.
- ✅ **التحقق من ملكية الزيارات** قبل أي تعديل طبي.
- ✅ **التحقق من HTTP Method** لكل مسار مع إرجاع `405` عند الانتهاك.
- ✅ **رؤوس أمنية** في `.htaccess` (X-Frame-Options, X-Content-Type-Options, ...).
- ✅ **عزل الكود الحساس**: `src/` و `database/` غير قابلة للوصول عبر الويب.
- ✅ **سجل تدقيق (Audit Log)** لكل حركات الإقفال، الإلغاء، الحذف، وإعادة الفتح.
- ✅ **إعادة تجزئة كلمات المرور** تلقائيًا عند تسجيل الدخول (Rehash to BCRYPT).

---

## ✅ قائمة تحقق ما قبل النشر

- [ ] تغيير `JWT_SECRET` إلى قيمة عشوائية قوية.
- [ ] تعطيل `APP_DEBUG` (`APP_DEBUG=false`).
- [ ] تشغيل النظام خلف **HTTPS** حصريًا.
- [ ] تنفيذ جميع ملفات الترحيل في `database/migrations/`.
- [ ] ضبط `APP_CORS_ORIGIN` على النطاق الفعلي بدلاً من `*`.
- [ ] عدم تضمين ملف `.env` في المستودع.
- [ ] التأكد من أن `DocumentRoot` يشير إلى `public/`.
- [ ] تفعيل النسخ الاحتياطية الدورية لقاعدة البيانات.
- [ ] مراجعة إعدادات Pusher إن كانت الإشعارات اللحظية مفعّلة.

---

## 📚 التوثيق الإضافي

مجلد `docs/` يحتوي على وثائق فنية تفصيلية تخص خطط إعادة الهيكلة وسجلات التغيير، وهي مخصّصة أساسًا للمطوّرين ومسؤولي الصيانة، وتشمل:

- `docs/SHIFTS_REFACTOR_PLAN.md` — خطة إعادة هيكلة نظام الفترات.
- `docs/changelogs/` — سجلات التغييرات لكل مرحلة تطويرية.

---

## 🤝 المساهمة

هذا المشروع خاص وتشغيلي بطبيعته. أي مساهمات، ملاحظات، أو تقارير بأخطاء يجب أن تُقدَّم عبر **Issues** داخل المستودع.

---

## 📞 التواصل

للاستفسارات التقنية أو التشغيلية، يُرجى فتح Issue داخل المستودع أو التواصل مع فريق التطوير.

---

<p align="center">
  <strong>🏥 نظام إدارة مركز الطوارئ الطبي</strong><br>
  <sub>مبني بعناية ليخدم الميدان الطبي في أشد لحظاته حساسية</sub>
</p>

</div>
