<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Stores Oracle's FULLITEMKEYDECODER.ORDERITEMCODE for this product, so
// Marketing Review's Product Code column can show the exact Oracle order
// item code instead of our internal generated Code (e.g. "ORA-c2978...").
// Nullable and backfilled lazily — see AllocationController@backfillOrderItemCodes
// — so existing products don't need a one-off data migration; each is
// looked up from Oracle and cached here the next time it appears on the
// Marketing Review board.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('Products', function (Blueprint $table) {
            $table->string('OrderItemCode', 150)->nullable()->after('ShadeNo');
        });
    }

    public function down(): void
    {
        Schema::table('Products', function (Blueprint $table) {
            $table->dropColumn('OrderItemCode');
        });
    }
};