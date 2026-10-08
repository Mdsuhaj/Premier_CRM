<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Fields needed to actually write "Transfer to ERP" rows into Oracle's
 * live SALESORDERIBEAN / SALESORDERLINEIBEAN tables.
 *
 * IMPORTANT — why these are separate from our own IMPORTAUTOCOUNTER /
 * RELATEDDEPENDENTID (already on sale_order_header/sale_order_line):
 * those two are numbered by OUR OWN local counter (config/sale_order.php),
 * completely independent of Oracle's live tables — other systems keep
 * inserting into Oracle on their own, so our local numbers WILL
 * eventually collide with real Oracle rows if reused blindly. Both real
 * Oracle tables also have IMPORTAUTOCOUNTER as their sole primary key —
 * no trigger/sequence fills it for us, so we must supply a value Oracle
 * has never seen.
 *
 * So at the moment of an actual Oracle insert, App\Services\
 * OracleSalesOrderTransfer generates a FRESH number (Oracle's own live
 * MAX(IMPORTAUTOCOUNTER)+1, and a fresh shared RELATEDDEPENDENTID the
 * same way), and records what was actually used in Oracle here — kept
 * separate from our own staging numbers above.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sale_order_header', function (Blueprint $table) {
            // Set once, the first time ANY of this header's lines is
            // transferred — every later line of the same header/cart
            // reuses this header row instead of inserting it again.
            $table->dateTime('CrmOracleTransferredAt', 3)->nullable()->after('CrmMeters');
            $table->bigInteger('CrmOracleImportCounter')->nullable()->after('CrmOracleTransferredAt');
            $table->bigInteger('CrmOracleRelatedDependentId')->nullable()->after('CrmOracleImportCounter');
        });

        Schema::table('sale_order_line', function (Blueprint $table) {
            $table->bigInteger('CrmOracleImportCounter')->nullable()->after('CrmMeters');
            $table->bigInteger('CrmOracleRelatedDependentId')->nullable()->after('CrmOracleImportCounter');
        });
    }

    public function down(): void
    {
        Schema::table('sale_order_header', function (Blueprint $table) {
            $table->dropColumn(['CrmOracleTransferredAt', 'CrmOracleImportCounter', 'CrmOracleRelatedDependentId']);
        });
        Schema::table('sale_order_line', function (Blueprint $table) {
            $table->dropColumn(['CrmOracleImportCounter', 'CrmOracleRelatedDependentId']);
        });
    }
};
