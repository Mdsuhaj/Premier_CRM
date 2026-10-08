// src/pages/master/SalesOrder.jsx
//
// Order Details — now the "Today's Orders" page.
//
// Every view on this page (Today's Inquiries / Pending Allocation / Full
// Allocation / Awaiting Approval / All Allocation for Admin & Super Admin;
// Approved Orders Today / ERP Transfer Pending / ERP SO Created / Edit
// Allocation for System Admin) shows ONLY orders placed TODAY. The full,
// all-time list lives on the Order List page (/master/orders).
//
// Expired Partials: the old standalone /master/partial-expired page is gone.
// Its content is the "Expired Partials" tab inside the Pending Allocation
// view — partial orders still short of their requested qty 48 hours after
// their first allocation. These are, by definition, older than today, so
// that tab is NOT limited to today's orders.
//
// Embedded mode: OrderList.jsx renders this component with `embedded` /
// `forcedView`. In that mode nothing changes — no today-only filter, the
// old date picker is kept, and the heading stays "Order details".
//
// Read-only page except System Admin's Edit Allocation view and the Reject /
// Sale Loss buttons of the Pending Final Approval view (used when embedded).
//
// Product Code: shows Oracle's real ORDERITEMCODE (same as Marketing Review).
// /allocations/list only returns the internal code, so a lookup is built from
// /allocations/board. If AllocationController@list ever returns
// `orderItemCode` on each row, that value is used first.
//
// Needs the updated AllocationController@list (order_date, include_untouched
// params; inquiryDate + firstAllocatedAt in the response). Without it the
// page still loads, but the "today" filter falls back to the old behaviour.
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Search, Shirt, Layers, Briefcase, Ruler, LayoutGrid, Pencil } from "lucide-react";
import Layout from "../../components/AppLayout";
import { useTheme } from "../../ThemeContext";
import { getG } from "../../theme";
import API from "../../services/api";

const FONT = "'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const PARTIAL_WINDOW_HOURS = 48;

// System Admin's drill-downs.
const SYSADMIN_VIEWS = [
  // Pending Final Approval and Rejected Orders live HERE (Order Details),
  // not on the Order List page.
  { id: "pending_final_approval", label: "Pending Final Approval" },
  { id: "approved_today", label: "Approved Orders Today" },
  { id: "erp_transfer_pending", label: "ERP Transfer Pending" },
  { id: "erp_so_created", label: "ERP SO Created" },
  { id: "rejected_orders", label: "Rejected Orders" },
  { id: "edit_allocation", label: "Edit Allocation" },
];

// Views that are NOT limited to today's orders. Empty = every view on the
// Today's Orders page shows today's orders only. If System Admin should also
// see OLDER orders still waiting for approval, put "pending_final_approval"
// (and/or "rejected_orders") in this list.
const ALL_DATE_VIEWS = [];

// Admin's drill-downs — match Admin's stat cards on Marketing Review.
const ADMIN_VIEWS = [
  { id: "today_inquiries", label: "Today's Inquiries" },
  { id: "pending_allocation", label: "Pending Allocation" },
  { id: "full_allocation", label: "Full Allocation" },
  { id: "awaiting_approval", label: "Awaiting Approval" },
  { id: "available_stock", label: "All Allocation" },
];

// Super Admin — Admin's views plus three ERP/rejection-tracking views.
const SUPERADMIN_VIEWS = [
  ...ADMIN_VIEWS,
  { id: "erp_transfer_pending", label: "ERP Transfer Pending" },
  { id: "erp_so_created", label: "ERP SO Created" },
  { id: "rejected_orders", label: "Rejected Orders" },
];

// Local calendar date (YYYY-MM-DD). toISOString() would give the UTC date,
// which is "yesterday" in India between 00:00 and 05:30.
const todayStr = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const todayLabel = () =>
  new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).replace(/ /g, "-");

const hoursSince = (iso) => {
  if (!iso) return null;
  const t = new Date(String(iso).replace(" ", "T")).getTime();
  return isNaN(t) ? null : (Date.now() - t) / 36e5;
};

// ── Type pills — same match/groupFor() convention as Batches.jsx ──
const CLOTH_GROUPS = [
  { id: "dhoti", name: "Dhoti", match: ["dhoti", "dothi", "cotton dhoti grey", "cotton dhoti fabric"], icon: Layers, color: "#1C7A4B" },
  { id: "blouse", name: "Blouse", match: ["blouse"], icon: Shirt, color: "#1E5B95" },
  { id: "uniform_shirting", name: "Uniform Shirting", match: ["uniform shirting"], icon: Briefcase, color: "#B2622E" },
  { id: "uniform_suiting", name: "Uniform Suiting", match: ["uniform suiting"], icon: Ruler, color: "#5B4B8C" },
  { id: "others", name: "Others", match: ["others"], icon: LayoutGrid, color: "#D97706" },
];

const normalize = (v) => (v ?? "").toString().trim().toLowerCase().replace(/\s+/g, " ");

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

const EmbedShell = ({ children }) => <>{children}</>;

export default function SalesOrder({ embedded = false, forcedView = null } = {}) {
  const Shell = embedded ? EmbedShell : Layout;
  const { isDark } = useTheme();
  const themeG = getG(isDark);
  const S = buildStyles(themeG);

  const role = localStorage.getItem("role") || "";
  const isSystemAdminRole = role === "system_admin";
  const isSuperAdminRole = role === "super_admin";
  const VIEWS = isSystemAdminRole ? SYSADMIN_VIEWS : isSuperAdminRole ? SUPERADMIN_VIEWS : ADMIN_VIEWS;
  const defaultViewId = VIEWS[0].id;

  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const view = forcedView
    ? forcedView
    : VIEWS.some((v) => v.id === searchParams.get("view"))
      ? searchParams.get("view")
      : defaultViewId;

  // Today-only applies to the standalone page, never to the embedded copy
  // inside Order List.
  const todayOnly = !embedded && !ALL_DATE_VIEWS.includes(view);

  const isEditAlloc = view === "edit_allocation";
  const isRejectedView = view === "rejected_orders";
  const isSysAdminStyleView = [
    "pending_final_approval", "approved_today",
    "erp_transfer_pending", "erp_so_created",
    "rejected_orders", "edit_allocation",
  ].includes(view);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [busyIds, setBusyIds] = useState(() => new Set());

  // ── Edit Allocation (System Admin only) ──
  const [editingRows, setEditingRows] = useState(() => new Set());
  const [editQtyInputs, setEditQtyInputs] = useState({});
  const [editMeterInputs, setEditMeterInputs] = useState({});
  const [savingEditId, setSavingEditId] = useState(null);

  // productCode -> SubType lookup (allocation rows don't carry a subType).
  const [subTypeByCode, setSubTypeByCode] = useState({});

  // internal product code / `id:<productId>` -> Oracle ORDERITEMCODE
  // (same source Marketing Review uses).
  const [orderItemCodeByCode, setOrderItemCodeByCode] = useState({});

  const [activeType, setActiveType] = useState("all");
  const [search, setSearch] = useState("");
  // Manual date picker — only used in embedded mode (Order List). The
  // standalone page is fixed to today.
  const [dateFilter, setDateFilter] = useState("");

  // ── Expired Partials (inside Pending Allocation) ──
  const canSeeExpired = !embedded && view === "pending_allocation";
  const showExpired = canSeeExpired && searchParams.get("expired") === "1";
  const [expiredRows, setExpiredRows] = useState([]);
  const [expiredLoading, setExpiredLoading] = useState(false);
  const setExpiredTab = (on) =>
    setSearchParams(on ? { view: "pending_allocation", expired: "1" } : { view: "pending_allocation" });

  useEffect(() => {
    (async () => {
      try {
        const res = await API.get("/products");
        const map = {};
        (res.data || []).forEach((p) => {
          if (p.Code) map[p.Code] = p.SubType;
        });
        setSubTypeByCode(map);
      } catch {
        // Non-fatal — rows just fall back to "Others".
      }
    })();
  }, []);

  // Build the real-code lookup from the allocation board.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await API.get("/allocations/board");
        const map = {};
        (res.data?.products || []).forEach((p) => {
          if (!p.orderItemCode) return;
          if (p.code) map[p.code] = p.orderItemCode;
          if (p.productId != null) map[`id:${p.productId}`] = p.orderItemCode;
        });
        if (alive) setOrderItemCodeByCode(map);
      } catch {
        // Non-fatal — falls back to the internal code.
      }
    })();
    return () => { alive = false; };
  }, []);

  const subTypeOf = (row) =>
    row.subType || row.SubType || row.category || row.Category ||
    subTypeByCode[row.productCode] || subTypeByCode[row.ProductCode] || null;

  const orderNoOf = (row) =>
    row.orderNo || row.OrderNo || row.order_no ||
    row.orderId || row.OrderId || row.orderNumber || null;

  // Real Oracle code (ORDERITEMCODE) first, internal code only as a last resort.
  const productCodeOf = (row) =>
    row.orderItemCode || row.OrderItemCode ||
    orderItemCodeByCode[row.productCode] ||
    (row.productId != null ? orderItemCodeByCode[`id:${row.productId}`] : null) ||
    row.productCode || row.ProductCode || "—";

  const uomOf = (row) => row.uom || row.UOM || row.Uom || null;
  const meterOf = (row) => row.meters || row.Meters || row.meter || row.Meter || null;
  const erpStatusOf = (row) => row.erpStatus || row.ErpStatus || row.erp_status || null;

  const load = async () => {
    setLoading(true); setError("");
    try {
      const params = {};
      const today = todayStr();
      if (view === "pending_final_approval") params.status = "pending";
      if (view === "approved_today") { params.status = "approved"; if (embedded) params.date = today; }
      if (view === "erp_transfer_pending") { params.status = "approved"; params.erp_status = "not_transferred"; }
      if (view === "erp_so_created") { params.status = "approved"; params.erp_status = "erp_so_created"; }
      if (view === "rejected_orders") params.status = "rejected";
      if (view === "today_inquiries" && embedded) params.date = today;
      if (view === "awaiting_approval") params.status = "pending";
      if (embedded && dateFilter) params.date = dateFilter;

      if (todayOnly) {
        // Only orders placed today. Views that must also list orders nobody
        // has allocated to yet ask the server to include those lines too.
        params.order_date = today;
        if (["today_inquiries", "pending_allocation", "available_stock"].includes(view)) {
          params.include_untouched = 1;
        }
      }
      const res = await API.get("/allocations/list", { params });
      setRows(res.data || []);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load this list.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [view, dateFilter]);

  // Expired partials come straight from the allocation board: partial orders
  // (some allocated, some still owed) whose first allocation is 48h+ old.
  useEffect(() => {
    if (!canSeeExpired) return;
    let alive = true;
    setExpiredLoading(true);
    (async () => {
      try {
        const res = await API.get("/allocations/board");
        const flat = [];
        (res.data?.products || []).forEach((p) =>
          (p.customers || []).forEach((c) => {
            const allocated = c.allocatedQty || 0;
            const requested = c.orderedQty || 0;
            const age = hoursSince(c.firstAllocatedAt);
            if (allocated > 0 && allocated < requested && age !== null && age >= PARTIAL_WINDOW_HOURS) {
              flat.push({
                allocationId: `${p.productId}-${c.orderId}`,
                orderNo: c.orderNo,
                customerName: c.name,
                customerCode: c.code,
                district: c.district || "",
                productCode: p.orderItemCode || p.code,
                productName: p.name,
                subType: p.subType || p.category,
                requested,
                allocated,
                remaining: requested - allocated,
                since: c.firstAllocatedAt,
                hoursOver: Math.floor(age - PARTIAL_WINDOW_HOURS),
              });
            }
          })
        );
        if (alive) setExpiredRows(flat);
      } catch (err) {
        if (alive) setError(err.response?.data?.message || "Failed to load expired partial allocations.");
      } finally {
        if (alive) setExpiredLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [canSeeExpired]);

  useEffect(() => {
    setActiveType("all");
    setSearch("");
    setDateFilter("");
    setEditingRows(new Set());
    setEditQtyInputs({});
    setEditMeterInputs({});
  }, [view]);
  const setView = (id) => setSearchParams(id === defaultViewId ? {} : { view: id });

  // Reject — PATCH /allocations/{id}/decision { status: "rejected" }.
  const handleReject = async (row) => {
    if (!row.allocationId || row.status !== "pending") return;
    setBusyIds((s) => new Set(s).add(row.allocationId));
    setError(""); setOk("");
    try {
      await API.patch(`/allocations/${row.allocationId}/decision`, { status: "rejected" });
      setRows((prev) => prev.filter((r) => r.allocationId !== row.allocationId));
      setOk("Order rejected.");
    } catch (err) {
      setError(err.response?.data?.message || "Failed to reject this order.");
    } finally {
      setBusyIds((s) => { const n = new Set(s); n.delete(row.allocationId); return n; });
    }
  };

  // Sale Loss — POST /allocations/{id}/cancel, then jump to the report.
  const handleCancel = async (row) => {
    if (!row.allocationId) return;
    setBusyIds((s) => new Set(s).add(row.allocationId));
    setError(""); setOk("");
    try {
      await API.post(`/allocations/${row.allocationId}/cancel`);
      navigate("/reports/sales-loss");
    } catch (err) {
      setError(err.response?.data?.message || "Failed to cancel this order.");
      setBusyIds((s) => { const n = new Set(s); n.delete(row.allocationId); return n; });
    }
  };

  // ── Edit Allocation actions (System Admin only) ──
  const startEdit = (row) => {
    setEditingRows((s) => new Set(s).add(row.allocationId));
    setEditQtyInputs((s) => ({ ...s, [row.allocationId]: row.allocatedQty || 0 }));
    setEditMeterInputs((s) => ({ ...s, [row.allocationId]: meterOf(row) || "" }));
  };
  const cancelEdit = (row) => {
    setEditingRows((s) => { const n = new Set(s); n.delete(row.allocationId); return n; });
    setEditQtyInputs((s) => { const n = { ...s }; delete n[row.allocationId]; return n; });
    setEditMeterInputs((s) => { const n = { ...s }; delete n[row.allocationId]; return n; });
  };
  const setEditQty = (row, val) => {
    const max = row.requestedQty || 0;
    const clamped = Math.max(0, max > 0 ? Math.min(Number(val) || 0, max) : (Number(val) || 0));
    setEditQtyInputs((s) => ({ ...s, [row.allocationId]: clamped }));
  };
  const approveEdit = async (row) => {
    const qty = editQtyInputs[row.allocationId] ?? row.allocatedQty ?? 0;
    const meter = editMeterInputs[row.allocationId] ?? (meterOf(row) || "");
    setSavingEditId(row.allocationId);
    setError(""); setOk("");
    try {
      await API.patch(`/allocations/${row.allocationId}/decision`, { allocatedQty: qty, meters: meter });
      await load();
      cancelEdit(row);
      setOk(`Updated allocation for ${row.productName} (${row.customerName}).`);
      // Tell Marketing Review (if already mounted) to refetch its board.
      window.dispatchEvent(new CustomEvent("premier-allocation-updated"));
      try { localStorage.setItem("premier_mr_dirty", String(Date.now())); } catch { /* ignore */ }
    } catch (err) {
      setError(err.response?.data?.message || "Failed to update this allocation.");
    } finally {
      setSavingEditId(null);
    }
  };

  // What the table below is listing: expired partials, or the view's rows.
  const source = showExpired ? expiredRows : rows;

  const catCounts = useMemo(() => {
    const m = { all: source.length };
    CLOTH_GROUPS.forEach((g) => { m[g.id] = 0; });
    source.forEach((r) => { const id = groupFor(subTypeOf(r)).id; m[id] = (m[id] || 0) + 1; });
    return m;
    // eslint-disable-next-line
  }, [source, subTypeByCode]);

  const pendingCount = useMemo(
    () => rows.filter((r) => (r.allocatedQty || 0) < (r.requestedQty || 0)).length,
    [rows]
  );

  const visible = useMemo(() => {
    let list = source;

    // Safety net for today-only: if the server already sent an order date,
    // drop anything that isn't today's (expired partials are exempt).
    if (todayOnly && !showExpired) {
      const today = todayStr();
      list = list.filter((r) => !r.inquiryDate || r.inquiryDate === today);
    }

    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((r) => {
        const orderNo = String(orderNoOf(r) || "").toLowerCase();
        return (
          orderNo.includes(q) ||
          (r.customerName || "").toLowerCase().includes(q) ||
          (r.customerCode || "").toLowerCase().includes(q) ||
          (r.productName || "").toLowerCase().includes(q) ||
          (r.productCode || "").toLowerCase().includes(q) ||
          String(productCodeOf(r)).toLowerCase().includes(q) ||
          (r.district || "").toLowerCase().includes(q)
        );
      });
    }

    if (activeType !== "all") list = list.filter((r) => groupFor(subTypeOf(r)).id === activeType);
    if (showExpired) return list;

    if (view === "total_order_value") list = [...list].sort((a, b) => b.totalValue - a.totalValue);
    if (view === "pending_allocation") list = list.filter((r) => (r.allocatedQty || 0) < (r.requestedQty || 0));
    if (view === "full_allocation") list = list.filter((r) => (r.requestedQty || 0) > 0 && (r.allocatedQty || 0) >= (r.requestedQty || 0));
    if (view === "available_stock") list = [...list].sort((a, b) => (b.availableQty || 0) - (a.availableQty || 0));
    if (view === "erp_so_created") list = list.filter((r) => erpStatusOf(r) === "erp_so_created");
    if (view === "edit_allocation") list = list.filter((r) => (r.allocatedQty || 0) > 0 && r.status === "pending");
    list = [...list].sort((a, b) => (b.allocationId || 0) - (a.allocationId || 0));
    return list;
    // eslint-disable-next-line
  }, [source, view, activeType, subTypeByCode, orderItemCodeByCode, search, showExpired, todayOnly]);

  const totalValueSum = useMemo(() => rows.reduce((a, r) => a + (r.totalValue || 0), 0), [rows]);
  const totalAvailableSum = useMemo(() => {
    const seen = new Map();
    rows.forEach((r) => { if (!seen.has(r.productCode)) seen.set(r.productCode, r.availableQty || 0); });
    return Array.from(seen.values()).reduce((a, v) => a + v, 0);
  }, [rows]);

  const fmtAmt = (a) => `₹${(parseFloat(a) || 0).toLocaleString()}`;

  const erpStatusBadge = (row) => {
    const st = erpStatusOf(row);
    if (st === "erp_so_created") {
      return <span style={{ background: "rgba(46,122,114,0.12)", color: "#1E7B4D", border: "1px solid #1E7B4D33", padding: "3px 12px", borderRadius: 20, fontSize: 11.5, fontWeight: 700 }}>ERP SO Created</span>;
    }
    return <span style={{ background: "rgba(140,150,163,0.12)", color: "#526073", border: "1px solid #52607333", padding: "3px 12px", borderRadius: 20, fontSize: 11.5, fontWeight: 700 }}>Not Transferred</span>;
  };

  const statusBadge = (status) => {
    const map = {
      pending: { bg: "rgba(214,148,38,0.12)", color: "#A8701F", label: "Pending" },
      approved: { bg: "rgba(46,122,114,0.12)", color: "#1E7B4D", label: "Approved" },
      rejected: { bg: "rgba(178,58,58,0.12)", color: "#B23A3A", label: "Lost" },
      cancelled: { bg: "rgba(178,58,58,0.12)", color: "#B23A3A", label: "Rejected" },
    };
    const st = map[status] || { bg: "rgba(140,150,163,0.12)", color: "#526073", label: status || "—" };
    return <span style={{ background: st.bg, color: st.color, border: `1px solid ${st.color}33`, padding: "3px 12px", borderRadius: 20, fontSize: 11.5, fontWeight: 700 }}>{st.label}</span>;
  };

  const stockPositionBadge = (row) => {
    const requested = row.requestedQty || 0;
    const available = row.availableQty || 0;
    const allocated = row.allocatedQty || 0;
    let label, color, bg;
    if (allocated <= 0) {
      label = "Not Allocated"; color = "#6B7785"; bg = "rgba(107,119,133,0.12)";
    }
    else if (allocated >= requested) { label = "Fully Allocated"; color = "#1C7A4B"; bg = "rgba(28,122,75,0.12)"; }
    else { label = "Partial Allocated"; color = "#8A5A0E"; bg = "rgba(138,90,14,0.12)"; }
    return <span style={{ background: bg, color, border: `1px solid ${color}33`, padding: "3px 12px", borderRadius: 20, fontSize: 11.5, fontWeight: 700 }}>{label}</span>;
  };
  const rowStatusBadge = (row) =>
    (isSysAdminStyleView || view === "awaiting_approval") ? statusBadge(row.status) : stockPositionBadge(row);

  const busyList = showExpired ? expiredLoading : loading;

  return (
    <Shell pageTitle={embedded ? "Sales Order" : "Today's Orders"}>
      
      <p style={S.headingSub}>
       
        {showExpired
          ? `Expired Partials — orders still short of their requested qty ${PARTIAL_WINDOW_HOURS} hours after the first allocation. Total: ${visible.length}.`
          : (
            <>
              {/* {VIEWS.find((v) => v.id === view)?.label || ""} — {isSysAdminStyleView ? "fed by Marketing Review's Final Approval workflow." : "fed by Marketing Review's allocation board."} */}
              {/* {view === "total_order_value" && ` Total: ${fmtAmt(totalValueSum)} across ${rows.length} line(s).`}
              {view === "today_inquiries" && ` Total: ${rows.length} order line(s).`}
              {view === "pending_allocation" && ` Total: ${visible.length} line(s) still awaiting full allocation.`}
              {view === "full_allocation" && ` Total: ${visible.length} fully allocated line(s).`}
              {view === "available_stock" && ` Total available: ${totalAvailableSum.toLocaleString()} Pcs.`}
              {view === "awaiting_approval" && ` Total: ${rows.length} line(s) awaiting System Admin's decision.`}
              {view === "pending_final_approval" && ` Total: ${visible.length} order(s) waiting for your approval.`}
              {view === "rejected_orders" && ` Total: ${rows.length} rejected order(s).`}
              {view === "erp_so_created" && ` Total: ${rows.length} order(s) transferred to ERP.`}
              {view === "edit_allocation" && ` Total: ${visible.length} allocated line(s) available to edit.`} */}
            </>
          )}
      </p>

      <div style={S.filterBar}>
        <div style={S.searchWrap}>
          <Search size={14} style={S.searchIcon} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search order no, customer, product, or code…"
            style={S.searchInput}
          />
        </div>
        {!embedded && (
          <select value={view} onChange={(e) => setView(e.target.value)} style={S.viewSelect}>
            {VIEWS.map((v) => (
              <option key={v.id} value={v.id}>{v.label}</option>
            ))}
          </select>
        )}
        {embedded ? (
          <input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} style={S.dateInput} />
        ) : (
          <span style={S.todayChip}>Today · {todayLabel()}</span>
        )}
      </div>

      {error && <div style={S.alertError}>{error}</div>}
      {ok && <div style={S.alertOk}>{ok}</div>}

      {/* Pending Allocation has two tabs: normal pending lines, and the
          expired partials that used to have their own page. */}
      {canSeeExpired && (
        <div style={S.segRow}>
          <button style={S.seg(!showExpired)} onClick={() => setExpiredTab(false)}>
            Pending Allocation ({pendingCount})
          </button>
          <button style={S.seg(showExpired)} onClick={() => setExpiredTab(true)}>
            Expired Partials ({expiredRows.length})
          </button>
        </div>
      )}

      <div style={S.pillRow}>
        <button onClick={() => setActiveType("all")} style={S.pill(activeType === "all", "#0F2138")}>
          <LayoutGrid size={13} />
          All <span style={S.pillCount}>({catCounts.all || 0})</span>
        </button>
        {CLOTH_GROUPS.map((g) => {
          const Icon = g.icon;
          return (
            <button key={g.id} onClick={() => setActiveType(g.id)} style={S.pill(activeType === g.id, g.color)}>
              <Icon size={13} />
              {g.name} <span style={S.pillCount}>({catCounts[g.id] || 0})</span>
            </button>
          );
        })}
      </div>

      <div style={S.card}>
        <div style={S.tableScroll}>
          {busyList ? (
            <p style={S.empty}>Loading…</p>
          ) : visible.length === 0 ? (
            <p style={S.empty}>
              {search
                ? "No orders match your search."
                : showExpired
                  ? "No expired partial allocations."
                  : todayOnly ? "No orders for today here right now." : "Nothing here right now."}
            </p>
          ) : showExpired ? (
            <table style={S.table}>
              <thead>
                <tr>
                  {["S.No", "Enquiry No", "Customer", "District", "Product Code", "Product", "Requested", "Allocated", "Remaining", "First Allocated", "Expired For"].map((h) => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((r, i) => (
                  <tr key={r.allocationId}>
                    <td style={S.td}>{i + 1}</td>
                    <td style={{ ...S.td, fontWeight: 600 }}>{r.orderNo}</td>
                    <td style={S.td}>{r.customerName}<div style={{ fontSize: 11, color: themeG.textSub }}>{r.customerCode}</div></td>
                    <td style={S.td}>{r.district || "—"}</td>
                    <td style={S.td}>{r.productCode}</td>
                    <td style={S.td}>{r.productName}</td>
                    <td style={S.td}>{r.requested}</td>
                    <td style={S.td}>{r.allocated}</td>
                    <td style={{ ...S.td, fontWeight: 700, color: "#B2622E" }}>{r.remaining}</td>
                    <td style={S.td}>{String(r.since).slice(0, 16).replace("T", " ")}</td>
                    <td style={S.td}>{r.hoursOver >= 24 ? `${Math.floor(r.hoursOver / 24)}d ${r.hoursOver % 24}h` : `${r.hoursOver}h`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>S.No</th>
                  <th style={S.th}>Enquiry No</th>
                  {!isRejectedView && (<><th style={S.th}>Customer</th><th style={S.th}>Customer Code</th></>)}
                  <th style={S.th}>Product</th>
                  {(isEditAlloc || isRejectedView) && <th style={S.th}>Product Code</th>}
                  <th style={S.th}>UOM</th>
                  {!isEditAlloc && !isRejectedView && <th style={S.th}>Product Code</th>}
                  {(!isSysAdminStyleView || view === "edit_allocation") && <th style={S.th}>Requested Qty</th>}
                  <th style={S.th}>Allocated Qty</th>
                  <th style={S.th}>Mtr</th>
                  {isSysAdminStyleView && <th style={S.th}>ERP SO Status</th>}
                  <th style={S.th}>Status</th>
                  {(view === "pending_final_approval" || view === "edit_allocation") && <th style={S.th}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {visible.map((r, idx) => {
                  const busy = busyIds.has(r.allocationId);
                  const canReject = r.status === "pending" && !busy;
                  return (
                    <tr key={r.allocationId}>
                      <td style={S.td}>{idx + 1}</td>
                      <td style={S.td}>{orderNoOf(r) || "—"}</td>
                      {!isRejectedView && (
                        <>
                          <td style={{ ...S.td, fontWeight: 700, color: themeG.accent }}>{r.customerName}</td>
                          <td style={S.td}>{r.customerCode}</td>
                        </>
                      )}
                      <td style={S.td}>{r.productName}</td>
                      {(isEditAlloc || isRejectedView) && <td style={S.td}>{productCodeOf(r)}</td>}
                      <td style={S.td}>{uomOf(r) ? uomLabel(uomOf(r)) : "—"}</td>
                      {!isEditAlloc && !isRejectedView && <td style={S.td}>{productCodeOf(r)}</td>}
                      {(!isSysAdminStyleView || view === "edit_allocation") && <td style={S.td}>{r.requestedQty ?? "—"}</td>}
                      <td style={S.td}>
                        {view === "edit_allocation" && editingRows.has(r.allocationId) ? (
                          <input
                            type="number" min={0} max={r.requestedQty || undefined}
                            value={
                              (editQtyInputs[r.allocationId] ?? r.allocatedQty ?? 0) === 0
                                ? ""
                                : (editQtyInputs[r.allocationId] ?? r.allocatedQty ?? 0)
                            }
                            placeholder="0"
                            onChange={(e) => setEditQty(r, e.target.value)}
                            style={S.editInput}
                          />
                        ) : (
                          r.allocatedQty
                        )}
                      </td>
                      <td style={S.td}>
                        {view === "edit_allocation" && editingRows.has(r.allocationId) ? (
                          <input
                            type="text" placeholder="e.g. 5M"
                            value={editMeterInputs[r.allocationId] ?? ""}
                            onChange={(e) => setEditMeterInputs((s) => ({ ...s, [r.allocationId]: e.target.value }))}
                            style={{ ...S.editInput, textAlign: "center" }}
                          />
                        ) : (
                          meterOf(r) || "—"
                        )}
                      </td>
                      {isSysAdminStyleView && <td style={S.td}>{erpStatusBadge(r)}</td>}
                      <td style={S.td}>{rowStatusBadge(r)}</td>
                      {view === "pending_final_approval" && (
                        <td style={S.td}>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              onClick={() => handleCancel(r)}
                              data-confirm="Mark this order as a Sale Loss? It will be removed from Sales Order." data-confirm-title="Sale Loss"
                              disabled={busy}
                              title="Cancel this order and log it in Sales Loss Report"
                              style={{ ...S.actionBtnReject, ...(busy ? S.actionBtnDisabled : {}) }}
                            >
                              Sale Loss
                            </button>
                            <button
                              onClick={() => handleReject(r)}
                              data-confirm="Reject this order?" data-confirm-title="Reject Order"
                              disabled={!canReject}
                              title={r.status === "pending" ? "Reject this order" : "Only a Pending order can be rejected"}
                              style={{ ...S.actionBtnCancel, ...(canReject ? {} : S.actionBtnDisabled) }}
                            >
                              Reject
                            </button>
                          </div>
                        </td>
                      )}
                      {view === "edit_allocation" && (
                        <td style={S.td}>
                          {editingRows.has(r.allocationId) ? (
                            <div style={{ display: "flex", gap: 6 }}>
                              <button
                                onClick={() => approveEdit(r)}
                                disabled={savingEditId === r.allocationId}
                                style={{ ...S.actionBtnApprove, ...(savingEditId === r.allocationId ? S.actionBtnDisabled : {}) }}
                              >
                                {savingEditId === r.allocationId ? "Submitting…" : "Submit"}
                              </button>
                              <button
                                onClick={() => cancelEdit(r)}
                                disabled={savingEditId === r.allocationId}
                                style={{ ...S.actionBtnCancel, ...(savingEditId === r.allocationId ? S.actionBtnDisabled : {}) }}
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button onClick={() => startEdit(r)} style={S.actionBtnEdit}>
                              <Pencil size={12} style={{ marginRight: 4, verticalAlign: "-2px" }} />
                              Edit
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Shell>
  );
}

function buildStyles(themeG) {
  return {
    heading: { fontFamily: "'Space Grotesk', " + FONT, fontSize: 26, fontWeight: 700, margin: "0 0 4px", color: themeG.textMain, letterSpacing: "-0.4px" },
    headingSub: { fontSize: 13, color: themeG.textSub, margin: "0 0 14px" },

    filterBar: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16 },
    viewSelect: {
      padding: "9px 14px", borderRadius: 10, border: `1px solid ${themeG.border}`,
      background: themeG.card, color: themeG.textMain, fontFamily: FONT, fontSize: 13,
      fontWeight: 600, outline: "none", cursor: "pointer", minWidth: 220,
    },
    searchWrap: { position: "relative", flex: "1 1 260px", maxWidth: 420 },
    searchIcon: { position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: themeG.textSub },
    searchInput: {
      width: "100%", boxSizing: "border-box", padding: "9px 12px 9px 34px", borderRadius: 10,
      border: `1px solid ${themeG.border}`, background: themeG.card, color: themeG.textMain,
      fontFamily: FONT, fontSize: 13, outline: "none",
    },
    dateInput: {
      padding: "9px 12px", borderRadius: 10, border: `1px solid ${themeG.border}`,
      background: themeG.card, color: themeG.textMain, fontFamily: FONT, fontSize: 13,
      outline: "none",
    },
    todayChip: {
      padding: "9px 14px", borderRadius: 10, border: `1px solid ${themeG.border}`,
      background: themeG.card, color: themeG.textMain, fontFamily: FONT, fontSize: 13, fontWeight: 700,
      whiteSpace: "nowrap",
    },

    // Pending Allocation / Expired Partials switch
    segRow: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 },
    seg: (active) => ({
      padding: "8px 16px", borderRadius: 9,
      border: `1px solid ${active ? themeG.accent : themeG.border}`,
      background: active ? themeG.accent : themeG.card,
      color: active ? "#fff" : themeG.textMain,
      fontFamily: FONT, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
    }),

    pillRow: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 },
    pill: (active, color) => ({
      display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 20,
      border: active ? "none" : `1px solid ${themeG.border}`, cursor: "pointer", fontFamily: FONT,
      fontSize: 12.5, fontWeight: 700,
      background: active ? color : themeG.card, color: active ? "#fff" : themeG.textMain,
      boxShadow: active ? `0 3px 10px ${color}55` : "0 2px 6px rgba(15,33,56,0.06)",
    }),
    pillCount: { opacity: 0.85, fontWeight: 600 },

    card: { background: themeG.card, border: `1px solid ${themeG.border}`, borderRadius: 14, overflow: "hidden", boxShadow: "0 4px 16px rgba(15,33,56,0.06)" },
    tableScroll: { overflowX: "auto", overflowY: "auto", maxHeight: 460 },
    table: { width: "100%", minWidth: 1180, tableLayout: "auto", borderCollapse: "collapse" },
    th: { textAlign: "center", fontSize: 10.5, color: "#FFFFFF", background: "#1F3A63", padding: "10px 16px", borderBottom: `1px solid ${themeG.border}`, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, position: "sticky", top: 0, zIndex: 1, whiteSpace: "nowrap" },
    td: { padding: "10px 16px", fontSize: 13, color: themeG.textMain, borderBottom: `1px solid ${themeG.border}`, textAlign: "center", whiteSpace: "nowrap" },
    actionBtnReject: { padding: "5px 12px", borderRadius: 7, border: "1px solid rgba(178,58,58,0.35)", background: "rgba(178,58,58,0.08)", color: "#B23A3A", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: FONT, whiteSpace: "nowrap" },
    actionBtnCancel: { padding: "5px 12px", borderRadius: 7, border: "1px solid rgba(138,90,14,0.35)", background: "rgba(138,90,14,0.08)", color: "#8A5A0E", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: FONT, whiteSpace: "nowrap" },
    actionBtnDisabled: { opacity: 0.45, cursor: "not-allowed" },
    actionBtnEdit: { display: "inline-flex", alignItems: "center", padding: "5px 12px", borderRadius: 7, border: "1px solid rgba(178,58,58,0.35)", background: "rgba(178,58,58,0.08)", color: "#B23A3A", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: FONT, whiteSpace: "nowrap" },
    actionBtnApprove: { padding: "5px 12px", borderRadius: 7, border: "1px solid rgba(28,122,75,0.35)", background: "rgba(28,122,75,0.08)", color: "#1C7A4B", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: FONT, whiteSpace: "nowrap" },
    editInput: { width: 76, padding: "5px 8px", borderRadius: 7, border: `1px solid ${themeG.border}`, background: themeG.card, color: themeG.textMain, fontFamily: FONT, fontSize: 13, outline: "none" },
    empty: { padding: 50, textAlign: "center", fontSize: 14, color: themeG.textSub },
    alertError: { marginBottom: 18, background: "rgba(178,58,58,0.08)", border: "1px solid rgba(178,58,58,0.25)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#B23A3A" },
    alertOk: { marginBottom: 18, background: "rgba(46,122,114,0.08)", border: "1px solid rgba(46,122,114,0.25)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#1E7B4D" },
  };
}