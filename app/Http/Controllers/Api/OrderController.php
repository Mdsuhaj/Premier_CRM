<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Mail\OrderAllottedSystemAdminMail;
use App\Mail\OrderPlacedAdminMail;
use App\Mail\OrderPlacedEndUserMail;
use App\Models\AppNotification;
use App\Models\Customer;
use App\Models\Employee;
use App\Models\Order;
use App\Models\Product;
use App\Models\User;
use App\Services\SaleOrderService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Cache;

class OrderController extends Controller
{
    /** GET /api/orders */
    public function index(Request $request)
    {
        // NOTE: 'creator' added so the frontend (OrderList.jsx) can tell
        // whether an order was placed by the end_user themself ("My
        // Orders") or by one of their customers directly ("Customer
        // Orders") — see detectPlacement() on the frontend. Requires an
        // Order::creator() relationship, e.g.
        //   public function creator() { return $this->belongsTo(User::class, 'CreatedBy'); }
        // If that relationship doesn't exist on the Order model yet, add
        // it before deploying this change.
        $query = Order::with(['customer', 'product', 'assignee', 'creator']);
        $caller = $request->user();

        if ($status = $request->query('status')) {
            $query->where('Status', $status);
        }

        // Comma-separated list of statuses — used by the Order Enquiry
        // screen to pull everything still "in the enquiry pipeline"
        // (pending + assigned + approved) in one call.
        if ($statusIn = $request->query('status_in')) {
            $statuses = array_filter(array_map('trim', explode(',', $statusIn)));
            if (!empty($statuses)) {
                $query->whereIn('Status', $statuses);
            }
        }

        if ($paymentStatus = $request->query('payment_status')) {
            $query->where('PaymentStatus', $paymentStatus);
        }

        if ($category = $request->query('category')) {
            $query->where('Category', $category);
        }

        // Used by Add Order to check a specific customer's payment history
        // (credit-limit warning) and by any screen that wants one
        // customer's order book without pulling everything.
        if ($customerId = $request->query('customerId')) {
            $query->where('CustomerId', $customerId);
        }

        // End Users (Field Officers) see:
        //   - orders they personally created (CreatedBy = them), i.e.
        //     staff-placed orders (My Orders), AND
        //   - orders placed by any of their own customers directly via
        //     cart checkout (Customer Orders) — these have CreatedBy set
        //     to the customer's own user id, not the field officer's, so
        //     they have to be pulled in via CustomerId + Taluk instead.
        //
        // Pass ?scope=area to instead see every order (any creator, any
        // customer) for customers within their own assigned Taluk(s) —
        // used by the read-only "Order Enquiry" screen so a field officer
        // can see what's pending approval across their whole area, not
        // just their own entries / their own customers.
        if ($caller && $caller->role === 'end_user') {
            $taluks    = $this->callerAreas($caller, 'Taluk');
            $districts = $this->callerAreas($caller, 'District');

            // Collect customers in any of the end-user's assigned Taluks OR Districts.
            // This lets a Chennai end-user see orders from Chennai customers even when
            // the customer's Taluk field doesn't match exactly but their District does.
            $customerIds = Customer::where(function ($q) use ($taluks, $districts) {
                if (!empty($taluks)) {
                    $q->whereIn('Taluk', $taluks);
                }
                if (!empty($districts)) {
                    $q->orWhereIn('District', $districts);
                }
            })->pluck('Id');

            if ($request->query('scope') === 'area') {
                $query->whereIn('CustomerId', $customerIds->isEmpty() ? [0] : $customerIds);
            } else {
                // "own" scope (default): mine + my customers'.
                $query->where(function ($q) use ($caller, $customerIds) {
                    $q->where('CreatedBy', $caller->id)
                        ->orWhereIn('CustomerId', $customerIds->isEmpty() ? [0] : $customerIds);
                });
            }
        }

        // Admins only see orders for customers within their own assigned
        // District(s) — matches the same scoping already applied to which
        // customers they can see/order for. System/Super Admin unscoped.
        // (Admin district scoping removed: every Admin sees every order; the
        // District / State filters on Marketing Review narrow the view instead.)

        // Customers only ever see their own orders (for tracking delivery
        // status) — never the full company order book.
                // Customers only ever see their own orders (for tracking delivery
        // status) — never the full company order book.
        if ($caller && $caller->role === 'customer') {
            $customer = Customer::where('UserId', $caller->id)->first();
            $query->where('CustomerId', $customer->Id ?? 0);
        }

        // Order Enquiry's "Final Approval" queue for System Admin must only
        // show orders Admin has actually allocated stock to via Marketing
        // Review — otherwise a brand-new order is visible (and actionable)
        // to System Admin the moment it's placed, skipping Admin entirely.
        // Sent only by OrderEnquiry.jsx for system_admin — doesn't affect
        // Order List / Sales Order / Dashboard, which still need the full
        // unscoped view for that role.
        if ($request->boolean('allocated_only') && $caller && $caller->role === 'system_admin') {
            $query->whereExists(function ($q) {
                $q->from('sale_order_line')
                    ->whereColumn('sale_order_line.CrmOrderId', 'Orders.Id')
                    ->where('sale_order_line.USERPRIMARYQUANTITY', '>', 0);
            });
        }

        $orders = $query->orderByDesc('Id')->get();

        // Allocation stage data (Pending / Partial / Fully allocated / Approved /
        // ERP Transfer) for the Order List dropdown. Opt-in (?with_allocation=1) so
        // every other screen that calls GET /orders stays as light as before.
        // Read from the orders the caller can already see, so an End User only
        // gets this for their own scope — no extra data is exposed.
        if ($request->boolean('with_allocation') && $orders->isNotEmpty()) {
            $lines = DB::table('sale_order_line')
                ->whereIn('CrmOrderId', $orders->pluck('Id'))
                ->select('CrmOrderId', 'USERPRIMARYQUANTITY', 'CrmAllocationStatus', 'CrmErpStatus', 'CrmFirstAllocatedAt', 'CrmMeters')
                ->get()
                ->keyBy('CrmOrderId');

            $orders->each(function ($o) use ($lines) {
                $l = $lines->get($o->Id);
                $o->setAttribute('AllocationSummary', $l ? [
                    'allocatedQty'     => (int) ($l->USERPRIMARYQUANTITY ?? 0),
                    'status'           => $l->CrmAllocationStatus,
                    'erpStatus'        => $l->CrmErpStatus ?? 'not_transferred',
                    'firstAllocatedAt' => $l->CrmFirstAllocatedAt,
                    'meters'           => $l->CrmMeters,
                ] : null);
            });
        }

        return response()->json($orders);
    }

    /** GET /api/orders/{id} */
    public function show($id)
    {
        // NOTE: 'creator' added here too, for consistency with index()
        // (e.g. the view/edit order screen also benefits from knowing who
        // placed the order).
        $order = Order::with(['customer', 'product', 'invoice', 'creator'])->find($id);

        if (!$order) {
            return response()->json(['message' => 'Order not found'], 404);
        }

        return response()->json($order);
    }

    /**
     * POST /api/orders
     *
     * Staff-only (Field Officer / Admin / System Admin) — they set pricing
     * and discount directly. Customers place orders through the cart/
     * enquiry flow instead (see storeBulk below), where price always comes
     * from the Product itself and no self-discount is possible.
     */

    // public function store(Request $request)
    // {
    //     if ($request->user() && $request->user()->role === 'customer') {
    //         return response()->json(['message' => 'Please use the cart to submit an enquiry.'], 403);
    //     }

    //     $validated = $request->validate([
    //         'customerId' => 'required|integer|exists:Customers,Id',
    //         'productId' => 'required|integer|exists:Products,Id',
    //         'qty' => 'required|integer|min:1',
    //         'pricePerUnit' => 'required|numeric|min:0',
    //         'discount' => 'nullable|numeric|min:0|max:100',
    //         'deliveryDate' => 'nullable|date',
    //         'notes' => 'nullable|string',
    //         'orderDetails' => 'nullable|array',   // ← product-specific fields
    //         // Free-text "Pieces of Length" captured on Product Selection
    //         // (end-user) — folded into OrderDetails below so it round-trips
    //         // with the order without needing a dedicated column.
    //         'piecesOfLength' => 'nullable|string|max:100',
    //         // UOM (Box / Pieces / Meter) the officer picked on Product
    //         // Selection's UOM dropdown for this line — same OrderDetails
    //         // round-trip as piecesOfLength, and as storeBulk() (customer
    //         // cart checkout) already does below.
    //         'uom' => 'nullable|string|max:50',
    //         // Per-line remarks typed on Product Selection's Remarks column —
    //         // same OrderDetails round-trip pattern as piecesOfLength/uom.
    //         'remarks' => 'nullable|string|max:500',
    //     ]);

    //     $orderCustomer = Customer::find($validated['customerId']);
    //     $caller = $request->user();

    //     // Field Officer (end_user) can only place orders for customers in
    //     // their own assigned Taluk(s); Admin only within their own assigned
    //     // District(s). System/Super Admin unscoped.
    //     if ($caller && $caller->role === 'end_user') {
    //         $taluks = $this->callerAreas($caller, 'Taluk');
    //         if (!$orderCustomer || !in_array($orderCustomer->Taluk, $taluks, true)) {
    //             return response()->json(['message' => 'You can only place orders for customers in your own assigned Taluk(s).'], 403);
    //         }
    //     }
    //     if ($caller && $caller->role === 'admin') {
    //         $districts = $this->callerAreas($caller, 'District');
    //         if (!$orderCustomer || !in_array($orderCustomer->District, $districts, true)) {
    //             return response()->json(['message' => 'You can only place orders for customers in your own assigned District(s).'], 403);
    //         }
    //     }

    //     $product = Product::find($validated['productId']);

    //     $qty = (float) $validated['qty'];
    //     $pricePerUnit = (float) $validated['pricePerUnit'];
    //     $discountPct = (float) ($validated['discount'] ?? 0);
    //     $totalAmount = round($qty * $pricePerUnit * (1 - $discountPct / 100), 2);

    //     $order = $this->createOrderWithUniqueCode([
    //         'CustomerId' => $validated['customerId'],
    //         'ProductId' => $validated['productId'],
    //         'Category' => $product->Category,
    //         'SubType' => $product->SubType,
    //         'Quantity' => $validated['qty'],
    //         'PricePerUnit' => $pricePerUnit,
    //         'DiscountPct' => $discountPct,
    //         'TotalAmount' => $totalAmount,
    //         'Status' => 'pending',
    //         'PaymentStatus' => 'unpaid',
    //         'DeliveryDate' => $validated['deliveryDate'] ?? null,
    //         'Notes' => $validated['notes'] ?? null,
    //         'CreatedBy' => $request->user()->id,
    //         // NOTE: OrderDetails is cast as 'array' on the Order model, so
    //         // Eloquent handles the JSON encode/decode itself — pass the
    //         // plain array (or null), never a pre-encoded JSON string here.
    //         'OrderDetails' => (function () use ($validated) {
    //             $details = $validated['orderDetails'] ?? [];
    //             if (!empty($validated['piecesOfLength'])) {
    //                 $details['PiecesOfLength'] = $validated['piecesOfLength'];
    //             }
    //             if (!empty($validated['uom'])) {
    //                 $details['UOM'] = $validated['uom'];
    //             }
    //             if (!empty($validated['remarks'])) {
    //                 $details['Remarks'] = $validated['remarks'];
    //             }
    //             return $details ?: null;
    //         })(),
    //     ]);

    //     // Flow: END USER -> Places Order -> CRM creates Order -> Email -> Admin
    //     $this->sendToUsers(
    //         $this->adminsForDistrict($orderCustomer->District ?? null),
    //         new OrderPlacedAdminMail($order, $caller->role === 'end_user' ? 'End User' : 'Admin')
    //     );

    //     return response()->json($order->load(['customer', 'product']), 201);
    // }


    public function store(Request $request)
    {
        if ($request->user() && $request->user()->role === 'customer') {
            return response()->json(['message' => 'Please use the cart to submit an enquiry.'], 403);
        }

        $validated = $request->validate([
            // Either a local customer/product (legacy) …
            'customerId' => 'nullable|integer|exists:Customers,Id',
            'productId' => 'nullable|integer|exists:Products,Id',
            // … or the Oracle ones the catalog now uses (verified server-side).
            'oracleCustomerId' => 'nullable|string|max:50',
            'oracleProduct' => 'nullable|array',
            'oracleProduct.id' => 'nullable',
            'oracleProduct.rowKey' => 'nullable|string|max:64',
            'oracleProduct.sortNo' => 'nullable',
            'oracleProduct.shadeNo' => 'nullable',
            'oracleProduct.name' => 'nullable|string|max:500',
            'qty' => 'required|integer|min:1',
            'pricePerUnit' => 'nullable|numeric|min:0',   // Oracle feed has no price → falls back to the product's own (0)
            'discount' => 'nullable|numeric|min:0|max:100',
            'deliveryDate' => 'nullable|date',
            'notes' => 'nullable|string',
            'orderDetails' => 'nullable|array',
            // Same value on every POST of one cart → all its products become lines of ONE ERP header.
            'cartRef' => 'nullable|string|max:80',
            'piecesOfLength' => 'nullable|string|max:100',
            'uom' => 'nullable|string|max:50',
            'remarks' => 'nullable|string|max:500',
        ]);

        if (empty($validated['customerId']) && empty($validated['oracleCustomerId'])) {
            return response()->json(['message' => 'Customer is required.'], 422);
        }
        if (empty($validated['productId']) && empty($validated['oracleProduct'])) {
            return response()->json(['message' => 'Product is required.'], 422);
        }

        $caller = $request->user();
        $isOracleCustomer = !empty($validated['oracleCustomerId']);

        $orderCustomer = $isOracleCustomer
            ? $this->resolveOracleCustomer((string) $validated['oracleCustomerId'], $caller)   // also enforces the officer's area
            : Customer::find($validated['customerId']);

        // Local customers keep the original Taluk/District scoping.
        // (Oracle customers were already area-checked in resolveOracleCustomer.)
        if (!$isOracleCustomer) {
            if ($caller && $caller->role === 'end_user') {
                $taluks = $this->callerAreas($caller, 'Taluk');
                if (!$orderCustomer || !in_array($orderCustomer->Taluk, $taluks, true)) {
                    return response()->json(['message' => 'You can only place orders for customers in your own assigned Taluk(s).'], 403);
                }
            }
            if ($caller && $caller->role === 'admin') {
                $districts = $this->callerAreas($caller, 'District');
                if (!$orderCustomer || !in_array($orderCustomer->District, $districts, true)) {
                    return response()->json(['message' => 'You can only place orders for customers in your own assigned District(s).'], 403);
                }
            }
        }

        $product = !empty($validated['oracleProduct'])
            ? $this->resolveOracleProduct($validated['oracleProduct'], $caller)
            : Product::find($validated['productId']);

        $qty = (float) $validated['qty'];
        $pricePerUnit = (float) ($validated['pricePerUnit'] ?? $product->Price ?? 0);
        $discountPct = (float) ($validated['discount'] ?? 0);
        $totalAmount = round($qty * $pricePerUnit * (1 - $discountPct / 100), 2);

        $order = DB::transaction(function () use ($validated, $product, $orderCustomer, $caller, $request, $pricePerUnit, $discountPct, $totalAmount) {
        $order = $this->createOrderWithUniqueCode([
            'CustomerId' => $orderCustomer->Id,
            'ProductId' => $product->Id,
            'Category' => $product->Category,
            'SubType' => $product->SubType,
            'Quantity' => $validated['qty'],
            'PricePerUnit' => $pricePerUnit,
            'DiscountPct' => $discountPct,
            'TotalAmount' => $totalAmount,
            'Status' => 'pending',
            'PaymentStatus' => 'unpaid',
            'DeliveryDate' => $validated['deliveryDate'] ?? null,
            'Notes' => $validated['notes'] ?? null,
            'CreatedBy' => $request->user()->id,
            'OrderDetails' => (function () use ($validated, $product, $orderCustomer) {
                $details = $validated['orderDetails'] ?? [];
                if (!empty($validated['piecesOfLength'])) {
                    $details['PiecesOfLength'] = $validated['piecesOfLength'];
                }
                if (!empty($validated['uom'])) {
                    $details['UOM'] = $validated['uom'];
                }
                if (!empty($validated['remarks'])) {
                    $details['Remarks'] = $validated['remarks'];
                }
                // Oracle snapshot — what was actually ordered, as Oracle knows it.
                if (!empty($validated['oracleProduct'])) {
                    $details['OracleProductId'] = (string) ($validated['oracleProduct']['id'] ?? '');
                    $details['SortNo'] = $product->SortNo;
                    $details['ShadeNo'] = $product->ShadeNo;
                    $details['ProductName'] = $product->Name;
                }
                if (!empty($validated['oracleCustomerId'])) {
                    $details['OracleCustomerId'] = (string) $validated['oracleCustomerId'];
                    $details['CustomerName'] = $orderCustomer->Name;
                }
                return $details ?: null;
            })(),
        ]);

        // ERP staging: add this product as a LINE on the order's header
        // (sale_order_header / sale_order_line). Wrapped in try/catch so an
        // Oracle timeout doesn't block order creation — if staging fails,
        // resolveLine() in AllocationController will re-stage it on the fly
        // the first time Admin allocates against this order.
        try {
            app(SaleOrderService::class)->stageOrder(
                $order, $product, $orderCustomer, $caller,
                $validated['orderDetails']['GroupRef'] ?? $validated['cartRef'] ?? null,
                $validated['notes'] ?? null
            );
        } catch (\Throwable $e) {
            \Log::warning('stageOrder failed on order creation — will retry at allocation time', [
                'orderId' => $order->Id,
                'error'   => $e->getMessage(),
            ]);
        }

        return $order;
        });

        // Flow: END USER -> Places Order -> CRM creates Order -> Email -> Admin
        $this->sendToUsers(
            $this->adminsForDistrict($orderCustomer->District ?? null),
            new OrderPlacedAdminMail($order, $caller->role === 'end_user' ? 'End User' : 'Admin')
        );

        return response()->json($order->load(['customer', 'product']), 201);
    }

    /**
     * POST /api/orders/cart
     *
     * Field Officer / Admin cart checkout in ONE request. Before this, the
     * front-end posted every cart line to POST /orders one after another, and
     * each call re-queried Oracle for the customer, queried Oracle for the
     * product, staged the ERP line and sent e-mails synchronously — so a cart
     * of N lines took N times as long. Here the customer is resolved once, all
     * lines are created in a single transaction (all-or-nothing) under one
     * shared CartRef / ERP header, and notification e-mails go out after the
     * response.
     */
    public function storeCart(Request $request)
    {
        $caller = $request->user();
        if ($caller && $caller->role === 'customer') {
            return response()->json(['message' => 'Please use the cart to submit an enquiry.'], 403);
        }

        $v = $request->validate([
            'oracleCustomerId' => 'required|string|max:50',
            'deliveryDate' => 'nullable|date',
            'notes' => 'nullable|string',
            'cartRef' => 'nullable|string|max:80',
            'items' => 'required|array|min:1|max:300',
            'items.*.oracleProduct' => 'required|array',
            'items.*.oracleProduct.id' => 'nullable',
            'items.*.oracleProduct.rowKey' => 'nullable|string|max:64',
            'items.*.oracleProduct.sortNo' => 'nullable',
            'items.*.oracleProduct.shadeNo' => 'nullable',
            'items.*.oracleProduct.name' => 'nullable|string|max:500',
            'items.*.qty' => 'required|integer|min:1',
            'items.*.uom' => 'nullable|string|max:50',
            'items.*.piecesOfLength' => 'nullable|string|max:100',
            'items.*.remarks' => 'nullable|string|max:500',
        ]);

        $orderCustomer = $this->resolveOracleCustomer((string) $v['oracleCustomerId'], $caller);
        $cartRef = $v['cartRef'] ?? ('CART-' . now()->timestamp . '-' . $orderCustomer->Id);

        $orders = DB::transaction(function () use ($v, $orderCustomer, $caller, $cartRef) {
            $created = [];
            foreach ($v['items'] as $item) {
                $product = $this->resolveOracleProduct($item['oracleProduct'], $caller);
                $qty = (float) $item['qty'];
                $pricePerUnit = (float) ($product->Price ?? 0);

                $details = [];
                if (!empty($item['piecesOfLength'])) { $details['PiecesOfLength'] = $item['piecesOfLength']; }
                if (!empty($item['uom'])) { $details['UOM'] = $item['uom']; }
                if (!empty($item['remarks'])) { $details['Remarks'] = $item['remarks']; }
                $details['OracleProductId'] = (string) ($item['oracleProduct']['id'] ?? '');
                $details['SortNo'] = $product->SortNo;
                $details['ShadeNo'] = $product->ShadeNo;
                $details['ProductName'] = $product->Name;
                $details['OracleCustomerId'] = (string) $v['oracleCustomerId'];
                $details['CustomerName'] = $orderCustomer->Name;

                $order = $this->createOrderWithUniqueCode([
                    'CustomerId' => $orderCustomer->Id,
                    'ProductId' => $product->Id,
                    'Category' => $product->Category,
                    'SubType' => $product->SubType,
                    'Quantity' => $item['qty'],
                    'PricePerUnit' => $pricePerUnit,
                    'DiscountPct' => 0,
                    'TotalAmount' => round($qty * $pricePerUnit, 2),
                    'Status' => 'pending',
                    'PaymentStatus' => 'unpaid',
                    'DeliveryDate' => $v['deliveryDate'] ?? null,
                    'Notes' => $v['notes'] ?? null,
                    'CreatedBy' => $caller->id,
                    'OrderDetails' => $details,
                ]);

                try {
                    app(SaleOrderService::class)->stageOrder($order, $product, $orderCustomer, $caller, $cartRef, $v['notes'] ?? null);
                } catch (\Throwable $e) {
                    Log::warning('stageOrder failed on cart order creation — will retry at allocation time', [
                        'orderId' => $order->Id, 'error' => $e->getMessage(),
                    ]);
                }
                $created[] = $order;
            }
            return $created;
        });

        // Same notification the single-order endpoint sends (now deferred).
        foreach ($orders as $order) {
            $this->sendToUsers(
                $this->adminsForDistrict($orderCustomer->District ?? null),
                new OrderPlacedAdminMail($order, $caller->role === 'end_user' ? 'End User' : 'Admin')
            );
        }

        return response()->json(['count' => count($orders), 'orders' => $orders], 201);
    }

    /**
     * POST /api/orders/bulk
     *
     * Customer "Add to Cart → Submit Enquiry" checkout. Accepts multiple
     * products in one go and creates one Order (= one enquiry line) per
     * item, all tied together by a shared CartRef.
     *
     * Deliberately customer-only:
     *   - CustomerId is always the caller's own linked Customer — never
     *     client-supplied, so a customer can never order on someone else's
     *     behalf.
     *   - PricePerUnit always comes from the Product's own price — the
     *     customer can never set their own price.
     *   - DiscountPct is always 0 — discounting only happens later, when
     *     Marketing reviews the enquiry (Step 3 of the O2C flow).
     */
    public function storeBulk(Request $request)
    {
        $caller = $request->user();

        if (!$caller || $caller->role !== 'customer') {
            return response()->json(['message' => 'This endpoint is for customer cart checkout only.'], 403);
        }

        $customer = Customer::where('UserId', $caller->id)->first();
        if (!$customer) {
            return response()->json(['message' => 'No customer profile is linked to this account.'], 422);
        }
        if ($customer->Status !== 'approved') {
            return response()->json(['message' => 'Your account is not yet approved to place orders.'], 403);
        }

        $validated = $request->validate([
            'items' => 'required|array|min:1',
            // Local product (legacy) OR an Oracle product (verified server-side).
            'items.*.productId' => 'nullable|integer|exists:Products,Id',
            'items.*.oracleProduct' => 'nullable|array',
            'items.*.oracleProduct.id' => 'nullable',
            'items.*.oracleProduct.rowKey' => 'nullable|string|max:64',
            'items.*.oracleProduct.sortNo' => 'nullable',
            'items.*.oracleProduct.shadeNo' => 'nullable',
            'items.*.oracleProduct.name' => 'nullable|string|max:500',
            'items.*.qty' => 'required|integer|min:1',
            'items.*.color' => 'nullable|string|max:100',
            'items.*.size' => 'nullable|string|max:50',
            // Free-text "Pieces of Length" captured on the customer's own
            // Product Catalog page — same OrderDetails round-trip as above.
            'items.*.piecesOfLength' => 'nullable|string|max:100',
            // UOM (Box / Pieces / Meter) the customer picked on the Product
            // Selection page's UOM dropdown for this line — stored on
            // OrderDetails the same way, so it round-trips back out
            // correctly wherever this order's UOM is shown.
            'items.*.uom' => 'nullable|string|max:50',
            // Per-product remarks typed on the customer's Product Catalog
            // Remarks column — same OrderDetails round-trip as color/size/uom.
            'items.*.remarks' => 'nullable|string|max:500',
            'deliveryDate' => 'nullable|date',
            'notes' => 'nullable|string',
        ]);

        $cartRef = 'CART-' . now()->format('YmdHis') . '-' . $customer->Id;

        $orders = DB::transaction(function () use ($validated, $customer, $caller, $cartRef) {
            $created = [];
            foreach ($validated['items'] as $item) {
                if (!empty($item['oracleProduct'])) {
                    $product = $this->resolveOracleProduct($item['oracleProduct'], $caller);
                } elseif (!empty($item['productId'])) {
                    $product = Product::find($item['productId']);
                } else {
                    continue; // neither a local nor an Oracle product on this line
                }
                if (!$product || $product->Status !== 'active') {
                    continue; // skip anything that vanished / went inactive mid-checkout
                }

                $qty = (int) $item['qty'];
                $pricePerUnit = (float) $product->Price;
                $totalAmount = round($qty * $pricePerUnit, 2);

                $orderDetails = ['GroupRef' => $cartRef];
                if (!empty($item['color']))
                    $orderDetails['Color'] = $item['color'];
                if (!empty($item['size']))
                    $orderDetails['Size'] = $item['size'];
                if (!empty($item['piecesOfLength']))
                    $orderDetails['PiecesOfLength'] = $item['piecesOfLength'];
                if (!empty($item['uom']))
                    $orderDetails['UOM'] = $item['uom'];
                if (!empty($item['remarks']))
                    $orderDetails['Remarks'] = $item['remarks'];
                                if (!empty($item['oracleProduct'])) {
                    $orderDetails['OracleProductId'] = (string) ($item['oracleProduct']['id'] ?? '');
                    $orderDetails['SortNo'] = $product->SortNo;
                    $orderDetails['ShadeNo'] = $product->ShadeNo;
                    $orderDetails['ProductName'] = $product->Name;
                }

                $order = $this->createOrderWithUniqueCode([
                    'CustomerId' => $customer->Id,
                    'ProductId' => $product->Id,
                    'Category' => $product->Category,
                    'SubType' => $product->SubType,
                    'Quantity' => $qty,
                    'PricePerUnit' => $pricePerUnit,
                    'DiscountPct' => 0,
                    'TotalAmount' => $totalAmount,
                    'Status' => 'pending',
                    'PaymentStatus' => 'unpaid',
                    'DeliveryDate' => $validated['deliveryDate'] ?? null,
                    'Notes' => $validated['notes'] ?? null,
                    'CreatedBy' => $caller->id,
                    // Plain array — the model's 'array' cast encodes it for us.
                    'OrderDetails' => $orderDetails,
                ]);

                // ERP staging: this product becomes a LINE on the cart's ONE
                // header (sale_order_header / sale_order_line). Wrapped in
                // try/catch so Oracle timeout doesn't block the entire cart
                // submission — resolveLine() retries staging at allocation time.
                try {
                    app(SaleOrderService::class)->stageOrder($order, $product, $customer, $caller, $cartRef, $validated['notes'] ?? null);
                } catch (\Throwable $e) {
                    \Log::warning('stageOrder failed on cart order creation — will retry at allocation time', [
                        'orderId' => $order->Id,
                        'error'   => $e->getMessage(),
                    ]);
                }

                $created[] = $order;
            }
            return $created;
        });

        if (empty($orders)) {
            return response()->json(['message' => 'None of the items in your cart are available anymore.'], 422);
        }

        // Flow: CUSTOMER -> Places Order -> CRM creates Order -> Email -> End User + Email -> Admin
        // One order (the first) represents the whole cart submission for
        // notification purposes — all lines share the same customer/taluk.
        $firstOrder = $orders[0];
        $this->sendToUsers(
            $this->endUsersForTaluk($customer->Taluk ?? null),
            new OrderPlacedEndUserMail($firstOrder)
        );
        $this->sendToUsers(
            $this->adminsForDistrict($customer->District ?? null),
            new OrderPlacedAdminMail($firstOrder, 'Customer')
        );

        return response()->json([
            'message' => count($orders) . ' item(s) submitted as an enquiry.',
            'orders' => collect($orders)->map(fn($o) => $o->load(['customer', 'product'])),
        ], 201);
    }

    /** PUT /api/orders/{id} */
    public function update(Request $request, $id)
    {
        $order = Order::find($id);

        if (!$order) {
            return response()->json(['message' => 'Order not found'], 404);
        }

        $validated = $request->validate([
            'qty' => 'sometimes|required|integer|min:1',
            'pricePerUnit' => 'sometimes|required|numeric|min:0',
            'discount' => 'nullable|numeric|min:0|max:100',
            'status' => 'sometimes|required|in:approved,pending,assigned,processing,dispatched,delivered,declined',
            'paymentStatus' => 'sometimes|required|in:paid,unpaid,partial,refund',
            'deliveryDate' => 'nullable|date',
            'notes' => 'nullable|string',
            'orderDetails' => 'nullable|array',   // ← product-specific fields
        ]);

        $caller = $request->user();

        // Same final-approval gate as updateStatus() — this generic PUT is
        // also how Add Order finalizes a placed enquiry, so it needs the
        // same Marketing Head (system_admin) restriction.
        if (($validated['status'] ?? null) === 'approved' && (!$caller || $caller->role !== 'system_admin')) {
            return response()->json([
                'message' => 'Only the Marketing Head (System Admin) can give final approval on a sales order.',
            ], 403);
        }

        // Same allocation guard as updateStatus(): System Admin can only
        // give final approval once Admin has actually allocated stock to
        // this order in Marketing Review. Without this, AddOrder.jsx's
        // "finalize enquiry" submit (PUT /orders/{id}) lets System Admin
        // set status="approved" the moment THEY are the one filling in
        // Add Order — completely skipping Admin's allocation step. This
        // was the second, unguarded route to the same bug fixed on
        // updateStatus() last time; PUT /orders/{id} and
        // PATCH /orders/{id}/status both need the check.
        if (($validated['status'] ?? null) === 'approved') {
            $hasAllocation = DB::table('sale_order_line')
                ->where('CrmOrderId', $order->Id)
                ->where('USERPRIMARYQUANTITY', '>', 0)
                ->exists();
            if (!$hasAllocation) {
                return response()->json([
                    'message' => 'This order has no stock allocated yet — it must go through Marketing Review (Admin allocation) first.',
                ], 422);
            }
        }

        // ERP hand-off (O2C Step 4, "Transfer to ERP") is a Marketing Head
        // / System Admin-only action — Marketing can review and allocate,
        // but pushing the approved Sales Order into ERP is reserved for
        // System Admin, matching the Final Approval screen in the O2C scope.
        if (isset($validated['orderDetails']['ErpSynced']) && $validated['orderDetails']['ErpSynced']) {
            if (!$caller || $caller->role !== 'system_admin') {
                return response()->json([
                    'message' => 'Only the System Admin can transfer an approved order to ERP.',
                ], 403);
            }
            if ($order->Status !== 'approved') {
                return response()->json([
                    'message' => 'Only an approved order can be transferred to ERP.',
                ], 422);
            }
        }

        $qty = $validated['qty'] ?? $order->Quantity;
        $pricePerUnit = $validated['pricePerUnit'] ?? $order->PricePerUnit;
        $discountPct = $validated['discount'] ?? $order->DiscountPct;

        $update = [
            'Quantity' => $qty,
            'PricePerUnit' => $pricePerUnit,
            'DiscountPct' => $discountPct,
            'TotalAmount' => round($qty * $pricePerUnit * (1 - $discountPct / 100), 2),
        ];

        if (isset($validated['status'])) {
            $update['Status'] = $validated['status'];
            if ($validated['status'] === 'approved') {
                $update['ApprovedBy'] = $request->user()->id;
            }
        }

        if (isset($validated['paymentStatus'])) {
            $wasPaid = $order->PaymentStatus === 'paid';
            $willBePaid = $validated['paymentStatus'] === 'paid';

            $update['PaymentStatus'] = $validated['paymentStatus'];

            // Keep AmountPaid and the customer's Outstanding balance in
            // sync with a manual status override, same as recordPayment()
            // does for an incremental payment.
            if ($willBePaid && !$wasPaid) {
                $already = (float) ($order->AmountPaid ?? 0);
                $remaining = round((float) $order->TotalAmount - $already, 2);
                $update['AmountPaid'] = $order->TotalAmount;
                if ($remaining > 0 && $order->customer) {
                    $order->customer->decrement('Outstanding', $remaining);
                }
            } elseif (!$willBePaid && $wasPaid) {
                $update['AmountPaid'] = 0;
                if ($order->customer) {
                    $order->customer->increment('Outstanding', (float) $order->TotalAmount);
                }
            }
        }

        if (array_key_exists('deliveryDate', $validated)) {
            $update['DeliveryDate'] = $validated['deliveryDate'];
        }

        if (array_key_exists('notes', $validated)) {
            $update['Notes'] = $validated['notes'];
        }

        if (array_key_exists('orderDetails', $validated)) {
            // Plain array (or null) — the model's 'array' cast encodes it.
            $update['OrderDetails'] = $validated['orderDetails'] ?: null;
        }

        $order->update($update);

        return response()->json($order->load(['customer', 'product']));
    }

    /** DELETE /api/orders/{id} */
    public function destroy($id)
    {
        $order = Order::find($id);

        if (!$order) {
            return response()->json(['message' => 'Order not found'], 404);
        }

        $order->delete();

        return response()->json(['message' => 'Order deleted']);
    }

    /** PATCH /api/orders/{id}/status */
    /**
     * PATCH /api/orders/{id}/assign
     *
     * Order Enquiry step 1: before anyone can approve a freshly-submitted
     * enquiry (Status = 'pending'), it has to be assigned to whoever is
     * going to handle it — usually the caller themselves ("Assign to me").
     * Admin / System Admin can also hand it to a specific staff member by
     * passing assignedTo explicitly. Only valid starting from 'pending' —
     * an enquiry that's already assigned/approved doesn't get reassigned
     * from this screen (avoids two people fighting over the same order).
     */
    public function assign(Request $request, $id)
    {
        $order = Order::find($id);

        if (!$order) {
            return response()->json(['message' => 'Order not found'], 404);
        }

        $caller = $request->user();
        $allowedRoles = ['admin', 'system_admin', 'end_user'];
        if (!$caller || !in_array($caller->role, $allowedRoles, true)) {
            return response()->json(['message' => 'Not permitted to assign enquiries.'], 403);
        }

        if ($order->Status !== 'pending') {
            return response()->json(['message' => "Only a pending enquiry can be assigned (this one is '{$order->Status}')."], 422);
        }

        $validated = $request->validate([
            'assignedTo' => 'nullable|integer|exists:users,id',
        ]);

        $order->update([
            'Status' => 'assigned',
            'AssignedTo' => $validated['assignedTo'] ?? $caller->id,
            'AssignedAt' => now(),
        ]);

        // NOTE: System Admin is intentionally NOT notified here. Assigning
        // an enquiry to yourself is just the first step of Admin's own
        // review (before Add Order details / Marketing Review allocation
        // have even happened) — the order has not been approved by Admin
        // yet, so it must not reach System Admin at this point.
        //
        // The correct "Admin -> System Admin" hand-off happens only once
        // Admin actually allocates stock in Marketing Review and clicks
        // Approval — see AllocationController@store /
        // notifySystemAdminsOfAllocation(), which is the single place
        // System Admin is emailed/receives visibility on an order.

        return response()->json($order->load(['customer', 'product', 'assignee']));
    }

    public function updateStatus(Request $request, $id)
    {
        $order = Order::find($id);

        if (!$order) {
            return response()->json(['message' => 'Order not found'], 404);
        }

        $validated = $request->validate([
            'status' => 'required|in:pending,assigned,approved,processing,dispatched,delivered,declined',
        ]);

        // O2C Step 4 — "Inquiry approval and SO creation in ERP": Marketing
        // (admin) reviews/allocates and places the enquiry, but the FINAL
        // approval that turns it into a real Sales Order is reserved for
        // the Marketing Head, modelled here as the 'system_admin' role.
        // Until this gate, the enquiry sits in the Marketing Head's
        // "Pending Final Approvals" queue (see OrderEnquiry.jsx).
               $caller = $request->user();
        if ($validated['status'] === 'approved' && (!$caller || $caller->role !== 'system_admin')) {
            return response()->json([
                'message' => 'Only the Marketing Head (System Admin) can give final approval on a sales order.',
            ], 403);
        }

        // Server-side enforcement of the same rule: System Admin can only
        // give final approval once Admin has actually allocated stock to
        // this order in Marketing Review. Without this, a direct API call
        // (or a stale frontend) could still approve an order with 0
        // allocated, same bug as the Order Enquiry loophole above.
        if ($validated['status'] === 'approved') {
            $hasAllocation = DB::table('sale_order_line')
                ->where('CrmOrderId', $order->Id)
                ->where('USERPRIMARYQUANTITY', '>', 0)
                ->exists();
            if (!$hasAllocation) {
                return response()->json([
                    'message' => 'This order has no stock allocated yet — it must go through Marketing Review (Admin allocation) first.',
                ], 422);
            }
        }

        // Goods must actually be dispatched (LR number recorded via the

        $update = ['Status' => $validated['status']];

        if ($validated['status'] === 'approved') {
            $update['ApprovedBy'] = $caller->id;
        }

        $order->update($update);

        if ($validated['status'] === 'approved') {
            $this->notifyCustomer(
                $order,
                'order_approved',
                'Your order has been approved',
                "Order {$order->Code} has been approved and will move to dispatch."
            );
        }
        if ($validated['status'] === 'declined') {
            $this->notifyCustomer(
                $order,
                'order_declined',
                'Your order was declined',
                "Order {$order->Code} was declined." . ($order->RejectionReason ? " Reason: {$order->RejectionReason}" : '')
            );
        }

        return response()->json($order->load(['customer', 'product']));
    }

    /**
     * PATCH /api/orders/{id}/reject
     * Body: { reason }
     *
     * Explicit reject action (O2C Step 4/6 — "If PO Approve/Rejected an
     * information triggered to customer") — separate from the generic
     * updateStatus() so a reason is always required and the customer is
     * always notified, matching the flow diagram.
     */
    public function reject(Request $request, $id)
    {
        $order = Order::find($id);
        if (!$order) {
            return response()->json(['message' => 'Order not found'], 404);
        }

        $caller = $request->user();
        if (!$caller || !in_array($caller->role, ['admin', 'system_admin', 'end_user'], true)) {
            return response()->json(['message' => 'Not permitted to reject enquiries.'], 403);
        }

        $validated = $request->validate([
            'reason' => 'required|string|max:255',
        ]);

        $order->update([
            'Status' => 'declined',
            'RejectionReason' => $validated['reason'],
        ]);

        $this->notifyCustomer(
            $order,
            'order_declined',
            'Your order was declined',
            "Order {$order->Code} was declined. Reason: {$validated['reason']}"
        );

        return response()->json($order->load(['customer', 'product']));
    }

    /**
     * PATCH /api/orders/{id}/dispatch
     *
     * Goods Dispatch (O2C Step 7): packing team hands the order to
     * transport. Records the LR number + transport name and flips Status
     * to 'dispatched'. Only allowed from 'approved' or 'processing'.
     */
    public function dispatch(Request $request, $id)
    {
        if ($request->user() && $request->user()->role === 'customer') {
            return response()->json(['message' => 'Not permitted.'], 403);
        }

        $order = Order::find($id);

        if (!$order) {
            return response()->json(['message' => 'Order not found'], 404);
        }

        if (!in_array($order->Status, ['approved', 'processing'], true)) {
            return response()->json(['message' => 'Only an approved / processing order can be dispatched.'], 422);
        }

        // Customer-wise Credit and Discount Validation (O2C Step 9) — must
        // pass before goods can leave. If it fails, the order goes on hold
        // instead of being dispatched; Marketing has to explicitly release
        // the hold (see releaseHold()) to proceed, which is itself the
        // audit trail of that review.
        if ($holdReason = $this->creditHoldReason($order)) {
            $order->update(['OnHold' => true, 'HoldReason' => $holdReason, 'HoldPlacedAt' => now()]);
            return response()->json([
                'message' => 'Order held for credit/discount review, not dispatched.',
                'holdReason' => $holdReason,
                'order' => $order->fresh(['customer', 'product']),
            ], 422);
        }

        $validated = $request->validate([
            'lrNumber' => 'required|string|max:100',
            'transportName' => 'required|string|max:150',
            'dispatchedAt' => 'nullable|date',
        ]);

        $dispatchedAt = $validated['dispatchedAt'] ?? now();

        $order->update([
            'Status' => 'dispatched',
            'OnHold' => false,
            'LRNumber' => $validated['lrNumber'],
            'TransportName' => $validated['transportName'],
            'DispatchedAt' => $dispatchedAt,
            'DispatchedBy' => $request->user()->id,
            'WarehouseSource' => $order->product->warehouse ?? null,
            // Bill's payment clock starts at dispatch — default credit
            // term (15 days unless already customized) counts from here.
            // Never overwrite a due date someone has already manually set.
            'PaymentDueDate' => $order->PaymentDueDate
                ?? \Carbon\Carbon::parse($dispatchedAt)->addDays((int) ($order->PaymentTermDays ?? 15))->toDateString(),
        ]);

        // The bill is now actually owed — this is the moment it counts
        // against the customer's credit limit (creditHoldReason() checks
        // Outstanding + a *new* order's total, so Outstanding has to
        // reflect bills that are already out the door).
        if ($order->customer && $order->PaymentStatus !== 'paid') {
            $order->customer->increment('Outstanding', (float) $order->TotalAmount);
        }

        $this->notifyCustomer(
            $order,
            'order_dispatched',
            'Your order has been dispatched',
            "Order {$order->Code} has been dispatched via {$validated['transportName']} (LR: {$validated['lrNumber']})."
        );

        return response()->json($order->load(['customer', 'product', 'dispatcher']));
    }

    /**
     * PATCH /api/orders/{id}/release-hold
     * Body: { note? }
     *
     * Marketing/System Admin explicitly clears a credit/discount hold
     * (e.g. after the customer pays down their overdue balance, or a
     * manager approves an exception) so the order can be dispatched.
     */
    public function releaseHold(Request $request, $id)
    {
        $order = Order::find($id);
        if (!$order) {
            return response()->json(['message' => 'Order not found'], 404);
        }

        $caller = $request->user();
        if (!$caller || !in_array($caller->role, ['admin', 'system_admin'], true)) {
            return response()->json(['message' => 'Not permitted to release a hold.'], 403);
        }

        $validated = $request->validate(['note' => 'nullable|string|max:255']);

        $order->update([
            'OnHold' => false,
            'HoldReason' => trim(($order->HoldReason ?? '') . ' — released' . (!empty($validated['note']) ? ": {$validated['note']}" : '')),
        ]);

        return response()->json($order->fresh(['customer', 'product']));
    }

    /**
     * Returns a hold reason string if this order's customer fails credit
     * limit, overdue-balance, or discount-policy checks — null if clear.
     */
    private function creditHoldReason(Order $order): ?string
    {
        $customer = $order->customer;
        if (!$customer)
            return null;

        $reasons = [];

        if ($customer->CreditLimit !== null) {
            $projected = (float) $customer->Outstanding + (float) $order->TotalAmount;
            if ($projected > (float) $customer->CreditLimit) {
                $reasons[] = sprintf(
                    'Credit limit exceeded: outstanding %.2f + this order %.2f > limit %.2f',
                    (float) $customer->Outstanding,
                    (float) $order->TotalAmount,
                    (float) $customer->CreditLimit
                );
            }
        }

        $hasOverdue = Order::where('CustomerId', $customer->Id)
            ->where('Id', '!=', $order->Id)
            ->whereNotNull('PaymentDueDate')
            ->where('PaymentDueDate', '<', now()->toDateString())
            ->where('PaymentStatus', '!=', 'paid')
            ->exists();
        if ($hasOverdue) {
            $reasons[] = 'Customer has an overdue, unpaid bill on a previous order.';
        }

        if ($customer->MaxDiscountPct !== null && (float) $order->DiscountPct > (float) $customer->MaxDiscountPct) {
            $reasons[] = sprintf(
                'Discount %.2f%% exceeds this customer\'s approved policy of %.2f%%',
                (float) $order->DiscountPct,
                (float) $customer->MaxDiscountPct
            );
        }

        return empty($reasons) ? null : implode(' | ', $reasons);
    }

    /** Fire-and-forget in-app notification to the customer who owns this order. */
    private function notifyCustomer(Order $order, string $type, string $title, string $message): void
    {
        $customer = $order->customer ?? $order->load('customer')->customer;
        $userId = $customer->UserId ?? null;
        if ($userId) {
            AppNotification::send($userId, $type, $title, $message, $order->Id);
        }
    }

    /**
     * End User(s) (role = end_user) covering the given Taluk. Falls back to
     * every End User if none are specifically assigned to that Taluk, so an
     * order never silently goes un-notified.
     */
    private function endUsersForTaluk(?string $taluk): \Illuminate\Support\Collection
    {
        $endUsers = User::where('role', 'end_user')->whereNotNull('email')->get();

        if (!$taluk) {
            return $endUsers;
        }

        $matched = $endUsers->filter(function (User $user) use ($taluk) {
            return in_array($taluk, (array) $user->taluk, true);
        });

        return $matched->isNotEmpty() ? $matched : $endUsers;
    }

    /**
     * Admin(s) (role = admin) covering the given District. Falls back to
     * every Admin if none are specifically assigned to that District.
     */
    private function adminsForDistrict(?string $district): \Illuminate\Support\Collection
    {
        $admins = User::where('role', 'admin')->whereNotNull('email')->get();

        if (!$district) {
            return $admins;
        }

        $matched = $admins->filter(function (User $user) use ($district) {
            return in_array($district, (array) $user->district, true);
        });

        return $matched->isNotEmpty() ? $matched : $admins;
    }

    /** Every System Admin (role = system_admin) with an email on file. */
    private function systemAdmins(): \Illuminate\Support\Collection
    {
        return User::where('role', 'system_admin')->whereNotNull('email')->get();
    }

    /**
     * Fire an SMTP email to a list of Users, one message per recipient so a
     * bad address never exposes the others (BCC-style fan-out). Any SMTP
     * failure is logged rather than bubbled up — a mail outage should never
     * block an order from being created or updated.
     */
    private function sendToUsers(\Illuminate\Support\Collection $recipients, \Illuminate\Contracts\Mail\Mailable $mailable): void
    {
        if ($recipients->isEmpty()) {
            Log::warning('Order notification skipped — no recipients found', [
                'mailable' => get_class($mailable),
            ]);
            return;
        }

        // Sent AFTER the HTTP response has gone out (see FlushEarly middleware),
        // so the person clicking Submit never waits on SMTP.
        app()->terminating(function () use ($recipients, $mailable) {
            @set_time_limit(120);
            foreach ($recipients as $recipient) {
                try {
                    Mail::to($recipient->email)->send($mailable);
                } catch (\Throwable $e) {
                    Log::warning('Order notification email failed', [
                        'to' => $recipient->email,
                        'mailable' => get_class($mailable),
                        'error' => $e->getMessage(),
                    ]);
                }
            }
        });
    }

    /**
     * PATCH /api/orders/{id}/payment-due
     *
     * Manually reassign a bill's payment due date — e.g. a customer asks
     * for more time. Callable by Admin, System Admin, Super Admin, or the
     * End User (Field Officer) who owns/created the order, per the
     * business rule that the time limit is "assigned by specific (end
     * user, admin)". Accepts either an explicit new date or a fresh term
     * length in days from today.
     */
    public function updatePaymentDue(Request $request, $id)
    {
        $order = Order::find($id);

        if (!$order) {
            return response()->json(['message' => 'Order not found'], 404);
        }

        $caller = $request->user();
        $allowedRoles = ['admin', 'system_admin', 'super_admin', 'end_user'];
        if (!$caller || !in_array($caller->role, $allowedRoles, true)) {
            return response()->json(['message' => 'Not permitted to change the payment due date.'], 403);
        }

        $validated = $request->validate([
            'paymentDueDate' => 'nullable|date',
            'paymentTermDays' => 'nullable|integer|min:1|max:365',
            'note' => 'nullable|string|max:255',
        ]);

        if (empty($validated['paymentDueDate']) && empty($validated['paymentTermDays'])) {
            return response()->json(['message' => 'Provide either a new due date or a new term length in days.'], 422);
        }

        $update = [
            'PaymentDueDateSetBy' => $caller->id,
            'PaymentDueDateNote' => $validated['note'] ?? null,
        ];

        if (!empty($validated['paymentTermDays'])) {
            $update['PaymentTermDays'] = $validated['paymentTermDays'];
            $from = $order->DispatchedAt ?? now();
            $update['PaymentDueDate'] = \Carbon\Carbon::parse($from)->addDays((int) $validated['paymentTermDays'])->toDateString();
        }

        if (!empty($validated['paymentDueDate'])) {
            $update['PaymentDueDate'] = $validated['paymentDueDate'];
        }

        $order->update($update);

        return response()->json($order->load(['customer', 'product', 'dueDateSetter']));
    }

    /**
     * PATCH /api/orders/{id}/record-payment
     * Body: { amount, note? }
     *
     * Credit Limit feature — records a (possibly partial) payment against
     * a billed order. A ₹1,00,000 order paid down by ₹50,000 becomes
     * PaymentStatus 'partial' with a ₹50,000 balance still due against
     * the same PaymentDueDate; the customer's Outstanding balance drops
     * by the amount paid so the credit-limit check on their next order
     * reflects it.
     */
    public function recordPayment(Request $request, $id)
    {
        $order = Order::find($id);
        if (!$order) {
            return response()->json(['message' => 'Order not found'], 404);
        }

        $caller = $request->user();
        if (!$caller || !in_array($caller->role, ['admin', 'system_admin'], true)) {
            return response()->json(['message' => 'Not permitted to record a payment.'], 403);
        }

        if (!in_array($order->Status, ['dispatched', 'delivered'], true)) {
            return response()->json(['message' => 'Only a dispatched/delivered (billed) order can take a payment.'], 422);
        }

        $balanceDue = round((float) $order->TotalAmount - (float) ($order->AmountPaid ?? 0), 2);

        $validated = $request->validate([
            'amount' => ['required', 'numeric', 'min:0.01', 'max:' . max($balanceDue, 0.01)],
            'note' => 'nullable|string|max:255',
        ]);

        $amount = round((float) $validated['amount'], 2);
        $newAmountPaid = round((float) ($order->AmountPaid ?? 0) + $amount, 2);
        $newStatus = $newAmountPaid >= (float) $order->TotalAmount ? 'paid' : 'partial';

        $order->update([
            'AmountPaid' => $newAmountPaid,
            'PaymentStatus' => $newStatus,
        ]);

        if ($order->customer) {
            $order->customer->decrement('Outstanding', $amount);
        }

        return response()->json($order->fresh(['customer', 'product']));
    }

        // ── Oracle → local hand-off ──
    // Keep in sync with $typeMap in ProductController@index.
    private const ORACLE_TYPE_MAP = [
        'BLW' => 'Blouse',
        'DHT' => 'Dhoti',
        'SHT' => 'Uniform Shirting',
        'SUT' => 'Uniform Suiting',
    ];

    /** Verify an Oracle product line and return (creating if needed) its local Product row. */
    private function resolveOracleProduct(array $op, $caller): Product
    {
        // NOT trimmed on purpose: they must match Oracle byte-for-byte.
        $oracleId = (string) ($op['id'] ?? '');
        $sortNo   = (string) ($op['sortNo'] ?? '');
        $shadeNo  = (string) ($op['shadeNo'] ?? '');
        $rowKey   = trim((string) ($op['rowKey'] ?? ''));

        if ($oracleId === '' || $sortNo === '') {
            abort(422, 'A product in the cart has incomplete details. Please remove it and add it again.');
        }

        $q = DB::connection('oracle')
            ->table('PRODUCT as p')
            ->join('FULLITEMKEYDECODER as f', function ($join) {
                $join->on('f.ITEMTYPECODE', '=', 'p.ITEMTYPECODE')
                     ->on('f.SUBCODE01', '=', 'p.SUBCODE01');
            })
            ->where('p.ABSUNIQUEID', $oracleId)
            ->where('f.SUBCODE01', $sortNo)
            ->whereIn('p.FIRSTUSERGRPCODE', array_keys(self::ORACLE_TYPE_MAP))
            ->select(
                'p.ABSUNIQUEID as id',
                'p.FIRSTUSERGRPCODE as type_code',
                'f.SUBCODE01 as sort_no',
                'f.SUBCODE08 as shade_no',
                'f.SHORTDESCRIPTION as name',
                'f.ORDERITEMCODE as order_item_code'
            )
            ->distinct();

        if ($shadeNo !== '') {
            $q->where('f.SUBCODE08', $shadeNo);
        }

        $rows = $q->get();
        $keyOf = fn ($r) => md5(implode('|', [$r->id, $r->type_code, $r->sort_no, $r->shade_no, $r->name]));

        $row = $rowKey !== ''
            ? $rows->first(fn ($r) => $keyOf($r) === $rowKey)
            : $rows->first();

        if (!$row) {
            abort(422, "Product {$sortNo} {$shadeNo} could not be found in Oracle. Please remove it from the cart and add it again.");
        }

        // Deterministic local Code for this exact Oracle row → same row
        // always maps to the same local Product.
        $code = 'ORA-' . substr($keyOf($row), 0, 12);

        $product = Product::where('Code', $code)->first();
        if ($product) {
            return $product;
        }

        try {
            return Product::create([
                'Code'          => $code,
                'OrderItemCode' => $row->order_item_code !== null ? mb_substr((string) $row->order_item_code, 0, 150) : null,
                'SortNo'        => mb_substr((string) $row->sort_no, 0, 50),
                'ShadeNo'   => $row->shade_no !== null ? mb_substr((string) $row->shade_no, 0, 50) : null,
                'Name'      => mb_substr((string) $row->name, 0, 191),
                'Category'  => 'cloth',
                'SubType'   => self::ORACLE_TYPE_MAP[$row->type_code] ?? 'Others',
                'Color'     => '#FFFFFF',
                'Price'     => 0,   // Oracle feed carries no price — Marketing sets it on review
                'Quantity'  => 0,   // stock is not synced from Oracle
                'Quality'   => 'Standard',
                'Status'    => 'active',
                'CreatedBy' => $caller->id ?? null,
            ]);
        } catch (\Illuminate\Database\QueryException $e) {
            $product = Product::where('Code', $code)->first();   // created by a parallel request
            if (!$product) {
                throw $e;
            }
            return $product;
        }
    }

    /** Verify an Oracle BUSINESSPARTNER, enforce the caller's area, return (creating if needed) its local Customer. */
    private function resolveOracleCustomer(string $numberId, $caller): Customer
    {
        $row = DB::connection('oracle')
            ->table('BUSINESSPARTNER')
            ->select('NUMBERID', 'SHORTNAME', 'TOWN', 'DISTRICT', 'ADDRESSPHONENUMBER', 'TAXREGISTRATIONNUMBER')
            ->where('NUMBERID', $numberId)
            ->whereNotNull('SHORTNAME')
            ->first();

        if (!$row) {
            abort(422, 'This customer could not be found in Oracle.');
        }

        // Same area rule the Oracle customer picker applies (TOWN/DISTRICT
        // contain the officer's Taluk / District). System Admin unscoped.
        $matchedTaluk = null;
        $matchedDistrict = null;
        if ($caller && in_array($caller->role, ['end_user', 'admin'], true)) {
            $town = strtoupper((string) $row->town);
            $dist = strtoupper((string) $row->district);

            if ($caller->role === 'end_user') {
                foreach ($this->callerAreas($caller, 'Taluk') as $t) {
                    $u = strtoupper($t);
                    if ($u !== '' && (str_contains($town, $u) || str_contains($dist, $u))) { $matchedTaluk = $t; break; }
                }
            }
            foreach ($this->callerAreas($caller, 'District') as $d) {
                $u = strtoupper($d);
                if ($u !== '' && str_contains($dist, $u)) { $matchedDistrict = $d; break; }
            }
            if ($matchedTaluk === null && $matchedDistrict === null) {
                abort(403, 'This customer is outside your assigned area.');
            }
        }

        $oracleId = (string) $row->numberid;

        $customer = Customer::where('OracleId', $oracleId)->first();
        if ($customer) {
            return $customer;
        }

        for ($attempt = 1; $attempt <= 3; $attempt++) {
            try {
                $last = Customer::orderByDesc('Id')->first();
                $next = $last ? ((int) Str::after($last->Code, 'CUST-')) + 1 : 1;

                return Customer::create([
                    'Code'        => 'CUST-' . str_pad($next, 3, '0', STR_PAD_LEFT),
                    'OracleId'    => $oracleId,
                    'Name'        => mb_substr((string) $row->shortname, 0, 191),
                    'Phone'       => mb_substr((string) ($row->addressphonenumber ?: '-'), 0, 20),
                    'Type'        => 'retail',
                    'District'    => $matchedDistrict ?? (string) ($row->district ?? ''),
                    'Taluk'       => $matchedTaluk ?? (string) ($row->town ?? ''),
                    'Outstanding' => 0,
                    'Status'      => 'approved',
                    'Notes'       => "Auto-created from Oracle BUSINESSPARTNER {$oracleId}",
                    'GSTNo'       => $row->taxregistrationnumber ? mb_substr((string) $row->taxregistrationnumber, 0, 15) : null,
                    'CreatedBy'   => $caller->id ?? null,
                ]);
            } catch (\Illuminate\Database\QueryException $e) {
                $customer = Customer::where('OracleId', $oracleId)->first();
                if ($customer) {
                    return $customer;
                }
                if ($attempt >= 3) {
                    throw $e;
                }
                usleep(random_int(15000, 60000)); // Code race — recompute and retry
            }
        }
        throw new \RuntimeException('Failed to create the customer record.');
    }

    private function generateOrderCode(): string
    {
        $last = Order::orderByDesc('Id')->first();
        $nextNumber = $last ? ((int) Str::after($last->Code, 'ORD-')) + 1 : 1001;

        return 'ORD-' . $nextNumber;
    }

    /**
     * FIX: "Cannot insert duplicate key... UQ_Orders_Code" — generateOrderCode()
     * reads the current last Order and adds 1, which is fine for a single
     * request in isolation, but breaks the moment TWO requests do that read
     * at nearly the same time (e.g. the customer/end-user cart pages submit
     * every cart line as its own POST /orders — CartCheckout.jsx used to
     * fire all of them at once via Promise.all — or two different people
     * checking out within the same second). Both reads see the same "last"
     * order, both compute the same next number, and the second INSERT hits
     * the unique constraint on Code and the whole request 500s — exactly
     * the SQLSTATE[23000] / UQ_Orders_Code error reported.
     *
     * Fix: wrap code generation + the actual insert in one retry loop. If
     * the insert fails specifically because of a duplicate Code, just
     * generate a fresh code and try again (a few times) instead of letting
     * the whole request fail — the raced request "loses" the number it
     * guessed and picks the next one instead, transparently to the caller.
     * Every Order::create(...) call site in this controller should go
     * through here instead of calling generateOrderCode() + Order::create
     * directly, so this protection is universal instead of being re-added
     * ad hoc wherever a new order-creation code path shows up.
     */
    private function createOrderWithUniqueCode(array $attributes, int $maxAttempts = 5): Order
    {
        for ($attempt = 1; $attempt <= $maxAttempts; $attempt++) {
            $attributes['Code'] = $this->generateOrderCode();
            try {
                return Order::create($attributes);
            } catch (\Illuminate\Database\QueryException $e) {
                $isDuplicateCode = str_contains($e->getMessage(), 'UQ_Orders_Code')
                    || str_contains($e->getMessage(), 'Orders_Code')
                    || (int) $e->getCode() === 23000;
                if (!$isDuplicateCode || $attempt >= $maxAttempts) {
                    throw $e;
                }
                // Brief random backoff so two racing requests don't just
                // immediately collide again on their very next attempt.
                usleep(random_int(15000, 60000));
            }
        }
        // Unreachable — the loop above always either returns or throws —
        // but keeps static analysis happy about a guaranteed return type.
        throw new \RuntimeException('Failed to generate a unique order code.');
    }

    /**
     * Normalise a caller's own assigned District/Taluk (from their linked
     * Employee record, falling back to the User row) into a clean array.
     * Mirrors CustomerController::callerAreas().
     */
    /** PATCH /api/orders/close  Body: { kind: sale_loss|rejected, reason, ids: [] } */
public function close(Request $request)
{
    $caller = $request->user();
    if (!$caller || !in_array($caller->role, ['admin', 'system_admin'], true)) {
        return response()->json(['message' => 'Not permitted.'], 403);
    }

    $v = $request->validate([
        'kind'   => 'required|in:sale_loss,rejected',
        'reason' => 'required|string|max:255',
        'ids'    => 'required|array|min:1',
        'ids.*'  => 'integer|exists:Orders,Id',
    ]);

    $orders = Order::whereIn('Id', $v['ids'])->get();

    foreach ($orders as $o) {
        if (in_array($o->Status, ['dispatched', 'delivered'], true)) {
            return response()->json(['message' => "{$o->Code} is already {$o->Status}."], 422);
        }
        $line = \App\Models\SaleOrderLine::where('CrmOrderId', $o->Id)->first();
        if ($line && $line->CrmErpStatus === 'erp_so_created') {
            return response()->json(['message' => "{$o->Code} is already transferred to ERP."], 422);
        }
    }

    $isLoss = $v['kind'] === 'sale_loss';

    DB::transaction(function () use ($orders, $v, $caller, $isLoss) {
        foreach ($orders as $o) {
            // release FIFO stock + remove ERP staging (same as AllocationController@cancel)
            $line = \App\Models\SaleOrderLine::where('CrmOrderId', $o->Id)->first();
            if ($line) {
                foreach (\App\Models\AllocationBatchConsumption::where('SaleOrderLineId', $line->Id)->get() as $c) {
                    \App\Models\StockBatch::where('Id', $c->BatchId)->increment('RemainingQty', $c->ConsumedQty);
                }
                \App\Models\AllocationBatchConsumption::where('SaleOrderLineId', $line->Id)->delete();
                app(SaleOrderService::class)->removeForOrder((int) $o->Id);
            }

            $d = $o->OrderDetails ?? [];
            if ($isLoss) {
                $d['SaleLossReason'] = $v['reason'];
                $d['SaleLossAt'] = now()->toIso8601String();
                $d['SaleLossBy'] = $caller->name;
            } else {
                $d['RejectReason'] = $v['reason'];
                $d['RejectedAt'] = now()->toIso8601String();
                $d['RejectedBy'] = $caller->name;
            }

            $o->update([
                'Status' => $v['kind'],
                'OrderDetails' => $d,
                'RejectionReason' => $isLoss ? $o->RejectionReason : $v['reason'],
            ]);
        }
    });

    Cache::forget('available_stock_summary');   // add: use Illuminate\Support\Facades\Cache;

    if (!$isLoss) {
        foreach ($orders as $o) {
            $this->notifyCustomer($o, 'order_declined', 'Your order was declined',
                "Order {$o->Code} was declined. Reason: {$v['reason']}");
        }
    }

    return response()->json(['message' => count($orders) . ' order line(s) updated.']);
}
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