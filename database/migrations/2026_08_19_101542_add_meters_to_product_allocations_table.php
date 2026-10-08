<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// FIX: AllocationController@store / storeByCustomer (and the
// ProductAllocation model's $fillable) have written a 'Meters' value on
// every allocation save for a while now, but the product_allocations
// table itself never got that column added — every save was throwing
// SQLSTATE[42S22]: Invalid column name 'Meters'. This migration adds it.
//
// Nullable string (matches the request validation:
// 'allocations.*.meters' => 'nullable|string|max:50' in
// AllocationController), placed right after AllocatedQty since that's
// where it's used/read alongside allocatedQty throughout the controller.
return new class extends Migration {
    public function up(): void
    {
        Schema::table('product_allocations', function (Blueprint $table) {
            $table->string('Meters', 50)->nullable()->after('AllocatedQty');
        });
    }

    public function down(): void
    {
        Schema::table('product_allocations', function (Blueprint $table) {
            $table->dropColumn('Meters');
        });
    }
};