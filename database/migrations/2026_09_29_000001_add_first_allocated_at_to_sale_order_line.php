<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Marketing Review: partially-allocated orders stay on the board for 48 hours
 * after their FIRST allocation, then move to the "Expired Partial Allocations"
 * page. This column stamps that first allocation.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sale_order_line', function (Blueprint $table) {
            $table->dateTime('CrmFirstAllocatedAt', 3)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('sale_order_line', function (Blueprint $table) {
            $table->dropColumn('CrmFirstAllocatedAt');
        });
    }
};
