# نظام مركز الطوارئ

مشروع PHP بنمط MVC لإدارة دورة عمل مركز الطوارئ، مع واجهات للطبيب والمحاسبة وطبقة API موحدة.

---

## 🔄 آخر التحديثات (PostgreSQL / Render Audit)

### ✅ إصلاحات قاعدة البيانات – التحوّل الكامل إلى PostgreSQL
- تحديث `config/database.php`: تغيير الـ driver الافتراضي من `mysql` إلى `pgsql` وإصلاح متغيرات البيئة لتدعم `DB_NAME` / `DB_USER`.
- تحديث `models/DoctorModel.php` و`models/AccountingModel.php`: تغيير القيمة الافتراضية لـ `$driver` إلى `pgsql`.
- إضافة دالة `insertAndGetId()` في `DoctorModel` لدعم `RETURNING` في PostgreSQL بدلاً من `lastInsertId()`.
- دعم `STRING_AGG(... ORDER BY ...)` في استعلامات `DoctorModel` بدلاً من `GROUP_CONCAT`.

### ✅ إصلاح عمود التوقيت في الفواتير (Invoices)
- إضافة عمود `paid_at` لتتبع وقت السداد الفعلي.
- استخدام `COALESCE(paid_at, created_at)` عبر دالة `paymentTimestamp()` الجديدة في `AccountingModel` في جميع استعلامات الخزينة والإيرادات.

### ✅ تحديثات الـ API Router
- تحديث `api/index.php`: دعم التحقق من أسلوب HTTP (method) لكل مسار مع إرجاع خطأ `405 Method Not Allowed` عند الانتهاك.
- تحويل نهج تعريف المسارات من `closure` مباشرة إلى مصفوفة `['methods', 'handler']`.

### ✅ تحديثات الواجهة الأمامية (Frontend)
- `main_core.js`: إضافة `getApiBase()` و`buildApiUrl()` لدعم `window.APP_CONFIG.apiBase`، مما يُمكّن نشر المشروع في مسار غير الجذر.
- `accounting_module.js`: تصحيح تسلسل الإعفاء الكلي ليستخدم مفتاح `'C'` بدلاً من `'B'`، وحذف دالة `processPayment` المكررة.
- `doctor_module.js` + `accounting_module.js`: تغيير `auth/me` من `POST` إلى `GET`.

### ✅ تحسينات أمنية
- `controllers/DoctorController.php`: إضافة تحقق من ملكية الزيارة (`visitBelongsToDoctor`) قبل إرسال الطلبات أو تحديث التشخيص.
- `controllers/AccountingController.php`: استبدال مقارنات القيم الرقمية بـ `epsilon` لتجنب أخطاء الفاصلة العائمة.

### ✅ تحسينات البيئة (`.env` / `bootstrap`)
- تحديث `.env.example` لاستخدام أسماء المتغيرات الجديدة.
- إضافة محمِّل `.env` تلقائي في `config/bootstrap.php` بدون مكتبات خارجية.
- دعم `APP_CORS_ORIGIN` في `api/index.php`.

---

## ماذا تم إصلاحه في النسخ السابقة؟
- إعادة تنظيم التحميل التلقائي والـ bootstrap لتثبيت المسارات ومنع مشاكل `require_once`.
- تحسين طبقة الـ API Router داخل `api/index.php` وتقليل التكرار.
- تأمين المصادقة عبر JWT بشكل أفضل مع دعم ترحيل كلمات المرور القديمة إلى BCRYPT عند تسجيل الدخول.
- تشديد التحقق من المدخلات في الـ Controllers ومنع تمرير قيم مالية غير صحيحة أثناء السداد.
- إصلاح منطق السندات بحيث يدعم الأنواع `A / B / C` بشكل صحيح.
- تفعيل Apache Rewrite بشكل فعلي داخل Docker عبر `AllowOverride All`.

---

## متطلبات التشغيل
- PHP 8.1 أو أحدث
- Apache أو Docker
- **PostgreSQL 14+** (الافتراضي الآن) أو MySQL 8+ (مدعوم عبر `DB_CONNECTION=mysql`)
- امتدادات PHP:
  - `pdo`
  - `pdo_pgsql`
  - `pdo_mysql` (اختياري عند استخدام MySQL)

---

## إعداد البيئة
انسخ ملف المثال:

```bash
cp .env.example .env
```

ثم اضبط القيم المناسبة:

```env
APP_ENV=local
APP_DEBUG=false
APP_TIMEZONE=UTC
APP_CORS_ORIGIN=*

DB_CONNECTION=pgsql
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=emergency_centre
DB_USER=postgres
DB_PASSWORD=postgres

# Preferred on Render:
# DATABASE_URL=postgresql://user:password@host:5432/database
DATABASE_URL=

JWT_SECRET=change-this-secret-before-production
```

> للنشر على **Render** يُنصح باستخدام `DATABASE_URL` مباشرة.

---

## التشغيل عبر Docker (PostgreSQL)

```bash
docker build -t emergency-centre .
docker run --rm -p 8080:80 \
  -e DB_CONNECTION=pgsql \
  -e DB_HOST=host.docker.internal \
  -e DB_PORT=5432 \
  -e DB_NAME=emergency_centre \
  -e DB_USER=postgres \
  -e DB_PASSWORD=your_password \
  -e JWT_SECRET=change-this-secret-before-production \
  emergency-centre
```

ثم افتح:
- الواجهة: `http://localhost:8080/login.html`
- الـ API: `http://localhost:8080/api/...`

---

## التشغيل المحلي عبر Apache / XAMPP / Laragon
1. انسخ المشروع داخل مجلد الويب.
2. فعّل `mod_rewrite` في Apache.
3. تأكد أن `AllowOverride All` مفعلة للمجلد.
4. اضبط متغيرات البيئة الخاصة بقاعدة البيانات.
5. افتح `login.html` من المتصفح.

---

## ملاحظات قاعدة البيانات

المشروع أصبح يعمل افتراضياً مع **PostgreSQL**، مع الاحتفاظ بالتوافق مع **MySQL** عبر `DB_CONNECTION=mysql`.

### عمود `paid_at` (مطلوب)
يجب إضافة العمود إلى جدول `Invoices` في قاعدة بيانات PostgreSQL:

```sql
ALTER TABLE Invoices ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
```

### جدول `Medical_Results` (مطلوب)
يُستخدم لتتبع حالة نتائج الفحوصات والخدمات المرسلة:

```sql
CREATE TABLE IF NOT EXISTS Medical_Results (
    result_id   SERIAL PRIMARY KEY,
    visit_id    INTEGER REFERENCES Visits(visit_id),
    service_id  INTEGER REFERENCES Services_Master(service_id),
    result_text TEXT,
    created_at  TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

### الجداول المتوقعة
- `Users`
- `Roles`
- `Patients`
- `Visits`
- `Invoices`
- `Invoice_Details`
- `Document_Types`
- `Services_Master`
- `Emergency_Case_Types`
- `Service_Categories`
- `Medical_Results`

---

## نقاط الأمان
- التحقق من ملكية الزيارة قبل أي تعديل طبي (تحقق من `doctor_id`).
- التحقق من المدخلات في معظم نقاط الـ API.
- منع تمرير مبالغ دفع/إعفاء غير متطابقة مع إجمالي الفاتورة (باستخدام epsilon).
- تحسين التحقق من JWT واستخدام مقارنة توقيعات آمنة.
- دعم جلسات PHP بإعدادات أكثر أماناً (`HttpOnly`, `SameSite`, `Strict Mode`).
- التحقق من HTTP Method لكل مسار API مع إرجاع `405` عند الانتهاك.

---

## ملاحظات مهمة قبل النشر
- غيّر قيمة `JWT_SECRET` في بيئة الإنتاج.
- لا تضع بيانات قاعدة البيانات أو الأسرار داخل الملفات البرمجية.
- تأكد من تفعيل HTTPS في الإنتاج.
- نفّذ migration لإضافة `paid_at` قبل تشغيل نسخة الإنتاج.

---

## مسارات API الرئيسية

### المصادقة
| الطريقة | المسار |
|---------|--------|
| `POST` | `/api/auth/login` |
| `GET`  | `/api/auth/me` |

### الطبيب
| الطريقة | المسار |
|---------|--------|
| `POST` | `/api/doctor/search_patient` |
| `POST` | `/api/doctor/new_patient` |
| `POST` | `/api/doctor/existing_patient_visit` |
| `GET`  | `/api/doctor/waiting_list` |
| `POST` | `/api/doctor/send_orders` |
| `POST` | `/api/doctor/final_diagnosis` |
| `GET`  | `/api/doctor/sent_orders` |
| `GET`  | `/api/doctor/services_list` |
| `GET`  | `/api/doctor/medical_archive` |

### المحاسبة
| الطريقة | المسار |
|---------|--------|
| `GET`  | `/api/accounting/pending` |
| `GET`  | `/api/accounting/next_serials` |
| `POST` | `/api/accounting/pay_invoice` |
| `GET`  | `/api/accounting/daily_treasury` |
| `POST` | `/api/accounting/revenues_drilldown` |
