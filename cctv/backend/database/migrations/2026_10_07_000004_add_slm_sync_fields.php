<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('labels', function (Blueprint $table) {
            $table->string('slm_sync_status')->default('not_ready');
            $table->timestamp('slm_synced_at')->nullable();
            $table->text('slm_sync_error')->nullable();
            $table->string('slm_synced_hash', 64)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('labels', function (Blueprint $table) {
            $table->dropColumn(['slm_sync_status', 'slm_synced_at', 'slm_sync_error', 'slm_synced_hash']);
        });
    }
};
