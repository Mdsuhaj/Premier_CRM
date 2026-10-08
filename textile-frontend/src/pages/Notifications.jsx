import { useEffect, useState } from "react";
import API from "../services/api";
import { useTheme } from "../ThemeContext";
import Layout from "../components/Layout";
import CustomerLayout from "../components/CustomerLayout";
import EndUserLayout from "../components/EndUserLayout";

const FONT = "'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const TYPE_LABELS = {
  allocation_full: "Allocated",
  allocation_partial: "Partial",
  stock_shortage: "Shortage",
  allocation_approved: "Approved",
  allocation_rejected: "Rejected",
  allocation_cancelled: "Cancelled",
  erp_created: "ERP",
  order_approved: "Approved",
  order_declined: "Declined",
  order_dispatched: "Dispatched",
  order_on_hold: "On hold",
  complaint_resolved: "Complaint",
};

// yyyy-mm-dd in the browser's local time (used for the date filter)
const localYmd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default function Notifications() {
  const { colors, isDark } = useTheme();
  const role = localStorage.getItem("role") || "";
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all"); // all | unread
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const Wrapper =
    role === "customer" ? CustomerLayout : role === "end_user" ? EndUserLayout : Layout;

  const load = () => {
    API.get("/notifications")
      .then((res) => setItems(res.data.notifications || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // Opening this page counts as "seen" — clears the bell badge too.
    API.patch("/notifications/read-all").catch(() => {});
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  const markRead = (n) => {
    if (n.ReadAt) return;
    API.patch(`/notifications/${n.Id}/read`)
      .then(() => setItems((p) => p.map((x) => (x.Id === n.Id ? { ...x, ReadAt: new Date().toISOString() } : x))))
      .catch(() => {});
  };

  const shown = items.filter((n) => {
    if (filter === "unread" && n.ReadAt) return false;
    if (fromDate || toDate) {
      if (!n.CreatedAt) return false;
      const day = localYmd(new Date(n.CreatedAt));
      if (fromDate && day < fromDate) return false;
      if (toDate && day > toDate) return false;
    }
    return true;
  });

  const txt = isDark ? colors.textPrimary : "#0F2138";
  const sub = isDark ? colors.textSecondary : "#526073";
  const line = isDark ? colors.border : "#EAEFF5";

  const th = {
    padding: "13px 14px", textAlign: "center", fontSize: 12.5, fontWeight: 700,
    color: "#ffffff", background: "#173456", letterSpacing: "0.04em",
    textTransform: "uppercase", fontFamily: FONT, whiteSpace: "nowrap",
  };
  const td = {
    padding: "12px 14px", textAlign: "center", verticalAlign: "middle",
    borderBottom: `1px solid ${line}`, fontFamily: FONT, fontSize: 13,
    color: txt, whiteSpace: "nowrap",
  };
  const dateInput = {
    padding: "6px 10px", borderRadius: 8, fontSize: 12.5, fontFamily: FONT,
    border: `1px solid ${line}`, background: isDark ? colors.card : "#fff",
    color: txt, colorScheme: isDark ? "dark" : "light",
  };
  const filterLabel = { fontSize: 12, fontWeight: 600, color: sub, fontFamily: FONT };

  return (
    <Wrapper pageTitle="Notifications">
      <div style={{ fontFamily: FONT, width: "100%" }}>
        {/* Filters */}
        <div style={{ display: "flex", gap: 14, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 8 }}>
            {["all", "unread"].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  padding: "6px 16px", borderRadius: 20, cursor: "pointer",
                  fontSize: 12.5, fontWeight: 600, fontFamily: FONT,
                  border: `1px solid ${filter === f ? "#1F5C99" : line}`,
                  background: filter === f ? "#1F5C99" : "transparent",
                  color: filter === f ? "#fff" : txt,
                }}
              >
                {f === "all" ? "All" : "Unread"}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
            <span style={filterLabel}>From</span>
            <input type="date" value={fromDate} max={toDate || undefined}
              onChange={(e) => setFromDate(e.target.value)} style={dateInput} />
            <span style={filterLabel}>To</span>
            <input type="date" value={toDate} min={fromDate || undefined}
              onChange={(e) => setToDate(e.target.value)} style={dateInput} />
            {(fromDate || toDate) && (
              <button
                onClick={() => { setFromDate(""); setToDate(""); }}
                style={{
                  padding: "6px 14px", borderRadius: 8, cursor: "pointer",
                  fontSize: 12.5, fontWeight: 600, fontFamily: FONT,
                  border: `1px solid ${line}`, background: "transparent", color: txt,
                }}
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <div style={{
          background: isDark ? colors.card : "#fff",
          border: `1px solid ${line}`, borderRadius: 12, overflow: "hidden",
        }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ ...th, width: 70 }}>S.No</th>
                  <th style={th}>Order Processing Updates</th>
                  
                  <th style={{ ...th, width: 130 }}>Date</th>
                  <th style={{ ...th, width: 110 }}>Time</th>
                  <th style={{ ...th, width: 140 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} style={{ ...td, color: sub }}>Loading…</td></tr>
                ) : shown.length === 0 ? (
                  <tr><td colSpan={5} style={{ ...td, color: sub }}>No notifications.</td></tr>
                ) : (
                  shown.map((n, i) => {
                    const d = n.CreatedAt ? new Date(n.CreatedAt) : null;
                    return (
                      <tr
                        key={n.Id}
                        onClick={() => markRead(n)}
                        style={{
                          background: !n.ReadAt ? (isDark ? "rgba(31,92,153,0.10)" : "rgba(31,92,153,0.05)") : "none",
                        }}
                      >
                        <td style={td}>{i + 1}</td>
                        <td
                          style={{ ...td, maxWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}
                          title={`${n.Title} - ${n.Message}`}
                        >
                          {!n.ReadAt && (
                            <span style={{
                              display: "inline-block", width: 8, height: 8, borderRadius: "50%",
                              background: "#E15C5C", marginRight: 8,
                            }} />
                          )}
                          <span style={{ fontWeight: 700 }}>{n.Title}</span>
                          <span style={{ color: sub }}> — {n.Message}</span>
                        </td>
                        
                        <td style={td}>{d ? d.toLocaleDateString("en-GB") : ""}</td>
                        <td style={td}>
                          {d ? d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : ""}
                        </td>
                        <td style={td}>
                          <span style={{
                            fontSize: 11, fontWeight: 700, color: "#1F5C99",
                            background: "rgba(31,92,153,0.10)", borderRadius: 10, padding: "3px 12px",
                          }}>
                            {TYPE_LABELS[n.Type] || n.Type}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Wrapper>
  );
}