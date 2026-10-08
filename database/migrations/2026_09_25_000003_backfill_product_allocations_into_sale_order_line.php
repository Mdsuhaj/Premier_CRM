<?php

use App\Models\Customer;
use App\Models\Order;
use App\Models\Product;
use App\Models\SaleOrderLine;
use App\Services\SaleOrderService;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * One-time data move: copies every existing product_allocations row onto
 * its matching sale_order_line row (creating the header/line first if that
 * order was placed before ERP staging existed), then points its FIFO
 * consumption rows at the new SaleOrderLineId.
 *
 * product_allocations itself is left in place (renamed, not dropped) so
 * nothing is destroyed — see the next migration.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!\Illuminate\Support\Facades\Schema::hasTable('product_allocations')) {
            return;
        }

        $service = app(SaleOrderService::class);
        $rows = DB::table('product_allocations')->orderBy('Id')->get();

        foreach ($rows as $row) {
            if (!$row->OrderId) {
                // No live Order to attach to (order was since dispatched/
                // removed) — nothing meaningful to migrate for this one.
                continue;
            }

            $order = Order::find($row->OrderId);
            if (!$order) {
                continue;
            }

            $line = SaleOrderLine::where('CrmOrderId', $order->Id)->first();

            if (!$line) {
                $product = Product::find($row->ProductId);
                $customer = Customer::find($row->CustomerId);
                if (!$product || !$customer) {
                    continue;
                }
                $line = $service->stageOrder($order, $product, $customer, null);
                if (!$line) {
                    continue; // staging disabled (SALE_ORDER_STAGING=false) — skip
                }
            }

            $qty = (int) $row->AllocatedQty;

            DB::table('sale_order_line')->where('Id', $line->Id)->update([
                'CrmCustomerId'        => $row->CustomerId,
                'USERPRIMARYQUANTITY'  => $qty,
                'BASEPRIMARYQUANTITY'  => $qty,
                'CrmAllocatedBy'       => $row->AllocatedBy,
                'CrmAllocationStatus'  => $row->Status ?? 'pending',
                'CrmRemarks'           => $row->Remarks ?? null,
                'CrmErpStatus'         => $row->ErpStatus ?? 'not_transferred',
                'CrmDecidedBy'         => $row->DecidedBy ?? null,
                'CrmDecidedAt'         => $row->DecidedAt ?? null,
                'CrmErpTransferredAt'  => $row->ErpTransferredAt ?? null,
                'CrmMeters'            => $row->Meters ?? null,
            ]);

            DB::table('allocation_batch_consumptions')
                ->where('ProductAllocationId', $row->Id)
                ->update(['SaleOrderLineId' => $line->Id]);
        }

        Log::info('Backfilled ' . $rows->count() . ' product_allocations row(s) into sale_order_line.');
    }

    public function down(): void
    {
        // Data-only migration — nothing to reverse (product_allocations
        // itself is untouched by this step).
    }
};
