<?php

namespace App\Services;

use App\Models\Product;
use App\Models\SaleOrderHeader;
use App\Models\SaleOrderLine;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Throwable;

/**
 * The actual "Transfer to ERP" write: inserts one sale_order_line (and its
 * header, the first time it's needed) into Oracle's live
 * SALESORDERIBEAN / SALESORDERLINEIBEAN tables.
 *
 * WHY NOT REUSE our own IMPORTAUTOCOUNTER / RELATEDDEPENDENTID:
 * sale_order_header/sale_order_line number themselves from our own local
 * counter (config/sale_order.php), which runs completely independently of
 * Oracle's live tables — other systems keep inserting into Oracle on
 * their own, so our numbers will eventually collide with a real Oracle
 * row. Both real tables have IMPORTAUTOCOUNTER as their ONLY primary key,
 * with no trigger/sequence to fill it for us (confirmed against Oracle
 * directly), so every insert needs a value Oracle has genuinely never
 * used. This class asks Oracle for its own live MAX(...)+1 at the moment
 * of transfer and records what was actually used — see the
 * 2026_09_26_000001 migration for where those go.
 *
 * ATOMICITY: Oracle and our SQL Server database are two separate
 * connections — there is no single transaction spanning both. So:
 *   - The header is only ever marked transferred (CrmOracleTransferredAt)
 *     AFTER its Oracle insert actually succeeds.
 *   - A line is only ever marked CrmErpStatus = 'erp_so_created' AFTER
 *     its own Oracle insert actually succeeds.
 *   - If the header insert fails, the line insert is never attempted.
 *   - If the line insert fails after the header succeeded, that's fine:
 *     the header now legitimately exists in Oracle, and re-clicking
 *     Transfer later will find it already marked transferred and just
 *     retry the line.
 * Nothing here is retried automatically on connectivity failures (e.g.
 * the ORA-12170 timeout seen in production) — those are surfaced as a
 * clear, distinct error so the button can be safely clicked again.
 */
class OracleSalesOrderTransfer
{
    private const HEADER_TABLE = 'SALESORDERIBEAN';
    private const LINE_TABLE = 'SALESORDERLINEIBEAN';
    private const MAX_ATTEMPTS = 5;

    /** @var array<int,?string> per-request cache of Oracle PRODUCT.BASEPRIMARYUNITCODE, keyed by CrmProductId */
    private array $baseUnitCodeCache = [];
    private ?string $partnerFailure = null;

    /**
     * Every DATE column on each real Oracle table (confirmed against the
     * client's SOBean.xlsx layout — same columns our own sale_order_header/
     * sale_order_line classified as datetime). Oracle's DATE type has NO
     * fractional-second component, so a value like the ones SQL Server
     * hands us — "2026-09-25 12:54:00.776" (DATETIME2(3)) — fails with
     * ORA-01830 ("date format picture ends before converting entire input
     * string") the instant it's bound as a plain string: the trailing
     * ".776" has nowhere to go. Every value in these columns is explicitly
     * wrapped in TO_DATE(..., 'YYYY-MM-DD HH24:MI:SS') below instead of
     * relying on Oracle's implicit (and session-dependent) string-to-date
     * conversion.
     */
    private const HEADER_DATE_COLUMNS = [
        'ORDERDATE',
        'INITIALDATE',
        'FINALDATE',
        'EXTERNALREFERENCEDATE',
        'INTERNALREFERENCEDATE',
        'REQUIREDDUEDATE',
        'CONFIRMEDDUEDATE',
        'CONDITIONRETRIEVINGDATE',
        'ALAPPLICATIONDATE',
        'ADVANCELICENSEDATE',
        'IMPCREATIONDATETIME',
        'IMPLASTUPDATEDATETIME',
        'IMPORTDATETIME',
    ];
    private const LINE_DATE_COLUMNS = [
        'EXTERNALREFERENCEDATE',
        'INTERNALREFERENCEDATE',
        'CONFIRMEDDELIVERYDATE',
        'REQUIREDDUEDATE',
        'CONDITIONRETRIEVINGDATE',
        'IPPOLICYDATE',
        'POLICYEXPIRYDATE',
        'IMPCREATIONDATETIME',
        'IMPLASTUPDATEDATETIME',
        'IMPORTDATETIME',
    ];

    /**
     * Transfers one allocated line to Oracle, inserting its header first
     * if this is the first line of that header ever transferred.
     *
     * @return array{success:bool, message:string, alreadyTransferred?:bool}
     */
    public function transferLine(SaleOrderLine $line, ?User $actingUser = null): array
    {
        if ($line->CrmErpStatus === 'erp_so_created') {
            return ['success' => true, 'message' => 'Already transferred.', 'alreadyTransferred' => true];
        }

        $header = SaleOrderHeader::where('RELATEDDEPENDENTID', $line->FATHERID)->first();
        if (!$header) {
            return ['success' => false, 'message' => 'This line has no header row to transfer with it.'];
        }

        if (!$header->CrmOracleTransferredAt) {
            $result = $this->transferHeader($header, $line, $actingUser);
            if (!$result['success']) {
                return $result; // never attempt the line without its header
            }
            $header->refresh();
        }

        return $this->transferLineRow($header, $line, $actingUser);
    }

    private function transferHeader(SaleOrderHeader $header, SaleOrderLine $line, ?User $actingUser = null): array
    {
        $columns = app(SaleOrderService::class)->exportColumns(SaleOrderHeader::class);
        $row = $this->castDates($header->only($columns), self::HEADER_DATE_COLUMNS);

        // Price (TLODOM/DOMESTIC), picked on Marketing Review, goes to the
        // real Oracle header's MARKETCODE.
        if (!empty($header->CrmPriceListCode)) {
            $row['MARKETCODE'] = $header->CrmPriceListCode;
        }
        // ── Fill NOT NULL delivery point fields from Oracle ORDERPARTNER ──
        $partner = $this->resolveOrderPartner($line);
        if ($partner === null) {
            return [
                'success' => false,
                'message' => 'Delivery point lookup failed: ' . ($this->partnerFailure ?? 'unknown reason'),
            ];
        }
        $blank = fn($v) => $v === null || trim((string) $v) === '';

        if ($blank($row['DELIVERYPOINTUNIQUEID'] ?? null)) {
            $row['DELIVERYPOINTUNIQUEID'] = $partner['uniqueId'];
        }
        if ($blank($row['DELIVERYPOINTCODE'] ?? null) && $partner['code'] !== null) {
            $row['DELIVERYPOINTCODE'] = $partner['code'];
        }
        if ($blank($row['ORDPRNCUSTOMERSUPPLIERCODE'] ?? null)) {
            $row['ORDPRNCUSTOMERSUPPLIERCODE'] = $partner['customerCode'];
        }
        if ($blank($row['FNCORDPRNCUSTOMERSUPPLIERCODE'] ?? null)) {
            $row['FNCORDPRNCUSTOMERSUPPLIERCODE'] = $partner['customerCode'];
        }

        // IMPCREATIONUSER on the Oracle row must read as whichever System
        // Admin actually clicked "Transfer to ERP" — not the End
        // User/Customer who originally placed the order (that name was
        // only ever right for the local staging row at order-placement
        // time). Falls back to whatever was already staged if no acting
        // user was passed in (e.g. a background/console transfer).
        $creationUser = $actingUser && $actingUser->name ? mb_substr($actingUser->name, 0, 50) : null;
        if ($creationUser !== null) {
            $row['IMPCREATIONUSER'] = $creationUser;
        }

        try {
            [$counter, $dependentId] = $this->insertWithRetry(self::HEADER_TABLE, function (int $counter, int $dependentId) use ($row) {
                return array_merge($row, [
                    'IMPORTAUTOCOUNTER' => $counter,
                    'RELATEDDEPENDENTID' => $dependentId,
                ]);
            });
        } catch (Throwable $e) {
            return $this->failure($e, 'header');
        }

        $headerUpdate = [
            'CrmOracleTransferredAt' => now(),
            'CrmOracleImportCounter' => $counter,
            'CrmOracleRelatedDependentId' => $dependentId,
        ];
        // Mirror the same name onto our OWN local sale_order_header row,
        // so it matches what Oracle now has — not just the Oracle insert.
        if ($creationUser !== null) {
            $headerUpdate['IMPCREATIONUSER'] = $creationUser;
        }
        $header->forceFill($headerUpdate)->save();

        return ['success' => true, 'message' => 'Header sent to ERP.'];
    }
    private function resolveOrderPartner(SaleOrderLine $line): ?array
    {
        $customerId = $line->CrmCustomerId;
        if (!$customerId && $line->CrmOrderId) {
            $customerId = \App\Models\Order::where('Id', $line->CrmOrderId)->value('CustomerId');
        }
        $customer = $customerId ? \App\Models\Customer::find($customerId) : null;
        if (!$customer) {
            $this->partnerFailure = 'Customer not found for this line.';
            return null;
        }

        $conn = DB::connection('oracle');

        try {
            // Real column names of ORDERPARTNER (don't assume them)
            $cols = collect($conn->select("SELECT COLUMN_NAME AS cname FROM ALL_TAB_COLUMNS WHERE TABLE_NAME = 'ORDERPARTNER'"))
                ->map(function ($r) {
                    $a = array_change_key_case((array) $r, CASE_UPPER);
                    return strtoupper(trim((string) ($a['CNAME'] ?? '')));
                })
                ->filter()->unique()->values()->all();

            $keyCols = array_values(array_filter($cols, fn($c) => preg_match('/(NUMBERID|SUPPLIERCODE|PARTNERCODE)$/', $c)));
            if (!in_array('DELIVERYPOINTUNIQUEID', $cols, true) || empty($keyCols)) {
                $this->partnerFailure = 'Unexpected ORDERPARTNER layout. Columns: ' . implode(',', $cols);
                Log::warning('OracleSalesOrderTransfer: unexpected ORDERPARTNER layout', ['cols' => $cols]);
                return null;
            }

            // ── Candidate identifiers for this customer ──
            
            $cands = [];
            foreach ([$customer->OracleId, $customer->Code] as $v) {
                $v = trim((string) $v);
                if ($v !== '') {
                    $cands[] = $v;
                }
            }

                        // Business partner master: match by short name or legal name -> NUMBERID
            try {
                $nm = mb_strtoupper(trim((string) $customer->Name));
                if ($nm !== '') {
                    $bps = $conn->table('BUSINESSPARTNER')
                        ->where(function ($q) use ($nm) {
                            $q->whereRaw('UPPER(TRIM(SHORTNAME)) = ?', [$nm])
                              ->orWhereRaw('UPPER(TRIM(LEGALNAME1)) = ?', [$nm]);
                        })
                        ->get();
                    foreach ($bps as $r) {
                        $a = array_change_key_case((array) $r, CASE_UPPER);
                        $v = trim((string) ($a['NUMBERID'] ?? ''));
                        if ($v !== '') {
                            $cands[] = $v;
                        }
                    }
                }
            } catch (\Throwable $e) {
                Log::info('OracleSalesOrderTransfer: BUSINESSPARTNER name lookup skipped', ['error' => $e->getMessage()]);
            }

            // Identifiers from Oracle ADDRESS rows whose name matches the customer's name
            $norm = fn($s) => preg_replace('/[^A-Z0-9]/', '', mb_strtoupper((string) $s));
            $want = $norm($customer->Name);
            $first = mb_strtoupper(preg_split('/\s+/', trim((string) $customer->Name))[0] ?? '');
            if ($want !== '' && $first !== '') {
                $addr = $conn->table('ADDRESS')
                    ->whereRaw('UPPER(ADDRESSEE) LIKE ?', ['%' . $first . '%'])
                    ->get();
                foreach ($addr as $r) {
                    $a = array_change_key_case((array) $r, CASE_UPPER);
                    if ($norm($a['ADDRESSEE'] ?? '') !== $want) {
                        continue; // exact name (ignoring case/punctuation) only
                    }
                    foreach ($a as $k => $v) {
                        if ($v !== null && is_scalar($v) && preg_match('/(CODE|ID|NUMBER)/', $k)) {
                            $v = trim((string) $v);
                            if ($v !== '' && strlen($v) <= 30) {
                                $cands[] = $v;
                            }
                        }
                    }
                }
            }
            $cands = array_values(array_unique($cands));

            // ── Try every candidate against every key column ──
            foreach ($cands as $cand) {
                foreach ($keyCols as $col) {
                    $rows = $conn->table('ORDERPARTNER')
                        ->whereRaw("TRIM(TO_CHAR({$col})) = ?", [$cand])
                        ->whereNotNull('DELIVERYPOINTUNIQUEID')
                        ->get();

                    foreach ($rows as $r) {
                        $a = array_change_key_case((array) $r, CASE_UPPER);
                        if (isset($a['CUSTOMERSUPPLIERTYPE']) && trim((string) $a['CUSTOMERSUPPLIERTYPE']) !== '1') {
                            continue; // customers only
                        }

                        $partnerNo = trim((string) ($a['ORDERBUSINESSPARTNERNUMBERID'] ?? $cand));
                        $custCode = trim((string) ($a['CUSTOMERSUPPLIERCODE'] ?? '')) ?: $cand;
                        $dpCode = trim((string) ($a['DELIVERYPOINTCODE'] ?? ''));

                        // Remember the link so board() and later transfers use it too
                        if (trim((string) $customer->OracleId) === '') {
                            \App\Models\Customer::where('Id', $customer->Id)->update(['OracleId' => $partnerNo]);
                        }
                        Log::info('OracleSalesOrderTransfer: matched ORDERPARTNER', [
                            'customerId' => $customer->Id,
                            'via' => "{$col}={$cand}",
                            'partnerNo' => $partnerNo,
                        ]);

                        return [
                            'uniqueId' => trim((string) $a['DELIVERYPOINTUNIQUEID']),
                            'code' => $dpCode !== '' ? $dpCode : null,
                            'customerCode' => $custCode,
                        ];
                    }
                }
            }

            $this->partnerFailure = 'No ORDERPARTNER match. Tried: [' . implode(', ', $cands) . '] on columns: ' . implode(',', $keyCols);
            Log::warning('OracleSalesOrderTransfer: no ORDERPARTNER match', [
                'customerId' => $customer->Id,
                'name' => $customer->Name,
                'tried' => $cands,
                'keyCols' => $keyCols,
            ]);
            return null;
        } catch (Throwable $e) {
            $this->partnerFailure = 'Oracle lookup error: ' . $e->getMessage();
            Log::warning('OracleSalesOrderTransfer: ORDERPARTNER lookup failed', ['error' => $e->getMessage()]);
            return null;
        }
    }


    private function transferLineRow(SaleOrderHeader $header, SaleOrderLine $line, ?User $actingUser = null): array
    {
        $columns = app(SaleOrderService::class)->exportColumns(SaleOrderLine::class);
        $row = $this->castDates($line->only($columns), self::LINE_DATE_COLUMNS);

        // UOM sent to Oracle comes from the product's own Oracle
        // PRODUCT.BASEPRIMARYUNITCODE (matched by Sort No), not whatever
        // UOM the customer originally chose when placing the order.
        // Quantity sent is the REAL allocated total — Allocated Cases x
        // Allocated Mtr (e.g. 3 cases at 100 Mtr each = 300) — not just
        // the case count. Our own sale_order_line.USERPRIMARYQUANTITY /
        // BASEPRIMARYQUANTITY stay as raw cases locally (Marketing
        // Review's Allocated Cases box, its caps, and the Available Stock
        // math all depend on that); only the copy actually sent to
        // Oracle here is overridden.
        $row = array_merge($row, $this->lineErpOverrides($line));

        [$totalQty, $deltaQty] = $this->erpQuantities($line);
        if ($deltaQty <= 0) {
            // Nothing new to send (e.g. qty was reduced) — just close the cycle.
            $line->forceFill([
                'CrmErpStatus' => 'erp_so_created',
                'CrmErpTransferredAt' => now(),
                'CrmErpSentQty' => $totalQty,
                'CrmErpSentCases' => (int) $line->USERPRIMARYQUANTITY,
            ])->save();
            return ['success' => true, 'message' => 'Nothing new to send to ERP.'];
        }

        // Same IMPCREATIONUSER override as transferHeader() — the System
        // Admin who clicked Transfer to ERP, not whoever placed the order.
        $creationUser = $actingUser && $actingUser->name ? mb_substr($actingUser->name, 0, 50) : null;
        if ($creationUser !== null) {
            $row['IMPCREATIONUSER'] = $creationUser;
        }

        try {
            [$counter, $dependentId] = $this->insertWithRetry(self::LINE_TABLE, function (int $counter, int $dependentId) use ($row, $header) {
                return array_merge($row, [
                    'FATHERID' => $header->CrmOracleRelatedDependentId, // links to the header AS INSERTED in Oracle
                    'IMPORTAUTOCOUNTER' => $counter,
                    'RELATEDDEPENDENTID' => $dependentId,
                ]);
            });
        } catch (Throwable $e) {
            return $this->failure($e, 'line');
        }

        $lineUpdate = [
            'CrmErpStatus' => 'erp_so_created',
            'CrmErpTransferredAt' => now(),
            'CrmOracleImportCounter' => $counter,
            'CrmOracleRelatedDependentId' => $dependentId,
            'CrmErpSentQty' => $totalQty,
            'CrmErpSentCases' => (int) $line->USERPRIMARYQUANTITY,
        ];
        if ($creationUser !== null) {
            $lineUpdate['IMPCREATIONUSER'] = $creationUser;
        }
        $line->forceFill($lineUpdate)->save();

        return ['success' => true, 'message' => 'Transferred to ERP.'];
    }

    /**
     * @return array{USERPRIMARYUOMCODE:?string, BASEPRIMARYUOMCODE:?string,
     *               USERPRIMARYQUANTITY:float, BASEPRIMARYQUANTITY:float}
     */
    private function lineErpOverrides(SaleOrderLine $line): array
    {
        [, $quantity] = $this->erpQuantities($line); // only what has NOT gone to Oracle yet

        $uom = $this->baseUnitCodeForProduct((int) $line->CrmProductId) ?? $line->USERPRIMARYUOMCODE;

        return [
            'USERPRIMARYUOMCODE' => $uom,
            'BASEPRIMARYUOMCODE' => $uom,
            'USERPRIMARYQUANTITY' => $quantity,
            'BASEPRIMARYQUANTITY' => $quantity,
            'PRICELISTCODE' => $line->CrmPriceListCode ?: null,
        ];
    }

    /**
     * Parses a Meter figure like "100M" / "100" into a numeric multiplier.
     * Blank/invalid defaults to 1 — same rule Marketing Review's own
     * numOr1() uses, so a row with no Meter entered transfers as plain
     * case count, not zero.
     */
    private function meterMultiplier(?string $meters): float
    {
        $num = (float) preg_replace('/[^\d.]/', '', (string) $meters);
        return $num > 0 ? $num : 1.0;
    }

    /**
     * Oracle PRODUCT.BASEPRIMARYUNITCODE for this product, matched by
     * Sort No (PRODUCT.SUBCODE01) — see the screenshot query this mirrors:
     * SELECT BASEPRIMARYUNITCODE FROM PRODUCT WHERE SUBCODE01 = '<sortNo>'.
     * Returns null (falls back to the line's own stored UOM) if the
     * product has no Sort No on file or Oracle is unreachable.
     */
    private function baseUnitCodeForProduct(int $productId): ?string
    {
        if (array_key_exists($productId, $this->baseUnitCodeCache)) {
            return $this->baseUnitCodeCache[$productId];
        }

        $product = Product::find($productId);
        $sortNo = $product ? trim((string) $product->SortNo) : '';
        if ($sortNo === '') {
            return $this->baseUnitCodeCache[$productId] = null;
        }

        $code = null;
        try {
            $value = DB::connection('oracle')
                ->table('PRODUCT')
                ->where('SUBCODE01', $sortNo)
                ->value('BASEPRIMARYUNITCODE');
            $code = $value !== null ? trim((string) $value) : null;
            $code = $code !== '' ? $code : null;
        } catch (Throwable $e) {
            Log::warning('OracleSalesOrderTransfer: PRODUCT.BASEPRIMARYUNITCODE lookup failed for SortNo ' . $sortNo, [
                'error' => $e->getMessage(),
            ]);
        }

        return $this->baseUnitCodeCache[$productId] = $code;
    }

    /**
     * Replaces every date/datetime column's value with an explicit
     * TO_DATE(...) expression, stripped of any fractional-second suffix
     * SQL Server's DATETIME2(3) columns produce (e.g. "12:54:00.776" ->
     * "12:54:00"). NULL/empty values are left as NULL — Oracle needs no
     * help with those. See the class doc-comment above for why this is
     * necessary rather than passing the string straight through.
     */
    private function castDates(array $row, array $dateColumns): array
    {
        foreach ($dateColumns as $col) {
            if (!array_key_exists($col, $row) || $row[$col] === null || $row[$col] === '') {
                continue;
            }

            $value = $row[$col];
            $string = $value instanceof \DateTimeInterface
                ? $value->format('Y-m-d H:i:s')
                : (string) $value;

            // Keep only "YYYY-MM-DD HH:MM:SS" — drop any ".fff" fractional
            // part and anything else unexpected trailing it.
            if (!preg_match('/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/', $string, $m)) {
                Log::warning("OracleSalesOrderTransfer: unrecognised date value in {$col}, sending NULL instead.", ['value' => $string]);
                $row[$col] = null;
                continue;
            }

            $row[$col] = DB::raw("TO_DATE('{$m[1]}', 'YYYY-MM-DD HH24:MI:SS')");
        }

        return $row;
    }

    /**
     * Inserts into $table using a fresh IMPORTAUTOCOUNTER / shared
     * RELATEDDEPENDENTID computed straight off Oracle's own current data.
     * Retries with new numbers only on an actual duplicate-key collision
     * (a genuine race with another transfer/import happening at the same
     * instant) — never on a connectivity failure, which is surfaced
     * immediately instead.
     *
     * @return array{0:int,1:int} [counter used, dependentId used]
     */
    private function insertWithRetry(string $table, callable $buildRow): array
    {
        for ($attempt = 1; $attempt <= self::MAX_ATTEMPTS; $attempt++) {
            $counter = $this->nextCounter($table);
            $dependentId = $this->nextRelatedDependentId();

            try {
                DB::connection('oracle')->table($table)->insert($buildRow($counter, $dependentId));
                return [$counter, $dependentId];
            } catch (Throwable $e) {
                if ($this->isDuplicateKey($e) && $attempt < self::MAX_ATTEMPTS) {
                    Log::warning("OracleSalesOrderTransfer: duplicate key on {$table}, retrying with a new number.", [
                        'attempt' => $attempt,
                        'counter' => $counter,
                    ]);
                    continue;
                }
                throw $e;
            }
        }

        throw new \RuntimeException("Could not find a free IMPORTAUTOCOUNTER for {$table} after " . self::MAX_ATTEMPTS . ' attempts.');
    }

    private function nextCounter(string $table): int
    {
        $max = (int) DB::connection('oracle')->table($table)->max('IMPORTAUTOCOUNTER');
        return $max + 1;
    }

    /**
     * RELATEDDEPENDENTID is one shared number series across BOTH real
     * Oracle tables (same pattern as our own local staging tables) — so
     * it must never collide with either table's current live values.
     */
    private function nextRelatedDependentId(): int
    {
        $maxHeader = (int) DB::connection('oracle')->table(self::HEADER_TABLE)->max('RELATEDDEPENDENTID');
        $maxLine = (int) DB::connection('oracle')->table(self::LINE_TABLE)->max('RELATEDDEPENDENTID');
        return max($maxHeader, $maxLine) + 1;
    }

    private function isDuplicateKey(Throwable $e): bool
    {
        return str_contains($e->getMessage(), 'ORA-00001'); // unique constraint violated
    }

    private function failure(Throwable $e, string $what): array
    {
        $msg = $e->getMessage();
        Log::error("OracleSalesOrderTransfer: {$what} insert failed. " . $msg);

        if (str_contains($msg, 'ORA-12170') || str_contains($msg, 'oci_connect')) {
            return ['success' => false, 'message' => "Couldn't reach the Oracle ERP system — please try again in a moment."];
        }
        if (str_contains($msg, 'ORA-01031')) {
            return ['success' => false, 'message' => 'Oracle rejected the write — the ERP account needs INSERT permission.'];
        }

        return ['success' => false, 'message' => "Oracle rejected the {$what}: " . $msg];
    }

    /** @return array{0:float,1:float} [total Oracle qty allocated, qty still to send] */
    private function erpQuantities(SaleOrderLine $line): array
    {
        $total = (float) $line->CrmTotalMtrQty;
        if ($total <= 0) { // legacy row, before the new column existed
            $total = (float) $line->USERPRIMARYQUANTITY * $this->meterMultiplier($line->CrmMeters);
        }
        $sent = (float) $line->CrmErpSentQty;
        return [$total, max(0.0, $total - $sent)];
    }
}
