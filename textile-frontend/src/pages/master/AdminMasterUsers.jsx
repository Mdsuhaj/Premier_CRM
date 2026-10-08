// src/pages/master/AdminMasterUsers.jsx
//
// Admin Master — "New User" page. Lists every end_user / admin /
// system_admin login account and lets Super Admin add, edit, or delete
// them. This is independent of the Employee / District-Taluk approval
// workflow (pages/master/AllocationSystemAdmin.jsx etc.) — accounts
// created here are live immediately with whatever Active status is set,
// no separate approval step.
import { useTheme } from "../../ThemeContext";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../../components/Layout";
import { getG, statusColor } from "../../theme";
import API from "../../services/api";

const FONT = "'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const ROLE_LABELS = {
  end_user: "End User",
  admin: "Admin",
  system_admin: "System Admin",
};

const Badge = ({ text }) => {
  const s = statusColor(text);
  return (
    <span style={{ ...s, padding: "3px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, border: `1px solid ${s.border}` }}>
      {text.charAt(0).toUpperCase() + text.slice(1)}
    </span>
  );
};

const RoleBadge = ({ role }) => {
  const palette = {
    end_user: { bg: "rgba(91,155,217,0.12)", color: "#1F5C99", border: "rgba(91,155,217,0.30)" },
    admin: { bg: "rgba(46,122,114,0.12)", color: "#1F5C99", border: "rgba(46,122,114,0.28)" },
    system_admin: { bg: "rgba(214,148,38,0.14)", color: "#8A5A0E", border: "rgba(214,148,38,0.30)" },
  };
  const p = palette[role] || palette.end_user;
  return (
    <span style={{ background: p.bg, color: p.color, border: `1px solid ${p.border}`, padding: "3px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>
      {ROLE_LABELS[role] || role}
    </span>
  );
};

const btnStyle = (color) => ({
  width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center",
  padding: 0, borderRadius: 7, border: `1px solid ${color}40`, background: `${color}14`,
  color, cursor: "pointer", fontSize: 13, fontFamily: "inherit", fontWeight: 600, flexShrink: 0,
});

function FilterPills({ values, active, onSelect }) {
  const { isDark } = useTheme();
  const themeG = getG(isDark);
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {values.map((v) => (
        <button
          key={v}
          onClick={() => onSelect(v)}
          style={{
            padding: "6px 14px", borderRadius: 20, border: "1px solid", cursor: "pointer",
            fontFamily: "inherit", fontSize: 12, fontWeight: 500, transition: "all 0.12s",
            background: active === v ? "rgba(91,155,217,0.14)" : "transparent",
            color: active === v ? themeG.textLabel : themeG.textSub,
            borderColor: active === v ? "rgba(91,155,217,0.40)" : themeG.border,
          }}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

export default function AdminMasterUsers() {
  const { isDark } = useTheme();
  const themeG = getG(isDark);
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState("All");
  const [filterStatus, setFilterStatus] = useState("All");
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState(null);
  const [confirmAcc, setConfirmAcc] = useState(null); // account waiting for delete confirmation  

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await API.get("/accounts");
      setAccounts(res.data);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load accounts.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const handleDelete = async (acc) => {
    setConfirmAcc(null); // close the popup
    setDeletingId(acc.id);
    setError("");
    try {
      await API.delete(`/accounts/${acc.id}`);
      setAccounts((list) => list.filter((a) => a.id !== acc.id));
    } catch (err) {
      setError(err.response?.data?.message || "Failed to delete account.");
    } finally {
      setDeletingId(null);
    }
  };

  const filtered = accounts.filter((a) => {
    const status = (a.Status || "active").toLowerCase();
    const matchSearch =
      (a.name || "").toLowerCase().includes(search.toLowerCase()) ||
      (a.email || "").toLowerCase().includes(search.toLowerCase()) ||
      (a.Designation || "").toLowerCase().includes(search.toLowerCase());
    const matchRole = filterRole === "All" || a.role === filterRole;
    const matchStatus = filterStatus === "All" || status === filterStatus.toLowerCase();
    return matchSearch && matchRole && matchStatus;
  });

  return (
    <Layout pageTitle="Admin Master" pageSubtitle="Create and manage End User, Admin and System Admin accounts">
      {error && (
        <div style={{ marginBottom: 16, background: "rgba(178,58,58,0.08)", border: "1px solid rgba(178,58,58,0.25)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#B23A3A" }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <input
          placeholder="Search username, user ID or designation…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: "9px 14px", borderRadius: 9, border: `1px solid ${themeG.border}`, fontSize: 13, width: 280, fontFamily: FONT, background: themeG.card, outline: "none", color: themeG.textMain }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <label style={{ fontSize: 10, fontWeight: 700, color: themeG.textLabel, textTransform: "uppercase", letterSpacing: "0.05em" }}>Designation</label>
          <select
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value)}
            style={{ padding: "8px 12px", borderRadius: 9, border: `1px solid ${themeG.border}`, fontSize: 13, fontFamily: FONT, background: themeG.card, color: themeG.textMain, outline: "none", cursor: "pointer" }}
          >
            <option value="All">All</option>
            <option value="end_user">End User</option>
            <option value="admin">Admin</option>
            <option value="system_admin">System Admin</option>
          </select>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <label style={{ fontSize: 10, fontWeight: 700, color: themeG.textLabel, textTransform: "uppercase", letterSpacing: "0.05em" }}>Status</label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            style={{ padding: "8px 12px", borderRadius: 9, border: `1px solid ${themeG.border}`, fontSize: 13, fontFamily: FONT, background: themeG.card, color: themeG.textMain, outline: "none", cursor: "pointer" }}
          >
            <option value="All">All</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <button
            onClick={() => navigate("/master/admin-master/users/add")}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 20px", borderRadius: 9, background: themeG.accent, color: themeG.card, border: "none", fontFamily: FONT, fontSize: 13, fontWeight: 600, cursor: "pointer", boxShadow: "0 2px 10px rgba(91,155,217,0.32)" }}
          >
            <PlusIcon /> Add New
          </button>
        </div>
      </div>

      <div style={{ background: themeG.card, border: `1px solid ${themeG.border}`, borderRadius: 14, boxShadow: "0 4px 16px rgba(46,122,114,0.06)" }}>
        <div style={{ overflowX: "auto", borderRadius: "14px 14px 0 0" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${themeG.border}` }}>
                {["Username", "User ID", "Designation", "District", "Role", "Status", "Actions"].map((h) => (
                  <th key={h} style={{ textAlign: "center", fontSize: 11, padding: "10px 12px", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, whiteSpace: "nowrap", color: "#FFFFFF", background: "#1F3A63" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ textAlign: "center", padding: 30, color: themeG.textSub }}>Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: "center", padding: 40, color: themeG.textSub, fontSize: 14 }}>No accounts found.</td></tr>
              ) : filtered.map((a) => (
                <tr key={a.id} style={{ borderBottom: "1px solid rgba(46,122,114,0.06)", background: "#FFFFFF" }}>
                  <td style={{ padding: "12px 12px", fontSize: 14, color: themeG.textMain, fontWeight: 500, textAlign: "center" }}>{a.name}</td>
                  <td style={{ padding: "12px 12px", fontSize: 13, color: themeG.accent, fontWeight: 600, whiteSpace: "nowrap", textAlign: "center" }}>{a.email}</td>
                  <td style={{ padding: "12px 12px", fontSize: 13, color: themeG.textSub, whiteSpace: "nowrap", textAlign: "center" }}>{a.Designation || "—"}</td>
                  <td style={{ padding: "12px 12px", fontSize: 13, color: themeG.textSub, whiteSpace: "nowrap", textAlign: "center" }}>{a.District || "—"}</td>
                  <td style={{ padding: "12px 12px", whiteSpace: "nowrap", textAlign: "center" }}><RoleBadge role={a.role} /></td>
                  <td style={{ padding: "12px 12px", whiteSpace: "nowrap", textAlign: "center" }}><Badge text={(a.Status || "active").toLowerCase()} /></td>
                  <td style={{ padding: "12px 12px", textAlign: "center" }}>
                    <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                      <button style={btnStyle(themeG.accent)} onClick={() => navigate(`/master/admin-master/users/${a.id}/edit`)} title="Edit">✏️</button>
                      <button
                        style={btnStyle("#B23A3A")}
                        disabled={deletingId === a.id}
                        onClick={() => setConfirmAcc(a)}
                        title="Delete account"
                      >
                        {deletingId === a.id ? "…" : "🗑️"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ padding: "10px 13px", borderTop: `1px solid ${themeG.border}`, fontSize: 12, color: themeG.textSub }}>
          Showing {filtered.length} of {accounts.length} account{accounts.length !== 1 ? "s" : ""}
        </div>
      </div>

      {confirmAcc && (
        <div
          onClick={() => setConfirmAcc(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(15,33,56,0.55)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: themeG.card, borderRadius: 14, padding: "26px 28px", width: 400,
              maxWidth: "90vw", textAlign: "center", fontFamily: FONT,
              boxShadow: "0 18px 50px rgba(0,0,0,0.30)", border: `1px solid ${themeG.border}`,
            }}
          >
            <div style={{ fontSize: 40, marginBottom: 6 }}>🗑️</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: themeG.textMain, marginBottom: 8 }}>
              Are you sure you want to delete?
            </div>
            <div style={{ fontSize: 13, color: themeG.textSub, marginBottom: 22, lineHeight: 1.5 }}>
              Account <b>{confirmAcc.name}</b> will be permanently deleted. This cannot be undone.
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button
                onClick={() => setConfirmAcc(null)}
                style={{
                  padding: "9px 26px", borderRadius: 9, cursor: "pointer", fontFamily: FONT,
                  fontSize: 13, fontWeight: 600, background: "transparent",
                  border: `1px solid ${themeG.border}`, color: themeG.textMain,
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirmAcc)}
                style={{
                  padding: "9px 26px", borderRadius: 9, cursor: "pointer", fontFamily: FONT,
                  fontSize: 13, fontWeight: 700, background: "#B23A3A", border: "none", color: "#fff",
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
