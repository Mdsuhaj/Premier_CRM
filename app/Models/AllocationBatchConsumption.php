<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AllocationBatchConsumption extends Model
{
    protected $table = 'allocation_batch_consumptions';
    protected $primaryKey = 'Id';

    const CREATED_AT = 'CreatedAt';
    const UPDATED_AT = null;

    // ProductAllocationId is legacy (kept for consumption history recorded
    // before allocations moved onto sale_order_line) — nothing new writes
    // to it. SaleOrderLineId is what every current row uses.
    protected $fillable = ['SaleOrderLineId', 'ProductAllocationId', 'BatchId', 'ConsumedQty'];

    protected $casts = ['ConsumedQty' => 'integer'];

    public function batch()
    {
        return $this->belongsTo(StockBatch::class, 'BatchId');
    }

    public function saleOrderLine()
    {
        return $this->belongsTo(SaleOrderLine::class, 'SaleOrderLineId');
    }

    /** @deprecated Legacy rows only — see SaleOrderLineId / saleOrderLine(). */
    public function allocation()
    {
        return $this->belongsTo(ProductAllocation::class, 'ProductAllocationId');
    }
}
