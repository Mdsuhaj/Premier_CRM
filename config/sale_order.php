<?php

/**
 * ERP sale-order staging (sale_order_header / sale_order_line).
 *
 * The *_defaults arrays are the constant ERP values taken from the client's
 * sample file SOBean.xlsx (company, division, template, warehouse, tax, ...).
 * Anything not listed here is stored as NULL. Anything that changes per
 * order/product (customer, dates, quantities, sub-codes, IDs) is filled in
 * by App\Services\SaleOrderService — NOT from here.
 *
 * Every value can be tuned without touching code: edit this file, or override
 * the handful of SALE_ORDER_* keys in .env.
 */
return [

    // Master switch. false = CRM behaves exactly as before (no rows written).
    'enabled' => env('SALE_ORDER_STAGING', true),

    // Look up SUBCODE02..07 / ITEMTYPEAFICODE of Oracle products in
    // FULLITEMKEYDECODER at order time (needs the 'oracle' connection).
    'oracle_lookup' => env('SALE_ORDER_ORACLE_LOOKUP', true),

    // Number series (new rows continue from the highest existing value, or
    // from these when the table is empty). Sample file values were
    // 1000018845 / 1001220009 / 121737330.
    'header_counter_start'  => (int) env('SALE_ORDER_HEADER_COUNTER_START', 1000018845),
    'line_counter_start'    => (int) env('SALE_ORDER_LINE_COUNTER_START', 1001220011),
    'dependent_id_start'    => (int) env('SALE_ORDER_DEPENDENT_ID_START', 121737333),

    // Sale order number  =  prefix + 2-digit year + 6-digit running number,
    // e.g. DO26001314 (sample: DO26001313).
    'code_prefix' => env('SALE_ORDER_CODE_PREFIX', 'DO'),
    'code_start'  => (int) env('SALE_ORDER_CODE_START', 1314),

    // IMPORTSTATUS written on new rows. The sample rows (already imported by
    // the ERP) carry 5; freshly staged rows use this value instead.
    'import_status' => (int) env('SALE_ORDER_IMPORT_STATUS', 0),

    // CRM UOM (Order.OrderDetails.UOM) -> ERP UOM code. Anything else -> default.
    'uom_map' => [
        'meter'  => 'm',
        'meters' => 'm',
        'm'      => 'm',
        'pieces' => 'pcs',
        'piece'  => 'pcs',
        'pcs'    => 'pcs',
        'box'    => 'box',
    ],
    'default_uom' => 'm',

    // ITEMTYPEAFICODE when Oracle lookup finds nothing (sample file: PDF).
    'default_item_type' => env('SALE_ORDER_ITEM_TYPE', 'PDF'),

    'header_defaults' => [
            'DIVISIONCODE' => 102,
            'ALLOWEDDIVISIONS' => '102;',
            'COMPANYCODE' => 100,
            'TAXTEMPLATETEMPLATETYPE' => 1,
            'TAXTEMPLATECODE' => 'D01',
            'TYPEOFINVOICE' => 0,
            'TEMPLATECODE' => 'FDM',
            'SAMPLEDRAWN' => 0,
            'ORDERTYPE' => 1,
            'DOCUMENTTYPETYPE' => '03',
            'INTERCOMPANYREQUIRED' => 0,
            'COUNTERCODE' => 'DOM-PSW',
            'INITIALIZEREQUIRED' => 0,
            'FROMORDERPARTNER' => 0,
            'LIFECYCLECODE' => 'SAL',
            'OPERATION' => 1,
            'DELIVERYPOINTUNIQUEID' => 0,   // NOT NULL in Oracle SALESORDERIBEAN; 0 = no specific delivery point
            'LANGUAGECODE' => 'EN',
            'MARKETCODE' => 'Domestic',
            'GROUPORDERSONSHIPPING' => 0,
            'TERMSOFDELIVERYCODE' => 'C11',
            'TERMSOFSHIPPINGCODE' => '01',
            'TRANSPORTREASONCODE' => 'SAL',
            'AREACODE' => 'TNM',
            'FIRSTCARRIERTYPE' => 2,
            'SECONDCARRIERTYPE' => 2,
            'THIRDCARRIERTYPE' => 2,
            'WAREHOUSECODE' => 'DP07FIN2',
            'RELEASETYPE' => 1,
            'RELEASEPRIORITY' => 5,
            'ORDERCATEGORYCODE' => 'DOM',
            'CURRENCYCODE' => 'INR',
            'ENTRYEXCHANGERATE' => 1.0,
            'PAYMENTMETHODCODE' => 109,
            'PAYMENTCUSTOMERUNIQUEID' => 0,
            'MINAMOUNTACHIEVEMENTINVOICE' => 0.0,
            'BANKBOXBEGIN' => 0,
            'COMPANYBANKBOXBEGIN' => 0,
            'THIRDPARTYBILLING' => 0,
            'COMMISSIONDOCUMENTTYPE' => '05',
            'COMMISSIONLIQUIDATIONTYPE1' => 0,
            'AGENTCREATIONTYPE1' => 0,
            'COMMISSIONLIQUIDATIONTYPE2' => 0,
            'AGENTCREATIONTYPE2' => 0,
            'COMMISSIONLIQUIDATIONTYPE3' => 0,
            'AGENTCREATIONTYPE3' => 0,
            'COMMISSIONLIQUIDATIONTYPE4' => 0,
            'AGENTCREATIONTYPE4' => 0,
            'COMMISSIONLIQUIDATIONTYPE5' => 0,
            'AGENTCREATIONTYPE5' => 0,
            'CURRENTSTATUS' => 1,
            'LINESUSPENDED' => 0,
            'PROGRESSSTATUS' => 0,
            'ORDERSOURCE' => 1,
            'PRINTEDCONFIRMATION' => 0,
            'LINESUNMATCHEDWITHBOX' => 0,
            'TERMSOFLOGCODE' => 'SL',
            'FULLSCREEN' => 0,
            'WSOPERATION' => 1,
            'IMPLASTUPDATEUSER' => 'system',
            'RETRYNR' => 0,
            'NEXTRETRY' => 0,
            'IMPORTID' => 0,
    ],

    'line_defaults' => [
            'ORDERTYPE' => 1,
            'DOCUMENTTYPETYPE' => '03',
            'ORDERSUBLINE' => 0,
            'INITIALIZEREQUIRED' => 0,
            'COMPONENTORDERLINE' => 1,
            'LOADFROMDELIVERYEXECUTED' => 0,
            'FROMORDERPARTNER' => 0,
            'LINETEMPLATECODE' => 'FDM',
            'SAMPLESTYPE' => 0,
            'BOXMANAGED' => 0,
            'OPERATION' => 1,
            'ITEMNATURE' => 1,
            'SUBSTITUTESUBCODESEQUENCE' => 0,
            'OBSOLETEDISCARDEDITEM' => 0,
            'BOXHIDEUOM' => 0,
            'USERSECONDARYUOMCODE' => 'kg',
            'BASESECONDARYUOMCODE' => 'kg',
            'USERPACKAGINGQUANTITY' => 0.0,
            'CANCELLEDUSERPRIMARYQUANTITY' => 0.0,
            'CANCELLEDBASEPRIMARYQUANTITY' => 0.0,
            'CANCELLEDUSERSECONDARYQUANTITY' => 0.0,
            'CANCELLEDBASESECONDARYQUANTITY' => 0.0,
            'CANCELLEDUSERPACKAGINGQUANTITY' => 0.0,
            'ORIGINALUSERPACKAGINGQUANTITY' => 0.0,
            'QUALITYCODE' => 1,
            'LINESTATUS' => 1,
            'PROGRESSSTATUS' => 0,
            'READYTOSHIP' => 0,
            'WAREHOUSECODE' => 'DP07FIN2',
            'UPDATEWAREHOUSEAVAILABILITY' => 1,
            'COST' => 0.0,
            'DISTRIBUTIONWAREHOUSEREQUIRED' => 0,
            'CARRIERTYPE' => 2,
            'RELEASETYPE' => 1,
            'RELEASEPRIORITY' => 5,
            'LEFTOVERLOSS' => 0,
            'CONFIRMEDDELIVERYDATECHANGED' => 0,
            'CONSIGNMENTREQUIRED' => 0,
            'CONSIGNMENTTYPE' => 0,
            'JOINEDORDERLINE' => 0,
            'JOINEDORDERSUBLINE' => 0,
            'JOINEDCOMPONENTORDERLINE' => 0,
            'LINESOURCE' => 1,
            'PREVIOUSORDERLINE' => 0,
            'PREVIOUSORDERSUBLINE' => 0,
            'PREVIOUSCOMPONENTORDERLINE' => 0,
            'PREVIOUSDELIVERYLINE' => 0,
            'ENTRYEXCHANGERATE' => 1.0,
            'PAYMENTMETHODCODE' => 109,
            'PRICELISTCODE' => 'DOMESTIC',
            'PRICETYPE' => 1,
            'PRICESIGN' => 1,
            'PRICEINCLUDINGTAX' => 0,
            'ORIGINALAMOUNT' => 0.0,
            'ONLYBYAMOUNT' => 0,
            'COMMISSIONLIQUIDATIONTYPE1' => 0,
            'AGENTCREATIONTYPE1' => 0,
            'COMMISSIONLIQUIDATIONTYPE2' => 0,
            'AGENTCREATIONTYPE2' => 0,
            'COMMISSIONLIQUIDATIONTYPE3' => 0,
            'AGENTCREATIONTYPE3' => 0,
            'COMMISSIONLIQUIDATIONTYPE4' => 0,
            'AGENTCREATIONTYPE4' => 0,
            'COMMISSIONLIQUIDATIONTYPE5' => 0,
            'AGENTCREATIONTYPE5' => 0,
            'MANUALLYINSERTFORBOX' => 0,
            'TERMSOFLOGCODE' => 'SL',
            'TAXTEMPLATETEMPLATETYPE' => 2,
            'TAXTEMPLATECODE' => 341,
            'PACKINGTYPE' => 0,
            'EXPLOSION' => 1,
            'WSOPERATION' => 1,
            'IMPLASTUPDATEUSER' => 'system',
            'RETRYNR' => 0,
            'NEXTRETRY' => 0,
            'IMPORTID' => 0,
    ],
];
