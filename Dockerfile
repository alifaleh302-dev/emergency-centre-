# استخدام نسخة PHP مع Apache
FROM php:8.2-apache

# تثبيت الإضافات اللازمة للاتصال بقاعدة بيانات PostgreSQL
RUN apt-get update && apt-get install -y libpq-dev \
    && docker-php-ext-install pgsql pdo_pgsql

# نسخ ملفات مشروعك إلى مجلد السيرفر
COPY . /var/www/html/

# تفعيل مود Rewrite لـ Apache (مهم للمسارات)
RUN a2enmod rewrite

# تحديد المنفذ الذي سيعمل عليه السيرفر
EXPOSE 80
