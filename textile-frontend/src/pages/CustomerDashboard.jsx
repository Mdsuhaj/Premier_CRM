// src/pages/CustomerDashboard.jsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import CustomerLayout from "../components/CustomerLayout";
import { useTheme } from "../ThemeContext";
import { getG, statusColor } from "../theme";
import API from "../services/api";
import { groupOrders } from "../utils/groupOrders";
import { Package, Hourglass, CheckCircle2, XCircle } from "lucide-react";

const FONT = "'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const PENDING_DISPATCH_STATUSES = ["approved", "processing"];
const DECLINED_STATUSES = ["declined", "rejected"];

function formatRevenue(total) {
  if (total >= 10000000) return `₹${(total / 10000000).toFixed(2)}Cr`;
  if (total >= 100000) return `₹${(total / 100000).toFixed(2)}L`;
  if (total >= 1000) return `₹${(total / 1000).toFixed(1)}K`;
  return `₹${total.toLocaleString()}`;
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}

const Badge = ({ text }) => {
  const s = statusColor(text);
  return (
    <span style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}`, padding: "3px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600 }}>
      {(text || "—").charAt(0).toUpperCase() + (text || "—").slice(1)}
    </span>
  );
};

export default function CustomerDashboard() {
  const { isDark } = useTheme();
  const themeG = getG(isDark);
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem("user") || "{}");

  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const styles = {
    topBar: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 30 },
    heading: { fontFamily: "'Space Grotesk', " + FONT, fontSize: 28, fontWeight: 700, margin: "0 0 4px", color: themeG.textMain, letterSpacing: "-0.4px" },
    headingSub: { fontSize: 13, color: themeG.textSub, margin: 0 },
    liveBadge: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "#164672", background: "rgba(91,155,217,0.12)", border: "1px solid rgba(91,155,217,0.28)", padding: "5px 14px", borderRadius: 20 },
    liveDot: { display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#2E7A72" },
    shopBtn: { padding: "9px 18px", borderRadius: 10, border: "none", background: themeG.accent, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: FONT, marginLeft: 12 },

    grid: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 30 },
    statCard: { background: themeG.card, border: `1px solid ${themeG.border}`, borderRadius: 14, padding: "20px 20px 18px", position: "relative", overflow: "hidden", boxShadow: "0 4px 16px rgba(15,33,56,0.06)" },
    cardStripe: { position: "absolute", top: 0, left: 0, right: 0, height: 3, borderRadius: "14px 14px 0 0" },
    cardIcon: { fontSize: 20, marginBottom: 10, display: "block" },
    cardLabel: { fontSize: 12, color: themeG.textLabel, margin: "0 0 6px", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em" },
    cardValue: { fontSize: 28, fontWeight: 700, margin: 0, letterSpacing: "-0.5px" },

    tableBox: { background: themeG.card, border: `1px solid ${themeG.border}`, borderRadius: 14, padding: "24px 26px", boxShadow: "0 4px 16px rgba(15,33,56,0.06)" },
    tableHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 },
    tableTitle: { fontFamily: FONT, fontSize: 17, fontWeight: 600, margin: 0, color: themeG.textMain },
    tableCount: { fontSize: 12, color: themeG.textSub, background: "rgba(15,33,56,0.09)", padding: "3px 10px", borderRadius: 20, border: "1px solid rgba(15,33,56,0.18)" },
    viewAllLink: { fontSize: 12.5, color: themeG.accent, fontWeight: 600, cursor: "pointer", background: "none", border: "none", fontFamily: FONT },
    table: { width: "100%", borderCollapse: "separate", borderSpacing: 0 },
    th: { textAlign: "center", fontSize: 11, color: "#ffffff", background: "#1f3a63", padding: "8px 12px", borderBottom: `1px solid ${themeG.border}`, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }, tr: { borderBottom: `1px solid ${themeG.border}` },
    td: { padding: "13px 12px", fontSize: 14, color: themeG.textMain, borderBottom: `1px solid ${themeG.border}`, textAlign: "center" },

    sectionTitle: { fontFamily: "'Space Grotesk', " + FONT, fontSize: 20, fontWeight: 700, margin: "36px 0 4px", color: themeG.textMain },
    sectionSub: { fontSize: 12.5, color: themeG.textSub, margin: "0 0 16px" },
    miniGrid: (cols) => ({ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 14, marginBottom: 22 }),
    miniCard: { background: themeG.card, border: `1px solid ${themeG.border}`, borderRadius: 12, padding: "16px 18px", boxShadow: "0 3px 12px rgba(15,33,56,0.05)" },
    miniLabel: { fontSize: 11, color: themeG.textLabel, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, margin: "0 0 6px" },
    miniValue: { fontSize: 22, fontWeight: 700, margin: 0, color: themeG.textMain },
    widgetBox: { background: themeG.card, border: `1px solid ${themeG.border}`, borderRadius: 14, padding: "18px 20px", boxShadow: "0 3px 12px rgba(15,33,56,0.05)", marginBottom: 22 },
    widgetTitle: { fontSize: 14.5, fontWeight: 700, color: themeG.textMain, margin: "0 0 12px" },
    smallTable: { width: "100%", borderCollapse: "collapse", fontSize: 12.5 },
    smallTh: { textAlign: "center", padding: "6px 8px", color: themeG.textLabel, fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: `1px solid ${themeG.border}` },
    smallTd: { padding: "8px 8px", color: themeG.textMain, borderBottom: `1px solid ${themeG.border}`, textAlign: "center" },
    emptyNote: { fontSize: 12.5, color: themeG.textSub, padding: "8px 0" },
    approxNote: { fontSize: 11, color: themeG.textSub, fontStyle: "italic", marginTop: 10 },
  };

  useEffect(() => {
    const role = localStorage.getItem("role");
    if (role !== "customer") { navigate("/login"); return; }
    (async () => {
      try {
        const [orderRes, prodRes] = await Promise.all([
          API.get("/orders"),
          API.get("/products", { params: { status: "active" } }),
        ]);
        setOrders(orderRes.data);
        setProducts(prodRes.data);
      } catch {
        setError("Failed to load your dashboard. Please refresh.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line
  }, []);

  const norm = (s) => (s || "").toLowerCase();

  // ── Every multi-product order collapses to one entry here — all the
  // metrics below (stat cards, Recent Orders, Enquiry Status, Dispatch
  // Status, aging, declined, duplicates, long-pending) count/list
  // ORDERS, so they all read off this instead of the raw rows. Only
  // the product-wise breakdown further down stays row-based, since
  // that's deliberately counting per-product occurrences. ──
  const groupedOrders = groupOrders(orders);

  // ── Top stat cards count actual order rows (matches "My Orders"),
  // not cart-checkout groups. A grouped cart's displayed status is
  // just its first row's status (see groupOrders.js), so counting by
  // group hid every other item in a multi-status cart — a cart with
  // 4 Pending + 1 Processing item showed as 1 "Processing" order and
  // 0 Pending, instead of 4 Pending + 1 Processing. ──
  const total = orders.length;

  // ── Enquiry Status (now shown as the top 4 pills) ──
  const enquiryStatus = {
    total,
    pending: orders.filter(o => norm(o.Status) === "pending").length,
    approvedPlus: orders.filter(o => ["approved", "processing", "dispatched", "delivered"].includes(norm(o.Status))).length,
    declined: orders.filter(o => DECLINED_STATUSES.includes(norm(o.Status))).length,
  };

  const statCards = [
    { label: "Total", value: loading ? "—" : enquiryStatus.total.toLocaleString(), icon: Package, accent: "#2E7A72" },
    { label: "Pending", value: loading ? "—" : enquiryStatus.pending.toLocaleString(), icon: Hourglass, accent: "#D69426" },
    { label: "Approved+", value: loading ? "—" : enquiryStatus.approvedPlus.toLocaleString(), icon: CheckCircle2, accent: "#1E4A45" },
    { label: "Declined", value: loading ? "—" : enquiryStatus.declined.toLocaleString(), icon: XCircle, accent: "#B23A3A" },
  ];

  // ── Recent orders ──
  const recentOrders = [...groupedOrders]
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, 5);

  // ── Product-wise breakdown of my enquiries — deliberately stays
  // row-based (per product), not order-based, since a single order
  // with 2 products should count as 1 for each of those products. ──
  const productWiseMap = {};
  orders.forEach((o) => {
    const name = o.product?.Name || "—";
    if (!productWiseMap[name]) productWiseMap[name] = { product: name, count: 0, qty: 0 };
    productWiseMap[name].count += 1;
    productWiseMap[name].qty += Number(o.Quantity) || 0;
  });
  const productWise = Object.values(productWiseMap).sort((a, b) => b.count - a.count).slice(0, 10);

  // ── Dispatch Status ──
  const dispatchStatus = {
    dispatched: groupedOrders.filter(g => norm(g.status) === "dispatched").length,
    pendingDispatch: groupedOrders.filter(g => PENDING_DISPATCH_STATUSES.includes(norm(g.status))).length,
    delivered: groupedOrders.filter(g => norm(g.status) === "delivered").length,
  };

  // ── Pending Dispatch Aging ──
  const pendingDispatchOrders = groupedOrders
    .filter(g => PENDING_DISPATCH_STATUSES.includes(norm(g.status)))
    .map(g => ({ code: g.code, customer: user.name || "You", status: g.status, days: daysSince(g.createdAt) ?? 0 }))
    .sort((a, b) => b.days - a.days);

  const agingBuckets = { "0-1": 0, "2-3": 0, "4+": 0 };
  pendingDispatchOrders.forEach((o) => {
    if (o.days <= 1) agingBuckets["0-1"] += 1;
    else if (o.days <= 3) agingBuckets["2-3"] += 1;
    else agingBuckets["4+"] += 1;
  });

  // ── Stock Shortage (my pending enquiries where requested qty exceeds
  // current stock) — checked per underlying product row, since stock is
  // tracked per product, but reported against the parent order's code. ──
  const stockShortage = orders
    .filter(o => norm(o.Status) === "pending")
    .map((o) => {
      const prod = products.find(p => p.Id === o.product?.Id || p.Id === o.ProductId);
      const available = prod ? prod.Quantity : null;
      const code = o.OrderDetails?.EnquiryOrderNo || o.Code;
      return { code, product: o.product?.Name || "—", requested: o.Quantity, available };
    })
    .filter(r => r.available !== null && r.requested > r.available);

  // ── Declined enquiries (value at risk) ──
  const declinedOrders = groupedOrders.filter(g => DECLINED_STATUSES.includes(norm(g.status)));
  const declinedValue = declinedOrders.reduce((sum, g) => sum + g.totalAmount, 0);

  // ── Long pending orders (approved/processing 3+ days, no dispatch yet) ──
  const longPendingOrders = pendingDispatchOrders.filter(o => o.days >= 3);

  return (
    <CustomerLayout>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {/* Top bar */}
      <div style={styles.topBar}>
        {/* <div>
          <h1 style={styles.heading}>Dashboard</h1>
          <p style={styles.headingSub}>Welcome back, {user.name || "Customer"}</p>
        </div> */}
        <div style={{ display: "flex", alignItems: "center" }}>

          <button style={styles.shopBtn} onClick={() => navigate("/customer/catalog")}>🛍️ Continue Shopping</button>
        </div>
      </div>

      {error && (
        <div style={{ marginBottom: 20, background: "rgba(178,58,58,0.08)", border: "1px solid rgba(178,58,58,0.25)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#B23A3A" }}>
          {error}
        </div>
      )}

      {/* Stat cards — Enquiry Status */}
      <div style={styles.grid}>
        {statCards.map((card) => (
          <div key={card.label} style={styles.statCard}>
            <div style={{ ...styles.cardStripe, background: card.accent }} />
            <card.icon size={22} color={card.accent} style={styles.cardIcon} />
            <p style={styles.cardLabel}>{card.label}</p>
            <p style={{ ...styles.cardValue, color: card.accent }}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Recent orders table */}
      <div style={styles.tableBox}>
        <div style={styles.tableHeader}>
          <h2 style={styles.tableTitle}>Recent Orders</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={styles.tableCount}>{recentOrders.length} records</span>
            <button style={styles.viewAllLink} onClick={() => navigate("/customer/orders")}>View all →</button>
          </div>
        </div>
        <table style={styles.table}>
          <thead>
            <tr>
              {["S.No", "Enquiry No", "Enquiry Date", "Product", "Quantity", "Status"].map((h, i, arr) => (
                <th
                  key={h}
                  style={{
                    ...styles.th,
                    borderTopLeftRadius: i === 0 ? 14 : 0,
                    borderTopRightRadius: i === arr.length - 1 ? 14 : 0,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ ...styles.td, textAlign: "center", padding: 30 }}>Loading recent orders…</td></tr>
            ) : recentOrders.length === 0 ? (
              <tr><td colSpan={6} style={{ ...styles.td, textAlign: "center", padding: 30 }}>No orders yet — head to the Product Catalog to place your first enquiry.</td></tr>
            ) : recentOrders.map((g, i) => (
              <tr key={g.groupKey} style={styles.tr}>
                <td style={styles.td}>{i + 1}</td>
                <td style={{ ...styles.td, color: themeG.accent, fontWeight: 600 }}>{g.code}</td>
                <td style={styles.td}>{g.createdAt ? String(g.createdAt).substring(0, 10) : "—"}</td>
                <td style={styles.td}>{g.productLabel}</td>
                <td style={styles.td}>{g.totalQty.toLocaleString()}</td>
                <td style={styles.td}><Badge text={g.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!loading && (
        <>
          {/* 1. Product-wise breakdown */}
          <h2 style={styles.sectionTitle}>Products I've Ordered</h2>
          <p style={styles.sectionSub}>Your most-enquired products, by number of orders.</p>
          <div style={styles.widgetBox}>
            {productWise.length === 0 ? <p style={styles.emptyNote}>No orders yet.</p> : (
              <table style={styles.smallTable}>
                <thead><tr><th style={styles.smallTh}>Product</th><th style={styles.smallTh}>Orders</th><th style={styles.smallTh}>Total Qty</th></tr></thead>
                <tbody>
                  {productWise.map((p, i) => (
                    <tr key={i}><td style={styles.smallTd}>{p.product}</td><td style={styles.smallTd}>{p.count}</td><td style={styles.smallTd}>{p.qty}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* 2. Dispatch Status */}
          <h2 style={styles.sectionTitle}>Dispatch Status</h2>
          <div style={styles.miniGrid(3)}>
            {[
              ["Dispatched", dispatchStatus.dispatched, "#3A2560"],
              ["Pending Dispatch", dispatchStatus.pendingDispatch, "#D69426"],
              ["Delivered", dispatchStatus.delivered, "#1E4A45"],
            ].map(([label, val, color]) => (
              <div key={label} style={styles.miniCard}>
                <p style={styles.miniLabel}>{label}</p>
                <p style={{ ...styles.miniValue, color }}>{val}</p>
              </div>
            ))}
          </div>

          {/* 3. Pending Dispatch Aging */}
          <h2 style={styles.sectionTitle}>Pending Dispatch — Aging</h2>
          <p style={styles.sectionSub}>How long your approved orders have been waiting to ship.</p>
          <div style={styles.miniGrid(3)}>
            {[
              ["0–1 days", agingBuckets["0-1"], "#1E4A45"],
              ["2–3 days", agingBuckets["2-3"], "#D69426"],
              ["4+ days", agingBuckets["4+"], "#B23A3A"],
            ].map(([label, val, color]) => (
              <div key={label} style={styles.miniCard}>
                <p style={styles.miniLabel}>{label}</p>
                <p style={{ ...styles.miniValue, color }}>{val}</p>
              </div>
            ))}
          </div>
          <div style={styles.widgetBox}>
            <p style={styles.widgetTitle}>Oldest pending dispatch</p>
            {pendingDispatchOrders.length === 0 ? <p style={styles.emptyNote}>Nothing pending dispatch 🎉</p> : (
              <table style={styles.smallTable}>
                <thead><tr><th style={styles.smallTh}>Order</th><th style={styles.smallTh}>Status</th><th style={styles.smallTh}>Days Pending</th></tr></thead>
                <tbody>
                  {pendingDispatchOrders.slice(0, 5).map((r, i) => (
                    <tr key={i}><td style={styles.smallTd}>{r.code}</td><td style={styles.smallTd}>{r.status}</td><td style={styles.smallTd}>{r.days}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* 4. Stock Shortage on my pending enquiries
          <h2 style={styles.sectionTitle}>Enquiries Awaiting — Stock Shortage</h2>
          <p style={styles.sectionSub}>Pending enquiries where you've requested more than is currently in stock.</p>
          <div style={styles.widgetBox}>
            {stockShortage.length === 0 ? <p style={styles.emptyNote}>None of your pending enquiries are affected by stock shortage.</p> : (
              <table style={styles.smallTable}>
                <thead><tr><th style={styles.smallTh}>Order</th><th style={styles.smallTh}>Product</th><th style={styles.smallTh}>Requested</th><th style={styles.smallTh}>Available</th></tr></thead>
                <tbody>
                  {stockShortage.map((r, i) => (
                    <tr key={i}><td style={styles.smallTd}>{r.code}</td><td style={styles.smallTd}>{r.product}</td><td style={styles.smallTd}>{r.requested}</td><td style={{ ...styles.smallTd, color: "#B23A3A", fontWeight: 600 }}>{r.available}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div> */}

          {/* 5. Declined enquiries */}
          <h2 style={styles.sectionTitle}>Declined Enquiries</h2>
          <div style={styles.miniGrid(2)}>
            <div style={styles.miniCard}>
              <p style={styles.miniLabel}>Declined Enquiries</p>
              <p style={{ ...styles.miniValue, color: "#B23A3A" }}>{declinedOrders.length}</p>
            </div>
            <div style={styles.miniCard}>
              <p style={styles.miniLabel}>Value Affected</p>
              <p style={{ ...styles.miniValue, color: "#B23A3A" }}>₹{declinedValue.toLocaleString()}</p>
            </div>
          </div>
          {declinedOrders.length > 0 && (
            <div style={styles.widgetBox}>
              <table style={styles.smallTable}>
                <thead><tr><th style={styles.smallTh}>Order</th><th style={styles.smallTh}>Value</th><th style={styles.smallTh}>Notes</th></tr></thead>
                <tbody>
                  {declinedOrders.map((g) => (
                    <tr key={g.groupKey}><td style={styles.smallTd}>{g.code}</td><td style={styles.smallTd}>₹{g.totalAmount.toLocaleString()}</td><td style={styles.smallTd}>{g.notes || "—"}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 6. Long pending orders */}
          <h2 style={styles.sectionTitle}>Long Pending Orders</h2>
          <p style={styles.sectionSub}>Approved or processing for 3+ days without dispatch — you may want to follow up.</p>
          <div style={styles.widgetBox}>
            {longPendingOrders.length === 0 ? <p style={styles.emptyNote}>Nothing long-pending 🎉</p> : (
              <table style={styles.smallTable}>
                <thead><tr><th style={styles.smallTh}>Order</th><th style={styles.smallTh}>Status</th><th style={styles.smallTh}>Days Pending</th></tr></thead>
                <tbody>
                  {longPendingOrders.map((r, i) => (
                    <tr key={i}><td style={styles.smallTd}>{r.code}</td><td style={styles.smallTd}>{r.status}</td><td style={{ ...styles.smallTd, color: "#B23A3A", fontWeight: 600 }}>{r.days}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <p style={styles.approxNote}>All figures above are based on your own orders only.</p>
        </>
      )}
    </CustomerLayout>
  );
}