<?php
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\CustomerController;
use App\Http\Controllers\Api\ProductController;
use App\Http\Controllers\Api\OrderController;
use App\Http\Controllers\Api\EmployeeController;
use App\Http\Controllers\Api\UserController;
use App\Http\Controllers\Api\LocationController;
use App\Http\Controllers\Api\DashboardController;
use App\Http\Controllers\Api\ComplaintController;
use App\Http\Controllers\Api\AllocationController;
use App\Http\Controllers\Api\BatchController;
use App\Http\Controllers\Api\InvoiceController;
use App\Http\Controllers\Api\NotificationController;
use App\Http\Controllers\Api\SaleOrderController;

Route::post('/login', [AuthController::class, 'login']);


Route::middleware('auth:sanctum')->group(function () {
    Route::post('/logout', [AuthController::class, 'logout']);
    Route::get('/me',      [AuthController::class, 'me']);

    Route::get('/dashboard',            [DashboardController::class, 'index']);
    Route::get('/dashboard/o2c',        [DashboardController::class, 'o2c']);
    Route::get('/dashboard/compliance', [DashboardController::class, 'compliance']);

    Route::post('/orders/bulk', [OrderController::class, 'storeBulk']);
    Route::post('/orders/cart', [OrderController::class, 'storeCart']);
    Route::patch('/orders/close', [OrderController::class, 'close']);
    Route::apiResource('customers', CustomerController::class);
    Route::get('/products/available-stock-summary', [ProductController::class, 'availableStockSummary']);
    Route::get('/products/available-stock', [ProductController::class, 'availableStock']);
    Route::apiResource('products',  ProductController::class);
    Route::apiResource('orders',    OrderController::class);

    // Complaints — customer submits and views their own complaint history;
    // Marketing/System Admin resolves via the Claim Process workflow.
    Route::get('/complaints',              [ComplaintController::class, 'index']);
    Route::post('/complaints',             [ComplaintController::class, 'store']);
    Route::patch('/complaints/{id}/resolve', [ComplaintController::class, 'resolve']);

    // Quantity Allocation — Admin/System Admin decide how much of a
    // product each customer actually gets when total orders exceed stock.
    // Every save draws stock via FIFO from stock_batches (oldest first).
    Route::post('/allocations/{id}/cancel', [AllocationController::class, 'cancel']);
    Route::get('/allocations/products',    [AllocationController::class, 'products']);
    Route::get('/allocations/customers',   [AllocationController::class, 'customers']);
    Route::get('/allocations/by-customer', [AllocationController::class, 'byCustomer']);
    Route::post('/allocations/by-customer',[AllocationController::class, 'storeByCustomer']);
    Route::get('/allocations/price-list-options', [AllocationController::class, 'priceListOptions']);
    // Single combined call for the whole Marketing Review board — every
    // product with active demand plus its full per-customer breakdown, in
    // one round trip. Replaces the old GET /allocations/products followed
    // by one GET /allocations?product_id=X per product, which was loading
    // the page one product at a time.
    Route::get('/allocations/board',    [AllocationController::class, 'board']);
    Route::get('/allocations',          [AllocationController::class, 'index']);
    Route::post('/allocations',         [AllocationController::class, 'store']);
    Route::get('/allocations/{id}/batches', [AllocationController::class, 'batchBreakdown']);

    // Marketing Review -> Final Approval workflow (System Admin only) and
    // the flat list feeding the Sales Order page's four drill-down views.
    Route::get('/allocations/list',              [AllocationController::class, 'list']);
    Route::patch('/allocations/{id}/decision',    [AllocationController::class, 'decision']);
    Route::post('/allocations/bulk-decision',     [AllocationController::class, 'bulkDecision']);
    Route::post('/allocations/{id}/erp-transfer', [AllocationController::class, 'erpTransfer']);
    Route::post('/allocations/bulk-erp-transfer', [AllocationController::class, 'bulkErpTransfer']);

    // ERP staging tables — sale_order_header (1 per order) + sale_order_line
    // (1 per product). Written automatically when an order is placed;
    // these endpoints are read-only (list, detail, per-order preview, Excel export).
    Route::get('/sale-orders/export',  [SaleOrderController::class, 'export']);
    Route::get('/sale-orders',         [SaleOrderController::class, 'index']);
    Route::get('/sale-orders/{id}',    [SaleOrderController::class, 'show']);
    Route::get('/erp-export/{orderId}',[SaleOrderController::class, 'byOrder']);

    // Stock batches (FIFO lots) — Rack (Blouse) vs EB4 Dispatch Warehouse.
    Route::get('/batches',  [BatchController::class, 'index']);
    Route::post('/batches', [BatchController::class, 'store']);

    // Invoices — generated against a dispatched/allocated order.
    Route::get('/invoices',                 [InvoiceController::class, 'index']);
    Route::get('/invoices/eligible-orders', [InvoiceController::class, 'eligibleOrders']);
    Route::post('/invoices',                [InvoiceController::class, 'store']);
    Route::patch('/invoices/{id}/status',   [InvoiceController::class, 'updateStatus']);

    // In-app notifications (order approved/declined/dispatched, claim resolved).
    Route::get('/notifications',            [NotificationController::class, 'index']);
    Route::patch('/notifications/{id}/read',[NotificationController::class, 'markRead']);
    Route::patch('/notifications/read-all', [NotificationController::class, 'markAllRead']);

    Route::patch('/customers/{id}/status', [CustomerController::class, 'updateStatus']);
    Route::patch('/orders/{id}/status',    [OrderController::class, 'updateStatus']);
    Route::patch('/orders/{id}/reject',    [OrderController::class, 'reject']);
    Route::patch('/orders/{id}/assign',    [OrderController::class, 'assign']);
    Route::patch('/orders/{id}/dispatch',  [OrderController::class, 'dispatch']);
    Route::patch('/orders/{id}/release-hold', [OrderController::class, 'releaseHold']);
    Route::patch('/orders/{id}/payment-due', [OrderController::class, 'updatePaymentDue']);
    Route::patch('/orders/{id}/record-payment', [OrderController::class, 'recordPayment']);
    Route::get('/credit-limit', [\App\Http\Controllers\Api\CreditLimitController::class, 'index']);
    Route::patch('/employees/{id}/status', [EmployeeController::class, 'updateStatus']);

    Route::get('/employees',          [EmployeeController::class, 'index']);
    Route::get('/employees/{id}',     [EmployeeController::class, 'show']);
    Route::post('/employees',         [EmployeeController::class, 'store']);
    Route::put('/employees/{id}',     [EmployeeController::class, 'update']);
    Route::patch('/employees/{id}',   [EmployeeController::class, 'update']);

    // Admin Master — Super Admin account provisioning for end_user / admin /
    // system_admin logins (direct create with password, no approval step).
    Route::get('/accounts',           [UserController::class, 'index']);
    Route::get('/accounts/{id}',      [UserController::class, 'show']);
    Route::post('/accounts',          [UserController::class, 'store']);
    Route::put('/accounts/{id}',      [UserController::class, 'update']);
    Route::patch('/accounts/{id}',    [UserController::class, 'update']);
    Route::delete('/accounts/{id}',   [UserController::class, 'destroy']);

    // Tamil Nadu district / taluk reference data — used for District
    // assignment (System Admin → Admin) and Taluk assignment (Admin → End User)
    Route::get('/locations/districts', [LocationController::class, 'districts']);
    // Every taluk across every district in one call — used by Marketing
    // Review's Region filter, which previously looped one request per
    // district (GET /locations/districts, then N x GET /locations/taluks)
    // to build the same combined list.
    Route::get('/locations/taluks/all', [LocationController::class, 'allTaluks']);
    Route::get('/locations/taluks',    [LocationController::class, 'taluks']);
});