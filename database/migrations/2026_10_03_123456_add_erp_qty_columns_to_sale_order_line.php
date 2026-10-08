<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sale_order_line', function (Blueprint $t) {
            $t->decimal('CrmTotalMtrQty', 18, 2)->default(0); // Σ cases × Mtr allocated so far
            $t->decimal('CrmErpSentQty', 18, 2)->default(0);  // how much of that already went to Oracle
        });
    }

    public function down(): void
    {
        Schema::table('sale_order_line', function (Blueprint $t) {
            $t->dropColumn(['CrmTotalMtrQty', 'CrmErpSentQty']);
        });
    }
};