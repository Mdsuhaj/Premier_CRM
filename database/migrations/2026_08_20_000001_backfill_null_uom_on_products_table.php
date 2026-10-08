<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// FIX: Marketing Review's Customer Wise View was still showing "—" in
// every row's UOM column even after the 'UOM' column existed on
// products (see 2026_08_19_112403_add_uom_to_products_table.php).
//
// Root cause: that migration added the column with
// ->default('Box') — but this project runs on SQL Server
// (DB_CONNECTION=sqlsrv). On SQL Server, adding a *nullable* column
// with a DEFAULT constraint via ALTER TABLE does NOT backfill existing
// rows with that default — they're left NULL — unless the ALTER
// statement explicitly includes "WITH VALUES". Laravel's schema
// builder does not add that clause, so every product that already
// existed before that migration ran kept a NULL UOM; only brand-new
// products created afterward would ever get 'Box' automatically. (This
// is a SQL Server-specific behavior — MySQL/SQLite would have backfilled
// automatically, which is why the earlier migration's comment expected
// it to "just work".)
//
// This migration explicitly backfills every existing NULL to 'Box',
// same default the earlier migration intended, via a plain UPDATE that
// works the same regardless of DB driver.
return new class extends Migration {
    public function up(): void
    {
        DB::table('products')->whereNull('UOM')->update(['UOM' => 'Box']);
    }

    public function down(): void
    {
        // Intentionally a no-op — there's no way to tell which rows were
        // NULL before this ran, and reverting real product data back to
        // NULL isn't something a rollback should ever do.
    }
};
