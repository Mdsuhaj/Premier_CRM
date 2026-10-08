// src/pages/master/OrderEnquiry.jsx
//
// Order Enquiry — sits before Master/My Orders in the sidebar because it's
// the FIRST thing staff should look at: fresh customer enquiries that
// haven't become real orders yet.
//
// Actions: only Approve / Edit / Reject are shown — there's no separate
// "Assign to me" or "Add Order" button anymore. "Approve" is a single,
// context-aware action that does whatever the enquiry's current state
// needs next:
//   1. Pending (nobody's claimed it yet) — clicking Approve claims it
//      (assigns it to you) AND takes you straight into Add Order to fill
//      in price, discount, delivery date and product specs. This is
//      exactly what the old "Assign to me" button did; it's just now
//      called Approve since that's the action staff are taking.
//   2. Assigned but not yet placed (no delivery date on it) — clicking
//      Approve takes you back into Add Order to finish it off. It can't
//      really be approved yet because it isn't a real order until it's
//      been placed.
//   3. Assigned AND placed (has a delivery date) — clicking Approve is
//      the real thing: it sets Status='approved' right here, no trip to
//      Add Order needed. This is now a real order, visible in Master →
//      Order List.
//   4. Reject (with a reason the customer will see) is available any time
//      before it's approved.
//
// Once an enquiry's Status is 'approved' it IS a real order. There is no
// dedicated read-only "Order View" page/route in this app — the only
// screen that can display everything about an order (customer, product,
// specs, pricing, delivery) is Add Order itself. So "View" on an approved
// row routes straight into Add Order the same way Edit does for an
// unapproved one — the only difference is that page already opens fully
// LOCKED for a fromEnquiry visit (editDetails/editPayment both default to
// false), so an approved row lands on a genuinely read-only version of
// that screen, not an editable draft. There is deliberately no separate
// "/master/orders/:id" trip through Master → Order List first — that hop
// added nothing (Order List has no per-row detail view of its own to land
// on) and only cost an extra click, so View now goes directly to the
// Add Order screen in its locked/viewable state.
//
// Tabs above the table: All / Pending / Approved / Rejected. There's no
// separate "Assigned" tab — an assigned-but-not-yet-placed enquiry just
// shows up under "All" (still fully actionable via Approve/Reject/Edit).
//
// Who sees what (Follow Person):
//   - Every enquiry has a Follow Person once it's claimed (whoever's
//     Approve click assigned it to them). A person only sees enquiries
//     THEY are following — this page is "my enquiries", not a shared
//     queue of everyone else's claimed work.
//   - The one exception is Status='pending': a fresh, unclaimed enquiry
//     has no Follow Person yet, so it has to stay visible to everyone —
//     otherwise nobody would ever be able to see it in order to claim it.
//     Its Follow Person cell just shows "—" until someone claims it (same
//     as every other empty cell in this table — not a special "unassigned"
//     word, just "nothing here yet").
//
// Super Admin sees this screen read-only (no action buttons), matching
// how the rest of Master data behaves for that role.
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../../components/AppLayout";
import { useTheme } from "../../ThemeContext";
import { getG, statusColor } from "../../theme";
import API from "../../services/api";

const FONT = "'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const PIPELINE_STATUSES = "pending,assigned,approved,declined";

const Badge = ({ text }) => {
  const s = statusColor(text);
  return (
    <span style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}`, padding: "3px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>
      {(text || "—").charAt(0).toUpperCase() + (text || "—").slice(1)}
    </span>
  );
};

export default function OrderEnquiry() {
  const { isDark } = useTheme();
  const themeG = getG(isDark);
  const navigate = useNavigate();
  const role = localStorage.getItem("role") || "";
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const readOnly = role === "super_admin";
  const canAct = ["admin", "system_admin", "end_user"].includes(role);

  const [tab, setTab] = useState("all"); // all | pending | approved | rejected
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

    const load = async () => {
    setLoading(true);
    setError("");
    try {
      const params = { status_in: PIPELINE_STATUSES };
      // System Admin's queue should only ever show orders Admin has
      // already allocated stock to in Marketing Review — matches the
      // same server-side gate now enforced in OrderController@updateStatus.
      if (role === "system_admin") params.allocated_only = 1;
      const res = await API.get("/orders", { params });
      // Personal view: everyone only sees enquiries they're following
      // themselves, EXCEPT still-unclaimed "pending" ones, which have to
      // stay visible to everyone so someone can actually claim them.
      // (If you ever want Super Admin to see the full unfiltered list for
      // oversight instead, that's the one spot to special-case.)
      // System Admin = Marketing Head, giving Final Approval (O2C Step 4).
      // That's a company-wide approval queue, not a personal "my
      // enquiries" list — the Marketing Head has to see every placed
      // enquiry waiting on them, no matter which Marketing user assigned
      // it to themselves. Everyone else still only sees what they're
      // personally following (plus unclaimed pending enquiries).
      const mine = role === "system_admin"
        ? res.data
        : res.data.filter(
            (o) => o.Status === "pending" || String(o.AssignedToId ?? "") === String(user.Id ?? "")
          );
      setOrders(mine);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load enquiries.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const grouped = useMemo(() => {
    const g = { pending: [], assigned: [], approved: [], rejected: [] };
    orders.forEach((o) => {
      if (o.Status === "pending") g.pending.push(o);
      else if (o.Status === "assigned") g.assigned.push(o);
      else if (o.Status === "approved") g.approved.push(o);
      else if (o.Status === "declined") g.rejected.push(o);
    });
    return g;
  }, [orders]);

  const visible = tab === "all" ? orders : (grouped[tab] || []);

  // Assign to me + jump straight into Add Order — for a fresh pending
  // enquiry there's no reason to make staff assign, land back here, then
  // click Add Order separately. One click does both.
  const assignToMe = async (o) => {
    setBusyId(o.Id); setError("");
    try {
      await API.patch(`/orders/${o.Id}/assign`, {});
      const params = new URLSearchParams({
        fromEnquiry: o.Id,
        customerId: o.CustomerId,
        productId: o.ProductId,
      });
      navigate(`/master/orders/add?${params.toString()}`);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to assign enquiry.");
      setBusyId(null);
    }
  };

  // Shortcut approve — right here, no trip to Add Order. Only shown for
  // assigned enquiries that have actually been placed (see isPlaced
  // below) — stays on this page (the row just moves to the Approved tab).
  const approve = async (id) => {
    setBusyId(id); setError("");
    try {
      await API.patch(`/orders/${id}/status`, { status: "approved" });
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to approve enquiry.");
    } finally {
      setBusyId(null);
    }
  };

  // Go into Add Order — that page's own submit buttons are what actually
  // finalize it from there. Used both to resume an assigned enquiry that
  // hasn't been placed yet (Edit) AND to open an already-approved row in
  // its locked/read-only state (View) — see the header comment for why
  // there's no separate order-view route. The page itself is what decides
  // whether it's editable: editDetails/editPayment both default to false
  // whenever fromEnquiry is set, so an approved row lands genuinely
  // read-only.
  const goToAddOrder = (o) => {
    const params = new URLSearchParams({
      fromEnquiry: o.Id,
      customerId: o.CustomerId,
      productId: o.ProductId,
    });
    navigate(`/master/orders/add?${params.toString()}`);
  };

  const reject = async (id) => {
    const reason = window.prompt("Reason for rejecting this enquiry (the customer will see this):");
    if (!reason || !reason.trim()) return;
    setBusyId(id); setError("");
    try {
      await API.patch(`/orders/${id}/reject`, { reason: reason.trim() });
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to reject enquiry.");
    } finally {
      setBusyId(null);
    }
  };

  // "Edit"/"View" both land on the same Add Order screen — see
  // goToAddOrder above for why an approved row still goes there instead
  // of anywhere else. The button label alone (Edit vs View) tells staff
  // whether they're looking at a live draft or a locked record.
  const editEnquiry = (o) => {
    goToAddOrder(o);
  };

  const S = buildStyles(themeG);

  // An assigned enquiry counts as "placed" once it has a delivery date
  // on it — that field is only ever set during Add Order's Payment &
  // Delivery step (or a manual edit with real data), so it's a good
  // signal that this isn't just the bare enquiry anymore.
  const isPlaced = (o) => Boolean(o.DeliveryDate);

  // The single "Approve" button's behavior depends on where the enquiry
  // currently sits in the pipeline — see the header comment for the
  // three cases this covers. Approve is only ever shown for pending/
  // assigned rows (see the table below), so an already-approved row can
  // never reach this function — it only ever has "View" instead.
  const isFinalApprover = role === "system_admin";

  const handleApprove = (o) => {
    if (o.Status === "pending") {
      assignToMe(o); // claims it + navigates into Add Order
      return;
    }
    if (o.Status === "assigned" && !isPlaced(o)) {
      goToAddOrder(o); // resume filling in the order details
      return;
    }
    // Placed and ready — only the Marketing Head (system_admin) can give
    // the real, final approval from here. Marketing (admin) has nothing
    // left to do on this row; it just sits in the Marketing Head's
    // pending queue until they act on it (O2C Step 4).
    if (!isFinalApprover) return;
    approve(o.Id); // assigned + already placed -> real approval, stays on this page
  };

  const followPersonName = (o) => o.assignedUser?.Name || "—";

  const TABS = [
    ["all", "All", orders.length],
    ["pending", "Pending", grouped.pending.length],
    ["approved", "Approved", grouped.approved.length],
    ["rejected", "Rejected", grouped.rejected.length],
  ];

  return (
    <Layout pageTitle="Order Enquiry">
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />

      <div style={S.headerRow}>
        <div>
          <h1 style={S.heading}>Enquiry Order Details</h1>
          <p style={S.headingSub}>
            {readOnly
              ? "Read-only — assigning opens Add Order to fill in details."
              : isFinalApprover
              ? "Final Approval queue (Marketing Head) — every enquiry Marketing has placed, company-wide, waiting on your sign-off before it becomes a Sales Order."
              : "Showing enquiries you're following, plus any pending enquiries still waiting to be claimed."}
          </p>
        </div>
        {!readOnly && canAct && (
          <button style={S.addBtn} onClick={() => navigate("/master/orders/add")}>
            + Add Enquiry
          </button>
        )}
      </div>

      <div style={S.tabs}>
        {TABS.map(([key, label, count]) => (
          <button key={key} style={S.tabBtn(tab === key)} onClick={() => setTab(key)}>{label} ({count})</button>
        ))}
      </div>

      {error && <div style={S.alertError}>{error}</div>}

      <div style={S.card}>
        {loading ? (
          <p style={S.empty}>Loading…</p>
        ) : visible.length === 0 ? (
          <p style={S.empty}>{tab === "pending" ? "No enquiries waiting right now 🎉" : tab === "all" ? "No enquiries yet." : `No ${tab} enquiries.`}</p>
        ) : (
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Order Number</th>
                <th style={S.th}>Customer Name</th>
                <th style={S.th}>Follow Person</th>
                <th style={S.th}>Product Name</th>
                <th style={S.th}>Quantity</th>
                <th style={S.th}>Status</th>
                {!readOnly && <th style={S.th}>Action</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map((o) => {
                const isBusy = busyId === o.Id;
                const isApproved = o.Status === "approved";
                return (
                  <tr key={o.Id}>
                    <td style={{ ...S.td, fontWeight: 700, color: themeG.accent || "#1F5C99" }}>{o.Code}</td>
                    <td style={S.td}>{o.customer?.Name ?? "—"}</td>
                    <td style={S.td}>{followPersonName(o)}</td>
                    <td style={S.td}>{o.product?.Name ?? "—"}</td>
                    <td style={S.td}>{o.Quantity}</td>
                    <td style={S.td}><Badge text={o.Status} /></td>
                    {!readOnly && (
                      <td style={S.td}>
                        {!canAct ? (
                          <span style={{ fontSize: 12, color: themeG.textSub }}>—</span>
                        ) : (
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                            {(o.Status === "pending" || o.Status === "assigned") && (
                              <>
                                {o.Status === "assigned" && isPlaced(o) && !isFinalApprover ? (
                                  <span style={{ fontSize: 11.5, fontWeight: 600, color: themeG.textSub, fontStyle: "italic" }}>
                                    Pending Marketing Head approval
                                  </span>
                                ) : (
                                  <button style={S.actionBtn("#16A34A")} disabled={isBusy} onClick={() => handleApprove(o)} data-confirm="Approve this order and move it to the next stage?" data-confirm-title="Approve Order">
                                    {isBusy ? "…" : o.Status === "assigned" && isPlaced(o) ? "Give Final Approval" : "Approve"}
                                  </button>
                                )}
                                <button style={S.actionBtn("#B23A3A")} disabled={isBusy} onClick={() => reject(o.Id)} data-confirm="Reject this order?" data-confirm-title="Reject Order">
                                  Reject
                                </button>
                              </>
                            )}
                            <button
                              style={isApproved ? S.actionBtn("#2563EB") : S.actionBtn("#EAB308", "#3A2E00")}
                              disabled={isBusy}
                              onClick={() => editEnquiry(o)}
                            >
                              {isApproved ? "View" : "Edit"}
                            </button>
                          </div>
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

      <div style={S.legend}>
        <LegendStep label="Pending" desc="Customer submitted, unassigned" />
        <Arrow />
        <LegendStep label="Assign" desc="Marketing claims it, opens Add Order" />
        <Arrow />
        <LegendStep label="Add Order" desc="Marketing confirms price, specs, delivery" />
        <Arrow />
        <LegendStep label="Final Approval" desc="Marketing Head (System Admin) only" />
        <Arrow />
        <LegendStep label="Approved" desc="Real order — pushed to ERP by System Admin" />
      </div>
    </Layout>
  );
}

function LegendStep({ label, desc }) {
  return (
    <div style={{ textAlign: "center", minWidth: 100 }}>
      <p style={{ margin: "0 0 2px", fontSize: 12.5, fontWeight: 700 }}>{label}</p>
      <p style={{ margin: 0, fontSize: 10.5, opacity: 0.65 }}>{desc}</p>
    </div>
  );
}
function Arrow() {
  return <span style={{ opacity: 0.4, fontSize: 16 }}>→</span>;
}

function buildStyles(themeG) {
  return {
    heading: { fontFamily: "'Space Grotesk', " + FONT, fontSize: 26, fontWeight: 700, margin: "0 0 4px", color: themeG.textMain, letterSpacing: "-0.4px" },
    headingSub: { fontSize: 13, color: themeG.textSub, margin: "0 0 22px" },
    headerRow: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" },
    // Pale green, vibrant — distinct from the green Approve button below
    // (this one's lighter/pastel so "+ Add Enquiry" doesn't read as a
    // pipeline action, just a way in).
    addBtn: { padding: "11px 20px", borderRadius: 10, border: "none", background: "#16A34A", color: "#f4f8f7", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: FONT, whiteSpace: "nowrap", boxShadow: "0 2px 10px rgba(34,197,94,0.32)" },
    tabs: { display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" },
    tabBtn: (active) => ({ padding: "9px 16px", borderRadius: 9, border: `1px solid ${themeG.border}`, background: active ? themeG.accent : themeG.card, color: active ? "#fff" : themeG.textMain, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: FONT, whiteSpace: "nowrap" }),
    card: { background: themeG.card, border: `1px solid ${themeG.border}`, borderRadius: 14, overflow: "hidden", boxShadow: "0 4px 16px rgba(15,33,56,0.06)" },
    table: { width: "100%", borderCollapse: "collapse" },
    th: { textAlign: "left", fontSize: 11, color: themeG.textLabel, padding: "12px 18px", borderBottom: `1px solid ${themeG.border}`, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 },
    td: { padding: "13px 18px", fontSize: 13.5, color: themeG.textMain, borderBottom: `1px solid ${themeG.border}` },
    empty: { padding: 50, textAlign: "center", fontSize: 14, color: themeG.textSub },
    // actionBtn(bg, textColor?) — textColor defaults to white; pass a dark
    // color for light backgrounds (e.g. the yellow Edit button) so the
    // label stays readable.
    actionBtn: (color, textColor = "#fff") => ({ padding: "6px 14px", borderRadius: 8, border: "none", background: color, color: textColor, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: FONT, whiteSpace: "nowrap" }),
    alertError: { marginBottom: 18, background: "rgba(178,58,58,0.08)", border: "1px solid rgba(178,58,58,0.25)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#B23A3A" },
    legend: { display: "flex", alignItems: "center", gap: 14, justifyContent: "center", marginTop: 24, padding: "16px 10px", color: themeG.textSub },
  };
}