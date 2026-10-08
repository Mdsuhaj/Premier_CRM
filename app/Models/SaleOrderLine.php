<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * ERP "Line" staging table — ONE row per product on an order.
 * FATHERID holds the parent header's RELATEDDEPENDENTID.
 *
 * This ALSO carries the allocation workflow that used to live in the
 * separate `product_allocations` table (see the 2026_09_25 migrations):
 *   ORIGINALUSERPRIMARYQUANTITY = quantity the customer ordered
 *   USERPRIMARYQUANTITY / BASEPRIMARYQUANTITY = quantity actually ALLOCATED
 *                                                (this is what goes to ERP)
 *   CrmAllocationStatus = pending | approved | rejected
 *   CrmErpStatus        = not_transferred | erp_so_created
 */
class SaleOrderLine extends Model
{
    protected $table = 'sale_order_line';
    protected $primaryKey = 'Id';
    public $timestamps = false;
    protected $guarded = ['Id'];

    protected $casts = [
        'CrmDecidedAt'        => 'datetime',
        'CrmFirstAllocatedAt' => 'datetime',
        'CrmErpTransferredAt' => 'datetime',
    ];

    /** CRM-only columns — never part of the ERP export. */
    public const CRM_ONLY_COLUMNS = [
        'Id', 'CrmOrderId', 'CrmProductId', 'CrmCustomerId', 'CrmAllocatedBy',
        'CrmAllocationStatus', 'CrmRemarks', 'CrmErpStatus', 'CrmDecidedBy',
        'CrmDecidedAt', 'CrmErpTransferredAt', 'CrmMeters', 'CrmFirstAllocatedAt',
        'CrmOracleImportCounter', 'CrmOracleRelatedDependentId',  'CrmCdFlag',
        'CrmPriceListCode','CrmTotalMtrQty', 'CrmErpSentQty', 'CrmErpSentCases',
    ];

    public function header()
    {
        return $this->belongsTo(SaleOrderHeader::class, 'FATHERID', 'RELATEDDEPENDENTID');
    }

    public function order()
    {
        return $this->belongsTo(Order::class, 'CrmOrderId', 'Id');
    }

    public function product()
    {
        return $this->belongsTo(Product::class, 'CrmProductId', 'Id');
    }

    public function customer()
    {
        return $this->belongsTo(Customer::class, 'CrmCustomerId', 'Id');
    }

    public function allocator()
    {
        return $this->belongsTo(User::class, 'CrmAllocatedBy');
    }

    public function decider()
    {
        return $this->belongsTo(User::class, 'CrmDecidedBy');
    }

    public function consumptions()
    {
        return $this->hasMany(AllocationBatchConsumption::class, 'SaleOrderLineId');
    }
}