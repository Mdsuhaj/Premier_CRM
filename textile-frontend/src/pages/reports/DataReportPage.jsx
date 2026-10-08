// src/pages/reports/DataReportPage.jsx
//
// Report 3 of 6. The original Products / Orders / Employees reports,
// kept together behind one inner pill toggle (unchanged from before) —
// only the outer page is now its own route instead of a pill on
// Reports.jsx.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "../../ThemeContext";
import Layout from "../../components/Layout";
import { getG, statusColor } from "../../theme";
import API from "../../services/api";
import { exportReportToExcel } from "../../utils/excelIO";
import {
  FONT, ListBox, ExportButton,
  cardStyle, cardTitleStyle, errorBoxStyle, statCardStyle, groupBy, fmtDate, todayStamp,
} from "./shared";

const LOW_STOCK_THRESHOLD = 50;

const PRODUCT_COLUMNS = [
  { key: "Code", header: "Code" }, { key: "Name", header: "Name" },
  { key: "SubType", header: "Sub-type" }, { key: "Quality", header: "Quality" },
  { key: "Price", header: "Price" }, { key: "Quantity", header: "Quantity" }, { key: "Status", header: "Status" },
];
const LOW_STOCK_COLUMNS = [
  { key: "Code", header: "Code" }, { key: "Name", header: "Name" },
  { key: "Quantity", header: "Quantity" }, { key: "Status", header: "Status" },
];

function DataReportProducts({ themeG }) {
  const navigate = useNavigate();
  const tab = localStorage.getItem("premier_category") || "cloth";
  const [allProducts, setAllProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try { setAllProducts((await API.get("/products")).data); }
      catch { setError("Failed to load product report data."); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <p style={{ color: themeG.textSub }}>Loading report…</p>;

  const products = allProducts.filter((p) => p.Category === tab);
  const totalQty = products.reduce((s, p) => s + (parseInt(p.Quantity) || 0), 0);
  const totalValue = products.reduce((s, p) => s + (parseFloat(p.Price) || 0) * (parseInt(p.Quantity) || 0), 0);
  const lowStock = products.filter((p) => p.Quantity <= LOW_STOCK_THRESHOLD);
  const subTypeCounts = groupBy(products, (p) => p.SubType);
  const qualityCounts = groupBy(products, (p) => p.Quality);
  const qualityColor = { premium: "#2E7A72", standard: "#5B9BD9", economy: "#D69426" };

  const exportExcel = () => {
    exportReportToExcel({
      reportTitle: `Product Report (${tab === "cloth" ? "Cloth" : "Yarn"})`,
      filename: `product-report-${tab}-${todayStamp()}`,
      stats: [
        { label: "Total Products", value: products.length },
        { label: "Units in Stock", value: totalQty },
        { label: "Inventory Value", value: `₹${totalValue.toLocaleString()}` },
        { label: "Low Stock Items", value: lowStock.length },
      ],
      breakdowns: [
        { title: "Products by Sub-type", items: Object.entries(subTypeCounts).map(([t, count]) => ({ label: t, value: count })) },
        { title: "Products by Quality Grade", items: Object.entries(qualityCounts).map(([q, count]) => ({ label: q, value: count })) },
      ],
      tables: [
        {
          title: `Low Stock Alert (≤ ${LOW_STOCK_THRESHOLD} units)`,
          columns: LOW_STOCK_COLUMNS,
          rows: lowStock.map((p) => ({ Code: p.Code, Name: p.Name, Quantity: p.Quantity, Status: p.Status })),
        },
        {
          title: `All ${tab === "cloth" ? "Cloth" : "Yarn"} Products`,
          columns: PRODUCT_COLUMNS,
          rows: products.map((p) => ({
            Code: p.Code, Name: p.Name, SubType: p.SubType, Quality: p.Quality,
            Price: p.Price, Quantity: p.Quantity, Status: p.Status,
          })),
        },
      ],
    });
  };

  const card = cardStyle(themeG), cardTitle = cardTitleStyle(themeG), statCard = statCardStyle(themeG);
  const th = { textAlign: "left", fontSize: 11, color: themeG.textLabel, padding: "10px 12px", borderBottom: "1px solid rgba(46,122,114,0.13)", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 };
  const td = { padding: "11px 12px", fontSize: 13.5, color: themeG.textMain };

  return (
    <>
      {error && <div style={errorBoxStyle}>{error}</div>}

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 18px", borderRadius: 10, background: themeG.card, border: `1px solid ${themeG.border}` }}>
          <span style={{ fontSize: 18 }}>{tab === "cloth" ? "👘" : "🧵"}</span>
          <span style={{ fontFamily: FONT, fontSize: 14, fontWeight: 700, color: themeG.textMain }}>{tab === "cloth" ? "Cloth" : "Yarn"} Products</span>
        </div>
        {/* <span style={{ fontSize: 12, color: themeG.accent, cursor: "pointer", textDecoration: "underline" }} onClick={() => navigate("/select-category")}>Switch category</span> */}
        <div style={{ marginLeft: "auto" }}>
          <ExportButton onClick={exportExcel} disabled={products.length === 0} themeG={themeG} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
        {[
          { label: "Total Products", value: products.length, accent: "#2E7A72" },
          { label: "Units in Stock", value: totalQty.toLocaleString(), accent: "#1E4A45" },
          { label: "Inventory Value", value: `₹${totalValue.toLocaleString()}`, accent: "#5B9BD9" },
          { label: "Low Stock Items", value: lowStock.length, accent: lowStock.length > 0 ? "#B23A3A" : "#2E7A72" },
        ].map((c) => (
          <div key={c.label} style={statCard}>
            <p style={{ fontSize: 12, color: themeG.textLabel, margin: "0 0 6px", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em" }}>{c.label}</p>
            <p style={{ fontSize: 24, fontWeight: 700, margin: 0, color: c.accent }}>{c.value}</p>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
        <ListBox title="Products by Sub-type" themeG={themeG} items={Object.entries(subTypeCounts).map(([t, count]) => ({ label: t, value: count }))} />
        <ListBox title="Products by Quality Grade" themeG={themeG} items={Object.entries(qualityCounts).map(([q, count]) => ({ label: q, value: count, color: qualityColor[q] || "#2E7A72" }))} />
      </div>

      <div style={card}>
        <h3 style={cardTitle}>Low Stock Alert (≤ {LOW_STOCK_THRESHOLD} units)</h3>
        {lowStock.length === 0 ? (
          <p style={{ fontSize: 13, color: themeG.textSub }}>All products are well-stocked. 🎉</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>{["Code", "Name", "Quantity", "Status"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {lowStock.map((p) => (
                <tr key={p.Id} style={{ borderBottom: "1px solid rgba(46,122,114,0.08)" }}>
                  <td style={td}>{p.Code}</td><td style={td}>{p.Name}</td>
                  <td style={{ ...td, fontWeight: 700, color: "#B23A3A" }}>{p.Quantity}</td><td style={td}>{p.Status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

const ORDER_COLUMNS = [
  { key: "Code", header: "Order No." }, { key: "Customer", header: "Customer" },
  { key: "Product", header: "Product" }, { key: "Quantity", header: "Quantity" },
  { key: "TotalAmount", header: "Total Amount" }, { key: "Status", header: "Status" },
  { key: "PaymentStatus", header: "Payment Status" }, { key: "CreatedAt", header: "Created" },
];

function DataReportOrders({ themeG }) {
  const navigate = useNavigate();
  const tab = localStorage.getItem("premier_category") || "cloth";
  const [allOrders, setAllOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try { setAllOrders((await API.get("/orders")).data); }
      catch { setError("Failed to load order report data."); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <p style={{ color: themeG.textSub }}>Loading report…</p>;

  const orders = allOrders.filter((o) => o.Category === tab);
  const statusCounts = groupBy(orders, (o) => o.Status);
  const paymentCounts = groupBy(orders, (o) => o.PaymentStatus);
  const subTypeCounts = groupBy(orders, (o) => o.SubType || "—");
  const totalRevenue = orders.reduce((s, o) => s + (parseFloat(o.TotalAmount) || 0), 0);
  const avgOrderValue = orders.length ? totalRevenue / orders.length : 0;
  const byDate = groupBy(orders, (o) => (o.CreatedAt ? fmtDate(o.CreatedAt) : "—"));
  const byDateSorted = Object.entries(byDate).sort((a, b) => new Date(a[0]) - new Date(b[0]));

  const exportExcel = () => {
    exportReportToExcel({
      reportTitle: `Order Report (${tab === "cloth" ? "Cloth" : "Yarn"})`,
      filename: `order-report-${tab}-${todayStamp()}`,
      stats: [
        { label: "Total Orders", value: orders.length },
        { label: "Total Revenue", value: `₹${totalRevenue.toLocaleString()}` },
        { label: "Avg Order Value", value: `₹${avgOrderValue.toFixed(0)}` },
        { label: "Pending Orders", value: statusCounts.pending || 0 },
      ],
      breakdowns: [
        { title: "Orders by Status", items: Object.entries(statusCounts).map(([s, count]) => ({ label: s, value: count })) },
        { title: "Orders by Payment Status", items: Object.entries(paymentCounts).map(([p, count]) => ({ label: p, value: count })) },
        { title: "By Sub-type", items: Object.entries(subTypeCounts).map(([st, count]) => ({ label: st, value: count })) },
        { title: "Received By Day", items: byDateSorted.map(([day, count]) => ({ label: day, value: count })) },
      ],
      tables: [
        {
          title: `All ${tab === "cloth" ? "Cloth" : "Yarn"} Orders`,
          columns: ORDER_COLUMNS,
          rows: orders.map((o) => ({
            Code: o.Code, Customer: o.customer?.Name ?? "—", Product: o.product?.Name ?? "—",
            Quantity: o.Quantity, TotalAmount: o.TotalAmount, Status: o.Status,
            PaymentStatus: o.PaymentStatus, CreatedAt: fmtDate(o.CreatedAt),
          })),
        },
      ],
    });
  };

  const statCard = statCardStyle(themeG);

  return (
    <>
      {error && <div style={errorBoxStyle}>{error}</div>}

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 18px", borderRadius: 10, background: themeG.card, border: `1px solid ${themeG.border}` }}>
          <span style={{ fontSize: 18 }}>{tab === "cloth" ? "👘" : "🧵"}</span>
          <span style={{ fontFamily: FONT, fontSize: 14, fontWeight: 700, color: themeG.textMain }}>{tab === "cloth" ? "Cloth" : "Yarn"} Orders</span>
        </div>
        {/* <span style={{ fontSize: 12, color: themeG.accent, cursor: "pointer", textDecoration: "underline" }} onClick={() => navigate("/select-category")}>Switch category</span> */}
        <div style={{ marginLeft: "auto" }}>
          <ExportButton onClick={exportExcel} disabled={orders.length === 0} themeG={themeG} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
        {[
          { label: "Total Orders", value: orders.length, accent: "#2E7A72" },
          { label: "Total Revenue", value: `₹${totalRevenue.toLocaleString()}`, accent: "#1E4A45" },
          { label: "Avg Order Value", value: `₹${avgOrderValue.toFixed(0)}`, accent: "#5B9BD9" },
          { label: "Pending Orders", value: statusCounts.pending || 0, accent: "#8A5A0E" },
        ].map((c) => (
          <div key={c.label} style={statCard}>
            <p style={{ fontSize: 12, color: themeG.textLabel, margin: "0 0 6px", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: FONT }}>{c.label}</p>
            <p style={{ fontSize: 24, fontWeight: 700, margin: 0, color: c.accent, fontFamily: "'Space Grotesk', " + FONT }}>{c.value}</p>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
        <ListBox title="Orders by Status" themeG={themeG} items={Object.entries(statusCounts).map(([status, count]) => ({ label: status, value: count, color: statusColor(status).color }))} />
        <ListBox title="Orders by Payment Status" themeG={themeG} items={Object.entries(paymentCounts).map(([p, count]) => ({ label: p, value: count, color: statusColor(p === "paid" ? "approved" : p === "unpaid" ? "declined" : "pending").color }))} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <ListBox title="By Sub-type" themeG={themeG} items={Object.entries(subTypeCounts).map(([st, count]) => ({ label: st, value: count }))} emptyText="No orders yet." />
        <ListBox title="Received By Day" themeG={themeG} items={byDateSorted.slice(-8).map(([day, count]) => ({ label: day, value: count }))} />
      </div>
    </>
  );
}

const EMPLOYEE_COLUMNS = [
  { key: "Name", header: "Name" }, { key: "Designation", header: "Designation" },
  { key: "District", header: "District" }, { key: "Status", header: "Status" },
  { key: "JoinedAt", header: "Joined" },
];

function DataReportEmployees({ themeG }) {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try { setEmployees((await API.get("/employees")).data); }
      catch { setError("Failed to load employee report data."); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <p style={{ color: themeG.textSub, fontFamily: FONT }}>Loading report…</p>;

  const statusCounts = groupBy(employees, (e) => e.Status);
  const districtCounts = groupBy(employees, (e) => e.District);
  const designationCounts = groupBy(employees, (e) => e.Designation);

  const exportExcel = () => {
    exportReportToExcel({
      reportTitle: "Employee Report",
      filename: `employee-report-${todayStamp()}`,
      stats: [
        { label: "Total Employees", value: employees.length },
        { label: "Approved", value: statusCounts.approved || 0 },
        { label: "Pending Approval", value: statusCounts.pending || 0 },
      ],
      breakdowns: [
        { title: "By Status", items: Object.entries(statusCounts).map(([s, count]) => ({ label: s, value: count })) },
        { title: "By District", items: Object.entries(districtCounts).map(([d, count]) => ({ label: d, value: count })) },
        { title: "By Designation", items: Object.entries(designationCounts).map(([d, count]) => ({ label: d, value: count })) },
      ],
      tables: [
        {
          title: "All Employees",
          columns: EMPLOYEE_COLUMNS,
          rows: employees.map((e) => ({
            Name: e.Name, Designation: e.Designation, District: e.District,
            Status: e.Status, JoinedAt: fmtDate(e.JoinedAt),
          })),
        },
      ],
    });
  };

  const statCard = statCardStyle(themeG);

  return (
    <>
      {error && <div style={errorBoxStyle}>{error}</div>}

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <ExportButton onClick={exportExcel} disabled={employees.length === 0} themeG={themeG} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 24 }}>
        {[
          { label: "Total Employees", value: employees.length, accent: "#2E7A72" },
          { label: "Approved", value: statusCounts.approved || 0, accent: themeG.accent },
          { label: "Pending Approval", value: statusCounts.pending || 0, accent: "#8A5A0E" },
        ].map((c) => (
          <div key={c.label} style={statCard}>
            <p style={{ fontSize: 12, color: themeG.textLabel, margin: "0 0 6px", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: FONT }}>{c.label}</p>
            <p style={{ fontSize: 24, fontWeight: 700, margin: 0, color: c.accent, fontFamily: "'Space Grotesk', " + FONT }}>{c.value}</p>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20 }}>
        <ListBox title="By Status" themeG={themeG} items={Object.entries(statusCounts).map(([s, count]) => ({ label: s, value: count, color: statusColor(s).color }))} />
        <ListBox title="By District" themeG={themeG} items={Object.entries(districtCounts).map(([d, count]) => ({ label: d, value: count }))} />
        <ListBox title="By Designation" themeG={themeG} items={Object.entries(designationCounts).map(([d, count]) => ({ label: d, value: count }))} />
      </div>
    </>
  );
}

export default function DataReportPage() {
  const { isDark } = useTheme();
  const themeG = getG(isDark);
  const [pill, setPill] = useState("orders"); // products | orders | employees

  const pillBtn = (active) => ({
    padding: "8px 16px", borderRadius: 20, border: "1.5px solid", cursor: "pointer", fontFamily: FONT, fontSize: 12.5, fontWeight: 600,
    background: active ? themeG.accent : themeG.card, color: active ? "#fff" : themeG.textSub, borderColor: active ? themeG.accent : themeG.border,
  });

  return (
    <Layout pageTitle="Data Report">

      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {[["products", "Products"], ["orders", "Orders"], ["employees", "Employees"]].map(([key, label]) => (
          <button key={key} onClick={() => setPill(key)} style={pillBtn(pill === key)}>{label}</button>
        ))}
      </div>
      {pill === "products" && <DataReportProducts themeG={themeG} />}
      {pill === "orders" && <DataReportOrders themeG={themeG} />}
      {pill === "employees" && <DataReportEmployees themeG={themeG} />}
    </Layout>
  );
}