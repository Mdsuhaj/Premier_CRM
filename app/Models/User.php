<?php
namespace App\Models;

use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    use HasApiTokens, Notifiable;

    protected $fillable = [
        'name', 'email', 'password', 'role',
        'district', 'taluk', 'lcode', 'ccode', 'status',
        'phone', 'dob',
        'designation', 'assigned_area', 'approval_note',
    ];

    protected $hidden = ['password', 'remember_token'];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
        ];
    }

    public function getDistrictAttribute($value): array
    {
        $val = $value ?? $this->attributes['District'] ?? null;
        if (is_array($val)) {
            return array_values(array_filter($val, fn($v) => $v !== null && $v !== ''));
        }
        if (is_string($val) && $val !== '') {
            $dec = json_decode($val, true);
            if (json_last_error() === JSON_ERROR_NONE && is_array($dec)) {
                return array_values(array_filter($dec, fn($v) => $v !== null && $v !== ''));
            }
            return [$val];
        }
        return [];
    }

    public function getTalukAttribute($value): array
    {
        $val = $value ?? $this->attributes['Taluk'] ?? null;
        if (is_array($val)) {
            return array_values(array_filter($val, fn($v) => $v !== null && $v !== ''));
        }
        if (is_string($val) && $val !== '') {
            $dec = json_decode($val, true);
            if (json_last_error() === JSON_ERROR_NONE && is_array($dec)) {
                return array_values(array_filter($dec, fn($v) => $v !== null && $v !== ''));
            }
            return [$val];
        }
        return [];
    }

    protected static function booted(): void
    {
        static::saving(function (User $user) {
            $user->lcode = $user->lcode ?? 'PRE-1';
            $user->ccode = $user->ccode ?? 'PRE';

            if ($user->isDirty('password')) {
                $user->password = bcrypt($user->password);
            }
        });
    }
}