<?php

namespace App\Services;

use App\Models\Customer;
use App\Models\Order;
use App\Models\User;
use App\Models\Product;
use App\Models\SaleOrderHeader;
use App\Models\SaleOrderLine;
use Carbon\Carbon;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Writes the client's ERP-format Header + Line rows (sale_order_header /
 * sale_order_line) whenever the CRM creates, edits or deletes an Order.
 *
 * CRM model:   one Orders row per product  (rows of one cart share a GroupRef)
 * ERP model:   ONE header per cart  +  ONE line per product
 *
 *   sale_order_line.FATHERID  =  sale_order_header.RELATEDDEPENDENTID
 *
 * The CRM's own Orders / Products tables stay the source of truth for the
 * website — this only adds the ERP-shaped copy next to them.
 */
class SaleOrderService
{
    /** @var array<string,?string> per-request cache of resolved CUSTOMERSUPPLIERCODE, keyed by OracleId */
    private array $customerSupplierCodeCache = [];

    /** @var array<string,array{uniqueId:?string,addressee:?string}> per-request cache of resolved delivery point, keyed by OracleId */
    private array $deliveryPointCache = [];



    /** @var array<string,array> per-request cache of Oracle item specs */
    private array $specCache = [];

    public function enabled(): bool
    {
        return (bool) config('sale_order.enabled', true);
    }

    // ─────────────────────────────────────────────────────────────
    //  CREATE
    // ─────────────────────────────────────────────────────────────

    /**
     * Stage one CRM Order as a line, creating the cart's header the first
     * time that cart is seen.
     *
     * @param string|null $groupRef  cart key shared by every product of the same order
     *                               (OrderDetails.GroupRef / cartRef). null = its own header.
     */
    public function stageOrder(
        Order $order,
        Product $product,
        Customer $customer,
        $caller = null,
        ?string $groupRef = null,
        ?string $notes = null
    ): ?SaleOrderLine {
        if (!$this->enabled()) {
            return null;
        }

        return DB::transaction(function () use ($order, $product, $customer, $caller, $groupRef, $notes) {
            // Idempotent: never create a second line for the same CrmOrderId.
            // Checks CrmOrderId ONLY first — one order must have exactly one line.
            // If the existing line has a wrong CrmProductId (mis-staged from an
            // earlier race or bad call), correct it in place rather than adding
            // a new shadow row with qty=0, which is what caused duplicates.
            $existing = SaleOrderLine::where('CrmOrderId', $order->Id)->first();
            if ($existing) {
                if ((int) $existing->CrmProductId !== (int) $product->Id) {
                    $existing->CrmProductId = $product->Id;
                    $existing->save();
                }
                return $existing;
            }

            $groupRef = $groupRef ?: 'ORDER-' . $order->Id;

            $header = SaleOrderHeader::where('CrmGroupRef', $groupRef)
                ->where('CrmCustomerId', $customer->Id)
                ->first();

            if (!$header) {
                $header = $this->createHeader($order, $customer, $caller, $groupRef, $notes);
            }

            return $this->createLine($header, $order, $product, $caller);
        });
    }

    private function createHeader(Order $order, Customer $customer, $caller, string $groupRef, ?string $notes): SaleOrderHeader
    {
        return $this->withRetry(function () use ($order, $customer, $caller, $groupRef, $notes) {
            $now = now();
            $today = $now->copy()->startOfDay();
            $due = $order->DeliveryDate ? Carbon::parse($order->DeliveryDate)->startOfDay() : $today;
            $cust = $this->erpCustomerCode($customer);
            $deliveryPoint = $this->deliveryPoint($customer);

            return SaleOrderHeader::create(array_merge(config('sale_order.header_defaults', []), [
                'IMPORTAUTOCOUNTER' => $this->nextValue(SaleOrderHeader::class, 'IMPORTAUTOCOUNTER', 'header_counter_start'),
                'CODE' => $this->nextCode(),
                'ORDERDATE' => $today,
                'ORDPRNCUSTOMERSUPPLIERCODE' => $cust,
                'FNCORDPRNCUSTOMERSUPPLIERCODE' => $cust,
                'DELIVERYPOINTUNIQUEID' => $deliveryPoint['uniqueId'],
                'REQUIREDDUEDATE' => $due,
                'CONDITIONRETRIEVINGDATE' => $today,
                'DESCRIPTION' => $notes !== null && $notes !== '' ? mb_substr($notes, 0, 255) : null,
                'IMPORTSTATUS' => (int) config('sale_order.import_status', 0),
                'IMPCREATIONDATETIME' => $now,
                'IMPCREATIONUSER' => $this->adminNameForCustomer($customer),
                'IMPLASTUPDATEDATETIME' => $now,
                'RELATEDDEPENDENTID' => $this->nextDependentId(),
                // CRM-only
                'CrmGroupRef' => $groupRef,
                'CrmCustomerId' => $customer->Id,
            ]));
        });
    }

    private function createLine(SaleOrderHeader $header, Order $order, Product $product, $caller): SaleOrderLine
    {
        return $this->withRetry(function () use ($header, $order, $product, $caller) {
            $now = now();
            $today = $now->copy()->startOfDay();
            $customer = Customer::find($header->CrmCustomerId);

            $details = is_array($order->OrderDetails) ? $order->OrderDetails : [];
            $uom = $this->erpUom($details['UOM'] ?? null);
            $qty = (float) $order->Quantity;
            $price = (float) $order->PricePerUnit;
            $spec = $this->itemSpec($product);

            $due = $order->DeliveryDate
                ? Carbon::parse($order->DeliveryDate)->startOfDay()
                : ($header->REQUIREDDUEDATE ? Carbon::parse($header->REQUIREDDUEDATE)->startOfDay() : $today);

            $orderLine = ((int) SaleOrderLine::where('FATHERID', $header->RELATEDDEPENDENTID)->max('ORDERLINE')) + 10;

            return SaleOrderLine::create(array_merge(config('sale_order.line_defaults', []), [
                'FATHERID' => $header->RELATEDDEPENDENTID,
                'IMPORTAUTOCOUNTER' => $this->nextValue(SaleOrderLine::class, 'IMPORTAUTOCOUNTER', 'line_counter_start'),
                'ORDERLINE' => $orderLine,

                // What was ordered
                'ITEMTYPEAFICODE' => $spec['ITEMTYPECODE'] ?? config('sale_order.default_item_type', 'PDF'),
                'SUBCODE01' => $this->str($product->SortNo ?: $product->Code, 50),      // Sort No
                'SUBCODE02' => $this->str($spec['SUBCODE02'] ?? null, 50),
                'SUBCODE03' => $this->str($spec['SUBCODE03'] ?? null, 50),
                'SUBCODE04' => $this->str($spec['SUBCODE04'] ?? null, 50),
                'SUBCODE05' => $this->str($spec['SUBCODE05'] ?? null, 50),
                'SUBCODE06' => $this->str($spec['SUBCODE06'] ?? null, 50),
                'SUBCODE07' => $this->str($spec['SUBCODE07'] ?? null, 50),
                'SUBCODE08' => $this->str($product->ShadeNo, 50),                        // Shade No
                'ITEMDESCRIPTION' => $this->str($product->Name, 255),

                // Quantity / unit.
                // ORIGINALUSERPRIMARYQUANTITY = what the customer asked for
                // (kept in sync with Orders.Quantity — see syncFromOrder()).
                // USERPRIMARYQUANTITY / BASEPRIMARYQUANTITY = what has
                // actually been ALLOCATED. Starts at 0 (nothing allocated
                // yet) and is set by the Marketing Review allocation screen
                // (App\Http\Controllers\Api\AllocationController) — this is
                // the figure that goes to the ERP.
                'USERPRIMARYUOMCODE' => $uom,
                'USERPRIMARYQUANTITY' => 0,
                'BASEPRIMARYUOMCODE' => $uom,
                'BASEPRIMARYQUANTITY' => 0,
                'ORIGINALUSERPRIMARYQUANTITY' => $qty,
                // No kg-per-metre conversion is known to the CRM.
                'USERSECONDARYQUANTITY' => 0,
                'BASESECONDARYQUANTITY' => 0,
                'ORIGINALUSERSECONDARYQUANTITY' => 0,

                // Price
                'PRICEUNITOFMEASURECODE' => $uom,
                'PRICE' => $price,
                'PRICERETRIEVED' => $price,

                // Allocation workflow (merged in from the old
                // product_allocations table — see AllocationController).
                // 'not_submitted' = "not yet touched by Admin" (shows as Not
                // Allocated in the UI). 'pending' is only written when Admin
                // types a qty and clicks Approval — that is what System Admin
                // sees for review. Using 'not_submitted' here prevents new
                // orders from appearing pre-allocated in the Admin's board.
                'CrmCustomerId' => $header->CrmCustomerId,
                'CrmAllocationStatus' => 'not_submitted',
                'CrmErpStatus' => 'not_transferred',

                // Dates / audit
                'REQUIREDDUEDATE' => $due,
                'CONDITIONRETRIEVINGDATE' => $today,
                'IMPORTSTATUS' => (int) config('sale_order.import_status', 0),
                'IMPCREATIONDATETIME' => $now,
                'IMPCREATIONUSER' => $this->adminNameForCustomer($customer),
                'IMPLASTUPDATEDATETIME' => $now,
                'RELATEDDEPENDENTID' => $this->nextDependentId(),

                // CRM-only
                'CrmOrderId' => $order->Id,
                'CrmProductId' => $product->Id,
            ]));
        });
    }

    // ─────────────────────────────────────────────────────────────
    //  UPDATE / DELETE  (called from Order model events)
    // ─────────────────────────────────────────────────────────────

    /**
     * Keep the staged line in step when price / delivery date / UOM change
     * on the CRM order, and keep ORIGINALUSERPRIMARYQUANTITY (what was
     * requested) matching Orders.Quantity.
     *
     * Deliberately does NOT touch USERPRIMARYQUANTITY / BASEPRIMARYQUANTITY
     * — those hold the ALLOCATED quantity (see createLine() above) and are
     * only ever changed by the Marketing Review allocation screen
     * (AllocationController), never by editing the order itself.
     */
    public function syncFromOrder(Order $order): void
    {
        if (!$this->enabled()) {
            return;
        }
        $line = SaleOrderLine::where('CrmOrderId', $order->Id)->first();
        if (!$line) {
            return;
        }

        $details = is_array($order->OrderDetails) ? $order->OrderDetails : [];
        $uom = $this->erpUom($details['UOM'] ?? null);
        $qty = (float) $order->Quantity;
        $price = (float) $order->PricePerUnit;
        $now = now();

        $update = [
            'USERPRIMARYUOMCODE' => $uom,
            'BASEPRIMARYUOMCODE' => $uom,
            'PRICEUNITOFMEASURECODE' => $uom,
            'ORIGINALUSERPRIMARYQUANTITY' => $qty,
            'PRICE' => $price,
            'PRICERETRIEVED' => $price,
            'IMPLASTUPDATEDATETIME' => $now,
        ];
        if ($order->DeliveryDate) {
            $update['REQUIREDDUEDATE'] = Carbon::parse($order->DeliveryDate)->startOfDay();
        }

        SaleOrderLine::where('Id', $line->Id)->update($update);
        SaleOrderHeader::where('RELATEDDEPENDENTID', $line->FATHERID)->update(['IMPLASTUPDATEDATETIME' => $now]);
    }

    /** Remove the staged line of a deleted CRM order (and its header once it has no lines left). */
    public function removeForOrder(int $orderId): void
    {
        if (!$this->enabled()) {
            return;
        }
        $line = SaleOrderLine::where('CrmOrderId', $orderId)->first();
        if (!$line) {
            return;
        }
        DB::transaction(function () use ($line) {
            $fatherId = $line->FATHERID;
            SaleOrderLine::where('Id', $line->Id)->delete();
            if (!SaleOrderLine::where('FATHERID', $fatherId)->exists()) {
                SaleOrderHeader::where('RELATEDDEPENDENTID', $fatherId)->delete();
            }
        });
    }

    /** ERP-layout column names of a staging table (CRM-only helper columns removed). */
    public function exportColumns(string $modelClass): array
    {
        $model = new $modelClass();
        $all = \Illuminate\Support\Facades\Schema::getColumnListing($model->getTable());
        return array_values(array_filter($all, fn($c) => !in_array($c, $modelClass::CRM_ONLY_COLUMNS, true)));
    }

    // ─────────────────────────────────────────────────────────────
    //  Helpers
    // ─────────────────────────────────────────────────────────────

    /**
     * SALESORDERIBEAN.FNCORDPRNCUSTOMERSUPPLIERCODE / ORDPRNCUSTOMERSUPPLIERCODE
     * must carry ORDERPARTNER.CUSTOMERSUPPLIERCODE — NOT the raw
     * Customers.OracleId (= BUSINESSPARTNER.NUMBERID). ORDERPARTNER links a
     * BUSINESSPARTNER to its CUSTOMERSUPPLIERCODE via
     * ORDERBUSINESSPARTNERNUMBERID = BUSINESSPARTNER.NUMBERID.
     */
    private function erpCustomerCode(Customer $customer): ?string
    {
        $numberId = trim((string) ($customer->OracleId ?? ''));
        if ($numberId === '') {
            return null;
        }

        if (array_key_exists($numberId, $this->customerSupplierCodeCache)) {
            return $this->customerSupplierCodeCache[$numberId];
        }

        $code = null;
        try {
            $row = DB::connection('oracle')
                ->table('ORDERPARTNER')
                ->where('ORDERBUSINESSPARTNERNUMBERID', $numberId)
                ->where('CUSTOMERSUPPLIERTYPE', '1') // 1 = customer, 2 = supplier
                ->value('CUSTOMERSUPPLIERCODE');

            $code = $row !== null ? trim((string) $row) : null;
            $code = $code !== '' ? $code : null;
        } catch (Throwable $e) {
            Log::warning('SaleOrderService: ORDERPARTNER lookup failed for OracleId ' . $numberId, [
                'error' => $e->getMessage(),
            ]);
        }

        if ($code === null) {
            Log::warning('SaleOrderService: no ORDERPARTNER.CUSTOMERSUPPLIERCODE found for Customers.OracleId ' . $numberId . ' — FNCORDPRNCUSTOMERSUPPLIERCODE/ORDPRNCUSTOMERSUPPLIERCODE will be left null rather than sending the wrong code.');
        }

        return $this->customerSupplierCodeCache[$numberId] = ($code !== null ? mb_substr($code, 0, 50) : null);
    }

    /**
     * IMPCREATIONUSER on every staged Header/Line — and, since
     * OracleSalesOrderTransfer copies these columns verbatim, on the real
     * Oracle SALESORDERIBEAN/SALESORDERLINEIBEAN rows too — must read as
     * the responsible Admin, never the End User or Customer who actually
     * placed the order. Resolved by the customer's own District, the same
     * area-matching OrderController::adminsForDistrict() uses elsewhere;
     * falls back to any Admin, then the literal "Admin" if none exist.
     */
    private function adminNameForCustomer(?Customer $customer): string
    {
        $admins = User::where('role', 'admin')->whereNotNull('name')->get();
        if ($admins->isEmpty()) {
            return 'Admin';
        }

        $district = $customer->District ?? null;
        if ($district) {
            $matched = $admins->first(fn(User $u) => in_array($district, $this->userDistricts($u), true));
            if ($matched) {
                return mb_substr($matched->name, 0, 50);
            }
        }

        return mb_substr($admins->first()->name, 0, 50);
    }

    private function userDistricts(User $u): array
    {
        $raw = $u->district;
        if (is_array($raw)) {
            return $raw;
        }
        if (is_string($raw) && $raw !== '') {
            $decoded = json_decode($raw, true);
            return is_array($decoded) ? $decoded : [$raw];
        }
        return [];
    }

    /**
     * SALESORDERIBEAN.DELIVERYPOINTUNIQUEID must carry ADDRESS.UNIQUEID for
     * this customer's delivery address — not left null. ADDRESS.CODE,
     * BUSINESSPARTNER.NUMBERID and ORDERPARTNER.ORDERBUSINESSPARTNERNUMBERID
     * all carry the same business-partner identifier, so the same
     * Customers.OracleId erpCustomerCode() above already matches against
     * ORDERPARTNER is matched against ADDRESS.CODE here. Returns both the
     * UNIQUEID (for the ERP header) and ADDRESSEE (the human-readable
     * delivery point text — used by Marketing Review's Delivery Point
     * column, see AllocationController@board).
     *
     * @return array{uniqueId: ?string, addressee: ?string}
     */
    public function deliveryPoint(Customer $customer): array
    {
        $numberId = trim((string) ($customer->OracleId ?? ''));
        if ($numberId === '') {
            return ['uniqueId' => null, 'addressee' => null];
        }

        if (array_key_exists($numberId, $this->deliveryPointCache)) {
            return $this->deliveryPointCache[$numberId];
        }

        $result = ['uniqueId' => null, 'addressee' => null];
        try {
            $row = DB::connection('oracle')
                ->table('ORDERPARTNER')
                ->where('ORDERBUSINESSPARTNERNUMBERID', $numberId)
                ->where('CUSTOMERSUPPLIERTYPE', '1')
                ->select('DELIVERYPOINTUNIQUEID')
                ->first();

            if ($row) {
                // Oracle returns column names in an implementation-defined case;
                // normalise to UPPER so we always use a predictable key.
                $arr = array_change_key_case((array) $row, CASE_UPPER);

                // The column we selected is DELIVERYPOINTUNIQUEID — that is the
                // uniqueId we must write into SALESORDERIBEAN.DELIVERYPOINTUNIQUEID.
                $uniqueId = isset($arr['DELIVERYPOINTUNIQUEID']) && $arr['DELIVERYPOINTUNIQUEID'] !== null
                    ? trim((string) $arr['DELIVERYPOINTUNIQUEID'])
                    : null;
                $uniqueId = ($uniqueId !== '' && $uniqueId !== '0') ? $uniqueId : null;

                $addressee = null;
                if ($uniqueId !== null) {
                    // Second query: fetch the human-readable delivery address text
                    // from ADDRESS using the UNIQUEID we just resolved.
                    try {
                        $addrRow = DB::connection('oracle')
                            ->table('ADDRESS')
                            ->where('UNIQUEID', $uniqueId)
                            ->select('ADDRESSEE')
                            ->first();

                        if ($addrRow) {
                            $addrArr   = array_change_key_case((array) $addrRow, CASE_UPPER);
                            $addressee = isset($addrArr['ADDRESSEE']) && $addrArr['ADDRESSEE'] !== null
                                ? trim((string) $addrArr['ADDRESSEE'])
                                : null;
                            $addressee = $addressee !== '' ? $addressee : null;
                        }
                    } catch (Throwable $e) {
                        Log::warning('SaleOrderService: ADDRESS.ADDRESSEE lookup failed for DELIVERYPOINTUNIQUEID ' . $uniqueId, [
                            'error' => $e->getMessage(),
                        ]);
                    }
                }

                $result = ['uniqueId' => $uniqueId, 'addressee' => $addressee];
            }
        } catch (Throwable $e) {
            Log::warning('SaleOrderService: ORDERPARTNER DELIVERYPOINTUNIQUEID lookup failed for OracleId ' . $numberId, [
                'error' => $e->getMessage(),
            ]);
        }

        if ($result['uniqueId'] === null) {
            Log::warning('SaleOrderService: no ORDERPARTNER.DELIVERYPOINTUNIQUEID found for Customers.OracleId ' . $numberId . ' — DELIVERYPOINTUNIQUEID left null.');
        }

        return $this->deliveryPointCache[$numberId] = $result;
    }

    private function userName($caller): ?string
    {
        $name = $caller->name ?? null;
        return $name ? mb_substr((string) $name, 0, 50) : null;
    }

    private function str($value, int $max): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }
        return mb_substr((string) $value, 0, $max);
    }

    private function erpUom(?string $crmUom): string
    {
        $key = strtolower(trim((string) $crmUom));
        return config('sale_order.uom_map.' . $key) ?: config('sale_order.default_uom', 'm');
    }

    /** highest existing value + 1  (or start+1 when the table is empty). */
    private function nextValue(string $modelClass, string $column, string $startKey): int
    {
        $max = (int) $modelClass::max($column);
        return max($max, (int) config('sale_order.' . $startKey, 0)) + 1;
    }

    /** RELATEDDEPENDENTID is one shared number series across header AND line rows. */
    private function nextDependentId(): int
    {
        $max = max(
            (int) SaleOrderHeader::max('RELATEDDEPENDENTID'),
            (int) SaleOrderLine::max('RELATEDDEPENDENTID'),
            (int) config('sale_order.dependent_id_start', 0)
        );
        return $max + 1;
    }

    /** DO + yy + 6 digits, e.g. DO26001314 */
    private function nextCode(): string
    {
        $prefix = config('sale_order.code_prefix', 'DO') . now()->format('y');
        $last = SaleOrderHeader::where('CODE', 'like', $prefix . '%')->max('CODE');
        $next = $last ? ((int) substr((string) $last, strlen($prefix))) + 1 : (int) config('sale_order.code_start', 1);
        return $prefix . str_pad((string) $next, 6, '0', STR_PAD_LEFT);
    }

    /**
     * SUBCODE02..07 + ITEMTYPECODE of an Oracle product, read from
     * FULLITEMKEYDECODER (same table OrderController already uses to verify
     * the product). Any failure just returns [] — the line is still staged,
     * with those sub-codes NULL.
     */
    private function itemSpec(Product $product): array
    {
        if (
            !config('sale_order.oracle_lookup', true)
            || !str_starts_with((string) $product->Code, 'ORA-')
            || !$product->SortNo
        ) {
            return [];
        }

        $key = $product->SortNo . '|' . $product->ShadeNo;
        if (array_key_exists($key, $this->specCache)) {
            return $this->specCache[$key];
        }

        try {
            $q = DB::connection('oracle')->table('FULLITEMKEYDECODER')
                ->select('ITEMTYPECODE', 'SUBCODE02', 'SUBCODE03', 'SUBCODE04', 'SUBCODE05', 'SUBCODE06', 'SUBCODE07')
                ->where('SUBCODE01', $product->SortNo);
            if ($product->ShadeNo !== null && $product->ShadeNo !== '') {
                $q->where('SUBCODE08', $product->ShadeNo);
            }
            $row = $q->first();
            $spec = $row ? array_change_key_case((array) $row, CASE_UPPER) : [];
        } catch (Throwable $e) {
            Log::warning('SaleOrderService: Oracle item-spec lookup failed — sub-codes left NULL. ' . $e->getMessage());
            $spec = [];
        }

        return $this->specCache[$key] = $spec;
    }

    /** Retry on a duplicate-key race (two orders grabbing the same next number). */
    private function withRetry(callable $fn, int $maxAttempts = 5)
    {
        for ($attempt = 1; ; $attempt++) {
            try {
                return $fn();
            } catch (QueryException $e) {
                $isDuplicate = (string) $e->getCode() === '23000'
                    || str_contains($e->getMessage(), 'duplicate key');
                if (!$isDuplicate || $attempt >= $maxAttempts) {
                    throw $e;
                }
                usleep(random_int(15000, 60000));
            }
        }
    }
}
