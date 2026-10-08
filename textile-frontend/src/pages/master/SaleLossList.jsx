// src/pages/master/SaleLossList.jsx
//
// Sale Loss page — admin + system_admin.
// Lists every order whose status is Sale Loss, with its own columns
// (Sale Loss Reason / Marked On / Marked By).
//
// Route (App.jsx):
//   <Route path="/master/sale-loss" element={<SaleLossList />} />
import { useTheme } from "../../ThemeContext";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Eye } from "lucide-react";
import Layout from "../../components/AppLayout";
import { getG } from "../../theme";
import API from "../../services/api";
import { isSaleLossStatus, SALE_LOSS_PATH, REJECT_PATH } from "../../utils/orderStatus";

const FONT = "'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const ACCENT = "#8A5A0E"; // Sale Loss colour

const UOM_LABEL_OVERRIDES = { Meter: "Mtr", Box: "Cases" };
const uomLabel = (v) => UOM_LABEL_OVERRIDES[v] || v;

// Table columns for THIS page.
const COLUMNS = [
  "S.No", "Enquiry No", "Date", "Customer Name", "Sub Type", "UOM", "Qty",
  "Following Person", "Delivery Date", "Sale Loss Reason", "Marked On", "Marked By", "Actions",
];

const fmtDate = (v) => (v ? String(v).replace("T", " ").substring(0, 10) : "—");

export default function SaleLossList() {
  const { isDark } = useTheme();
  const themeG = getG(isDark);
  const navigate = useNavigate();
  const role = localStorage.getItem("role") || "";
  const tab = localStorage.getItem("premier_category") || "cloth";

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [uomFilter, setUomFilter] = useState("All");
  const [subTypeFilter, setSubTypeFilter] = useState("All");

  useEffect(() => {
    (async () => {
      try {
        const params = {};
        if (role === "admin") params.scope = "own_and_team";
        const [ordRes, custRes, prodRes, usersRes] = await Promise.all([
          API.get("/orders", { params }),
          API.get("/customers"),
          API.get("/products"),
          API.get("/users", { params: { roles: "admin,system_admin,end_user" } }).catch(() => ({ data: [] })),
        ]);
        const people = usersRes.data || [];
        const customersById = {};
        (custRes.data || []).forEach((c) => { customersById[c.Id] = c; });
        const productsById = {};
        (prodRes.data || []).forEach((p) => { productsById[p.Id] = p; });

        const mapped = (ordRes.data || [])
          .filter((o) => isSaleLossStatus(o.Status))
          .map((o) => {
            const d = o.OrderDetails || {};
            const assigned =
              o.assignee?.Name || o.assignee?.name ||
              people.find((p) => String(p.Id ?? p.id) === String(o.AssignedTo))?.Name ||
              null;
            const customer = o.customer || customersById[o.CustomerId];
            return {
              id: o.Code,
              dbId: o.Id,
              category: o.Category,
              customer: o.customer?.Name ?? customer?.Name ?? "—",
              subType: o.SubType || "—",
              uom: d.UOM || d.uom || o.product?.UOM || productsById[o.ProductId]?.UOM || "—",
              qty: o.Quantity,
              followPerson: assigned || customer?.ContactPersons?.[0]?.contactName || "—",
              date: o.CreatedAt ? o.CreatedAt.substring(0, 10) : "",
              deliveryDate: o.DeliveryDate ? o.DeliveryDate.substring(0, 10) : null,
              groupRef: d.GroupRef ?? d.CartRef ?? null,
              reason: d.SaleLossReason || "—",
              markedOn: d.SaleLossAt || null,
              markedBy: d.SaleLossBy || "—",
            };
          });
        setOrders(mapped);
      } catch {
        setError("Failed to load sale loss orders.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line
  }, []);

  // Cart lines that share a GroupRef collapse into one row.
  const rows = (() => {
    const groups = new Map();
    const singles = [];
    orders.forEach((o) => {
      if (!o.groupRef) { singles.push(o); return; }
      if (!groups.has(o.groupRef)) groups.set(o.groupRef, []);
      groups.get(o.groupRef).push(o);
    });
    const groupRows = [...groups.values()].map((m) => ({
      ...m[0],
      isGroup: true,
      memberIds: m.map((x) => x.dbId),
      qty: m.reduce((s, x) => s + (parseFloat(x.qty) || 0), 0),
    }));
    return [...singles, ...groupRows].sort((a, b) => b.dbId - a.dbId);
  })();

  const uomOptions = Array.from(new Set(rows.map((o) => o.uom).filter((u) => u && u !== "—"))).sort();
  const subTypeOptions = Array.from(new Set(rows.map((o) => o.subType).filter((s) => s && s !== "—"))).sort();

  const q = search.toLowerCase();
  const filtered = rows.filter((o) =>
    o.category === tab &&
    (uomFilter === "All" || o.uom === uomFilter) &&
    (subTypeFilter === "All" || o.subType === subTypeFilter) &&
    (!q ||
      o.id.toLowerCase().includes(q) ||
      o.customer.toLowerCase().includes(q) ||
      o.followPerson.toLowerCase().includes(q) ||
      o.reason.toLowerCase().includes(q))
  );

  const selectStyle = { padding: "8px 13px", borderRadius: 9, border: `1px solid ${themeG.border}`, fontSize: 12.5, fontFamily: FONT, background: themeG.card, color: themeG.textMain, outline: "none" };
  const td = { padding: "12px 13px", fontSize: 13, color: themeG.textMain, fontFamily: FONT, textAlign: "center" };

  // Same dropdown as Order List so the user can hop between the three pages.
  const handleJump = (v) => {
    if (v === "orders") navigate("/master/orders");
    else if (v === "reject") navigate(REJECT_PATH);
  };

  return (
    <Layout pageTitle="Sale Loss">
      <h2 style={{ margin: "0 0 18px", fontFamily: FONT, fontSize: 20, fontWeight: 700, color: themeG.textMain }}>Sale Loss</h2>

      {error && (
        <div style={{ marginBottom: 16, background: "rgba(178,58,58,0.08)", border: "1px solid rgba(178,58,58,0.25)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#B23A3A", fontFamily: FONT }}>{error}</div>
      )}

      <div style={{ display: "flex", gap: 12, marginBottom: 18, flexWrap: "wrap", alignItems: "center" }}>
        <input
          placeholder="Search order, customer, follow person, reason…"
          value={search} onChange={(e) => setSearch(e.target.value)}
          style={{ padding: "9px 14px", borderRadius: 9, border: `1px solid ${themeG.border}`, fontSize: 13, width: 280, fontFamily: FONT, background: themeG.card, outline: "none", color: themeG.textMain }}
        />
        <select value="sale_loss" onChange={(e) => handleJump(e.target.value)} style={{ ...selectStyle, minWidth: 170 }}>
          <option value="orders">Order List</option>
          <option value="sale_loss">Sale Loss</option>
          <option value="reject">Reject</option>
        </select>
        <select value={uomFilter} onChange={(e) => setUomFilter(e.target.value)} style={selectStyle}>
          <option value="All">All UOM</option>
          {uomOptions.map((u) => <option key={u} value={u}>{uomLabel(u)}</option>)}
        </select>
        <select value={subTypeFilter} onChange={(e) => setSubTypeFilter(e.target.value)} style={selectStyle}>
          <option value="All">All Sub Types</option>
          {subTypeOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div style={{ display: "flex", gap: 16, marginBottom: 18 }}>
        <div style={{ background: themeG.card, border: `1px solid ${themeG.border}`, borderRadius: 10, padding: "12px 20px", flex: 1 }}>
          <p style={{ margin: "0 0 4px", fontSize: 11, color: themeG.textLabel, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: FONT }}>Total Sale Loss</p>
          <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: ACCENT, fontFamily: "'Space Grotesk', " + FONT }}>{filtered.length}</p>
        </div>
        <div style={{ background: themeG.card, border: `1px solid ${themeG.border}`, borderRadius: 10, padding: "12px 20px", flex: 1 }}>
          <p style={{ margin: "0 0 4px", fontSize: 11, color: themeG.textLabel, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: FONT }}>Total Qty Lost</p>
          <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: themeG.accent, fontFamily: "'Space Grotesk', " + FONT }}>
            {filtered.reduce((s, o) => s + (parseFloat(o.qty) || 0), 0)}
          </p>
        </div>
      </div>

      <div style={{ background: "#FFFFFF", border: "1px solid rgba(91,155,217,0.35)", borderRadius: 14, overflow: "hidden", boxShadow: "0 4px 16px rgba(46,122,114,0.06)" }}>
        <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: 520 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1280 }}>
            <thead>
              <tr>
                {COLUMNS.map((h) => (
                  <th key={h} style={{ textAlign: "center", fontSize: 11, padding: "10px 13px", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600, color: "#FFFFFF", background: "#1F3A63", fontFamily: FONT, whiteSpace: "nowrap", position: "sticky", top: 0, zIndex: 1 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={COLUMNS.length} style={{ ...td, padding: 40, color: themeG.textSub }}>Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={COLUMNS.length} style={{ ...td, padding: 40, color: themeG.textSub, fontSize: 14 }}>No sale loss orders.</td></tr>
              ) : filtered.map((o, idx) => (
                <tr key={o.id} style={{ borderBottom: "1px solid rgba(46,122,114,0.06)", background: "#FFFFFF" }}>
                  <td style={{ ...td, color: themeG.textSub, borderLeft: `3px solid ${ACCENT}` }}>{idx + 1}</td>
                  <td style={{ ...td, color: themeG.accent, fontWeight: 700, whiteSpace: "nowrap" }}>
                    {o.id}
                    {o.isGroup && (
                      <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: ACCENT, background: "rgba(138,90,14,0.10)", border: "1px solid rgba(138,90,14,0.25)", padding: "1px 8px", borderRadius: 20 }}>
                        {o.memberIds.length} products
                      </span>
                    )}
                  </td>
                  <td style={{ ...td, fontSize: 12, color: themeG.textSub, whiteSpace: "nowrap" }}>{o.date}</td>
                  <td style={{ ...td, fontSize: 14, fontWeight: 500 }}>{o.customer}</td>
                  <td style={td}>{o.subType}</td>
                  <td style={td}>{uomLabel(o.uom)}</td>
                  <td style={td}>{o.qty}</td>
                  <td style={{ ...td, color: themeG.textSub }}>{o.followPerson}</td>
                  <td style={{ ...td, fontSize: 12, whiteSpace: "nowrap" }}>{o.deliveryDate || "—"}</td>
                  <td style={{ ...td, maxWidth: 240, color: ACCENT, fontWeight: 600 }}>{o.reason}</td>
                  <td style={{ ...td, fontSize: 12, whiteSpace: "nowrap" }}>{fmtDate(o.markedOn)}</td>
                  <td style={{ ...td, color: themeG.textSub }}>{o.markedBy}</td>
                  <td style={td}>
                    <button type="button" aria-label="View order" onClick={() => navigate(`/master/orders/add?editId=${o.dbId}&mode=view`)}
                      style={{ padding: "6px 11px", borderRadius: 7, border: `1px solid ${themeG.accent}40`, background: `${themeG.accent}14`, color: themeG.accent, cursor: "pointer", display: "inline-flex", alignItems: "center" }}>
                      <Eye size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ padding: "10px 13px", borderTop: `1px solid ${themeG.border}`, fontSize: 12, color: themeG.textSub, fontFamily: FONT }}>
          Showing {filtered.length} sale loss {tab} orders
        </div>
      </div>
    </Layout>
  );
}