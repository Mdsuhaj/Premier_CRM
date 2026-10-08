<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Order extends Model
{
    protected $table = 'Orders';
    protected $primaryKey = 'Id';

    protected $appends = ['is_overdue', 'balance_due', 'days_overdue'];

    const CREATED_AT = 'CreatedAt';
    const UPDATED_AT = 'UpdatedAt';

    protected $fillable = [
        'Code',
        'CustomerId',
        'ProductId',
        'Category',
        'SubType',
        'Quantity',
        'PricePerUnit',
        'DiscountPct',
        'TotalAmount',
        'Status',
        'PaymentStatus',
        'AmountPaid',
        'DeliveryDate',
        'Notes',
        'CreatedBy',
        'ApprovedBy',
        'OrderDetails',
        // Order Enquiry workflow (assign -> approve -> convert to order)
        'AssignedTo',
        'AssignedAt',
        // Approve / Reject with reason (O2C Step 4)
        'RejectionReason',
        // Credit / discount hold (O2C Step 9)
        'OnHold',
        'HoldReason',
        'HoldPlacedAt',
        // FIFO / EB4 fulfilment source (O2C Step 8)
        'WarehouseSource',
        // Goods Dispatch (O2C Step 7)
        'LRNumber',
        'TransportName',
        'DispatchedAt',
        'DispatchedBy',
        // Payment due date / credit term
        'PaymentTermDays',
        'PaymentDueDate',
        'PaymentDueDateSetBy',
        'PaymentDueDateNote',
    ];

    protected $casts = [
        'PricePerUnit' => 'decimal:2',
        'DiscountPct' => 'decimal:2',
        'TotalAmount' => 'decimal:2',
        'AmountPaid' => 'decimal:2',
        'PaymentTermDays' => 'integer',
        'DeliveryDate' => 'date',
        'OrderDetails' => 'array',
        'DispatchedAt' => 'datetime',
        'PaymentDueDate' => 'date',
        'AssignedAt' => 'datetime',
        'OnHold' => 'boolean',
        'HoldPlacedAt' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::creating(function (Order $order) {
            $order->Lcode = $order->Lcode ?? 'PRE-1';
            $order->Ccode = $order->Ccode ?? '100';
        });

        // ERP staging (sale_order_header / sale_order_line): keep the staged
        // line in step when a CRM order is edited or deleted. Creation is
        // handled explicitly in OrderController (it knows the cart/group).
        // Never allowed to break the normal CRM flow — failures are only logged.
        static::updated(function (Order $order) {
            if ($order->wasChanged(['Quantity', 'PricePerUnit', 'DeliveryDate', 'OrderDetails'])) {
                try {
                    app(\App\Services\SaleOrderService::class)->syncFromOrder($order);
                } catch (\Throwable $e) {
                    \Illuminate\Support\Facades\Log::error('SaleOrder sync failed for order ' . $order->Id . ': ' . $e->getMessage());
                }
            }
        });

        static::deleted(function (Order $order) {
            try {
                app(\App\Services\SaleOrderService::class)->removeForOrder((int) $order->Id);
            } catch (\Throwable $e) {
                \Illuminate\Support\Facades\Log::error('SaleOrder cleanup failed for order ' . $order->Id . ': ' . $e->getMessage());
            }
        });
    }

    public function customer()
    {
        return $this->belongsTo(Customer::class, 'CustomerId');
    }

    public function product()
    {
        return $this->belongsTo(Product::class, 'ProductId');
    }

    public function creator()
    {
        return $this->belongsTo(User::class, 'CreatedBy');
    }
    public function approver()
    {
        return $this->belongsTo(User::class, 'ApprovedBy');
    }

    public function dispatcher()
    {
        return $this->belongsTo(User::class, 'DispatchedBy');
    }

    public function dueDateSetter()
    {
        return $this->belongsTo(User::class, 'PaymentDueDateSetBy');
    }

    public function assignee()
    {
        return $this->belongsTo(User::class, 'AssignedTo');
    }

    public function invoice()
    {
        return $this->hasOne(Invoice::class, 'OrderId');
    }

    /** True once PaymentDueDate has passed and the bill still isn't fully paid. */
    public function getIsOverdueAttribute(): bool
    {
        if (!$this->PaymentDueDate || in_array($this->PaymentStatus, ['paid'], true)) {
            return false;
        }
        return $this->PaymentDueDate->isPast();
    }

    /** How much of this bill is still unpaid. */
    public function getBalanceDueAttribute(): float
    {
        return round((float) $this->TotalAmount - (float) ($this->AmountPaid ?? 0), 2);
    }

    /** Whole days past the due date, unpaid — 0 if not overdue. */
    public function getDaysOverdueAttribute(): int
    {
        if (!$this->is_overdue) {
            return 0;
        }
        return (int) $this->PaymentDueDate->diffInDays(now()->startOfDay());
    }
}