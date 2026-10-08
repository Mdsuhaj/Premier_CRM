// src/pages/end-user/CustomerList.jsx
//
// Customer List for the "end_user" role (area/taluk-scoped field officer).
// Same GET /customers call as the master Customer List, but the backend
// already scopes the result to this end_user's assigned Taluk(s) — see
// CustomerController::index() — so no extra filtering is needed here.
//
// Kept simpler than the master page on purpose: a field officer can add
// customers in their area, but editing/deleting customer master records
// stays an admin/system_admin action, so those buttons aren't included.
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import EndUserLayout from "../../components/EndUserLayout";
import { useTheme } from "../../ThemeContext";
import { getG, statusColor } from "../../theme";
import API from "../../services/api";
import QuickAddCustomerModal from "../../components/QuickAddCustomerModal";

const FONT = "'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/* Row color by customer type — same palette as the master Customer List */
const typeColors = {
  wholesale: { bg: "rgba(216,230,243,0.22)", dot: "#5B9BD9", border: "rgba(91,155,217,0.20)" },
  retail: { bg: "rgba(200,240,200,0.22)", dot: "#1F5C99", border: "rgba(46,122,114,0.18)" },
};

const Badge = ({ text }) => {
  const s = statusColor(text);
  return (
    <span style={{ ...s, padding: "3px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, border: `1px solid ${s.border}` }}>
      {(text || "—").charAt(0).toUpperCase() + (text || "—").slice(1)}
    </span>
  );
};

const TypeBadge = ({ type }) => {
  const tc = typeColors[type] || typeColors.retail;
  return (
    <span style={{ fontSize: 12, fontWeight: 600, color: tc.dot, background: `${tc.border}`, border: `1px solid ${tc.border}`, padding: "2px 10px", borderRadius: 20 }}>
      {(type || "retail").charAt(0).toUpperCase() + (type || "retail").slice(1)}
    </span>
  );
};

function FilterPills({ values, active, onSelect, themeG }) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {values.map((v) => (
        <button
          key={v}
          onClick={() => onSelect(v)}
          style={{ padding: "6px 14px", borderRadius: 20, border: "1px solid", cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 500, transition: "all 0.12s", background: active === v ? "rgba(91,155,217,0.14)" : "transparent", color: active === v ? themeG.textLabel : themeG.textSub, borderColor: active === v ? "rgba(91,155,217,0.40)" : themeG.border }}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

export default function EndUserCustomerList() {
  const { isDark } = useTheme();
  const themeG = getG(isDark);
  const navigate = useNavigate();

  useEffect(() => {
    const role = localStorage.getItem("role");
    if (!role) { navigate("/login"); return; }
    if (role !== "end_user") { navigate("/dashboard"); return; }
  }, []);

  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("All");
  const [filterStatus, setFilterStatus] = useState("All");
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showQuickAdd, setShowQuickAdd] = useState(false);

  const load = async () => {
    try {
      const res = await API.get("/customers");
      const mapped = res.data.map((c) => ({
        id: c.Code,
        dbId: c.Id,
        name: c.Name,
        phone: c.Phone,
        district: c.District,
        taluk: c.Taluk,
        type: c.Type,
        status: c.Status,
        orders: c.orders_count ?? 0,
        balance: parseFloat(c.Outstanding) || 0,
      }));
      setCustomers(mapped);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load customers.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = customers.filter((c) => {
    const matchSearch = c.name.toLowerCase().includes(search.toLowerCase()) || c.id.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search);
    const matchType = filterType === "All" || c.type === filterType.toLowerCase();
    const matchStatus = filterStatus === "All" || c.status === filterStatus.toLowerCase();
    return matchSearch && matchType && matchStatus;
  });

  return (
    <EndUserLayout>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {error && (
        <div style={{ marginBottom: 16, background: "rgba(178,58,58,0.08)", border: "1px solid rgba(178,58,58,0.25)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#B23A3A" }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <input
          placeholder="Search name, ID or phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: "9px 14px", borderRadius: 9, border: `1px solid ${themeG.border}`, fontSize: 13, width: 260, fontFamily: FONT, background: themeG.card, outline: "none", color: themeG.textMain }}
        />
        <FilterPills values={["All", "Wholesale", "Retail"]} active={filterType} onSelect={setFilterType} themeG={themeG} />
        <FilterPills values={["All", "Approved", "Pending", "Declined"]} active={filterStatus} onSelect={setFilterStatus} themeG={themeG} />
        <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
          <button
            onClick={() => setShowQuickAdd(true)}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 18px", borderRadius: 9, background: "rgba(91,155,217,0.12)", color: themeG.accent, border: `1.5px solid ${themeG.accent}`, fontFamily: FONT, fontSize: 13, fontWeight: 700, cursor: "pointer" }}
          >
            ⚡ Quick Add
          </button>
          <button
            onClick={() => navigate("/end-user/customers/add")}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 20px", borderRadius: 9, background: themeG.accent, color: themeG.card, border: "none", fontFamily: FONT, fontSize: 13, fontWeight: 600, cursor: "pointer", boxShadow: "0 2px 10px rgba(91,155,217,0.32)" }}
          >
            + Add Customer
          </button>
        </div>
      </div>

      {showQuickAdd && (
        <QuickAddCustomerModal
          themeG={themeG}
          onClose={() => setShowQuickAdd(false)}
          onCreated={() => { setShowQuickAdd(false); load(); }}
        />
      )}

      <div style={{ background: themeG.card, border: `1px solid ${themeG.border}`, borderRadius: 14, boxShadow: "0 4px 16px rgba(46,122,114,0.06)" }}>
        <div style={{ overflowX: "auto", borderRadius: "14px 14px 0 0" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${themeG.border}` }}>
                {["ID", "Customer Name", "Phone", "District", "Taluk", "Type", "Orders", "Balance (₹)", "Status"].map((h) => (
                  <th key={h} style={{ textAlign: "center", fontSize: 11, padding: "10px 12px", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, whiteSpace: "nowrap", color: "#FFFFFF", background: "#1F3A63" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} style={{ textAlign: "center", padding: 40, color: themeG.textSub, fontSize: 14 }}>Loading customers…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} style={{ textAlign: "center", padding: 40, color: themeG.textSub, fontSize: 14 }}>No customers found in your area yet.</td></tr>
              ) : filtered.map((c) => {
                const rc = typeColors[c.type] || typeColors.retail;
                return (
                  <tr key={c.id} style={{ borderBottom: "1px solid rgba(46,122,114,0.06)", background: "#FFFFFF" }}>
                    <td style={{ padding: "12px 12px", fontSize: 13, color: themeG.accent, fontWeight: 600, borderLeft: `3px solid ${rc.dot}`, whiteSpace: "nowrap", textAlign: "center" }}>{c.id}</td>
                    <td style={{ padding: "12px 12px", fontSize: 14, color: themeG.textMain, fontWeight: 500, textAlign: "center" }}>
                      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={c.name}>{c.name}</span>
                    </td>
                    <td style={{ padding: "12px 12px", fontSize: 13, color: themeG.textSub, whiteSpace: "nowrap", textAlign: "center" }}>{c.phone}</td>
                    <td style={{ padding: "12px 12px", fontSize: 13, color: themeG.textMain, whiteSpace: "nowrap", textAlign: "center" }}>{c.district}</td>
                    <td style={{ padding: "12px 12px", fontSize: 13, color: themeG.textSub, whiteSpace: "nowrap", textAlign: "center" }}>{c.taluk}</td>
                    <td style={{ padding: "12px 12px", whiteSpace: "nowrap", textAlign: "center" }}><TypeBadge type={c.type} /></td>
                    <td style={{ padding: "12px 12px", fontSize: 13, fontWeight: 600, color: themeG.textMain, whiteSpace: "nowrap", textAlign: "center" }}>{c.orders}</td>
                    <td style={{ padding: "12px 12px", fontSize: 13, fontWeight: 700, color: c.balance > 0 ? "#B23A3A" : themeG.textSub, whiteSpace: "nowrap", textAlign: "center" }}>
                      {c.balance > 0 ? `₹${c.balance.toLocaleString()}` : "—"}
                    </td>
                    <td style={{ padding: "12px 12px", whiteSpace: "nowrap", textAlign: "center" }}><Badge text={c.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </EndUserLayout>
  );
}