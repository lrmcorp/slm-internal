FROM php:8.2-cli-alpine

RUN apk add --no-cache \
    sqlite-dev \
    libpng-dev \
    libzip-dev \
    zip \
    unzip \
    git \
    curl-dev \
    icu-dev \
    oniguruma-dev \
    bash

RUN docker-php-ext-install pdo pdo_sqlite pcntl bcmath zip opcache

# Batas memori PHP dan opcache (lihat docker/php.ini).
ENV PHP_MEMORY_LIMIT=128M \
    PHP_CLI_SERVER_WORKERS=4
COPY docker/php.ini /usr/local/etc/php/conf.d/zz-cctv.ini

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /app

COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist --no-progress

COPY . ./
RUN rm -f bootstrap/cache/*.php && composer dump-autoload --optimize --no-dev

RUN mkdir -p /app/database /app/storage /app/bootstrap/cache && \
    chmod -R 777 /app/database /app/storage /app/bootstrap/cache && \
    chmod +x /app/docker-entrypoint.sh /app/docker/worker.sh

ENTRYPOINT ["/app/docker-entrypoint.sh"]

EXPOSE 8000

CMD ["php", "artisan", "serve", "--host=0.0.0.0", "--port=8000", "--no-reload"]
