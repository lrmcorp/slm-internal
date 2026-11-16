<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('cameras', function (Blueprint $table) {
            $table->string('live_path')->nullable();
            $table->timestamp('frame_at')->nullable();
            $table->string('tracking_session', 64)->nullable();
            $table->boolean('presence_alerts_enabled')->default(false);
            $table->unsignedInteger('absence_seconds')->default(300);
            $table->boolean('detector_ready')->default(false);
        });
        Schema::create('presence_tracks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('camera_id')->constrained()->cascadeOnDelete();
            $table->string('session_id', 64);
            $table->string('track_id', 64);
            $table->string('classification')->default('unclassified');
            $table->timestamp('first_seen_at');
            $table->timestamp('last_seen_at');
            $table->timestamp('absence_alerted_at')->nullable();
            $table->json('box')->nullable();
            $table->string('snapshot_path')->nullable();
            $table->timestamps();
            $table->unique(['camera_id', 'session_id', 'track_id']);
        });
    }
    public function down(): void
    {
        Schema::dropIfExists('presence_tracks');
        Schema::table('cameras', fn (Blueprint $table) => $table->dropColumn([
            'live_path', 'frame_at', 'tracking_session', 'presence_alerts_enabled', 'absence_seconds', 'detector_ready',
        ]));
    }
};
