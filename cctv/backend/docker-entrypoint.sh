#!/bin/bash
set -e

mkdir -p /app/database /app/storage/framework/cache /app/storage/framework/sessions /app/storage/framework/views /app/storage/logs /app/storage/app/private/cctv/live-video /app/bootstrap/cache
touch /app/database/database.sqlite
chmod -R 777 /app/database /app/storage /app/bootstrap/cache

if [ ! -f /app/.env ]; then
    cp /app/.env.example /app/.env 2>/dev/null || true
fi

# Pastikan APP_KEY ada
if ! grep -q "^APP_KEY=base64:" /app/.env 2>/dev/null; then
    php artisan key:generate --force || true
fi

# Jalankan migrasi dan seed kamera hanya sekali pada kontainer web
if [ "$1" = "php" ] && [ "$2" = "artisan" ] && [ "$3" = "serve" ]; then
    echo "==> Menyiapkan basis data CCTV SLM..."
    php artisan migrate --force

    php -r '
    require "vendor/autoload.php";
    $app = require_once "bootstrap/app.php";
    $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
    App\Models\Camera::firstOrCreate(["id" => 1], ["name" => "Camera 14", "location" => "Meja Packing", "stream_env_key" => "CCTV_CAMERA_14_URL"]);
    App\Models\Camera::firstOrCreate(["id" => 2], ["name" => "Camera 13", "location" => "Area Dus & Lorong", "stream_env_key" => "CCTV_CAMERA_13_URL"]);
    App\Models\Camera::firstOrCreate(["id" => 3], ["name" => "Camera 12", "location" => "Pintu / Toko Depan", "stream_env_key" => "CCTV_CAMERA_12_URL"]);
    if (env("CCTV_ADMIN_EMAIL") && strlen((string) env("CCTV_ADMIN_PASSWORD")) >= 12 && !App\Models\User::where("email", env("CCTV_ADMIN_EMAIL"))->exists()) {
        App\Models\User::create([
            "name" => "Administrator Toko",
            "email" => env("CCTV_ADMIN_EMAIL"),
            "password" => bcrypt(env("CCTV_ADMIN_PASSWORD")),
            "is_admin" => true,
        ]);
        echo "Admin awal dibuat: " . env("CCTV_ADMIN_EMAIL") . PHP_EOL;
    }
    ' || true
    echo "==> Backend CCTV SLM siap melayani."
fi

exec "$@"
