<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// FIX: the Marketing Review board query (and Product::all(['Id', 'Code',
// 'Name', 'Category', 'SubType', 'ShadeNo', 'Price', 'Quantity', 'UOM'])
// in AllocationController@board) now selects a 'UOM' column that was
// never added to the products table — every load of the batches/
// Marketing Review page was throwing SQLSTATE[42S22]: Invalid column
// name 'UOM'. This migration adds it.
//
// Same shape as the Box / Pieces / Meter unit selector introduced on the
// Product Catalog / Product Selection pages — nullable string, defaults
// to 'Box' for existing rows so old products don't show a blank UOM.
return new class extends Migration {
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->string('UOM', 20)->nullable()->default('Box')->after('Quantity');
        });
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->dropColumn('UOM');
        });
    }
};