// src/pages/RaiseComplaint.jsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import CustomerLayout from "../components/CustomerLayout";
import { useTheme } from "../ThemeContext";
import { getG } from "../theme";
import API from "../services/api";
import { COMPLAINT_TYPES } from "../utils/complaintTypes";

const FONT = "'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export default function RaiseComplaint() {
  const { isDark } = useTheme();
  const themeG = getG(isDark);
  const navigate = useNavigate();

  const [orders, setOrders] = useState([]);
  const [complaints, setComplaints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [orderId, setOrderId] = useState("");
  const [type, setType] = useState(COMPLAINT_TYPES[0]);
  const [description, setDescription] = useState("");

  useEffect(() => {
    const role = localStorage.getItem("role");
    if (role !== "customer") { navigate("/login"); return; }
    (async () => {
      try {
        const orderRes = await API.get("/orders");
        setOrders(orderRes.data);
      } catch {
        setError("Failed to load your orders.");
      }
      // Complaint history is best-effort — if the endpoint isn't wired up
      // yet on the backend, don't block the rest of the page for it.
      try {
        const complaintRes = await API.get("/complaints");
        setComplaints(complaintRes.data);
      } catch {
        setComplaints([]);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line
  }, []);

  const handleSubmit = async () => {
    if (!orderId) { setError("Please select which order this is about."); return; }
    if (!description.trim()) { setError("Please describe the issue."); return; }

    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const res = await API.post("/complaints", { orderId, type, description });
      setNotice(res.data?.message || "Complaint submitted. Our team will get back to you shortly.");
      // Reload the list from the server so the new row has the same data
      // (including the order code) as it will after a refresh.
      try {
        const refreshed = await API.get("/complaints");
        setComplaints(refreshed.data);
      } catch {
        const chosen = orders.find((o) => String(o.Id) === String(orderId));
        setComplaints((prev) => [
          { OrderCode: chosen?.Code, Type: type, Description: description, Status: "Open", createdAt: new Date().toISOString() },
          ...prev,
        ]);
      } setOrderId("");
      setType(COMPLAINT_TYPES[0]);
      setDescription("");
    } catch (err) {
      setError(err.response?.data?.message || "Failed to submit complaint. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const S = {
    heading: { fontFamily: "'Space Grotesk', " + FONT, fontSize: 26, fontWeight: 700, margin: "0 0 4px", color: themeG.textMain, letterSpacing: "-0.4px" },
    headingSub: { fontSize: 13, color: themeG.textSub, margin: "0 0 24px" },

    card: { background: themeG.card, border: `1px solid ${themeG.border}`, borderRadius: 14, padding: "24px 26px", boxShadow: "0 4px 16px rgba(15,33,56,0.06)", marginBottom: 28 },
    cardTitle: { fontSize: 16.5, fontWeight: 700, color: themeG.textMain, margin: "0 0 18px" },
    label: { fontSize: 11.5, fontWeight: 700, color: themeG.textLabel, textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 6px", display: "block" },
    select: { width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 8, border: `1px solid ${themeG.border}`, fontSize: 13.5, fontFamily: FONT, color: themeG.textMain, background: themeG.bg, marginBottom: 16, outline: "none" },
    textarea: { width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 8, border: `1px solid ${themeG.border}`, fontSize: 13.5, fontFamily: FONT, color: themeG.textMain, background: themeG.bg, marginBottom: 16, outline: "none", minHeight: 100, resize: "vertical" },
    submitBtn: { padding: "11px 26px", borderRadius: 9, border: "none", background: themeG.accent, color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: FONT },

    historyCard: { background: themeG.card, border: `1px solid ${themeG.border}`, borderRadius: 14, overflow: "hidden", boxShadow: "0 4px 16px rgba(15,33,56,0.06)" },
    table: { width: "100%", borderCollapse: "collapse" },
    th: { textAlign: "left", fontSize: 11, color: "#FFFFFF", background: "#1F3A63", padding: "12px 16px", borderBottom: `1px solid ${themeG.border}`, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 },
    td: { padding: "13px 16px", fontSize: 13.5, color: themeG.textMain, borderBottom: `1px solid ${themeG.border}` },
    statusTag: (open) => ({ fontSize: 11.5, fontWeight: 600, padding: "3px 11px", borderRadius: 20, background: open ? "rgba(168,112,31,0.12)" : "rgba(46,122,114,0.12)", color: open ? "#D69426" : "#1E4A45", border: `1px solid ${open ? "rgba(168,112,31,0.3)" : "rgba(46,122,114,0.3)"}` }),
  };

  return (
    <CustomerLayout>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />


      {error && (
        <div style={{ marginBottom: 20, background: "rgba(178,58,58,0.08)", border: "1px solid rgba(178,58,58,0.25)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#B23A3A" }}>
          {error}
        </div>
      )}

      {notice && (
        <div style={{ marginBottom: 20, background: "rgba(15,33,56,0.08)", border: "1px solid rgba(15,33,56,0.25)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: themeG.accent }}>
          {notice}
        </div>
      )}

      <div style={S.card}>
        <h2 style={S.cardTitle}>New Complaint</h2>

        <label style={S.label}>Which order is this about?</label>
        <select style={S.select} value={orderId} onChange={(e) => setOrderId(e.target.value)}>
          <option value="">Select an order…</option>
          {orders.map((o) => (
            <option key={o.Id} value={o.Id}>{o.Code} — {o.product?.Name || "—"}</option>
          ))}
        </select>

        <label style={S.label}>Complaint Type</label>
        <select style={S.select} value={type} onChange={(e) => setType(e.target.value)}>
          {COMPLAINT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>

        <label style={S.label}>Describe the issue</label>
        <textarea
          style={S.textarea}
          placeholder="Tell us what went wrong…"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <button style={S.submitBtn} disabled={submitting} onClick={handleSubmit}>
          {submitting ? "Submitting…" : "Submit Complaint"}
        </button>
      </div>

      <div style={S.historyCard}>
        <table style={S.table}>
          <thead>
            <tr>
              {["Date", "Enquiry", "Type", "Description", "Status"].map((h) => (
                <th key={h} style={S.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} style={{ ...S.td, textAlign: "center", padding: 30 }}>Loading…</td></tr>
            ) : complaints.length === 0 ? (
              <tr><td colSpan={5} style={{ ...S.td, textAlign: "center", padding: 30 }}>No complaints raised yet.</td></tr>
            ) : complaints.map((c, i) => {
              const isOpen = (c.Status || "open").toLowerCase() !== "resolved";
              const dateStr = c.createdAt || c.CreatedAt;
              return (
                <tr key={c.Id || i}>
                  <td style={S.td}>{dateStr ? new Date(dateStr).toLocaleDateString() : "—"}</td>
                  <td style={S.td}>{c.order?.Code || c.OrderCode || "—"}</td>
                  <td style={S.td}>{c.Type || c.type || "—"}</td>
                  <td style={S.td}>{c.Description || c.description || "—"}</td>
                  <td style={S.td}><span style={S.statusTag(isOpen)}>{c.Status || (isOpen ? "Open" : "Resolved")}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </CustomerLayout>
  );
}