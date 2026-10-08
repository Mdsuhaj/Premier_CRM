<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// sale_order_header.DOCUMENTTYPETYPE and .COMMISSIONDOCUMENTTYPE were
// created as integer columns, which can never store a leading zero
// ('03' is stored/read back as 3). Both need to hold Oracle's real
// zero-padded document-type codes ('03', '05'), so they're widened to
// varchar here. TERMSOFSHIPPINGCODE on the same table is already
// string(50) — it needs no schema change, only the config default
// below changing from 1 to '01'.
//
// Only sale_order_header's own DOCUMENTTYPETYPE is touched — the
// separate DOCUMENTTYPETYPE column on sale_order_line is untouched,
// since this request is specifically about the header table.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sale_order_header', function (Blueprint $table) {
            $table->string('DOCUMENTTYPETYPE', 10)->nullable()->change();
            $table->string('COMMISSIONDOCUMENTTYPE', 10)->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('sale_order_header', function (Blueprint $table) {
            $table->integer('DOCUMENTTYPETYPE')->nullable()->change();
            $table->integer('COMMISSIONDOCUMENTTYPE')->nullable()->change();
        });
    }
};