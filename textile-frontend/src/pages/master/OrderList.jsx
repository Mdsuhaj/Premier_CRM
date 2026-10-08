// src/pages/master/OrderList.jsx
//
// Orders hub.
//
//   - admin / system_admin : ONE page — "Order List".
//       * Status pills are replaced by a single dropdown:
//           Pending Allocation | Partial Allocation | Fully Allocated |
//           Approved | ERP Transfer | Sale Loss | Reject
//         The first five are filters and come from REAL data (GET /allocations/board).
//         "Sale Loss" and "Reject" are NOT filters — picking one opens their own
//         separate pages (SaleLossList.jsx / RejectedList.jsx).
//         Orders whose status is Sale Loss / Rejected are hidden from this list.
//       * Actions column = only 2 icons:
//           ☰  -> popover: View · Edit (+ Edit Allocation for ADMIN on PARTIAL orders only)
//           🗑  delete
//
//   - end_user : My Orders / Customer Orders are separate sidebar links
//       (?tab=customer). They use the SAME status dropdown as Admin (All Status,
//       Pending Allocation ... Reject), but only over the end user's own orders.
//       Actions stay as the 3 buttons (view / edit / delete).
//
// Allocation stage of an order (admin / system_admin view), first match wins:
//   nothing allocated (or allocation rejected) -> Pending Allocation
//   allocated < ordered                        -> Partial Allocation
//   ERP SO created                             -> ERP Transfer
//   System Admin approved                      -> Approved
//   otherwise (submitted, awaiting approval)   -> Fully Allocated
//
// ── CHANGES IN THIS VERSION ──
// 1. The summary cards now carry an icon + coloured top border, like the dashboard.
// 2. "All Sub Types" always lists Blouse, Dhoti, Uniform Shirting and Uniform Suiting
//    (cloth), even when no order exists yet for a sub type.
import { useTheme } from "../../ThemeContext";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { Menu, Trash2, Eye, Pencil, ClipboardCheck, Package, Hourglass, PackageCheck, CheckCircle2 } from "lucide-react";
import Layout from "../../components/AppLayout";
import { getG, statusColor } from "../../theme";
import API from "../../services/api";
import ExcelToolbar from "../../components/ExcelToolbar";
import { SALE_LOSS_PATH, REJECT_PATH, isSaleLossStatus, isRejectedStatus } from "../../utils/orderStatus";

const FONT = "'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// Route of Batches.jsx (Marketing Review). Change if your router uses a different path.
const BATCHES_PATH = "/master/batches";
const PARTIAL_WINDOW_HOURS = 48;
// Only ADMIN gets "Edit Allocation" — and only on PARTIAL allocation orders.
const ALLOCATE_ROLES = ["admin"];

// Excel export/import columns — same order as the on-screen table
// (minus S.No/Actions, which aren't meaningful in a spreadsheet).
const ORDER_EXCEL_COLUMNS = [
  { key: "id", header: "Order No" },
  { key: "date", header: "Date" },
  { key: "customer", header: "Customer Name" },
  { key: "subType", header: "Sub Type" },
  { key: "productName", header: "Product Name" },
  { key: "qty", header: "Qty" },
  { key: "followPerson", header: "Following Person" },
  { key: "deliveryDate", header: "Expected Delivery Date" },
  { key: "status", header: "Status" },
];
// Admin / System Admin export the allocation stage instead of the raw order status.
const ORDER_EXCEL_COLUMNS_ADMIN = ORDER_EXCEL_COLUMNS.map((c) =>
  c.key === "status" ? { key: "stageLabel", header: "Allocation Status" } : c
);

// Admin / System Admin allocation-stage dropdown (real filters).
const STAGE_META = {
  pending_allocation: { label: "Pending Allocation", color: "#D69426" },
  partial_allocation: { label: "Partial Allocation", color: "#C2571A" },
  fully_allocated: { label: "Fully Allocated", color: "#2E6B9E" },
  approved: { label: "Approved", color: "#1C7A4B" },
  erp_transfer: { label: "ERP Transfer", color: "#5B4B8C" },
};
const STAGE_OPTIONS = Object.entries(STAGE_META).map(([value, m]) => ({ value, label: m.label }));

// Dropdown entries that open another page instead of filtering.
const NAV_OPTION_SALE_LOSS = "__sale_loss__";
const NAV_OPTION_REJECT = "__reject__";

/** Map UI filter label → backend status string(s) to match (end-user pills). */
function statusMatchesFilter(orderStatus, filterStatus) {
  if (filterStatus === "All") return true;
  const s = (orderStatus || "").toLowerCase();
  const f = filterStatus.toLowerCase();
  if (f === "rejected" || f === "declined") return s === "declined" || s === "rejected";
  return s === f;
}

/** Display label for a raw status (end-user prefers Rejected over Declined). */
function displayStatus(status, preferRejected) {
  const s = (status || "").toLowerCase();
  if (preferRejected && (s === "declined" || s === "rejected")) return "rejected";
  return status || "";
}

// Label-only override used across the app — "Meter" is stored as before,
// only shown as "Mtr" (and Box as "Cases").
const UOM_LABEL_OVERRIDES = { Meter: "Mtr", Box: "Cases" };
function uomLabel(value) {
  return UOM_LABEL_OVERRIDES[value] || value;
}

const hoursSince = (iso) => {
  if (!iso) return null;
  const t = new Date(String(iso).replace(" ", "T")).getTime();
  return isNaN(t) ? null : (Date.now() - t) / 36e5;
};

const categoryColors = {
  yarn: { bg: "rgba(247,232,203,0.22)", dot: "#D69426", border: "rgba(214,148,38,0.22)" },
  cloth: { bg: "rgba(216,230,243,0.22)", dot: "#5B9BD9", border: "rgba(91,155,217,0.20)" },
};

const Badge = ({ text, colorFn }) => {
  const s = colorFn(text);
  return (
    <span style={{ ...s, padding: "3px 11px", borderRadius: 20, fontSize: 12, fontWeight: 600, border: `1px solid ${s.border}`, fontFamily: FONT }}>
      {text.charAt(0).toUpperCase() + text.slice(1)}
    </span>
  );
};

const StageBadge = ({ stage }) => {
  const m = STAGE_META[stage] || STAGE_META.pending_allocation;
  return (
    <span style={{ background: `${m.color}18`, color: m.color, border: `1px solid ${m.color}40`, padding: "3px 11px", borderRadius: 20, fontSize: 12, fontWeight: 600, fontFamily: FONT, whiteSpace: "nowrap" }}>
      {m.label}
    </span>
  );
};

const btnStyle = (color) => ({ padding: "5px 13px", borderRadius: 7, border: `1px solid ${color}40`, background: `${color}14`, color, cursor: "pointer", fontSize: 12, fontFamily: FONT, fontWeight: 600, whiteSpace: "nowrap" });
const iconBtnStyle = (color) => ({ ...btnStyle(color), display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "6px 11px" });

/* ─────────── Popover card opened by the 3-line icon (Instagram-style) ─────────── */
function ActionMenu({ themeG, title, items }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  const MENU_W = 190;

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const menuH = 34 + items.length * 44 + 10;
      const below = window.innerHeight - r.bottom;
      const top = below < menuH + 12 ? Math.max(8, r.top - menuH - 6) : r.bottom + 6;
      setPos({ top, left: Math.max(8, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8)) });
    }
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (menuRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    const close = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <>
      <button ref={btnRef} type="button" aria-label="Order actions" aria-haspopup="menu" aria-expanded={open}
        style={iconBtnStyle(themeG.accent)} onClick={toggle}>
        <Menu size={15} />
      </button>
      {open && createPortal(
        <div ref={menuRef} role="menu"
          style={{
            position: "fixed", top: pos.top, left: pos.left, width: MENU_W, zIndex: 2000,
            background: themeG.card, border: `1px solid ${themeG.border}`, borderRadius: 14,
            boxShadow: "0 12px 32px rgba(15,33,56,0.22)", padding: 6, fontFamily: FONT,
          }}>
          <div style={{ padding: "8px 12px 6px", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: themeG.textLabel, borderBottom: `1px solid ${themeG.border}`, marginBottom: 4 }}>
            {title}
          </div>
          {items.map((it) => {
            const Icon = it.icon;
            return (
              <button key={it.key} type="button" role="menuitem" disabled={it.disabled}
                onClick={() => { setOpen(false); it.onClick(); }}
                style={{
                  display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
                  padding: "9px 12px", borderRadius: 9, border: "none", background: "transparent",
                  color: it.disabled ? themeG.textSub : themeG.textMain, opacity: it.disabled ? 0.55 : 1,
                  cursor: it.disabled ? "not-allowed" : "pointer", fontFamily: FONT, fontSize: 13.5, fontWeight: 600,
                }}
                onMouseEnter={(e) => { if (!it.disabled) e.currentTarget.style.background = "rgba(91,155,217,0.12)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                <Icon size={16} color={it.color || themeG.accent} />
                <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
                  {it.label}
                  {it.hint && <span style={{ fontSize: 11, fontWeight: 500, color: themeG.textSub }}>{it.hint}</span>}
                </span>
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
}

export default function OrderList() {
  const { isDark } = useTheme();
  const themeG = getG(isDark);
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const role = localStorage.getItem("role") || "";
  const isEndUser = role === "end_user";
  const notice = location.state?.notice || "";

  const noticeBox = notice && (
    <div style={{ marginBottom: 16, background: "rgba(15,33,56,0.08)", border: "1px solid rgba(15,33,56,0.25)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: themeG.accent, fontFamily: FONT }}>
      {notice}
    </div>
  );

  // ── end_user: no in-page toggle ──
  // My Orders      -> /master/orders            (placed by this FO)
  // Customer Orders -> /master/orders?tab=customer (placed by their customers)
  if (isEndUser) {
    const placementFilter = searchParams.get("tab") === "customer" ? "customer" : "mine";
    const pageTitle = placementFilter === "customer" ? "Customer Orders" : "My Orders";

    return (
      <Layout pageTitle={pageTitle}>
        {noticeBox}
        <OrderListTab
          themeG={themeG}
          navigate={navigate}
          placementFilter={placementFilter}
          preferRejectedLabel
        />
      </Layout>
    );
  }

  // ── admin / system_admin: a single "Order List" page ──
  return (
    <Layout pageTitle="Order List">
      {noticeBox}
      {/* <h2 style={{ margin: "0 0 18px", fontFamily: FONT, fontSize: 20, fontWeight: 700, color: themeG.textMain }}>
        Order List
      </h2> */}
      <OrderListTab themeG={themeG} navigate={navigate} placementFilter="all" adminMode />
    </Layout>
  );
}

/* ────────────────────────── Order List / My Orders / Customer Orders ──────────────────────────── */

const CUSTOMER_ROLE_VALUES = new Set(["customer", "cust", "client"]);

// Sub types that must always be selectable in the "All Sub Types" dropdown (cloth),
// even before any order exists for them. Anything else found in the data is added too.
const SUBTYPE_FALLBACK_CLOTH = ["Blouse", "Dhoti", "Uniform Shirting", "Uniform Suiting"];

const detectPlacement = (o, currentUserId) => {
  const rawRole = o.creator?.role;
  if (rawRole !== undefined && rawRole !== null && String(rawRole).trim() !== "") {
    const normalizedRole = String(rawRole).trim().toLowerCase();
    return CUSTOMER_ROLE_VALUES.has(normalizedRole) ? "customer" : "mine";
  }
  if ((currentUserId === undefined || currentUserId === null || currentUserId === "") && (o.CreatedBy !== undefined && o.CreatedBy !== null)) {
    return "unknown";
  }
  if (o.CreatedBy !== undefined && o.CreatedBy !== null) {
    return String(o.CreatedBy) === String(currentUserId) ? "mine" : "customer";
  }
  return "unknown";
};

/**
 * Allocation stage for one order (or a cart group of several order lines).
 * `members` are the mapped orders; each carries `alloc` = the matching
 * /allocations/board entry (or null when nothing is allocated yet).
 */
function computeStage(members) {
  const mtrNum = (v) => {
    const n = parseFloat(String(v ?? "").replace(/[^\d.]/g, ""));
    return !isNaN(n) && n > 0 ? n : 0;
  };

  let ordered = 0, allocated = 0, allApproved = true, allErp = true, earliest = null;
  let mtrTotal = 0, singleMeters = "";

  members.forEach((m) => {
    const a = m.alloc;
    ordered += a ? (parseFloat(a.orderedQty) || 0) : (parseFloat(m.qty) || 0);

    // A rejected allocation goes back to Admin, so it counts as NOT allocated.
    const usable = a && a.status !== "rejected";
    const saved = usable ? (parseFloat(a.allocatedQty) || 0) : 0;
    allocated += saved;

    if (saved > 0) {
      mtrTotal += saved * mtrNum(a.meters);
      if (members.length === 1) singleMeters = a.meters || "";
    }

    if (!(usable && saved > 0 && a.status === "approved")) allApproved = false;
    if (!(usable && saved > 0 && a.erpStatus === "erp_so_created")) allErp = false;
    if (saved > 0 && a.firstAllocatedAt && (!earliest || a.firstAllocatedAt < earliest)) earliest = a.firstAllocatedAt;
  });

  const partial = allocated > 0 && allocated < ordered;
  const age = earliest ? hoursSince(earliest) : null;
  const expired = partial && age !== null && age >= PARTIAL_WINDOW_HOURS;

  // Nothing allocated -> Pending Allocation ONLY.
  // Something allocated but not everything -> Partial Allocation.
  let stage;
  if (allocated <= 0) stage = "pending_allocation";
  else if (partial) stage = "partial_allocation";
  else if (allErp) stage = "erp_transfer";
  else if (allApproved) stage = "approved";
  else stage = "fully_allocated";

  return {
    stage,
    stageLabel: STAGE_META[stage]?.label || stage,
    partial,
    expired,
    balance: Math.max(0, ordered - allocated),
    // Shown in the table only once something is really allocated
    hasAllocation: allocated > 0,
    allocatedQtyTotal: allocated,
    allocatedMtrText: allocated > 0
      ? (members.length === 1 ? singleMeters : (mtrTotal > 0 ? `${Math.round(mtrTotal * 100) / 100}` : ""))
      : "",
  };
}

// placementFilter: "all" | "mine" | "customer"
// (end users use the same stage dropdown as admins)
// adminMode: admin / system_admin layout (stage dropdown + popover actions)
function OrderListTab({
  themeG,
  navigate,
  placementFilter = "all",
  preferRejectedLabel = false,
  adminMode = false,
}) {
  const tab = localStorage.getItem("premier_category") || "cloth";
  const role = localStorage.getItem("role") || "";
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const currentUserId = user.Id ?? user.id ?? user.ID ?? user.userId ?? null;
  const isEndUser = role === "end_user";
  const canAllocate = ALLOCATE_ROLES.includes(role);
  // Admin / System Admin AND End User all get the allocation-stage dropdown.
  // (adminMode still controls the admin-only action menu and board data.)
  const stageMode = adminMode || role === "end_user";

  const [filterStatus, setFilterStatus] = useState("All");
  const [uomFilter, setUomFilter] = useState("All");
  const [subTypeFilter, setSubTypeFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [followPeople, setFollowPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState(null);

  const load = async () => {
    try {
      const params = {};
      if (role === "end_user") { params.scope = "own"; params.with_allocation = 1; }
      else if (role === "admin") params.scope = "own_and_team";

      const [ordRes, custRes, prodRes, usersRes, boardRes] = await Promise.all([
        API.get("/orders", { params }),
        API.get("/customers"),
        API.get("/products"),
        API.get("/users", { params: { roles: "admin,system_admin,end_user" } }).catch(() => ({ data: [] })),
        // Real allocation / approval / ERP data, same source as Marketing Review.
        adminMode
          ? API.get("/allocations/board").catch(() => ({ data: { products: [] } }))
          : Promise.resolve(null),
      ]);
      const people = usersRes.data || [];
      setFollowPeople(people);

      // orderId -> allocation entry from the board
      const allocByOrderId = {};
      (boardRes?.data?.products || []).forEach((p) => {
        (p.customers || []).forEach((c) => { if (c.orderId) allocByOrderId[c.orderId] = c; });
      });

      // Keyed by customer id so each order can look up its own customer's
      // registered Contact Person.
      const customersById = {};
      (custRes.data || []).forEach((c) => { customersById[c.Id] = c; });

      const productsById = {};
      (prodRes.data || []).forEach((p) => { productsById[p.Id] = p; });

      const mapped = ordRes.data.map((o) => {
        const assignedName =
          o.assignee?.Name ||
          o.assignee?.name ||
          people.find((p) => String(p.Id ?? p.id) === String(o.AssignedTo))?.Name ||
          people.find((p) => String(p.Id ?? p.id) === String(o.AssignedTo))?.name ||
          (o.AssignedTo ? `User #${o.AssignedTo}` : null);

        // No staff member has claimed this order yet — fall back to the
        // customer's own registered Contact Person.
        const customer = o.customer || customersById[o.CustomerId];
        const contactPersonName = customer?.ContactPersons?.[0]?.contactName || null;

        const followName = assignedName || contactPersonName || "—";

        const productName = o.product?.Name || productsById[o.ProductId]?.Name || "—";

        // UOM the customer/officer actually picked at checkout, falling back
        // to the product's master UOM for older orders.
        const uom = o.OrderDetails?.UOM || o.OrderDetails?.uom || o.product?.UOM || productsById[o.ProductId]?.UOM || "—";

        const custObj = o.customer || customersById[o.CustomerId];
        return {
          id: o.Code,
          dbId: o.Id,
          customerId: o.CustomerId,
          customer: custObj?.Name ?? "—",
          customerDistrict: custObj?.District || null,
          customerState: custObj?.State || null,
          followPerson: followName,
          category: o.Category,
          subType: o.SubType || "—",
          uom,
          productName,
          qty: o.Quantity,
          date: o.CreatedAt ? o.CreatedAt.substring(0, 10) : "",
          status: o.Status,
          deliveryDate: o.DeliveryDate ? o.DeliveryDate.substring(0, 10) : null,
          groupRef: o.OrderDetails?.GroupRef ?? o.OrderDetails?.CartRef ?? null,
          placement: detectPlacement(o, currentUserId),
          // Admin: real board entry. End User: the per-order summary the
          // orders API sends back (they can't read the staff-only board).
          alloc: adminMode
            ? (allocByOrderId[o.Id] || null)
            : (o.AllocationSummary ? { ...o.AllocationSummary, orderedQty: o.Quantity } : null),
        };
      });
      setOrders(mapped);
      setCustomers(custRes.data);
      setProducts(prodRes.data);
    } catch (err) {
      setError("Failed to load orders.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  // Reset filters when switching My Orders ↔ Customer Orders
  useEffect(() => {
    setFilterStatus("All");
    setUomFilter("All");
    setSubTypeFilter("All");
  }, [placementFilter]);

  const UOM_FILTER_FALLBACK = ["Box", "Pieces", "Meter"];
  const uomOptions = Array.from(
    new Set([...orders.map((o) => o.uom).filter((u) => u && u !== "—"), ...UOM_FILTER_FALLBACK])
  ).sort();

  // Sub types found in the orders + (for cloth) the fixed four, so Uniform
  // Shirting / Uniform Suiting are always selectable.
  const subTypeOptions = Array.from(
    new Set([
      ...orders.map((o) => o.subType).filter((s) => s && s !== "—"),
      ...(tab === "cloth" ? SUBTYPE_FALLBACK_CLOTH : []),
    ])
  ).sort();

  const groupOrders = (list) => {
    const groups = new Map();
    const singles = [];
    list.forEach((o) => {
      if (!o.groupRef) { singles.push(o); return; }
      if (!groups.has(o.groupRef)) groups.set(o.groupRef, []);
      groups.get(o.groupRef).push(o);
    });
    const singleRows = singles.map((o) => (stageMode ? { ...o, ...computeStage([o]) } : o));
    const groupRows = [...groups.values()].map((members) => {
      const first = members[0];
      return {
        ...first,
        isGroup: true,
        memberIds: members.map((m) => m.dbId),
        members,
        qty: members.reduce((s, m) => s + (parseFloat(m.qty) || 0), 0),
        ...(stageMode ? computeStage(members) : {}),
      };
    });
    return [...singleRows, ...groupRows].sort((a, b) => b.dbId - a.dbId);
  };

  // Sale Loss / Rejected lines live on their own pages. Drop them BEFORE
  // grouping, so the other products of the same enquiry (e.g. 2 of ORD-1015's
  // 3 products) stay in this list instead of vanishing with the closed one.
  const openOrders = stageMode
    ? orders.filter((o) => !(isSaleLossStatus(o.status) || isRejectedStatus(o.status)))
    : orders;
  const displayOrders = groupOrders(openOrders);

  const placementFieldAvailable = orders.some((o) => o.placement !== "unknown");

  const filtered = displayOrders.filter((o) => {
    const matchTab = o.category === tab;
    // Sale Loss / Rejected orders live on their own pages — keep them out of
    // the admin / system_admin Order List.
    const matchOpen = !stageMode || !(isSaleLossStatus(o.status) || isRejectedStatus(o.status));
    const matchStatus = stageMode
      ? (filterStatus === "All" || o.stage === filterStatus)
      : statusMatchesFilter(o.status, filterStatus);
    const matchUom = uomFilter === "All" || o.uom === uomFilter;
    const matchSubType = subTypeFilter === "All" || o.subType === subTypeFilter;
    const matchSearch = o.id.toLowerCase().includes(search.toLowerCase())
      || o.customer.toLowerCase().includes(search.toLowerCase())
      || o.followPerson.toLowerCase().includes(search.toLowerCase())
      || (o.productName || "").toLowerCase().includes(search.toLowerCase());
    const matchPlacement =
      placementFilter === "all" ? true :
        !placementFieldAvailable ? false :
          placementFilter === "mine" ? o.placement === "mine" :
            placementFilter === "customer" ? (
              o.placement === "customer" &&
              (() => {
                // End-user Customer Orders: match the customer's district and state
                // to the end-user's own district(s) / state(s) so they see local customers (e.g. Chennai).
                if (!isEndUser) return true;

                const rawDist = user.district || user.District
                  || (() => { try { return JSON.parse(localStorage.getItem("District") || "null"); } catch { return null; } })();
                const rawState = user.state || user.State
                  || (() => { try { return JSON.parse(localStorage.getItem("State") || "null"); } catch { return null; } })();

                let endUserDists = [];
                try { endUserDists = Array.isArray(rawDist) ? rawDist : (rawDist ? JSON.parse(rawDist) : []); }
                catch { endUserDists = typeof rawDist === "string" ? [rawDist] : []; }
                if (typeof rawDist === "string" && !endUserDists.length && rawDist.trim()) endUserDists = [rawDist.trim()];

                let endUserStates = [];
                try { endUserStates = Array.isArray(rawState) ? rawState : (rawState ? JSON.parse(rawState) : []); }
                catch { endUserStates = typeof rawState === "string" ? [rawState] : []; }
                if (typeof rawState === "string" && !endUserStates.length && rawState.trim()) endUserStates = [rawState.trim()];

                // If end user has no assigned district or state, show all
                if (!endUserDists.length && !endUserStates.length) return true;

                const custRecord = customers.find((c) => c.Id === o.customerId) ||
                  customers.find((c) => c.Name === o.customer);
                const custDist = String(o.customerDistrict || custRecord?.District || "").toLowerCase().trim();
                const custState = String(o.customerState || custRecord?.State || "").toLowerCase().trim();

                const distMatch = endUserDists.some((d) => {
                  const s = String(d).toLowerCase().trim();
                  return s && (s === custDist || s === custState);
                });

                const stateMatch = endUserStates.some((st) => {
                  const s = String(st).toLowerCase().trim();
                  return s && (s === custState || s === custDist);
                });

                return distMatch || stateMatch;
              })()
            ) :
              true;
    return matchTab && matchOpen && matchStatus && matchUom && matchSubType && matchSearch && matchPlacement;
  });

  const handleDelete = async (o) => {
    const ids = o.isGroup ? o.memberIds : [o.dbId];
    const label = o.isGroup ? `order ${o.id} (${ids.length} products)` : `order ${o.id}`;
    if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;
    setDeletingId(o.dbId);
    setError("");
    try {
      await Promise.all(ids.map((id) => API.delete(`/orders/${id}`)));
      setOrders((list) => list.filter((x) => !ids.includes(x.dbId)));
    } catch (err) {
      setError(err.response?.data?.message || "Failed to delete order.");
    } finally {
      setDeletingId(null);
    }
  };

  // Open Marketing Review on this order's allocation line.
  const goAllocate = (o) => {
    const ids = o.isGroup ? o.memberIds : [o.dbId];
    navigate(`${BATCHES_PATH}?enquiry=${encodeURIComponent(o.id)}&focus=${ids.join(",")}`);
  };

  // Status dropdown: Sale Loss / Reject open their own pages;
  // everything else just filters the table.
  const handleStatusChange = (value) => {
    if (value === NAV_OPTION_SALE_LOSS) {
      navigate(SALE_LOSS_PATH);
      return;
    }
    if (value === NAV_OPTION_REJECT) {
      navigate(REJECT_PATH);
      return;
    }
    setFilterStatus(value);
  };

  const handleImportRows = async (rows) => {
    let created = 0, failed = 0, duplicates = 0;
    const existingCodes = new Set(orders.map((o) => o.id));

    for (const row of rows) {
      const customer = customers.find((c) => c.Name === row.customer || c.Code === row.customer);
      if (!customer || !row.qty) { failed++; continue; }

      if (row.id && existingCodes.has(String(row.id).trim())) { duplicates++; continue; }

      try {
        await API.post("/orders", {
          customerId: customer.Id,
          qty: parseInt(row.qty, 10) || 1,
          deliveryDate: row.deliveryDate || null,
        });
        created++;
      } catch {
        failed++;
      }
    }
    await load();
    return { created, failed, duplicates };
  };

  if (loading) return <p style={{ color: themeG.textSub, fontFamily: FONT }}>Loading orders…</p>;

  const excelFilenameSuffix =
    placementFilter === "mine" ? "-mine" :
      placementFilter === "customer" ? "-customer" : "";

  const selectStyle = { padding: "8px 13px", borderRadius: 9, border: `1px solid ${themeG.border}`, fontSize: 12.5, fontFamily: FONT, background: themeG.card, color: themeG.textMain, outline: "none" };

  // Summary cards — icon + coloured top border, same look as the dashboard cards.
  const statCards = preferRejectedLabel
    ? [
      { label: "Total Orders", value: filtered.length, color: themeG.accent, icon: Package },
      { label: "Pending Allocation", value: filtered.filter((o) => o.stage === "pending_allocation").length, color: STAGE_META.pending_allocation.color, icon: Hourglass },
      { label: "Partial Allocation", value: filtered.filter((o) => o.stage === "partial_allocation").length, color: STAGE_META.partial_allocation.color, icon: ClipboardCheck },
      { label: "Approved", value: filtered.filter((o) => o.stage === "approved" || o.stage === "erp_transfer").length, color: STAGE_META.approved.color, icon: CheckCircle2 },
    ]
    : [
      { label: "Total Orders", value: filtered.length, color: themeG.accent, icon: Package },
      { label: "Pending", value: filtered.filter((o) => o.status === "pending").length, color: "#D69426", icon: Hourglass },
      { label: "Delivered", value: filtered.filter((o) => o.status === "delivered").length, color: "#1F5C99", icon: PackageCheck },
    ];

  return (
    <>
      {error && (
        <div style={{ marginBottom: 16, background: "rgba(178,58,58,0.08)", border: "1px solid rgba(178,58,58,0.25)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#B23A3A", fontFamily: FONT }}>
          {error}
        </div>
      )}

      {placementFilter !== "all" && !placementFieldAvailable && (
        <div style={{ marginBottom: 16, background: "rgba(214,148,38,0.10)", border: "1px solid rgba(214,148,38,0.28)", borderRadius: 10, padding: "10px 14px", fontSize: 12.5, color: "#8A5A0E", fontFamily: FONT }}>
          {placementFilter === "mine"
            ? "\"My Orders\" can't be separated from customer-placed orders yet."
            : "\"Customer Orders\" can't be separated from officer-placed orders yet."}
          {" "}The order-creator info isn't included in this API response yet — ask a developer to add "creator" to the eager load on GET /orders (it's already stored, just not returned).
        </div>
      )}

      <div style={{ display: "flex", gap: 12, marginBottom: 18, flexWrap: "wrap", alignItems: "center" }}>
        <input
          placeholder="Search order, customer, product, follow person…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: "9px 14px", borderRadius: 9, border: `1px solid ${themeG.border}`, fontSize: 13, width: 260, fontFamily: FONT, background: themeG.card, outline: "none", color: themeG.textMain }}
        />

        <select value={filterStatus} onChange={(e) => handleStatusChange(e.target.value)} style={{ ...selectStyle, minWidth: 170 }}>
          <option value="All">All Status</option>
          {STAGE_OPTIONS.map((st) => (
            <option key={st.value} value={st.value}>{st.label}</option>
          ))}
          <option value={NAV_OPTION_SALE_LOSS}>Sale Loss</option>
          <option value={NAV_OPTION_REJECT}>Reject</option>
        </select>

        <select value={uomFilter} onChange={(e) => setUomFilter(e.target.value)} style={selectStyle}>
          <option value="All">All UOM</option>
          {uomOptions.map((u) => (
            <option key={u} value={u}>{uomLabel(u)}</option>
          ))}
        </select>

        <select value={subTypeFilter} onChange={(e) => setSubTypeFilter(e.target.value)} style={selectStyle}>
          <option value="All">All Sub Types</option>
          {subTypeOptions.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "flex-start" }}>
          <ExcelToolbar
            themeG={themeG}
            rows={filtered}
            columns={stageMode ? ORDER_EXCEL_COLUMNS_ADMIN : ORDER_EXCEL_COLUMNS}
            filename={`orders-${tab}${excelFilenameSuffix}`}
            onImportRows={handleImportRows}
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, marginBottom: 18 }}>
        {statCards.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} style={{ background: themeG.card, border: `1px solid ${themeG.border}`, borderTop: `3px solid ${s.color}`, borderRadius: 10, padding: "12px 20px", boxShadow: "0 2px 8px rgba(46,122,114,0.05)", flex: 1 }}>
              <Icon size={18} color={s.color} style={{ display: "block", marginBottom: 8 }} />
              <p style={{ margin: "0 0 4px", fontSize: 11, color: themeG.textLabel, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: FONT }}>{s.label}</p>
              <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: s.color, fontFamily: "'Space Grotesk', " + FONT }}>{s.value}</p>
            </div>
          );
        })}
      </div>

      <div style={{ background: "#FFFFFF", border: "1px solid rgba(91,155,217,0.35)", borderRadius: 14, overflow: "hidden", boxShadow: "0 4px 16px rgba(46,122,114,0.06)" }}>
        {/* Inline scroll — caps the body at roughly 10 rows before it
            scrolls internally, header stays pinned via position: sticky. */}
        <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: 520 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1180 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${themeG.border}` }}>
                {["S.No", "Enquiry No", "Date", "Customer Name", "Sub Type", "UOM", "Qty", "Allocated Qty", "Allocated Mtr", "Following Person", "Delivery Date", "Status", "Actions"].map((h) => (
                  <th key={h} style={{ textAlign: "center", fontSize: 11, padding: "10px 13px", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600, color: "#FFFFFF", background: "#1F3A63", fontFamily: FONT, whiteSpace: "nowrap", position: "sticky", top: 0, zIndex: 1 }}>
                    {h === "Status" && stageMode ? "Allocation Status" : h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={13} style={{ textAlign: "center", padding: 40, color: themeG.textSub, fontSize: 14, fontFamily: FONT }}>
                    {placementFilter === "customer"
                      ? "No customer-placed enquiries yet. Orders you submit for a customer appear under My Orders."
                      : placementFilter === "mine"
                        ? "No orders placed by you yet."
                        : "No orders found."}
                  </td>
                </tr>
              ) : filtered.map((o, idx) => {
                const cc = categoryColors[o.category] || categoryColors.cloth;
                const statusLabel = displayStatus(o.status, preferRejectedLabel);

                const menuItems = [
                  { key: "view", label: "View", icon: Eye, onClick: () => navigate(`/master/orders/add?editId=${o.dbId}&mode=view`) },
                  { key: "edit", label: "Edit", icon: Pencil, onClick: () => navigate(`/master/orders/add?editId=${o.dbId}`) },
                  // ADMIN only, and only on PARTIAL allocation orders — jumps to the balance line.
                  ...(canAllocate && o.stage === "partial_allocation"
                    ? [{
                      key: "alloc", label: "Edit Allocation", icon: ClipboardCheck, color: "#C2571A",
                      hint: `Balance: ${o.balance}`,
                      onClick: () => goAllocate(o),
                    }]
                    : []),
                ];

                return (
                  <tr key={o.id} style={{ borderBottom: "1px solid rgba(46,122,114,0.06)", background: "#FFFFFF" }}>
                    <td style={{ padding: "12px 13px", fontSize: 13, color: themeG.textSub, fontFamily: FONT, borderLeft: `3px solid ${cc.dot}`, textAlign: "center" }}>{idx + 1}</td>
                    <td style={{ padding: "12px 13px", fontSize: 13, color: themeG.accent, fontWeight: 700, fontFamily: FONT, whiteSpace: "nowrap", textAlign: "center" }}>
                      {o.id}
                      {o.isGroup && (
                        <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: cc.dot, background: cc.border, border: `1px solid ${cc.border}`, padding: "1px 8px", borderRadius: 20 }}>
                          {o.memberIds.length} products
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "12px 13px", fontSize: 12, color: themeG.textSub, fontFamily: FONT, whiteSpace: "nowrap", textAlign: "center" }}>{o.date}</td>
                    <td style={{ padding: "12px 13px", fontSize: 14, color: themeG.textMain, fontWeight: 500, fontFamily: FONT, textAlign: "center" }}>{o.customer}</td>
                    <td style={{ padding: "12px 13px", fontSize: 13, color: themeG.textMain, fontFamily: FONT, textAlign: "center" }}>{o.subType}</td>
                    <td style={{ padding: "12px 13px", fontSize: 13, color: themeG.textMain, fontFamily: FONT, textAlign: "center" }}>{uomLabel(o.uom)}</td>
                    <td style={{ padding: "12px 13px", fontSize: 13, color: themeG.textMain, fontFamily: FONT, textAlign: "center" }}>{o.qty}</td>
                    <td style={{ padding: "12px 13px", fontSize: 13, color: themeG.textMain, fontFamily: FONT, textAlign: "center" }}>
                      {o.hasAllocation ? o.allocatedQtyTotal : "—"}
                    </td>
                    <td style={{ padding: "12px 13px", fontSize: 13, color: themeG.textMain, fontFamily: FONT, textAlign: "center" }}>
                      {o.hasAllocation && o.allocatedMtrText ? o.allocatedMtrText : "—"}
                    </td>
                    <td style={{ padding: "12px 13px", fontSize: 13, color: themeG.textSub, fontFamily: FONT, textAlign: "center" }}>{o.followPerson}</td>
                    <td style={{ padding: "12px 13px", fontSize: 12, fontFamily: FONT, whiteSpace: "nowrap", textAlign: "center" }}>
                      {o.deliveryDate || "—"}
                    </td>
                    <td style={{ padding: "12px 13px", textAlign: "center" }}>
                      {stageMode ? <StageBadge stage={o.stage} /> : <Badge text={statusLabel} colorFn={statusColor} />}
                    </td>
                    <td style={{ padding: "12px 13px", whiteSpace: "nowrap", textAlign: "center" }}>
                      {adminMode ? (
                        <div style={{ display: "flex", gap: 7, justifyContent: "center" }}>
                          <ActionMenu themeG={themeG} title={o.id} items={menuItems} />
                          <button type="button" aria-label="Delete order" style={iconBtnStyle("#B23A3A")} disabled={deletingId === o.dbId} onClick={() => handleDelete(o)}>
                            {deletingId === o.dbId ? "…" : <Trash2 size={15} />}
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: "flex", gap: 7, justifyContent: "center" }}>
                          <button style={btnStyle("#5B9BD9")} onClick={() => navigate(`/master/orders/add?editId=${o.dbId}&mode=view`)}>👁️</button>
                          <button style={btnStyle(themeG.accent)} onClick={() => navigate(`/master/orders/add?editId=${o.dbId}`)}>✏️</button>
                          <button style={btnStyle("#B23A3A")} disabled={deletingId === o.dbId} onClick={() => handleDelete(o)}>
                            {deletingId === o.dbId ? "…" : "🗑️"}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ padding: "10px 13px", borderTop: `1px solid ${themeG.border}`, fontSize: 12, color: themeG.textSub, fontFamily: FONT }}>
          Showing {filtered.length} of {orders.filter((o) => o.category === tab).length} {tab} orders
        </div>
      </div>
    </>
  );
}