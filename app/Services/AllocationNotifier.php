<?php

namespace App\Services;

use App\Models\AppNotification;
use App\Models\Customer;
use App\Models\Order;
use App\Models\User;
use Illuminate\Support\Facades\Log;

/**
 * One place that decides WHO gets an in-app notification (the bell in the
 * top bar) for every allocation event, and WHAT it says.
 *
 * Events                      Customer  End User  Admin  System Admin
 *  fully / partially allocated    yes      yes      -        yes
 *  stock shortage                 yes      yes     yes       yes
 *  allocation approved            yes      yes     yes        -
 *  allocation rejected            yes      yes     yes        -
 *  ERP sales order created        yes      yes     yes       yes
 *  allocation cancelled           yes      yes     yes        -
 *
 * Notifications never block the real action: any failure is logged only.
 * Identical (user + order + type + message) notifications are not repeated,
 * so re-saving an unchanged allocation board does not spam anyone.
 */
class AllocationNotifier
{
    /** Fully / partially allocated / stock shortage, decided from the numbers. */
    public function allocated(Order $order, int $allocatedQty, ?User $actor = null, ?int $availableStock = null): void
    {
        $requested = (int) $order->Quantity;
        $code = $order->Code;

        if ($allocatedQty <= 0) {
            $this->shortage($order, $actor, $availableStock);
            return;
        }

        if ($allocatedQty >= $requested) {
            $this->send(
                $order,
                'allocation_full',
                'Order fully allocated',
                "Order {$code} is fully allocated ({$allocatedQty} of {$requested}).",
                $this->customerUser($order),
                $this->endUsers($order),
                $this->systemAdmins()
            );
            return;
        }

        $balance = $requested - $allocatedQty;
        $this->send(
            $order,
            'allocation_partial',
            'Order partially allocated',
            "Order {$code} is partially allocated: {$allocatedQty} of {$requested}. Balance {$balance} is waiting for stock.",
            $this->customerUser($order),
            $this->endUsers($order),
            $this->systemAdmins()
        );
    }

    public function shortage(Order $order, ?User $actor = null, ?int $availableStock = null): void
    {
        $requested = (int) $order->Quantity;
        $stockText = $availableStock !== null ? " Available stock: {$availableStock}." : '';
        $this->send(
            $order,
            'stock_shortage',
            'Stock shortage',
            "Order {$order->Code} cannot be allocated: not enough stock for {$requested}.{$stockText}",
            $this->customerUser($order),
            $this->endUsers($order),
            $this->admins($order, $actor),
            $this->systemAdmins()
        );
    }

    public function decided(Order $order, string $status, ?User $actor = null): void
    {
        $approved = $status === 'approved';
        $this->send(
            $order,
            $approved ? 'allocation_approved' : 'allocation_rejected',
            $approved ? 'Allocation approved' : 'Allocation rejected',
            $approved
            ? "The allocation for order {$order->Code} was approved and will move to ERP."
            : "The allocation for order {$order->Code} was rejected.",
            $this->customerUser($order),
            $this->endUsers($order),
            $this->admins($order, $actor)
        );
    }

    public function erpCreated(Order $order, ?User $actor = null): void
    {
        $this->send(
            $order,
            'erp_created',
            'ERP sales order created',
            "Order {$order->Code} has been transferred to ERP and sales order created.",
            $this->customerUser($order),
            $this->endUsers($order),
            $this->admins($order, $actor),
            $this->systemAdmins()
        );
    }

    public function cancelled(Order $order, ?User $actor = null): void
    {
        $this->send(
            $order,
            'allocation_cancelled',
            'Order removed from sales order',
            "Order {$order->Code} was removed from the sales order.",
            $this->customerUser($order),
            $this->endUsers($order),
            $this->admins($order, $actor)
        );
    }

    // ── recipients ────────────────────────────────────────────────

    private function customerUser(Order $order): array
    {
        $customer = $order->customer ?? Customer::find($order->CustomerId);
        return $customer && $customer->UserId ? [(int) $customer->UserId] : [];
    }

    /** End Users covering the customer's Taluk, plus whoever created the order if they are an end user. */
    private function endUsers(Order $order): array
    {
        $customer = $order->customer ?? Customer::find($order->CustomerId);
        $ids = [];

        if ($customer && $customer->Taluk) {
            foreach (User::where('role', 'end_user')->get() as $u) {
                if (in_array($customer->Taluk, (array) $u->taluk, true)) {
                    $ids[] = (int) $u->id;
                }
            }
        }

        if ($order->CreatedBy) {
            $creator = User::find($order->CreatedBy);
            if ($creator && $creator->role === 'end_user') {
                $ids[] = (int) $creator->id;
            }
        }

        return $ids;
    }

    /** The Admin who allocated (the actor, if admin) and Admins covering the customer's District. */
    // private function admins(Order $order, ?User $actor): array
    // {
    //     $ids = [];
    //     if ($actor && $actor->role === 'admin') {
    //         $ids[] = (int) $actor->id;
    //     }

    //     $customer = $order->customer ?? Customer::find($order->CustomerId);
    //     if ($customer && $customer->District) {
    //         foreach (User::where('role', 'admin')->get() as $u) {
    //             if (in_array($customer->District, (array) $u->district, true)) {
    //                 $ids[] = (int) $u->id;
    //             }
    //         }
    //     }

    //     // Last-line fallback so an order never goes un-notified on the admin side.
    //     if (empty($ids)) {
    //         $ids = User::where('role', 'admin')->pluck('id')->map(fn ($v) => (int) $v)->all();
    //     }

    //     return $ids;
    // }

    /** Every Admin is notified: the same 1-2 admins allot orders for all districts. */
    private function admins(Order $order, ?User $actor): array
    {
        return User::where('role', 'admin')->pluck('id')->map(fn($v) => (int) $v)->all();
    }

    private function systemAdmins(): array
    {
        return User::where('role', 'system_admin')->pluck('id')->map(fn($v) => (int) $v)->all();
    }

    // ── delivery ──────────────────────────────────────────────────

    private function send(Order $order, string $type, string $title, string $message, array ...$groups): void
    {
        try {
            $userIds = array_unique(array_merge(...$groups));

            foreach ($userIds as $userId) {
                $already = AppNotification::where('UserId', $userId)
                    ->where('OrderId', $order->Id)
                    ->where('Type', $type)
                    ->where('Message', $message)
                    ->exists();
                if ($already) {
                    continue;
                }
                AppNotification::send($userId, $type, $title, $message, (int) $order->Id);
            }
        } catch (\Throwable $e) {
            Log::warning('Allocation notification failed', [
                'orderId' => $order->Id ?? null,
                'type' => $type,
                'error' => $e->getMessage(),
            ]);
        }
    }
}