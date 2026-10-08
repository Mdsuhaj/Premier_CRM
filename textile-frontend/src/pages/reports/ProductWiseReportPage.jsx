// src/pages/reports/ProductWiseReportPage.jsx
//
// Product Wise Pending Allocation report — now built from ORACLE products.
//   - Product list + Received = live Oracle stock (same source as the
//     Available Stock page: GET /products/available-stock).
//   - Allocated = quantity on live orders (pending / approved / processing)
//     for that exact Sort No + Shade.
//   - Pending   = Received - Allocated (never below 0).
import { useEffect, useMemo, useState } from "react";
import { useTheme } from "../../ThemeContext";
import Layout from "../../components/Layout";
import { getG } from "../../theme";
import API from "../../services/api";
import { exportReportToExcel } from "../../utils/excelIO";
import {
  FONT, ExportButton,
  cardStyle, errorBoxStyle, statCardStyle, todayStamp,
} from "./shared";

const PRODUCT_TYPES = ["Blouse", "Dhoti", "Uniform Shirting", "Uniform Suiting"];

const PRODUCT_WISE_COLUMNS = [
  { key: "SNo", header: "S.No" }, { key: "SortNo", header: "Sort No" },
  { key: "ShadeNo", header: "Shade" },
  { key: "Name", header: "Product Name" }, { key: "Type", header: "Type" },
  { key: "Received", header: "Received" }, { key: "Allocated", header: "Allocated" },
  { key: "Pending", header: "Pending" },
];

// Orders still "live" count towards Allocated.
const ACTIVE_ORDER_STATUSES = ["pending", "approved", "processing"];

const norm = (s) => String(s ?? "").trim().toUpperCase();
const stockKey = (sortNo, shadeNo) => `${norm(sortNo)}|${norm(shadeNo)}`;

function monthKey(dateStr) {
  const d = dateStr ? new Date(dateStr) : null;
  if (!d || isNaN(d.getTime())) return "Unknown";
  return d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}
function monthSortValue(dateStr) {
  const d = dateStr ? new Date(dateStr) : null;
  return d && !isNaN(d.getTime()) ? d.getFullYear() * 12 + d.getMonth() : -1;
}

export default function ProductWiseReportPage() {
  const { isDark } = useTheme();
  const themeG = getG(isDark);
  const [orders, setOrders] = useState([]);
  const [stockRows, setStockRows] = useState([]); // Oracle rows for the selected type
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [typeFilter, setTypeFilter] = useState(PRODUCT_TYPES[0]);
  const [shadeFilter, setShadeFilter] = useState("All");
  const [monthFilter, setMonthFilter] = useState("All");
  const [search, setSearch] = useState("");

  // Orders are loaded once.
  useEffect(() => {
    API.get("/orders")
      .then((res) => setOrders(res.data || []))
      .catch(() => setError("Failed to load orders for the report."));
  }, []);

  // Oracle stock is reloaded whenever the Product Type changes.
  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setStockRows([]);
    API.get("/products/available-stock", {
      params: { type: typeFilter, export: 1 },
      signal: ctrl.signal,
    })
      .then((res) => {
        setStockRows((res.data.data || []).filter((r) => r.source === "oracle"));
        setError("");
      })
      .catch((err) => {
        if (err?.code === "ERR_CANCELED" || err?.name === "CanceledError") return;
        setError("Failed to load Oracle stock for this product type.");
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [typeFilter]);

  const monthOptions = useMemo(() => {
    const seen = new Map();
    orders.forEach((o) => {
      const key = monthKey(o.CreatedAt);
      if (!seen.has(key)) seen.set(key, monthSortValue(o.CreatedAt));
    });
    const months = Array.from(seen.entries()).sort((a, b) => a[1] - b[1]).map(([key]) => key);
    return ["All", ...months];
  }, [orders]);

  const monthOrders = useMemo(
    () => (monthFilter === "All" ? orders : orders.filter((o) => monthKey(o.CreatedAt) === monthFilter)),
    [orders, monthFilter]
  );

  // Live-order quantity per Sort No + Shade.
  const allocatedByKey = useMemo(() => {
    const map = {};
    monthOrders.forEach((o) => {
      const status = (o.Status || "").toLowerCase();
      if (!ACTIVE_ORDER_STATUSES.includes(status)) return;
      const key = stockKey(o.product?.SortNo, o.product?.ShadeNo);
      map[key] = (map[key] || 0) + (parseInt(o.Quantity) || 0);
    });
    return map;
  }, [monthOrders]);

  const allRows = useMemo(
    () =>
      stockRows.map((r, i) => {
        const received = parseInt(r.availableQty) || 0;
        const allocated = allocatedByKey[stockKey(r.sortNo, r.shadeNo)] || 0;
        return {
          id: `${r.sortNo}|${r.shadeNo}|${i}`,
          sortNo: r.sortNo || "—",
          shadeNo: r.shadeNo || "—",
          name: r.name || "—",
          type: typeFilter,
          received,
          allocated,
          pending: Math.max(0, received - allocated),
        };
      }),
    [stockRows, allocatedByKey, typeFilter]
  );

  const shadeOptions = useMemo(
    () => ["All", ...Array.from(new Set(allRows.map((r) => r.shadeNo).filter((s) => s && s !== "—"))).sort()],
    [allRows]
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows
      .filter((r) => shadeFilter === "All" || r.shadeNo === shadeFilter)
      .filter((r) => {
        if (!q) return true;
        return [r.name, r.type, r.sortNo, r.shadeNo]
          .some((v) => String(v ?? "").toLowerCase().includes(q));
      });
  }, [allRows, shadeFilter, search]);

  const totals = rows.reduce(
    (acc, r) => ({
      received: acc.received + r.received,
      allocated: acc.allocated + r.allocated,
      pending: acc.pending + r.pending,
    }),
    { received: 0, allocated: 0, pending: 0 }
  );

  const statCards = [
    { label: "Products Shown", value: rows.length.toLocaleString(), accent: "#2E7A72" },
    { label: "Total Received", value: totals.received.toLocaleString(), accent: themeG.accent },
    { label: "Total Allocated", value: totals.allocated.toLocaleString(), accent: "#5B9BD9" },
    { label: "Total Pending", value: totals.pending.toLocaleString(), accent: "#B23A3A" },
  ];

  const exportExcel = () => {
    exportReportToExcel({
      reportTitle: "Product Wise Report",
      filename: `product-wise-report-${todayStamp()}`,
      stats: statCards.map(({ label, value }) => ({ label, value })),
      breakdowns: [],
      tables: [
        {
          title: `Product Wise — ${typeFilter} (Received / Allocated / Pending)`,
          columns: PRODUCT_WISE_COLUMNS,
          rows: rows.map((r, i) => ({
            SNo: i + 1, SortNo: r.sortNo, ShadeNo: r.shadeNo, Name: r.name, Type: r.type,
            Received: r.received, Allocated: r.allocated, Pending: r.pending,
          })),
        },
      ],
    });
  };

  const card = cardStyle(themeG);
  const th = {
    textAlign: "center", fontSize: 11, color: "#EAF2FA", padding: "10px 12px",
    textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700,
    background: "linear-gradient(180deg, #1F5C99, #164672)",
    position: "sticky", top: 0, zIndex: 2, whiteSpace: "nowrap",
  };
  const td = { padding: "10px 12px", fontSize: 13, color: themeG.textMain, textAlign: "center" };
  const totalTd = {
    ...td, position: "sticky", bottom: 0, zIndex: 2,
    background: isDark ? "#0F2138" : "#EAF2FA",
  };
  const filterSelect = { padding: "9px 12px", borderRadius: 9, border: `1px solid ${themeG.border}`, fontSize: 13, fontFamily: FONT, color: themeG.textMain, background: themeG.card, outline: "none", minWidth: 160 };
  const filterLabel = { fontSize: 11, fontWeight: 700, color: themeG.textLabel, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6, display: "block" };
  const searchInput = { padding: "9px 12px", borderRadius: 9, border: `1px solid ${themeG.border}`, fontSize: 13, fontFamily: FONT, color: themeG.textMain, background: themeG.card, outline: "none", minWidth: 240 };

  return (
    <Layout pageTitle="Product Wise Pending Allocation Report">
      {error && <div style={errorBoxStyle}>{error}</div>}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 16, marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label style={filterLabel}>Search</label>
            <input
              style={searchInput}
              placeholder="Product name, sort no, shade…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div>
            <label style={filterLabel}>Product Type</label>
            <select
              style={filterSelect}
              value={typeFilter}
              onChange={(e) => { setTypeFilter(e.target.value); setShadeFilter("All"); }}
            >
              {PRODUCT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label style={filterLabel}>Shade</label>
            <select style={filterSelect} value={shadeFilter} onChange={(e) => setShadeFilter(e.target.value)}>
              {shadeOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label style={filterLabel}>Month</label>
            <select style={filterSelect} value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}>
              {monthOptions.map((m) => <option key={m} value={m}>{m === "All" ? "All Months" : m}</option>)}
            </select>
          </div>
        </div>
        <ExportButton onClick={exportExcel} disabled={rows.length === 0} themeG={themeG} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
        {statCards.map((c) => (
          <div key={c.label} style={statCardStyle(themeG)}>
            <p style={{ fontSize: 12, color: themeG.textLabel, margin: "0 0 6px", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: FONT }}>{c.label}</p>
            <p style={{ fontSize: 22, fontWeight: 700, margin: 0, color: c.accent, fontFamily: "'Space Grotesk', " + FONT }}>{c.value}</p>
          </div>
        ))}
      </div>

      <div style={card}>
        {loading ? (
          <p style={{ fontSize: 13, color: themeG.textSub, margin: 0, fontFamily: FONT }}>Loading Oracle products…</p>
        ) : rows.length === 0 ? (
          <p style={{ fontSize: 13, color: themeG.textSub, margin: 0 }}>No products match the current filters.</p>
        ) : (
          <div style={{ overflow: "auto", maxHeight: 460 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>{["S.No", "Sort No", "Shade", "Product Name", "Type", "Received", "Allocated", "Pending"].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid rgba(46,122,114,0.08)" }}>
                    <td style={td}>{i + 1}</td>
                    <td style={td}>{r.sortNo}</td>
                    <td style={td}>{r.shadeNo}</td>
                    <td style={td}>{r.name}</td>
                    <td style={td}>{r.type}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{r.received.toLocaleString()}</td>
                    <td style={{ ...td, color: "#5B9BD9", fontWeight: 700 }}>{r.allocated.toLocaleString()}</td>
                    <td style={{ ...td, color: "#B23A3A", fontWeight: 700 }}>{r.pending.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: `2px solid ${themeG.border}` }}>
                  <td style={{ ...totalTd, fontWeight: 800 }}>Total</td>
                  <td style={totalTd} />
                  <td style={totalTd} />
                  <td style={totalTd} />
                  <td style={totalTd} />
                  <td style={{ ...totalTd, fontWeight: 800 }}>{totals.received.toLocaleString()}</td>
                  <td style={{ ...totalTd, fontWeight: 800, color: "#5B9BD9" }}>{totals.allocated.toLocaleString()}</td>
                  <td style={{ ...totalTd, fontWeight: 800, color: "#B23A3A" }}>{totals.pending.toLocaleString()}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}