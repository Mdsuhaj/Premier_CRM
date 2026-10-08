// src/pages/Dashboard.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import ErrorBoundary from "../components/ErrorBoundary";
import { useTheme } from "../ThemeContext";
import API from "../services/api";
import { DonutChart, BarChart, GroupedBarChart, AreaChart } from "../components/charts/MiniCharts";

import logo from '/premier-icon.png'

const ACTIVE_STATUSES = ["pending", "approved", "processing"];

/* ────────────────────────────────────────────────────────────────────────
   DESIGN TOKENS
   "Sapphire & Saffron" operations-ledger palette — deep navy surfaces,
   sapphire/turmeric accents, monospace for figures so numbers read like
   a ledger, not a marketing stat.
   ──────────────────────────────────────────────────────────────────────── */
function getTokens(isDark) {
  return isDark
    ? {
        bg: "#081422",
        card: "#0F2138",
        cardAlt: "#16324F",
        border: "rgba(234,239,245,0.10)",
        borderStrong: "rgba(234,239,245,0.18)",
        ink: "#F5F7FA",
        inkSub: "#9FB5CC",
        inkFaint: "#6B7F99",
        forest: "#5B9BD9",
        ochre: "#EEC15E",
        indigo: "#8C7BC7",
        danger: "#D97C7C",
        sage: "#5FA89C",
      }
    : {
        bg: "#F5F7FA",
        card: "#FFFFFF",
        cardAlt: "#EAEFF5",
        border: "rgba(15,33,56,0.10)",
        borderStrong: "rgba(15,33,56,0.16)",
        ink: "#0F2138",
        inkSub: "#526073",
        inkFaint: "#8C96A3",
        forest: "#1F5C99",
        ochre: "#D69426",
        indigo: "#4A2E7A",
        danger: "#B23A3A",
        sage: "#2E7A72",
      };
}

const FONT_HEAD = "'Space Grotesk', 'Inter', sans-serif";
const FONT_UI = "'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const FONT_MONO = "'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace";

function formatRevenue(total) {
  if (total >= 10000000) return `₹${(total / 10000000).toFixed(2)}Cr`;
  if (total >= 100000)   return `₹${(total / 100000).toFixed(2)}L`;
  if (total >= 1000)     return `₹${(total / 1000).toFixed(1)}K`;
  return `₹${total.toLocaleString()}`;
}

function statusTone(s, t) {
  if (s === "delivered")  return t.forest;
  if (s === "dispatched") return t.indigo;
  if (s === "pending")    return t.ochre;
  if (s === "declined" || s === "rejected") return t.danger;
  return t.inkSub;
}

/* Minimal line icons — no emoji. Stroke-based, single color via currentColor. */
const IconUsers = (p) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...p}>
    <circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c0-3.3 2.5-5.3 5.5-5.3s5.5 2 5.5 5.3" />
    <circle cx="17" cy="8.5" r="2.4" opacity="0.55" /><path d="M15.5 13.3c2.4.2 4 2 4 5" opacity="0.55" />
  </svg>
);
const IconCrate = (p) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...p}>
    <path d="M3 8.2 12 4l9 4.2v9.6L12 22l-9-4.2z" /><path d="M3 8.2 12 12l9-4" /><path d="M12 12v10" opacity="0.55" />
  </svg>
);
const IconSpool = (p) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...p}>
    <ellipse cx="12" cy="6" rx="7" ry="2.6" /><ellipse cx="12" cy="18" rx="7" ry="2.6" />
    <path d="M5 6v12M19 6v12" /><path d="M6.5 8c3 2 8 2 11 0M6.5 16c3-2 8-2 11 0" opacity="0.6" />
  </svg>
);
const IconTrend = (p) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...p}>
    <path d="M3.5 17 9 10.5l4 3.5L20.5 6" /><path d="M14.5 6H20.5V12" opacity="0.7" />
  </svg>
);
const IconRefresh = (p) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" {...p}>
    <path d="M20 11A8 8 0 1 0 18.5 16" /><path d="M20 5v6h-6" />
  </svg>
);

/* Icons for the CottonMass-style O2C stat cards */
const IconClipboard = (p) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
    <rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
    <path d="M9 11h6M9 15h6" />
  </svg>
);
const IconCheckCircle = (p) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
    <circle cx="12" cy="12" r="9" /><path d="M8.5 12.3l2.4 2.4 4.8-5.2" />
  </svg>
);
const IconFileWarning = (p) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
    <path d="M7 3h7l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
    <path d="M14 3v4h4" /><path d="M12 11v4" /><circle cx="12" cy="17.6" r="0.6" fill="currentColor" stroke="none" />
  </svg>
);
const IconCart = (p) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
    <circle cx="9" cy="20" r="1.3" /><circle cx="17" cy="20" r="1.3" />
    <path d="M2.5 3h2l2.4 12.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.6L20 7H6" />
  </svg>
);
const IconAtom = (p) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
    <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <ellipse cx="12" cy="12" rx="9" ry="3.6" />
    <ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(60 12 12)" />
    <ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(120 12 12)" />
  </svg>
);
const IconClock = (p) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
    <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.3 2" />
  </svg>
);
const IconTrendDown = (p) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
    <path d="M3.5 7 9 13.5l4-3.5 6.5 8" /><path d="M19.5 12v6.5H13" />
  </svg>
);
const IconTimer = (p) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
    <path d="M10 2h4" /><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 1.5" /><path d="M19 6.5l1.2 1.2" />
  </svg>
);

/* Icons for the Production section */
const IconFactory = (p) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
    <path d="M3 21V10l6 4v-4l6 4V6l6 4v11z" /><path d="M3 21h18" />
  </svg>
);
const IconGauge = (p) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
    <circle cx="12" cy="13" r="8" /><path d="M12 13l4-4" /><path d="M8 13h.01M12 21v.01M16 13h.01" />
  </svg>
);
const IconLayers = (p) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
    <path d="M12 2 2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
  </svg>
);
const IconAlertTriangle = (p) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
    <path d="M12 3 2 20h20L12 3z" /><path d="M12 10v4" /><circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
  </svg>
);

const MOTION_CSS = `
@keyframes pdFadeUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
@keyframes pdShimmer { 0% { background-position: -180px 0; } 100% { background-position: 180px 0; } }
@keyframes pdSpin { to { transform: rotate(360deg); } }
.pd-fade-up { animation: pdFadeUp 0.4s cubic-bezier(0.16,1,0.3,1) both; }
.pd-skel { background-size: 400px 100%; animation: pdShimmer 1.4s ease-in-out infinite; border-radius: 4px; }
.pd-refresh:hover { border-color: var(--pd-strong); }
.pd-refresh:active { transform: scale(0.96); }
.pd-refresh:focus-visible, .pd-row:focus-visible { outline: 2px solid var(--pd-forest); outline-offset: 2px; }
.pd-spin { animation: pdSpin 0.7s linear infinite; }
.pd-row:hover { background: var(--pd-cardalt); }
.pd-stat:hover { border-color: var(--pd-strong); }
@media (prefers-reduced-motion: reduce) {
  .pd-fade-up, .pd-skel, .pd-spin { animation: none; }
}
`;

export default function Dashboard() {
  const { isDark } = useTheme();
  const t = getTokens(isDark);
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem("user") || "{}");

  const [stats, setStats] = useState({ customers: null, activeOrders: null, products: null, revenue: null });
  const [recentOrders, setRecentOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [o2c, setO2c] = useState(null);
  const [o2cLoading, setO2cLoading] = useState(true);
  const [weeklyTrend, setWeeklyTrend] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const styles = {
    page: { "--pd-strong": t.borderStrong, "--pd-cardalt": t.cardAlt, "--pd-forest": t.forest },

    topBar: { display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 34, gap: 16, flexWrap: "wrap", borderBottom: `1px solid ${t.border}`, paddingBottom: 20 },
    kicker: { fontFamily: FONT_MONO, fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: t.inkFaint, margin: "0 0 6px" },
    heading: { fontFamily: FONT_HEAD, fontSize: 32, fontWeight: 600, margin: 0, color: t.ink, letterSpacing: "-0.01em" },
    headingSub: { fontFamily: FONT_UI, fontSize: 13, color: t.inkSub, margin: "6px 0 0" },
    topBarRight: { display: "flex", alignItems: "center", gap: 14 },
    liveWrap: { display: "flex", alignItems: "center", gap: 7, fontFamily: FONT_MONO, fontSize: 11.5, color: t.inkSub },
    liveDot: { display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: loading ? t.ochre : t.forest },
    lastUpdated: { fontFamily: FONT_MONO, fontSize: 11, color: t.inkFaint },
    refreshBtn: { display: "flex", alignItems: "center", gap: 7, fontFamily: FONT_UI, fontSize: 12.5, fontWeight: 600, color: t.ink, background: "transparent", border: `1px solid ${t.border}`, padding: "7px 14px", borderRadius: 8, cursor: "pointer" },

    // Ledger-style stat strip: one bordered row, hairline dividers, no shadow.
    statStrip: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", border: `1px solid ${t.border}`, borderRadius: 10, marginBottom: 34, overflow: "hidden" },
    statCell: { padding: "14px 16px", borderRight: `1px solid ${t.border}`, background: t.card },
    statTop: { display: "flex", alignItems: "center", gap: 7, color: t.inkFaint, marginBottom: 9 },
    statLabel: { fontFamily: FONT_UI, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: t.inkFaint },
    statValue: { fontFamily: FONT_MONO, fontSize: 21, fontWeight: 600, color: t.ink, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" },

    tableBox: { background: t.card, border: `1px solid ${t.border}`, borderRadius: 10, padding: "26px 28px", marginBottom: 8 },
    tableHeader: { display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 20 },
    tableTitle: { fontFamily: FONT_HEAD, fontSize: 19, fontWeight: 600, margin: 0, color: t.ink },
    tableCount: { fontFamily: FONT_MONO, fontSize: 11.5, color: t.inkFaint },
    rowChip: { fontFamily: FONT_UI, fontSize: 11, fontWeight: 600, textTransform: "capitalize", color: (s) => statusTone(s, t) },
    emptyState: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: "40px 20px", textAlign: "center" },
    emptyText: { fontFamily: FONT_UI, fontSize: 13.5, color: t.inkSub, margin: 0, maxWidth: 320 },

    sectionHead: { display: "flex", alignItems: "baseline", gap: 12, margin: "44px 0 4px" },
    stageNum: { fontFamily: FONT_MONO, fontSize: 12, color: t.inkFaint, letterSpacing: "0.04em" },
    sectionTitle: { fontFamily: FONT_HEAD, fontSize: 21, fontWeight: 600, margin: 0, color: t.ink },
    sectionSub: { fontFamily: FONT_UI, fontSize: 12.5, color: t.inkSub, margin: "6px 0 16px" },

    miniGrid: (cols) => ({ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 10, marginBottom: 16 }),
    miniCard: { background: t.card, border: `1px solid ${t.border}`, borderRadius: 8, padding: "11px 13px" },
    miniLabel: { fontFamily: FONT_UI, fontSize: 10, color: t.inkFaint, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, margin: "0 0 5px" },
    miniValue: { fontFamily: FONT_MONO, fontSize: 17, fontWeight: 600, margin: 0, fontVariantNumeric: "tabular-nums" },

    twoCol: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 },
    widgetBox: { background: t.card, border: `1px solid ${t.border}`, borderRadius: 10, padding: "15px 17px", marginBottom: 16 },
    widgetTitle: { fontFamily: FONT_UI, fontSize: 13.5, fontWeight: 700, color: t.ink, margin: "0 0 12px" },
    emptyNote: { fontFamily: FONT_UI, fontSize: 12.5, color: t.inkSub, padding: "6px 0" },
    approxNote: { fontFamily: FONT_UI, fontSize: 11.5, color: t.inkFaint, fontStyle: "italic", marginTop: 12 },

    chartRow: { display: "grid", gridTemplateColumns: "1fr auto", gap: 14, alignItems: "stretch", marginBottom: 22 },
    chartCard: { background: t.card, border: `1px solid ${t.border}`, borderRadius: 8, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "center" },

    // ── CottonMass-style O2C snapshot: labeled 4-per-row card grids + 3-chart row ──
    o2cHead: { fontFamily: FONT_HEAD, fontSize: 19, fontWeight: 600, margin: "0 0 12px", color: t.ink },
    // Section label sits above each group of cards ("Enquiry Summary" /
    // "Order Summary") so the two groups read as distinct blocks even
    // though every card uses the same look.
    o2cSectionLabel: { fontFamily: FONT_HEAD, fontSize: 15, fontWeight: 700, margin: "0 0 10px", color: t.ink, display: "flex", alignItems: "center", gap: 8 },
    o2cGrid: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 },
    o2cCard: { background: t.card, border: `1px solid ${t.border}`, borderRadius: 12, padding: "13px 15px", boxShadow: isDark ? "none" : "0 1px 2px rgba(15,33,56,0.05), 0 8px 20px -16px rgba(15,33,56,0.18)" },
    o2cCardTop: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 },
    o2cLabel: { fontFamily: FONT_UI, fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: t.inkFaint, maxWidth: 120 },
    o2cIconChip: (color) => ({ width: 26, height: 26, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: `${color}1A`, color }),
    o2cValue: { fontFamily: FONT_HEAD, fontSize: 22, fontWeight: 700, margin: "0 0 3px", color: t.ink, letterSpacing: "-0.01em" },
    o2cSub: { fontFamily: FONT_UI, fontSize: 11, color: t.inkSub, margin: 0 },

    o2cChartsRow: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 8 },
    o2cChartCard: { background: t.card, border: `1px solid ${t.border}`, borderRadius: 12, padding: "14px 16px", boxShadow: isDark ? "none" : "0 1px 2px rgba(15,33,56,0.05), 0 8px 20px -16px rgba(15,33,56,0.18)" },
    o2cChartTitle: { fontFamily: FONT_HEAD, fontSize: 13, fontWeight: 600, margin: "0 0 10px", color: t.ink, display: "flex", alignItems: "center", gap: 8 },
  };

  useEffect(() => {
    const role = localStorage.getItem("role");
    if (!role) { navigate("/login"); return; }
    if (role === "customer") { navigate("/customer/dashboard"); return; }
    if (role === "end_user") { navigate("/end-user/dashboard"); return; }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError("");
      try {
        const [custRes, prodRes, orderRes] = await Promise.all([
          API.get("/customers"), API.get("/products"), API.get("/orders"),
        ]);
        const customers = custRes.data, products = prodRes.data, orders = orderRes.data;
        const activeOrders = orders.filter((o) => ACTIVE_STATUSES.includes(o.Status));
        const totalRevenue = orders.reduce((sum, o) => sum + (parseFloat(o.TotalAmount) || 0), 0);

        setStats({
          customers:    customers.length,
          activeOrders: activeOrders.length,
          products:     products.length,
          revenue:      formatRevenue(totalRevenue),
        });

        setRecentOrders(
          orders.slice(0, 4).map((o) => ({
            id: o.Code,
            customer: o.customer?.Name ?? "—",
            product: o.product?.Name ?? "—",
            amount: `₹${(parseFloat(o.TotalAmount) || 0).toLocaleString()}`,
            status: o.Status,
          }))
        );

        // Weekly dispatch trend — derived from real order timestamps, Mon..Sun.
        const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
        let sawDate = false;
        const dayCounts = [0, 0, 0, 0, 0, 0, 0];
        orders.forEach((o) => {
          const raw = o.CreatedAt || o.created_at || o.OrderDate || o.order_date || o.DispatchDate || o.dispatch_date;
          if (!raw) return;
          const d = new Date(raw);
          if (isNaN(d.getTime())) return;
          sawDate = true;
          const idx = (d.getDay() + 6) % 7; // Mon=0 .. Sun=6
          dayCounts[idx] += 1;
        });
        setWeeklyTrend(
          sawDate ? DAY_LABELS.map((label, i) => ({ label, value: dayCounts[i] })) : []
        );

        setLastUpdated(new Date());
      } catch {
        setError("Couldn't load dashboard data. Check your connection and try refreshing.");
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshTick]);

  useEffect(() => {
    (async () => {
      setO2cLoading(true);
      try {
        const res = await API.get("/dashboard/o2c");
        setO2c(res.data);
      } catch {
        // supplementary section — a failure here shouldn't block the rest
        // of the page, but we don't fabricate numbers either. Leave it
        // empty so the section simply doesn't render.
        setO2c(null);
      } finally {
        setO2cLoading(false);
      }
    })();
  }, [refreshTick]);

  const statCards = useMemo(() => ([
    { label: "Total Customers", value: loading ? null : (stats.customers ?? 0).toLocaleString(), Icon: IconUsers },
    { label: "Active Orders",   value: loading ? null : (stats.activeOrders ?? 0).toLocaleString(), Icon: IconCrate },
    { label: "Products",        value: loading ? null : (stats.products ?? 0).toLocaleString(), Icon: IconSpool },
    { label: "Revenue",         value: loading ? null : stats.revenue, Icon: IconTrend },
  ]), [loading, stats]);

  const formattedLastUpdated = lastUpdated ? lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;

  return (
    <Layout>
      <style>{MOTION_CSS}</style>
      <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap" rel="stylesheet" />

      <div style={styles.page}>
       
        {/* <div style={styles.topBar}>
          <div>
            <h1 style={styles.heading}>Dashboard</h1>
            <p style={styles.headingSub}>Welcome back, {user.name || "Super Admin"}</p>
          </div>
        </div> */}

        {error && (
          <div role="alert" style={{ marginBottom: 22, background: isDark ? "rgba(221,132,120,0.08)" : "rgba(150,56,49,0.06)", border: `1px solid ${t.danger}33`, borderRadius: 8, padding: "11px 15px", fontFamily: FONT_UI, fontSize: 13, color: t.danger, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <span>{error}</span>
            <button type="button" onClick={() => setRefreshTick((n) => n + 1)} style={{ fontFamily: FONT_UI, fontSize: 12.5, fontWeight: 600, color: t.danger, background: "transparent", border: `1px solid ${t.danger}55`, borderRadius: 6, padding: "4px 10px", cursor: "pointer", flexShrink: 0 }}>
              Try again
            </button>
          </div>
        )}

        {/* ══════════════ O2C snapshot ══════════════
            Two labeled card groups, 4 cards per row each:
              Enquiry Summary — 4 cards (1 row)
              Order Summary   — 12 cards (3 rows)
            followed by the existing 3-chart breakdown row. */}
        <ErrorBoundary>
        {!o2cLoading && o2c && (() => {
          const enquiryCards = [
            { label: "Total Enquiries", value: o2c.enquiryStatus?.total ?? 0, sub: "All enquiries received", Icon: IconClipboard, color: t.forest },
            { label: "Pending Enquiries", value: o2c.enquiryStatus?.pending ?? 0, sub: "Awaiting review", Icon: IconClock, color: t.ochre },
            { label: "Approved Enquiries", value: o2c.enquiryStatus?.approved ?? 0, sub: "Moved past marketing review", Icon: IconCheckCircle, color: t.sage },
            { label: "Rejected Enquiries", value: o2c.enquiryStatus?.rejected ?? 0, sub: "Incomplete / duplicate / bad qty", Icon: IconFileWarning, color: t.danger },
          ];

          const orderCards = [
            { label: "Total Orders", value: o2c.orderSummary?.total ?? 0, sub: "All orders placed", Icon: IconCart, color: t.forest },
            { label: "Pending Orders", value: o2c.orderSummary?.pending ?? 0, sub: "Awaiting approval", Icon: IconClock, color: t.ochre },
            { label: "Approved Orders", value: o2c.orderSummary?.approved ?? 0, sub: "Confirmed, in pipeline", Icon: IconCheckCircle, color: t.sage },
            { label: "Rejected Orders", value: o2c.orderSummary?.rejected ?? 0, sub: "Declined orders", Icon: IconFileWarning, color: t.danger },
            { label: "Rejected Indents", value: o2c.orderSummary?.rejectedIndents ?? 0, sub: "Failed indent checks", Icon: IconFileWarning, color: t.danger },
            { label: "Dispatched Orders", value: o2c.dispatchStatus?.dispatched ?? 0, sub: "Shipped out", Icon: IconCart, color: t.forest },
            { label: "Partial / In-Process", value: o2c.dispatchStatus?.pendingDispatch ?? 0, sub: "Allocated or cleared, not dispatched", Icon: IconAtom, color: t.ochre },
            { label: "Prev. Day Pending", value: o2c.pendingDispatchAging?.buckets?.["0-1"] ?? 0, sub: "Aging 1–2 days", Icon: IconClock, color: t.ochre },
            { label: "Sales Loss", value: o2c.salesLoss?.count ?? 0, sub: "Stock shortage + invalid + delay", Icon: IconTrendDown, color: t.danger },
            { label: "Long Pending Orders", value: o2c.longPendingOrders?.length ?? 0, sub: "Approved, not yet dispatched", Icon: IconTimer, color: t.inkSub },
          ];

          const enquiryBars = [
            { label: "Pending", value: o2c.enquiryStatus?.pending ?? 0, color: t.ochre },
            { label: "Approved", value: o2c.enquiryStatus?.approved ?? 0, color: t.sage },
            { label: "Dispatched", value: o2c.dispatchStatus?.dispatched ?? 0, color: t.indigo },
          ];

          const customerDonut = (o2c.ordersPlaced?.customerWise || []).slice(0, 5).map((c, i) => ({
            label: c.customer, value: c.value,
            color: [t.forest, t.ochre, t.danger, t.sage, t.indigo][i % 5],
          }));

          return (
            <div style={{ marginBottom: 34 }}>

             

              <p style={styles.o2cSectionLabel}>Enquiry Summary</p>
              <div style={styles.o2cGrid}>
                {orderCards.map((c) => (
                  <div key={c.label} className="pd-fade-up" style={styles.o2cCard}>
                    <div style={styles.o2cCardTop}>
                      <span style={styles.o2cLabel}>{c.label}</span>
                      <span style={styles.o2cIconChip(c.color)}><c.Icon /></span>
                    </div>
                    <p style={{ ...styles.o2cValue, color: c.color }}>{c.value}</p>
                    <p style={styles.o2cSub}>{c.sub}</p>
                  </div>
                ))}
              </div>

              <div style={styles.o2cChartsRow}>
                <div style={styles.o2cChartCard}>
                  <p style={styles.o2cChartTitle}>Enquiry Status Breakdown</p>
                  <BarChart data={enquiryBars} height={190} barWidth={44} gap={26} showAxis textColor={t.ink} subColor={t.inkSub} gridColor={t.border} />
                </div>

                <div style={styles.o2cChartCard}>
                  <p style={styles.o2cChartTitle}>Order Value by Customer</p>
                  {customerDonut.length === 0 ? (
                    <p style={styles.emptyNote}>No order value data yet.</p>
                  ) : (
                    <div style={{ display: "flex", justifyContent: "center" }}>
                      <DonutChart
                        data={customerDonut}
                        size={150} thickness={24}
                        textColor={t.ink} subColor={t.inkSub}
                        valueFormatter={(v) => `₹${v.toLocaleString()}`}
                      />
                    </div>
                  )}
                </div>

                <div style={styles.o2cChartCard}>
                  <p style={styles.o2cChartTitle}>Weekly Dispatch Trend</p>
                  {weeklyTrend === null ? (
                    <p style={styles.emptyNote}>Loading…</p>
                  ) : weeklyTrend.length === 0 ? (
                    <p style={styles.emptyNote}>No dated order records yet to chart a weekly trend.</p>
                  ) : (
                    <AreaChart data={weeklyTrend} height={190} color={t.sage} textColor={t.ink} subColor={t.inkSub} gridColor={t.border} />
                  )}
                </div>
              </div>
            </div>
          );
        })()}
        </ErrorBoundary>

        {/* Stat strip */}
        <div style={styles.statStrip}>
          {statCards.map((card, i) => (
            <div key={card.label} className="pd-fade-up pd-stat" style={{ ...styles.statCell, borderRight: i === statCards.length - 1 ? "none" : styles.statCell.borderRight, animationDelay: `${i * 55}ms` }}>
              <div style={styles.statTop}>
                <card.Icon />
                <span style={styles.statLabel}>{card.label}</span>
              </div>
              {card.value === null ? (
                <div className="pd-skel" style={{ height: 26, width: "55%", background: `linear-gradient(90deg, ${t.border} 25%, ${t.borderStrong} 37%, ${t.border} 63%)` }} aria-hidden="true" />
              ) : (
                <p style={styles.statValue}>{card.value}</p>
              )}
            </div>
          ))}
        </div>

        {/* Recent orders */}
        <div style={styles.tableBox}>
          <div style={styles.tableHeader}>
            <h2 style={styles.tableTitle}>Recent orders</h2>
            <span style={styles.tableCount}>{String(recentOrders.length).padStart(2, "0")} records</span>
          </div>
          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="pd-skel" style={{ height: 16, width: `${82 - i * 8}%`, background: `linear-gradient(90deg, ${t.border} 25%, ${t.borderStrong} 37%, ${t.border} 63%)` }} aria-hidden="true" />
              ))}
            </div>
          ) : recentOrders.length === 0 ? (
            <div style={styles.emptyState}>
              <p style={styles.emptyText}>No orders yet. New orders will appear here as soon as they come in.</p>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 26, flexWrap: "wrap" }}>
              <BarChart
                height={150}
                barWidth={70}
                textColor={t.ink}
                subColor={t.inkSub}
                data={recentOrders.map((o) => ({ label: o.id, value: parseInt(o.amount.replace(/[^\d]/g, ""), 10) || 0, color: statusTone(o.status, t) }))}
              />
              <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 240 }}>
                {recentOrders.map((o, i) => (
                  <div key={o.id} className="pd-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 10px", borderTop: i === 0 ? "none" : `1px solid ${t.border}`, borderRadius: 6 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 10, fontFamily: FONT_UI, fontSize: 12.5, minWidth: 0 }}>
                      <span style={{ fontFamily: FONT_MONO, fontWeight: 600, color: t.ink }}>{o.id}</span>
                      <span style={{ color: t.inkSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.customer}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <span style={{ fontFamily: FONT_MONO, fontSize: 12.5, color: t.ink, fontVariantNumeric: "tabular-nums" }}>{o.amount}</span>
                      <span style={{ fontFamily: FONT_UI, fontSize: 11, fontWeight: 600, textTransform: "capitalize", color: statusTone(o.status, t) }}>{o.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ══════════════ O2C pipeline ══════════════ */}
        {o2cLoading ? (
          <div style={{ marginTop: 40, display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="pd-skel" style={{ height: 20, width: 180, background: `linear-gradient(90deg, ${t.border} 25%, ${t.borderStrong} 37%, ${t.border} 63%)` }} aria-hidden="true" />
            <div style={styles.miniGrid(4)}>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="pd-skel" style={{ height: 64, borderRadius: 8, background: `linear-gradient(90deg, ${t.border} 25%, ${t.borderStrong} 37%, ${t.border} 63%)` }} aria-hidden="true" />
              ))}
            </div>
          </div>
        ) : o2c && (
          <>
            {/* 01 */}
            {/* <div style={styles.sectionHead}><h2 style={styles.sectionTitle}>Enquiry status</h2></div>
            <div style={styles.chartRow}>
              <div style={styles.miniGrid(4)}>
                {[["Total", o2c.enquiryStatus.total, t.ink], ["Pending", o2c.enquiryStatus.pending, t.ochre], ["Approved+", o2c.enquiryStatus.approved, t.forest], ["Rejected", o2c.enquiryStatus.rejected, t.danger]].map(([label, val, color]) => (
                  <div key={label} style={styles.miniCard}><p style={styles.miniLabel}>{label}</p><p style={{ ...styles.miniValue, color }}>{val}</p></div>
                ))}
              </div>
              <div style={styles.chartCard}>
                <DonutChart size={120} thickness={15} textColor={t.ink} subColor={t.inkSub}
                  data={[{ label: "Pending", value: o2c.enquiryStatus.pending, color: t.ochre }, { label: "Approved+", value: o2c.enquiryStatus.approved, color: t.forest }, { label: "Rejected", value: o2c.enquiryStatus.rejected, color: t.danger }]} />
              </div>
            </div> */}

            {/* 02 */}
            <div style={styles.sectionHead}><h2 style={styles.sectionTitle}>Orders placed</h2></div>
            <p style={styles.sectionSub}>Today: <strong style={{ color: t.ink, fontFamily: FONT_MONO }}>{o2c.ordersPlaced.today}</strong> order(s) placed.</p>
            <div style={styles.twoCol}>
              <div style={styles.widgetBox}>
                <p style={styles.widgetTitle}>Customer-wise (top 6)</p>
                {o2c.ordersPlaced.customerWise.length === 0 ? <p style={styles.emptyNote}>No data yet.</p> : (
                  <BarChart height={160}barWidth={70}textColor={t.ink} subColor={t.inkSub} data={o2c.ordersPlaced.customerWise.slice(0, 6).map((c, i) => ({ label: c.customer, value: c.value, color: [t.forest, t.sage, t.ochre, t.indigo, t.danger, t.inkSub][i % 6] }))} />
                )}
              </div>
              <div style={styles.widgetBox}>
                <p style={styles.widgetTitle}>Product-wise (top 6)</p>
                {o2c.ordersPlaced.productWise.length === 0 ? <p style={styles.emptyNote}>No data yet.</p> : (
                  <BarChart height={160} barWidth={70} textColor={t.ink} subColor={t.inkSub} data={o2c.ordersPlaced.productWise.slice(0, 6).map((p, i) => ({ label: p.product, value: p.qty, color: [t.sage, t.ochre, t.indigo, t.forest, t.danger, t.inkSub][i % 6] }))} />
                )}
              </div>
            </div>

            {/* 03 */}
            <div style={styles.sectionHead}><h2 style={styles.sectionTitle}>Dispatch status</h2></div>
            <div style={styles.chartRow}>
              <div style={styles.miniGrid(3)}>
                {[["Dispatched", o2c.dispatchStatus.dispatched, t.indigo], ["Pending dispatch", o2c.dispatchStatus.pendingDispatch, t.ochre], ["Delivered", o2c.dispatchStatus.delivered, t.forest]].map(([label, val, color]) => (
                  <div key={label} style={styles.miniCard}><p style={styles.miniLabel}>{label}</p><p style={{ ...styles.miniValue, color }}>{val}</p></div>
                ))}
              </div>
              <div style={styles.chartCard}>
                <DonutChart size={120} thickness={15} textColor={t.ink} subColor={t.inkSub}
                  data={[{ label: "Dispatched", value: o2c.dispatchStatus.dispatched, color: t.indigo }, { label: "Pending", value: o2c.dispatchStatus.pendingDispatch, color: t.ochre }, { label: "Delivered", value: o2c.dispatchStatus.delivered, color: t.forest }]} />
              </div>
            </div>

            {/* 04 */}
            <div style={styles.sectionHead}><h2 style={styles.sectionTitle}>Pending dispatch — aging</h2></div>
            <div style={styles.chartRow}>
              <div style={styles.miniGrid(3)}>
                {[["0–1 days", o2c.pendingDispatchAging.buckets["0-1"], t.forest], ["2–3 days", o2c.pendingDispatchAging.buckets["2-3"], t.ochre], ["4+ days (priority)", o2c.pendingDispatchAging.buckets["4+"], t.danger]].map(([label, val, color]) => (
                  <div key={label} style={styles.miniCard}><p style={styles.miniLabel}>{label}</p><p style={{ ...styles.miniValue, color }}>{val}</p></div>
                ))}
              </div>
              <div style={styles.chartCard}>
                <BarChart height={130} barWidth={34} textColor={t.ink} subColor={t.inkSub}
                  data={[{ label: "0–1d", value: o2c.pendingDispatchAging.buckets["0-1"], color: t.forest }, { label: "2–3d", value: o2c.pendingDispatchAging.buckets["2-3"], color: t.ochre }, { label: "4+d", value: o2c.pendingDispatchAging.buckets["4+"], color: t.danger }]} />
              </div>
            </div>
            

            {/* 05 */}
            <div style={styles.sectionHead}><h2 style={styles.sectionTitle}>Stock shortage</h2></div>
            <p style={styles.sectionSub}>Requested vs. available, top items.</p>
            <div style={styles.widgetBox}>
              {o2c.stockShortage.length === 0 ? <p style={styles.emptyNote}>No shortage right now.</p> : (
                <GroupedBarChart height={170} textColor={t.ink} subColor={t.inkSub}
                  series={[{ label: "Requested", color: t.ochre }, { label: "Available", color: t.danger }]}
                  data={o2c.stockShortage.slice(0, 6).map((r) => ({ label: r.product, values: [r.requested, r.available] }))} />
              )}
            </div>

            {/* 06 */}
            <div style={styles.sectionHead}><h2 style={styles.sectionTitle}>Sales loss</h2></div>
            <div style={styles.chartRow}>
              <div style={styles.miniGrid(2)}>
                <div style={styles.miniCard}><p style={styles.miniLabel}>Declined enquiries</p><p style={{ ...styles.miniValue, color: t.danger }}>{o2c.salesLoss.count}</p></div>
                <div style={styles.miniCard}><p style={styles.miniLabel}>Value lost</p><p style={{ ...styles.miniValue, color: t.danger }}>₹{o2c.salesLoss.value.toLocaleString()}</p></div>
              </div>
              {o2c.salesLoss.list.length > 0 && (
                <div style={styles.chartCard}>
                  <BarChart height={130} barWidth={30} textColor={t.ink} subColor={t.inkSub} data={o2c.salesLoss.list.slice(0, 6).map((r) => ({ label: r.customer, value: r.value, color: t.danger }))} />
                </div>
              )}
            </div>

            {/* 08 */}
            <div style={styles.sectionHead}><h2 style={styles.sectionTitle}>Long pending orders</h2></div>
            <p style={styles.sectionSub}>Approved/processing 3+ days, no dispatch.</p>
            <div style={styles.widgetBox}>
              {o2c.longPendingOrders.length === 0 ? <p style={styles.emptyNote}>Nothing long-pending.</p> : (
                <BarChart height={140} barWidth={30} textColor={t.ink} subColor={t.inkSub} data={o2c.longPendingOrders.slice(0, 6).map((r) => ({ label: r.customer, value: r.days, color: t.danger }))} />
              )}
            </div>

            <p style={styles.approxNote}>{o2c.note}</p>
          </>
        )}

      </div>
    </Layout>
  );
}