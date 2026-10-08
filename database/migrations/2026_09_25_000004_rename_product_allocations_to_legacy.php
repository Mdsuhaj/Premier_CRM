<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * product_allocations has been fully replaced by the allocation columns on
 * sale_order_line (previous 3 migrations). Renamed rather than dropped —
 * nothing is deleted, it's just no longer read or written by the app.
 * Safe to actually drop later once you've confirmed the new columns look
 * right in production.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('product_allocations') || Schema::hasTable('product_allocations_legacy')) {
            return;
        }

        if (DB::getDriverName() === 'sqlsrv') {
            DB::statement("EXEC sp_rename 'product_allocations', 'product_allocations_legacy'");
        } else {
            Schema::rename('product_allocations', 'product_allocations_legacy');
        }
    }

    public function down(): void
    {
        if (!Schema::hasTable('product_allocations_legacy') || Schema::hasTable('product_allocations')) {
            return;
        }

        if (DB::getDriverName() === 'sqlsrv') {
            DB::statement("EXEC sp_rename 'product_allocations_legacy', 'product_allocations'");
        } else {
            Schema::rename('product_allocations_legacy', 'product_allocations');
        }
    }
};
