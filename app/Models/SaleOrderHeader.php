<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * ERP "Header" staging table — ONE row per customer order (a whole cart).
 * Column names are the client ERP's own (see config/sale_order.php).
 *
 * Lines are linked by:  sale_order_line.FATHERID = sale_order_header.RELATEDDEPENDENTID
 */
class SaleOrderHeader extends Model
{
    protected $table = 'sale_order_header';
    protected $primaryKey = 'Id';
    public $timestamps = false;      // the ERP columns IMPCREATIONDATETIME / IMPLASTUPDATEDATETIME play that role
    protected $guarded = ['Id'];

    /** CRM-only columns — never part of the ERP export. */
    public const CRM_ONLY_COLUMNS = [
        'Id', 'CrmGroupRef', 'CrmCustomerId', 'CrmPriceListCode',
        'CrmOracleTransferredAt', 'CrmOracleImportCounter', 'CrmOracleRelatedDependentId',
    ];

    protected $casts = [
        'CrmOracleTransferredAt' => 'datetime',
    ];

    public function lines()
    {
        return $this->hasMany(SaleOrderLine::class, 'FATHERID', 'RELATEDDEPENDENTID');
    }

    public function customer()
    {
        return $this->belongsTo(Customer::class, 'CrmCustomerId', 'Id');
    }
}