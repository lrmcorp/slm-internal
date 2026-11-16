<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void {
        Schema::table('labels', function (Blueprint $table) {
            $table->timestamp('packing_completed_at')->nullable();
            $table->foreignId('packing_completed_by')->nullable()->constrained('users')->nullOnDelete();
        });
    }
    public function down(): void {
        Schema::table('labels', function (Blueprint $table) {
            $table->dropForeign(['packing_completed_by']);
            $table->dropColumn(['packing_completed_at', 'packing_completed_by']);
        });
    }
};
