<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Models\Employee;
use App\Models\Order;
use App\Models\Product;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

class DashboardController extends Controller
{
    /**
     * GET /api/dashboard
     * Returns real counts + recent orders for the dashboard.
     */
    public function index(Request $request)
    {
        $user = $request->user();

        // Base scopes
        $customerQ = Customer::query();
        $orderQ = Order::with(['customer', 'product']);
        $productQ = Product::query();

        // Scope by role — District/Taluk are multi-value (JSON array) on
        // the caller's Employee record. If the end_user has no assigned
        // Taluk(s), fall back to their District, and if that's also empty,
        // show ALL orders in their area (unscoped). An empty area list must
        // NOT be passed to whereIn() — that would match zero rows and show
        // 0 on every dashboard card, which is the bug being fixed here.
        if ($user->role === 'end_user') {
            $taluks = $this->callerAreas($user, 'Taluk');
            if (!empty($taluks)) {
                $customerQ->whereIn('Taluk', $taluks);
                $customerIds = Customer::whereIn('Taluk', $taluks)->pluck('Id');
                $orderQ->where(function ($q) use ($user, $customerIds) {
                    $q->where('CreatedBy', $user->id)
                        ->orWhereIn('CustomerId', $customerIds->isEmpty() ? [0] : $customerIds);
                });
            } else {
                // No taluk assigned — try district fallback
                $districts = $this->callerAreas($user, 'District');
                if (!empty($districts)) {
                    $customerQ->whereIn('District', $districts);
                    $customerIds = Customer::whereIn('District', $districts)->pluck('Id');
                    $orderQ->where(function ($q) use ($user, $customerIds) {
                        $q->where('CreatedBy', $user->id)
                            ->orWhereIn('CustomerId', $customerIds->isEmpty() ? [0] : $customerIds);
                    });
                } else {
                    // No area assigned at all — still show orders this
                    // end_user personally placed, rather than nothing.
                    $orderQ->where('CreatedBy', $user->id);
                }
            }
        } elseif ($user->role === 'admin') {
            $districts = $this->callerAreas($user, 'District');
            if (!empty($districts)) {
                $customerQ->whereIn('District', $districts);
                $orderQ->whereHas('customer', fn($q) => $q->whereIn('District', $districts));
            }
        }

        if ($user->role === 'system_admin') {
            $orderQ->whereExists(function ($q) {
                $q->from('sale_order_line')
                    ->whereColumn('sale_order_line.CrmOrderId', 'Orders.Id')
                    ->where('sale_order_line.USERPRIMARYQUANTITY', '>', 0);
            });
        }
        $totalCustomers = (clone $customerQ)->where('Status', 'approved')->count();
        $activeOrders = (clone $orderQ)->whereIn('Status', ['pending', 'processing', 'approved'])->count();
        $totalProducts = $productQ->where('Status', 'active')->count();
        $totalRevenue = (clone $orderQ)->where('PaymentStatus', 'paid')->sum('TotalAmount');

        $totalOrders = (clone $orderQ)->count();
        $approvedOrders = (clone $orderQ)->whereIn('Status', ['approved', 'processing', 'dispatched', 'delivered'])->count();
        $pendingOrders = (clone $orderQ)->where('Status', 'pending')->count();
        $rejectedOrders = (clone $orderQ)->where('Status', 'declined')->count();

        $recentOrders = (clone $orderQ)
            ->orderBy('CreatedAt', 'desc')
            ->limit(10)
            ->get()
            ->map(fn($o) => [
                'id' => $o->Code,
                'date' => $o->CreatedAt,
                'customer' => $o->customer->Name ?? '—',
                'product' => $o->product->Name ?? '—',
                'amount' => $o->TotalAmount,
                'quantity' => $o->Quantity,
                'status' => $o->Status,
                'payment' => $o->PaymentStatus,
                'delivery_date' => $o->DeliveryDate,
            ]);

        return response()->json([
            'stats' => [
                'total_customers' => $totalCustomers,
                'active_orders' => $activeOrders,
                'total_products' => $totalProducts,
                'total_revenue' => $totalRevenue,
                'total_orders' => $totalOrders,
                'approved_orders' => $approvedOrders,
                'pending_orders' => $pendingOrders,
                'rejected_orders' => $rejectedOrders,
            ],
            'recent_orders' => $recentOrders,
        ]);
    }

    /**
     * GET /api/dashboard/o2c
     *
     * Operational dashboard per the O2C blueprint (Section 5). Scoped the
     * same way as OrderController::index():
     *   - end_user  → only orders for customers in their own assigned Taluk(s)
     *   - admin     → only orders for customers in their own District(s)
     *   - system_admin / super_admin → everything
     *   - customer  → blocked, this is a staff dashboard
     *
     * NOTE ON ACCURACY: a few widgets are best-effort approximations until
     * dedicated Enquiry/Allocation tracking exists (see the `note` field in
     * the response):
     *   - "Partial dispatch" — we don't yet track partial-quantity dispatch,
     *     so this shows orders pending dispatch as a whole, not split qty.
     *   - "Stock shortage" — approximated by comparing requested Quantity
     *     against the Product's current stock at read time.
     *   - "Sales loss" — approximated as declined orders' value; no
     *     structured loss-reason field exists yet.
     *   - "Invalid indent / duplicates" — approximated as >1 pending order
     *     for the same Customer+Product pair; no real duplicate/validity
     *     flag exists yet.
     */
    public function o2c(Request $request)
    {
        $caller = $request->user();

        if (!$caller || $caller->role === 'customer') {
            return response()->json(['message' => 'Not permitted.'], 403);
        }

        $query = Order::with(['customer', 'product']);

        if ($caller->role === 'end_user') {
            $taluks = $this->callerAreas($caller, 'Taluk');
            if (!empty($taluks)) {
                $customerIds = Customer::whereIn('Taluk', $taluks)->pluck('Id');
                $query->where(function ($q) use ($caller, $customerIds) {
                    $q->where('CreatedBy', $caller->id)
                        ->orWhereIn('CustomerId', $customerIds->isEmpty() ? [0] : $customerIds);
                });
            } else {
                $districts = $this->callerAreas($caller, 'District');
                if (!empty($districts)) {
                    $customerIds = Customer::whereIn('District', $districts)->pluck('Id');
                    $query->where(function ($q) use ($caller, $customerIds) {
                        $q->where('CreatedBy', $caller->id)
                            ->orWhereIn('CustomerId', $customerIds->isEmpty() ? [0] : $customerIds);
                    });
                } else {
                    $query->where('CreatedBy', $caller->id);
                }
            }
        }

        if ($caller->role === 'admin') {
            $districts = $this->callerAreas($caller, 'District');
            if (!empty($districts)) {
                $customerIds = Customer::whereIn('District', $districts)->pluck('Id');
                $query->whereIn('CustomerId', $customerIds->isEmpty() ? [0] : $customerIds);
            }
        }

        if ($caller->role === 'system_admin') {
            $query->whereExists(function ($q) {
                $q->from('sale_order_line')
                    ->whereColumn('sale_order_line.CrmOrderId', 'Orders.Id')
                    ->where('sale_order_line.USERPRIMARYQUANTITY', '>', 0);
            });
        }

        $orders = $query->get();
        $today = now()->toDateString();

        // ── 1. Enquiry Status ──────────────────────────────────────────
        $enquiryStatus = [
            'total' => $orders->count(),
            'pending' => $orders->where('Status', 'pending')->count(),
            'approved' => $orders->whereIn('Status', ['approved', 'processing', 'dispatched', 'delivered'])->count(),
            'rejected' => $orders->where('Status', 'declined')->count(),
        ];

        // ── 2. Total Orders Placed ─────────────────────────────────────
        $dailyCount = $orders->filter(fn($o) => optional($o->CreatedAt)->toDateString() === $today)->count();

        $customerWise = $orders->groupBy('CustomerId')->map(function ($g) {
            $first = $g->first();
            return [
                'customer' => $first->customer->Name ?? '—',
                'count' => $g->count(),
                'value' => (float) $g->sum('TotalAmount'),
            ];
        })->sortByDesc('value')->take(10)->values();

        $productWise = $orders->groupBy('ProductId')->map(function ($g) {
            $first = $g->first();
            return [
                'product' => $first->product->Name ?? '—',
                'count' => $g->count(),
                'qty' => (int) $g->sum('Quantity'),
            ];
        })->sortByDesc('qty')->take(10)->values();

        // ── 3. Dispatch Status ──────────────────────────────────────────
        $dispatchStatus = [
            'dispatched' => $orders->where('Status', 'dispatched')->count(),
            'pendingDispatch' => $orders->whereIn('Status', ['approved', 'processing'])->count(),
            'delivered' => $orders->where('Status', 'delivered')->count(),
        ];

        // ── 4. Previous Day Pending Dispatch + aging ────────────────────
        $pendingDispatchOrders = $orders->whereIn('Status', ['approved', 'processing']);
        $aging = ['0-1' => 0, '2-3' => 0, '4+' => 0];
        $agingList = [];
        foreach ($pendingDispatchOrders as $o) {
            $reference = $o->UpdatedAt ?? $o->CreatedAt;
            $days = $reference ? now()->diffInDays(Carbon::parse($reference)) : 0;
            if ($days <= 1)
                $aging['0-1']++;
            elseif ($days <= 3)
                $aging['2-3']++;
            else
                $aging['4+']++;

            $agingList[] = [
                'code' => $o->Code,
                'customer' => $o->customer->Name ?? '—',
                'status' => $o->Status,
                'days' => $days,
            ];
        }
        usort($agingList, fn($a, $b) => $b['days'] <=> $a['days']);

        // ── 5. Enquiries Awaiting Due to Stock Shortage ─────────────────
        $stockShortage = $orders->where('Status', 'pending')->filter(function ($o) {
            return $o->product && $o->Quantity > ($o->product->Quantity ?? 0);
        })->map(fn($o) => [
                'code' => $o->Code,
                'customer' => $o->customer->Name ?? '—',
                'product' => $o->product->Name ?? '—',
                'requested' => (int) $o->Quantity,
                'available' => (int) ($o->product->Quantity ?? 0),
            ])->values();

        // ── 6. Sales Loss Indication ─────────────────────────────────────
        $declined = $orders->where('Status', 'declined');
        $salesLoss = [
            'count' => $declined->count(),
            'value' => (float) $declined->sum('TotalAmount'),
            'list' => $declined->map(fn($o) => [
                'code' => $o->Code,
                'customer' => $o->customer->Name ?? '—',
                'value' => (float) $o->TotalAmount,
                'notes' => $o->Notes,
            ])->values(),
        ];

        // ── 7. Invalid Indent List (proxy: possible duplicate pending) ──
        $duplicates = $orders->groupBy(fn($o) => $o->CustomerId . '-' . $o->ProductId)
            ->filter(fn($g) => $g->where('Status', 'pending')->count() > 1)
            ->map(function ($g) {
                $first = $g->first();
                return [
                    'customer' => $first->customer->Name ?? '—',
                    'product' => $first->product->Name ?? '—',
                    'count' => $g->where('Status', 'pending')->count(),
                ];
            })->values();

        // ── 8. Long Pending Orders (>=3 days, approved/processing) ──────
        $longPending = collect($agingList)->filter(fn($a) => $a['days'] >= 3)->take(10)->values();

        // ── 9. Order Summary (real counts backing the "Order Summary"
        // card row on the admin/sysadmin dashboard). "Rejected indents"
        // is a proxy — no dedicated indent-validity flag exists yet, so
        // it reuses the same possible-duplicate-pending heuristic as
        // "possibleDuplicates" above.
        $orderSummary = [
            'total' => $orders->count(),
            'pending' => $orders->where('Status', 'pending')->count(),
            'approved' => $orders->whereIn('Status', ['approved', 'processing', 'dispatched', 'delivered'])->count(),
            'rejected' => $orders->where('Status', 'declined')->count(),
            'rejectedIndents' => $duplicates->count(),
        ];

        return response()->json([
            'enquiryStatus' => $enquiryStatus,
            'orderSummary' => $orderSummary,
            'ordersPlaced' => [
                'today' => $dailyCount,
                'customerWise' => $customerWise,
                'productWise' => $productWise,
            ],
            'dispatchStatus' => $dispatchStatus,
            'pendingDispatchAging' => [
                'buckets' => $aging,
                'list' => array_slice($agingList, 0, 10),
            ],
            'stockShortage' => $stockShortage,
            'salesLoss' => $salesLoss,
            'possibleDuplicates' => $duplicates,
            'longPendingOrders' => $longPending,
            'note' => 'Partial-dispatch quantities, stock-shortage, sales-loss reasons, and duplicate detection are approximate until dedicated Enquiry/Allocation tracking is built.',
        ]);
    }

    /**
     * GET /api/dashboard/compliance
     *
     * Customer Compliance Status Dashboard — the flow diagram's box between
     * Goods Dispatch and Claim Process. Per customer: credit utilisation,
     * overdue bills, open complaints, and an overall status label so
     * Marketing can see at a glance who needs attention.
     */
    public function compliance(Request $request)
    {
        $caller = $request->user();
        if (!$caller || $caller->role === 'customer') {
            return response()->json(['message' => 'Not permitted.'], 403);
        }

        $customerQ = Customer::query()->where('Status', 'approved');

        if ($caller->role === 'end_user') {
            $customerQ->whereIn('Taluk', $this->callerAreas($caller, 'Taluk'));
        } elseif ($caller->role === 'admin') {
            $customerQ->whereIn('District', $this->callerAreas($caller, 'District'));
        }

        $customers = $customerQ->get();
        $customerIds = $customers->pluck('Id');

        $overdueOrders = Order::whereIn('CustomerId', $customerIds)
            ->whereNotNull('PaymentDueDate')
            ->where('PaymentDueDate', '<', now()->toDateString())
            ->where('PaymentStatus', '!=', 'paid')
            ->get()
            ->groupBy('CustomerId');

        $openComplaints = \App\Models\Complaint::whereIn('CustomerId', $customerIds)
            ->whereIn('Status', ['Open', 'In Progress'])
            ->get()
            ->groupBy('CustomerId');

        $onHoldOrders = Order::whereIn('CustomerId', $customerIds)
            ->where('OnHold', true)
            ->get()
            ->groupBy('CustomerId');

        $rows = $customers->map(function ($c) use ($overdueOrders, $openComplaints, $onHoldOrders) {
            $overdue = $overdueOrders->get($c->Id, collect());
            $complaints = $openComplaints->get($c->Id, collect());
            $holds = $onHoldOrders->get($c->Id, collect());

            $utilisation = $c->CreditLimit && (float) $c->CreditLimit > 0
                ? round(((float) $c->Outstanding / (float) $c->CreditLimit) * 100, 1)
                : null;

            $status = 'Good';
            if ($holds->count() > 0 || ($utilisation !== null && $utilisation >= 100)) {
                $status = 'Hold';
            } elseif ($overdue->count() > 0 || $complaints->count() > 0 || ($utilisation !== null && $utilisation >= 80)) {
                $status = 'Watch';
            }

            return [
                'customerId' => $c->Id,
                'code' => $c->Code,
                'name' => $c->Name,
                'creditLimit' => (float) ($c->CreditLimit ?? 0),
                'outstanding' => (float) ($c->Outstanding ?? 0),
                'utilisationPct' => $utilisation,
                'overdueOrders' => $overdue->count(),
                'overdueAmount' => (float) $overdue->sum('TotalAmount'),
                'openComplaints' => $complaints->count(),
                'ordersOnHold' => $holds->count(),
                'status' => $status,
            ];
        })
            ->sortBy(fn($r) => ['Hold' => 0, 'Watch' => 1, 'Good' => 2][$r['status']])
            ->values();

        return response()->json([
            'summary' => [
                'total' => $rows->count(),
                'hold' => $rows->where('status', 'Hold')->count(),
                'watch' => $rows->where('status', 'Watch')->count(),
                'good' => $rows->where('status', 'Good')->count(),
            ],
            'customers' => $rows,
        ]);
    }

    /**
     * Normalise a caller's own assigned District/Taluk. Mirrors
     * CustomerController::callerAreas() / OrderController::callerAreas().
     */
    private function callerAreas($caller, string $field): array
    {
        $employee = Employee::where('UserId', $caller->id)->first();
        $value = $employee->{$field} ?? $caller->{$field} ?? null;

        if (is_array($value)) {
            return array_values(array_filter($value, fn($v) => $v !== null && $v !== ''));
        }
        if (is_string($value) && $value !== '') {
            $decoded = json_decode($value, true);
            if (json_last_error() === JSON_ERROR_NONE && is_array($decoded)) {
                return array_values(array_filter($decoded, fn($v) => $v !== null && $v !== ''));
            }
            return [$value];
        }
        return [];
    }
}