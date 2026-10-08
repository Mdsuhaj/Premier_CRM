// src/pages/reports/AgeingReportPage.jsx
//
// Report 5 of 6. Ageing of overdue balances, filterable by Customer,
// Product Name, and Product Type — bucketed into Below 2 / 2–5 / 5–10 /
// 10–30 / More than 30 days, with a Total row. Same /credit-limit data
// as the Overdue Report.
//
// CHANGES IN THIS VERSION:
//  - Cancelling an overdue order now hands it off to the Sales Loss
//    Report: real orders get flagged "declined" on the server (same as
//    before, so /orders already reflects it there), and the demo/dummy
//    rows are written to a small shared localStorage list that the
//    Sales Loss Report reads on load and folds into its own "cancelled
//    orders" total — so a cancelled ageing row now shows up as lost
//    sales instead of just disappearing.
//  - Removed the bottom "Cancel" / reset-filters confirmation control.
import { useEffect, useMemo, useState } from "react";
import { useTheme } from "../../ThemeContext";
import Layout from "../../components/Layout";
import { getG } from "../../theme";
import API from "../../services/api";
import { exportReportToExcel } from "../../utils/excelIO";
import {
  FONT, ExportButton,
  cardStyle, errorBoxStyle, statCardStyle, todayStamp, fmtAmt,
} from "./shared";

const AGEING_BUCKETS = [
  { key: "lt2", label: "Below 2 days", test: (d) => d < 2 },
  { key: "2-5", label: "2–5 days", test: (d) => d >= 2 && d <= 5 },
  { key: "5-10", label: "5–10 days", test: (d) => d > 5 && d <= 10 },
  { key: "10-30", label: "10–30 days", test: (d) => d > 10 && d <= 30 },
  { key: "30+", label: "More than 30 days", test: (d) => d > 30 },
];
const bucketFor = (days) => AGEING_BUCKETS.find((b) => b.test(days))?.label || "—";
const bucketAccent = {
  "Below 2 days": "#2E7A72", "2–5 days": "#5B9BD9", "5–10 days": "#8A5A0E",
  "10–30 days": "#D69426", "More than 30 days": "#B23A3A",
};

// Falls back through possible spellings for a field that isn't Sort
// No / Shade No (e.g. Qty), where the real backend name is still tbd.
const pick = (obj, ...keys) => {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  }
  return "—";
};

// Shared handoff to the Sales Loss Report for demo/dummy rows, which
// don't exist on the server and so would otherwise vanish on cancel
// instead of showing up as a lost sale. Real orders don't need this —
// they're flagged "declined" on the server instead, and the Sales Loss
// Report already picks those up from /orders.
const DUMMY_SALES_LOSS_KEY = "dummySalesLossOrders";
function sendDummyOrderToSalesLoss(order) {
  try {
    const existing = JSON.parse(localStorage.getItem(DUMMY_SALES_LOSS_KEY) || "[]");
    existing.push({
      code: order.code,
      sortNo: order.sortNo,
      shadeNo: order.shadeNo,
      productName: order.product,
      customer: order.customer,
      qty: order.qty,
      value: order.balanceDue,
      createdAt: new Date().toISOString(),
    });
    localStorage.setItem(DUMMY_SALES_LOSS_KEY, JSON.stringify(existing));
  } catch {
    // localStorage unavailable — nothing else to do here.
  }
}

// --- Temporary demo/dummy data -----------------------------------------
// Remove this block (or set to []) once real overdue data is enough to
// demo the report in every environment.
const DUMMY_AGEING_ROWS = [
  { customer: "Sample Textiles Pvt Ltd", code: "ORD-D001", sortNo: "1471", shadeNo: "SH-204", qty: 120, balanceDue: 45200, daysOverdue: 1, product: "Cotton Yarn 40s", productType: "Yarn" },
  { customer: "Sample Textiles Pvt Ltd", code: "ORD-D002", sortNo: "1472", shadeNo: "SH-118", qty: 60, balanceDue: 18750, daysOverdue: 4, product: "Poly Blend Fabric", productType: "Fabric" },
  { customer: "Northline Apparel", code: "ORD-D003", sortNo: "1473", shadeNo: "SH-091", qty: 200, balanceDue: 92300, daysOverdue: 8, product: "Denim Roll 14oz", productType: "Fabric" },
  { customer: "Northline Apparel", code: "ORD-D004", sortNo: "1474", shadeNo: "SH-045", qty: 35, balanceDue: 12600, daysOverdue: 22, product: "Cotton Yarn 30s", productType: "Yarn" },
  { customer: "Vantage Garments", code: "ORD-D005", sortNo: "1475", shadeNo: "SH-302", qty: 500, balanceDue: 210000, daysOverdue: 38, product: "Grey Fabric", productType: "Fabric" },
];

const AGEING_COLUMNS = [
  { key: "SNo", header: "S.No" }, { key: "SortNo", header: "Sort No" },
  { key: "ShadeNo", header: "Shade No" }, { key: "Code", header: "Order No" },
  { key: "ProductType", header: "Product Type" }, { key: "Qty", header: "Qty" },
  { key: "DaysOverdue", header: "Days Overdue" }, { key: "Bucket", header: "Ageing Bucket" },
  { key: "Total", header: "Total" },
];

export default function AgeingReportPage() {
  const { isDark } = useTheme();
  const themeG = getG(isDark);
  const [rows, setRows] = useState([]);
  const [dummyRows, setDummyRows] = useState(DUMMY_AGEING_ROWS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rowNotice, setRowNotice] = useState("");

  const [customerFilter, setCustomerFilter] = useState("All");
  const [productFilter, setProductFilter] = useState("All");
  const [typeFilter, setTypeFilter] = useState("All");
  const [bucketFilter, setBucketFilter] = useState("All");   // NEW
  const [search, setSearch] = useState("");
  const [confirmingCode, setConfirmingCode] = useState(null);
  const [cancellingCode, setCancellingCode] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await API.get("/credit-limit");
        setRows(res.data || []);
      } catch {
        setError("Failed to load ageing report data.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const allFlatOrders = useMemo(() => {
    const out = [];
    rows.forEach((r) =>
      (r.orders || []).forEach((o) => {
        if (o.daysOverdue >= 1) {
          out.push({
            customer: r.customerName,
            code: o.code,
            // Sort No / Shade No are product-level fields — read them
            // off the order's product record, same as ProductCatalog.jsx.
            sortNo: o.product?.Code ?? o.Code ?? "—",
            shadeNo: o.product?.ShadeNo ?? o.ShadeNo ?? "—",
            qty: pick(o, "qty", "Qty", "quantity", "Quantity"),
            balanceDue: o.balanceDue,
            paymentDueDate: o.paymentDueDate,
            daysOverdue: o.daysOverdue,
            bucket: bucketFor(o.daysOverdue),
            product: o.product?.Name || o.productName || o.code,
            productType: o.product?.SubType || o.product?.Type || o.productType || "—",
            isDummy: false,
          });
        }
      })
    );
    dummyRows.forEach((o) => {
      out.push({
        customer: o.customer,
        code: o.code,
        sortNo: o.sortNo,
        shadeNo: o.shadeNo,
        qty: o.qty,
        balanceDue: o.balanceDue,
        daysOverdue: o.daysOverdue,
        bucket: bucketFor(o.daysOverdue),
        product: o.product,
        productType: o.productType,
        isDummy: true,
      });
    });
    return out.sort((a, b) => b.daysOverdue - a.daysOverdue);
  }, [rows, dummyRows]);

  const customerOptions = useMemo(
    () => ["All", ...Array.from(new Set(allFlatOrders.map((o) => o.customer).filter(Boolean))).sort()],
    [allFlatOrders]
  );
  const productOptions = useMemo(
    () => ["All", ...Array.from(new Set(allFlatOrders.map((o) => o.product).filter(Boolean))).sort()],
    [allFlatOrders]
  );
  const typeOptions = useMemo(
    () => ["All", ...Array.from(new Set(allFlatOrders.map((o) => o.productType).filter(Boolean))).sort()],
    [allFlatOrders]
  );
  const bucketOptions = ["All", ...AGEING_BUCKETS.map((b) => b.label)];

  const flatOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allFlatOrders
      .filter((o) => customerFilter === "All" || o.customer === customerFilter)
      .filter((o) => productFilter === "All" || o.product === productFilter)
      .filter((o) => typeFilter === "All" || o.productType === typeFilter)
      .filter((o) => bucketFilter === "All" || o.bucket === bucketFilter)   // NEW
      .filter((o) => {
        if (!q) return true;
        return [o.customer, o.code, o.product, o.productType, o.sortNo, o.shadeNo]
          .some((v) => String(v ?? "").toLowerCase().includes(q));
      });
  }, [allFlatOrders, customerFilter, productFilter, typeFilter, bucketFilter, search]);

  const bucketCounts = AGEING_BUCKETS.reduce((acc, b) => {
    acc[b.label] = flatOrders.filter((o) => o.bucket === b.label).length;
    return acc;
  }, {});
  const bucketValue = AGEING_BUCKETS.reduce((acc, b) => {
    acc[b.label] = flatOrders.filter((o) => o.bucket === b.label).reduce((s, o) => s + (o.balanceDue || 0), 0);
    return acc;
  }, {});
  const totalCount = flatOrders.length;
  const totalValue = flatOrders.reduce((s, o) => s + (o.balanceDue || 0), 0);

  const statCards = [
    { label: "Overdue Orders", value: totalCount, accent: themeG.accent },
    { label: "Below 2 Days", value: bucketCounts["Below 2 days"] || 0, accent: "#2E7A72" },
    { label: "More Than 30 Days", value: bucketCounts["More than 30 days"] || 0, accent: "#B23A3A" },
    { label: "Total Value Overdue", value: fmtAmt(totalValue), accent: "#8A5A0E" },
  ];

  // Cancels an overdue order and sends it to the Sales Loss Report:
  //  - real orders are marked declined on the server (so it will surface
  //    there via /orders), then dropped from this view.
  //  - dummy rows don't exist on the server, so they're written straight
  //    into the shared localStorage list the Sales Loss Report reads on
  //    load, then dropped from this view.
  const cancelOrder = async (order) => {
    setConfirmingCode(null);
    setCancellingCode(order.code);
    setRowNotice("");
    if (order.isDummy) {
      sendDummyOrderToSalesLoss(order);
      setDummyRows((prev) => prev.filter((o) => o.code !== order.code));
      setCancellingCode(null);
      return;
    }
    try {
      // ASSUMPTION: adjust this route/payload to match your backend.
      await API.patch(`/orders/${order.code}/status`, { status: "declined" });
      setRows((prev) =>
        prev.map((r) =>
          r.customerName === order.customer
            ? { ...r, orders: (r.orders || []).filter((o) => o.code !== order.code) }
            : r
        )
      );
    } catch {
      setRowNotice(`Could not reach the server to cancel ${order.code}. It has not been removed — please try again.`);
    } finally {
      setCancellingCode(null);
    }
  };

  const exportExcel = () => {
    exportReportToExcel({
      reportTitle: "Ageing Report",
      filename: `ageing-report-${todayStamp()}`,
      stats: statCards.map(({ label, value }) => ({ label, value })),
      breakdowns: [
        { title: "Orders by Ageing Bucket", items: [...AGEING_BUCKETS.map((b) => ({ label: b.label, value: bucketCounts[b.label] || 0 })), { label: "Total", value: totalCount }] },
        { title: "Value by Ageing Bucket", items: [...AGEING_BUCKETS.map((b) => ({ label: b.label, value: fmtAmt(bucketValue[b.label] || 0) })), { label: "Total", value: fmtAmt(totalValue) }] },
      ],
      tables: [
        {
          title: "Overdue Orders — Ageing Detail",
          columns: AGEING_COLUMNS,
          rows: flatOrders.map((o, i) => ({
            SNo: i + 1, SortNo: o.sortNo, ShadeNo: o.shadeNo, Code: o.code,
            ProductType: o.productType, Qty: o.qty, DaysOverdue: o.daysOverdue,
            Bucket: o.bucket, Total: fmtAmt(o.balanceDue),
          })),
        },
      ],
    });
  };

  const card = cardStyle(themeG);
  // Navy header / white text, sticky within its own scroll container —
  // matches ProductCatalog.jsx's table header treatment.
  const th = { textAlign: "left", fontSize: 11, color: "#FFFFFF", padding: "10px 12px", background: "#1F3A63", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, position: "sticky", top: 0, zIndex: 1 };
  const td = { padding: "10px 12px", fontSize: 13, color: themeG.textMain };
  const filterSelect = { padding: "9px 12px", borderRadius: 9, border: `1px solid ${themeG.border}`, fontSize: 13, fontFamily: FONT, color: themeG.textMain, background: themeG.card, outline: "none", minWidth: 160 };
  const filterLabel = { fontSize: 11, fontWeight: 700, color: themeG.textLabel, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6, display: "block" };
  const searchInput = { padding: "9px 12px", borderRadius: 9, border: `1px solid ${themeG.border}`, fontSize: 13, fontFamily: FONT, color: themeG.textMain, background: themeG.card, outline: "none", minWidth: 240 };
  const cancelBtn = { padding: "6px 12px", borderRadius: 7, border: "1px solid #B23A3A", background: "transparent", color: "#B23A3A", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: FONT };
  // Detail table shows ~10 rows before it scrolls internally.
  const tableScroll = { maxHeight: 460, overflowY: "auto", overflowX: "auto" };

  return (
    <Layout pageTitle="Ageing Report">

      {loading ? (
        <p style={{ color: themeG.textSub, fontFamily: FONT }}>Loading report…</p>
      ) : (
        <>
          {error && <div style={errorBoxStyle}>{error}</div>}
          {rowNotice && <div style={errorBoxStyle}>{rowNotice}</div>}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 16, marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div>
                <label style={filterLabel}>Search</label>
                <input
                  style={searchInput}
                  placeholder="Customer, order no, product, sort no, shade no…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div>
                <label style={filterLabel}>Customer Name</label>
                <select style={filterSelect} value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)}>
                  {customerOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label style={filterLabel}>Product Name</label>
                <select style={filterSelect} value={productFilter} onChange={(e) => setProductFilter(e.target.value)}>
                  {productOptions.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label style={filterLabel}>Product Type</label>
                <select style={filterSelect} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                  {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label style={filterLabel}>Ageing Bucket</label>
                <select style={filterSelect} value={bucketFilter} onChange={(e) => setBucketFilter(e.target.value)}>
                  {bucketOptions.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
            </div>
            <ExportButton onClick={exportExcel} disabled={flatOrders.length === 0} themeG={themeG} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
            {statCards.map((c) => (
              <div key={c.label} style={statCardStyle(themeG)}>
                <p style={{ fontSize: 12, color: themeG.textLabel, margin: "0 0 6px", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: FONT }}>{c.label}</p>
                <p style={{ fontSize: 22, fontWeight: 700, margin: 0, color: c.accent, fontFamily: "'Space Grotesk', " + FONT }}>{c.value}</p>
              </div>
            ))}
          </div>

          {/* ── Detail table, then Ageing Buckets below it ── */}
          <div style={card}>
            {flatOrders.length === 0 ? (
              <p style={{ fontSize: 13, color: themeG.textSub, margin: 0 }}>Nothing overdue right now. 🎉</p>
            ) : (
              <div style={tableScroll}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
                  <thead>
                    <tr>
                      {["S.No", "Sort No", "Shade", "Enquiry No", "Customer", "Product Type", "Qty", "Days Overdue", "Bucket", "Total", "Action"].map((h) => (
                        <th key={h} style={th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {flatOrders.map((o, i) => (
                      <tr key={o.code + i} style={{ borderBottom: "1px solid rgba(46,122,114,0.08)" }}>
                        <td style={td}>{i + 1}</td>
                        <td style={td}>{o.sortNo}</td>
                        <td style={td}>{o.shadeNo}</td>
                        <td style={td}>{o.code}</td>
                        <td style={td}>{o.customer}</td>
                        <td style={td}>{o.productType}</td>
                        <td style={td}>{o.qty}</td>
                        <td style={td}>{o.daysOverdue}</td>
                        <td style={{ ...td, fontWeight: 700, color: bucketAccent[o.bucket] || themeG.textMain }}>{o.bucket}</td>
                        <td style={{ ...td, fontWeight: 700, color: "#B23A3A" }}>{fmtAmt(o.balanceDue)}</td>
                        <td style={td}>
                          {confirmingCode === o.code ? (
                            <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                              <button
                                onClick={() => cancelOrder(o)}
                                disabled={cancellingCode === o.code}
                                style={{ ...cancelBtn, background: "#B23A3A", color: "#fff" }}
                              >
                                {cancellingCode === o.code ? "…" : "Confirm"}
                              </button>
                              <button onClick={() => setConfirmingCode(null)} style={{ ...cancelBtn, borderColor: themeG.border, color: themeG.textMain }}>
                                Back
                              </button>
                            </span>
                          ) : (
                            <button onClick={() => setConfirmingCode(o.code)} style={cancelBtn}>
                              Cancel
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div style={{ ...card, marginTop: 24 }}>
            <p style={{ fontSize: 14, fontWeight: 700, color: themeG.textMain, margin: "0 0 14px", fontFamily: FONT }}>Ageing Buckets</p>
            {flatOrders.length === 0 ? (
              <p style={{ fontSize: 13, color: themeG.textSub, margin: 0 }}>No overdue orders match the current filters.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>{["Bucket", "Orders", "Value"].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {AGEING_BUCKETS.map((b) => (
                    <tr key={b.key} style={{ borderBottom: "1px solid rgba(46,122,114,0.08)" }}>
                      <td style={{ ...td, fontWeight: 700, color: bucketAccent[b.label] }}>{b.label}</td>
                      <td style={td}>{bucketCounts[b.label] || 0}</td>
                      <td style={td}>{fmtAmt(bucketValue[b.label] || 0)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: `2px solid ${themeG.border}` }}>
                    <td style={{ ...td, fontWeight: 800 }}>Total</td>
                    <td style={{ ...td, fontWeight: 800 }}>{totalCount}</td>
                    <td style={{ ...td, fontWeight: 800 }}>{fmtAmt(totalValue)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </>
      )}
    </Layout>
  );
}