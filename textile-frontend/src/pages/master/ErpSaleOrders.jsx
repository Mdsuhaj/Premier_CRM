// src/pages/master/ErpSaleOrders.jsx
//
// ERP Sale Order — read-only view of the two ERP-format staging tables that
// are filled automatically whenever an order is placed:
//
//   sale_order_header  = ONE row per customer order (whole cart)
//   sale_order_line    = ONE row per product on that order
//   LINK:  sale_order_line.FATHERID = sale_order_header.RELATEDDEPENDENTID
//
// Click a row to see its lines. "Download ERP Excel" produces a workbook in
// the client's own layout (sheets "Line" + "Header", real column names in
// row 1, no banner rows) — same shape as SOBean.xlsx.
import { Fragment, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx-js-style";
import Layout from "../../components/AppLayout";
import { useTheme } from "../../ThemeContext";
import { getG, FONT } from "../../theme";
import API from "../../services/api";

const fmtDate = (v) => (v ? String(v).slice(0, 10) : "—");
const fmtQty = (v) => (v === null || v === undefined ? "—" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: 3 }));

export default function ErpSaleOrders() {
  const { isDark } = useTheme();
  const themeG = getG(isDark);
  const S = buildStyles(themeG);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState(null);
  const [details, setDetails] = useState({});      // headerId -> { header, lines }
  const [busyId, setBusyId] = useState(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await API.get("/sale-orders");
        setRows(Array.isArray(res.data) ? res.data : []);
      } catch (err) {
        setError(err.response?.data?.message || "Could not load ERP sale orders.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.CODE, r.CustomerName, r.CustomerCode, r.ORDPRNCUSTOMERSUPPLIERCODE, r.RELATEDDEPENDENTID]
        .some((v) => String(v ?? "").toLowerCase().includes(q))
    );
  }, [rows, search]);

  const totals = useMemo(() => ({
    orders: visible.length,
    lines: visible.reduce((n, r) => n + Number(r.lines_count || 0), 0),
  }), [visible]);

  const toggle = async (r) => {
    if (openId === r.Id) { setOpenId(null); return; }
    setOpenId(r.Id);
    if (details[r.Id]) return;
    setBusyId(r.Id);
    try {
      const res = await API.get(`/sale-orders/${r.Id}`);
      setDetails((d) => ({ ...d, [r.Id]: res.data }));
    } catch (err) {
      setError(err.response?.data?.message || "Could not load the lines of this order.");
    } finally {
      setBusyId(null);
    }
  };

  // Workbook in the client's exact layout: sheet "Line" then "Header",
  // real column names in row 1, blank cell = NULL.
  const downloadExcel = async () => {
    setExporting(true);
    setError("");
    try {
      const res = await API.get("/sale-orders/export", {
        params: { ids: visible.map((r) => r.Id) },
      });
      const { headerColumns, lineColumns, header, line } = res.data;
      const sheet = (cols, data) => {
        const aoa = [cols, ...data.map((row) => cols.map((c) => row[c] ?? ""))];
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws["!cols"] = cols.map((c) => ({ wch: Math.min(28, Math.max(12, c.length + 2)) }));
        return ws;
      };
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, sheet(lineColumns, line), "Line");
      XLSX.utils.book_append_sheet(wb, sheet(headerColumns, header), "Header");
      const d = new Date();
      const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
      XLSX.writeFile(wb, `SOBean_${stamp}.xlsx`);
    } catch (err) {
      setError(err.response?.data?.message || "Could not export the ERP Excel.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <Layout pageTitle="ERP Sale Order">
      <h1 style={S.heading}>ERP Sale Order</h1>
      <p style={S.headingSub}>
        Orders in the client's ERP layout — one <b>header</b> per order, one <b>line</b> per product.
        Lines are linked to their header by <code>FATHERID = RELATEDDEPENDENTID</code>.
      </p>

      {error && <div style={S.alertError}>{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16, marginBottom: 20 }}>
        {[["Headers (orders)", totals.orders], ["Lines (products)", totals.lines]].map(([label, value]) => (
          <div key={label} style={S.statCard}>
            <p style={S.statLabel}>{label}</p>
            <p style={S.statValue}>{value}</p>
          </div>
        ))}
      </div>

      <div style={S.searchBar}>
        <input
          type="text"
          placeholder="Search order no, customer name / code…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={S.searchInput}
        />
        <button onClick={downloadExcel} disabled={visible.length === 0 || exporting} style={S.exportBtn(visible.length === 0 || exporting)}>
          {exporting ? "Preparing…" : "Download ERP Excel"}
        </button>
      </div>

      <div style={S.card}>
        <div style={S.tableScroll}>
          {loading ? (
            <p style={S.empty}>Loading…</p>
          ) : visible.length === 0 ? (
            <p style={S.empty}>No ERP sale orders yet — they appear here as soon as an order is placed.</p>
          ) : (
            <table style={S.table}>
              <thead>
                <tr>
                  {["", "S.No", "ERP Order No (CODE)", "Order Date", "Required Date", "Customer", "ERP Cust. Code", "Lines", "Header ID (RELATEDDEPENDENTID)"].map((h) => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((r, i) => {
                  const open = openId === r.Id;
                  const det = details[r.Id];
                  return (
                    <FragmentRows key={r.Id}>
                      <tr onClick={() => toggle(r)} style={{ cursor: "pointer", background: open ? themeG.surface : "transparent" }}>
                        <td style={S.td}>{open ? "▾" : "▸"}</td>
                        <td style={S.td}>{i + 1}</td>
                        <td style={{ ...S.td, fontWeight: 700 }}>{r.CODE}</td>
                        <td style={S.td}>{fmtDate(r.ORDERDATE)}</td>
                        <td style={S.td}>{fmtDate(r.REQUIREDDUEDATE)}</td>
                        <td style={S.td}>{r.CustomerName || "—"}</td>
                        <td style={S.td}>{r.ORDPRNCUSTOMERSUPPLIERCODE || "—"}</td>
                        <td style={S.td}>{r.lines_count}</td>
                        <td style={S.td}>{r.RELATEDDEPENDENTID}</td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={9} style={{ padding: "0 12px 14px 36px", background: themeG.surface }}>
                            {busyId === r.Id || !det ? (
                              <p style={{ ...S.empty, padding: 16 }}>Loading lines…</p>
                            ) : (
                              <table style={{ ...S.table, background: themeG.card }}>
                                <thead>
                                  <tr>
                                    {["ORDERLINE", "FATHERID", "Sort No (SUBCODE01)", "Shade No (SUBCODE08)", "Description", "Qty", "UOM", "Price", "Line ID (RELATEDDEPENDENTID)"].map((h) => (
                                      <th key={h} style={S.th}>{h}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {det.lines.map((l) => (
                                    <tr key={l.Id}>
                                      <td style={S.td}>{l.ORDERLINE}</td>
                                      <td style={S.td}>{l.FATHERID}</td>
                                      <td style={S.td}>{l.SUBCODE01 ?? "—"}</td>
                                      <td style={S.td}>{l.SUBCODE08 ?? "—"}</td>
                                      <td style={S.td}>{l.ITEMDESCRIPTION ?? "—"}</td>
                                      <td style={S.td}>{fmtQty(l.USERPRIMARYQUANTITY)}</td>
                                      <td style={S.td}>{l.USERPRIMARYUOMCODE ?? "—"}</td>
                                      <td style={S.td}>{fmtQty(l.PRICE)}</td>
                                      <td style={S.td}>{l.RELATEDDEPENDENTID}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </td>
                        </tr>
                      )}
                    </FragmentRows>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Layout>
  );
}

// <tbody> may hold several <tr>; a fragment keeps the key on the group.
function FragmentRows({ children }) {
  return <Fragment>{children}</Fragment>;
}

function buildStyles(themeG) {
  return {
    heading: { fontFamily: "'Space Grotesk', " + FONT, fontSize: 26, fontWeight: 700, margin: "0 0 4px", color: themeG.textMain, letterSpacing: "-0.4px" },
    headingSub: { fontSize: 13, color: themeG.textSub, margin: "0 0 18px" },
    statCard: { background: themeG.card, border: `1px solid ${themeG.border}`, borderRadius: 14, padding: "16px 18px", boxShadow: "0 4px 16px rgba(46,122,114,0.05)" },
    statLabel: { fontSize: 11, color: themeG.textLabel, margin: "0 0 6px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" },
    statValue: { fontSize: 22, fontWeight: 700, margin: 0, color: themeG.accent, fontFamily: "'Space Grotesk', " + FONT },
    searchBar: { display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 16 },
    searchInput: { flex: "1 1 260px", minWidth: 220, boxSizing: "border-box", padding: "10px 14px", borderRadius: 10, border: `1px solid ${themeG.border}`, fontSize: 13.5, fontFamily: FONT, background: themeG.card, outline: "none", color: themeG.textMain },
    exportBtn: (disabled) => ({
      padding: "10px 16px", borderRadius: 10, border: "none", background: disabled ? themeG.border : "#1E7B4D", color: "#fff",
      fontSize: 13, fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer", fontFamily: FONT, whiteSpace: "nowrap", opacity: disabled ? 0.6 : 1,
    }),
    card: { background: themeG.card, border: `1px solid ${themeG.border}`, borderRadius: 14, overflow: "hidden", boxShadow: "0 4px 16px rgba(15,33,56,0.06)" },
    tableScroll: { overflowX: "auto" },
    table: { width: "100%", tableLayout: "auto", borderCollapse: "collapse" },
    th: { textAlign: "left", fontSize: 10.5, color: themeG.textLabel, padding: "9px 12px", borderBottom: `1px solid ${themeG.border}`, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, whiteSpace: "nowrap" },
    td: { padding: "10px 12px", fontSize: 13, color: themeG.textMain, borderBottom: `1px solid ${themeG.border}`, whiteSpace: "nowrap" },
    empty: { padding: 50, textAlign: "center", fontSize: 14, color: themeG.textSub },
    alertError: { marginBottom: 18, background: "rgba(178,58,58,0.08)", border: "1px solid rgba(178,58,58,0.25)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#B23A3A" },
  };
}
