# نظام مركز الطوارئ - جاهز للنشر على Render

تجهيز Production لهذا المشروع تم تحديثه بحيث يعمل على **Render.com** مع **PostgreSQL** وطبقة **WebSocket** عبر نفس الدومين باستخدام Apache reverse proxy.

## أهم التعديلات
- تحويل طبقة الاتصال لتعمل افتراضياً مع **PostgreSQL** باستخدام **PDO pgsql**.
- دعم متغيرات البيئة المطلوبة: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` بالإضافة إلى `DATABASE_URL`.
- تحميل ملف `.env` محلياً بدون الاعتماد على قيم صلبة داخل الكود.
- تعديل عمليات الإدراج في `DoctorModel` لتستخدم `RETURNING` في PostgreSQL بدلاً من الاعتماد على سلوك MySQL.
- إضافة `Dockerfile` جاهز لـ Render مع الامتدادات: `pdo_pgsql`, `pgsql`, `sockets`.
- إضافة `render.yaml` لإنشاء **Web Service** و **PostgreSQL database** تلقائياً.
- إضافة WebSocket bridge على المسار `/ws` عبر Apache بحيث يتصل المتصفح على نفس الدومين باستخدام `wss://` في الإنتاج و`ws://` محلياً.
- إنشاء ملف `.htaccess` في الجذر وتحسين إعدادات Apache والتوجيه.
- إضافة ملف `database/schema.pgsql.sql` لتهيئة PostgreSQL بصيغة متوافقة مع Render.

## متطلبات التشغيل
- PHP 8.2+
- PostgreSQL 14+
- Apache
- Docker (اختياري ولكن موصى به)

## ملف البيئة `.env`
انسخ ملف المثال:

```bash
cp .env.example .env
```

ثم عدّل القيم:

```env
APP_ENV=local
APP_DEBUG=false
APP_TIMEZONE=UTC
APP_URL=http://localhost:8080

DB_CONNECTION=pgsql
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=emergency_centre
DB_USER=postgres
DB_PASSWORD=postgres

JWT_SECRET=change-this-secret-before-production
WEBSOCKET_PATH=ws
WEBSOCKET_INTERNAL_PORT=8081
```

> في Render يفضل الاعتماد على `DATABASE_URL` لأن المنصة توفره تلقائياً من قاعدة البيانات المُدارة.

## تشغيل محلي عبر Docker
```bash
docker build -t emergency-centre .
docker run --rm -p 8080:10000 \
  -e PORT=10000 \
  -e DB_CONNECTION=pgsql \
  -e DB_HOST=host.docker.internal \
  -e DB_PORT=5432 \
  -e DB_NAME=emergency_centre \
  -e DB_USER=postgres \
  -e DB_PASSWORD=postgres \
  -e JWT_SECRET=change-this-secret-before-production \
  emergency-centre
```

بعد التشغيل:
- الواجهة: `http://localhost:8080/login.html`
- الـ API: `http://localhost:8080/api/...`
- WebSocket: `ws://localhost:8080/ws`

## النشر على Render
### 1) ربط المستودع
اربط المستودع مع Render واختر ملف `render.yaml` من الجذر.

### 2) إنشاء قاعدة البيانات
الـ Blueprint سينشئ قاعدة PostgreSQL باسم:
- `emergency-centre-db`

### 3) تهيئة الجداول
بعد إنشاء قاعدة البيانات شغّل محتوى الملف التالي داخل PostgreSQL:

```text
database/schema.pgsql.sql
```

### 4) WebSockets على Render
الربط تم تصميمه ليعمل من خلال نفس الدومين:
- الواجهة تتصل بـ `wss://<your-render-domain>/ws` في الإنتاج
- وتتصل بـ `ws://localhost/...` محلياً
- Apache يقوم بتمرير `/ws` إلى خادم WebSocket الداخلي داخل نفس الحاوية

## ملاحظات مهمة
- الملف `websocket-server.php` يربط السيرفر على `0.0.0.0` ويقرأ المنفذ من متغير البيئة `PORT`.
- داخل الحاوية يتم تشغيله على منفذ داخلي مستقل عبر `WEBSOCKET_INTERNAL_PORT` ثم يمر من Apache إلى `/ws`.
- جميع `require/include` الحساسة للمسار تعتمد على `__DIR__` أو `BASE_PATH`.
- تم التخلص من أي اعتماد إنتاجي على MySQL كخيار افتراضي.

## الجداول المتوقعة
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

## ملاحظات أمان
- غيّر قيمة `JWT_SECRET` في الإنتاج.
- لا تقم برفع `.env` إلى المستودع.
- فعّل HTTPS فقط في بيئة الإنتاج.
- لأن Render يوجه WebSocket عبر TLS، يجب استخدام `wss://` خارج localhost.
