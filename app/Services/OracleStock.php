<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Live "available stock" from Oracle.
 *   PRODUCT (FIRSTUSERGRPCODE) → eligibility check only (EXISTS, never joined)
 *   BALANCE (DECOSUBCODE01 sort, DECOSUBCODE08 shade, BASEPRIMARYQUANTITYUNIT stock)
 * Fail-safe: on any Oracle error it logs and returns nothing, and callers
 * fall back to the local Products.Quantity.
 */
class OracleStock
{
    // ── Everything you might need to adjust lives here ──
    private const BALANCE_QTY_COL       = 'BASEPRIMARYQUANTITYUNIT';
    private const BALANCE_ITEMTYPE_COL  = 'ITEMTYPECODE';   // set to null if BALANCE has no item-type column
    private const BALANCE_WAREHOUSE_COL = null;             // e.g. 'WAREHOUSECODE'
    private const BALANCE_WAREHOUSES    = [];               // e.g. ['W01', 'W02']  (empty = all warehouses)

    // Keep in sync with ProductController / OrderController.
    private const TYPE_CODES = ['BLW', 'DHT', 'SHT', 'SUT'];

    /**
     * @param  iterable $products  local Product models (need Id, SortNo, ShadeNo, SubType)
     * @return array<int,int>      productId => available stock. Products Oracle
     *                             doesn't know are absent (use local Quantity).
     */
    public function forProducts(iterable $products, int $cacheSeconds = 0): array
    {
        $wanted = [];   // productId => "SORT|SHADE" (normalised)
        $sorts  = [];   // raw sort numbers for the IN (...) list
        $types  = [];

        foreach ($products as $p) {
            $sort = (string) ($p->SortNo ?? '');
            if (trim($sort) === '') {
                continue;
            }
            $wanted[$p->Id] = self::norm($sort) . '|' . self::norm($p->ShadeNo ?? '');
            $sorts[$sort] = true;
            foreach ($this->typeCodesFor((string) ($p->SubType ?? '')) as $c) {
                $types[$c] = true;
            }
        }

        if (!$wanted) {
            return [];
        }

        $sortList = array_map('strval', array_keys($sorts));
        $typeList = array_keys($types);

        try {
            $compute = fn () => $this->queryStock($sortList, $typeList);
            $stockByKey = $cacheSeconds > 0
                ? Cache::remember('oracle_stock_' . md5(json_encode([$sortList, $typeList])), $cacheSeconds, $compute)
                : $compute();
        } catch (\Throwable $e) {
            Log::warning('Oracle stock lookup failed — falling back to local Quantity', ['error' => $e->getMessage()]);
            return [];
        }

        // Build a sort-level total map as a fallback: "SORT|" (empty shade) => sum
        // of all shades for that sort number. Used when the product's specific
        // shade code doesn't exist in Oracle (e.g. product has ShadeNo="BLACK20"
        // but Oracle BALANCE only has "MIXED"/"NA" for that sort). In that case
        // we return the whole sort's stock rather than silently returning 0.
        $sortTotals = [];
        foreach ($stockByKey as $key => $qty) {
            $parts = explode('|', $key, 2);
            $sortKey = $parts[0] . '|'; // e.g. "1155|"
            $sortTotals[$sortKey] = ($sortTotals[$sortKey] ?? 0) + $qty;
        }

        $out = [];
        foreach ($wanted as $productId => $key) {
            if (array_key_exists($key, $stockByKey)) {
                // Exact SORT|SHADE match.
                $out[$productId] = max(0, (int) floor($stockByKey[$key]));
            } else {
                // Shade not found in Oracle — fall back to the sort-level total
                // (sum across all shades). If that's also missing the product
                // simply won't appear in $out and the caller falls back to
                // local Products.Quantity.
                $parts   = explode('|', $key, 2);
                $sortKey = $parts[0] . '|';
                if (array_key_exists($sortKey, $sortTotals)) {
                    $out[$productId] = max(0, (int) floor($sortTotals[$sortKey]));
                    Log::info('OracleStock: shade not found, using sort-level fallback', [
                        'productId' => $productId,
                        'wanted'    => $key,
                        'fallback'  => $sortKey,
                        'qty'       => $out[$productId],
                    ]);
                }
            }
        }
        return $out;
    }

        /**
     * Public entry point for callers that already have a raw list of sort
     * numbers (e.g. a paginated catalog listing) rather than Product
     * models — same fail-safe behaviour as forProducts(): returns [] on
     * any Oracle error instead of throwing.
     *
     * @return array<string,float>  "SORT|SHADE" (normalised) => qty
     */
    public function stockMapForSorts(array $sortList, array $typeCodes): array
    {
        $sortList = array_values(array_unique(array_map('strval', $sortList)));
        if (!$sortList || !$typeCodes) {
            return [];
        }
        try {
            return $this->queryStock($sortList, $typeCodes);
        } catch (\Throwable $e) {
            Log::warning('Oracle stock lookup failed (stockMapForSorts)', ['error' => $e->getMessage()]);
            return [];
        }
    }

        /**
     * Grand total stock for an entire garment type — every sort/shade,
     * not just ones that appear as order lines. Used by the Marketing
     * Review "Available Stock" summary card and the Available Stock page.
     * Cached 5 min: this scans all of BALANCE for the type, no sort
     * filter, so it's heavier than the per-product lookups above.
     */
    // public function totalStockByType(string $typeCode): float
    // {
    //     try {
    //         return Cache::remember(
    //             'oracle_stock_total_type_' . $typeCode,
    //             300,
    //             function () use ($typeCode) {
    //                 $pf = [];
    //                 for ($i = 1; $i <= 10; $i++) {
    //                     $n = str_pad((string) $i, 2, '0', STR_PAD_LEFT);
    //                     $pf[] = "(TRIM(p.SUBCODE{$n}) IS NULL OR p.SUBCODE{$n} = b.DECOSUBCODE{$n})";
    //                 }
    //                 $itemTypeCol = self::BALANCE_ITEMTYPE_COL ?: 'ITEMTYPECODE';
    //                 $qty = 'b.' . self::BALANCE_QTY_COL;

    //                 $sql = "SELECT SUM(NVL({$qty}, 0)) AS total
    //                         FROM BALANCE b
    //                         WHERE EXISTS (
    //                               SELECT 1 FROM PRODUCT p
    //                               WHERE p.{$itemTypeCol} = b.{$itemTypeCol}
    //                                 AND p.FIRSTUSERGRPCODE = ?
    //                                 AND " . implode(' AND ', $pf) . "
    //                         )";
    //                 $row = DB::connection('oracle')->select($sql, [$typeCode]);
    //                 return (float) ($row[0]->TOTAL ?? $row[0]->total ?? 0);
    //             }
    //         );
    //     } catch (\Throwable $e) {
    //         Log::warning('Oracle total-stock-by-type lookup failed', ['type' => $typeCode, 'error' => $e->getMessage()]);
    //         return 0;
    //     }
    // }

    
    /**
     * Grand total stock for an entire garment type.
     * Used by the Marketing Review "Available Stock" summary card.
     *
     * Optimized: one single Oracle round-trip for ALL types using a
     * hardcoded ITEMTYPECODE → FIRSTUSERGRPCODE mapping (discovered from
     * PRODUCT table — only 6 item type codes across all 4 garment groups).
     * Results cached 30 min. Falls back to 0 on any Oracle error.
     */
    public function totalStockByType(string $typeCode): float
    {
        $allTotals = $this->allTypeTotals();
        return $allTotals[$typeCode] ?? 0.0;
    }

    /**
     * Fetch totals for ALL garment types in ONE Oracle query.
     * Cached 30 min under a single key — no per-type cache fragmentation.
     *
     * ITEMTYPECODE → FIRSTUSERGRPCODE mapping (from PRODUCT table):
     *   GRY  → BLW, SHT, DHT, SUT
     *   PDF  → BLW, SHT, DHT, SUT
     *   PFF  → BLW, SHT, DHT, SUT
     *   YDF  → DHT, SUT, SHT
     *   YGR  → DHT, SUT, SHT
     *   PYD  → SHT
     *
     * @return array<string,float>  FIRSTUSERGRPCODE => total qty
     */
    public function allTypeTotals(): array
    {
        return Cache::remember('oracle_stock_all_types', 1800, function () {
            // Hardcoded ITEMTYPECODE → list of FIRSTUSERGRPCODE garment groups.
            // This is static Oracle ERP configuration — it never changes without
            // a full ERP reconfiguration. Update here if new types are added.
            $itemTypeToGroups = [
                'GRY' => ['BLW', 'SHT', 'DHT', 'SUT'],
                'PDF' => ['BLW', 'SHT', 'DHT', 'SUT'],
                'PFF' => ['BLW', 'SHT', 'DHT', 'SUT'],
                'YDF' => ['DHT', 'SUT', 'SHT'],
                'YGR' => ['DHT', 'SUT', 'SHT'],
                'PYD' => ['SHT'],
            ];

            $allItemTypes = array_keys($itemTypeToGroups);
            $ph = implode(',', array_fill(0, count($allItemTypes), '?'));

            try {
                // Single query: SUM per ITEMTYPECODE across all relevant BALANCE rows.
                $sql = "SELECT ITEMTYPECODE, SUM(NVL(BASEPRIMARYQUANTITYUNIT, 0)) AS total
                        FROM BALANCE
                        WHERE ITEMTYPECODE IN ({$ph})
                        GROUP BY ITEMTYPECODE";

                $rows = DB::connection('oracle')->select($sql, $allItemTypes);
            } catch (\Throwable $e) {
                Log::warning('Oracle all-types stock lookup failed', ['error' => $e->getMessage()]);
                return ['BLW' => 0, 'DHT' => 0, 'SHT' => 0, 'SUT' => 0];
            }

            // Build ITEMTYPECODE → qty map from results.
            $byItemType = [];
            foreach ($rows as $row) {
                $r = array_change_key_case((array) $row, CASE_LOWER);
                $byItemType[strtoupper($r['itemtypecode'] ?? '')] = (float) ($r['total'] ?? 0);
            }

            // Distribute each ITEMTYPECODE total to its garment group(s).
            // When one ITEMTYPECODE maps to multiple groups, it contributes
            // its full quantity to each group (stock is physically shared).
            $groupTotals = ['BLW' => 0.0, 'DHT' => 0.0, 'SHT' => 0.0, 'SUT' => 0.0];
            foreach ($itemTypeToGroups as $itemType => $groups) {
                $qty = $byItemType[$itemType] ?? 0.0;
                foreach ($groups as $group) {
                    $groupTotals[$group] += $qty;
                }
            }

            return $groupTotals;
        });
    }
    /** One batched Oracle query → ["SORT|SHADE" => qty]. */
    private function queryStock(array $sortList, array $typeList): array
    {
        // Eligibility is checked with EXISTS (true/false), never joined —
        // BALANCE and PRODUCT can each have several rows per sort/shade,
        // and joining them directly would multiply the SUM instead of
        // adding it. EXISTS only tests true/false so it can't do that.
        $pf = [];
        for ($i = 1; $i <= 10; $i++) {
            $n = str_pad((string) $i, 2, '0', STR_PAD_LEFT);
            $pf[] = "(TRIM(p.SUBCODE{$n}) IS NULL OR p.SUBCODE{$n} = b.DECOSUBCODE{$n})";
        }

        $whWhere  = '';
        $bindTail = [];
        if (self::BALANCE_WAREHOUSE_COL && self::BALANCE_WAREHOUSES) {
            $whWhere = ' AND b.' . self::BALANCE_WAREHOUSE_COL . ' IN (' . implode(',', array_fill(0, count(self::BALANCE_WAREHOUSES), '?')) . ')';
            $bindTail = array_values(self::BALANCE_WAREHOUSES);
        }

        $itemTypeCol = self::BALANCE_ITEMTYPE_COL ?: 'ITEMTYPECODE';
        $qty    = 'b.' . self::BALANCE_QTY_COL;
        $typePh = implode(',', array_fill(0, count($typeList), '?'));

        $result = [];
        foreach (array_chunk($sortList, 500) as $chunk) {
            $sortPh = implode(',', array_fill(0, count($chunk), '?'));

            $sql = "SELECT b.DECOSUBCODE01 AS sort_no, b.DECOSUBCODE08 AS shade_no, SUM(NVL({$qty}, 0)) AS qty
                    FROM BALANCE b
                    WHERE b.DECOSUBCODE01 IN ({$sortPh})
                      {$whWhere}
                      AND EXISTS (
                            SELECT 1 FROM PRODUCT p
                            WHERE p.{$itemTypeCol} = b.{$itemTypeCol}
                              AND p.FIRSTUSERGRPCODE IN ({$typePh})
                              AND " . implode(' AND ', $pf) . "
                      )
                    GROUP BY b.DECOSUBCODE01, b.DECOSUBCODE08";

            // Placeholder order: sorts, warehouses, types.
            $bindings = array_merge($chunk, $bindTail, $typeList);

            foreach (DB::connection('oracle')->select($sql, $bindings) as $row) {
                $r = array_change_key_case((array) $row, CASE_LOWER);
                $key = self::norm($r['sort_no'] ?? '') . '|' . self::norm($r['shade_no'] ?? '');
                $result[$key] = ($result[$key] ?? 0) + (float) ($r['qty'] ?? 0);
            }
        }
        return $result;
    }

    /** Local SubType label → Oracle FIRSTUSERGRPCODE(s). Unknown → all four. */
    private function typeCodesFor(string $subType): array
    {
        $s = strtolower($subType);
        if (str_contains($s, 'blouse'))                              return ['BLW'];
        if (str_contains($s, 'dhoti') || str_contains($s, 'dhothi')) return ['DHT'];
        if (str_contains($s, 'shirting'))                            return ['SHT'];
        if (str_contains($s, 'suiting'))                             return ['SUT'];
        return self::TYPE_CODES;
    }

    private static function norm($v): string
    {
        return strtoupper(trim((string) $v));
    }

    
}