<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * FIFO batch consumption rows used to key off product_allocations.Id
 * (`ProductAllocationId`). Now that allocations live on sale_order_line,
 * new consumption rows are keyed by `SaleOrderLineId` instead.
 *
 * `ProductAllocationId` is kept (nullable) purely so old consumption
 * history from before this change still reads correctly — nothing new
 * writes to it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('allocation_batch_consumptions', function (Blueprint $table) {
            $table->unsignedBigInteger('SaleOrderLineId')->nullable()->after('ProductAllocationId')->index();
        });

        // Allow ProductAllocationId to go NULL going forward (it's a plain
        // ALTER, not a Blueprint ->change(), so it doesn't need doctrine/dbal).
        if (DB::getDriverName() === 'sqlsrv') {
            DB::statement('ALTER TABLE allocation_batch_consumptions ALTER COLUMN ProductAllocationId BIGINT NULL');
        } elseif (DB::getDriverName() !== 'sqlite') {
            DB::statement('ALTER TABLE allocation_batch_consumptions MODIFY ProductAllocationId BIGINT UNSIGNED NULL');
        }
        // sqlite (used only for local/dev testing) already treats plain
        // unsignedBigInteger columns as permissive about NULL, so nothing
        // extra is needed there.
    }

    public function down(): void
    {
        Schema::table('allocation_batch_consumptions', function (Blueprint $table) {
            $table->dropColumn('SaleOrderLineId');
        });
    }
};
