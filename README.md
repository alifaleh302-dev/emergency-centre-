# نظام مركز الطوارئ

مشروع PHP بنمط MVC لإدارة دورة عمل مركز الطوارئ، مع واجهات للطبيب والمحاسبة وطبقة API موحدة.

## ماذا تم إصلاحه في هذه النسخة؟
- إعادة تنظيم التحميل التلقائي والـ bootstrap لتثبيت المسارات ومنع مشاكل `require_once`.
- تحسين طبقة الـ API Router داخل `api/index.php` وتقليل التكرار.
- دعم تشغيل المشروع على **MySQL افتراضياً** مع **الاحتفاظ بالتوافق مع PostgreSQL** عبر متغيرات البيئة.
- تأمين المصادقة عبر JWT بشكل أفضل مع دعم ترحيل كلمات المرور القديمة إلى BCRYPT عند تسجيل الدخول.
- تشديد التحقق من المدخلات في الـ Controllers ومنع تمرير قيم مالية غير صحيحة أثناء السداد.
- إصلاح منطق السندات بحيث يدعم الأنواع `A / B / C` بشكل صحيح.
- تفعيل Apache Rewrite بشكل فعلي داخل Docker عبر `AllowOverride All`.

## متطلبات التشغيل
- PHP 8.1 أو أحدث
- Apache أو Docker
- MySQL 8+ (الافتراضي) أو PostgreSQL إذا رغبت في التوافق القديم
- امتدادات PHP:
  - `pdo`
  - `pdo_mysql`
  - `pdo_pgsql`

## إعداد البيئة
انسخ ملف المثال:

```bash
cp .env.example .env
```

ثم اضبط القيم المناسبة في بيئة التشغيل أو في إعدادات الخادم:

```env
APP_ENV=local
APP_DEBUG=false
APP_TIMEZONE=UTC

DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=emergency_center
DB_USERNAME=root
DB_PASSWORD=

JWT_SECRET=change-this-secret-before-production
```

> إذا كنت تستخدم رابط موحد لقاعدة البيانات يمكنك الاعتماد على `DATABASE_URL` بدلاً من القيم المنفصلة.

## التشغيل عبر Docker
```bash
docker build -t emergency-center .
docker run --rm -p 8080:80 \
  -e DB_CONNECTION=mysql \
  -e DB_HOST=host.docker.internal \
  -e DB_PORT=3306 \
  -e DB_DATABASE=emergency_center \
  -e DB_USERNAME=root \
  -e DB_PASSWORD=your_password \
  -e JWT_SECRET=change-this-secret-before-production \
  emergency-center
```

ثم افتح:
- الواجهة: `http://localhost:8080/login.html`
- الـ API: `http://localhost:8080/api/...`

## التشغيل المحلي عبر Apache / XAMPP / Laragon
1. انسخ المشروع داخل مجلد الويب.
2. فعّل `mod_rewrite` في Apache.
3. تأكد أن `AllowOverride All` مفعلة للمجلد.
4. اضبط متغيرات البيئة الخاصة بقاعدة البيانات.
5. افتح `login.html` من المتصفح.

## ملاحظات قاعدة البيانات
هذا المستودع أصبح يعمل افتراضياً مع **MySQL**، لكن ما زال يحتفظ بطبقة توافق مع **PostgreSQL** من خلال `DB_CONNECTION=pgsql` أو `DATABASE_URL` بصيغة PostgreSQL.

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

## نقاط الأمان بعد الإصلاح
- التحقق من المدخلات في معظم نقاط الـ API.
- منع تمرير مبالغ دفع/إعفاء غير متطابقة مع إجمالي الفاتورة.
- تحسين التحقق من JWT واستخدام مقارنة توقيعات آمنة.
- دعم جلسات PHP بإعدادات أكثر أماناً (`HttpOnly`, `SameSite`, `Strict Mode`).
- إعادة تشفير كلمات المرور القديمة غير المشفرة عند أول تسجيل دخول ناجح.

## ملاحظات مهمة قبل النشر
- غيّر قيمة `JWT_SECRET` في بيئة الإنتاج.
- لا تضع بيانات قاعدة البيانات أو الأسرار داخل الملفات البرمجية.
- تأكد من تفعيل HTTPS في الإنتاج.

## مسارات API الرئيسية
### المصادقة
- `POST /api/auth/login`
- `GET /api/auth/me`

### الطبيب
- `POST /api/doctor/search_patient`
- `POST /api/doctor/new_patient`
- `POST /api/doctor/existing_patient_visit`
- `GET /api/doctor/waiting_list`
- `POST /api/doctor/send_orders`
- `POST /api/doctor/final_diagnosis`
- `GET /api/doctor/sent_orders`
- `GET /api/doctor/services_list`
- `GET /api/doctor/medical_archive`

### المحاسبة
- `GET /api/accounting/pending`
- `GET /api/accounting/next_serials`
- `POST /api/accounting/pay_invoice`
- `GET /api/accounting/daily_treasury`
- `POST /api/accounting/revenues_drilldown`
