<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * @deprecated LEGACY / READ-ONLY.
 *
 * The allocation workflow this table used to hold now lives directly on
 * App\Models\SaleOrderLine (CrmAllocationStatus, CrmErpStatus, etc — see
 * database/migrations/2026_09_25_*). The underlying table has been renamed
 * to `product_allocations_legacy` and nothing in the app writes to it any
 * more. This model is kept only so old data can still be queried/reported
 * on if needed; point $table at the renamed table to use it that way.
 */
class ProductAllocation extends Model
{
    protected $table = 'product_allocations';
    protected $primaryKey = 'Id';

    const CREATED_AT = 'CreatedAt';
    const UPDATED_AT = 'UpdatedAt';

    protected $fillable = [
        'ProductId',
        'CustomerId',
        'AllocatedQty',
        'AllocatedBy',
        'OrderId',
        'Status',
        'Remarks',
        'ErpStatus',
        'DecidedBy',
        'DecidedAt',
        'ErpTransferredAt',
        'Meters',
    ];

    protected $casts = [
        'AllocatedQty' => 'integer',
        'DecidedAt' => 'datetime',
        'ErpTransferredAt' => 'datetime',
    ];


    public function order()
    {
        return $this->belongsTo(\App\Models\Order::class, 'OrderId', 'Id');
    }

    public function product()
    {
        return $this->belongsTo(Product::class, 'ProductId');
    }

    public function customer()
    {
        return $this->belongsTo(Customer::class, 'CustomerId');
    }

    public function allocator()
    {
        return $this->belongsTo(User::class, 'AllocatedBy');
    }

    public function decider()
    {
        return $this->belongsTo(User::class, 'DecidedBy');
    }

    public function consumptions()
    {
        return $this->hasMany(AllocationBatchConsumption::class, 'ProductAllocationId');
    }
}