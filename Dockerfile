FROM php:8.2-apache

RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq-dev \
    && docker-php-ext-install pdo pdo_pgsql pgsql sockets \
    && a2enmod rewrite headers proxy proxy_http proxy_wstunnel \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /var/www/html
COPY . /var/www/html/

RUN chmod +x /var/www/html/docker/render-entrypoint.sh \
    && chown -R www-data:www-data /var/www/html

EXPOSE 10000
ENTRYPOINT ["/var/www/html/docker/render-entrypoint.sh"]
