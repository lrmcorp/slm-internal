<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('cameras', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('location')->nullable();
            $table->string('stream_env_key')->unique();
            $table->string('reference_path')->nullable();
            $table->json('zones')->nullable();
            $table->timestamp('zones_approved_at')->nullable();
            $table->foreignId('zones_approved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('last_seen_at')->nullable();
            $table->string('status')->default('unconfigured');
            $table->timestamps();
        });

        Schema::create('labels', function (Blueprint $table) {
            $table->id();
            $table->foreignId('camera_id')->constrained()->cascadeOnDelete();
            $table->string('field_one');
            $table->string('field_two')->nullable();
            $table->string('field_three')->nullable();
            $table->text('raw_ocr')->nullable();
            $table->decimal('confidence', 5, 4)->default(0);
            $table->timestamp('first_seen_at');
            $table->timestamp('last_seen_at');
            $table->string('evidence_path')->nullable();
            $table->string('review_status')->default('pending');
            $table->string('slm_status')->default('unavailable');
            $table->string('slm_reference')->nullable();
            $table->json('slm_response')->nullable();
            $table->timestamps();
            $table->index(['camera_id', 'field_one', 'first_seen_at']);
        });

        Schema::create('incidents', function (Blueprint $table) {
            $table->id();
            $table->foreignId('camera_id')->constrained()->cascadeOnDelete();
            $table->string('type');
            $table->string('status')->default('needs_review');
            $table->text('reason');
            $table->decimal('confidence', 5, 4)->nullable();
            $table->timestamp('occurred_at');
            $table->timestamp('resolved_at')->nullable();
            $table->string('snapshot_path')->nullable();
            $table->string('clip_path')->nullable();
            $table->string('dedupe_key')->unique();
            $table->json('metadata')->nullable();
            $table->foreignId('reviewed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('reviewed_at')->nullable();
            $table->text('review_note')->nullable();
            $table->timestamps();
        });

        Schema::create('api_tokens', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->string('token_hash', 64)->unique();
            $table->timestamp('expires_at');
            $table->timestamp('last_used_at')->nullable();
            $table->timestamps();
        });

        Schema::create('device_tokens', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->text('token_encrypted');
            $table->string('token_hash', 64)->unique();
            $table->string('platform');
            $table->timestamps();
        });

        Schema::create('notification_rules', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('incident_type');
            $table->string('channel');
            $table->boolean('enabled')->default(true);
            $table->string('whatsapp_number')->nullable();
            $table->timestamps();
            $table->unique(['user_id', 'incident_type', 'channel']);
        });

        Schema::create('notification_deliveries', function (Blueprint $table) {
            $table->id();
            $table->foreignId('incident_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('channel');
            $table->string('status')->default('pending');
            $table->unsignedInteger('attempts')->default(0);
            $table->timestamp('next_attempt_at')->nullable();
            $table->timestamp('sent_at')->nullable();
            $table->text('last_error')->nullable();
            $table->timestamps();
            $table->unique(['incident_id', 'user_id', 'channel']);
        });
    }

    public function down(): void
    {
        foreach (['notification_deliveries', 'notification_rules', 'device_tokens', 'api_tokens', 'incidents', 'labels', 'cameras'] as $name) {
            Schema::dropIfExists($name);
        }
    }
};
