<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Product;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Cache;
use App\Services\OracleStock;


class ProductController extends Controller
{
    // Blouse Product Selection (Customer + End User) is restricted to
    // exactly these Sort Numbers — every other garment type is unaffected.
    private const BLOUSE_SORT_WHITELIST = ['1520', '1978', '1980', '1535'];
    /** GET /api/products */
    // public function index(Request $request)
    // {
    //     $query = Product::query();

    //     if ($category = $request->query('category')) {
    //         $query->where('Category', $category);
    //     }
    //     if ($subType = $request->query('sub_type')) {
    //         $query->where('SubType', $subType);
    //     }
    //     if ($status = $request->query('status')) {
    //         $query->where('Status', $status);
    //     }
    //     if ($search = $request->query('search')) {
    //         $query->where(function ($q) use ($search) {
    //             $q->where('Name', 'like', "%{$search}%")
    //               ->orWhere('Code', 'like', "%{$search}%");
    //         });
    //     }

    //     return response()->json($query->orderByDesc('Id')->get());
    // }

    /** GET /api/products/{id} */

    /** GET /api/products */
    public function index(Request $request)
    {
        // if ($request->query('source') === 'oracle') {
        //     // FIRSTUSERGRPCODE -> the four garment tabs the app shows.
        //     // BLW=Blouse, DHT=Dhoti, SHT=Uniform Shirting, SUT=Uniform Suiting
        //     // (confirmed against real product descriptions in Oracle).
        //     $typeMap = [
        //         'BLW' => 'Blouse',
        //         'DHT' => 'Dhoti',
        //         'SHT' => 'Uniform Shirting',
        //         'SUT' => 'Uniform Suiting',
        //     ];

        //     $rows = DB::connection('oracle')
        //         ->table('PRODUCT as p')
        //         ->join('FULLITEMKEYDECODER as f', function ($join) {
        //             $join->on('f.ITEMTYPECODE', '=', 'p.ITEMTYPECODE')
        //                  ->on('f.SUBCODE01', '=', 'p.SUBCODE01');
        //         })
        //         ->whereIn('p.FIRSTUSERGRPCODE', array_keys($typeMap))
        //         ->select(
        //             'p.ABSUNIQUEID as id',
        //             'p.FIRSTUSERGRPCODE as type_code',
        //             'f.SUBCODE01 as sort_no',
        //             'f.SUBCODE08 as shade_no',
        //             'f.SHORTDESCRIPTION as name'
        //         )
        //         ->distinct()
        //         ->get();

        //     $products = $rows->map(function ($r) use ($typeMap) {
        //         return [
        //             'Id'      => $r->id,
        //             'SortNo'  => $r->sort_no,
        //             'ShadeNo' => $r->shade_no,
        //             'Name'    => $r->name,
        //             'SubType' => $typeMap[$r->type_code] ?? null,
        //             'Status'  => 'active',
        //         ];
        //     })->filter(fn ($p) => $p['SubType'] !== null)->values();

        //     return response()->json($products);
        // }

        if ($request->query('source') === 'oracle') {
            $typeMap = [
                'BLW' => 'Blouse',
                'DHT' => 'Dhoti',
                'SHT' => 'Uniform Shirting',
                'SUT' => 'Uniform Suiting',
            ];

            $page = max((int) $request->query('page', 1), 1);
            $perPage = min(max((int) $request->query('per_page', 100), 1), 200);
            $type = trim((string) $request->query('type', ''));
            $search = trim((string) $request->query('search', ''));      // product name
            $sortShade = trim((string) $request->query('sort_shade', ''));  // sort no / shade

            $base = DB::connection('oracle')
                ->table('PRODUCT as p')
                ->join('FULLITEMKEYDECODER as f', function ($join) {
                    $join->on('f.ITEMTYPECODE', '=', 'p.ITEMTYPECODE')
                        ->on('f.SUBCODE01', '=', 'p.SUBCODE01');
                });

            // Only load the tab that is actually open.
            if ($type !== '') {
                $code = array_search($type, $typeMap, true);
                if ($code === false) {
                    return response()->json(['data' => [], 'total' => 0, 'page' => 1, 'per_page' => $perPage, 'last_page' => 1]);
                }
                $base->where('p.FIRSTUSERGRPCODE', $code);
                // Blouse is restricted to a fixed set of Sort Numbers on
                // Product Selection (both Customer and End User) — Dhoti /
                // Uniform Shirting / Uniform Suiting are untouched. TRIM()
                // guards against Oracle CHAR columns coming back
                // space-padded, same issue as ORDERCATEGORYCODE elsewhere.
                if ($code === 'BLW') {
                    $base->whereRaw('TRIM(f.SUBCODE01) IN (?, ?, ?, ?)', self::BLOUSE_SORT_WHITELIST);
                }
            } else {
                $base->where(function ($q) {
                    $q->where('p.FIRSTUSERGRPCODE', '!=', 'BLW')
                        ->orWhereRaw('TRIM(f.SUBCODE01) IN (?, ?, ?, ?)', self::BLOUSE_SORT_WHITELIST);
                });
                $base->whereIn('p.FIRSTUSERGRPCODE', array_keys($typeMap));
            }

            // Every word typed must match (any order, any spacing).
            if ($search !== '') {
                foreach (preg_split('/\s+/', $search, -1, PREG_SPLIT_NO_EMPTY) as $tok) {
                    $base->whereRaw('UPPER(f.SHORTDESCRIPTION) LIKE ?', ['%' . strtoupper($tok) . '%']);
                }
            }
            // Each word must match either Sort No or Shade (e.g. "1155 black").
            if ($sortShade !== '') {
                foreach (preg_split('/\s+/', $sortShade, -1, PREG_SPLIT_NO_EMPTY) as $tok) {
                    $like = '%' . strtoupper($tok) . '%';
                    $base->where(function ($q) use ($like) {
                        $q->whereRaw('UPPER(f.SUBCODE01) LIKE ?', [$like])
                            ->orWhereRaw('UPPER(f.SUBCODE08) LIKE ?', [$like]);
                    });
                }
            }

            $base->select(
                'p.ABSUNIQUEID as id',
                'p.FIRSTUSERGRPCODE as type_code',
                'f.SUBCODE01 as sort_no',
                'f.SUBCODE08 as shade_no',
                'f.SHORTDESCRIPTION as name'
            )->distinct();

            // Total count, cached 5 min per filter combo so paging clicks stay fast.
            $total = Cache::remember(
                'oracle_products_total_' . md5(json_encode([$type, $search, $sortShade])),
                300,
                fn() => DB::connection('oracle')
                    ->table(DB::raw('(' . $base->toSql() . ') cnt'))
                    ->mergeBindings($base)
                    ->count()
            );

            $rows = (clone $base)
                ->orderBy('f.SUBCODE01')
                ->orderBy('f.SUBCODE08')
                ->orderBy('p.ABSUNIQUEID')
                ->offset(($page - 1) * $perPage)
                ->limit($perPage)
                ->get();

            $products = $rows->map(function ($r) use ($typeMap) {
                return [
                    'Id' => $r->id,
                    'RowKey' => md5(implode('|', [$r->id, $r->type_code, $r->sort_no, $r->shade_no, $r->name])),
                    'SortNo' => $r->sort_no,
                    'ShadeNo' => $r->shade_no,
                    'Name' => $r->name,
                    'SubType' => $typeMap[$r->type_code] ?? null,
                    'Status' => 'active',
                ];
            })->filter(fn($p) => $p['SubType'] !== null)->values();

            return response()->json([
                'data' => $products,
                'total' => (int) $total,
                'page' => $page,
                'per_page' => $perPage,
                'last_page' => max(1, (int) ceil($total / $perPage)),
            ]);
        }

        $query = Product::query();

        if ($category = $request->query('category')) {
            $query->where('Category', $category);
        }
        if ($subType = $request->query('sub_type')) {
            $query->where('SubType', $subType);
        }
        if ($status = $request->query('status')) {
            $query->where('Status', $status);
        }
        if ($search = $request->query('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('Name', 'like', "%{$search}%")
                    ->orWhere('Code', 'like', "%{$search}%");
            });
        }

        return response()->json($query->orderByDesc('Id')->get());
    }

    /** GET /api/products/available-stock */
    public function availableStock(Request $request)
    {
        // Keep in sync with the $typeMap used elsewhere (ProductController@index,
        // AllocationController, OrderController).
        $typeMap = [
            'Blouse' => 'BLW',
            'Dhoti' => 'DHT',
            'Uniform Shirting' => 'SHT',
            'Uniform Suiting' => 'SUT',
        ];

        $type = trim((string) $request->query('type', ''));
        if (!array_key_exists($type, $typeMap)) {
            return response()->json([
                'message' => 'type must be one of: ' . implode(', ', array_keys($typeMap)),
            ], 422);
        }
        $code = $typeMap[$type];

        $search = trim((string) $request->query('search', ''));
        $isExport = $request->boolean('export');
        $page = max((int) $request->query('page', 1), 1);
        // Export ignores paging and returns everything for the current
        // type/search in one go, capped well above any realistic catalog
        // size so a stray request can't exhaust memory.
        $perPage = $isExport ? 20000 : min(max((int) $request->query('per_page', 100), 1), 200);
        $tokens = $search !== '' ? preg_split('/\s+/', $search, -1, PREG_SPLIT_NO_EMPTY) : [];
        $sortShade = trim((string) $request->query('sort_shade', ''));

        // Oracle products only — locally added (SQL) products are not listed here.
        $localTotal = 0;

        // ── 2. Oracle catalog for this type (same join as index()'s oracle branch) ──
        $oracleBase = DB::connection('oracle')
            ->table('PRODUCT as p')
            ->join('FULLITEMKEYDECODER as f', function ($join) {
                $join->on('f.ITEMTYPECODE', '=', 'p.ITEMTYPECODE')
                    ->on('f.SUBCODE01', '=', 'p.SUBCODE01');
            })
            ->where('p.FIRSTUSERGRPCODE', $code);

        // Blouse: only the 4 sorts that are sold (same list as Product Selection).
        if ($code === 'BLW') {
            $oracleBase->whereRaw('TRIM(f.SUBCODE01) IN (?, ?, ?, ?)', self::BLOUSE_SORT_WHITELIST);
        }

        foreach ($tokens as $tok) {
            $oracleBase->whereRaw('UPPER(f.SHORTDESCRIPTION) LIKE ?', ['%' . strtoupper($tok) . '%']);
        }
        // Each word must match either Sort No or Shade (e.g. "1520 black").
        if ($sortShade !== '') {
            foreach (preg_split('/\s+/', $sortShade, -1, PREG_SPLIT_NO_EMPTY) as $tok) {
                $like = '%' . strtoupper($tok) . '%';
                $oracleBase->where(function ($q) use ($like) {
                    $q->whereRaw('UPPER(f.SUBCODE01) LIKE ?', [$like])
                        ->orWhereRaw('UPPER(f.SUBCODE08) LIKE ?', [$like]);
                });
            }
        }
        $oracleBase->select(
            'p.ABSUNIQUEID as id',
            'f.SUBCODE01 as sort_no',
            'f.SUBCODE08 as shade_no',
            'f.SHORTDESCRIPTION as name'
        )->distinct();

        $oracleTotal = Cache::remember(
            'oracle_catalog_total_' . md5(json_encode([$code, $search, $sortShade, 'blw4'])),
            300,
            fn() => DB::connection('oracle')
                ->table(DB::raw('(' . $oracleBase->toSql() . ') cnt'))
                ->mergeBindings($oracleBase)
                ->count()
        );

        $total = $localTotal + $oracleTotal;
        $startIndex = ($page - 1) * $perPage;

        $rows = [];


        // Remaining slots on this page come from Oracle, offset to account
        // for however many local rows were already shown on earlier pages.
        $remaining = $perPage - count($rows);
        if ($remaining > 0) {
            $oracleOffset = max(0, $startIndex - $localTotal);
            $oracleRows = (clone $oracleBase)
                ->orderBy('f.SUBCODE01')->orderBy('f.SUBCODE08')->orderBy('p.ABSUNIQUEID')
                ->offset($oracleOffset)->limit($remaining)->get();

            $sorts = $oracleRows->pluck('sort_no')->unique()->values()->all();
            $stockMap = app(OracleStock::class)->stockMapForSorts($sorts, [$code]);

            foreach ($oracleRows as $r) {
                $key = strtoupper(trim((string) $r->sort_no)) . '|' . strtoupper(trim((string) $r->shade_no));
                $rows[] = [
                    'sortNo' => $r->sort_no,
                    'shadeNo' => $r->shade_no,
                    'name' => $r->name,
                    'availableQty' => (int) ($stockMap[$key] ?? 0),
                    'source' => 'oracle',
                ];
            }
        }

        return response()->json([
            'data' => $rows,
            'total' => $total,
            'page' => $page,
            'per_page' => $perPage,
            'last_page' => max(1, (int) ceil($total / $perPage)),
        ]);
    }

    public function show($id)
    {
        $product = Product::find($id);
        if (!$product) {
            return response()->json(['message' => 'Product not found'], 404);
        }
        return response()->json($product);
    }

    /** POST /api/products */
    public function store(Request $request)
    {
        $validated = $request->validate([
            'tab' => 'required|in:yarn,cloth',
            'subType' => 'required|string|max:20',
            'name' => 'required|string|max:191',
            // FIX: was 'required' — but ProductList.jsx's bulk Excel
            // import (handleImportRows) never collects/sends a price at
            // all, so every single bulk-imported row was failing this
            // validation (422) and getting silently swallowed by the
            // frontend's catch{failed++}. That's the actual reason
            // uploaded rows never showed up afterwards. Price genuinely
            // isn't known at quick-add/bulk-import time — default it to
            // 0 and let it be filled in later from the product's own
            // Edit screen, same as CreditLimit/MaxDiscountPct already
            // work as "fill in later" fields elsewhere in this app.
            'price' => 'nullable|numeric|min:0',
            'qty' => 'required|integer|min:0',
            'weight' => 'nullable|string|max:500',
            'size' => 'nullable|string|max:500',
            'color' => 'nullable|string|max:10',
            // Accept any casing for quality — normalised to ucfirst below
            'quality' => 'nullable|string|in:Premium,Standard,Economy,premium,standard,economy',
            'description' => 'nullable|string',
            'status' => 'nullable|in:active,inactive',
            // FIX: sortNo/shadeNo were never validated/accepted at all,
            // so even though ProductList.jsx's Excel import already sent
            // them in the POST body, Laravel's validate() dropped them
            // before they ever reached Product::create(). Genuinely new
            // products could never get a real Sort No/Shade No — only
            // the originally-seeded catalog had anything resembling one,
            // and only because the seeder happened to store it in Code.
            'sortNo' => 'nullable|string|max:50',
            'shadeNo' => 'nullable|string|max:50',
        ]);

        $product = Product::create([
            'Code' => $this->generateProductCode($validated['tab']),
            'SortNo' => $validated['sortNo'] ?? null,
            'ShadeNo' => $validated['shadeNo'] ?? null,
            'Name' => $validated['name'],
            'Category' => $validated['tab'],
            'SubType' => Str::lower($validated['subType']),
            'Color' => $validated['color'] ?? '#FFFFFF',
            'Weight' => $validated['weight'] ?? null,
            'Size' => $validated['size'] ?? null,
            'Price' => $validated['price'] ?? 0,
            'Quantity' => $validated['qty'],
            // Store as ucfirst so DB is consistent: Premium / Standard / Economy
            'Quality' => ucfirst(Str::lower($validated['quality'] ?? 'standard')),
            'Description' => $validated['description'] ?? null,
            'Status' => $validated['status'] ?? 'active',
            'CreatedBy' => $request->user()->id,
        ]);

        return response()->json($product, 201);
    }

    /** PUT /api/products/{id} */
    public function update(Request $request, $id)
    {
        $product = Product::find($id);
        if (!$product) {
            return response()->json(['message' => 'Product not found'], 404);
        }

        $validated = $request->validate([
            'tab' => 'sometimes|required|in:yarn,cloth',
            'subType' => 'sometimes|required|string|max:20',
            'name' => 'sometimes|required|string|max:191',
            'price' => 'sometimes|required|numeric|min:0',
            'qty' => 'sometimes|required|integer|min:0',
            'weight' => 'nullable|string|max:500',
            'size' => 'nullable|string|max:500',
            'color' => 'nullable|string|max:10',
            // Accept any casing — normalised to ucfirst below
            'quality' => 'nullable|string|in:Premium,Standard,Economy,premium,standard,economy',
            'description' => 'nullable|string',
            'status' => 'nullable|in:active,inactive',
        ]);

        $map = [
            'tab' => 'Category',
            'subType' => 'SubType',
            'name' => 'Name',
            'price' => 'Price',
            'qty' => 'Quantity',
            'weight' => 'Weight',
            'size' => 'Size',
            'color' => 'Color',
            'quality' => 'Quality',
            'description' => 'Description',
            'status' => 'Status',
        ];

        $update = [];
        foreach ($map as $reqKey => $column) {
            if (array_key_exists($reqKey, $validated)) {
                $value = $validated[$reqKey];
                if ($column === 'SubType') {
                    $value = Str::lower($value);
                }
                if ($column === 'Quality' && $value !== null) {
                    // Always store as ucfirst: Premium / Standard / Economy
                    $value = ucfirst(Str::lower($value));
                }
                $update[$column] = $value;
            }
        }

        $product->update($update);
        return response()->json($product);
    }

    /** DELETE /api/products/{id} */
    public function destroy($id)
    {
        $product = Product::find($id);
        if (!$product) {
            return response()->json(['message' => 'Product not found'], 404);
        }

        if ($product->orders()->exists()) {
            return response()->json([
                'message' => 'This product cannot be deleted because it has existing orders. Mark it as inactive instead.'
            ], 409);
        }

        $product->delete();
        return response()->json(['message' => 'Product deleted']);
    }

    private function generateProductCode(string $category): string
    {
        $prefix = $category === 'yarn' ? 'YRN' : 'CLT';
        $last = Product::where('Code', 'like', "{$prefix}-%")->orderByDesc('Id')->first();
        $nextNumber = $last ? ((int) \Illuminate\Support\Str::after($last->Code, "{$prefix}-")) + 1 : 1;
        return "{$prefix}-" . str_pad($nextNumber, 3, '0', STR_PAD_LEFT);
    }

    /** GET /api/products/available-stock-summary */
    public function availableStockSummary()
    {
        return response()->json(
            // Shortened from 1800s to 60s (matches board()'s Oracle cache
            // window) and now busted immediately by any allocation change
            // (see AllocationController — Cache::forget('available_stock_summary')),
            // so this card reflects Marketing Review approvals in near
            // real time instead of sitting stale for up to 30 minutes.
            Cache::remember('available_stock_summary', 60, function () {
                $oracleStock = app(OracleStock::class);

                // One Oracle round-trip for ALL garment types at once.
                // oracleTotals keys: BLW, DHT, SHT, SUT
                $oracleTotals = $oracleStock->allTypeTotals();

                $typeMap = [
                    'Blouse' => 'BLW',
                    'Dhoti' => 'DHT',
                    'Uniform Shirting' => 'SHT',
                    'Uniform Suiting' => 'SUT',
                ];

                // Stock Marketing Review has already allocated but that
                // Oracle doesn't know about yet — i.e. not yet pushed via
                // "Transfer to ERP". Once a row is erp_so_created, Oracle's
                // own BALANCE already reflects the draw-down, so it's
                // excluded here to avoid subtracting it twice. This is the
                // same reservation math Marketing Review's own board uses
                // per-product (poolAvailable), just aggregated by garment
                // SubType for this top-level card.
                $reservedBySubType = DB::table('sale_order_line')
                    ->join('Products', 'Products.Id', '=', 'sale_order_line.CrmProductId')
                    ->where('sale_order_line.USERPRIMARYQUANTITY', '>', 0)
                    ->where('sale_order_line.CrmErpStatus', '!=', 'erp_so_created')
                    ->select('Products.SubType', DB::raw('SUM(sale_order_line.USERPRIMARYQUANTITY) as Reserved'))
                    ->groupBy('Products.SubType')
                    ->pluck('Reserved', 'SubType');

                $out = [];
                foreach ($typeMap as $label => $code) {
                    $local = 0.0; // Oracle products only
                    $raw = ($oracleTotals[$code] ?? 0) + $local;
                    $reserved = (float) ($reservedBySubType[$label] ?? 0);
                    $out[$label] = (int) round(max(0, $raw - $reserved));
                }

                // Blouse: count only the 4 sorts that are sold, not the whole catalog.
                $blouseRaw = array_sum($oracleStock->stockMapForSorts(self::BLOUSE_SORT_WHITELIST, ['BLW']));
                $blouseReserved = (float) ($reservedBySubType['Blouse'] ?? 0);
                $out['Blouse'] = (int) round(max(0, $blouseRaw - $blouseReserved));

                // "Others" has no Oracle equivalent — local products only.
                $othersRaw = (float) Product::where('SubType', 'Others')->where('Status', 'active')->sum('Quantity');
                $othersReserved = (float) ($reservedBySubType['Others'] ?? 0);
                $out['Others'] = (int) round(max(0, $othersRaw - $othersReserved));

                $out['all'] = array_sum($out);

                return $out;
            })
        );
    }
}