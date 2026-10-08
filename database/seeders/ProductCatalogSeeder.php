<?php

namespace Database\Seeders;

use App\Models\Product;
use Illuminate\Database\Seeder;

/**
 * ProductCatalogSeeder
 *
 * Source of truth is the client's real product-master spreadsheet
 * (Product_Details_*.xlsx — sheets: Blouse, "POL, Cotton Dhoti & BO
 * Dhoti", Uniform suiting, Shirting). Each spreadsheet row is one exact
 * product variant (a given Sort No + Shade No combination, e.g. "Ruby"
 * in 5 different shades).
 *
 * Column mapping (only these 3 fields are sourced from the sheet —
 * nothing else about a product is invented/guessed from it):
 *   Code 1 (e.g. "1520", "6675")      -> SortNo (and Code, for
 *                                         backward compatibility, only
 *                                         on brand-new rows — see below)
 *   Code 8 (e.g. "NATWHITE", "PW-022") -> ShadeNo
 *   Product Name (e.g. "Ruby")         -> Name
 *
 * ── NON-DESTRUCTIVE: update-or-create, never delete ──
 * An earlier version of this seeder deleted every product under a
 * SubType before reinserting it fresh. That is NOT safe here: this
 * database has real ProductAllocations / allocation_batch_consumptions
 * rows that foreign-key onto existing Products, and SQL Server
 * correctly refuses to delete a Product that's still referenced —
 * `php artisan db:seed` failed with exactly that constraint violation
 * the moment it hit a Blouse product tied to a real allocation.
 *
 * So this version never deletes anything. For each spreadsheet row it
 * claims one existing, not-yet-claimed Product under the matching
 * canonical SubType (matched by Name, case-insensitively) and updates
 * only SortNo/ShadeNo/Name on it — every other field (Price, Quantity,
 * Color, Status, and critically its Id, which allocations point to)
 * is left exactly as it is. Only once a SubType's existing rows are
 * all claimed does it start `create()`-ing brand-new rows for the
 * remaining spreadsheet lines (e.g. the extra shade variants this real
 * data has that were never seeded before).
 *
 * "Claiming" is scoped per SubType-alias group and consumed in order,
 * so re-running this seeder is idempotent: it keeps updating the same
 * rows to the same values and never creates duplicates on a second run
 * (existing rows get claimed again in the same order every time).
 *
 * Everything else on a row (Price, Quantity, Quality, Status, Color)
 * keeps existing values for updated rows, or this seeder's long-
 * standing defaults for brand-new rows — the sheet doesn't carry that
 * data, so nothing is fabricated for it.
 *
 * Run with:
 *   php artisan db:seed --class="Database\Seeders\ProductCatalogSeeder"
 */
class ProductCatalogSeeder extends Seeder
{
    private const DUMMY_SWATCHES = ['#8FD9A8', '#7FD1E0', '#E893C9', '#9A9AA5', '#F0A15C', '#B7A6E0'];

    private function fallbackColor(int $i): string
    {
        return self::DUMMY_SWATCHES[$i % count(self::DUMMY_SWATCHES)];
    }

    // Code still needs to be table-wide unique (legacy UNIQUE
    // constraint), even though SortNo — the real business identifier —
    // deliberately repeats across shade variants of the same product,
    // exactly as the source sheet shows (e.g. Sort No "6675" appears on
    // 5 different Dhoti rows here, once per shade). Seeded with every
    // Code already in the DB so brand-new rows never collide with an
    // existing one, not just with each other.
    private array $usedCodes = [];

    private function uniqueCode(string $rawCode): string
    {
        if (!isset($this->usedCodes[$rawCode])) {
            $this->usedCodes[$rawCode] = 1;
            return $rawCode;
        }
        $this->usedCodes[$rawCode]++;
        return $rawCode . '-' . $this->usedCodes[$rawCode];
    }

    // Every SubType spelling/casing this catalog has ever been seeded
    // under, keyed by the ONE correct/current SubType — used to find
    // existing rows to update regardless of which old spelling they're
    // still sitting under (e.g. old split "Cotton Dhoti Grey"/"Cotton
    // Dhoti Fabric" buckets, which the real sheet does not distinguish
    // — it is just "Dhoti").
    private const SUBTYPE_ALIASES = [
        'Blouse'            => ['Blouse', 'blouse'],
        'Dhoti'             => ['Dhoti', 'dhoti', 'Cotton Dhoti Grey', 'cotton dhoti grey', 'BO Grey - Dhothies', 'Cotton Dhoti Fabric', 'cotton dhoti fabric', 'BO Fabric - Dhothies'],
        'Uniform Shirting'  => ['Uniform Shirting', 'uniform shirting'],
        'Uniform Suiting'   => ['Uniform Suiting', 'uniform suiting'],
        'Premier Shirting'  => ['Premier Shirting', 'premier shirting', 'others'],
    ];

    public function run(): void
    {
        $creatorId = \DB::table('users')->where('role', 'super_admin')->value('id')
            ?? \DB::table('users')->orderBy('id')->value('id');

        foreach (Product::pluck('Code') as $existingCode) {
            if ($existingCode !== null) {
                $this->usedCodes[$existingCode] = 1;
            }
        }

        // Each row: [Code 1 (SortNo), Code 8 (ShadeNo), Product Name]
        $catalog = [
            'Blouse' => [
                ['1520', 'NATWHITE', 'Ruby'],
                ['1520', 'JETBLACK', 'Ruby'],
                ['1520', 'SHADE1', 'Ruby'],
                ['1520', 'SHADE200', 'Ruby'],
                ['1520', 'SHADE600', 'Ruby'],
                ['1978', 'JETBLACK', 'Pratishta'],
                ['1978', 'NATWHITE', 'Pratishta'],
                ['1978', 'SHADE200', 'Pratishta'],
                ['1978', 'SHADE400', 'Pratishta'],
                ['1978', 'SHADE600', 'Pratishta'],
                ['1980', 'JETBLACK', 'Top Star'],
                ['1980', 'WHITE', 'Top Star'],
                ['1980', 'SHADE1', 'Top Star'],
                ['1980', 'SHADE100', 'Top Star'],
                ['1980', 'SHADE200', 'Top Star'],
            ],
            'Dhoti' => [
                ['6600', 'PRIME3.7', 'Prime King 3.7'],
                ['6675', 'EVERFRES', 'Ever Fresh 3.7'],
                ['6675', 'CHRYPR37', 'Chakravarthy Premium 3.7'],
                ['6642', 'CHAVABB', 'Chakravarthy BB 3.7'],
                ['6906', 'SUGAN3.7', 'Sugantham 3.7'],
                ['6900', 'COOLT3.7', 'Cool Touch 3.7'],
                ['6805', 'VASA9137', 'Vasanth Utsav Super Dlx 9*137'],
                ['6705', 'VASA8137', 'Vasanth Utsav Super Dlx 8*137'],
                ['6718', 'SHIV8132', 'Shivaji Supreme 8*132'],
                ['6675', 'CHAKRY37', 'Chakravarthy 3.7'],
                ['6999', 'VASAN3.7', 'Vasantham 3.7'],
                ['6801', 'CHPT9137', 'Chatrapati Maharaj Super Dlx 9*137'],
                ['6719', 'SHIV8137', 'Shivaji Super Dlx 8*137'],
                ['6720', 'SHIV9137', 'Shivaji Super Dlx 9*137'],
                ['6905', 'VASA8132', 'Vasanth Utsav 8*132'],
                ['6805', 'CHKY9137', 'Chakravarthy Super Dlx 9*137'],
                ['6805', 'MHSD9137', 'Mahasamrat Super Dlx 9*137'],
                ['6725', 'SHAHUJ9M', 'Shahuji Maharaj Super Dlx 9*137'],
                ['6674', 'CHABB3.7', 'Chalukya BB 3.7'],
                ['6605', 'CHKS8132', 'Chakravarthy Supreme 8*132'],
                ['6723', 'SHAHUJI8', 'Shahuji Maharaj Super Dlx 8*137'],
                ['6705', 'MHSD8137', 'Mahasamrat Super Dlx 8*137'],
                ['6675', 'MAHAS3.7', 'Mahasamrat 3.7'],
                ['6606', 'CHALU3.7', 'Chalukya 3.7'],
                ['6171', 'KEEXP3.7', 'Kerala Express 3.7'],
                ['6605', 'MASP8132', 'Mahasamrat Supreme 8*132'],
                ['6701', 'CHPT8137', 'Chatrapati Maharaj Super Dlx 8*137'],
                ['6675', 'MAHAS7.4', 'Mahasamrat 7..4'],
                ['6705', 'CHKY8137', 'Chakravarthy Super Dlx 8*137'],
                ['6675', 'CHAKRY74', 'Chakravarthy 7.4'],
                ['8532', 'PMINSP74', 'Prime Minister Spl 3.7'],
                ['8547', 'BHSP37', 'Bharat Ratna Spl 3.7'],
                ['8547', 'BHASP7.4', 'Bharat Ratna Spl 3.7'],
                ['8531', 'GOVSP7.4', 'Governor Spl 3.7'],
                ['8611', 'GOSDX8', 'Governor Super Dlx 8*137'],
                ['8531', 'GOVERSPL', 'Governor Spl 3.7'],
                ['8532', 'PRMINSPL', 'Prime Minister Spl 3.7'],
                ['8614', 'GOSDX9', 'Governor Super Dlx 9*137'],
                ['8613', 'GOVE8132', 'Governor Supreme 8*132'],
                ['8610', 'RASHSUD8', 'RASHTRABATHI SUPER DLX 8*137'],
                ['2009RAJRAJ', 'RAJA3.65', 'Raja Raja 3.65'],
                ['33419', 'REALDIAM', 'Real Diamond 3.65'],
                ['2308ASHO37', 'BLEACHED', 'Ashoka 3.65'],
                ['2094', 'MIXED', 'Chiranjeevi'],
                ['2503', 'MIXED', 'Chiranjeevi'],
            ],
            'Uniform Shirting' => [
                ['1257', 'APCGREY', 'Silver Touch'],
                ['1257', 'BLEACHED', 'Silver Touch'],
                ['1257', 'SKYBLUE', 'Silver Touch'],
                ['1257', '575GREY', 'Silver Touch'],
                ['1257', 'APCBLUE', 'Silver Touch'],
                ['1481', '503', 'Senator Spl'],
                ['1481', '502', 'Senator'],
                ['1481', '504', 'Senator'],
                ['1481', 'GBLUE', 'Senator Spl'],
                ['2138SWISS', 'BLEACHED', 'Swiss Cotton'],
                ['2357SWI200', 'MIXED', 'Swiss Cotton Spl'],
                ['2357SWISS', 'CREAM', 'Swiss Cotton Spl'],
                ['2357SWISS', 'SAPOTA', 'Swiss Cotton Spl'],
                ['2357SWISS', 'PISTAGRE', 'Swiss Cotton Spl'],
                ['2357SWISS', 'MAROON', 'Swiss Cotton Spl'],
                ['2738ACC', 'WHITE', 'ACC White'],
                ['2788', '500', 'Major'],
                ['2788', '505', 'Major'],
                ['2788', '505A', 'Major'],
                ['2788', '511', 'Major'],
                ['2788', '504', 'Major'],
                ['2068SCYELL', null, 'Classmate Small Checks'],
                ['2068SCMRN', null, 'Classmate Small Checks'],
                ['2068SCRBLU', null, 'Classmate Small Checks'],
                ['2068SCGRN', null, 'Classmate Small Checks'],
                ['2068SCRED', null, 'Classmate Small Checks'],
                ['2068SCLTBL', null, 'Classmate Small Checks'],
            ],
            'Uniform Suiting' => [
                ['2005WINCHE', '502', 'Winchester Spl'],
                ['2005WINCHE', '504', 'Winchester Spl'],
                ['2005WINCHE', '500WHITE', 'Winchester Spl'],
                ['2005WINCHE', 'CARBLUE', 'Winchester Spl'],
                ['2005WINCHE', '500', 'Winchester Spl'],
                ['5263', 'MAROON', 'Wimbledon Supreme'],
                ['5263', 'VVBLUE', 'West Minister'],
                ['5263', 'TOMORED', 'Wimbledon Supreme'],
                ['5263', '500', 'Wimbledon Supreme'],
                ['5263', '502', 'Wimbledon Supreme'],
                ['5263', '504', 'Wimbledon Supreme'],
                ['5263', '575', 'Wimbledon Supreme'],
                ['5263', '503', 'Windsor Supreme'],
                ['5263', '200GMARO', 'Wimbledon Supreme'],
                ['5263', '503', 'Windsor Supreme'],
                ['5263', 'APCMARON', 'Wimbledon Supreme'],
                ['5263', 'GBLUE', 'Windsor Spl'],
            ],
            'Premier Shirting' => [
                ['32604', 'PW-022', 'Morbido Dyed'],
                ['32604', 'PW-062', 'Morbido Dyed'],
                ['32604', 'PW-001', 'Morbido Bleached'],
                ['32625', 'PW-001', 'Breeze Bleached'],
                ['32625', 'PW-002', 'Breeze Dyed'],
                ['32625', 'PW-003', 'Breeze Dyed'],
                ['32575', 'BLACK', 'Bianco Black'],
                ['32575', 'BIANCO22', 'Bianco White'],
                ['32575', 'IVORY', 'Bianco Ivory'],
                ['32575', 'SKYBLUE', 'Sky Blue'],
                ['32575', 'PINK', 'Bianco Pink'],
                ['9720', 'HOTCHOCH', '9720 Dyed'],
                ['9720', 'BLUEATTO', '9720 Dyed'],
                ['9720', 'BABYPINK', '9720 Dyed'],
                ['9720', 'GRAPE', '9720 Dyed'],
                ['9720', 'EMBMOCHA', '9720 Dyed'],
                ['9720', 'LAVENDER', '9720 Dyed'],
                ['9720', 'BLEACHED', '9720 Bleached'],
                ['9721', 'NAVYBLUE', '9721 Dyed'],
                ['9721', 'LAVENDER', '9721 Dyed'],
                ['9721', 'SLIVERGR', '9721 Dyed'],
                ['9721', 'ROSE', '9721 Dyed'],
                ['9721', 'NUDE', '9721 Dyed'],
                ['9721', 'BLEACHED', '9721 Bleached'],
                ['9721', 'LTSKIN', '9721 Dyed'],
                ['32163', 'NAVYBLUE', '32163 Dyed'],
                ['32163', 'RFP', '32163 Dyed'],
                ['32163', 'BLEACHED', '32163 Bleached'],
                ['32160', 'CARBON', '32160 Dyed'],
                ['32160', 'APCCREAM', '32160 Dyed'],
                ['32160', 'ICEBEGR', '32160 Dyed'],
                ['32160', 'BLEACHED', '32160 Bleached'],
                ['32316', 'BLEACHED', 'Light Of Peace'],
                ['32623', 'BLEACHED', 'Light of Bharath'],
                ['32623', 'BLEACHED', 'Light of Bharath'],
                ['32623', 'BLEACHED', 'Light of Bharath'],
                ['32659', 'PW-001', 'Maharaja Piece Dyed'],
                ['32659', 'PW-006', 'Maharaja Piece Dyed'],
                ['32659', 'PW-006', 'Maharaja Piece Dyed'],
                ['32659', 'PW-013', 'Maharaja Piece Dyed'],
                ['32659', 'PW-022', 'Maharaja Piece Dyed'],
                ['32963', 'FRENCHWI', '32963 Dyed'],
                ['32963', 'NAVYBLUE', '32963 Dyed'],
                ['32963', 'MINTGREE', '32963 Dyed'],
                ['32963', 'DKMAROON', '32963 Dyed'],
                ['32963', 'BLEACHED', '32963 Bleached'],
                ['DR21K280', null, 'Maharaja Yarn Dyed'],
                ['DR21K282', null, 'Maharaja Yarn Dyed'],
                ['DR21K283', null, 'Maharaja Yarn Dyed'],
                ['DR21K284', null, 'Maharaja Yarn Dyed'],
                ['DR21K285', null, 'Maharaja Yarn Dyed'],
                ['DR23E001', null, 'Lumino'],
                ['DR23E002', null, 'Lumino'],
                ['DR23E003', null, 'Lumino'],
                ['DR23E004', null, 'Lumino'],
                ['DR23E005', null, 'Lumino'],
            ],
        ];
        // ── UPDATE existing rows, then CREATE any left over ─────────
        $updated = 0;
        $created = 0;
        foreach ($catalog as $subType => $rows) {
            $aliases = self::SUBTYPE_ALIASES[$subType] ?? [$subType];

            // All existing products under any alias of this SubType,
            // grouped by lowercased Name, each an ordered queue we pop
            // from as we claim rows — so re-running this seeder claims
            // the same existing rows in the same order every time.
            $existingByName = Product::whereIn('SubType', $aliases)
                ->get()
                ->groupBy(fn ($p) => mb_strtolower(trim($p->Name)))
                ->map(fn ($group) => $group->values()->all())
                ->all();

            $i = 0;
            foreach ($rows as [$sortNo, $shadeNo, $name]) {
                $key = mb_strtolower(trim($name));
                $queue = $existingByName[$key] ?? [];

                if (!empty($queue)) {
                    $product = array_shift($queue);
                    $existingByName[$key] = $queue;

                    $product->SortNo = $sortNo;
                    $product->ShadeNo = $shadeNo;
                    $product->Name = $name;
                    // SubType is deliberately NOT overwritten here — an
                    // existing row keeps whichever alias spelling it's
                    // already under; only its 3 sourced fields change.
                    $product->save();
                    $updated++;
                } else {
                    Product::create([
                        'Name'        => $name,
                        'SubType'     => $subType,
                        'Code'        => $this->uniqueCode($sortNo),
                        'SortNo'      => $sortNo,
                        'ShadeNo'     => $shadeNo,
                        'Category'    => 'cloth',
                        'Color'       => $this->fallbackColor($i++),
                        'Price'       => 100,
                        'Quantity'    => 1000,
                        'Quality'     => 'Standard',
                        'Description' => null,
                        'Status'      => 'active',
                        'CreatedBy'   => $creatorId,
                    ]);
                    $created++;
                }
            }
        }

        $this->command?->info("ProductCatalogSeeder: updated {$updated} existing products, created {$created} new ones, across " . count($catalog) . " subtypes. Nothing was deleted.");
    }
}