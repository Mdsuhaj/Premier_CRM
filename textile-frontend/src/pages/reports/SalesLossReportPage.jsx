// src/pages/reports/SalesLossReportPage.jsx
//
// Report 6 of 6. Monthly-wise breakdown of sales lost to declined /
// rejected / sale-loss orders, filterable by product, with a grand total row.
//
// - Only real orders from /orders are used (no dummy/demo rows).
// - Sort No is taken from the start of the product name
//   (e.g. "1155 - Lovely Lady NORMAL BLACK" -> 1155). If the name doesn't
//   start with a number, it falls back to the saved SortNo.
// - Shade No comes from the order's saved ShadeNo / the product's ShadeNo.
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

const SALES_LOSS_COLUMNS = [
  { key: "Month", header: "Month" }, { key: "CancelledOrders", header: "Cancelled Orders" },
  { key: "ValueLost", header: "Value Lost" },
];

const SALES_LOSS_DETAIL_COLUMNS = [
  { key: "SNo", header: "S.No" }, { key: "SortNo", header: "Sort No" },
  { key: "ShadeNo", header: "Shade No" }, { key: "Code", header: "Order No" },
  { key: "ProductName", header: "Product Name" }, { key: "Customer", header: "Customer" },
  { key: "Qty", header: "Qty" }, { key: "Month", header: "Month" },
  { key: "ValueLost", header: "Value Lost" },
];

const CANCELLED_STATUSES = ["sale_loss"];

// Product name as saved on the order / product.
const productNameOf = (o) => o.product?.Name || o.OrderDetails?.ProductName || "";

// Sort No = leading number in the product name ("1155 - Lovely Lady ..." -> "1155").
const sortNoOf = (o) => {
  const m = productNameOf(o).match(/^\s*(\d[\w.]*)/);
  return m ? m[1] : (o.OrderDetails?.SortNo || o.product?.SortNo || "—");
};

const shadeNoOf = (o) => o.OrderDetails?.ShadeNo || o.product?.ShadeNo || "—";
const qtyOf   = (o) => parseFloat(o.Quantity ?? o.qty ?? o.Qty ?? o.quantity) || 0;
const priceOf = (o) => parseFloat(o.product?.Price) || parseFloat(o.PricePerUnit) || 0;
const valueOf = (o) => priceOf(o) * qtyOf(o);

// Falls back through possible spellings for a field (e.g. Qty).
const pick = (obj, ...keys) => {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  }
  return "—";
};

function monthKey(dateStr) {
  const d = dateStr ? new Date(dateStr) : null;
  if (!d || isNaN(d.getTime())) return "Unknown";
  return d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}
function monthSortValue(dateStr) {
  const d = dateStr ? new Date(dateStr) : null;
  return d && !isNaN(d.getTime()) ? d.getFullYear() * 12 + d.getMonth() : -1;
}
// Full-precision timestamp, so the newest rows appear first in the detail table.
function dateSortValue(dateStr) {
  const d = dateStr ? new Date(dateStr) : null;
  return d && !isNaN(d.getTime()) ? d.getTime() : -Infinity;
}

export default function SalesLossReportPage() {
  const { isDark } = useTheme();
  const themeG = getG(isDark);
  const [allOrders, setAllOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [productFilter, setProductFilter] = useState("All");
  const [monthFilter, setMonthFilter] = useState("All");
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await API.get("/orders");
        setAllOrders(res.data || []);
      } catch {
        setError("Failed to load sales loss report data.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const allLost = useMemo(
    () => allOrders.filter((o) => CANCELLED_STATUSES.includes((o.Status || "").toLowerCase())),
    [allOrders]
  );

  const productOptions = useMemo(
    () => ["All", ...Array.from(new Set(allLost.map((o) => productNameOf(o)).filter(Boolean))).sort()],
    [allLost]
  );

  const monthOptions = useMemo(() => {
    const seen = new Map();
    allLost.forEach((o) => {
      const key = monthKey(o.CreatedAt);
      if (!seen.has(key)) seen.set(key, monthSortValue(o.CreatedAt));
    });
    const months = Array.from(seen.entries()).sort((a, b) => a[1] - b[1]).map(([m]) => m);
    return ["All", ...months];
  }, [allLost]);

  const lost = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allLost
      .filter((o) => productFilter === "All" || productNameOf(o) === productFilter)
      .filter((o) => monthFilter === "All" || monthKey(o.CreatedAt) === monthFilter)
      .filter((o) => {
        if (!q) return true;
        return [o.Code, productNameOf(o), o.customer?.Name, sortNoOf(o), shadeNoOf(o)]
          .some((v) => String(v ?? "").toLowerCase().includes(q));
      });
  }, [allLost, productFilter, monthFilter, search]);

  const totalValueLost = lost.reduce((s, o) => s + valueOf(o), 0);
  const avgValueLost = lost.length ? totalValueLost / lost.length : 0;
  const uniqueCustomers = new Set(lost.map((o) => o.customer?.Name).filter(Boolean)).size;

  // Monthly breakdown, oldest → newest.
  const monthly = useMemo(() => {
    const map = {};
    lost.forEach((o) => {
      const key = monthKey(o.CreatedAt);
      if (!map[key]) map[key] = { month: key, count: 0, value: 0, sortKey: monthSortValue(o.CreatedAt) };
      map[key].count += 1;
      map[key].value += valueOf(o);
    });
    return Object.values(map).sort((a, b) => a.sortKey - b.sortKey);
  }, [lost]);

  // Per-order detail rows, newest first.
  const detailRows = useMemo(
    () =>
      lost
        .slice()
        .sort((a, b) => dateSortValue(b.CreatedAt) - dateSortValue(a.CreatedAt))
        .map((o) => ({
          code: o.Code,
          sortNo: sortNoOf(o),
          shadeNo: shadeNoOf(o),
          qty: pick(o, "qty", "Qty", "quantity", "Quantity"),
          productName: productNameOf(o) || "—",
          customer: o.customer?.Name || "—",
          month: monthKey(o.CreatedAt),
          value: valueOf(o),
        })),
    [lost]
  );

  const statCards = [
    { label: "Cancelled Orders", value: lost.length, accent: "#B23A3A" },
    { label: "Total Value Lost", value: fmtAmt(totalValueLost), accent: "#B23A3A" },
    { label: "Avg Value Lost", value: fmtAmt(avgValueLost), accent: "#8A5A0E" },
    { label: "Customers Affected", value: uniqueCustomers, accent: themeG.accent },
  ];

  const exportExcel = () => {
    exportReportToExcel({
      reportTitle: "Sales Loss Report",
      filename: `sales-loss-report-${todayStamp()}`,
      stats: statCards.map(({ label, value }) => ({ label, value })),
      breakdowns: [
        { title: "Cancelled Orders by Month", items: [...monthly.map((m) => ({ label: m.month, value: m.count })), { label: "Total", value: lost.length }] },
        { title: "Value Lost by Month", items: [...monthly.map((m) => ({ label: m.month, value: fmtAmt(m.value) })), { label: "Total", value: fmtAmt(totalValueLost) }] },
      ],
      tables: [
        {
          title: "Cancelled Orders — Monthly Breakdown",
          columns: SALES_LOSS_COLUMNS,
          rows: monthly.map((m) => ({ Month: m.month, CancelledOrders: m.count, ValueLost: fmtAmt(m.value) })),
        },
        {
          title: "Cancelled Orders — Detail",
          columns: SALES_LOSS_DETAIL_COLUMNS,
          rows: detailRows.map((o, i) => ({
            SNo: i + 1, SortNo: o.sortNo, ShadeNo: o.shadeNo, Code: o.code,
            ProductName: o.productName, Customer: o.customer, Qty: o.qty,
            Month: o.month, ValueLost: fmtAmt(o.value),
          })),
        },
      ],
    });
  };

  const card = cardStyle(themeG);
  const th = { textAlign: "center", fontSize: 11, color: "#FFFFFF", padding: "10px 12px", background: "#1F3A63", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, position: "sticky", top: 0, zIndex: 1 };
  const td = { padding: "10px 12px", fontSize: 13, color: themeG.textMain, textAlign: "center" };
  const filterSelect = { padding: "9px 12px", borderRadius: 9, border: `1px solid ${themeG.border}`, fontSize: 13, fontFamily: FONT, color: themeG.textMain, background: themeG.card, outline: "none", minWidth: 200 };
  const filterLabel = { fontSize: 11, fontWeight: 700, color: themeG.textLabel, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6, display: "block" };
  const searchInput = { padding: "9px 12px", borderRadius: 9, border: `1px solid ${themeG.border}`, fontSize: 13, fontFamily: FONT, color: themeG.textMain, background: themeG.card, outline: "none", minWidth: 240 };
  const tableScroll = { maxHeight: 460, overflowY: "auto", overflowX: "auto" };

  return (
    <Layout pageTitle="Sales Loss Report">

      {loading ? (
        <p style={{ color: themeG.textSub, fontFamily: FONT }}>Loading report…</p>
      ) : (
        <>
          {error && <div style={errorBoxStyle}>{error}</div>}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 16, marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div>
                <label style={filterLabel}>Search</label>
                <input
                  style={searchInput}
                  placeholder="Order no, product, customer, sort no, shade no…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div>
                <label style={filterLabel}>Month</label>
                <select style={filterSelect} value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}>
                  {monthOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label style={filterLabel}>Product</label>
                <select style={filterSelect} value={productFilter} onChange={(e) => setProductFilter(e.target.value)}>
                  {productOptions.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
            <ExportButton onClick={exportExcel} disabled={lost.length === 0} themeG={themeG} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
            {statCards.map((c) => (
              <div key={c.label} style={statCardStyle(themeG)}>
                <p style={{ fontSize: 12, color: themeG.textLabel, margin: "0 0 6px", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: FONT }}>{c.label}</p>
                <p style={{ fontSize: 22, fontWeight: 700, margin: 0, color: c.accent, fontFamily: "'Space Grotesk', " + FONT }}>{c.value}</p>
              </div>
            ))}
          </div>

          {/* ── Cancelled Orders detail table, then Monthly Breakdown below it ── */}
          <div style={card}>
            <p style={{ fontSize: 14, fontWeight: 700, color: themeG.textMain, margin: "0 0 14px", fontFamily: FONT }}>Cancelled Orders — Detail</p>
            {detailRows.length === 0 ? (
              <p style={{ fontSize: 13, color: themeG.textSub, margin: 0 }}>No cancelled orders match the current filters.</p>
            ) : (
              <div style={tableScroll}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 800 }}>
                  <thead>
                    <tr>
                      {["S.No", "Sort No", "Shade", "Enquiry No", "Product Name", "Customer", "Qty", "Month", "Value Lost"].map((h) => (
                        <th key={h} style={th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {detailRows.map((o, i) => (
                      <tr key={o.code + i} style={{ borderBottom: "1px solid rgba(46,122,114,0.08)" }}>
                        <td style={td}>{i + 1}</td>
                        <td style={td}>{o.sortNo}</td>
                        <td style={td}>{o.shadeNo}</td>
                        <td style={td}>{o.code}</td>
                        <td style={td}>{o.productName}</td>
                        <td style={td}>{o.customer}</td>
                        <td style={td}>{o.qty}</td>
                        <td style={td}>{o.month}</td>
                        <td style={{ ...td, fontWeight: 700, color: "#B23A3A" }}>{fmtAmt(o.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div style={{ ...card, marginTop: 24 }}>
            <p style={{ fontSize: 14, fontWeight: 700, color: themeG.textMain, margin: "0 0 14px", fontFamily: FONT }}>Monthly Breakdown</p>
            {monthly.length === 0 ? (
              <p style={{ fontSize: 13, color: themeG.textSub, margin: 0 }}>No sales lost — nothing cancelled. 🎉</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>{["Month", "Orders", "Value"].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {monthly.map((m) => (
                    <tr key={m.month} style={{ borderBottom: "1px solid rgba(46,122,114,0.08)" }}>
                      <td style={td}>{m.month}</td>
                      <td style={td}>{m.count}</td>
                      <td style={{ ...td, fontWeight: 700, color: "#B23A3A" }}>{fmtAmt(m.value)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: `2px solid ${themeG.border}` }}>
                    <td style={{ ...td, fontWeight: 800 }}>Total</td>
                    <td style={{ ...td, fontWeight: 800 }}>{lost.length}</td>
                    <td style={{ ...td, fontWeight: 800, color: "#B23A3A" }}>{fmtAmt(totalValueLost)}</td>
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