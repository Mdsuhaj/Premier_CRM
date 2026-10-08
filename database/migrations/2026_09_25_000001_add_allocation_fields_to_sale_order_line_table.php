<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Merges the allocation workflow (previously the separate `product_allocations`
 * table) directly onto `sale_order_line`.
 *
 * Why: one Order = one sale_order_line row already (CrmOrderId is unique per
 * line). product_allocations was ALSO one row per Order (see its OrderId
 * migration), so it was a second table shadowing rows that already existed
 * here. Keeping both meant Marketing Review's numbers and the ERP export
 * could drift apart. Now there is exactly one row per order-line, and it
 * carries both what the customer asked for AND what was actually allocated.
 *
 * How the existing ERP columns are reused:
 *   ORIGINALUSERPRIMARYQUANTITY = quantity the customer ordered (was, and
 *                                 still is, kept in sync from Orders.Quantity)
 *   USERPRIMARYQUANTITY / BASEPRIMARYQUANTITY
 *                               = quantity actually ALLOCATED (was
 *                                 product_allocations.AllocatedQty).
 *                                 This is what goes to the ERP.
 * Everything below is new, CRM-only (mirrors product_allocations' own
 * allocation-workflow columns, prefixed Crm* like the other helper columns).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sale_order_line', function (Blueprint $table) {
            $table->unsignedBigInteger('CrmCustomerId')->nullable()->after('CrmProductId')->index();
            $table->unsignedBigInteger('CrmAllocatedBy')->nullable()->after('CrmCustomerId');
            $table->string('CrmAllocationStatus', 20)->default('pending')->after('CrmAllocatedBy')->index();
            $table->text('CrmRemarks')->nullable()->after('CrmAllocationStatus');
            $table->string('CrmErpStatus', 20)->default('not_transferred')->after('CrmRemarks')->index();
            $table->unsignedBigInteger('CrmDecidedBy')->nullable()->after('CrmErpStatus');
            $table->dateTime('CrmDecidedAt', 3)->nullable()->after('CrmDecidedBy');
            $table->dateTime('CrmErpTransferredAt', 3)->nullable()->after('CrmDecidedAt');
            $table->string('CrmMeters', 50)->nullable()->after('CrmErpTransferredAt');
        });
    }

    public function down(): void
    {
        Schema::table('sale_order_line', function (Blueprint $table) {
            $table->dropColumn([
                'CrmCustomerId', 'CrmAllocatedBy', 'CrmAllocationStatus', 'CrmRemarks',
                'CrmErpStatus', 'CrmDecidedBy', 'CrmDecidedAt', 'CrmErpTransferredAt', 'CrmMeters',
            ]);
        });
    }
};
