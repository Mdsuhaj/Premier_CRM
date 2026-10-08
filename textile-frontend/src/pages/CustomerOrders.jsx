// src/pages/CustomerOrders.jsx
//
// TABLE REDESIGN (latest): previously this showed a product-line table
// (Sort No / Shade No / Product Description / Qty / UOM / Color / Type /
// Status) built mostly from dummy placeholder fields (dummyShadeNo(),
// dummyDescription(), dummyType(), DUMMY_SWATCHES), and never surfaced
// the order's own Code, the customer's name, who's following it up, or
// its delivery date at all.
//
// Replaced with the same column layout now used on the staff-side Order
// List (OrderList.jsx), so a customer's own order history reads the same
// way everywhere in the app:
//   S.No | Order No | Date | Customer Name | Sub Type | Product Name |
//   Qty | Following Person | Delivery Date | Status
// (No Actions column here — customers can view but not edit/delete their
// own placed orders from this screen, unlike the staff Order List.)
//
// Every field is real, not a placeholder:
//   - Order No       -> o.Code
//   - Customer Name   -> o.customer?.Name (falls back to this logged-in
//                        customer's own record if the order response
//                        doesn't eager-load it)
//   - Sub Type        -> o.product?.SubType || o.SubType
//   - Product Name    -> o.product?.Name
//
// FIX (Following Person not resolving): this previously only checked
// o.assignee?.Name/name and gave up with "—" the moment that relation
// wasn't eager-loaded on the order response — it never tried the other
// two fallbacks OrderList.jsx already relies on for the exact same
// field. Now uses the identical 3-step chain:
//   1. o.assignee?.Name / o.assignee?.name        (eager-loaded relation)
//   2. /users list matched against o.AssignedTo    (raw id, relation not
//      loaded yet)
//   3. this order's own customer's registered Contact Person
//      (customer?.ContactPersons?.[0]?.contactName) — for orders nobody
//      on staff has claimed yet
// Only falls through to "—" if none of the three resolve.
//
// ── NEW: Search bar / Status filter / Type pills ─────────────────────
// Same conventions as Marketing Review (Batches.jsx):
//   - Search bar matches Order No, Customer Name, Product Name, and Sub
//     Type, case-insensitively.
//   - Status filter dropdown: All / Pending / Approved / Rejected. Note
//     the backend's real Order.Status value for a rejected order is
//     'declined' (see AllocationController@cascadeOrderStatus) — the
//     dropdown still LABELS it "Rejected" for the customer, but filters
//     against the real 'declined' value underneath, same as how Batches
//     labels its own Allocation Status dropdown.
//   - Type pills: Dhoti / Blouse / Uniform Shirting / Uniform Suiting /
//     Others, using the identical match/groupFor() convention as
//     CATEGORY_GROUPS in Batches.jsx, applied to each order's own Sub
//     Type. An "All" pill (not in Batches, added here since a customer's
//     order history isn't scoped to a single top-level category the way
//     Marketing Review is).
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Shirt, Layers, Briefcase, Ruler, LayoutGrid } from "lucide-react";
import CustomerLayout from "../components/CustomerLayout";
import { useTheme } from "../ThemeContext";
import { getG, statusColor } from "../theme";
import API from "../services/api";

const FONT = "'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const TABLE_HEADERS = ["S.No", "Enquiry No", "Enquiry Date", "Customer Name", "Sub Type", "UOM", "Product Name", "Qty", "Following Person", "Delivery Date", "Status"];

// ── Status filter — labelled Pending / Approved / Rejected for the
// customer, but 'rejected' filters against the real backend value
// 'declined' (see file header note above). ──
const STATUS_FILTER_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "declined", label: "Rejected" },
];

// ── Type pills — identical match/groupFor() convention as
// CATEGORY_GROUPS (CLOTH_GROUPS) in Batches.jsx, so a Sub Type resolves
// to the same pill here as it would on the staff-side Marketing Review
// board. ──
const CLOTH_GROUPS = [
  { id: "dhoti", name: "Dhoti", match: ["dhoti", "dothi", "cotton dhoti grey", "cotton dhoti fabric"], icon: Layers, color: "#1C7A4B", tagBg: "#DCF3E6", tagText: "#1C7A4B" },
  { id: "blouse", name: "Blouse", match: ["blouse"], icon: Shirt, color: "#1E5B95", tagBg: "#DCEAF7", tagText: "#1E5B95" },
  { id: "uniform_shirting", name: "Uniform Shirting", match: ["uniform shirting"], icon: Briefcase, color: "#B2622E", tagBg: "#F7E3D2", tagText: "#B2622E" },
  { id: "uniform_suiting", name: "Uniform Suiting", match: ["uniform suiting"], icon: Ruler, color: "#5B4B8C", tagBg: "#E7E1F5", tagText: "#5B4B8C" },
  { id: "others", name: "Others", match: ["others"], icon: LayoutGrid, color: "#D97706", tagBg: "#FBEAD3", tagText: "#D97706" },
];

const normalize = (v) => (v ?? "").toString().trim().toLowerCase().replace(/\s+/g, " ");

// Same label-only override used across Product Selection / Cart / Order
// Enquiry / staff Order List pages — "Meter" is stored/matched exactly
// as before, only shown as "Mtr" here.
const UOM_LABEL_OVERRIDES = { Meter: "Mtr", Box: "Cases" };
function uomLabel(value) {
  return UOM_LABEL_OVERRIDES[value] || value;
}

const groupFor = (subType) => {
  const c = normalize(subType);
  if (!c) return CLOTH_GROUPS[CLOTH_GROUPS.length - 1]; // Others
  const exact = CLOTH_GROUPS.find((g) => g.match.includes(c));
  if (exact) return exact;
  const partial = CLOTH_GROUPS.find((g) => g.match.some((m) => c.includes(m) || m.includes(c)));
  return partial || CLOTH_GROUPS[CLOTH_GROUPS.length - 1];
};

const Badge = ({ text, colorFn }) => {
  const s = colorFn(text || "—");
  return (
    <span style={{ ...s, padding: "3px 11px", borderRadius: 20, fontSize: 12, fontWeight: 600, border: `1px solid ${s.border}`, fontFamily: FONT }}>
      {(text || "—").charAt(0).toUpperCase() + (text || "—").slice(1)}
    </span>
  );
};

export default function CustomerOrders() {
  const { isDark } = useTheme();
  const themeG = getG(isDark);
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem("user") || "{}");

  const [orders, setOrders] = useState([]);
  const [ownCustomer, setOwnCustomer] = useState(null);
  const [followPeople, setFollowPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // ── New filter state ──
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [uomFilter, setUomFilter] = useState("");
  const [activeType, setActiveType] = useState("all");

  const styles = {
    heading: { fontFamily: "'Space Grotesk', " + FONT, fontSize: 28, fontWeight: 700, margin: "0 0 4px", color: themeG.textMain, letterSpacing: "-0.4px" },
    headingSub: { fontSize: 13, color: themeG.textSub, margin: "0 0 22px" },
    tableBox: { background: themeG.card, border: `1px solid ${themeG.border}`, borderRadius: 14, overflow: "hidden", boxShadow: "0 4px 16px rgba(15,33,56,0.06)" },
    // Shows roughly 10 data rows before scrolling; header stays pinned
    // (position: sticky, already set on th below) while the body scrolls.
    tableScroll: { overflowX: "auto", overflowY: "auto", maxHeight: 560 },
    table: { width: "100%", minWidth: 1000, borderCollapse: "collapse" },
    th: { textAlign: "center", padding: "12px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#FFFFFF", background: "#1F3A63", borderBottom: `1px solid ${themeG.border}`, position: "sticky", top: 0, zIndex: 1, whiteSpace: "nowrap" },
    td: { padding: "12px 13px", fontSize: 13.5, color: themeG.textMain, borderBottom: "1px solid rgba(46,122,114,0.06)", fontFamily: FONT, whiteSpace: "nowrap", textAlign: "center" },

    // ── Filter bar ──
    filterBar: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16 },
    searchWrap: { position: "relative", flex: "1 1 260px", maxWidth: 360 },
    searchIcon: { position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: themeG.textSub },
    searchInput: {
      width: "100%", boxSizing: "border-box", padding: "9px 12px 9px 34px", borderRadius: 10,
      border: `1px solid ${themeG.border}`, background: themeG.card, color: themeG.textMain,
      fontFamily: FONT, fontSize: 13, outline: "none",
    },
    statusSelect: {
      padding: "9px 12px", borderRadius: 10, border: `1px solid ${themeG.border}`,
      background: themeG.card, color: themeG.textMain, fontFamily: FONT, fontSize: 13,
      outline: "none", cursor: "pointer",
    },

    // ── Type pills ──
    pillRow: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 },
    pill: (active, color) => ({
      display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 20,
      border: "none", cursor: "pointer", fontFamily: FONT, fontSize: 12.5, fontWeight: 700,
      background: active ? color : themeG.card, color: active ? "#fff" : themeG.textMain,
      boxShadow: active ? `0 3px 10px ${color}55` : "0 2px 6px rgba(15,33,56,0.06)",
      border: active ? "none" : `1px solid ${themeG.border}`,
    }),
    pillCount: { opacity: 0.85, fontWeight: 600 },
  };

  useEffect(() => {
    (async () => {
      try {
        const [ordRes, custRes, usersRes] = await Promise.all([
          API.get("/orders"),
          API.get("/customers").catch(() => ({ data: [] })),
          // Same roster OrderList.jsx uses to resolve a raw AssignedTo id
          // into a name when the `assignee` relation isn't eager-loaded
          // on the order itself.
          API.get("/users", { params: { roles: "admin,system_admin,end_user" } }).catch(() => ({ data: [] })),
        ]);
        setOrders(ordRes.data);
        // This logged-in customer's own record — used both as a Customer
        // Name fallback and as the source of the Contact Person fallback
        // for Following Person below.
        setOwnCustomer(custRes.data?.[0] || null);
        setFollowPeople(usersRes.data || []);
      } catch {
        setError("Failed to load your orders. Please refresh.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line
  }, []);

  // ── Derive display-ready rows once, so filtering below doesn't
  // recompute customerName/subType/followName on every render. ──
  const rows = useMemo(() => {
    return orders.map((o) => {
      const p = o.product || {};
      const customer = o.customer || ownCustomer;
      const customerName = customer?.Name || user.name || "—";
      const subType = p.SubType || o.SubType || "—";
      const productName = p.Name || "—";
      const uom = o.OrderDetails?.UOM || o.OrderDetails?.uom || p.UOM || "—";

      // Same 3-step chain as OrderList.jsx: eager-loaded relation ->
      // /users lookup by raw AssignedTo id -> this customer's own
      // registered Contact Person. Only "—" if all three miss.
      const assignedName =
        o.assignee?.Name ||
        o.assignee?.name ||
        followPeople.find((u) => String(u.Id ?? u.id) === String(o.AssignedTo))?.Name ||
        followPeople.find((u) => String(u.Id ?? u.id) === String(o.AssignedTo))?.name ||
        (o.AssignedTo ? `User #${o.AssignedTo}` : null);
      const contactPersonName = customer?.ContactPersons?.[0]?.contactName || null;
      const followName = assignedName || contactPersonName || "—";

      const deliveryDate = o.DeliveryDate ? o.DeliveryDate.substring(0, 10) : "—";
      const date = o.CreatedAt ? o.CreatedAt.substring(0, 10) : "—";

      return {
        order: o,
        orderNo: o.Code || "—",
        date,
        customerName,
        subType,
        uom,
        productName,
        qty: o.Quantity,
        followName,
        deliveryDate,
        status: o.Status || "",
        group: groupFor(subType),
      };
    });
  }, [orders, ownCustomer, followPeople, user.name]);

  // ── Type pill counts (over the full order list, unaffected by search
  // /status so switching pills never feels like it's fighting the other
  // filters). ──
  const catCounts = useMemo(() => {
    const m = { all: rows.length };
    CLOTH_GROUPS.forEach((g) => { m[g.id] = 0; });
    rows.forEach((r) => { m[r.group.id] = (m[r.group.id] || 0) + 1; });
    return m;
  }, [rows]);

  // UOM dropdown options — every distinct real UOM value on the loaded
  // orders, plus the app's canonical Box/Pieces/Meter set so the
  // dropdown always has something even before orders load. Labels go
  // through uomLabel() so "Meter" shows as "Mtr"; filtering still
  // matches the real stored value underneath.
  const UOM_FILTER_FALLBACK = ["Box", "Pieces", "Meter"];
  const uomOptions = useMemo(() => {
    const fromData = rows.map((r) => r.uom).filter((u) => u && u !== "—");
    return Array.from(new Set([...fromData, ...UOM_FILTER_FALLBACK])).sort();
  }, [rows]);

  // ── Search + Status + UOM + Type filtering, applied together. ──
  const filteredRows = useMemo(() => {
    let list = rows;
    if (activeType !== "all") list = list.filter((r) => r.group.id === activeType);
    if (statusFilter) list = list.filter((r) => normalize(r.status) === statusFilter);
    if (uomFilter) list = list.filter((r) => r.uom === uomFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((r) =>
        r.orderNo.toLowerCase().includes(q) ||
        r.customerName.toLowerCase().includes(q) ||
        r.productName.toLowerCase().includes(q) ||
        r.subType.toLowerCase().includes(q));
    }
    return list;
  }, [rows, activeType, statusFilter, uomFilter, search]);

  return (
    <CustomerLayout>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />


      {error && (
        <div style={{ marginBottom: 20, background: "rgba(178,58,58,0.08)", border: "1px solid rgba(178,58,58,0.25)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#B23A3A" }}>
          {error}
        </div>
      )}

      {/* Search bar + Status filter */}
      <div style={styles.filterBar}>
        <div style={styles.searchWrap}>
          <Search size={14} style={styles.searchIcon} />
          <input
            type="text"
            placeholder="Search order no, product, or sub type…"
            style={styles.searchInput}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          style={styles.statusSelect}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          {STATUS_FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          style={styles.statusSelect}
          value={uomFilter}
          onChange={(e) => setUomFilter(e.target.value)}
        >
          <option value="">All UOM</option>
          {uomOptions.map((u) => (
            <option key={u} value={u}>{uomLabel(u)}</option>
          ))}
        </select>
      </div>

      {/* Type pills — Dhoti / Blouse / Uniform Shirting / Uniform Suiting /
          Others, same grouping convention as Marketing Review. */}
      <div style={styles.pillRow}>
        <button
          onClick={() => setActiveType("all")}
          style={styles.pill(activeType === "all", "#0F2138")}
        >
          <LayoutGrid size={13} />
          All <span style={styles.pillCount}>({catCounts.all || 0})</span>
        </button>
        {CLOTH_GROUPS.map((g) => {
          const Icon = g.icon;
          return (
            <button
              key={g.id}
              onClick={() => setActiveType(g.id)}
              style={styles.pill(activeType === g.id, g.color)}
            >
              <Icon size={13} />
              {g.name} <span style={styles.pillCount}>({catCounts[g.id] || 0})</span>
            </button>
          );
        })}
      </div>

      <div style={styles.tableBox}>
        <div style={styles.tableScroll}>
          <table style={styles.table}>
            <thead>
              <tr>
                {TABLE_HEADERS.map((h) => (
                  <th key={h} style={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={TABLE_HEADERS.length} style={{ ...styles.td, textAlign: "center", padding: 30, whiteSpace: "normal" }}>Loading your orders…</td></tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={TABLE_HEADERS.length} style={{ ...styles.td, textAlign: "center", padding: 30, whiteSpace: "normal" }}>
                    {orders.length === 0 ? "No orders yet." : "No orders match your search or filters."}
                  </td>
                </tr>
              ) : filteredRows.map((r, i) => (
                <tr key={r.order.Id}>
                  <td style={{ ...styles.td, color: themeG.textSub }}>{i + 1}</td>
                  <td style={{ ...styles.td, color: themeG.accent, fontWeight: 700 }}>{r.orderNo}</td>
                  <td style={styles.td}>{r.date}</td>
                  <td style={styles.td}>{r.customerName}</td>
                  <td style={styles.td}>{r.subType}</td>
                  <td style={styles.td}>{uomLabel(r.uom)}</td>
                  <td style={styles.td}>{r.productName}</td>
                  <td style={styles.td}>{r.qty}</td>
                  <td style={styles.td}>{r.followName}</td>
                  <td style={styles.td}>{r.deliveryDate}</td>
                  <td style={styles.td}><Badge text={r.status} colorFn={statusColor} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ padding: "10px 13px", borderTop: `1px solid ${themeG.border}`, fontSize: 12, color: themeG.textSub, fontFamily: FONT }}>
          Showing {filteredRows.length} of {orders.length} order{orders.length !== 1 ? "s" : ""}
        </div>
      </div>
    </CustomerLayout>
  );
}