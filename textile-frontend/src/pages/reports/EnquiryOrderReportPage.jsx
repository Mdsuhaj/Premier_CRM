// src/pages/reports/EnquiryOrderReportPage.jsx
//
// Report 1 of 6. Order Enquiry pipeline (pending -> assigned ->
// approved/declined), conversion rate, breakdowns. Was previously the
// first pill tab inside Reports.jsx — now its own route/page.
import { useEffect, useState } from "react";
import { useTheme } from "../../ThemeContext";
import Layout from "../../components/Layout";
import { getG, statusColor } from "../../theme";
import API from "../../services/api";
import { exportReportToExcel } from "../../utils/excelIO";
import {
  FONT, ListBox, ExportButton,
  errorBoxStyle, statCardStyle, groupBy, fmtDate, todayStamp,
} from "./shared";

const ENQUIRY_COLUMNS = [
  { key: "Code", header: "Order No." }, { key: "Customer", header: "Customer" },
  { key: "Product", header: "Product" }, { key: "Status", header: "Status" },
  { key: "AssignedTo", header: "Assigned To" }, { key: "CreatedAt", header: "Created" },
];

export default function EnquiryOrderReportPage() {
  const { isDark } = useTheme();
  const themeG = getG(isDark);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await API.get("/orders", { params: { status_in: "pending,assigned,approved,declined,processing" } });
        setOrders(res.data || []);
      } catch {
        setError("Failed to load enquiry report data.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const statusCounts = groupBy(orders, (o) => o.Status);
  const converted = (statusCounts.approved || 0) + (statusCounts.processing || 0);
  const conversionRate = orders.length ? Math.round((converted / orders.length) * 100) : 0;
  const byAssignee = groupBy(orders.filter((o) => o.assignee), (o) => o.assignee?.name || o.assignee?.email || "—");
  const byDate = groupBy(orders, (o) => (o.CreatedAt ? fmtDate(o.CreatedAt) : "—"));
  const byDateSorted = Object.entries(byDate).sort((a, b) => new Date(a[0]) - new Date(b[0]));

  const statCards = [
    { label: "Total Enquiries", value: orders.length, accent: "#2E7A72" },
    { label: "Pending / Assigned", value: (statusCounts.pending || 0) + (statusCounts.assigned || 0), accent: "#8A5A0E" },
    { label: "Conversion Rate", value: `${conversionRate}%`, accent: themeG.accent },
    { label: "Declined", value: statusCounts.declined || 0, accent: "#B23A3A" },
  ];

  const exportExcel = () => {
    exportReportToExcel({
      reportTitle: "Enquiry Order Report",
      filename: `enquiry-order-report-${todayStamp()}`,
      stats: statCards.map(({ label, value }) => ({ label, value })),
      breakdowns: [
        { title: "By Status", items: Object.entries(statusCounts).map(([s, count]) => ({ label: s, value: count })) },
        { title: "By Assigned Staff", items: Object.entries(byAssignee).map(([name, count]) => ({ label: name, value: count })) },
        { title: "Received By Day", items: byDateSorted.map(([day, count]) => ({ label: day, value: count })) },
      ],
      tables: [
        {
          title: "Enquiry Orders",
          columns: ENQUIRY_COLUMNS,
          rows: orders.map((o) => ({
            Code: o.Code, Customer: o.customer?.Name ?? "—", Product: o.product?.Name ?? "—",
            Status: o.Status, AssignedTo: o.assignee?.name || o.assignee?.email || "—",
            CreatedAt: fmtDate(o.CreatedAt),
          })),
        },
      ],
    });
  };

  return (
    <Layout pageTitle="Enquiry Order Report">

      {loading ? (
        <p style={{ color: themeG.textSub, fontFamily: FONT }}>Loading report…</p>
      ) : (
        <>
          {error && <div style={errorBoxStyle}>{error}</div>}

          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
            <ExportButton onClick={exportExcel} disabled={orders.length === 0} themeG={themeG} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
            {statCards.map((c) => (
              <div key={c.label} style={statCardStyle(themeG)}>
                <p style={{ fontSize: 12, color: themeG.textLabel, margin: "0 0 6px", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: FONT }}>{c.label}</p>
                <p style={{ fontSize: 24, fontWeight: 700, margin: 0, color: c.accent, fontFamily: "'Space Grotesk', " + FONT }}>{c.value}</p>
              </div>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20 }}>
            <ListBox
              title="By Status"
              themeG={themeG}
              items={Object.entries(statusCounts).map(([s, count]) => ({ label: s, value: count, color: statusColor(s).color }))}
            />
            <ListBox
              title="By Assigned Staff"
              themeG={themeG}
              items={Object.entries(byAssignee).map(([name, count]) => ({ label: name, value: count }))}
              emptyText="Nothing assigned yet."
            />
            <ListBox
              title="Received By Day"
              themeG={themeG}
              items={byDateSorted.slice(-8).map(([day, count]) => ({ label: day, value: count }))}
            />
          </div>
        </>
      )}
    </Layout>
  );
}