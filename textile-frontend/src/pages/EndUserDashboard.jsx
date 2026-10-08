// src/pages/EndUserDashboard.jsx
//
// End User (field officer) dashboard. All figures come from /api/dashboard
// and /api/complaints, which the backend already scopes to this user's
// assigned Taluk(s) — so no extra filtering needed here.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import EndUserLayout from "../components/EndUserLayout";
import { useTheme } from "../ThemeContext";
import { getG, statusColor } from "../theme";
import API from "../services/api";
import { Package, Hourglass, CheckCircle2, XCircle } from "lucide-react";

const FONT = "'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function formatRevenue(total) {
  if (total >= 10000000) return `₹${(total / 10000000).toFixed(2)}Cr`;
  if (total >= 100000) return `₹${(total / 100000).toFixed(2)}L`;
  if (total >= 1000) return `₹${(total / 1000).toFixed(1)}K`;
  return `₹${(total || 0).toLocaleString()}`;
}

const Badge = ({ text }) => {
  const s = statusColor(text);
  return (
    <span style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}`, padding: "3px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600 }}>
      {(text || "—").charAt(0).toUpperCase() + (text || "—").slice(1)}
    </span>
  );
};

export default function EndUserDashboard() {
  const { isDark } = useTheme();
  const themeG = getG(isDark);
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem("user") || "{}");

  const [stats, setStats] = useState({
    total_orders: null,
    approved_orders: null,
    pending_orders: null,
    rejected_orders: null,
    total_products: null
  });
  const [recentOrders, setRecentOrders] = useState([]);
  const [openComplaints, setOpenComplaints] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const statVal = (key) => (loading ? null : (stats[key] ?? 0));
  const openComplaintsVal = loading ? null : (openComplaints ?? 0);
  // Limit to 5 most recent orders — full list lives on My Orders (see
  // "Show More" link next to the table title below).
  const recentOrdersVal = loading ? [] : recentOrders.slice(0, 5);

  useEffect(() => {
    const role = localStorage.getItem("role");
    if (!role) { navigate("/login"); return; }
    if (role !== "end_user") { navigate("/dashboard"); return; }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [dashRes, complaintsRes] = await Promise.all([
          API.get("/dashboard"),
          API.get("/complaints"),
        ]);
        setStats(dashRes.data.stats || {});
        setRecentOrders(dashRes.data.recent_orders || []);
        const open = (complaintsRes.data || []).filter((c) => c.Status !== "Resolved").length;
        setOpenComplaints(open);
      } catch (err) {
        setError(err.response?.data?.message || "Failed to load dashboard.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const HEADER_BG = "#1f3a63";
  const HEADER_COLOR = "#ffffff";

  const S = {
    topBar: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 26 },
    heading: { fontFamily: "'Space Grotesk', " + FONT, fontSize: 26, fontWeight: 700, margin: "0 0 4px", color: themeG.textMain, letterSpacing: "-0.4px" },
    headingSub: { fontSize: 13, color: themeG.textSub, margin: 0 },
    grid: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 },
    statCard: { background: themeG.card, border: `1px solid ${themeG.border}`, borderRadius: 12, padding: "14px 14px 12px", position: "relative", overflow: "hidden", boxShadow: "0 4px 16px rgba(15,33,56,0.06)" },
    cardStripe: { position: "absolute", top: 0, left: 0, right: 0, height: 3, borderRadius: "12px 12px 0 0" },
    cardIcon: { fontSize: 17, marginBottom: 7, display: "block" },
    cardLabel: { fontSize: 11, color: themeG.textLabel, margin: "0 0 4px", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em" },
    cardValue: { fontSize: 20, fontWeight: 700, margin: 0, color: themeG.textMain, letterSpacing: "-0.5px" },

    quickRow: { display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" },
    quickCard: { flex: "1 1 200px", background: themeG.card, border: `1px solid ${themeG.border}`, borderRadius: 12, padding: "14px 16px", cursor: "pointer", boxShadow: "0 3px 12px rgba(15,33,56,0.05)" },
    quickTitle: { fontSize: 14, fontWeight: 700, color: themeG.textMain, margin: "0 0 4px" },
    quickSub: { fontSize: 12, color: themeG.textSub, margin: 0 },

    tableBox: { background: themeG.card, border: `1px solid ${themeG.border}`, borderRadius: 14, padding: "22px 24px", boxShadow: "0 4px 16px rgba(15,33,56,0.06)" },
    tableTitle: { fontFamily: FONT, fontSize: 16, fontWeight: 600, margin: 0, color: themeG.textMain },

    // Header row above the table: title on the left, "Show More" link on
    // the right, pointing to the full My Orders list.
    tableHeaderRow: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
    showMoreBtn: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      background: "transparent",
      border: "none",
      color: themeG.accent,
      fontFamily: FONT,
      fontSize: 13,
      fontWeight: 600,
      cursor: "pointer",
      padding: 0,
    },

    // Scroll wrapper: handles both horizontal and vertical scroll,
    // capped height ≈ 10 rows so header + 10 rows are visible before scrolling.
    tableScroll: {
      maxHeight: 460,
      overflowY: "auto",
      overflowX: "auto",
      border: `1px solid ${themeG.border}`,
      borderRadius: 8,
    },
    table: { width: "100%", minWidth: 720, borderCollapse: "separate", borderSpacing: 0 },

    // Sticky header cells — sticky on top for vertical scroll.
    // Since the table itself scrolls horizontally too, "top" sticky is enough
    // to keep header fixed while scrolling vertically; it will scroll away
    // horizontally in sync with body columns (as expected), but stays pinned
    // at the top always. To also pin against horizontal scroll for the S.No
    // column, we make the first column sticky on the left as well.
    th: {
      textAlign: "center",
      fontSize: 11,
      padding: "10px 12px",
      textTransform: "uppercase",
      letterSpacing: "0.06em",
      fontWeight: 600,
      background: HEADER_BG,
      color: HEADER_COLOR,
      position: "sticky",
      top: 0,
      zIndex: 2,
    },
    thSno: {
      textAlign: "center",
      fontSize: 11,
      padding: "10px 12px",
      textTransform: "uppercase",
      letterSpacing: "0.06em",
      fontWeight: 600,
      background: HEADER_BG,
      color: HEADER_COLOR,
      position: "sticky",
      top: 0,
      left: 0,
      zIndex: 3,
      width: 56,
    },
    td: { padding: "12px 12px", fontSize: 13.5, color: themeG.textMain, borderBottom: `1px solid ${themeG.border}`, textAlign: "center" },
    tdSno: {
      padding: "12px 12px",
      fontSize: 13.5,
      color: themeG.textMain,
      borderBottom: `1px solid ${themeG.border}`,
      position: "sticky",
      left: 0,
      background: themeG.card,
      zIndex: 1,
      fontWeight: 600,
      textAlign: "center",
    },
    emptyNote: { fontSize: 13, color: themeG.textSub, padding: "14px 0" },
  };

  return (
    <EndUserLayout>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
{/* 
      <div style={S.topBar}>
        <div>
          <h1 style={S.heading}>Welcome, {user.name || "End User"}</h1>
          <p style={S.headingSub}>Here's what's happening in your area today.</p>
        </div>
      </div> */}

      {error && (
        <div style={{ marginBottom: 20, background: "rgba(178,58,58,0.08)", border: "1px solid rgba(178,58,58,0.25)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#B23A3A" }}>
          {error}
        </div>
      )}

      <div style={S.grid}>

        <div style={S.statCard}>
          <div style={{ ...S.cardStripe, background: "#1F5C99" }} />
          <Package size={20} color="#1F5C99" style={S.cardIcon} />
          <p style={S.cardLabel}>Total Orders</p>
          <p style={S.cardValue}>
            {loading ? "…" : statVal("total_orders")}
          </p>
        </div>

        <div style={S.statCard}>
          <div style={{ ...S.cardStripe, background: "#D69426" }} />
          <Hourglass size={20} color="#D69426" style={S.cardIcon} />
          <p style={S.cardLabel}>Pending Orders</p>
          <p style={S.cardValue}>
            {loading ? "…" : statVal("pending_orders")}
          </p>
        </div>


        <div style={S.statCard}>
          <div style={{ ...S.cardStripe, background: "#2E8B57" }} />
          <CheckCircle2 size={20} color="#2E8B57" style={S.cardIcon} />
          <p style={S.cardLabel}>Approved Orders</p>
          <p style={S.cardValue}>
            {loading ? "…" : statVal("approved_orders")}
          </p>
        </div>

        <div style={S.statCard}>
          <div style={{ ...S.cardStripe, background: "#96302F" }} />
          <XCircle size={20} color="#96302F" style={S.cardIcon} />
          <p style={S.cardLabel}>Rejected Orders</p>
          <p style={S.cardValue}>
            {loading ? "…" : statVal("rejected_orders")}
          </p>
        </div>

      </div>

      

      <div style={S.tableBox}>
        <div style={S.tableHeaderRow}>
          <h3 style={S.tableTitle}>Recent Orders in Your Area</h3>
          <button
            style={S.showMoreBtn}
            onClick={() => navigate("/master/orders")}
          >
            Show More <span style={{ fontSize: 15, lineHeight: 1 }}>→</span>
          </button>
        </div>
        {loading ? (
          <p style={S.emptyNote}>Loading…</p>
        ) : recentOrdersVal.length === 0 ? (
          <p style={S.emptyNote}>No orders yet in your area.</p>
        ) : (
          <div style={S.tableScroll}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.thSno}>S.No</th>
                  <th style={S.th}>Enquiry No</th>
                  <th style={S.th}>Enquiry Date</th>
                  <th style={S.th}>Customer</th>
                  <th style={S.th}>Product</th>
                  <th style={S.th}>Quantity</th>
                  <th style={S.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {recentOrdersVal.map((o, idx) => (
                  <tr key={o.id}>
                    <td style={S.tdSno}>{idx + 1}</td>
                    <td style={S.td}>{o.id}</td>
                    <td style={S.td}>{o.date ? String(o.date).substring(0, 10) : "—"}</td>
                    <td style={S.td}>{o.customer}</td>
                    <td style={S.td}>{o.product}</td>
                    <td style={S.td}>{o.quantity ?? "—"}</td>
                    <td style={S.td}><Badge text={o.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </EndUserLayout>
  );
}