<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Jaga area terlarang per kamera: jadwal (hari dan jam WIB), kalimat peringatan, dan speaker kamera.
 * Bawaan mengikuti permintaan pemilik: Senin–Sabtu, 12.00–15.00.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cameras', function (Blueprint $table) {
            $table->boolean('guard_enabled')->default(false);
            $table->json('guard_days')->nullable();
            $table->string('guard_start', 5)->default('12:00');
            $table->string('guard_end', 5)->default('15:00');
            $table->text('guard_message')->nullable();
            $table->unsignedInteger('guard_cooldown_seconds')->default(60);
            $table->boolean('speaker_enabled')->default(false);
            $table->unsignedSmallInteger('speaker_channel')->default(1);
        });
    }

    public function down(): void
    {
        Schema::table('cameras', function (Blueprint $table) {
            $table->dropColumn(['guard_enabled', 'guard_days', 'guard_start', 'guard_end', 'guard_message',
                'guard_cooldown_seconds', 'speaker_enabled', 'speaker_channel']);
        });
    }
};
