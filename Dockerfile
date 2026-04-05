FROM php:8.2-apache

RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq-dev default-mysql-client \
    && docker-php-ext-install pdo pdo_mysql pgsql pdo_pgsql \
    && a2enmod rewrite \
    && sed -ri 's/AllowOverride None/AllowOverride All/g' /etc/apache2/apache2.conf \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /var/www/html
COPY . /var/www/html/

EXPOSE 80
