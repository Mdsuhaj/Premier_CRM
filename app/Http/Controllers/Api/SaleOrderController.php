<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SaleOrderHeader;
use App\Models\SaleOrderLine;
use App\Services\SaleOrderService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Read-only API over the ERP staging tables (sale_order_header / sale_order_line).
 * The rows themselves are written by App\Services\SaleOrderService whenever
 * an order is placed — there is deliberately no create/update endpoint here.
 */
class SaleOrderController extends Controller
{
    /**
     * GET /api/sale-orders?q=&from=&to=&limit=
     * One row per ERP header, with customer name and number of lines.
     */
    public function index(Request $request)
    {
        $this->authorizeStaff($request);

        $query = SaleOrderHeader::query()
            ->leftJoin('Customers as c', 'c.Id', '=', 'sale_order_header.CrmCustomerId')
            ->select(
                'sale_order_header.Id',
                'sale_order_header.CODE',
                'sale_order_header.COUNTERCODE',
                'sale_order_header.ORDERDATE',
                'sale_order_header.REQUIREDDUEDATE',
                'sale_order_header.ORDPRNCUSTOMERSUPPLIERCODE',
                'sale_order_header.CURRENCYCODE',
                'sale_order_header.IMPORTSTATUS',
                'sale_order_header.IMPORTAUTOCOUNTER',
                'sale_order_header.RELATEDDEPENDENTID',
                'sale_order_header.CrmGroupRef',
                'sale_order_header.CrmCustomerId',
                'c.Name as CustomerName',
                'c.Code as CustomerCode'
            )
            ->withCount('lines');

        if ($q = trim((string) $request->query('q', ''))) {
            $query->where(function ($w) use ($q) {
                $w->where('sale_order_header.CODE', 'like', "%{$q}%")
                  ->orWhere('sale_order_header.ORDPRNCUSTOMERSUPPLIERCODE', 'like', "%{$q}%")
                  ->orWhere('c.Name', 'like', "%{$q}%")
                  ->orWhere('c.Code', 'like', "%{$q}%");
            });
        }
        if ($from = $request->query('from')) {
            $query->whereDate('sale_order_header.ORDERDATE', '>=', $from);
        }
        if ($to = $request->query('to')) {
            $query->whereDate('sale_order_header.ORDERDATE', '<=', $to);
        }

        $limit = min(max((int) $request->query('limit', 200), 1), 1000);

        return response()->json(
            $query->orderByDesc('sale_order_header.Id')->limit($limit)->get()
        );
    }

    /** GET /api/sale-orders/{id} — one header (every column) + all its lines. */
    public function show(Request $request, $id)
    {
        $this->authorizeStaff($request);

        $header = SaleOrderHeader::find($id);
        if (!$header) {
            return response()->json(['message' => 'Sale order not found.'], 404);
        }
        return response()->json($this->payload($header));
    }

    /**
     * GET /api/erp-export/{orderId}
     * Read-only preview of the staged Header + Line rows for one CRM Order.
     */
    public function byOrder(Request $request, $orderId)
    {
        $this->authorizeStaff($request);

        $line = SaleOrderLine::where('CrmOrderId', $orderId)->first();
        if (!$line) {
            return response()->json(['message' => 'This order has not been staged for ERP.'], 404);
        }
        $header = SaleOrderHeader::where('RELATEDDEPENDENTID', $line->FATHERID)->first();
        if (!$header) {
            return response()->json(['message' => 'Header row missing for this order.'], 404);
        }
        return response()->json($this->payload($header));
    }

    /**
     * GET /api/sale-orders/export?ids[]=1&ids[]=2   (no ids = everything)
     * Rows in the client's exact ERP layout, for the "Download ERP Excel"
     * button: { headerColumns, lineColumns, header:[...], line:[...] }.
     * CRM-only helper columns are left out.
     */
    public function export(Request $request, SaleOrderService $service)
    {
        $this->authorizeStaff($request);

        $ids = array_filter(array_map('intval', (array) $request->query('ids', [])));

        $headerCols = $service->exportColumns(SaleOrderHeader::class);
        $lineCols   = $service->exportColumns(SaleOrderLine::class);

        $headers = SaleOrderHeader::query()
            ->when($ids, fn ($q) => $q->whereIn('Id', $ids))
            ->orderBy('Id')->get($headerCols);

        $fatherIds = $headers->pluck('RELATEDDEPENDENTID')->all();
        $lines = $fatherIds
            ? SaleOrderLine::whereIn('FATHERID', $fatherIds)->orderBy('FATHERID')->orderBy('ORDERLINE')->get($lineCols)
            : collect();

        return response()->json([
            'headerColumns' => $headerCols,
            'lineColumns'   => $lineCols,
            'header'        => $headers,
            'line'          => $lines,
        ]);
    }

    private function payload(SaleOrderHeader $header): array
    {
        $customer = $header->CrmCustomerId
            ? DB::table('Customers')->where('Id', $header->CrmCustomerId)->select('Id', 'Code', 'Name', 'OracleId')->first()
            : null;

        return [
            'header'   => $header,
            'lines'    => SaleOrderLine::where('FATHERID', $header->RELATEDDEPENDENTID)->orderBy('ORDERLINE')->get(),
            'customer' => $customer,
        ];
    }

    private function authorizeStaff(Request $request): void
    {
        $role = $request->user()->role ?? null;
        abort_unless(in_array($role, ['admin', 'system_admin', 'super_admin'], true), 403, 'Not permitted.');
    }
}
