// src/pages/end-user/Drafts.jsx
//
// Field Officer's "My Drafts" page — lists every saved draft across all
// customers (see utils/endUserDrafts.js). A draft is a frozen snapshot
// of a customer's cart, taken from either the Product Selection page or
// the Cart Checkout page with "💾 Save as Draft" instead of submitting.
// Saving from either page empties that customer's live cart and lands
// here, so both pages start empty by default the next time they're
// opened fresh (i.e. without a draftId in the URL).
//
// An officer can hold several drafts at once (same or different
// customers) and come back to any of them.
//
// "Resume" restores that draft's items back into the live cart for its
// customer (utils/endUserCart.js::replaceCart) and opens Product
// Selection pre-filled with the draft's customer + items, carrying the
// draftId along in the URL. From Product Selection the officer can keep
// adding/adjusting products, then either continue on to Cart Checkout
// (View Cart & Submit — which also carries the draftId so Requested
// Date / Ref No / Remarks come back too) or save again with "💾 Save as
// Draft", which updates this same draft in place. Submitting the
// enquiry from Cart Checkout removes it from this list.
import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import EndUserLayout from "../../components/EndUserLayout";
import { useTheme } from "../../ThemeContext";
import { getG } from "../../theme";
import { listDrafts, deleteDraft, subscribeToDrafts } from "../../utils/endUserDrafts";
import { replaceCart } from "../../utils/endUserCart";

const FONT = "'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function formatDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) +
    " · " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export default function Drafts() {
  const { isDark } = useTheme();
  const themeG = getG(isDark);
  const navigate = useNavigate();
  const location = useLocation();

  const [drafts, setDrafts] = useState([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  // Hand-off notice from Product Selection / Cart Checkout's "Save as
  // Draft" button, if that's how we got here.
  const [notice, setNotice] = useState(location.state?.notice || "");

  useEffect(() => {
    const role = localStorage.getItem("role");
    if (role !== "end_user") { navigate("/login"); return; }
    // eslint-disable-next-line
  }, []);

  useEffect(() => {
    setDrafts(listDrafts());
    const unsub = subscribeToDrafts(() => setDrafts(listDrafts()));
    return unsub;
  }, []);

  // Resume sends the officer back to Product Selection (not Cart
  // Checkout) with this draft's items already restored into the live
  // cart and the draftId carried in the URL, so "View Cart & Submit"
  // from there brings the Requested Date / Ref No / Remarks along too.
  const resumeDraft = (draft) => {
    replaceCart(draft.customerId, draft.items);
    navigate(`/end-user/product-selection?customerId=${draft.customerId}&draftId=${draft.id}`);
  };

  const confirmDelete = (id) => {
    deleteDraft(id);
    setConfirmDeleteId(null);
  };

  const S = {
    header: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 22 },
    title: { fontFamily: "'Space Grotesk', " + FONT, fontSize: 24, fontWeight: 700, margin: "0 0 4px", color: themeG.textMain, letterSpacing: "-0.4px" },
    subtitle: { fontSize: 13, color: themeG.textSub, margin: 0 },

    empty: { padding: 50, textAlign: "center", color: themeG.textSub, fontSize: 13.5, background: themeG.card, border: `1px solid ${themeG.border}`, borderRadius: 14 },

    grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 },
    card: { background: themeG.card, border: `1px solid ${themeG.border}`, borderRadius: 14, padding: 18, boxShadow: "0 4px 16px rgba(15,33,56,0.06)", display: "flex", flexDirection: "column", gap: 10 },
    cardHead: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 },
    custName: { fontSize: 14.5, fontWeight: 700, color: themeG.textMain, margin: 0 },
    custCode: { fontSize: 11.5, color: themeG.textSub, margin: "2px 0 0" },
    savedAt: { fontSize: 11, color: themeG.textSub, whiteSpace: "nowrap" },

    statsRow: { display: "flex", gap: 18 },
    statLabel: { fontSize: 10.5, fontWeight: 700, color: themeG.textLabel, textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 2px" },
    statValue: { fontSize: 15, fontWeight: 700, color: themeG.textMain, margin: 0 },

    itemsPreview: { fontSize: 12.5, color: themeG.textSub, lineHeight: 1.5, margin: 0, maxHeight: 60, overflow: "hidden" },

    extras: { fontSize: 11.5, color: themeG.textSub, margin: 0 },

    actionsRow: { display: "flex", gap: 8, marginTop: 4 },
    resumeBtn: { flex: 1, padding: "8px 0", borderRadius: 8, border: "none", background: themeG.accent, color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: FONT },
    deleteBtn: { padding: "8px 14px", borderRadius: 8, border: "1px solid rgba(178,58,58,0.35)", background: "transparent", color: "#B23A3A", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: FONT },

    confirmBar: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, background: "rgba(178,58,58,0.08)", border: "1px solid rgba(178,58,58,0.25)", borderRadius: 8, padding: "8px 10px" },
    confirmText: { fontSize: 11.5, color: "#B23A3A", margin: 0 },
    confirmActions: { display: "flex", gap: 6 },
    confirmYes: { padding: "5px 10px", borderRadius: 6, border: "none", background: "#B23A3A", color: "#fff", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: FONT },
    confirmNo: { padding: "5px 10px", borderRadius: 6, border: `1px solid ${themeG.border}`, background: "transparent", color: themeG.textSub, fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: FONT },
  };

  return (
    <EndUserLayout>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />


      {notice && (
        <div style={{ marginBottom: 16, background: "rgba(15,33,56,0.08)", border: "1px solid rgba(15,33,56,0.25)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: themeG.accent }}>
          {notice}
        </div>
      )}

      {drafts.length === 0 ? (
        <div style={S.empty}>
          No drafts yet. From a customer's cart, use <strong>💾 Save as Draft</strong> to keep it here without submitting.
        </div>
      ) : (
        <div style={S.grid}>
          {drafts.map((d) => {
            const totalQty = (d.items || []).reduce((sum, l) => sum + l.qty, 0);
            const preview = (d.items || []).slice(0, 3).map((l) => l.product?.Name).filter(Boolean).join(", ");
            const extraCount = (d.items || []).length - 3;
            return (
              <div key={d.id} style={S.card}>
                <div style={S.cardHead}>
                  <div>
                    <p style={S.custName}>{d.customerName || "Unknown customer"}</p>
                    {d.customerCode && <p style={S.custCode}>{d.customerCode}</p>}
                  </div>
                  <span style={S.savedAt}>{formatDateTime(d.updatedAt)}</span>
                </div>

                <div style={S.statsRow}>
                  <div>
                    <p style={S.statLabel}>Products</p>
                    <p style={S.statValue}>{(d.items || []).length}</p>
                  </div>
                  <div>
                    <p style={S.statLabel}>Total Qty</p>
                    <p style={S.statValue}>{totalQty.toLocaleString()}</p>
                  </div>
                </div>

                {preview && (
                  <p style={S.itemsPreview}>
                    {preview}{extraCount > 0 ? ` +${extraCount} more` : ""}
                  </p>
                )}

                {(d.requestedDate || d.refNo) && (
                  <p style={S.extras}>
                    {d.requestedDate ? `Requested: ${d.requestedDate}` : ""}
                    {d.requestedDate && d.refNo ? " · " : ""}
                    {d.refNo ? `Ref: ${d.refNo}` : ""}
                  </p>
                )}

                {confirmDeleteId === d.id ? (
                  <div style={S.confirmBar}>
                    <p style={S.confirmText}>Delete this draft?</p>
                    <div style={S.confirmActions}>
                      <button style={S.confirmYes} onClick={() => confirmDelete(d.id)}>Delete</button>
                      <button style={S.confirmNo} onClick={() => setConfirmDeleteId(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div style={S.actionsRow}>
                    <button style={S.resumeBtn} onClick={() => resumeDraft(d)}>▶ Resume</button>
                    <button style={S.deleteBtn} onClick={() => setConfirmDeleteId(d.id)}>🗑</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </EndUserLayout>
  );
}