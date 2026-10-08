<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * ERP staging tables: sale_order_header + sale_order_line
 *
 * Column names/order are copied 1:1 from the client's ERP import file
 * (SOBean.xlsx — sheets "Header" and "Line") so the rows can be handed to
 * the ERP without any renaming or re-mapping.
 *
 *   sale_order_header  = ONE row per customer order (a whole cart).
 *   sale_order_line    = ONE row per product on that order.
 *
 *   LINK:  sale_order_line.FATHERID  =  sale_order_header.RELATEDDEPENDENTID
 *
 * The three CRM-only columns at the end of each table (Id, Crm*) are NOT
 * part of the ERP layout — they tie the staged rows back to Orders /
 * Customers / Products in this app and are left out of the Excel export.
 *
 * The old Products / Orders tables are NOT touched or removed.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('sale_order_header')) {
            Schema::create('sale_order_header', function (Blueprint $table) {
                $table->id('Id');
            $table->bigInteger('IMPORTAUTOCOUNTER')->nullable();
            $table->string('DIVISIONCODE', 50)->nullable();
            $table->string('ALLOWEDDIVISIONS', 50)->nullable();
            $table->string('COMPANYCODE', 50)->nullable();
            $table->integer('TAXTEMPLATETEMPLATETYPE')->nullable();
            $table->string('TAXTEMPLATECODE', 50)->nullable();
            $table->integer('TYPEOFINVOICE')->nullable();
            $table->string('TEMPLATECODE', 50)->nullable();
            $table->integer('SAMPLEDRAWN')->nullable();
            $table->string('PCNUMBER', 50)->nullable();
            $table->integer('ORDERTYPE')->nullable();
            $table->integer('DOCUMENTTYPETYPE')->nullable();
            $table->integer('INTERCOMPANYREQUIRED')->nullable();
            $table->string('INTERCOMPANYCODE', 50)->nullable();
            $table->string('COUNTERCODE', 50)->nullable();
            $table->string('CODE', 50)->nullable();
            $table->decimal('BASICVALUE', 18, 5)->nullable();
            $table->decimal('GROSSVALUE', 18, 5)->nullable();
            $table->decimal('ROUNDOFFVALUE', 18, 5)->nullable();
            $table->decimal('NETTVALUE', 18, 5)->nullable();
            $table->string('ROUNDOFFITAXCODE', 50)->nullable();
            $table->dateTime('ORDERDATE')->nullable();
            $table->string('SOURCEDOCUMENTORDERTYPE', 50)->nullable();
            $table->string('SOURCEDOCUMENTTYPE', 50)->nullable();
            $table->string('ORDPRNCUSTOMERSUPPLIERCODE', 50)->nullable();
            $table->string('SESSIONSTEP', 50)->nullable();
            $table->string('ORDERPARTNERBRANDCODE', 50)->nullable();
            $table->string('DERIVATIONSTEP', 50)->nullable();
            $table->integer('INITIALIZEREQUIRED')->nullable();
            $table->integer('FROMORDERPARTNER')->nullable();
            $table->string('LIFECYCLECODE', 50)->nullable();
            $table->integer('OPERATION')->nullable();
            $table->string('DELIVERYPOINTTYPE', 50)->nullable();
            $table->integer('DELIVERYPOINTUNIQUEID')->nullable();
            $table->string('DELIVERYPOINTCODE', 50)->nullable();
            $table->string('DESCRIPTION', 255)->nullable();
            $table->dateTime('INITIALDATE')->nullable();
            $table->dateTime('FINALDATE')->nullable();
            $table->string('EXTERNALREFERENCE', 100)->nullable();
            $table->dateTime('EXTERNALREFERENCEDATE')->nullable();
            $table->string('INTERNALREFERENCE', 100)->nullable();
            $table->dateTime('INTERNALREFERENCEDATE')->nullable();
            $table->string('STATISTICALGROUPCODE', 50)->nullable();
            $table->string('COLLECTIONGROUPCODE', 50)->nullable();
            $table->string('PROJECTCODE', 50)->nullable();
            $table->string('LANGUAGECODE', 50)->nullable();
            $table->string('MARKETCODE', 50)->nullable();
            $table->integer('GROUPORDERSONSHIPPING')->nullable();
            $table->string('TERMSOFDELIVERYCODE', 50)->nullable();
            $table->string('TERMSOFSHIPPINGCODE', 50)->nullable();
            $table->string('TRANSPORTREASONCODE', 50)->nullable();
            $table->string('AREACODE', 50)->nullable();
            $table->integer('FIRSTCARRIERTYPE')->nullable();
            $table->string('FIRSTCARRIERCODE', 50)->nullable();
            $table->integer('SECONDCARRIERTYPE')->nullable();
            $table->string('SECONDCARRIERCODE', 50)->nullable();
            $table->integer('THIRDCARRIERTYPE')->nullable();
            $table->string('THIRDCARRIERCODE', 50)->nullable();
            $table->string('WAREHOUSECODE', 50)->nullable();
            $table->dateTime('REQUIREDDUEDATE')->nullable();
            $table->dateTime('CONFIRMEDDUEDATE')->nullable();
            $table->integer('RELEASETYPE')->nullable();
            $table->integer('RELEASEPRIORITY')->nullable();
            $table->string('FNCORDPRNCUSTOMERSUPPLIERCODE', 50)->nullable();
            $table->string('ORDERCATEGORYCODE', 50)->nullable();
            $table->string('CURRENCYCODE', 50)->nullable();
            $table->decimal('ENTRYEXCHANGERATE', 18, 5)->nullable();
            $table->dateTime('CONDITIONRETRIEVINGDATE')->nullable();
            $table->string('PRICEANDDISCOUNTDOCUMENTTYPE', 50)->nullable();
            $table->string('PAYMENTMETHODCODE', 50)->nullable();
            $table->string('PRICELISTCODE', 50)->nullable();
            $table->string('DISCOUNTCATEGORYCODE', 50)->nullable();
            $table->string('TAXCODE', 50)->nullable();
            $table->decimal('ONORDERTOTALAMOUNT', 18, 5)->nullable();
            $table->integer('PAYMENTCUSTOMERUNIQUEID')->nullable();
            $table->string('PAYMENTCUSTOMERCODE', 50)->nullable();
            $table->decimal('MINAMOUNTACHIEVEMENTINVOICE', 18, 5)->nullable();
            $table->integer('BANKBOXBEGIN')->nullable();
            $table->string('BANKCODE', 50)->nullable();
            $table->string('BANKBRANCHCODE', 50)->nullable();
            $table->string('BANKEXTERNALCODE', 50)->nullable();
            $table->string('ORDERPARTNERBANKIDENTIFIER', 50)->nullable();
            $table->integer('COMPANYBANKBOXBEGIN')->nullable();
            $table->string('COMPANYBANKCODE', 50)->nullable();
            $table->string('COMPANYBANKBRANCHCODE', 50)->nullable();
            $table->string('COMPANYBANKEXTERNALCODE', 50)->nullable();
            $table->string('COMPANYBANKIDIDENTIFIER', 50)->nullable();
            $table->integer('THIRDPARTYBILLING')->nullable();
            $table->integer('COMMISSIONDOCUMENTTYPE')->nullable();
            $table->string('AGENT1CODE', 50)->nullable();
            $table->integer('COMMISSIONLIQUIDATIONTYPE1')->nullable();
            $table->integer('AGENTCREATIONTYPE1')->nullable();
            $table->string('AGENT2CODE', 50)->nullable();
            $table->integer('COMMISSIONLIQUIDATIONTYPE2')->nullable();
            $table->integer('AGENTCREATIONTYPE2')->nullable();
            $table->string('AGENT3CODE', 50)->nullable();
            $table->integer('COMMISSIONLIQUIDATIONTYPE3')->nullable();
            $table->integer('AGENTCREATIONTYPE3')->nullable();
            $table->string('AGENT4CODE', 50)->nullable();
            $table->integer('COMMISSIONLIQUIDATIONTYPE4')->nullable();
            $table->integer('AGENTCREATIONTYPE4')->nullable();
            $table->string('AGENT5CODE', 50)->nullable();
            $table->integer('COMMISSIONLIQUIDATIONTYPE5')->nullable();
            $table->integer('AGENTCREATIONTYPE5')->nullable();
            $table->integer('CURRENTSTATUS')->nullable();
            $table->integer('LINESUSPENDED')->nullable();
            $table->integer('PROGRESSSTATUS')->nullable();
            $table->integer('ORDERSOURCE')->nullable();
            $table->string('PREVIOUSTEMPLATECODE', 50)->nullable();
            $table->string('PREVIOUSCOUNTERCODE', 50)->nullable();
            $table->string('PREVIOUSCODE', 50)->nullable();
            $table->integer('PRINTEDCONFIRMATION')->nullable();
            $table->integer('LINESUNMATCHEDWITHBOX')->nullable();
            $table->string('TERMSOFLOGCODE', 50)->nullable();
            $table->string('LOGREASONCODE', 50)->nullable();
            $table->string('SCHEMETYPECODE', 50)->nullable();
            $table->string('ALCODE', 50)->nullable();
            $table->dateTime('ALAPPLICATIONDATE')->nullable();
            $table->string('ADVANCELICENSENO', 50)->nullable();
            $table->dateTime('ADVANCELICENSEDATE')->nullable();
            $table->integer('FULLSCREEN')->nullable();
            $table->integer('WSOPERATION')->nullable();
            $table->integer('IMPORTSTATUS')->nullable();
            $table->dateTime('IMPCREATIONDATETIME')->nullable();
            $table->string('IMPCREATIONUSER', 50)->nullable();
            $table->dateTime('IMPLASTUPDATEDATETIME')->nullable();
            $table->string('IMPLASTUPDATEUSER', 50)->nullable();
            $table->dateTime('IMPORTDATETIME')->nullable();
            $table->integer('RETRYNR')->nullable();
            $table->integer('NEXTRETRY')->nullable();
            $table->integer('IMPORTID')->nullable();
            $table->bigInteger('RELATEDDEPENDENTID')->nullable();

                // CRM-only helper columns (not sent to ERP)
                $table->string('CrmGroupRef', 80)->nullable()->index();
                $table->unsignedBigInteger('CrmCustomerId')->nullable()->index();

                $table->unique('RELATEDDEPENDENTID', 'UQ_sale_order_header_reldep');
                $table->unique('CODE', 'UQ_sale_order_header_code');
            });
        }

        if (!Schema::hasTable('sale_order_line')) {
            Schema::create('sale_order_line', function (Blueprint $table) {
                $table->id('Id');
            $table->bigInteger('FATHERID')->nullable();
            $table->bigInteger('IMPORTAUTOCOUNTER')->nullable();
            $table->string('DIVISIONCODE', 50)->nullable();
            $table->string('ALLOWEDDIVISIONS', 50)->nullable();
            $table->integer('ORDERTYPE')->nullable();
            $table->integer('DOCUMENTTYPETYPE')->nullable();
            $table->integer('ORDERLINE')->nullable();
            $table->integer('ORDERSUBLINE')->nullable();
            $table->string('SESSIONSTEP', 50)->nullable();
            $table->string('DERIVATIONSTEP', 50)->nullable();
            $table->integer('INITIALIZEREQUIRED')->nullable();
            $table->integer('COMPONENTORDERLINE')->nullable();
            $table->integer('LOADFROMDELIVERYEXECUTED')->nullable();
            $table->integer('FROMORDERPARTNER')->nullable();
            $table->string('ASSORTMENTNUMBERID', 50)->nullable();
            $table->string('LINETEMPLATECODE', 50)->nullable();
            $table->integer('SAMPLESTYPE')->nullable();
            $table->integer('BOXMANAGED')->nullable();
            $table->integer('OPERATION')->nullable();
            $table->string('EXTERNALREFERENCE', 100)->nullable();
            $table->dateTime('EXTERNALREFERENCEDATE')->nullable();
            $table->string('INTERNALREFERENCE', 100)->nullable();
            $table->dateTime('INTERNALREFERENCEDATE')->nullable();
            $table->string('ITEMTYPEAFICODE', 50)->nullable();
            $table->string('ITEMCODE', 50)->nullable();
            $table->string('ORDERITEMCODE', 50)->nullable();
            $table->integer('ITEMNATURE')->nullable();
            $table->string('SUBCODE01', 50)->nullable();
            $table->string('SUBCODE02', 50)->nullable();
            $table->string('SUBCODE03', 50)->nullable();
            $table->string('SUBCODE04', 50)->nullable();
            $table->string('SUBCODE05', 50)->nullable();
            $table->string('SUBCODE06', 50)->nullable();
            $table->string('SUBCODE07', 50)->nullable();
            $table->string('SUBCODE08', 50)->nullable();
            $table->string('SUBCODE09', 50)->nullable();
            $table->string('SUBCODE10', 50)->nullable();
            $table->integer('SUBSTITUTESUBCODESEQUENCE')->nullable();
            $table->string('AVAILABILITYWAREHOUSECODE', 50)->nullable();
            $table->string('AVAILABILITYWAREHOUSEGROUPCODE', 50)->nullable();
            $table->string('SUBSTITUTECRITERIA', 50)->nullable();
            $table->integer('FULLITEMIDENTIFIER')->nullable();
            $table->integer('SELLINGITEMIDENTIFIER')->nullable();
            $table->string('PRDSERIALNOUSERGENGRPTYPECODE', 50)->nullable();
            $table->string('PRDSERIALNOCODE', 50)->nullable();
            $table->string('EXTERNALITEM', 50)->nullable();
            $table->string('ITEMBARCODE', 50)->nullable();
            $table->string('ITEMDESCRIPTION', 255)->nullable();
            $table->integer('OBSOLETEDISCARDEDITEM')->nullable();
            $table->integer('BOXHIDEUOM')->nullable();
            $table->string('USERPRIMARYUOMCODE', 50)->nullable();
            $table->decimal('USERPRIMARYQUANTITY', 18, 5)->nullable();
            $table->string('BASEPRIMARYUOMCODE', 50)->nullable();
            $table->decimal('BASEPRIMARYQUANTITY', 18, 5)->nullable();
            $table->string('USERSECONDARYUOMCODE', 50)->nullable();
            $table->decimal('USERSECONDARYQUANTITY', 18, 5)->nullable();
            $table->string('BASESECONDARYUOMCODE', 50)->nullable();
            $table->decimal('BASESECONDARYQUANTITY', 18, 5)->nullable();
            $table->string('USERPACKAGINGUOMCODE', 50)->nullable();
            $table->decimal('USERPACKAGINGQUANTITY', 18, 5)->nullable();
            $table->decimal('CANCELLEDUSERPRIMARYQUANTITY', 18, 5)->nullable();
            $table->decimal('CANCELLEDBASEPRIMARYQUANTITY', 18, 5)->nullable();
            $table->decimal('CANCELLEDUSERSECONDARYQUANTITY', 18, 5)->nullable();
            $table->decimal('CANCELLEDBASESECONDARYQUANTITY', 18, 5)->nullable();
            $table->decimal('CANCELLEDUSERPACKAGINGQUANTITY', 18, 5)->nullable();
            $table->decimal('ORIGINALUSERPRIMARYQUANTITY', 18, 5)->nullable();
            $table->decimal('ORIGINALUSERSECONDARYQUANTITY', 18, 5)->nullable();
            $table->decimal('ORIGINALUSERPACKAGINGQUANTITY', 18, 5)->nullable();
            $table->string('SUBCODE01DESCRIPTION', 255)->nullable();
            $table->string('SUBCODE02DESCRIPTION', 255)->nullable();
            $table->string('SUBCODE03DESCRIPTION', 255)->nullable();
            $table->string('SUBCODE04DESCRIPTION', 255)->nullable();
            $table->string('SUBCODE05DESCRIPTION', 255)->nullable();
            $table->string('SUBCODE06DESCRIPTION', 255)->nullable();
            $table->string('SUBCODE07DESCRIPTION', 255)->nullable();
            $table->string('SUBCODE08DESCRIPTION', 255)->nullable();
            $table->string('SUBCODE09DESCRIPTION', 255)->nullable();
            $table->string('SUBCODE10DESCRIPTION', 255)->nullable();
            $table->string('QUALITYCODE', 50)->nullable();
            $table->integer('LINESTATUS')->nullable();
            $table->integer('PROGRESSSTATUS')->nullable();
            $table->integer('READYTOSHIP')->nullable();
            $table->string('RELATEDENTITYSTATUS', 50)->nullable();
            $table->string('STATISTICALGROUPCODE', 50)->nullable();
            $table->string('COLLECTIONGROUPCODE', 50)->nullable();
            $table->string('PROJECTCODE', 50)->nullable();
            $table->string('LINEGROUP', 50)->nullable();
            $table->string('WAREHOUSECODE', 50)->nullable();
            $table->integer('UPDATEWAREHOUSEAVAILABILITY')->nullable();
            $table->decimal('COST', 18, 5)->nullable();
            $table->string('COSTCENTERCODE', 50)->nullable();
            $table->integer('DISTRIBUTIONWAREHOUSEREQUIRED')->nullable();
            $table->integer('CARRIERTYPE')->nullable();
            $table->string('FIRSTCARRIERCODE', 50)->nullable();
            $table->integer('RELEASETYPE')->nullable();
            $table->integer('RELEASEPRIORITY')->nullable();
            $table->integer('LEFTOVERLOSS')->nullable();
            $table->dateTime('CONFIRMEDDELIVERYDATE')->nullable();
            $table->integer('CONFIRMEDDELIVERYDATECHANGED')->nullable();
            $table->dateTime('REQUIREDDUEDATE')->nullable();
            $table->integer('CONSIGNMENTREQUIRED')->nullable();
            $table->integer('CONSIGNMENTTYPE')->nullable();
            $table->string('CONSIGNMENTWAREHOUSECODE', 50)->nullable();
            $table->integer('JOINEDORDERLINE')->nullable();
            $table->integer('JOINEDORDERSUBLINE')->nullable();
            $table->integer('JOINEDCOMPONENTORDERLINE')->nullable();
            $table->integer('LINESOURCE')->nullable();
            $table->string('PREVIOUSLINETEMPLATECODE', 50)->nullable();
            $table->string('PREVIOUSCOUNTERCODE', 50)->nullable();
            $table->string('PREVIOUSDOCUMENTTYPEORDERTYPE', 50)->nullable();
            $table->string('PREVIOUSDOCUMENTTYPETYPE', 50)->nullable();
            $table->string('PREVIOUSCODE', 50)->nullable();
            $table->integer('PREVIOUSORDERLINE')->nullable();
            $table->integer('PREVIOUSORDERSUBLINE')->nullable();
            $table->integer('PREVIOUSCOMPONENTORDERLINE')->nullable();
            $table->string('INTERCOMPANYCODE', 50)->nullable();
            $table->integer('PREVIOUSDELIVERYLINE')->nullable();
            $table->decimal('ENTRYEXCHANGERATE', 18, 5)->nullable();
            $table->dateTime('CONDITIONRETRIEVINGDATE')->nullable();
            $table->string('PAYMENTMETHODCODE', 50)->nullable();
            $table->string('PRICELISTCODE', 50)->nullable();
            $table->string('DISCOUNTCATEGORYCODE', 50)->nullable();
            $table->decimal('LINEUSERVALUE', 18, 5)->nullable();
            $table->string('PRICEUNITOFMEASURECODE', 50)->nullable();
            $table->decimal('PRICE', 18, 5)->nullable();
            $table->integer('PRICETYPE')->nullable();
            $table->integer('PRICESIGN')->nullable();
            $table->integer('PRICEINCLUDINGTAX')->nullable();
            $table->decimal('PRICERETRIEVED', 18, 5)->nullable();
            $table->decimal('ORIGINALAMOUNT', 18, 5)->nullable();
            $table->decimal('NETVALUE', 18, 5)->nullable();
            $table->string('TAXCODE', 50)->nullable();
            $table->string('FREEGIFTTAXDEBIT', 50)->nullable();
            $table->decimal('TAXABLEINCOMEVALUE', 18, 5)->nullable();
            $table->decimal('NETVALUEINCLUDINGTAX', 18, 5)->nullable();
            $table->integer('ONLYBYAMOUNT')->nullable();
            $table->string('AGENT1CODE', 50)->nullable();
            $table->integer('COMMISSIONLIQUIDATIONTYPE1')->nullable();
            $table->integer('AGENTCREATIONTYPE1')->nullable();
            $table->string('AGENT2CODE', 50)->nullable();
            $table->integer('COMMISSIONLIQUIDATIONTYPE2')->nullable();
            $table->integer('AGENTCREATIONTYPE2')->nullable();
            $table->string('AGENT3CODE', 50)->nullable();
            $table->integer('COMMISSIONLIQUIDATIONTYPE3')->nullable();
            $table->integer('AGENTCREATIONTYPE3')->nullable();
            $table->string('AGENT4CODE', 50)->nullable();
            $table->integer('COMMISSIONLIQUIDATIONTYPE4')->nullable();
            $table->integer('AGENTCREATIONTYPE4')->nullable();
            $table->string('AGENT5CODE', 50)->nullable();
            $table->integer('COMMISSIONLIQUIDATIONTYPE5')->nullable();
            $table->integer('AGENTCREATIONTYPE5')->nullable();
            $table->integer('MANUALLYINSERTFORBOX')->nullable();
            $table->string('SDICOMPANYCODE', 50)->nullable();
            $table->string('TERMSOFLOGCODE', 50)->nullable();
            $table->string('LOGREASONCODE', 50)->nullable();
            $table->string('INVOICEIMAGE', 255)->nullable();
            $table->integer('TAXTEMPLATETEMPLATETYPE')->nullable();
            $table->string('TAXTEMPLATECODE', 50)->nullable();
            $table->string('SHIPMENTARTICLECODE', 50)->nullable();
            $table->string('SCHEMECODE', 50)->nullable();
            $table->string('AGAINSTFORM', 50)->nullable();
            $table->string('FORMCODE', 50)->nullable();
            $table->string('IPPOLICYNO', 50)->nullable();
            $table->dateTime('IPPOLICYDATE')->nullable();
            $table->dateTime('POLICYEXPIRYDATE')->nullable();
            $table->string('INSURANCECOMPANY', 50)->nullable();
            $table->decimal('POLICYPREMIUMRATE', 18, 5)->nullable();
            $table->decimal('CUSTOMERPREMIUMRATE', 18, 5)->nullable();
            $table->decimal('INSURANCEMARKUP', 18, 5)->nullable();
            $table->decimal('ARTICLERATE1', 18, 5)->nullable();
            $table->decimal('ARTICLERATE2', 18, 5)->nullable();
            $table->decimal('ARTICLERATE3', 18, 5)->nullable();
            $table->decimal('JOBRATE1', 18, 5)->nullable();
            $table->decimal('JOBRATE2', 18, 5)->nullable();
            $table->decimal('BASICVALUE', 18, 5)->nullable();
            $table->decimal('GROSSVALUEEXT', 18, 5)->nullable();
            $table->decimal('GROSSVALUEWOHEADER', 18, 5)->nullable();
            $table->string('PACKINGGROUP', 50)->nullable();
            $table->integer('PACKINGTYPE')->nullable();
            $table->integer('EXPLOSION')->nullable();
            $table->string('ORDERSUBCODE01', 50)->nullable();
            $table->string('ORDERSUBCODE02', 50)->nullable();
            $table->string('ORDERSUBCODE03', 50)->nullable();
            $table->string('ORDERSUBCODE04', 50)->nullable();
            $table->string('ORDERSUBCODE05', 50)->nullable();
            $table->string('ORDERSUBCODE06', 50)->nullable();
            $table->string('ORDERSUBCODE07', 50)->nullable();
            $table->string('ORDERSUBCODE08', 50)->nullable();
            $table->string('ORDERSUBCODE09', 50)->nullable();
            $table->string('ORDERSUBCODE10', 50)->nullable();
            $table->integer('WSOPERATION')->nullable();
            $table->integer('IMPORTSTATUS')->nullable();
            $table->dateTime('IMPCREATIONDATETIME')->nullable();
            $table->string('IMPCREATIONUSER', 50)->nullable();
            $table->dateTime('IMPLASTUPDATEDATETIME')->nullable();
            $table->string('IMPLASTUPDATEUSER', 50)->nullable();
            $table->dateTime('IMPORTDATETIME')->nullable();
            $table->integer('RETRYNR')->nullable();
            $table->integer('NEXTRETRY')->nullable();
            $table->integer('IMPORTID')->nullable();
            $table->bigInteger('RELATEDDEPENDENTID')->nullable();

                // CRM-only helper columns (not sent to ERP)
                $table->unsignedBigInteger('CrmOrderId')->nullable()->index();
                $table->unsignedBigInteger('CrmProductId')->nullable();

                $table->index('FATHERID', 'IX_sale_order_line_fatherid');
                $table->unique('RELATEDDEPENDENTID', 'UQ_sale_order_line_reldep');
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('sale_order_line');
        Schema::dropIfExists('sale_order_header');
    }
};
