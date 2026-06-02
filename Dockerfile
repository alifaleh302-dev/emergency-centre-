FROM php:8.2-apache

# ──────────────────────────────────────────────────────────────────────────
# تثبيت امتدادات PHP المطلوبة وتفعيل mod_rewrite
# ──────────────────────────────────────────────────────────────────────────
RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq-dev default-mysql-client \
    && docker-php-ext-install pdo pdo_mysql pgsql pdo_pgsql \
    && a2enmod rewrite headers \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# ──────────────────────────────────────────────────────────────────────────
# نقل DocumentRoot من /var/www/html إلى /var/www/html/public
# هذا يجعل مجلدات src/ و database/ و docs/ غير قابلة للوصول عبر الويب
# ──────────────────────────────────────────────────────────────────────────
ENV APACHE_DOCUMENT_ROOT=/var/www/html/public
RUN sed -ri "s!/var/www/html!\${APACHE_DOCUMENT_ROOT}!g" \
        /etc/apache2/sites-available/*.conf \
        /etc/apache2/apache2.conf \
        /etc/apache2/conf-available/*.conf \
    && sed -ri 's/AllowOverride None/AllowOverride All/g' /etc/apache2/apache2.conf

WORKDIR /var/www/html
COPY . /var/www/html/

# ضبط الصلاحيات
RUN chown -R www-data:www-data /var/www/html

EXPOSE 80
