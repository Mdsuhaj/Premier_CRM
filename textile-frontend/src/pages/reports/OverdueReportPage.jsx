// src/pages/reports/OverdueReportPage.jsx
//
// Report 2 of 6. Reuses the Credit Limit data as a report view.
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

const OVERDUE_REPORT_COLUMNS = [
  { key: "Customer", header: "Customer" }, { key: "Code", header: "Code" },
  { key: "District", header: "District" }, { key: "Taluk", header: "Taluk" },
  { key: "Outstanding", header: "Outstanding" }, { key: "Order", header: "Order" },
  { key: "BalanceDue", header: "Balance Due" }, { key: "PaymentDueDate", header: "Payment Due Date" },
  { key: "DaysOverdue", header: "Days Overdue" },
];

export default function OverdueReportPage() {
  const { isDark } = useTheme();
  const themeG = getG(isDark);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [minDays, setMinDays] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const res = await API.get("/credit-limit");
        setRows(res.data || []);
      } catch {
        setError("Failed to load overdue report data.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const visible = useMemo(() => rows.filter((r) => r.maxDaysOverdue >= minDays), [rows, minDays]);
  const totalOutstanding = visible.reduce((s, r) => s + (r.orders?.reduce((os, o) => os + o.balanceDue, 0) || 0), 0);
  const totalOrders = visible.reduce((s, r) => s + (r.orders?.length || 0), 0);
  const over90 = rows.filter((r) => r.maxDaysOverdue >= 90).length;

  const filterLabel = minDays === 0 ? "All" : `${minDays}+ days`;

  const exportExcel = () => {
    const data = [];
    visible.forEach((r) => (r.orders || []).forEach((o) => {
      data.push({
        Customer: r.customerName, Code: r.customerCode, District: r.district, Taluk: r.taluk,
        Outstanding: r.outstanding, Order: o.code, BalanceDue: o.balanceDue,
        PaymentDueDate: o.paymentDueDate, DaysOverdue: o.daysOverdue,
      });
    }));

    exportReportToExcel({
      reportTitle: "Overdue Report",
      filename: `overdue-report-${todayStamp()}`,
      stats: [
        { label: "Filter Applied", value: filterLabel },
        { label: "Customers Overdue", value: rows.length },
        { label: "Total Outstanding", value: fmtAmt(totalOutstanding) },
        { label: "Overdue Orders", value: totalOrders },
        { label: "90+ Days", value: over90 },
      ],
      tables: [
        { title: "Overdue Orders", columns: OVERDUE_REPORT_COLUMNS, rows: data },
      ],
    });
  };

  const card = cardStyle(themeG), statCard = statCardStyle(themeG);
  const th = { textAlign: "left", fontSize: 11, color: themeG.textLabel, padding: "10px 12px", borderBottom: "1px solid rgba(46,122,114,0.13)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 };
  const td = { padding: "10px 12px", fontSize: 13, color: themeG.textMain };

  return (
    <Layout pageTitle="Overdue Report">

      {loading ? (
        <p style={{ color: themeG.textSub, fontFamily: FONT }}>Loading report…</p>
      ) : (
        <>
          {error && <div style={errorBoxStyle}>{error}</div>}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 20 }}>
            {[
              { label: "Customers Overdue", value: rows.length, accent: "#8A5A0E" },
              { label: "Total Outstanding", value: fmtAmt(totalOutstanding), accent: "#B23A3A" },
              { label: "Overdue Orders", value: totalOrders, accent: themeG.accent },
              { label: "90+ Days", value: over90, accent: "#96302F" },
            ].map((c) => (
              <div key={c.label} style={statCard}>
                <p style={{ fontSize: 12, color: themeG.textLabel, margin: "0 0 6px", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: FONT }}>{c.label}</p>
                <p style={{ fontSize: 24, fontWeight: 700, margin: 0, color: c.accent, fontFamily: "'Space Grotesk', " + FONT }}>{c.value}</p>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
            {[[0, "All"], [30, "30+ days"], [60, "60+ days"], [90, "90+ days"]].map(([days, label]) => (
              <button key={days} onClick={() => setMinDays(days)}
                style={{ padding: "8px 14px", borderRadius: 20, border: "1.5px solid", cursor: "pointer", fontFamily: FONT, fontSize: 12.5, fontWeight: 600,
                  background: minDays === days ? themeG.accent : themeG.card, color: minDays === days ? "#fff" : themeG.textSub,
                  borderColor: minDays === days ? themeG.accent : themeG.border }}>
                {label}
              </button>
            ))}
            <div style={{ marginLeft: "auto" }}>
              <ExportButton onClick={exportExcel} disabled={visible.length === 0} themeG={themeG} />
            </div>
          </div>

          <div style={card}>
            {visible.length === 0 ? (
              <p style={{ fontSize: 13, color: themeG.textSub, margin: 0 }}>Nobody matches this filter. 🎉</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>{["Customer", "Area", "Outstanding", "Worst Overdue", "Overdue Orders"].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {visible.map((r) => (
                      <tr key={r.customerId} style={{ borderBottom: "1px solid rgba(46,122,114,0.08)" }}>
                        <td style={td}>
                          <div style={{ fontWeight: 700 }}>{r.customerName}</div>
                          <div style={{ fontSize: 11, color: themeG.textSub }}>{r.customerCode}</div>
                        </td>
                        <td style={td}>{r.taluk || r.district || "—"}</td>
                        <td style={{ ...td, fontWeight: 700, color: "#B23A3A" }}>{fmtAmt(r.outstanding)}</td>
                        <td style={td}>{r.maxDaysOverdue} day{r.maxDaysOverdue === 1 ? "" : "s"} exceeded</td>
                        <td style={td}>{r.orders?.length || 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </Layout>
  );
}