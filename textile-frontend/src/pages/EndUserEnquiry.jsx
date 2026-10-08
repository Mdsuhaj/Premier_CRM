// src/pages/EndUserEnquiry.jsx
//
// Read-only list of orders awaiting approval across the end_user's whole
// assigned area (Taluk) — not just orders they personally created. Uses
// GET /orders?scope=area&status=pending, which the backend scopes by the
// caller's own assigned Taluk(s).
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import EndUserLayout from "../components/EndUserLayout";
import { useTheme } from "../ThemeContext";
import { getG, statusColor } from "../theme";
import API from "../services/api";

const FONT = "'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const Badge = ({ text }) => {
  const s = statusColor(text);
  return (
    <span style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}`, padding: "3px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600 }}>
      {(text || "—").charAt(0).toUpperCase() + (text || "—").slice(1)}
    </span>
  );
};

export default function EndUserEnquiry() {
  const { isDark } = useTheme();
  const themeG = getG(isDark);
  const navigate = useNavigate();

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const role = localStorage.getItem("role");
    if (role !== "end_user") { navigate("/login"); return; }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await API.get("/orders", { params: { scope: "area", status: "pending" } });
        setOrders(res.data);
      } catch (err) {
        setError(err.response?.data?.message || "Failed to load enquiries.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const S = {
    heading: { fontFamily: "'Space Grotesk', " + FONT, fontSize: 26, fontWeight: 700, margin: "0 0 4px", color: themeG.textMain, letterSpacing: "-0.4px" },
    headingSub: { fontSize: 13, color: themeG.textSub, margin: "0 0 22px" },
    card: { background: themeG.card, border: `1px solid ${themeG.border}`, borderRadius: 14, overflow: "hidden", boxShadow: "0 4px 16px rgba(15,33,56,0.06)" },
    table: { width: "100%", borderCollapse: "collapse" },
    th: { textAlign: "left", fontSize: 11, color: themeG.textLabel, padding: "12px 18px", borderBottom: `1px solid ${themeG.border}`, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 },
    td: { padding: "13px 18px", fontSize: 13.5, color: themeG.textMain, borderBottom: `1px solid ${themeG.border}` },
    empty: { padding: 50, textAlign: "center", fontSize: 14, color: themeG.textSub },
  };

  return (
    <EndUserLayout>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />


      {error && (
        <div style={{ marginBottom: 20, background: "rgba(178,58,58,0.08)", border: "1px solid rgba(178,58,58,0.25)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#B23A3A" }}>
          {error}
        </div>
      )}

      <div style={S.card}>
        {loading ? (
          <p style={S.empty}>Loading…</p>
        ) : orders.length === 0 ? (
          <p style={S.empty}>No pending enquiries in your area right now.</p>
        ) : (
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Order</th>
                <th style={S.th}>Customer</th>
                <th style={S.th}>Product</th>
                <th style={S.th}>Qty</th>
                <th style={S.th}>Amount</th>
                <th style={S.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.Id}>
                  <td style={S.td}>{o.Code}</td>
                  <td style={S.td}>{o.customer?.Name ?? "—"}</td>
                  <td style={S.td}>{o.product?.Name ?? "—"}</td>
                  <td style={S.td}>{o.Quantity}</td>
                  <td style={S.td}>₹{(parseFloat(o.TotalAmount) || 0).toLocaleString()}</td>
                  <td style={S.td}><Badge text={o.Status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </EndUserLayout>
  );
}