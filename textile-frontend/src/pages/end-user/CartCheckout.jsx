// src/pages/end-user/CartCheckout.jsx
//
// Field Officer's "View Cart & Submit" page — the end-user counterpart
// of the customer's /customer/enquiry cart page. Lives at its own route,
// /end-user/order-cart.
//
// Cart table mirrors the customer-facing Order Enquiry page
// (src/pages/OrderEnquiry.jsx): bordered Edit/Done/Remove buttons and a
// "Total Quantity" footer. Quantity is read-only until the row's Edit is
// pressed; Remove deletes the line.
//
// FLOW: "Save as Draft" writes/updates the draft, empties this customer's
// cart (clearCart), and hands off to My Drafts. "Submit Enquiry" posts the
// orders, clears the cart, and deletes the draft (if resumed from one).
//
// CHANGE IN THIS VERSION: Requested Date can't be in the past. The date
// picker has min = today (local time), submit re-checks it, and an old
// draft with a past date no longer restores that date.
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import EndUserLayout from "../../components/EndUserLayout";
import { useTheme } from "../../ThemeContext";
import { getG } from "../../theme";
import API from "../../services/api";
import { getCart, updateCartQty, removeFromCart, clearCart, subscribeToCart } from "../../utils/endUserCart";
import { saveDraft, updateDraft, deleteDraft, getDraft } from "../../utils/endUserDrafts";
import { BRAND } from "../../brand";

const FONT = "'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const DUMMY_SWATCHES = ["#8FD9A8", "#7FD1E0", "#E893C9", "#9A9AA5", "#F0A15C", "#B7A6E0"];
const DUMMY_TYPES = ["BLD & DYED", "Bld/Dyed", "R.Blue/G.Blue", "Fiber Dyed", "YD Dyed", "YD Slub", "3.7 & 7.4", "8*137 (Box)", "Spl Maroon"];
const DUMMY_SHADE_NOS = ["101", "102", "103", "104", "105", "106"];

// Dhoti-family SubTypes use "Border No" instead of "Shade No" — same
// underlying ShadeNo/Code 8 data, different business term for this one
// product family. Matches every alias used elsewhere in the project.
const DHOTI_SUBTYPES = new Set(["Dhoti", "dhoti", "Cotton Dhoti Grey", "cotton dhoti grey", "BO Grey - Dhothies", "Cotton Dhoti Fabric", "cotton dhoti fabric", "BO Fabric - Dhothies"]);
function shadeOrBorderLabel(subType) {
  return DHOTI_SUBTYPES.has(subType) ? "Border No" : "Shade No";
}

// Label-only override — the cart line still stores/sends the real "Meter"
// value everywhere, only the on-screen text is shortened.
const UOM_LABEL_OVERRIDES = { Meter: "Mtr", Box: "Cases" };
function uomLabel(value) {
  return UOM_LABEL_OVERRIDES[value] || value;
}

function dummyType(product, i) {
  return product.Type || DUMMY_TYPES[i % DUMMY_TYPES.length];
}

function dummyShadeNo(product, i) {
  const num = product.ShadeNo || DUMMY_SHADE_NOS[i % DUMMY_SHADE_NOS.length];
  return ` ${num}`;
}

function dummyDescription(product, i) {
  return ` ${dummyShadeNo(product, i)}`;
}

function formatDate(d) {
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).replace(/ /g, "-");
}

// Today as YYYY-MM-DD in LOCAL time. (toISOString() is UTC, which returns
// yesterday's date early in the morning in India.)
const todayLocalISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function CartCheckout() {
  const { isDark } = useTheme();
  const themeG = getG(isDark);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const customerId = params.get("customerId") || "";
  const draftId = params.get("draftId") || "";
  const user = JSON.parse(localStorage.getItem("user") || "{}");

  const [customer, setCustomer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cart, setCart] = useState([]);

  const [requestedDate, setRequestedDate] = useState("");
  const [refNo, setRefNo] = useState("");
  const [remarks, setRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);

  // Which cart line key is currently in "edit qty" mode (null = none)
  const [editingKey, setEditingKey] = useState(null);

  useEffect(() => {
    const role = localStorage.getItem("role");
    if (role !== "end_user") { navigate("/login"); return; }
    if (!customerId) { navigate("/end-user/product-selection"); return; }
    (async () => {
      try {
        const custRes = await API.get("/customers", { params: { source: "oracle" } });
        const found = custRes.data.find((c) => String(c.numberid) === String(customerId)) || null;
        setCustomer(found);
      } catch {
        setError("Failed to load customer details.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line
  }, [customerId]);

  useEffect(() => {
    setCart(getCart(customerId));
    const unsub = subscribeToCart(() => setCart(getCart(customerId)));
    return unsub;
  }, [customerId]);

  useEffect(() => {
    if (!draftId) return;
    const d = getDraft(draftId);
    if (!d) return;
    // An old draft may hold a date that has since passed — don't restore it.
    if (d.requestedDate && d.requestedDate >= todayLocalISO()) setRequestedDate(d.requestedDate);
    if (d.refNo) setRefNo(d.refNo);
    if (d.remarks) setRemarks(d.remarks);
  }, [draftId]);

  const totalQty = cart.reduce((sum, l) => sum + l.qty, 0);

  const setQty = (line, qty) => {
    const clamped = Math.max(0, Math.min(qty, line.product.Quantity ?? qty));
    if (clamped <= 0) {
      removeFromCart(customerId, line.key);
      setEditingKey(null);
    } else {
      updateCartQty(customerId, line.key, clamped);
    }
  };

  const buildNotes = () => {
    const parts = [];
    if (refNo.trim()) parts.push(`Ref/PO: ${refNo.trim()}`);
    if (remarks.trim()) parts.push(remarks.trim());
    return parts.join(" — ") || null;
  };

  // Saves/updates the draft, then empties this customer's live cart and
  // hands off to My Drafts.
  const handleSaveDraft = () => {
    if (cart.length === 0) { setError("Your cart is empty — nothing to save as a draft."); return; }
    setError("");
    setSavingDraft(true);
    try {
      if (draftId && getDraft(draftId)) {
        updateDraft(draftId, {
          items: cart,
          requestedDate,
          refNo,
          remarks,
        });
      } else {
        saveDraft({
          customerId,
          customerName: customer?.shortname,
          customerCode: customer?.numberid,
          items: cart,
          requestedDate,
          refNo,
          remarks,
        });
      }
      clearCart(customerId);
      navigate("/end-user/drafts", {
        state: { notice: "Saved as a draft. Find it any time under My Drafts." },
      });
    } finally {
      setSavingDraft(false);
    }
  };

  // Lines are posted in ONE request when every line comes from the Oracle
  // catalog (POST /orders/cart); otherwise one at a time so two requests
  // can't race for the same next order code (UQ_Orders_Code).
  const submitEnquiry = async () => {
    if (cart.length === 0) { setError("Your cart is empty."); return; }
    if (!requestedDate) { setError("Please pick a Requested Date."); return; }
    if (requestedDate < todayLocalISO()) { setError("Requested Date can't be in the past."); return; }
    setSubmitting(true);
    setError("");
    try {
      const notes = buildNotes();
      // One ref for the whole cart → all its products become lines of ONE ERP sale-order header.
      const cartRef = `CART-${Date.now()}-${customerId}`;
      if (cart.every((l) => l.product.RowKey)) {
        await API.post("/orders/cart", {
          oracleCustomerId: String(customerId),
          deliveryDate: requestedDate,
          notes,
          cartRef,
          items: cart.map((l) => ({
            oracleProduct: {
              id: l.product.Id,
              rowKey: l.product.RowKey,
              sortNo: l.product.SortNo,
              shadeNo: l.product.ShadeNo,
              name: l.product.Name,
            },
            qty: l.qty,
            piecesOfLength: l.piecesOfLength || undefined,
            uom: l.uom || undefined,
            remarks: l.remarks || undefined,
          })),
        }, { timeout: 180000 });
      } else {
        for (const l of cart) {
          await API.post("/orders", {
            oracleCustomerId: String(customerId),
            ...(l.product.RowKey
              ? {
                  oracleProduct: {
                    id: l.product.Id,
                    rowKey: l.product.RowKey,
                    sortNo: l.product.SortNo,
                    shadeNo: l.product.ShadeNo,
                    name: l.product.Name,
                  },
                }
              : { productId: l.product.Id }), // old cart lines only
            qty: l.qty,
            discount: 0,
            deliveryDate: requestedDate,
            notes,
            cartRef,
            piecesOfLength: l.piecesOfLength || undefined,
            uom: l.uom || undefined,
            remarks: l.remarks || undefined,
          });
        }
      }
      clearCart(customerId);
      if (draftId) deleteDraft(draftId);
      navigate("/master/orders", {
        state: { notice: `${cart.length} item(s) submitted as an enquiry for ${customer?.Name || "the customer"}.` },
      });
    } catch (err) {
      setError(err.response?.data?.message || "Failed to submit enquiry.");
    } finally {
      setSubmitting(false);
    }
  };

  const S = {
    infoCard: { background: themeG.card, border: `1px solid ${themeG.border}`, borderRadius: 14, padding: "18px 22px", marginBottom: 20, boxShadow: "0 4px 16px rgba(15,33,56,0.06)" },
    infoTitle: { display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700, color: themeG.textMain, margin: "0 0 16px" },
    infoGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 16 },
    infoLabel: { fontSize: 10.5, fontWeight: 700, color: themeG.textLabel, textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 4px" },
    infoValue: { fontSize: 14, fontWeight: 700, color: themeG.textMain, margin: 0 },

    tableCard: { background: themeG.card, border: `1px solid ${themeG.border}`, borderRadius: 14, overflow: "hidden", boxShadow: "0 4px 16px rgba(15,33,56,0.06)", marginBottom: 20 },
    tableScroll: { overflowX: "auto" },
    table: { width: "100%", minWidth: 960, borderCollapse: "collapse" },
    th: { textAlign: "center", padding: "12px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#FFFFFF", background: "#1F3A63", borderBottom: `1px solid ${themeG.border}`, whiteSpace: "nowrap" },
    td: { padding: "12px 16px", fontSize: 13.5, color: themeG.textMain, borderBottom: `1px solid ${themeG.border}`, whiteSpace: "nowrap", fontFamily: FONT, textAlign: "center" }, tdWrap: { padding: "12px 16px", fontSize: 13, color: themeG.textSub, borderBottom: `1px solid ${themeG.border}`, whiteSpace: "normal", maxWidth: 220, fontFamily: FONT, textAlign: "center", },
    swatch: (c) => ({ width: 20, height: 20, borderRadius: "50%", background: c, border: "1.5px solid rgba(0,0,0,0.14)", display: "inline-block", verticalAlign: "middle" }),
    shadeNo: { fontSize: 13, fontWeight: 600, color: themeG.textMain },

    qtyBox: { display: "flex", alignItems: "center", gap: 8 },
    qtyBtn: { width: 26, height: 26, borderRadius: 7, border: `1px solid ${themeG.border}`, background: themeG.bg, color: themeG.textMain, fontSize: 15, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" },
    qtyInput: { width: 56, textAlign: "center", padding: "5px 4px", borderRadius: 7, border: `1px solid ${themeG.border}`, fontSize: 13, fontFamily: FONT, color: themeG.textMain, background: themeG.card, outline: "none" },
    qtyReadOnly: { fontSize: 14, fontWeight: 700, color: themeG.textMain, fontFamily: FONT },

    actionsCell: { display: "flex", alignItems: "center", gap: 8, justifyContent: "center" },
    editBtn: { padding: "6px 14px", borderRadius: 7, border: `1.5px solid ${themeG.accent}`, background: isDark ? "rgba(91,155,217,0.10)" : "#fff", color: themeG.accent, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: FONT },
    doneBtn: { padding: "6px 14px", borderRadius: 7, border: "1.5px solid #16A34A", background: isDark ? "rgba(22,163,74,0.10)" : "#fff", color: "#16A34A", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: FONT },
    removeBtn: { padding: "6px 14px", borderRadius: 7, border: "1.5px solid #B23A3A", background: isDark ? "rgba(178,58,58,0.10)" : "#fff", color: "#B23A3A", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: FONT },

    totalBlock: { display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "18px 22px", background: themeG.bg },
    totalLabel: { fontSize: 13, color: themeG.textSub, textAlign: "right", margin: 0 },
    totalValue: { fontSize: 20, fontWeight: 700, color: "#1E9E5A", textAlign: "right", margin: 0 },

    detailsCard: { background: themeG.card, border: `1px solid ${themeG.border}`, borderRadius: 14, padding: 20, marginBottom: 20, boxShadow: "0 4px 16px rgba(15,33,56,0.06)" },
    detailsTitle: { fontSize: 14, fontWeight: 700, color: themeG.textMain, margin: "0 0 16px" },
    detailsGrid: { display: "grid", gridTemplateColumns: "1fr 1fr 2fr", gap: 16 },
    label: { fontSize: 11, fontWeight: 700, color: themeG.textLabel, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6, display: "block" },
    input: { width: "100%", boxSizing: "border-box", padding: "9px 13px", borderRadius: 9, border: `1px solid ${themeG.border}`, fontSize: 13.5, fontFamily: FONT, color: themeG.textMain, background: themeG.bg, outline: "none" },
    textarea: { width: "100%", boxSizing: "border-box", padding: "9px 13px", borderRadius: 9, border: `1px solid ${themeG.border}`, fontSize: 13.5, fontFamily: FONT, color: themeG.textMain, background: themeG.bg, outline: "none", resize: "vertical", minHeight: 40 },
    charCount: { fontSize: 10.5, color: themeG.textSub, textAlign: "right", marginTop: 3 },

    bottomRow: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 },
    backBtn: { padding: "10px 20px", borderRadius: 9, border: `1px solid ${themeG.border}`, background: "transparent", color: themeG.textSub, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: FONT },
    actionsRight: { display: "flex", gap: 10 },
    draftBtn: { padding: "10px 22px", borderRadius: 9, border: `1.5px solid ${themeG.accent}`, background: "rgba(91,155,217,0.08)", color: themeG.accent, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: FONT },
    finalSubmitBtn: { padding: "10px 26px", borderRadius: 9, border: "none", background: BRAND.green, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: FONT },
  };

  if (loading) {
    return (
      <EndUserLayout>
        <div style={{ padding: 40, textAlign: "center", color: themeG.textSub, fontSize: 13 }}>Loading…</div>
      </EndUserLayout>
    );
  }

  return (
    <EndUserLayout>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {error && (
        <div style={{ marginBottom: 16, background: "rgba(178,58,58,0.08)", border: "1px solid rgba(178,58,58,0.25)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#B23A3A" }}>
          {error}
        </div>
      )}
      {notice && (
        <div style={{ marginBottom: 16, background: "rgba(15,33,56,0.08)", border: "1px solid rgba(15,33,56,0.25)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: themeG.accent }}>
          {notice}
        </div>
      )}

      <div style={S.infoCard}>
        <p style={S.infoTitle}>👤 Customer Information</p>
        <div style={S.infoGrid}>
          <div><p style={S.infoLabel}>Customer Name</p><p style={S.infoValue}>{customer?.shortname || "—"}</p></div>
          <div><p style={S.infoLabel}>Customer Code</p><p style={S.infoValue}>{customer?.numberid || "—"}</p></div>
          <div> <p style={S.infoLabel}>Area / Region</p> <p style={S.infoValue}> {customer?.town ? `${customer.town} — ${customer.district || ""}` : "—"} </p> </div>
          <div><p style={S.infoLabel}>Sales Officer Name</p><p style={S.infoValue}>{user.name || "—"}</p></div>
          <div><p style={S.infoLabel}>Date</p><p style={S.infoValue}>{formatDate(new Date())}</p></div>
        </div>
      </div>

      <div style={S.tableCard}>
        {cart.length === 0 ? (
          <div style={{ padding: 30, textAlign: "center", color: themeG.textSub, fontSize: 13 }}>
            Your cart is empty. Go back to the catalog to add products.
          </div>
        ) : (
          <>
            <div style={S.tableScroll}>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>S.No</th>
                    <th style={S.th}>Sort No</th>
                    <th style={S.th}>{
                      cart.length > 0 && cart.every((l) => DHOTI_SUBTYPES.has(l.product.SubType)) ? "Border No" : "Shade"
                    }</th>
                    <th style={S.th}>Product Name</th>
                    <th style={S.th}>UOM</th>
                    <th style={S.th}>Quantity</th>
                    <th style={S.th}>Remarks</th>
                    <th style={S.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {cart.map((l, i) => {
                    const p = l.product;
                    const swatch = p.Color || DUMMY_SWATCHES[i % DUMMY_SWATCHES.length];
                    const isEditing = editingKey === l.key;
                    return (
                      <tr key={l.key}>
                        <td style={S.td}>{i + 1}</td>
                        <td style={S.td}>{p.SortNo || p.Code || "—"}</td>
                        <td style={S.td}><span style={S.shadeNo}>{dummyShadeNo(p, i)}</span></td>
                        <td style={S.tdWrap}>{p.Name || dummyDescription(p, i)}</td>
                        <td style={S.td}>{uomLabel(l.uom || "Box")}</td>
                        <td style={S.td}>
                          {isEditing ? (
                            <div style={S.qtyBox}>
                              <button style={S.qtyBtn} onClick={() => setQty(l, l.qty - 1)}>−</button>
                              <input
                                style={S.qtyInput}
                                type="number"
                                min={0}
                                max={p.Quantity ?? undefined}
                                value={l.qty}
                                onChange={(e) => setQty(l, parseInt(e.target.value, 10) || 0)}
                              />
                              <button
                                style={S.qtyBtn}
                                onClick={() => setQty(l, l.qty + 1)}
                                disabled={p.Quantity != null && l.qty >= p.Quantity}
                              >
                                +
                              </button>
                            </div>
                          ) : (
                            <span style={S.qtyReadOnly}>{l.qty}</span>
                          )}
                        </td>
                        <td style={S.td}>{l.remarks || "—"}</td>
                        <td style={S.td}>
                          <div style={S.actionsCell}>
                            {isEditing ? (
                              <button style={S.doneBtn} onClick={() => setEditingKey(null)}>
                                Done
                              </button>
                            ) : (
                              <button style={S.editBtn} onClick={() => setEditingKey(l.key)}>
                                Edit
                              </button>
                            )}
                            <button
                              style={S.removeBtn}
                              onClick={() => {
                                removeFromCart(customerId, l.key);
                                if (editingKey === l.key) setEditingKey(null);
                              }}
                            >
                              Remove
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={S.totalBlock}>
              <div>
                <p style={S.totalLabel}>Total Quantity</p>
                <p style={S.totalValue}>{totalQty.toLocaleString()}</p>
              </div>
            </div>
          </>
        )}
      </div>

      <div style={S.detailsCard}>
        <p style={S.detailsTitle}>Additional Details</p>
        <div style={S.detailsGrid}>
          <div>
            <label style={S.label}>Requested Date <span style={{ color: BRAND.red }}>*</span></label>
            <input type="date" min={todayLocalISO()} style={S.input} value={requestedDate} onChange={(e) => setRequestedDate(e.target.value)} />
          </div>
          <div>
            <label style={S.label}>Reference / PO No.</label>
            <input style={S.input} placeholder="Enter Reference / PO No." value={refNo} onChange={(e) => setRefNo(e.target.value)} />
          </div>
          <div>
            <label style={S.label}>Dispatch Instruction</label>
            <textarea
              style={S.textarea}
              placeholder="Enter any additional remarks (if any)"
              maxLength={500}
              rows={2}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
            <p style={S.charCount}>{remarks.length} / 500</p>
          </div>
        </div>
      </div>

      <div style={S.bottomRow}>
        <button style={S.backBtn} onClick={() => navigate(`/end-user/product-selection?customerId=${customerId}`)}>
          ← Back to Catalog
        </button>
        <div style={S.actionsRight}>
          <button style={S.draftBtn} disabled={savingDraft || cart.length === 0} onClick={handleSaveDraft}>
            {savingDraft ? "Saving…" : "💾 Save as Draft"}
          </button>
          <button style={S.finalSubmitBtn} disabled={submitting || cart.length === 0} onClick={submitEnquiry} data-confirm="Submit this enquiry? It will be sent to the Admin for allocation." data-confirm-title="Submit Enquiry">
            {submitting ? "Submitting…" : "📨 Submit Enquiry"}
          </button>
        </div>
      </div>
    </EndUserLayout>
  );
}