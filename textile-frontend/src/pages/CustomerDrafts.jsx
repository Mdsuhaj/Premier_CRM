// src/pages/CustomerDrafts.jsx
//
// Lists every saved Product Selection draft for this customer (there can
// be several — one per in-progress order they haven't submitted yet),
// each showing who it's for and when it was saved. "Resume" reopens
// Product Selection (not Order Enquiry — that's the review/submit step,
// not where you'd want to keep shopping) with that draft's cart loaded
// back in and its Additional Details stashed for Order Enquiry to pick
// up once the customer clicks through to it (see utils/draftSession.js);
// saving again from either page updates this same draft instead of
// creating a duplicate.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import CustomerLayout from "../components/CustomerLayout";
import { useTheme } from "../ThemeContext";
import { getG } from "../theme";
import { listDrafts, deleteDraft } from "../utils/customerDrafts";

const FONT = "'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function formatSavedAt(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) +
    " · " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export default function CustomerDrafts() {
  const { isDark } = useTheme();
  const themeG = getG(isDark);
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem("user") || "{}");

  const [drafts, setDrafts] = useState([]);

  useEffect(() => {
    const role = localStorage.getItem("role");
    if (role !== "customer") { navigate("/login"); return; }
    setDrafts(listDrafts());
    // eslint-disable-next-line
  }, []);

  const remove = (id) => {
    deleteDraft(id);
    setDrafts(listDrafts());
  };

  // Resume now goes to Product Selection, not Order Enquiry — that's
  // where a customer would actually want to keep shopping from. Order
  // Enquiry picks up this draft's Additional Details automatically once
  // the customer clicks "View Cart & Submit" from there.
  const resume = (id) => navigate(`/customer/catalog?draftId=${id}`);

  const S = {
    heading: { fontSize: 20, fontWeight: 700, color: themeG.textMain, margin: "0 0 4px", fontFamily: FONT },
    sub: { fontSize: 13, color: themeG.textSub, margin: "0 0 22px", fontFamily: FONT },
    empty: { padding: 40, textAlign: "center", color: themeG.textSub, fontSize: 13.5, background: themeG.card, border: `1px solid ${themeG.border}`, borderRadius: 14, fontFamily: FONT },
    grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 },
    card: { background: themeG.card, border: `1px solid ${themeG.border}`, borderRadius: 14, padding: 18, boxShadow: "0 4px 16px rgba(15,33,56,0.06)" },
    cardTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 },
    customerName: { fontSize: 15, fontWeight: 700, color: themeG.textMain, margin: 0, fontFamily: FONT },
    savedAt: { fontSize: 11.5, color: themeG.textSub, margin: "3px 0 0", fontFamily: FONT },
    statRow: { display: "flex", gap: 18, margin: "12px 0 16px" },
    statLabel: { fontSize: 10.5, fontWeight: 700, color: themeG.textLabel, textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 2px" },
    statValue: { fontSize: 15, fontWeight: 700, color: themeG.textMain, margin: 0 },
    itemList: { maxHeight: 130, overflowY: "auto", borderTop: `1px solid ${themeG.border}`, borderBottom: `1px solid ${themeG.border}`, padding: "8px 0", marginBottom: 12 },
    itemRow: { display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, color: themeG.textMain, padding: "3px 0" },
    itemName: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    itemCode: { color: themeG.textSub, fontSize: 11 },
    itemQty: { fontWeight: 700, flexShrink: 0 },
    note: { fontSize: 12, color: themeG.textSub, fontStyle: "italic", margin: "0 0 14px", minHeight: 16 },
    btnRow: { display: "flex", gap: 8 },
    resumeBtn: { flex: 1, padding: "9px 0", borderRadius: 9, border: "none", background: themeG.accent, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: FONT },
    deleteBtn: { padding: "9px 14px", borderRadius: 9, border: `1px solid ${themeG.border}`, background: "transparent", color: "#B23A3A", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: FONT },
  };

  return (
    <CustomerLayout>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {drafts.length === 0 ? (
        <div style={S.empty}>No drafts saved yet. Save one from Product Selection and it'll show up here.</div>
      ) : (
        <div style={S.grid}>
          {drafts.map((d) => {
            const itemList = d.items || []; // older drafts saved before this existed just won't have the list
            const itemCount = itemList.length || Object.keys(d.cart || {}).length;
            const totalQty = itemList.length
              ? itemList.reduce((sum, it) => sum + (Number(it.qty) || 0), 0)
              : Object.values(d.cart || {}).reduce((sum, q) => sum + (Number(q) || 0), 0);
            return (
              <div key={d.id} style={S.card}>
                <div style={S.cardTop}>
                  <div>
                    <p style={S.customerName}>{d.customerName || user.name || "Customer"}</p>
                    <p style={S.savedAt}>Saved {formatSavedAt(d.savedAt)}</p>
                  </div>
                </div>

                <div style={S.statRow}>
                  <div>
                    <p style={S.statLabel}>Products</p>
                    <p style={S.statValue}>{itemCount}</p>
                  </div>
                  <div>
                    <p style={S.statLabel}>Total Qty</p>
                    <p style={S.statValue}>{totalQty}</p>
                  </div>
                </div>

                {itemList.length > 0 ? (
                  <div style={S.itemList}>
                    {itemList.map((it) => (
                      <div key={it.productId} style={S.itemRow}>
                        <span style={S.itemName}>{it.name} <span style={S.itemCode}>({it.code})</span></span>
                        <span style={S.itemQty}>{it.qty}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={S.note}>Saved before item details were tracked — resume to see the cart.</p>
                )}

                <p style={S.note}>{d.refNo ? `Ref/PO: ${d.refNo}` : ""}</p>

                <div style={S.btnRow}>
                  <button style={S.resumeBtn} onClick={() => resume(d.id)}>Resume</button>
                  <button style={S.deleteBtn} onClick={() => remove(d.id)}>🗑</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </CustomerLayout>
  );
}