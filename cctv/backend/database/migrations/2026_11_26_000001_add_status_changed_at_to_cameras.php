<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /** Sejak kapan status kamera (online/offline) berlaku, untuk masa tenggang sebelum dianggap offline. */
    public function up(): void
    {
        Schema::table('cameras', function (Blueprint $table) {
            $table->timestamp('status_changed_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('cameras', function (Blueprint $table) {
            $table->dropColumn('status_changed_at');
        });
    }
};
