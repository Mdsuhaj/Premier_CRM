// src/pages/TrackOrders.jsx
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import CustomerLayout from "../components/CustomerLayout";
import { useTheme } from "../ThemeContext";
import { getG } from "../theme";
import API from "../services/api";

const FONT = "'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// Only orders that have actually left the warehouse have anything to
// track. Pending/approved/processing orders show up in a separate
// "not yet shipped" list instead of a stepper with nothing to show.
const TRACK_STEPS = [
  { key: "dispatched", label: "Dispatched" },
  { key: "delivered",  label: "Delivered" },
];

function stepIndex(status) {
  const i = TRACK_STEPS.findIndex((s) => s.key === (status || "").toLowerCase());
  return i === -1 ? 0 : i;
}

function Tracker({ order, themeG }) {
  const current = stepIndex(order.Status);
  return (
    <div style={{ display: "flex", alignItems: "center", padding: "6px 2px", maxWidth: 260 }}>
      {TRACK_STEPS.map((step, i) => {
        const done = i <= current;
        const isLast = i === TRACK_STEPS.length - 1;
        return (
          <div key={step.key} style={{ display: "flex", alignItems: "center", flex: isLast ? "0 0 auto" : 1 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 90 }}>
              <div style={{
                width: 24, height: 24, borderRadius: "50%",
                background: done ? themeG.accent : themeG.bg,
                border: `2px solid ${done ? themeG.accent : themeG.border}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 12, color: done ? "#fff" : themeG.textSub, fontWeight: 700,
              }}>
                {done ? "✓" : i + 1}
              </div>
              <span style={{ fontSize: 11, color: done ? themeG.textMain : themeG.textSub, fontWeight: done ? 600 : 500, marginTop: 5, textAlign: "center" }}>
                {step.label}
              </span>
            </div>
            {!isLast && (
              <div style={{ flex: 1, height: 2, background: i < current ? themeG.accent : themeG.border, marginBottom: 18 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function TrackOrders() {
  const { isDark } = useTheme();
  const themeG = getG(isDark);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const highlightCode = searchParams.get("code");

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const role = localStorage.getItem("role");
    if (role !== "customer") { navigate("/login"); return; }
    (async () => {
      try {
        const res = await API.get("/orders");
        setOrders(res.data);
      } catch {
        setError("Failed to load your orders.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line
  }, []);

  const norm = (s) => (s || "").toLowerCase();
  const shipped = orders.filter(o => ["dispatched", "delivered"].includes(norm(o.Status)));
  const notYetShipped = orders.filter(o => ["pending", "approved", "processing"].includes(norm(o.Status)));
  const declined = orders.filter(o => ["declined", "rejected"].includes(norm(o.Status)));

  const S = {
    heading: { fontFamily: "'Space Grotesk', " + FONT, fontSize: 26, fontWeight: 700, margin: "0 0 4px", color: themeG.textMain, letterSpacing: "-0.4px" },
    headingSub: { fontSize: 13, color: themeG.textSub, margin: "0 0 24px" },
    sectionTitle: { fontSize: 16.5, fontWeight: 700, color: themeG.textMain, margin: "28px 0 4px" },
    sectionSub: { fontSize: 12.5, color: themeG.textSub, margin: "0 0 14px" },

    orderCard: (highlighted) => ({
      background: themeG.card,
      border: `1px solid ${highlighted ? themeG.accent : themeG.border}`,
      borderRadius: 14,
      padding: "18px 22px",
      marginBottom: 14,
      boxShadow: highlighted ? `0 0 0 3px ${themeG.accent}22` : "0 3px 12px rgba(15,33,56,0.05)",
    }),
    orderTop: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 },
    orderCode: { fontSize: 15, fontWeight: 700, color: themeG.accent, margin: 0 },
    orderProduct: { fontSize: 12.5, color: themeG.textSub, margin: "2px 0 0" },

    detailsGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginTop: 16 },
    detailLabel: { fontSize: 10.5, color: themeG.textLabel, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600, margin: "0 0 3px" },
    detailValue: { fontSize: 13, color: themeG.textMain, fontWeight: 600, margin: 0 },

    plainCard: { background: themeG.card, border: `1px solid ${themeG.border}`, borderRadius: 12, padding: "14px 18px", marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "space-between" },
    plainCode: { fontSize: 13.5, fontWeight: 700, color: themeG.textMain },
    plainNote: { fontSize: 12, color: themeG.textSub },
    statusTag: { fontSize: 11.5, fontWeight: 600, color: themeG.textSub, background: themeG.bg, border: `1px solid ${themeG.border}`, borderRadius: 14, padding: "3px 10px", textTransform: "capitalize" },

    declinedCard: { background: "rgba(178,58,58,0.06)", border: "1px solid rgba(178,58,58,0.25)", borderRadius: 12, padding: "14px 18px", marginBottom: 10 },
    declinedCode: { fontSize: 13.5, fontWeight: 700, color: "#B23A3A", margin: "0 0 3px" },
    declinedNote: { fontSize: 12, color: "#B23A3A", margin: 0 },

    emptyNote: { fontSize: 12.5, color: themeG.textSub, padding: "10px 0" },
  };

  return (
    <CustomerLayout>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />


      {error && (
        <div style={{ marginBottom: 20, background: "rgba(178,58,58,0.08)", border: "1px solid rgba(178,58,58,0.25)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#B23A3A" }}>
          {error}
        </div>
      )}

      {loading ? (
        <p style={{ fontSize: 13, color: themeG.textSub }}>Loading…</p>
      ) : (
        <>
          {/* Shipped — full tracker */}
          <h2 style={S.sectionTitle}>Shipped</h2>
          <p style={S.sectionSub}>These orders have been dispatched — track their progress below.</p>
          {shipped.length === 0 ? (
            <p style={S.emptyNote}>Nothing has shipped yet.</p>
          ) : shipped.map((o) => (
            <div key={o.Id} style={S.orderCard(o.Code === highlightCode)}>
              <div style={S.orderTop}>
                <div>
                  <p style={S.orderCode}>{o.Code}</p>
                  <p style={S.orderProduct}>{o.product?.Name || "—"}{o.Color ? ` · ${o.Color}` : ""}{o.Size ? ` · ${o.Size}` : ""}</p>
                </div>
              </div>

              <Tracker order={o} themeG={themeG} />

              <div style={S.detailsGrid}>
                <div>
                  <p style={S.detailLabel}>Dispatch Date</p>
                  <p style={S.detailValue}>{o.DispatchDate ? o.DispatchDate.substring(0, 10) : "—"}</p>
                </div>
                <div>
                  <p style={S.detailLabel}>Delivered On</p>
                  <p style={S.detailValue}>{o.DeliveredDate ? o.DeliveredDate.substring(0, 10) : "—"}</p>
                </div>
                <div>
                  <p style={S.detailLabel}>Expected Delivery</p>
                  <p style={S.detailValue}>{o.DeliveryDate ? o.DeliveryDate.substring(0, 10) : "—"}</p>
                </div>
                <div>
                  <p style={S.detailLabel}>LR Number</p>
                  <p style={S.detailValue}>{o.LRNumber || "—"}</p>
                </div>
                <div>
                  <p style={S.detailLabel}>Transport</p>
                  <p style={S.detailValue}>{o.TransportName || "—"}</p>
                </div>
              </div>
            </div>
          ))}

          {/* Not yet shipped */}
          <h2 style={S.sectionTitle}>Not Yet Shipped</h2>
          <p style={S.sectionSub}>Tracking opens up automatically once these are dispatched.</p>
          {notYetShipped.length === 0 ? (
            <p style={S.emptyNote}>Nothing waiting to ship.</p>
          ) : notYetShipped.map((o) => (
            <div key={o.Id} style={S.plainCard}>
              <div>
                <span style={S.plainCode}>{o.Code}</span>
                <span style={{ ...S.plainNote, marginLeft: 10 }}>{o.product?.Name || "—"}</span>
              </div>
              <span style={S.statusTag}>{o.Status}</span>
            </div>
          ))}

          {/* Declined */}
          {declined.length > 0 && (
            <>
              <h2 style={S.sectionTitle}>Declined</h2>
              {declined.map((o) => (
                <div key={o.Id} style={S.declinedCard}>
                  <p style={S.declinedCode}>{o.Code} — {o.product?.Name || "—"}</p>
                  <p style={S.declinedNote}>{o.Notes ? o.Notes : "This enquiry was declined."}</p>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </CustomerLayout>
  );
}