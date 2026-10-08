<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Customer extends Model
{
    protected $table = 'Customers';
    protected $primaryKey = 'Id';

    const CREATED_AT = 'CreatedAt';
    const UPDATED_AT = 'UpdatedAt';

    protected $fillable = [
        'Code', 'UserId', 'Name', 'Phone', 'Email', 'Type', 'District', 'Taluk',
        'Address', 'CreditLimit', 'MaxDiscountPct', 'Outstanding', 'Status', 'Notes',
        'CreatedBy', 'ApprovedBy', 'OracleId',
        // Mobile-app "Add Customer" parity fields (see 2026_07_16 migration)
        'BusinessType', 'Emails', 'Phones', 'Addresses', 'ContactPersons',
        'GSTNo', 'PANNo', 'TANNo',
    ];

    protected $casts = [
        'CreditLimit' => 'decimal:2',
        'MaxDiscountPct' => 'decimal:2',
        'Outstanding' => 'decimal:2',
        'Emails' => 'array',
        'Phones' => 'array',
        'Addresses' => 'array',
        'ContactPersons' => 'array',
    ];

    protected static function booted(): void
    {
        static::creating(function (Customer $customer) {
            $customer->Lcode = $customer->Lcode ?? 'PRE-1';
            $customer->Ccode = $customer->Ccode ?? 'PRE';
        });
    }

    public function creator()
    {
        return $this->belongsTo(User::class, 'CreatedBy');
    }

    public function approver()
    {
        return $this->belongsTo(User::class, 'ApprovedBy');
    }

    public function user()
    {
        return $this->belongsTo(User::class, 'UserId');
    }

    public function orders()
    {
        return $this->hasMany(Order::class, 'CustomerId');
    }
}