#!/bin/sh
set -eu

PUBLIC_PORT="${PORT:-10000}"
WEBSOCKET_INTERNAL_PORT="${WEBSOCKET_INTERNAL_PORT:-8081}"
DOCUMENT_ROOT="${APACHE_DOCUMENT_ROOT:-/var/www/html}"

sed -ri "s/Listen 80/Listen ${PUBLIC_PORT}/g" /etc/apache2/ports.conf
sed -ri "s#<VirtualHost \*:80>#<VirtualHost *:${PUBLIC_PORT}>#g" /etc/apache2/sites-available/000-default.conf

cat > /etc/apache2/conf-available/render-app.conf <<EOF
ServerName localhost

DocumentRoot ${DOCUMENT_ROOT}
<Directory ${DOCUMENT_ROOT}>
    AllowOverride All
    Require all granted
</Directory>

ProxyPreserveHost On
ProxyRequests Off
RequestHeader set X-Forwarded-Proto expr=%{REQUEST_SCHEME}
ProxyPass /ws ws://127.0.0.1:${WEBSOCKET_INTERNAL_PORT}/ws retry=0
ProxyPassReverse /ws ws://127.0.0.1:${WEBSOCKET_INTERNAL_PORT}/ws
EOF

a2enconf render-app >/dev/null

PORT="${WEBSOCKET_INTERNAL_PORT}" php /var/www/html/websocket-server.php > /proc/1/fd/1 2>/proc/1/fd/2 &

exec apache2-foreground
