<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Marketing Review's CD Flag dropdown (Yes/No) — stored as 1/0 on
// sale_order_line. CRM-only: no matching column exists on Oracle's real
// SALESORDERLINEIBEAN, so it's excluded from the ERP export (see
// SaleOrderLine::CRM_ONLY_COLUMNS).
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sale_order_line', function (Blueprint $table) {
            $table->tinyInteger('CrmCdFlag')->nullable()->default(0)->after('CrmRemarks');
        });
    }

    public function down(): void
    {
        Schema::table('sale_order_line', function (Blueprint $table) {
            $table->dropColumn('CrmCdFlag');
        });
    }
};