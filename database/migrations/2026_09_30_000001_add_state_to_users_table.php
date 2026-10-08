<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('users', 'State')) {
            Schema::table('users', function (Blueprint $table) {
                $table->string('State', 100)->nullable();
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('users', 'State')) {
            Schema::table('users', function (Blueprint $table) {
                $table->dropColumn('State');
            });
        }
    }
};