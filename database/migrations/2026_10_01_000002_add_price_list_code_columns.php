<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Marketing Review's new Price dropdown (TLODOM / DOMESTIC, sourced from
// Oracle PRICELIST.CODE). Stored per-line (CrmPriceListCode on
// sale_order_line) AND kept in sync on the header (CrmPriceListCode on
// sale_order_header), because it needs to reach TWO different real Oracle
// columns on Transfer to ERP:
//   sale_order_line.CrmPriceListCode   -> SALESORDERLINEIBEAN.PRICELISTCODE
//   sale_order_header.CrmPriceListCode -> SALESORDERIBEAN.MARKETCODE
// See OracleSalesOrderTransfer.php for where these are written at transfer
// time — unlike CrmCdFlag, this one is NOT CRM-only.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sale_order_line', function (Blueprint $table) {
            $table->string('CrmPriceListCode', 50)->nullable()->after('CrmCdFlag');
        });
        Schema::table('sale_order_header', function (Blueprint $table) {
            $table->string('CrmPriceListCode', 50)->nullable()->after('CrmCustomerId');
        });
    }

    public function down(): void
    {
        Schema::table('sale_order_line', function (Blueprint $table) {
            $table->dropColumn('CrmPriceListCode');
        });
        Schema::table('sale_order_header', function (Blueprint $table) {
            $table->dropColumn('CrmPriceListCode');
        });
    }
};
