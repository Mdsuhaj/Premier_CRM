<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Mail\AllocationSubmittedMail;
use App\Models\Customer;
use App\Models\Order;
use App\Models\Product;
use App\Models\SaleOrderLine;
use App\Models\SaleOrderHeader;
use App\Services\SaleOrderService;
use App\Services\AllocationNotifier;
use App\Models\StockBatch;
use App\Models\AllocationBatchConsumption;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use App\Services\OracleStock;
use App\Services\OracleSalesOrderTransfer;

// Orders in these statuses are still "live demand" competing for stock.
// Declined orders don't count; dispatched/delivered orders have already
// physically left, so they're excluded from the pool being allocated.
const ALLOCATION_ACTIVE_STATUSES = ['pending', 'approved', 'processing'];

class AllocationController extends Controller
{
    /**
     * GET /api/allocations/products
     *
     * One row per product that currently has any active (pending/approved/
     * processing) order demand — used to populate the product picker on the
     * Allocation screen, with a quick "oversubscribed?" indicator.
     */
    public function products(Request $request)
    {
        $this->authorizeStaff($request);

        $rows = Order::whereIn('Status', ALLOCATION_ACTIVE_STATUSES)
            ->select('ProductId', DB::raw('SUM(Quantity) as TotalOrdered'))
            ->groupBy('ProductId')
            ->get()
            ->keyBy('ProductId');

        if ($rows->isEmpty()) {
            return response()->json([]);
        }

        $products = Product::whereIn('Id', $rows->keys())->get()->keyBy('Id');

        $allocated = SaleOrderLine::whereIn('CrmProductId', $rows->keys())
            ->select('CrmProductId as ProductId', DB::raw('SUM(USERPRIMARYQUANTITY) as TotalAllocated'))
            ->groupBy('CrmProductId')
            ->get()
            ->keyBy('ProductId');

        $result = [];
        foreach ($rows as $productId => $row) {
            $product = $products->get($productId);
            if (!$product)
                continue;

            $totalOrdered = (int) $row->TotalOrdered;
            $totalAllocated = (int) ($allocated->get($productId)->TotalAllocated ?? 0);

            $result[] = [
                'productId' => $product->Id,
                'code' => $product->Code,
                'name' => $product->Name,
                'category' => $product->Category,
                'uom' => $product->UOM,
                'availableQty' => (int) $product->Quantity,
                'totalOrdered' => $totalOrdered,
                'totalAllocated' => $totalAllocated,
                'shortfall' => max(0, $totalOrdered - (int) $product->Quantity),
            ];
        }

        // Oversubscribed products first — those need attention.
        usort($result, fn($a, $b) => $b['shortfall'] <=> $a['shortfall']);

        return response()->json($result);
    }

    /**
     * GET /api/allocations/price-list-options
     * The Price dropdown's two options, read live from Oracle
     * PRICELIST.CODE rather than hardcoded — confirms they still exist /
     * are spelled exactly as Oracle has them. Cached 5 min.
     */
    public function priceListOptions(Request $request)
    {
        $this->authorizeStaff($request);

        $codes = \Illuminate\Support\Facades\Cache::remember('price_list_options', 300, function () {
            try {
                return DB::connection('oracle')
                    ->table('PRICELIST')
                    ->whereIn('CODE', ['TLODOM', 'DOMESTIC'])
                    ->pluck('CODE')
                    ->map(fn($c) => trim((string) $c))
                    ->values()
                    ->all();
            } catch (\Throwable $e) {
                return ['TLODOM', 'DOMESTIC']; // Oracle unreachable — fall back to the known codes
            }
        });

        return response()->json($codes);
    }

    /**
     * GET /api/allocations?product_id=X
     *
     * One row per active Order for this product (pending/approved/
     * processing), newest-ordered-first within priority (see below).
     *
     * ── PER-ORDER ALLOCATION (fixed) ────────────────────────────────────
     * Previously the allocation itself (AllocatedQty / Status / Remarks /
     * ERP state) was tracked per (Product, Customer) only, with no OrderId
     * column. That meant: if the same customer had two active Orders for
     * the same product, BOTH rows showed the same AllocatedQty/Status —
     * approving/allocating one silently affected the other, a brand-new
     * Order could inherit a stale "rejected" status from an unrelated
     * earlier order, and a row's Allocated Qty could show a combined total
     * that didn't match its own Requested Qty (e.g. "Requested 10,
     * Allocated 12" because 12 was really the sum across two orders).
     *
     * Fix: product_allocations now carries OrderId, and every allocation
     * lookup/write below is keyed by (ProductId, OrderId) — each Order is
     * fully independent. CustomerId is still stored on the row (useful for
     * joins/reporting) but is no longer part of the identity key.
     */
    public function index(Request $request)
    {
        $this->authorizeStaff($request);

        $validated = $request->validate([
            'product_id' => 'required|integer|exists:Products,Id',
        ]);

        $product = Product::find($validated['product_id']);

        $orders = Order::where('ProductId', $product->Id)
            ->whereIn('Status', ALLOCATION_ACTIVE_STATUSES)
            ->orderByDesc('Id')
            ->get();

        if ($orders->isEmpty()) {
            return response()->json([
                'product' => [
                    'id' => $product->Id,
                    'code' => $product->Code,
                    'name' => $product->Name,
                    'uom' => $product->UOM,
                    'availableQty' => (int) $product->Quantity,
                ],
                'customers' => [],
            ]);
        }

        $customerIds = $orders->pluck('CustomerId')->unique()->values();
        $customers = Customer::whereIn('Id', $customerIds)->get()->keyBy('Id');

        // Keyed by OrderId now — each Order reads its own, independent
        // allocation record (see class-level note above). Allocation now
        // lives directly on sale_order_line (one row per order already).
        $allocations = SaleOrderLine::where('CrmProductId', $product->Id)
            ->whereIn('CrmOrderId', $orders->pluck('Id'))
            ->get()
            ->keyBy('CrmOrderId');

        $officerIds = $orders->pluck('CreatedBy')->filter()->unique()->values();
        $officers = User::whereIn('id', $officerIds)->pluck('name', 'id');

        $rows = [];
        foreach ($orders as $order) {
            $customer = $customers->get($order->CustomerId);
            if (!$customer)
                continue;

            $allocation = $allocations->get($order->Id);
            // Same contamination guard as board() above.
            if ($allocation && $allocation->CrmCustomerId !== null && (int) $allocation->CrmCustomerId !== (int) $customer->Id) {
                $allocation = null;
            }

            $rows[] = [
                'orderId' => $order->Id,
                'customerId' => $customer->Id,
                'code' => $customer->Code,
                'name' => $customer->Name,
                'district' => $customer->District,
                'taluk' => $customer->Taluk,
                'orderedQty' => (int) $order->Quantity,
                'allocatedQty' => (int) ($allocation->USERPRIMARYQUANTITY ?? 0),
                'meters' => $allocation->CrmMeters ?? '',
                'cdFlag' => (bool) ($allocation->CrmCdFlag ?? false),
                'priceListCode' => $allocation->CrmPriceListCode ?? null,
                'inquiryDate' => $order->CreatedAt ? substr($order->CreatedAt, 0, 10) : null,
                'orderNo' => $order->Code,
                'officerName' => $order->CreatedBy ? ($officers->get($order->CreatedBy) ?? null) : null,
                'allocationId' => $allocation->Id ?? null,
                'status' => $allocation->CrmAllocationStatus ?? null,
                'remarks' => $allocation->CrmRemarks ?? null,
                'erpStatus' => $allocation->CrmErpStatus ?? 'not_transferred',
                'decidedAt' => $allocation && $allocation->CrmDecidedAt ? $allocation->CrmDecidedAt->toDateTimeString() : null,
                'erpTransferredAt' => $allocation && $allocation->CrmErpTransferredAt ? $allocation->CrmErpTransferredAt->toDateTimeString() : null,
                'firstAllocatedAt' => $allocation && $allocation->CrmFirstAllocatedAt ? $allocation->CrmFirstAllocatedAt->toDateTimeString() : null,
            ];
        }

        // Pending / partially-allocated demand first, then biggest
        // requests — matches board()'s ordering intent, applied here too
        // since this endpoint can be called standalone.
        usort($rows, function ($a, $b) {
            $pa = $this->rowUrgency($a);
            $pb = $this->rowUrgency($b);
            if ($pa !== $pb)
                return $pa <=> $pb;
            return $b['orderedQty'] <=> $a['orderedQty'];
        });

        $totalAllocated = (int) $allocations->sum('USERPRIMARYQUANTITY');

        return response()->json([
            'product' => [
                'id' => $product->Id,
                'code' => $product->Code,
                'name' => $product->Name,
                'uom' => $product->UOM,
                'availableQty' => (int) $product->Quantity,
                'totalOrdered' => array_sum(array_column($rows, 'orderedQty')),
                'totalAllocated' => $totalAllocated,
                'remaining' => (int) $product->Quantity - $totalAllocated,
            ],
            'customers' => $rows,
        ]);
    }

    /**
     * GET /api/allocations/board
     *
     * Single combined payload for the whole Marketing Review board: every
     * product that currently has active order demand, each with its full
     * per-customer/per-order breakdown — computed in one pass instead of
     * the old GET /allocations/products followed by one GET
     * /allocations?product_id=X per product.
     *
     * Per-order allocation keying — see the note on index() above; this
     * endpoint uses the same (ProductId, OrderId) lookup.
     *
     * Rows within each product are ordered PENDING / PARTIALLY ALLOCATED
     * FIRST (System Admin: Not Submitted/Pending decisions first; Admin:
     * Not Allocated/Partial Allocated first), then by largest outstanding
     * quantity — so the Marketing Review table naturally surfaces the
     * work that still needs attention instead of already-settled rows.
     *
     * Each product row now also carries its `uom` (unit of measure, e.g.
     * "Pcs" / "Mtr") straight off the Products table, so the Marketing
     * Review UI can show it next to the product identity columns.
     *
     * ── TOTAL MTR ───────────────────────────────────────────────────────
     * Every row carries `totalMtr` (Allocated Cases × Allocated Mtr), every
     * product carries the sum of its rows' `totalMtr`, and the response
     * carries `grandTotalMtr` across all products.
     *
     * ── DELIVERY POINT ──────────────────────────────────────────────────
     * Each row carries deliveryPointNo (ORDERPARTNER.DELIVERYPOINTUNIQUEID),
     * deliveryPointName (ADDRESS.ADDRESSEE) and a combined `deliveryPoint`
     * ("<no> <name>") for the existing column.
     */
    public function board(Request $request)
    {
        $this->authorizeStaff($request);

        // ── District scoping ────────────────────────────────────────────────
        // Admin users are assigned to one or more districts (stored in
        // users.district as either a JSON array '["Madurai","Chennai"]' or a
        // plain string "Chennai"). They should only see orders for customers
        // whose Customer.District is in their assigned list.
        //
        // System Admin (district = null) and super_admin see everything.
        $user = $request->user();
        $adminDistricts = null; // null = no filter (see all)
        // NOTE: Admin is NO LONGER limited to their own district here — every
        // Admin sees every order. Narrowing by State / District is done with the
        // filters on the Marketing Review page itself.
        if (false && $user->role === 'admin') {
            $raw = $user->district;
            if ($raw !== null && $raw !== '') {
                // Decode JSON array if stored as '["Madurai"]', else treat as
                // a plain comma-separated / single string.
                $decoded = json_decode($raw, true);
                if (is_array($decoded)) {
                    $adminDistricts = array_map('trim', $decoded);
                } else {
                    $adminDistricts = array_map('trim', explode(',', $raw));
                }
                $adminDistricts = array_filter($adminDistricts); // remove empties
            }
        }

        // Every product — needed for price/category/sort-no context.
        // Sort No. is a plain running sequence (1, 2, 3…) ordered by
        // Product Code, computed across every product (not just the ones
        // with active demand) so it stays stable as demand changes.
        $allProducts = Product::all(['Id', 'Code', 'Name', 'Category', 'SubType', 'SortNo', 'ShadeNo', 'OrderItemCode', 'Price', 'Quantity', 'UOM']);
        $this->backfillOrderItemCodes($allProducts);
        $sortedByCode = $allProducts->all();
        usort($sortedByCode, fn($a, $b) => strnatcmp((string) $a->Code, (string) $b->Code));
        $sortNoByProduct = [];
        foreach ($sortedByCode as $i => $p) {
            $sortNoByProduct[$p->Id] = $i + 1;
        }
        $productsById = $allProducts->keyBy('Id');

        // ── Base orders query ────────────────────────────────────────────────
        // For Admin: join Customers and restrict to their district(s).
        // For System Admin / super_admin: no customer-district filter, BUT
        // only show orders that have at least one allocation with qty > 0
        // (i.e. Admin has submitted something — System Admin has nothing to
        // review on a row Admin hasn't touched yet).
        $ordersQuery = Order::whereIn('Status', ALLOCATION_ACTIVE_STATUSES);

        if (!empty($adminDistricts)) {
            // Admin: only orders for customers in their district(s)
            $ordersQuery->whereHas('customer', function ($q) use ($adminDistricts) {
                $q->whereIn('District', $adminDistricts);
            });
        } elseif (in_array($user->role, ['system_admin', 'super_admin'])) {
            // System Admin: only orders that Admin has actually allocated
            // (USERPRIMARYQUANTITY > 0 and status pending/approved/rejected).
            // Orders that are merely auto-staged (qty=0) are not visible here.
            $ordersQuery->whereExists(function ($q) {
                $q->from('sale_order_line')
                    ->whereColumn('sale_order_line.CrmOrderId', 'Orders.Id')
                    ->where('sale_order_line.USERPRIMARYQUANTITY', '>', 0);
            });
        }

        $orderTotals = (clone $ordersQuery)
            ->select('ProductId', DB::raw('SUM(Quantity) as TotalOrdered'))
            ->groupBy('ProductId')
            ->get()
            ->keyBy('ProductId');

        if ($orderTotals->isEmpty()) {
            return response()->json(['products' => [], 'grandTotalMtr' => 0]);
        }

        $activeProductIds = $orderTotals->keys();
        // Available stock now comes from Oracle BALANCE (cached 60s). Any
        // product Oracle doesn't know keeps its local Products.Quantity.
        $oracleStock = app(OracleStock::class)->forProducts($productsById->only($activeProductIds->all()), 60);

        $allocatedSumByProduct = SaleOrderLine::whereIn('CrmProductId', $activeProductIds)
            ->select('CrmProductId as ProductId', DB::raw('SUM(USERPRIMARYQUANTITY) as TotalAllocated'))
            ->groupBy('CrmProductId')
            ->get()
            ->keyBy('ProductId');

        // Every active order across every one of those products, in one
        // query — this is what replaces the old per-product round trip.
        $orders = (clone $ordersQuery)
            ->whereIn('ProductId', $activeProductIds)
            ->orderByDesc('Id')
            ->get();

        $customerIds = $orders->pluck('CustomerId')->unique()->values();
        $customers = Customer::whereIn('Id', $customerIds)->get()->keyBy('Id');

        // Delivery Point column — number AND name, each fetched in ONE batched
        // Oracle query (not per row):
        //   number = ORDERPARTNER.DELIVERYPOINTUNIQUEID
        //            (via ORDERBUSINESSPARTNERNUMBERID = Customers.OracleId)
        //   name   = ADDRESS.ADDRESSEE (via ADDRESS.CODE = Customers.OracleId)
        $deliveryPointNoByOracleId = [];
        $deliveryPointNameByOracleId = [];
        $oracleIds = $customers->pluck('OracleId')->filter()->map(fn($id) => trim((string) $id))->unique()->values();

        if ($oracleIds->isNotEmpty()) {
            // Delivery point NUMBER
            try {
                DB::connection('oracle')
                    ->table('ORDERPARTNER')
                    ->whereIn('ORDERBUSINESSPARTNERNUMBERID', $oracleIds)
                    ->where('CUSTOMERSUPPLIERTYPE', '1')
                    ->select('ORDERBUSINESSPARTNERNUMBERID', 'DELIVERYPOINTUNIQUEID')
                    ->get()
                    ->each(function ($row) use (&$deliveryPointNoByOracleId) {
                        $arr = array_change_key_case((array) $row, CASE_UPPER);
                        $oid = $arr['ORDERBUSINESSPARTNERNUMBERID'] ?? null;
                        $uid = $arr['DELIVERYPOINTUNIQUEID'] ?? null;
                        if ($oid === null || $uid === null || (int) $uid === 0) {
                            return;
                        }
                        $deliveryPointNoByOracleId[trim((string) $oid)] = trim((string) $uid);
                    });
            } catch (\Throwable $e) {
                // Oracle unreachable — number falls back to null.
            }

            // Delivery point NAME
            try {
                DB::connection('oracle')
                    ->table('ADDRESS')
                    ->whereIn('CODE', $oracleIds)
                    ->select('CODE', 'ADDRESSEE')
                    ->get()
                    ->each(function ($row) use (&$deliveryPointNameByOracleId) {
                        $arr = array_change_key_case((array) $row, CASE_UPPER);
                        $code = $arr['CODE'] ?? null;
                        if ($code === null) {
                            return;
                        }
                        $deliveryPointNameByOracleId[trim((string) $code)] =
                            ($arr['ADDRESSEE'] ?? null) !== null ? trim((string) $arr['ADDRESSEE']) : null;
                    });
            } catch (\Throwable $e) {
                // Oracle unreachable — name falls back to null.
            }
        }

        $officerIds = $orders->pluck('CreatedBy')->filter()->unique()->values();
        $officers = User::whereIn('id', $officerIds)->pluck('name', 'id');

        // Keyed by (ProductId, then OrderId) — each Order reads its own,
        // independent allocation record. See the note on index() above.
        $allocationsByProduct = SaleOrderLine::whereIn('CrmProductId', $activeProductIds)
            ->whereIn('CrmOrderId', $orders->pluck('Id'))
            ->get()
            ->groupBy('CrmProductId')
            // Cast CrmOrderId to int: DB stores it as varchar so keyBy produces
            // string keys, but $order->Id (the lookup) is an integer. PHP array
            // key lookups are strict — "7" !== 7 — so ->get($order->Id) would
            // silently return null for every row, making allocationId null and
            // savedAllocated 0 on the frontend even after Admin saved a qty.
            ->map(fn($group) => $group->keyBy(fn($line) => (int) $line->CrmOrderId));

        $ordersByProduct = $orders->groupBy('ProductId');

        $result = [];
        foreach ($activeProductIds as $productId) {
            $product = $productsById->get($productId);
            if (!$product) {
                continue;
            }

            $productAllocations = $allocationsByProduct->get($productId, collect());
            $rows = [];
            foreach ($ordersByProduct->get($productId, collect()) as $order) {
                $customer = $customers->get($order->CustomerId);
                if (!$customer) {
                    continue;
                }

                $allocation = $productAllocations->get($order->Id);
                // Defensive: a sale_order_line row keyed to this exact
                // OrderId but stamped with a DIFFERENT customer can never
                // legitimately belong to this order — every real line is
                // created for its own order's actual customer. This is
                // contamination: almost certainly a stray row from the old
                // product_allocations backfill whose CrmOrderId happened to
                // coincide with this order's freshly auto-incremented Id.
                // Treat it as "nothing allocated yet" for display instead
                // of showing its stale Cases/Meters/Status; resolveLine()
                // below self-heals it to a clean state the moment it's
                // actually saved through.
                if ($allocation && $allocation->CrmCustomerId !== null && (int) $allocation->CrmCustomerId !== (int) $customer->Id) {
                    $allocation = null;
                }

                // Per-order UOM — the UOM the customer actually picked
                // (Box/Pieces/Meter) when they added this line on Product
                // Selection, stored in OrderDetails['UOM'] by
                // OrderController@storeBulk. Falls back to the product's
                // master UOM for orders placed before that existed, or
                // for orders not placed through the customer cart at all
                // (e.g. entered by an officer/admin directly).
                $orderUom = $order->OrderDetails['UOM'] ?? null;

                // Delivery point number / name / combined, for this customer.
                $oracleKey = trim((string) $customer->OracleId);
                $dpNo = $deliveryPointNoByOracleId[$oracleKey] ?? null;
                $dpName = $deliveryPointNameByOracleId[$oracleKey] ?? null;
                $dpCombined = trim(($dpNo ?? '') . ' ' . ($dpName ?? ''));

                $rows[] = [
                    'orderId' => $order->Id,
                    'customerId' => $customer->Id,
                    'code' => $customer->Code,
                    'name' => $customer->Name,
                    'district' => $customer->District,
                    'taluk' => $customer->Taluk,
                    'deliveryPointNo' => $dpNo,
                    'deliveryPointName' => $dpName,
                    'deliveryPoint' => $dpCombined !== '' ? $dpCombined : null,
                    'orderedQty' => (int) $order->Quantity,
                    'allocatedQty' => (int) ($allocation->USERPRIMARYQUANTITY ?? 0),
                    'meters' => $allocation->CrmMeters ?? '',
                    'erpSentCases' => (int) ($allocation->CrmErpSentCases ?? 0),
                    'erpSentMtr' => (float) ($allocation->CrmErpSentQty ?? 0),
                    // Allocated Cases × Allocated Mtr for this order line.
                    'totalMtr' => round($this->lineMtrTotal($allocation), 2),
                    'cdFlag' => (bool) ($allocation->CrmCdFlag ?? false),
                    'priceListCode' => $allocation->CrmPriceListCode ?? null,
                    'inquiryDate' => $order->CreatedAt ? substr($order->CreatedAt, 0, 10) : null,
                    'orderNo' => $order->Code,
                    'officerName' => $order->CreatedBy ? ($officers->get($order->CreatedBy) ?? null) : null,
                    'allocationId' => $allocation->Id ?? null,
                    'status' => $allocation->CrmAllocationStatus ?? null,
                    'remarks' => $allocation->CrmRemarks ?? null,
                    'erpStatus' => $allocation->CrmErpStatus ?? 'not_transferred',
                    'decidedAt' => $allocation && $allocation->CrmDecidedAt ? $allocation->CrmDecidedAt->toDateTimeString() : null,
                    'erpTransferredAt' => $allocation && $allocation->CrmErpTransferredAt ? $allocation->CrmErpTransferredAt->toDateTimeString() : null,
                    'firstAllocatedAt' => $allocation && $allocation->CrmFirstAllocatedAt ? $allocation->CrmFirstAllocatedAt->toDateTimeString() : null,
                    'uom' => $orderUom,
                ];
            }

            // Pending / partially-allocated first, then largest requests —
            // see method doc-block above.
            usort($rows, function ($a, $b) {
                $pa = $this->rowUrgency($a);
                $pb = $this->rowUrgency($b);
                if ($pa !== $pb)
                    return $pa <=> $pb;
                return $b['orderedQty'] <=> $a['orderedQty'];
            });

            $totalAllocated = (int) $productAllocations->sum('USERPRIMARYQUANTITY');
            $totalOrdered = (int) $orderTotals->get($productId)->TotalOrdered;
            $available = $oracleStock[$product->Id] ?? (int) $product->Quantity;

            // Sum of this product's rows' Cases × Mtr.
            $productTotalMtr = round(array_sum(array_column($rows, 'totalMtr')), 2);

            $result[] = [
                'productId' => $product->Id,
                'code' => $product->Code,
                // Marketing Review's Product Code column shows Oracle's
                // exact FULLITEMKEYDECODER.ORDERITEMCODE for this product
                // (falls back to our internal Code only if Oracle has none
                // on record / is unreachable) — see backfillOrderItemCodes().
                'orderItemCode' => $product->OrderItemCode ?: $product->Code,
                'name' => $product->Name,
                'category' => $product->Category,
                'subType' => $product->SubType,
                'sortNo' => $sortNoByProduct[$product->Id] ?? null,
                'shadeNo' => $product->ShadeNo,
                'price' => (float) $product->Price,
                'uom' => $product->UOM,
                'availableQty' => $available,
                'totalOrdered' => $totalOrdered,
                'totalAllocated' => $totalAllocated,
                'totalMtr' => $productTotalMtr,
                'shortfall' => max(0, $totalOrdered - $available),
                'customers' => $rows,
            ];
        }

        // Oversubscribed products first, same as products() above.
        usort($result, fn($a, $b) => $b['shortfall'] <=> $a['shortfall']);

        // Grand total Mtr across every product on the board.
        $grandTotalMtr = round(array_sum(array_column($result, 'totalMtr')), 2);

        return response()->json([
            'products' => $result,
            'grandTotalMtr' => $grandTotalMtr,
        ]);
    }

    /**
     * Lazily backfills Products.OrderItemCode from Oracle's
     * FULLITEMKEYDECODER.ORDERITEMCODE for any product on this board that
     * doesn't have it cached yet — one Oracle round trip per garment type,
     * not per product. Silently skips (leaves OrderItemCode null, tries
     * again next load) if Oracle is unreachable; never blocks the board.
     */
    private function backfillOrderItemCodes($products): void
    {
        $typeMap = ['Blouse' => 'BLW', 'Dhoti' => 'DHT', 'Uniform Shirting' => 'SHT', 'Uniform Suiting' => 'SUT'];

        $missing = $products->filter(
            fn($p) => empty($p->OrderItemCode) && !empty($p->SortNo) && isset($typeMap[$p->SubType])
        );
        if ($missing->isEmpty()) {
            return;
        }

        foreach ($missing->groupBy(fn($p) => $typeMap[$p->SubType]) as $code => $group) {
            $sorts = $group->pluck('SortNo')->map(fn($s) => trim((string) $s))->unique()->values()->all();
            if (empty($sorts)) {
                continue;
            }

            try {
                $rows = DB::connection('oracle')
                    ->table('PRODUCT as p')
                    ->join('FULLITEMKEYDECODER as f', function ($join) {
                        $join->on('f.ITEMTYPECODE', '=', 'p.ITEMTYPECODE')
                            ->on('f.SUBCODE01', '=', 'p.SUBCODE01');
                    })
                    ->where('p.FIRSTUSERGRPCODE', $code)
                    ->whereIn(DB::raw('TRIM(f.SUBCODE01)'), $sorts)
                    ->select('f.SUBCODE01 as sort_no', 'f.SUBCODE08 as shade_no', 'f.ORDERITEMCODE as order_item_code')
                    ->distinct()
                    ->get();
            } catch (\Throwable $e) {
                continue; // Oracle unreachable — leave null, retried on the next board load
            }

            // Index by "sort|shade" first (exact match), falling back to
            // "sort" alone for products with no ShadeNo on file.
            $bySortShade = [];
            $bySortOnly = [];
            foreach ($rows as $r) {
                $sort = trim((string) $r->sort_no);
                $shade = trim((string) $r->shade_no);
                $bySortShade[$sort . '|' . $shade] = $r->order_item_code;
                if (!isset($bySortOnly[$sort])) {
                    $bySortOnly[$sort] = $r->order_item_code;
                }
            }

            foreach ($group as $product) {
                $sort = trim((string) $product->SortNo);
                $shade = trim((string) ($product->ShadeNo ?? ''));
                $found = $bySortShade[$sort . '|' . $shade] ?? $bySortOnly[$sort] ?? null;
                if ($found) {
                    Product::where('Id', $product->Id)->update(['OrderItemCode' => $found]);
                    $product->OrderItemCode = $found;
                }
            }
        }
    }

    /**
     * Ranks a board/index row by how urgently it needs attention:
     *   0 = not yet submitted, or submitted and still Pending decision,
     *       or not fully allocated yet (Requested > Allocated)
     *   1 = everything else (Approved/Rejected AND fully allocated)
     * Used to sort Pending/Partially-Allocated rows to the top of the
     * table, both in the flat index() list and within each product group
     * in board().
     */
    private function rowUrgency(array $row): int
    {
        if (($row['status'] ?? null) === null || $row['status'] === 'pending') {
            return 0;
        }
        if ((int) $row['allocatedQty'] < (int) $row['orderedQty']) {
            return 0;
        }
        return 1;
    }

    /**
     * Parses a free-text Meter figure ("5M", "5.5", "") into the number the
     * Marketing Review page multiplies Cases by when it draws stock. A row
     * with no usable Mtr returns 0.0 — it does not draw stock (same rule as
     * the page's meterMultOf()).
     */
    private function meterMultiplier($meters): float
    {
        $n = (float) preg_replace('/[^\d.]/', '', (string) $meters);
        return $n > 0 ? $n : 0.0;
    }

    private function erpMeterMultiplier($meters): float
    {
        $n = (float) preg_replace('/[^\d.]/', '', (string) $meters);
        return $n > 0 ? $n : 1.0;
    }

    /**
     * POST /api/allocations
     * Body: { productId, allocations: [{ orderId, customerId, allocatedQty }] }
     *
     * Bulk upsert, ONE allocation record per Order now (keyed on
     * (ProductId, OrderId) — see the note on index() above). Rejected if
     * the total allocated would exceed the product's available stock — an
     * admin can always allocate *less* than what was ordered, never more
     * than what's on hand.
     *
     * ── STOCK CAP UNIT (fixed) ──────────────────────────────────────────
     * The Marketing Review page consumes stock as (Allocated Cases ×
     * Allocated Mtr), and a row with no Mtr draws nothing. This check used
     * to compare the plain SUM of cases against Oracle stock, so rows
     * without Mtr (or lines already transferred) could trigger a false 422
     * and stop the whole product from reaching System Admin. It now
     * compares Cases × Mtr, the same way the page does.
     *
     * ── ERP-STATUS CARRY-OVER FIX ─────────────────────────────────────
     * A row can already be ErpStatus = 'erp_so_created' from a PREVIOUS,
     * smaller allocation (e.g. 700 of an 800-unit order was allocated,
     * approved, and transferred). If Admin later tops that row up (e.g.
     * +100 to reach the full 800) and clicks Approval, the extra 100
     * units have obviously never reached ERP — but without this check
     * ErpStatus would just sit at 'erp_so_created' forever, so the badge
     * would keep reading "ERP SO Created" even though only 700 of the
     * new 800 total were ever actually transferred.
     *
     * Fix: whenever a row that's currently 'erp_so_created' receives a
     * NEW AllocatedQty that's higher than what's already stored, drop
     * ErpStatus back to 'not_transferred' (and clear ErpTransferredAt) so
     * the row re-enters the normal Approve -> Ready for ERP -> Transfer
     * cycle for the full new total.
     *
     * NOTE: this compares against the PREVIOUS AllocatedQty as a stand-in
     * for "what was actually transferred", which is safe as long as a row
     * is never partially transferred (bulkErpTransfer() always transfers
     * the row's *entire* AllocatedQty in one go — see below). If partial
     * ERP transfers are ever introduced, track a dedicated
     * TransferredQty column instead of inferring it from AllocatedQty.
     *
     * ── METER LOCK (latest) ────────────────────────────────────────────
     * Once a row has been Approved (Status === 'approved') its Meters
     * figure is treated as final on the client (the Marketing Review UI
     * stops letting Admin edit the box — see meterLocked in
     * Batches.jsx/AllocationRow). Mirrored here defensively: if the
     * existing row is already 'approved', an incoming `meters` value is
     * ignored and the previously-saved figure is kept, so a stray/replay
     * request can't silently overwrite an already-approved Meter reading.
     * A fresh qty change on an approved row still resets Status back to
     * 'pending' below (see $qtyChanged), which naturally unlocks Meters
     * again for the new round of review.
     */
    public function store(Request $request)
    {
        $this->authorizeStaff($request);

        $validated = $request->validate([
            'productId' => 'required|integer|exists:Products,Id',
            'allocations' => 'required|array|min:1',
            'allocations.*.orderId' => 'required|integer|exists:Orders,Id',
            'allocations.*.customerId' => 'required|integer|exists:Customers,Id',
            'allocations.*.allocatedQty' => 'required|integer|min:0',
            'allocations.*.meters' => 'nullable|string|max:50',
            'allocations.*.cdFlag' => 'nullable|boolean',
            'allocations.*.priceListCode' => 'nullable|string|max:50',
        ]);

        $product = Product::find($validated['productId']);

        // One entry per OrderId — each Order is its own allocation record.
        // Dedupe defensively by OrderId (keep the last value) in case the
        // client ever sends the same order twice in one payload.
        $byOrder = [];
        foreach ($validated['allocations'] as $item) {
            $byOrder[$item['orderId']] = $item;
        }
        $orderIds = array_keys($byOrder);

        // ── Stock-cap check ────────────────────────────────────────────────
        // Compare the net CHANGE in consumed stock against what's available,
        // not the raw submitted total — and measure consumption the same way
        // the Marketing Review page does: Cases × Mtr (a row with no Mtr
        // draws nothing).
        //
        // consumedByOthers  = stock already drawn by every OTHER order's
        //                     saved line for this product (not being
        //                     submitted now, so not being replaced).
        // consumedBySubmitted = stock the submitted rows will draw once
        //                     saved (their new totals replace their old ones).
        $consumedByOthers = SaleOrderLine::where('CrmProductId', $product->Id)
            ->whereNotIn('CrmOrderId', $orderIds)
            ->get(['USERPRIMARYQUANTITY', 'CrmMeters', 'CrmTotalMtrQty'])
            ->sum(fn($l) => $this->lineMtrTotal($l));

        $existingLines = SaleOrderLine::whereIn('CrmOrderId', $orderIds)->get()
            ->keyBy(fn($l) => (int) $l->CrmOrderId);

        $consumedBySubmitted = 0;
        foreach ($byOrder as $oid => $item) {
            $consumedBySubmitted += $this->projectedMtrTotal(
                $existingLines->get((int) $oid),
                (int) $item['allocatedQty'],
                $item['meters'] ?? null
            );
        }
        $grandTotal = $consumedByOthers + $consumedBySubmitted;

        $available = $this->availableStock($product);
        // $available is null when Oracle is unreachable AND local Quantity=0
        // (0 means "not synced from Oracle", not truly sold out). In that case
        // skip the stock cap — a spurious 422 here silently aborts the whole
        // product from reaching System Admin. The ERP itself enforces stock at
        // transfer time, so letting the allocation proceed is safe.
        if ($available !== null && $grandTotal > $available) {
            $shown = round($grandTotal, 2);
            return response()->json([
                'message' => "Total allocated ({$shown}) can't exceed available stock ({$available}).",
            ], 422);
        }

        $submittedRows = [];
        $shortageOrderIds = [];

        DB::transaction(function () use ($byOrder, $validated, $request, &$submittedRows, &$shortageOrderIds, $available) {
            foreach ($byOrder as $orderId => $item) {
                $allocatedQty = $item['allocatedQty'];

                $line = $this->resolveLine((int) $orderId, $request->user());
                if (!$line) {
                    continue; // order/product/customer vanished, or ERP staging is disabled
                }

                // Guard: skip rows where Admin submitted qty=0 for an auto-staged
                // line that was never actually allocated (USERPRIMARYQUANTITY=0).
                // These are created by stageOrder() when an order is placed, but
                // Admin hasn't typed a value yet. Submitting them would create a
                // pending row with qty=0 that System Admin can't see (their filter
                // requires savedAllocated > 0) but which clutters the DB.
                if ((int) $allocatedQty === 0 && (int) $line->USERPRIMARYQUANTITY === 0) {
                    // Nothing could be given to this order. If stock really is
                    // short, tell the customer / end user / admins / system admin.
                    $shortageOrderIds[] = (int) $orderId;
                    continue;
                }
                $qtyChanged = (int) $line->USERPRIMARYQUANTITY !== (int) $allocatedQty;
                $oldQty = (int) $line->USERPRIMARYQUANTITY;
                $oldTotal = (float) $line->CrmTotalMtrQty > 0
                    ? (float) $line->CrmTotalMtrQty
                    : $oldQty * $this->erpMeterMultiplier($line->CrmMeters);

                // A line is "new" if it has never had real stock assigned —
                // either its status is null (legacy, pre-stageOrder flow) OR
                // it was auto-staged by resolveLine() with qty=0 and still
                // sits at 'pending' with nothing allocated. In both cases
                // Admin is submitting for the very first time and Meters
                // should be accepted freely.
                //
                // A "rejected resubmit" means Admin is re-clicking Approval
                // on a row System Admin previously rejected, without
                // necessarily changing the qty. The row must move back to
                // 'pending' so System Admin can re-review it; without this,
                // a rejected row stays rejected forever unless Admin happens
                // to change the qty first.
                $isNew = $line->CrmAllocationStatus === null
                    || $line->CrmAllocationStatus === 'not_submitted'
                    || ($line->CrmAllocationStatus === 'pending' && (int) $line->USERPRIMARYQUANTITY === 0);
                $isRejectedResubmit = !$qtyChanged
                    && $line->CrmAllocationStatus === 'rejected'
                    && (int) $allocatedQty > 0;

                $attributes = [
                    'CrmCustomerId' => $item['customerId'],
                    'USERPRIMARYQUANTITY' => $allocatedQty,
                    'BASEPRIMARYQUANTITY' => $allocatedQty,
                    'CrmAllocatedBy' => $request->user()->id,
                ];

                // 48-hour partial window starts at the FIRST real allocation.
                if ((int) $allocatedQty > 0 && !$line->CrmFirstAllocatedAt) {
                    $attributes['CrmFirstAllocatedAt'] = now();
                }

                // Meter lock — see method doc-block above. Only accept a
                // new Meters value on first creation of the row, or while
                // this save is also changing the qty (which resets Status
                // back to 'pending' below and legitimately re-opens the row
                // for a fresh round of review). Once a row has been
                // submitted (Approval clicked — allocationId exists) with
                // no qty change, Meters is locked regardless of Status
                // (pending/approved/rejected) — locking only kicked in at
                // 'approved' before, which left it editable while the row
                // sat Pending with System Admin.
                if ($isNew || $qtyChanged) {
                    $attributes['CrmMeters'] = $item['meters'] ?? null;
                }
                if ($qtyChanged) {
                    $attributes['CrmTotalMtrQty'] = $this->projectedMtrTotal($line, (int) $item['allocatedQty'], $item['meters'] ?? null);
                }
                if ($qtyChanged) {
                    $attributes['CrmTotalMtrQty'] = $this->projectedMtrTotal($line, (int) $allocatedQty, $item['meters'] ?? null);
                }
                if (array_key_exists('cdFlag', $item)) {
                    $attributes['CrmCdFlag'] = $item['cdFlag'] ? 1 : 0;
                }
                if (!empty($item['priceListCode'])) {
                    $attributes['CrmPriceListCode'] = $item['priceListCode'];
                }

                if ($qtyChanged || $isRejectedResubmit) {
                    $attributes['CrmAllocationStatus'] = 'pending';
                    $attributes['CrmDecidedBy'] = null;
                    $attributes['CrmDecidedAt'] = null;
                }

                // Carry-over fix — see method doc-block above.
                if (
                    $line->CrmErpStatus === 'erp_so_created'
                    && (int) $allocatedQty > (int) $line->USERPRIMARYQUANTITY
                ) {
                    if ((float) $line->CrmErpSentQty <= 0) {
                        $attributes['CrmErpSentQty'] = $oldTotal; // legacy row: remember what was sent
                    }
                    if ((int) $line->CrmErpSentCases <= 0) {
                        $attributes['CrmErpSentCases'] = $oldQty;   // <-- add
                    }
                    $attributes['CrmErpStatus'] = 'not_transferred';
                    $attributes['CrmErpTransferredAt'] = null;
                }

                $line->fill($attributes);
                $line->save();
                if (!empty($item['priceListCode'])) {
                    SaleOrderHeader::where('RELATEDDEPENDENTID', $line->FATHERID)
                        ->update(['CrmPriceListCode' => $item['priceListCode']]);
                }
                $this->consumeFifo($line);

                // Flow: ADMIN -> Allots (Allocates) Order -> CRM updates
                // Order -> Email -> System Admin. Only rows that actually
                // moved back into 'pending' (i.e. genuinely need a fresh
                // look from System Admin) are reported in the email —
                // an untouched, already-decided row re-saved with the
                // same qty shouldn't re-notify anyone. Rejected resubmits
                // also notify, since they've re-entered the pending queue.
                if ($qtyChanged || $isRejectedResubmit) {
                    $submittedRows[] = [
                        'orderId' => $orderId,
                        'customerId' => $item['customerId'],
                        'allocatedQty' => $allocatedQty,
                    ];
                }
            }
        });

        // Email to System Admins + in-app (bell) notifications are the slow part
        // (SMTP round trips, one query per recipient). They don't affect the
        // saved allocation, so run them AFTER the response has been sent
        // instead of making the Approval button wait for them.
        $actor = $request->user();
        app()->terminating(function () use ($product, $submittedRows, $shortageOrderIds, $available, $actor) {
            try {
                if (!empty($submittedRows)) {
                    $this->notifySystemAdminsOfAllocation($product, $submittedRows);
                }

                // In-app notifications (bell): fully / partially allocated, stock shortage.
                $notifier = app(AllocationNotifier::class);
                foreach ($submittedRows as $row) {
                    if ($order = Order::with('customer')->find($row['orderId'])) {
                        $notifier->allocated($order, (int) $row['allocatedQty'], $actor, $available);
                    }
                }
                foreach (array_unique($shortageOrderIds) as $orderId) {
                    $order = Order::with('customer')->find($orderId);
                    if ($order && ($available === null ? false : $available < (int) $order->Quantity)) {
                        $notifier->shortage($order, $actor, $available);
                    }
                }
            } catch (\Throwable $e) {
                Log::warning('Post-allocation notifications failed', ['error' => $e->getMessage()]);
            }
        });

        // Bust the Available Stock summary card's cache so it reflects
        // this allocation immediately instead of waiting up to 60s.
        Cache::forget('available_stock_summary');

        return response()->json(['message' => 'Allocation saved.']);
    }

    /**
     * Emails every System Admin with a valid email address a summary of
     * the rows just submitted for their review. Never blocks the
     * allocation save itself — a mail outage here just gets logged.
     */
    private function notifySystemAdminsOfAllocation(Product $product, array $submittedRows): void
    {
        $orderIds = array_column($submittedRows, 'orderId');
        $customerIds = array_column($submittedRows, 'customerId');

        $orders = Order::whereIn('Id', $orderIds)->get()->keyBy('Id');
        $customers = Customer::whereIn('Id', $customerIds)->get()->keyBy('Id');

        $rows = array_map(function ($row) use ($orders, $customers) {
            return [
                'orderCode' => $orders->get($row['orderId'])->Code ?? ('#' . $row['orderId']),
                'customerName' => $customers->get($row['customerId'])->Name ?? '—',
                'allocatedQty' => $row['allocatedQty'],
            ];
        }, $submittedRows);

        $systemAdmins = User::where('role', 'system_admin')->whereNotNull('email')->get();

        if ($systemAdmins->isEmpty()) {
            Log::warning('Allocation notification skipped — no System Admin recipients found');
            return;
        }

        $mailable = new AllocationSubmittedMail($product->Name, $rows);
        foreach ($systemAdmins as $recipient) {
            try {
                Mail::to($recipient->email)->send($mailable);
            } catch (\Throwable $e) {
                Log::warning('Allocation notification email failed', [
                    'to' => $recipient->email,
                    'error' => $e->getMessage(),
                ]);
            }
        }
    }

    /**
     * GET /api/allocations/customers
     *
     * One row per customer who currently has any active (pending/approved/
     * processing) order demand — used to populate the customer picker on
     * the Customer-wise tab of the Allocation screen.
     */
    public function customers(Request $request)
    {
        $this->authorizeStaff($request);

        $rows = Order::whereIn('Status', ALLOCATION_ACTIVE_STATUSES)
            ->select('CustomerId', DB::raw('COUNT(DISTINCT ProductId) as ProductCount'), DB::raw('SUM(Quantity) as TotalOrdered'))
            ->groupBy('CustomerId')
            ->get()
            ->keyBy('CustomerId');

        if ($rows->isEmpty()) {
            return response()->json([]);
        }

        $customers = Customer::whereIn('Id', $rows->keys())->get()->keyBy('Id');

        $productIds = Order::whereIn('CustomerId', $rows->keys())
            ->whereIn('Status', ALLOCATION_ACTIVE_STATUSES)
            ->pluck('ProductId')
            ->unique();

        $productTotals = Order::whereIn('ProductId', $productIds)
            ->whereIn('Status', ALLOCATION_ACTIVE_STATUSES)
            ->select('ProductId', DB::raw('SUM(Quantity) as TotalOrdered'))
            ->groupBy('ProductId')
            ->get()
            ->keyBy('ProductId');

        $products = Product::whereIn('Id', $productIds)->get()->keyBy('Id');

        $shortageByCustomer = Order::whereIn('CustomerId', $rows->keys())
            ->whereIn('Status', ALLOCATION_ACTIVE_STATUSES)
            ->get()
            ->groupBy('CustomerId')
            ->map(function ($orders) use ($productTotals, $products) {
                foreach ($orders as $o) {
                    $product = $products->get($o->ProductId);
                    $totalOrdered = (int) ($productTotals->get($o->ProductId)->TotalOrdered ?? 0);
                    if ($product && $totalOrdered > (int) $product->Quantity) {
                        return true;
                    }
                }
                return false;
            });

        $result = [];
        foreach ($rows as $customerId => $row) {
            $customer = $customers->get($customerId);
            if (!$customer)
                continue;

            $result[] = [
                'customerId' => $customer->Id,
                'code' => $customer->Code,
                'name' => $customer->Name,
                'district' => $customer->District,
                'taluk' => $customer->Taluk,
                'productCount' => (int) $row->ProductCount,
                'totalOrdered' => (int) $row->TotalOrdered,
                'hasShortage' => (bool) ($shortageByCustomer->get($customerId) ?? false),
            ];
        }

        usort($result, fn($a, $b) => $b['hasShortage'] <=> $a['hasShortage']);

        return response()->json($result);
    }

    /**
     * GET /api/allocations/by-customer?customer_id=X
     *
     * Per-product breakdown for one customer: every product they currently
     * have active demand for, how much they ordered vs. have been
     * allocated, plus enough stock context (total stock, total ordered by
     * everyone, allocated to everyone else) to safely edit this customer's
     * share without re-fetching the product-wise screen.
     *
     * NOTE: this view is aggregated per PRODUCT for the customer (a
     * customer can have several active Orders for the same product, and
     * this rolls them up into one line). "MyAllocatedQty" now SUMS across
     * every one of that customer's per-order allocation rows for the
     * product, since each Order has its own allocation record —
     * previously there was only ever one row per (Product, Customer) to
     * read, so a plain keyBy() was enough; with per-order rows that would
     * silently drop all but one Order's allocation.
     */
    public function byCustomer(Request $request)
    {
        $this->authorizeStaff($request);

        $validated = $request->validate([
            'customer_id' => 'required|integer|exists:Customers,Id',
        ]);

        $customer = Customer::find($validated['customer_id']);

        $ordered = Order::where('CustomerId', $customer->Id)
            ->whereIn('Status', ALLOCATION_ACTIVE_STATUSES)
            ->select('ProductId', DB::raw('SUM(Quantity) as OrderedQty'))
            ->groupBy('ProductId')
            ->get()
            ->keyBy('ProductId');

        if ($ordered->isEmpty()) {
            return response()->json([
                'customer' => ['id' => $customer->Id, 'code' => $customer->Code, 'name' => $customer->Name],
                'products' => [],
            ]);
        }

        $products = Product::whereIn('Id', $ordered->keys())->get()->keyBy('Id');

        $allTotalOrdered = Order::whereIn('ProductId', $ordered->keys())
            ->whereIn('Status', ALLOCATION_ACTIVE_STATUSES)
            ->select('ProductId', DB::raw('SUM(Quantity) as TotalOrdered'))
            ->groupBy('ProductId')
            ->get()
            ->keyBy('ProductId');

        $allAllocated = SaleOrderLine::whereIn('CrmProductId', $ordered->keys())
            ->select('CrmProductId as ProductId', DB::raw('SUM(USERPRIMARYQUANTITY) as TotalAllocated'))
            ->groupBy('CrmProductId')
            ->get()
            ->keyBy('ProductId');

        // SUM across this customer's per-order allocation rows for each
        // product — see method doc-block above.
        $myAllocated = SaleOrderLine::where('CrmCustomerId', $customer->Id)
            ->whereIn('CrmProductId', $ordered->keys())
            ->select('CrmProductId as ProductId', DB::raw('SUM(USERPRIMARYQUANTITY) as MyAllocatedQty'))
            ->groupBy('CrmProductId')
            ->get()
            ->keyBy('ProductId');

        $rows = [];
        foreach ($ordered as $productId => $row) {
            $product = $products->get($productId);
            if (!$product)
                continue;

            $availableQty = (int) $product->Quantity;
            $totalOrdered = (int) ($allTotalOrdered->get($productId)->TotalOrdered ?? 0);
            $totalAllocated = (int) ($allAllocated->get($productId)->TotalAllocated ?? 0);
            $myAllocatedQty = (int) ($myAllocated->get($productId)->MyAllocatedQty ?? 0);
            $allocatedToOthers = $totalAllocated - $myAllocatedQty;

            $rows[] = [
                'productId' => $product->Id,
                'code' => $product->Code,
                'name' => $product->Name,
                'category' => $product->Category,
                'uom' => $product->UOM,
                'availableQty' => $availableQty,
                'totalOrdered' => $totalOrdered,
                'orderedQty' => (int) $row->OrderedQty,
                'allocatedQty' => $myAllocatedQty,
                'allocatedToOthers' => $allocatedToOthers,
                'shortfall' => max(0, $totalOrdered - $availableQty),
            ];
        }

        usort($rows, fn($a, $b) => $b['shortfall'] <=> $a['shortfall']);

        return response()->json([
            'customer' => ['id' => $customer->Id, 'code' => $customer->Code, 'name' => $customer->Name, 'district' => $customer->District, 'taluk' => $customer->Taluk],
            'products' => $rows,
        ]);
    }


    /**
     * POST /api/allocations/by-customer
     * Body: { customerId, allocations: [{ productId, orderId, allocatedQty }] }
     *
     * Customer-wise save, now keyed by (ProductId, OrderId) — a customer
     * with two active Orders for the same product gets two independent
     * allocation rows here too, matching store() above. Same rule as the
     * product-wise store(): can never push a product's grand total (every
     * order's allocation, this customer's and everyone else's) past its
     * available stock.
     *
     * Same ERP-status carry-over fix, and the same Meter-lock-on-Approved
     * behaviour, as store() above — see that method's doc-block for the
     * full rationale.
     */
    public function storeByCustomer(Request $request)
    {
        $this->authorizeStaff($request);

        $validated = $request->validate([
            'customerId' => 'required|integer|exists:Customers,Id',
            'allocations' => 'required|array|min:1',
            'allocations.*.productId' => 'required|integer|exists:Products,Id',
            'allocations.*.orderId' => 'required|integer|exists:Orders,Id',
            'allocations.*.allocatedQty' => 'required|integer|min:0',
            'allocations.*.meters' => 'nullable|string|max:50',
        ]);

        $productIds = array_column($validated['allocations'], 'productId');
        $products = Product::whereIn('Id', $productIds)->get()->keyBy('Id');

        // "Elsewhere" = every other allocation row for this product,
        // regardless of which order it belongs to — excluded by OrderId
        // now instead of by CustomerId, since the same customer's other
        // Order for this product also needs to count towards the total.
        $orderIds = array_column($validated['allocations'], 'orderId');
        $allocatedElsewhere = SaleOrderLine::whereIn('CrmProductId', $productIds)
            ->whereNotIn('CrmOrderId', $orderIds)
            ->select('CrmProductId as ProductId', DB::raw('SUM(USERPRIMARYQUANTITY) as TotalAllocated'))
            ->groupBy('CrmProductId')
            ->get()
            ->keyBy('ProductId');

        foreach ($validated['allocations'] as $item) {
            $product = $products->get($item['productId']);
            if (!$product)
                continue;

            $others = (int) ($allocatedElsewhere->get($item['productId'])->TotalAllocated ?? 0);
            $grandTotal = $others + $item['allocatedQty'];

            if ($grandTotal > (int) $product->Quantity) {
                return response()->json([
                    'message' => "Total allocated for {$product->Name} ({$grandTotal}) can't exceed available stock (" . (int) $product->Quantity . ").",
                ], 422);
            }
        }

        $changedRows = [];

        DB::transaction(function () use ($validated, $request, &$changedRows) {
            foreach ($validated['allocations'] as $item) {
                $line = $this->resolveLine((int) $item['orderId'], $request->user());
                if (!$line) {
                    continue;
                }
                $qtyChanged = (int) $line->USERPRIMARYQUANTITY !== (int) $item['allocatedQty'];

                $attributes = [
                    'CrmCustomerId' => $validated['customerId'],
                    'USERPRIMARYQUANTITY' => $item['allocatedQty'],
                    'BASEPRIMARYQUANTITY' => $item['allocatedQty'],
                    'CrmAllocatedBy' => $request->user()->id,
                ];

                if ((int) $item['allocatedQty'] > 0 && !$line->CrmFirstAllocatedAt) {
                    $attributes['CrmFirstAllocatedAt'] = now();
                }

                // Meter lock — see store()'s doc-block above. Locks as soon
                // as the row is submitted (allocationId exists), not just
                // once Status reaches 'approved'.
                $isNew = $line->CrmAllocationStatus === null;
                if ($isNew || $qtyChanged) {
                    $attributes['CrmMeters'] = $item['meters'] ?? null;
                }

                if ($qtyChanged) {
                    $attributes['CrmAllocationStatus'] = 'pending';
                    $attributes['CrmDecidedBy'] = null;
                    $attributes['CrmDecidedAt'] = null;
                }

                // Carry-over fix — see store()'s doc-block above.
                if (
                    $line->CrmErpStatus === 'erp_so_created'
                    && (int) $item['allocatedQty'] > (int) $line->USERPRIMARYQUANTITY
                ) {
                    $attributes['CrmErpStatus'] = 'not_transferred';
                    $attributes['CrmErpTransferredAt'] = null;
                }

                $line->fill($attributes);
                $line->save();
                $this->consumeFifo($line);

                if ($qtyChanged) {
                    $changedRows[] = ['orderId' => (int) $item['orderId'], 'allocatedQty' => (int) $item['allocatedQty']];
                }
            }
        });

        $notifier = app(AllocationNotifier::class);
        foreach ($changedRows as $row) {
            if ($order = Order::with('customer')->find($row['orderId'])) {
                $notifier->allocated($order, $row['allocatedQty'], $request->user());
            }
        }

        Cache::forget('available_stock_summary');

        return response()->json(['message' => 'Allocation saved.']);
    }

    /**
     * GET /api/allocations/{id}/batches
     *
     * The FIFO breakdown for one saved allocation — "300 from BATCH-0004
     * (received 12-May-2026, rack) + 200 from BATCH-0007 (18-May-2026,
     * rack)". This is what turns "Goods allocation and movement on FIFO
     * basis" (O2C Step 8) from a number into an auditable paper trail.
     */
    public function batchBreakdown(Request $request, $id)
    {
        $this->authorizeStaff($request);

        $line = SaleOrderLine::with(['consumptions.batch'])->find($id);
        if (!$line) {
            return response()->json(['message' => 'Allocation not found.'], 404);
        }

        return response()->json([
            'allocationId' => $line->Id,
            'allocatedQty' => $line->USERPRIMARYQUANTITY,
            'consumptions' => $line->consumptions->map(fn($c) => [
                'batchNo' => $c->batch->BatchNo ?? '—',
                'warehouse' => $c->batch->Warehouse ?? '—',
                'receivedAt' => optional($c->batch->ReceivedAt ?? null)->toDateString(),
                'consumedQty' => $c->ConsumedQty,
            ])->values(),
        ]);
    }

    /**
     * GET /api/allocations/list
     * Optional filters: status=pending|approved|rejected,
     * erp_status=not_transferred|erp_so_created, date=YYYY-MM-DD (matches
     * DecidedAt), order_date=YYYY-MM-DD (matches the ORDER's creation date),
     * include_untouched=1 (also list active orders nobody has allocated to
     * yet), search=text (customer/product name or code).
     *
     * Flat list across every product/order with a saved allocation —
     * feeds the Sales Order page's "View Details" drill-downs
     * (Pending Final Approval / Approved Orders Today / Total Order Value /
     * ERP Transfer Pending / Today's Orders), which all read from this same
     * table rather than from Orders directly.
     *
     * Order context (Order No / Requested Qty) comes straight off the
     * allocation's own OrderId relation — no more guessing the right
     * Order by (ProductId, CustomerId), which could previously attach the
     * wrong Order's numbers to a row when a customer had more than one
     * Order for the same product.
     *
     * The response includes inquiryDate (order date) and firstAllocatedAt.
     */
    public function list(Request $request)
    {
        $this->authorizeStaff($request);

        $includeUntouched = $request->boolean('include_untouched');

        // "Has a saved allocation" == touched by Marketing Review at least once.
        // With include_untouched, active orders with nothing allocated yet
        // are listed too.
        $query = SaleOrderLine::with(['product', 'customer', 'order'])
            ->where(function ($w) use ($includeUntouched) {
                $w->where('USERPRIMARYQUANTITY', '>', 0)
                    ->orWhere('CrmAllocationStatus', '!=', 'pending')
                    ->orWhereNotNull('CrmDecidedAt');
                if ($includeUntouched) {
                    $w->orWhereHas('order', function ($q) {
                        $q->whereIn('Status', ALLOCATION_ACTIVE_STATUSES);
                    });
                }
            });

        if ($status = $request->query('status')) {
            $query->where('CrmAllocationStatus', $status);
        }
        if ($erpStatus = $request->query('erp_status')) {
            $query->where('CrmErpStatus', $erpStatus);
        }
        if ($date = $request->query('date')) {
            $query->whereDate('CrmDecidedAt', $date);
        }
        if ($orderDate = $request->query('order_date')) {
            $query->whereHas('order', function ($q) use ($orderDate) {
                $q->whereDate('CreatedAt', $orderDate);
            });
        }

        $allocations = $query->orderByDesc('IMPLASTUPDATEDATETIME')->get();

        if ($search = $request->query('search')) {
            $q = mb_strtolower($search);
            $allocations = $allocations->filter(function ($a) use ($q) {
                return str_contains(mb_strtolower($a->product->Name ?? ''), $q)
                    || str_contains(mb_strtolower($a->product->Code ?? ''), $q)
                    || str_contains(mb_strtolower($a->customer->Name ?? ''), $q)
                    || str_contains(mb_strtolower($a->customer->Code ?? ''), $q);
            })->values();
        }

        $productIds = $allocations->pluck('CrmProductId')->unique()->values();
        $products = Product::whereIn('Id', $productIds)->get()->keyBy('Id');
        $allocatedSumByProduct = SaleOrderLine::whereIn('CrmProductId', $productIds)
            ->select('CrmProductId as ProductId', DB::raw('SUM(USERPRIMARYQUANTITY) as TotalAllocated'))
            ->groupBy('CrmProductId')
            ->get()
            ->keyBy('ProductId');

        return response()->json($allocations->map(function ($a) use ($products, $allocatedSumByProduct) {
            $product = $products->get($a->CrmProductId);
            $poolAvailable = $product
                ? max(0, (int) $product->Quantity - (int) ($allocatedSumByProduct->get($a->CrmProductId)->TotalAllocated ?? 0))
                : 0;
            $rowAvailable = $poolAvailable + (int) $a->USERPRIMARYQUANTITY;

            return [
                'allocationId' => $a->Id,
                'productId' => $a->CrmProductId,
                'productCode' => $a->product->Code ?? null,
                'productName' => $a->product->Name ?? null,
                'uom' => ($a->order->OrderDetails['UOM'] ?? null) ?: ($a->product->UOM ?? null),
                'customerId' => $a->CrmCustomerId,
                'customerCode' => $a->customer->Code ?? null,
                'customerName' => $a->customer->Name ?? null,
                'orderId' => $a->CrmOrderId,
                'orderNo' => $a->order->Code ?? null,
                'inquiryDate' => ($a->order && $a->order->CreatedAt) ? substr((string) $a->order->CreatedAt, 0, 10) : null,
                'requestedQty' => $a->order->Quantity ?? null,
                'availableQty' => $rowAvailable,
                'allocatedQty' => (int) $a->USERPRIMARYQUANTITY,
                'meters' => $a->CrmMeters ?? '',
                'price' => (float) ($a->product->Price ?? 0),
                'totalValue' => round((float) $a->USERPRIMARYQUANTITY * (float) ($a->product->Price ?? 0), 2),
                'status' => $a->CrmAllocationStatus,
                'remarks' => $a->CrmRemarks,
                'erpStatus' => $a->CrmErpStatus,
                'decidedAt' => optional($a->CrmDecidedAt)->toDateTimeString(),
                'erpTransferredAt' => optional($a->CrmErpTransferredAt)->toDateTimeString(),
                'firstAllocatedAt' => optional($a->CrmFirstAllocatedAt)->toDateTimeString(),
                'updatedAt' => $a->IMPLASTUPDATEDATETIME,
            ];
        })->values());
    }

    /**
     * PATCH /api/allocations/{id}/decision
     * Body: { status?: 'approved'|'rejected', remarks?: string|null }
     *
     * System Admin's tick (approved) / cross (rejected) action in the
     * Marketing Review "Actions" column. Only allowed while the row is
     * still 'pending' when changing status — Remarks alone can be updated
     * at any time (the Remarks box is freeform and independent of the
     * approve/reject decision).
     *
     * Approving/rejecting here also mirrors onto the ONE underlying Order
     * this allocation now represents (see cascadeOrderStatus()) — since
     * allocations are per-order, this can no longer bleed onto a
     * customer's other, unrelated Order for the same product:
     *   - approved -> Order.Status = 'approved'
     *   - rejected -> Order.Status = 'declined'
     *
     * Approving also finalises the row's Meters figure — from this point
     * on store()/storeByCustomer() will refuse to overwrite it unless the
     * allocated qty is changed again (see the "METER LOCK" note above
     * store()), matching the Marketing Review UI locking the Meter box
     * read-only once a row is Approved.
     */
    public function decision(Request $request, $id)
    {
        $this->authorizeSystemAdmin($request);

        $validated = $request->validate([
            'status' => 'nullable|in:approved,rejected',
            'remarks' => 'nullable|string|max:2000',
            // ── System Admin "Edit Allocation" (Sales Order page) ──
            // Lets System Admin correct an already-allocated row's
            // AllocatedQty/Meters after the fact — e.g. Admin only
            // partially allocated it, or a correction is needed once it's
            // already sitting with (or past) System Admin. Independent of
            // the status/remarks handling above; can be sent alone.
            'allocatedQty' => 'nullable|integer|min:0',
            'meters' => 'nullable|string|max:50',
        ]);

        $allocation = SaleOrderLine::find($id);
        if (!$allocation) {
            return response()->json(['message' => 'Allocation not found.'], 404);
        }

        if (!empty($validated['status'])) {
            if ($allocation->CrmAllocationStatus !== 'pending') {
                return response()->json(['message' => 'Only a Pending row can be approved or rejected.'], 422);
            }
            $allocation->CrmAllocationStatus = $validated['status'];
            $allocation->CrmDecidedBy = $request->user()->id;
            $allocation->CrmDecidedAt = now();
            // ERP creation is a separate, later step — it only happens
            // when the "Transfer to ERP" button is clicked (see
            // erpTransfer() / bulkErpTransfer() below), never automatically
            // the instant a row is ticked here.

            if ($allocation->CrmOrderId && $validated['status'] === 'approved') {
                $this->cascadeOrderStatus($allocation->CrmOrderId, 'approved');
            }

            if ($allocation->CrmOrderId && ($order = Order::with('customer')->find($allocation->CrmOrderId))) {
                app(AllocationNotifier::class)->decided($order, $validated['status'], $request->user());
            }
        }

        if ($request->has('remarks')) {
            $allocation->CrmRemarks = $validated['remarks'];
        }

        // ── System Admin qty/meter edit ──
        // Same available-stock cap store()/storeByCustomer() enforce: the
        // product's grand total allocated (every OTHER order's allocation
        // for this product, plus this row's NEW qty) can never exceed the
        // product's on-hand Quantity. Only re-checked/applied when
        // allocatedQty is actually present in this request.
        if ($request->has('allocatedQty')) {
            $newQty = (int) $validated['allocatedQty'];
            $product = Product::find($allocation->CrmProductId);
            if (!$product) {
                return response()->json(['message' => 'Product not found for this allocation.'], 404);
            }

            $allocatedElsewhere = (int) SaleOrderLine::where('CrmProductId', $allocation->CrmProductId)
                ->where('Id', '!=', $allocation->Id)
                ->sum('USERPRIMARYQUANTITY');
            $grandTotal = $allocatedElsewhere + $newQty;

            $available = $this->availableStock($product);
            if ($available !== null && $grandTotal > $available) {
                return response()->json([
                    'message' => "Total allocated for {$product->Name} ({$grandTotal}) can't exceed available stock (" . $available . ").",
                ], 422);
            }

            // Same ERP carry-over fix as store()/storeByCustomer(): if this
            // row was already transferred and the edit raises its qty
            // above what was actually transferred, drop it back to
            // 'not_transferred' so the new total goes through Approve ->
            // Ready for ERP -> Transfer again.
            if ($allocation->CrmErpStatus === 'erp_so_created' && $newQty > (int) $allocation->USERPRIMARYQUANTITY) {
                $allocation->CrmErpStatus = 'not_transferred';
                $allocation->CrmErpTransferredAt = null;
            }

            $allocation->USERPRIMARYQUANTITY = $newQty;
            $allocation->BASEPRIMARYQUANTITY = $newQty;
        }
        if ($request->has('meters')) {
            $allocation->CrmMeters = $validated['meters'];
        }
        if ($request->has('allocatedQty') || $request->has('meters')) {
            $allocation->CrmTotalMtrQty = (int) $allocation->USERPRIMARYQUANTITY * $this->meterMultiplier($allocation->CrmMeters);
        }

        $allocation->save();

        // Re-run FIFO batch consumption whenever the qty actually changed,
        // same as store()/storeByCustomer() — keeps the batch-level paper
        // trail (and every other batch's RemainingQty) in sync with the
        // corrected AllocatedQty instead of silently going stale.
        if ($request->has('allocatedQty')) {
            $this->consumeFifo($allocation);
        }

        Cache::forget('available_stock_summary');

        return response()->json([
            'message' => 'Saved.',
            'status' => $allocation->CrmAllocationStatus,
            'remarks' => $allocation->CrmRemarks,
            'allocatedQty' => (int) $allocation->USERPRIMARYQUANTITY,
            'meters' => $allocation->CrmMeters,
            'erpStatus' => $allocation->CrmErpStatus,
        ]);
    }

    /**
     * POST /api/allocations/bulk-decision
     * Body: { ids: [1,2,3], status: 'approved'|'rejected' }
     * "Approve Selected" / "Reject Selected" — only rows still Pending are
     * actually moved; anything else in the list is silently skipped.
     *
     * Same Order-status mirroring as decision() above, applied per
     * allocation's own OrderId. Same Meter-lock-on-Approved effect as
     * decision() too (enforced by store()/storeByCustomer() reading
     * Status, not by anything special here).
     */
    public function bulkDecision(Request $request)
    {
        $this->authorizeSystemAdmin($request);

        $validated = $request->validate([
            'ids' => 'required|array|min:1',
            'ids.*' => 'integer',
            'status' => 'required|in:approved,rejected',
        ]);

        // Snapshot which OrderIds are actually Pending and about to move,
        // BEFORE updating, so we know exactly which Orders to cascade onto
        // afterwards.
        $targets = SaleOrderLine::whereIn('Id', $validated['ids'])
            ->where('CrmAllocationStatus', 'pending')
            ->get(['Id', 'CrmOrderId']);

        $updated = SaleOrderLine::whereIn('Id', $validated['ids'])
            ->where('CrmAllocationStatus', 'pending')
            ->update([
                'CrmAllocationStatus' => $validated['status'],
                'CrmDecidedBy' => $request->user()->id,
                'CrmDecidedAt' => now(),
            ]);

        $orderStatus = $validated['status'] === 'approved' ? 'approved' : 'declined';
        $notifier = app(AllocationNotifier::class);
        foreach ($targets as $t) {
            if ($t->CrmOrderId) {
                $this->cascadeOrderStatus($t->CrmOrderId, $orderStatus);
                if ($order = Order::with('customer')->find($t->CrmOrderId)) {
                    $notifier->decided($order, $validated['status'], $request->user());
                }
            }
        }

        Cache::forget('available_stock_summary');

        return response()->json(['message' => "{$updated} row(s) updated.", 'updated' => $updated]);
    }

    /**
     * POST /api/allocations/{id}/erp-transfer
     *
     * Only an Approved row can be pushed to ERP. This performs a REAL
     * write into Oracle's live SALESORDERIBEAN / SALESORDERLINEIBEAN
     * tables (via App\Services\OracleSalesOrderTransfer) — not just a
     * local status flip. CrmErpStatus only becomes 'erp_so_created' once
     * that Oracle insert has actually succeeded; on any failure (Oracle
     * unreachable, rejected, etc.) the row is left exactly as it was so
     * the button can simply be clicked again. This is a deliberate,
     * separate action from Approve — it is never triggered automatically.
     *
     * Also mirrors onto the ONE underlying Order this allocation
     * represents: the ERP handoff means production/fulfilment now starts,
     * so Order.Status advances to 'processing' — matching the Order
     * Status tab's own pending -> approved -> processing -> dispatched ->
     * delivered flow. Only applied once the Oracle write succeeds.
     */
    public function erpTransfer(Request $request, $id, OracleSalesOrderTransfer $transfer)
    {
        $this->authorizeSystemAdmin($request);

        $allocation = SaleOrderLine::find($id);
        if (!$allocation) {
            return response()->json(['message' => 'Allocation not found.'], 404);
        }
        if ($allocation->CrmAllocationStatus !== 'approved') {
            return response()->json(['message' => 'Only an Approved allocation can be transferred to ERP.'], 422);
        }
        if ($allocation->CrmErpStatus === 'erp_so_created') {
            return response()->json(['message' => 'Already transferred.', 'erpStatus' => $allocation->CrmErpStatus]);
        }

        $result = $transfer->transferLine($allocation, $request->user());
        if (!$result['success']) {
            return response()->json(['message' => $result['message']], 502);
        }

        if ($allocation->CrmOrderId) {
            $this->cascadeOrderStatus($allocation->CrmOrderId, 'processing');
            if ($order = Order::with('customer')->find($allocation->CrmOrderId)) {
                app(AllocationNotifier::class)->erpCreated($order, $request->user());
            }
        }

        Cache::forget('available_stock_summary');

        return response()->json(['message' => $result['message'], 'erpStatus' => $allocation->fresh()->CrmErpStatus]);
    }

    /**
     * POST /api/allocations/bulk-erp-transfer
     * Body: { ids: [1,2,3] }
     *
     * Bulk version of erpTransfer() above — same real Oracle write per
     * row, via OracleSalesOrderTransfer. Rows are attempted one at a
     * time and independently: one row failing (e.g. an Oracle timeout
     * mid-batch) does not block or falsely mark any of the others. The
     * response reports exactly which rows succeeded and which failed,
     * with why, so a partial failure is never silent.
     *
     * Same Order-status mirroring as erpTransfer() above (-> 'processing'),
     * applied per allocation's own OrderId, only for rows that actually
     * transferred successfully.
     */
    public function bulkErpTransfer(Request $request, OracleSalesOrderTransfer $transfer)
    {
        $this->authorizeSystemAdmin($request);

        $validated = $request->validate([
            'ids' => 'required|array|min:1',
            'ids.*' => 'integer',
        ]);

        $rows = SaleOrderLine::whereIn('Id', $validated['ids'])
            ->where('CrmAllocationStatus', 'approved')
            ->where('CrmErpStatus', '!=', 'erp_so_created')
            ->get();

        $succeeded = [];
        $failed = [];

        foreach ($rows as $row) {
            $result = $transfer->transferLine($row, $request->user());
            if ($result['success']) {
                $succeeded[] = $row->Id;
                if ($row->CrmOrderId) {
                    $this->cascadeOrderStatus($row->CrmOrderId, 'processing');
                    if ($order = Order::with('customer')->find($row->CrmOrderId)) {
                        app(AllocationNotifier::class)->erpCreated($order, $request->user());
                    }
                }
            } else {
                $failed[] = ['id' => $row->Id, 'message' => $result['message']];
            }
        }

        $message = count($succeeded) . ' row(s) transferred.';
        if (!empty($failed)) {
            $message .= ' ' . count($failed) . ' row(s) failed.';
        }

        Cache::forget('available_stock_summary');

        return response()->json([
            'message' => $message,
            'updated' => count($succeeded),
            'succeeded' => $succeeded,
            'failed' => $failed,
        ]);
    }



    /** Only System Admin may give final approval/rejection or push to ERP. */
    private function authorizeSystemAdmin(Request $request): void
    {
        $role = $request->user()->role ?? null;
        abort_unless($role === 'system_admin', 403, 'Only System Admin can perform this action.');
    }

    /**
     * Mirrors an allocation decision (approve/reject) or ERP handoff onto
     * the ONE Order this allocation represents (matched by OrderId
     * directly now — no more matching by ProductId+CustomerId, which
     * used to move every active Order a customer had for that product
     * together, even ones the decision never touched).
     */
    private function cascadeOrderStatus(int $orderId, string $orderStatus): void
    {
        Order::where('Id', $orderId)
            ->whereIn('Status', ALLOCATION_ACTIVE_STATUSES)
            ->update(['Status' => $orderStatus]);
    }

    /**
     * Available stock for a product from Oracle (cached 60 s).
     * Returns null when Oracle is unreachable — callers treat null as
     * "unknown" and skip the cap check rather than blocking with a false 422.
     * Falls back to local Products.Quantity ONLY when it is > 0 (non-zero
     * means it was manually entered); 0 almost always means "not synced from
     * Oracle" rather than "truly sold out".
     */
    private function availableStock(Product $product): ?int
    {
        // 60-second cache matches the board() window — consistent stock figures.
        $oracleQty = app(OracleStock::class)->forProducts([$product], 60)[$product->Id] ?? null;
        if ($oracleQty !== null) {
            return $oracleQty;
        }
        $localQty = (int) $product->Quantity;
        return $localQty > 0 ? $localQty : null; // null = Oracle down + no local stock data
    }

    /**
     * Draws AllocatedQty units from this product's batches, oldest
     * ReceivedAt first (FIFO), and records the consumption trail. Re-runs
     * cleanly if an allocation is edited: previously-consumed quantity is
     * released back to its batches before redrawing, so editing an
     * allocation up or down never leaves stale reservations behind.
     */
    private function consumeFifo(SaleOrderLine $allocation): void
    {
        // Release whatever this allocation previously consumed.
        $previous = AllocationBatchConsumption::where('SaleOrderLineId', $allocation->Id)->get();
        foreach ($previous as $c) {
            StockBatch::where('Id', $c->BatchId)->increment('RemainingQty', $c->ConsumedQty);
        }
        AllocationBatchConsumption::where('SaleOrderLineId', $allocation->Id)->delete();

        $needed = (int) $allocation->USERPRIMARYQUANTITY;
        if ($needed <= 0) {
            return;
        }

        $this->ensureOpeningBatch($allocation->CrmProductId);

        $batches = StockBatch::where('ProductId', $allocation->CrmProductId)
            ->where('RemainingQty', '>', 0)
            ->orderBy('ReceivedAt')
            ->lockForUpdate()
            ->get();

        foreach ($batches as $batch) {
            if ($needed <= 0)
                break;
            $take = min($needed, $batch->RemainingQty);
            if ($take <= 0)
                continue;

            $batch->decrement('RemainingQty', $take);
            AllocationBatchConsumption::create([
                'SaleOrderLineId' => $allocation->Id,
                'BatchId' => $batch->Id,
                'ConsumedQty' => $take,
            ]);
            $needed -= $take;
        }
        // If $needed > 0 here, batch records haven't caught up with
        // Products.Quantity (e.g. stock adjusted directly). The allocation
        // itself is still saved — this only affects the FIFO paper trail.
    }

    /**
     * Finds the sale_order_line for this Order (created automatically when
     * the order was placed — see App\Services\SaleOrderService::stageOrder).
     * Stages it on the spot if it's somehow missing (e.g. the order was
     * placed while SALE_ORDER_STAGING was off and has since been turned
     * back on) so an allocation always has a row to attach to.
     */
    private function resolveLine(int $orderId, $actingUser = null): ?SaleOrderLine
    {
        $line = SaleOrderLine::where('CrmOrderId', $orderId)->first();

        if ($line) {
            // Guard: verify the line's CrmProductId matches the Order's
            // actual ProductId. A mis-staged line (e.g. from a race or from
            // when stageOrder was called with a wrong product) has the right
            // CrmOrderId but the wrong CrmProductId. The board() groups by
            // CrmProductId, so a mis-stamped line ends up in the wrong
            // bucket and returns allocatedQty=0 even after a successful save.
            $order = Order::find($orderId);
            if ($order) {
                $productMismatch = (int) $line->CrmProductId !== (int) $order->ProductId;
                // Same idea, for CustomerId — see the matching guard in
                // board()/index() above. A line tied to this exact OrderId
                // but the WRONG customer is contamination (a stray row from
                // the old product_allocations backfill), never a real
                // allocation for this order. Self-heal it to a clean,
                // never-touched state — qty/status/meters/remarks/ERP all
                // reset — rather than letting Admin unknowingly submit its
                // stale numbers as if they were their own new allocation.
                $customerMismatch = $line->CrmCustomerId !== null && (int) $line->CrmCustomerId !== (int) $order->CustomerId;

                if ($productMismatch) {
                    $line->CrmProductId = $order->ProductId;
                }
                if ($customerMismatch) {
                    $line->CrmCustomerId = $order->CustomerId;
                    $line->USERPRIMARYQUANTITY = 0;
                    $line->BASEPRIMARYQUANTITY = 0;
                    $line->CrmMeters = null;
                    $line->CrmAllocationStatus = 'not_submitted';
                    $line->CrmRemarks = null;
                    $line->CrmDecidedBy = null;
                    $line->CrmDecidedAt = null;
                    $line->CrmErpStatus = 'not_transferred';
                    $line->CrmErpTransferredAt = null;
                }
                if ($productMismatch || $customerMismatch) {
                    $line->save();
                }
            }
            return $line;
        }

        $order = Order::find($orderId);
        if (!$order) {
            return null;
        }
        $product = Product::find($order->ProductId);
        $customer = Customer::find($order->CustomerId);
        if (!$product || !$customer) {
            return null;
        }

        return app(SaleOrderService::class)->stageOrder($order, $product, $customer, $actingUser);
    }

    /**
     * Bridges legacy stock: a product created before batch tracking existed
     * has a Quantity but zero StockBatch rows. The first time it's ever
     * allocated against, open one batch for its current on-hand quantity
     * (dated at the product's own creation) so FIFO has something to draw
     * from without requiring a manual backfill for every product.
     */
    private function ensureOpeningBatch(int $productId): void
    {
        $hasBatches = StockBatch::where('ProductId', $productId)->exists();
        if ($hasBatches)
            return;

        $product = Product::find($productId);
        if (!$product || (int) $product->Quantity <= 0)
            return;

        StockBatch::create([
            'BatchNo' => 'BATCH-OPEN-' . $productId,
            'ProductId' => $productId,
            'Warehouse' => StockBatch::warehouseForCategory($product->Category),
            'ReceivedQty' => (int) $product->Quantity,
            'RemainingQty' => (int) $product->Quantity,
            'ReceivedAt' => $product->CreatedAt ?? now(),
            'Notes' => 'Opening stock (auto-created on first allocation, pre-dates batch tracking).',
        ]);
    }

    /**
     * POST /api/allocations/{id}/cancel
     *
     * Sales Order page's "Reject" button (Pending Final Approval view).
     * Distinct from decision()'s reject: that keeps the allocation row
     * around with Status = 'rejected' (shows elsewhere as "Lost"). This one
     * removes the row from the allocation pool entirely — any stock it had
     * reserved via FIFO is released back to its batches for other customers
     * to draw from, and the underlying Order is cascaded to 'declined', the
     * same way decision() does.
     */
    public function cancel(Request $request, $id)
    {
        $this->authorizeSystemAdmin($request);

        $allocation = SaleOrderLine::find($id);
        if (!$allocation) {
            return response()->json(['message' => 'Allocation not found.'], 404);
        }

        $orderId = $allocation->CrmOrderId;

        DB::transaction(function () use ($allocation, $orderId) {
            // Release whatever this allocation had reserved via FIFO — same
            // release step consumeFifo() itself does before redrawing.
            $consumptions = AllocationBatchConsumption::where('SaleOrderLineId', $allocation->Id)->get();
            foreach ($consumptions as $c) {
                StockBatch::where('Id', $c->BatchId)->increment('RemainingQty', $c->ConsumedQty);
            }
            AllocationBatchConsumption::where('SaleOrderLineId', $allocation->Id)->delete();

            // Removes this line (and its header, if it was the header's
            // only line) — same helper Order deletion uses. A cancelled/
            // declined order has no business staying in the ERP export.
            if ($orderId) {
                app(SaleOrderService::class)->removeForOrder((int) $orderId);
            } else {
                $allocation->delete();
            }
        });

        if ($orderId) {
            $this->cascadeOrderStatus($orderId, 'declined');
            if ($order = Order::with('customer')->find($orderId)) {
                app(AllocationNotifier::class)->cancelled($order, $request->user());
            }
        }

        Cache::forget('available_stock_summary');

        return response()->json(['message' => 'Order removed from Sales Order.']);
    }

    /** Only Admin / System Admin may view or set allocations; Super Admin can view but not save. */
    private function authorizeStaff(Request $request): void
    {
        $role = $request->user()->role ?? null;
        abort_unless(in_array($role, ['admin', 'system_admin', 'super_admin'], true), 403, 'Not permitted.');

        if ($request->isMethod('post')) {
            abort_if($role === 'super_admin', 403, 'Super Admin is read-only.');
        }
    }

    // GET /api/erp-export/{orderId} (staged ERP Header + Line preview) now lives in
    // SaleOrderController::byOrder — see routes/api.php.

    /** Total Mtr (Σ cases × Mtr) saved on a line. Uses the stored figure, else cases × Mtr. */
    private function lineMtrTotal($line): float
    {
        if (!$line)
            return 0.0;
        $stored = (float) ($line->CrmTotalMtrQty ?? 0);
        if ($stored > 0)
            return $stored;
        return (int) $line->USERPRIMARYQUANTITY * $this->meterMultiplier($line->CrmMeters);
    }

    /** What a line's total Mtr will be after saving $newQty cases with $meters. */
    private function projectedMtrTotal($line, int $newQty, $meters): float
    {
        $oldQty = $line ? (int) $line->USERPRIMARYQUANTITY : 0;
        $oldTotal = $this->lineMtrTotal($line);
        if ($line && $newQty === $oldQty)
            return $oldTotal;           // nothing changed
        if ($oldQty > 0 && $newQty > $oldQty) {                       // top-up: keep old, add new at new Mtr
            return $oldTotal + ($newQty - $oldQty) * $this->meterMultiplier($meters);
        }
        return $newQty * $this->meterMultiplier($meters);             // first allocation / reduction
    }
}