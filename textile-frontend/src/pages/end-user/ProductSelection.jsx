// src/pages/end-user/ProductSelection.jsx
//
// End User (Field Officer) version of the "Secondary Order Portal" —
// same layout as the customer-facing ProductCatalog.jsx, plus a Select
// Customer dropdown up top (scoped to the officer's own assigned area).
// Picking a customer fills in the Customer Information header; "Sales
// Officer Name" is the officer's own name.
//
// Each table row has its own qty stepper + "Add" button that pushes into
// the persistent, per-customer cart (utils/endUserCart.js). Reviewing,
// adjusting quantities and submitting all happen on Cart Checkout
// (CartCheckout.jsx), reached via "View Cart & Submit". The selected
// customer is carried in the URL (?customerId=) so that hand-off
// survives a refresh.
//
// ── Drafts flow ──
// "💾 Save as Draft" snapshots the cart into a draft, empties this
// customer's live cart, and hands off to My Drafts. Resuming a draft
// brings the officer back here with ?customerId= and &draftId= in the
// URL; the draft's items are restored into the live cart. Saving again
// updates that same draft in place.
//
// ── CHANGE (Blouse table space + full-name hover card) ──
// 1) The Blouse split tables used equal-width columns, so short columns
//    (S.No, UOM) wasted space while Product Name got truncated. They now
//    use a <colgroup> that gives Product Name the most room.
// 2) Hovering a Product Name cell (Blouse or single table) shows a small
//    fixed-position card with the full name, so truncated names can
//    still be read. The card hides on scroll.
//
// ── CHANGE (empty-selection alerts) ──
// "+ Add" with qty 0, "Save as Draft" with an empty cart, and
// "View Cart & Submit" with an empty cart now show an alert asking the
// officer to select at least one product.
import { useEffect, useMemo, useRef, useState, useLayoutEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import EndUserLayout from "../../components/EndUserLayout";
import { useTheme } from "../../ThemeContext";
import { getG } from "../../theme";
import API from "../../services/api";
import { getCart, addToCart, subscribeToCart, clearCart, replaceCart } from "../../utils/endUserCart";
import { saveDraft, updateDraft, getDraft } from "../../utils/endUserDrafts";
import { BRAND } from "../../brand";
import SuggestInput from "../../components/SuggestInput";

const FONT = "'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const PAGE_SIZE = 100; // rows fetched + rendered per page

const TAB_COLORS = ["#1F5C99", "#2E7D32", "#6A3FA0", "#C9740B", "#0E7C86", "#B23A3A"];
const TAB_ICONS = { blouse: "👚", dhoti: "📜", uniform: "🎽", "uniform shirting": "🎽", "uniform suiting": "🧥", "premier shirting": "👔", pant: "👖", shirt: "👔", leggings: "🩳", bundle: "🧶", hank: "🧵", cone: "🧵", others: "📦" };

// Top-level "Type" -> the real SubType values that nest under it.
const TYPE_GROUPS = {
  "Blouse": ["Blouse"],
  "Dhoti": ["Dhoti", "BO Grey - Dhothies", "BO Fabric - Dhothies"],
  "Uniform Shirting": ["Uniform Shirting"],
  "Uniform Suiting": ["Uniform Suiting"],
  "Others": ["Others"], // intentionally empty - no data is loaded for this tab
};

// Counts cart LINES (not quantities) per top-level Type.
function typeCounts(cart) {
  const counts = {};
  cart.forEach((line) => {
    const subType = line.product?.SubType;
    let type = "Others";
    for (const [t, subs] of Object.entries(TYPE_GROUPS)) {
      if (subs.includes(subType)) { type = t; break; }
    }
    counts[type] = (counts[type] || 0) + 1;
  });
  return counts;
}

// Kept (unused) in case the UOM-driven quantity header comes back.
function qtyColumnLabel(uom) {
  if (uom === "Pieces") return "Pieces of Length";
  if (uom === "Meter") return "No. Of Meters";
  return "No. of Cases";
}
const DUMMY_SWATCHES = ["#8FD9A8", "#7FD1E0", "#E893C9", "#9A9AA5", "#F0A15C", "#B7A6E0"];

// Real Sort No wins; auto-generated Code is only a last-resort fallback.
function sortNoFor(product) {
  return product.SortNo || product.Code || "—";
}

const DUMMY_TYPES = ["BLD & DYED", "Bld/Dyed", "R.Blue/G.Blue", "Fiber Dyed", "YD Dyed", "YD Slub", "3.7 & 7.4", "8*137 (Box)", "Spl Maroon"];
const DUMMY_DESCRIPTIONS = [
  "Premium quality fabric, soft handfeel, colourfast dyeing.",
  "Durable weave finished for daily wear and repeated washing.",
  "Fine count yarn, smooth texture, wrinkle-resistant finish.",
  "Classic weave with rich texture and superior tensile strength.",
  "Skin-friendly finish with consistent shade across the batch.",
];
const DUMMY_SHADE_NOS = ["SH-101", "SH-102", "SH-103", "SH-104", "SH-105", "SH-106"];

function dummyType(product, i) {
  return product.Type || DUMMY_TYPES[i % DUMMY_TYPES.length];
}
function dummyDescription(product, i) {
  const real = product.Description;
  const looksLikeType = real && (real === product.Type || DUMMY_TYPES.includes(real));
  return real && !looksLikeType ? real : DUMMY_DESCRIPTIONS[i % DUMMY_DESCRIPTIONS.length];
}
function dummyShadeNo(product, i) {
  return product.ShadeNo || DUMMY_SHADE_NOS[i % DUMMY_SHADE_NOS.length];
}

const UOM_OPTIONS = [
  { value: "Pieces", label: "Pieces" },
  { value: "Meter", label: "Mtr" },
  { value: "Box", label: "Cases" },
];
const uomLabel = (value) => UOM_OPTIONS.find((o) => o.value === value)?.label || value;

// Dhoti-family SubTypes use "Border No" instead of "Shade No".
const DHOTI_SUBTYPES = new Set(["Dhoti", "dhoti", "Cotton Dhoti Grey", "cotton dhoti grey", "BO Grey - Dhothies", "Cotton Dhoti Fabric", "cotton dhoti fabric", "BO Fabric - Dhothies"]);
function isDhotiSubType(subType) {
  return DHOTI_SUBTYPES.has(subType);
}
function shadeOrBorderLabel(subType) {
  return isDhotiSubType(subType) ? "Border" : "Shade";
}

function formatDate(d) {
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).replace(/ /g, "-");
}

export default function ProductSelection() {
  const { isDark } = useTheme();
  const themeG = getG(isDark);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const user = JSON.parse(localStorage.getItem("user") || "{}");

  const [customers, setCustomers] = useState([]);
  const customerId = params.get("customerId") || "";
  const draftId = params.get("draftId") || "";
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [savingDraft, setSavingDraft] = useState(false);

  const [activeType, setActiveType] = useState("Blouse");
  const activeSubType = activeType; // Oracle feed: SubType === Type name

  // Combined Product Name search + dropdown.
  const [nameQuery, setNameQuery] = useState("");
  const [nameMenuOpen, setNameMenuOpen] = useState(false);
  const nameBoxRef = useRef(null);

  // ── Hover card that shows the full product name ──
  const [nameTip, setNameTip] = useState(null); // { text, x, y }
  const showNameTip = (e, text) => {
    if (!text) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.min(Math.max(r.left + r.width / 2, 170), window.innerWidth - 170);
    setNameTip({ text, x, y: r.bottom + 8 });
  };
  const hideNameTip = () => setNameTip(null);

  // Keeps the two Blouse split tables scrolling together.
  const leftScrollRef = useRef(null);
  const rightScrollRef = useRef(null);
  const handleSplitScroll = (which) => (e) => {
    setNameTip(null);
    const target = which === "left" ? rightScrollRef.current : leftScrollRef.current;
    if (target && target.scrollTop !== e.target.scrollTop) target.scrollTop = e.target.scrollTop;
  };

  // Secondary filter row: Sort No / Shade search + UOM dropdown.
  const [secondaryQuery, setSecondaryQuery] = useState("");
  const [uomFilter, setUomFilter] = useState("Box");

  // Per-row quantities/remarks, keyed by product RowKey.
  const [rowQty, setRowQty] = useState({});
  const [rowRemarks, setRowRemarks] = useState({});
  const [justAddedId, setJustAddedId] = useState(null);

  const [cart, setCart] = useState([]);

  const [viewportWidth, setViewportWidth] = useState(typeof window !== "undefined" ? window.innerWidth : 1200);
  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const isNarrow = viewportWidth < 1100;

  useEffect(() => {
    const role = localStorage.getItem("role");
    if (role !== "end_user") { navigate("/login"); return; }
    (async () => {
      try {
        const custRes = await API.get("/customers", { params: { source: "oracle" } });
        setCustomers(custRes.data);
      } catch {
        setError("Failed to load customers. Please refresh.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line
  }, []);

  // Keep the Cart Summary live for whichever customer is active.
  useEffect(() => {
    setCart(getCart(customerId));
    const unsub = subscribeToCart(() => setCart(getCart(customerId)));
    return unsub;
  }, [customerId]);

  // Resume-a-draft: restore the draft's items into this customer's cart.
  useEffect(() => {
    if (!draftId || !customerId) return;
    const d = getDraft(draftId);
    if (d && Array.isArray(d.items)) {
      replaceCart(customerId, d.items);
    }
    // eslint-disable-next-line
  }, [draftId, customerId]);

  // Close the combined dropdown when clicking anywhere outside it.
  useEffect(() => {
    const onClick = (e) => {
      if (nameBoxRef.current && !nameBoxRef.current.contains(e.target)) setNameMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const customer = customers.find((c) => String(c.numberid) === String(customerId)) || null;

  const setCustomerId = (id) => {
    setParams(id ? { customerId: id } : {});
  };

  // Tabs are fixed - the Oracle feed only ever returns these types.
  const typeKeys = Object.keys(TYPE_GROUPS);

  // ── Server-side paging ──
  const [page, setPage] = useState(1);
  const [totalRows, setTotalRows] = useState(0);
  const [productsLoading, setProductsLoading] = useState(false);
  const [debouncedName, setDebouncedName] = useState("");
  const [debouncedSecondary, setDebouncedSecondary] = useState("");

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedName(nameQuery.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [nameQuery]);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSecondary(secondaryQuery.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [secondaryQuery]);

  useEffect(() => {
    if (!customerId) return;
    // "Others" is a placeholder tab - never hit the server for it.
    if (activeSubType === "Others") {
      setProducts([]);
      setTotalRows(0);
      setProductsLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setProductsLoading(true);
    API.get("/products", {
      params: {
        source: "oracle",
        type: activeSubType,
        search: debouncedName,
        sort_shade: debouncedSecondary,
        page,
        per_page: PAGE_SIZE,
      },
      signal: ctrl.signal,
    })
      .then((res) => {
        setProducts(res.data.data || []);
        setTotalRows(res.data.total || 0);
        setError("");
      })
      .catch((err) => {
        if (err?.code === "ERR_CANCELED" || err?.name === "CanceledError") return;
        setError("Failed to load products. Please try again.");
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setProductsLoading(false);
      });
    return () => ctrl.abort();
  }, [customerId, activeSubType, debouncedName, debouncedSecondary, page]);

  const switchType = (t) => {
    setActiveType(t);
    setPage(1);
    setProducts([]);
    setTotalRows(0);
    setNameTip(null);
    setNameQuery(""); setDebouncedName(""); setNameMenuOpen(false);
    setSecondaryQuery(""); setDebouncedSecondary("");
  };

  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const pageOffset = (page - 1) * PAGE_SIZE;
  const goToPage = (p) => {
    setPage(Math.min(Math.max(1, p), totalPages));
    leftScrollRef.current?.scrollTo({ top: 0 });
    rightScrollRef.current?.scrollTo({ top: 0 });
  };

  // Reset both table halves to the top whenever the rendered rows change.
  useLayoutEffect(() => {
    if (leftScrollRef.current) leftScrollRef.current.scrollTop = 0;
    if (rightScrollRef.current) rightScrollRef.current.scrollTop = 0;
  }, [products]);

  // Fresh search per Type/SubType, not carried over.
  useEffect(() => {
    setNameQuery("");
    setNameMenuOpen(false);
    setSecondaryQuery("");
    // Blouse is always sold by Pieces; everything else defaults to Box.
    setUomFilter(activeSubType === "Blouse" ? "Pieces" : "Box");
  }, [activeSubType]);

  // Suggestions come from the rows already on screen (max 50).
  const suggestionNames = useMemo(() => {
    const q = nameQuery.trim().toLowerCase();
    const names = Array.from(new Set(products.map((p) => p.Name).filter(Boolean)));
    return (q ? names.filter((n) => n.toLowerCase().includes(q)) : names).slice(0, 50);
  }, [products, nameQuery]);

  // Sort No / Shade suggestions: the Sort No and Shade values of the rows
  // currently loaded (the server already narrows them as you type).
  const sortShadeOptions = useMemo(() => {
    const vals = [];
    products.forEach((p, i) => {
      if (p.SortNo) vals.push(String(p.SortNo));
      else if (p.Code) vals.push(String(p.Code));
      if (p.ShadeNo) vals.push(String(p.ShadeNo));
    });
    return Array.from(new Set(vals));
  }, [products]);

  // Filtering happens on the server - `products` is already the filtered page.
  const tableProducts = products;

  const half = Math.ceil(tableProducts.length / 2);
  const leftRows = useMemo(() => tableProducts.slice(0, half).map((p, i) => ({ p, i: pageOffset + i })), [tableProducts, half, pageOffset]);
  const rightRows = useMemo(() => tableProducts.slice(half).map((p, i) => ({ p, i: pageOffset + i + half })), [tableProducts, half, pageOffset]);

  const inCartQty = (productId) => cart.find((l) => l.key === String(productId))?.qty || 0;

  // Rows start at 0, except products already in the cart, which show
  // the quantity actually added.
  const getRowQty = (id) => (rowQty[id] !== undefined ? rowQty[id] : inCartQty(id));
  const setRowQtyFor = (product, qty) => {
    const cap = product.Quantity ?? qty;
    setRowQty((prev) => ({ ...prev, [product.RowKey]: Math.max(0, Math.min(qty, cap || qty)) }));
  };

  const getRowRemarks = (id) => rowRemarks[id] ?? "";
  const setRowRemarksFor = (id, val) => setRowRemarks((prev) => ({ ...prev, [id]: val }));

  // "+ Add": alerts if no quantity has been entered for the row.
  const addRowToCart = (product) => {
    if (!customerId) { setError("Select a customer first."); return; }
    const qty = getRowQty(product.RowKey);
    if (qty <= 0) {
      window.alert("Please select at least one product quantity.");
      return;
    }
    addToCart(customerId, { product, qty, uom: uomFilter, remarks: getRowRemarks(product.RowKey) });
    setNotice(`Added ${qty} × ${product.Name} to cart.`);
    setJustAddedId(product.RowKey);
    setTimeout(() => setJustAddedId((cur) => (cur === product.RowKey ? null : cur)), 1400);
  };

  // Wipes this customer's cart (with a confirm prompt).
  const handleClearCart = () => {
    if (!customerId || cart.length === 0) return;
    if (!window.confirm("Clear all items from this customer's cart? This can't be undone.")) return;
    clearCart(customerId);
    setRowQty({});
    setRowRemarks({});
    setNotice("Cart cleared.");
  };

  // Snapshots the cart into a draft (updating in place if resumed), then
  // empties the live cart and hands off to My Drafts.
  const handleSaveDraft = () => {
    if (!customerId) { window.alert("Please select a customer first."); return; }
    if (cart.length === 0) { window.alert("Please select at least one product."); return; }
    setError("");
    setSavingDraft(true);
    try {
      const existing = draftId ? getDraft(draftId) : null;
      if (existing) {
        updateDraft(draftId, { items: cart });
      } else {
        saveDraft({
          customerId,
          customerName: customer?.shortname,
          customerCode: customer?.numberid,
          items: cart,
        });
      }
      clearCart(customerId);
      setRowQty({});
      setRowRemarks({});
      navigate("/end-user/drafts", {
        state: { notice: "Saved as a draft. Find it any time under My Drafts." },
      });
    } finally {
      setSavingDraft(false);
    }
  };

  // "View Cart & Submit": alerts if nothing has been added to the cart.
  const handleViewCart = () => {
    if (!customerId) { window.alert("Please select a customer first."); return; }
    if (cart.length === 0) {
      window.alert("Please select at least one product.");
      return;
    }
    navigate(`/end-user/order-cart?customerId=${customerId}${draftId ? `&draftId=${draftId}` : ""}`);
  };

  const selectedCount = cart.length;
  const totalQty = cart.reduce((sum, l) => sum + l.qty, 0);

  const S = {
    pickerCard: { background: themeG.card, border: `1px solid ${themeG.border}`, borderRadius: 14, padding: "18px 22px", marginBottom: 20, boxShadow: "0 4px 16px rgba(15,33,56,0.06)" },
    pickerLabel: { fontSize: 10.5, fontWeight: 700, color: themeG.textLabel, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, display: "block" },
    pickerSelect: { width: "100%", maxWidth: 420, padding: "10px 13px", borderRadius: 9, border: `1px solid ${themeG.border}`, fontSize: 14, fontFamily: FONT, color: themeG.textMain, background: themeG.bg, outline: "none" },
    pickerDivider: { borderTop: `1px solid ${themeG.border}`, margin: "18px 0" },

    infoCard: { background: themeG.card, border: `1px solid ${themeG.border}`, padding: "18px 22px", marginBottom: 20, boxShadow: "0 4px 16px rgba(15,33,56,0.06)", borderRadius: 14 },
    infoTitle: { display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700, color: themeG.textMain, margin: "0 0 16px" },
    infoGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 16 },
    infoLabel: { fontSize: 10.5, fontWeight: 700, color: themeG.textLabel, textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 4px" },
    infoValue: { fontSize: 14, fontWeight: 700, color: themeG.textMain, margin: 0, wordBreak: "break-word", overflowWrap: "anywhere" },

    tabRow: { display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 },
    tab: (active, color) => ({
      display: "flex", alignItems: "center", gap: 8, padding: "12px 22px", borderRadius: 10,
      border: "none", cursor: "pointer", fontFamily: FONT, fontSize: 13.5, fontWeight: 700,
      background: active ? color : themeG.card, color: active ? "#fff" : themeG.textMain,
      boxShadow: active ? `0 4px 14px ${color}55` : `0 2px 8px rgba(15,33,56,0.06)`,
    }),

    subTabRow: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: -8, marginBottom: 18, paddingLeft: 4 },
    subTab: (active) => ({
      padding: "7px 16px", borderRadius: 16, border: "1.5px solid",
      cursor: "pointer", fontFamily: FONT, fontSize: 12.5, fontWeight: 600,
      background: active ? "rgba(31,92,153,0.10)" : "transparent",
      color: active ? themeG.accent : themeG.textSub,
      borderColor: active ? themeG.accent : themeG.border,
    }),

    // Combined Product Name search + dropdown
    comboWrap: { position: "relative", marginBottom: 14 },
    comboLabel: { fontSize: 11, fontWeight: 700, color: themeG.textLabel, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6, display: "block" },
    comboInput: { width: "100%", boxSizing: "border-box", padding: "11px 13px", borderRadius: 9, border: `1px solid ${themeG.border}`, fontSize: 14, fontFamily: FONT, color: themeG.textMain, background: themeG.card, outline: "none" },
    comboMenu: { position: "absolute", zIndex: 5, top: "calc(100% + 6px)", left: 0, right: 0, maxHeight: 220, overflowY: "auto", background: themeG.card, border: `1px solid ${themeG.border}`, borderRadius: 9, boxShadow: "0 8px 24px rgba(15,33,56,0.14)" },
    comboItem: { padding: "9px 14px", fontSize: 13.5, color: themeG.textMain, cursor: "pointer", fontFamily: FONT },
    comboEmpty: { padding: "10px 14px", fontSize: 12.5, color: themeG.textSub, fontStyle: "italic" },

    filterRow: { display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 },
    filterCol: { flex: "1 1 240px", minWidth: 200 },
    filterColNarrow: { flex: "0 1 160px", minWidth: 140 },
    filterLabel: { fontSize: 11, fontWeight: 700, color: themeG.textLabel, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6, display: "block" },
    filterInput: { width: "100%", boxSizing: "border-box", padding: "10px 13px", borderRadius: 9, border: `1px solid ${themeG.border}`, fontSize: 13.5, fontFamily: FONT, color: themeG.textMain, background: themeG.card, outline: "none" },
    filterSelect: { width: "100%", boxSizing: "border-box", padding: "10px 13px", borderRadius: 9, border: `1px solid ${themeG.border}`, fontSize: 13.5, fontFamily: FONT, color: themeG.textMain, background: themeG.card, outline: "none", maxWidth: 160 },

    tableCard: { background: themeG.card, border: `1px solid ${themeG.border}`, borderRadius: 14, overflow: "hidden", boxShadow: "0 4px 16px rgba(15,33,56,0.06)" },
    // alignItems: flex-start so a shorter half doesn't stretch into a blank block.
    tableSplitRow: { display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" },
    tableCardHalf: { background: themeG.card, border: `1px solid ${themeG.border}`, borderRadius: 14, overflow: "hidden", boxShadow: "0 4px 16px rgba(15,33,56,0.06)", flex: "1 1 360px", minWidth: 320 },
    tableScroll: { maxHeight: 420, overflowY: "auto", overflowX: "auto" },
    table: { width: "100%", minWidth: 1040, borderCollapse: "collapse" },
    th: { textAlign: "center", padding: "12px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#FFFFFF", background: "#1F3A63", borderBottom: `1px solid ${themeG.border}`, position: "sticky", top: 0, zIndex: 1, whiteSpace: "nowrap" },
    td: { padding: "12px 16px", fontSize: 13.5, color: themeG.textMain, borderBottom: `1px solid ${themeG.border}`, whiteSpace: "nowrap", textAlign: "center" },
    tdWrap: { padding: "12px 16px", fontSize: 13, color: themeG.textSub, borderBottom: `1px solid ${themeG.border}`, whiteSpace: "normal", width: 300, minWidth: 260, maxWidth: 340, lineHeight: 1.4, textAlign: "center" },
    swatch: (c) => ({ width: 20, height: 20, borderRadius: "50%", background: c, border: "1.5px solid rgba(0,0,0,0.14)", display: "inline-block", verticalAlign: "middle" }),
    shadeNo: { fontSize: 13, fontWeight: 400, color: themeG.textMain },

    qtyBox: { display: "flex", alignItems: "center", justifyContent: "center", gap: 6 },
    qtyBtn: { width: 32, height: 32, borderRadius: 8, border: `1px solid ${themeG.border}`, background: themeG.bg, color: themeG.textMain, fontSize: 16, fontWeight: 700, cursor: "pointer" },
    qtyInput: { width: 72, textAlign: "center", padding: "8px 6px", borderRadius: 8, border: `1px solid ${themeG.border}`, fontSize: 15, fontFamily: FONT, color: themeG.textMain, background: themeG.card, outline: "none" },
    remarksInput: { width: 110, padding: "6px 8px", borderRadius: 7, border: `1px solid ${themeG.border}`, fontSize: 12.5, fontFamily: FONT, color: themeG.textMain, background: themeG.card, outline: "none", textAlign: "center" },
    addBtn: { padding: "7px 16px", borderRadius: 8, border: "none", background: themeG.accent, color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: FONT },
    addedBtn: { padding: "7px 16px", borderRadius: 8, border: "none", background: "#16A34A", color: "#fff", fontSize: 12.5, fontWeight: 700, fontFamily: FONT },
    inCartNote: { fontSize: 10.5, color: themeG.textSub },

    // Compact variants for the Blouse split tables only.
    tableShade: { width: "100%", borderCollapse: "collapse", tableLayout: "fixed" },
    thShade: { textAlign: "center", padding: "10px 5px", fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.02em", color: "#FFFFFF", background: "#1F3A63", borderBottom: `1px solid ${themeG.border}`, position: "sticky", top: 0, zIndex: 1 },
    tdShade: { padding: "8px 5px", fontSize: 12, color: themeG.textMain, borderBottom: `1px solid ${themeG.border}`, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    tableScrollShade: { maxHeight: 380, overflowY: "auto", overflowX: "hidden" },
    qtyBoxShade: { display: "flex", alignItems: "center", justifyContent: "center", gap: 3 },
    qtyBtnShade: { width: 20, height: 20, borderRadius: 6, border: `1px solid ${themeG.border}`, background: themeG.bg, color: themeG.textMain, fontSize: 12, fontWeight: 700, cursor: "pointer", flexShrink: 0 },
    qtyInputShade: { width: 32, textAlign: "center", padding: "3px 2px", borderRadius: 6, border: `1px solid ${themeG.border}`, fontSize: 11.5, fontFamily: FONT, color: themeG.textMain, background: themeG.card, outline: "none" },
    remarksInputShade: { width: "100%", boxSizing: "border-box", padding: "4px 5px", borderRadius: 6, border: `1px solid ${themeG.border}`, fontSize: 10.5, fontFamily: FONT, color: themeG.textMain, background: themeG.card, outline: "none", textAlign: "center" },
    addBtnShade: { padding: "5px 8px", borderRadius: 6, border: "none", background: themeG.accent, color: "#fff", fontSize: 10.5, fontWeight: 700, cursor: "pointer", fontFamily: FONT, whiteSpace: "nowrap" },
    addedBtnShade: { padding: "5px 8px", borderRadius: 6, border: "none", background: "#16A34A", color: "#fff", fontSize: 10.5, fontWeight: 700, fontFamily: FONT, whiteSpace: "nowrap" },

    // Hover card showing the full product name
    nameTip: { position: "fixed", zIndex: 1000, transform: "translateX(-50%)", maxWidth: 320, padding: "10px 14px", borderRadius: 10, background: "#1F3A63", color: "#fff", fontSize: 13, fontWeight: 600, lineHeight: 1.4, boxShadow: "0 8px 24px rgba(15,33,56,0.28)", pointerEvents: "none", wordBreak: "break-word", textAlign: "center" },

    layout: { display: "block" },
    pagerRow: { display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginTop: 12, fontSize: 12.5, color: themeG.textSub },
    pagerBtns: { display: "flex", alignItems: "center", gap: 6 },
    pagerBtn: (disabled) => ({ padding: "6px 12px", borderRadius: 8, border: `1px solid ${themeG.border}`, background: themeG.card, color: themeG.textMain, fontSize: 12.5, fontWeight: 600, fontFamily: FONT, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1 }),

    // Horizontal Cart Summary (below table)
    summaryCard: { background: themeG.card, border: `1px solid ${themeG.border}`, borderRadius: 14, padding: "20px 24px", marginTop: 20, boxShadow: "0 4px 16px rgba(15,33,56,0.06)" },
    summaryHeaderRow: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
    sidebarTitle: { display: "flex", alignItems: "center", gap: 8, fontSize: 14.5, fontWeight: 700, color: themeG.textMain, margin: 0 },
    clearCartLink: { border: "none", background: "transparent", color: "#B23A3A", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: FONT, padding: 0, opacity: cart.length === 0 ? 0.4 : 1, pointerEvents: cart.length === 0 ? "none" : "auto" },

    statsRow: { display: "flex", flexWrap: "wrap", borderTop: `1px solid ${themeG.border}`, borderBottom: `1px solid ${themeG.border}`, padding: "16px 0", marginBottom: 16 },
    statBlock: { flex: "1 1 160px", padding: "0 24px", borderRight: `1px solid ${themeG.border}` },
    statBlockLast: { flex: "2 1 320px", padding: "0 24px" },
    statLabel: { fontSize: 11.5, color: themeG.textSub, fontWeight: 600 },
    statValue: { fontSize: 18, fontWeight: 700, color: themeG.textMain },

    itemsWrap: { display: "flex", flexWrap: "wrap", gap: 8, maxHeight: 96, overflowY: "auto", marginTop: 4 },
    itemChip: { display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 10px", borderRadius: 20, background: themeG.bg, border: `1px solid ${themeG.border}`, fontSize: 12, color: themeG.textMain, whiteSpace: "nowrap" },
    lineItemSub: { color: themeG.textSub, fontSize: 11 },
    emptyNote: { fontSize: 12.5, color: themeG.textSub, fontStyle: "italic" },

    categoryRow: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 9 },
    categoryChip: { display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px 3px 4px", borderRadius: 20, background: themeG.bg, border: `1px solid ${themeG.border}`, fontSize: 11, fontWeight: 600, color: themeG.textSub },
    categoryChipCount: { display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 18, height: 18, padding: "0 5px", borderRadius: 20, background: themeG.accent, color: "#fff", fontSize: 10.5, fontWeight: 700 },

    actionsRow: { display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "flex-end" },
    draftsBtn: { padding: "10px 18px", borderRadius: 9, border: `1px solid ${themeG.border}`, background: "transparent", color: themeG.textSub, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: FONT },
    saveDraftBtn: { padding: "10px 18px", borderRadius: 9, border: `1px solid ${themeG.border}`, background: themeG.card, color: themeG.textMain, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: FONT },
    viewCartBtn: { padding: "10px 22px", borderRadius: 9, border: "none", background: BRAND.green, color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: FONT },
  };

  // One of the two side-by-side Blouse tables. <colgroup> gives Product
  // Name the most room and shrinks S.No / UOM, so there's less dead space.
  const renderShadeTable = (rows, scrollRef, onScroll) => (
    <div style={S.tableCardHalf}>
      <div style={S.tableScrollShade} ref={scrollRef} onScroll={onScroll}>
        <table style={S.tableShade}>
          <colgroup>
            <col style={{ width: "6%" }} />   {/* S.No */}
            <col style={{ width: "10%" }} />  {/* Sort No */}
            <col style={{ width: "11%" }} />  {/* Shade */}
            <col style={{ width: "24%" }} />  {/* Product Name */}
            <col style={{ width: "8%" }} />   {/* UOM */}
            <col style={{ width: "16%" }} />  {/* Quantity */}
            <col style={{ width: "12%" }} />  {/* Remarks */}
            <col style={{ width: "13%" }} />  {/* Actions */}
          </colgroup>
          <thead>
            <tr>
              <th style={S.thShade}>S.No</th>
              <th style={S.thShade}>Sort No</th>
              <th style={S.thShade}>{shadeOrBorderLabel(activeSubType)}</th>
              <th style={S.thShade}>Product Name</th>
              <th style={S.thShade}>UOM</th>
              <th style={S.thShade}>Quantity</th>
              <th style={S.thShade}>Remarks</th>
              <th style={S.thShade}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, i }) => {
              const qty = getRowQty(p.RowKey);
              const already = inCartQty(p.RowKey);
              return (
                <tr key={p.RowKey}>
                  <td style={S.tdShade}>{i + 1}</td>
                  <td style={S.tdShade}>{sortNoFor(p)}</td>
                  <td style={S.tdShade}><span style={S.shadeNo}>{dummyShadeNo(p, i)}</span></td>
                  <td
                    style={{ ...S.tdShade, cursor: "default" }}
                    onMouseEnter={(e) => showNameTip(e, p.Name)}
                    onMouseLeave={hideNameTip}
                  >
                    {p.Name}
                  </td>
                  <td style={S.tdShade}>{uomLabel(uomFilter)}</td>
                  <td style={S.tdShade}>
                    <div style={S.qtyBoxShade}>
                      <button style={S.qtyBtnShade} onClick={() => setRowQtyFor(p, qty - 1)}>−</button>
                      <input
                        style={S.qtyInputShade}
                        type="number"
                        min={0}
                        max={p.Quantity ?? undefined}
                        placeholder="0"
                        value={qty === 0 ? "" : qty}
                        onChange={(e) => setRowQtyFor(p, parseInt(e.target.value, 10) || 0)}
                      />
                      <button style={S.qtyBtnShade} onClick={() => setRowQtyFor(p, qty + 1)}>+</button>
                    </div>
                  </td>
                  <td style={S.tdShade}>
                    <input
                      type="text"
                      placeholder="Remarks"
                      value={getRowRemarks(p.RowKey)}
                      onChange={(e) => setRowRemarksFor(p.RowKey, e.target.value)}
                      style={S.remarksInputShade}
                    />
                  </td>
                  <td style={S.tdShade}>
                    <button style={justAddedId === p.RowKey ? S.addedBtnShade : S.addBtnShade} onClick={() => addRowToCart(p)}>
                      {justAddedId === p.RowKey ? "✓ Added" : "+ Add"}
                    </button>
                    {already > 0 && <p style={S.inCartNote}>In cart: {already}</p>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  // Single, unsplit table — used for every Sub-type EXCEPT Blouse.
  const renderSingleTable = (rows) => (
    <div style={S.tableCard}>
      <div style={S.tableScroll} onScroll={hideNameTip}>
        <table style={{ ...S.table, width: "100%" }}>
          <thead>
            <tr>
              <th style={S.th}>S.No</th>
              <th style={S.th}>Sort No</th>
              <th style={S.th}>{shadeOrBorderLabel(activeSubType)}</th>
              <th style={S.th}>Product Name</th>
              <th style={S.th}>UOM</th>
              <th style={S.th}>Quantity</th>
              <th style={S.th}>Remarks</th>
              <th style={S.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => {
              const qty = getRowQty(p.RowKey);
              const already = inCartQty(p.RowKey);
              return (
                <tr key={p.RowKey}>
                  <td style={S.td}>{pageOffset + i + 1}</td>
                  <td style={S.td}>{sortNoFor(p)}</td>
                  <td style={S.td}><span style={S.shadeNo}>{dummyShadeNo(p, i)}</span></td>
                  <td
                    style={{ ...S.td, cursor: "default" }}
                    onMouseEnter={(e) => showNameTip(e, p.Name)}
                    onMouseLeave={hideNameTip}
                  >
                    {p.Name}
                  </td>
                  <td style={S.td}>{uomLabel(uomFilter)}</td>
                  <td style={S.td}>
                    <div style={S.qtyBox}>
                      <button style={S.qtyBtn} onClick={() => setRowQtyFor(p, qty - 1)}>−</button>
                      <input
                        style={S.qtyInput}
                        type="number"
                        min={0}
                        max={p.Quantity ?? undefined}
                        placeholder="0"
                        value={qty === 0 ? "" : qty}
                        onChange={(e) => setRowQtyFor(p, parseInt(e.target.value, 10) || 0)}
                      />
                      <button style={S.qtyBtn} onClick={() => setRowQtyFor(p, qty + 1)}>+</button>
                    </div>
                  </td>
                  <td style={S.td}>
                    <input
                      type="text"
                      placeholder="Remarks"
                      value={getRowRemarks(p.RowKey)}
                      onChange={(e) => setRowRemarksFor(p.RowKey, e.target.value)}
                      style={S.remarksInput}
                    />
                  </td>
                  <td style={S.td}>
                    <button style={justAddedId === p.RowKey ? S.addedBtn : S.addBtn} onClick={() => addRowToCart(p)}>
                      {justAddedId === p.RowKey ? "✓ Added" : "+ Add"}
                    </button>
                    {already > 0 && <p style={S.inCartNote}>Already in cart: {already}</p>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

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
      <div style={{ maxWidth: "100%", overflowX: "hidden", boxSizing: "border-box" }}>

        {/* Select Customer + Customer Information */}
        <div style={S.pickerCard}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
            <p style={{ ...S.infoTitle, margin: 0 }}>👤 Customer Information</p>
            <select style={{ ...S.pickerSelect, maxWidth: 260, padding: "8px 11px", fontSize: 13 }} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Choose a customer in your area…</option>
              {customers.map((c) => (
                <option key={c.numberid} value={c.numberid}>{c.shortname}</option>
              ))}
            </select>
          </div>

          <div style={S.infoGrid}>
            <div>
              <p style={S.infoLabel}>Customer Name</p>
              <p style={S.infoValue}>{customer?.shortname || "—"}</p>
            </div>
            <div>
              <p style={S.infoLabel}>Customer Code</p>
              <p style={S.infoValue}>{customer?.numberid || "—"}</p>
            </div>
            <div>
              <p style={S.infoLabel}>Mobile Number</p>
              <p style={S.infoValue}>{customer?.addressphonenumber || "—"}</p>
            </div>
            <div>
              <p style={S.infoLabel}>Email</p>
              <p style={S.infoValue}>{customer?.emailaddress || "—"}</p>
            </div>
            <div>
              <p style={S.infoLabel}>Tax No</p>
              <p style={S.infoValue}>{customer?.taxregistrationnumber || "—"}</p>
            </div>
            <div>
              <p style={S.infoLabel}>Area / Region</p>
              <p style={S.infoValue}>{customer?.town ? `${customer.town} — ${customer.district || ""}` : "—"}</p>
            </div>
            <div>
              <p style={S.infoLabel}>Sales Officer Name</p>
              <p style={S.infoValue}>{customerId ? (user.name || "—") : "—"}</p>
            </div>
            <div>
              <p style={S.infoLabel}>Date</p>
              <p style={S.infoValue}>{customerId ? formatDate(new Date()) : "—"}</p>
            </div>
          </div>
        </div>

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

        {!customerId ? (
          <div style={{ padding: 40, textAlign: "center", color: themeG.textSub, fontSize: 13.5, background: themeG.card, border: `1px solid ${themeG.border}`, borderRadius: 14 }}>
            Pick a customer above to start a new order enquiry for them.
          </div>
        ) : (
          <>
            {/* Type tabs (top level) */}
            {typeKeys.length > 0 && (
              <div style={S.tabRow}>
                {typeKeys.map((t, i) => (
                  <button key={t} onClick={() => switchType(t)} style={S.tab(activeType === t, TAB_COLORS[i % TAB_COLORS.length])}>
                    <span>{TAB_ICONS[t.toLowerCase()] || "🧷"}</span> {t}
                  </button>
                ))}
              </div>
            )}

            <div style={S.layout}>
              {/* Combined search/dropdown + scrollable table */}
              <div>
                <div style={S.filterRow}>
                  <div ref={nameBoxRef} style={{ ...S.filterCol, position: "relative" }}>
                    <label style={S.filterLabel}>Product Category</label>
                    <input
                      style={S.filterInput}
                      placeholder={`Search or choose a ${activeSubType || activeType} product…`}
                      value={nameQuery}
                      onFocus={() => setNameMenuOpen(true)}
                      onChange={(e) => { setNameQuery(e.target.value); setNameMenuOpen(true); }}
                    />
                    {nameMenuOpen && (
                      <div style={S.comboMenu}>
                        {suggestionNames.length === 0 ? (
                          <div style={S.comboEmpty}>No product name matches "{nameQuery}".</div>
                        ) : (
                          suggestionNames.map((n) => (
                            <div key={n} style={S.comboItem} onMouseDown={() => { setNameQuery(n); setNameMenuOpen(false); }}>
                              {n}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                  <div style={S.filterCol}>
                    <label style={S.filterLabel}>Search Sort No / Shade</label>
                    <SuggestInput
                      inputStyle={S.filterInput}
                      menuStyle={S.comboMenu}
                      itemStyle={S.comboItem}
                      placeholder="e.g. 1481…"
                      value={secondaryQuery}
                      onChange={setSecondaryQuery}
                      options={sortShadeOptions}
                    />
                  </div>
                  <div style={S.filterColNarrow}>
                    <label style={S.filterLabel}>UOM</label>
                    <select style={S.filterSelect} value={uomFilter} onChange={(e) => setUomFilter(e.target.value)}>
                      {UOM_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {productsLoading && tableProducts.length === 0 ? (
                  <div style={S.tableCard}>
                    <div style={{ padding: 30, textAlign: "center", color: themeG.textSub, fontSize: 13 }}>Loading products…</div>
                  </div>
                ) : tableProducts.length === 0 ? (
                  <div style={S.tableCard}>
                    <div style={{ padding: 30, textAlign: "center", color: themeG.textSub, fontSize: 13 }}>
                      {activeSubType === "Others" ? "No products in Others yet." : activeSubType ? `No ${activeSubType} products match the current filters.` : "No products available."}
                    </div>
                  </div>
                ) : activeSubType === "Blouse" ? (
                  <div style={S.tableSplitRow}>
                    {renderShadeTable(leftRows, leftScrollRef, handleSplitScroll("left"))}
                    {rightRows.length > 0 && renderShadeTable(rightRows, rightScrollRef, handleSplitScroll("right"))}
                  </div>
                ) : (
                  renderSingleTable(tableProducts)
                )}
                {totalRows > 0 && (
                  <div style={S.pagerRow}>
                    <span>
                      Showing {(pageOffset + 1).toLocaleString()}–{(pageOffset + products.length).toLocaleString()} of {totalRows.toLocaleString()}
                      {productsLoading ? " · Loading…" : ""}
                    </span>
                    <div style={S.pagerBtns}>
                      <button style={S.pagerBtn(page <= 1 || productsLoading)} disabled={page <= 1 || productsLoading} onClick={() => goToPage(1)}>« First</button>
                      <button style={S.pagerBtn(page <= 1 || productsLoading)} disabled={page <= 1 || productsLoading} onClick={() => goToPage(page - 1)}>‹ Prev</button>
                      <span>Page {page} / {totalPages}</span>
                      <button style={S.pagerBtn(page >= totalPages || productsLoading)} disabled={page >= totalPages || productsLoading} onClick={() => goToPage(page + 1)}>Next ›</button>
                      <button style={S.pagerBtn(page >= totalPages || productsLoading)} disabled={page >= totalPages || productsLoading} onClick={() => goToPage(totalPages)}>Last »</button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Cart Summary — horizontal, below the table */}
            <div style={S.summaryCard}>
              <div style={S.summaryHeaderRow}>
                <p style={S.sidebarTitle}>🛒 Cart Summary</p>
                <button style={S.clearCartLink} onClick={handleClearCart} disabled={cart.length === 0}>
                  🗑 Clear Cart
                </button>
              </div>

              <div style={S.statsRow}>
                <div style={S.statBlock}>
                  <p style={S.statLabel}>Total Quantity</p>
                  <p style={S.statValue}>{totalQty.toLocaleString()}</p>
                </div>
                <div style={S.statBlockLast}>
                  <p style={S.statLabel}>Selected Products</p>
                  <p style={S.statValue}>{selectedCount}</p>
                  {selectedCount > 0 && (
                    <div style={S.categoryRow}>
                      {Object.entries(typeCounts(cart)).map(([type, count]) => (
                        <span key={type} style={S.categoryChip}>
                          {type} <span style={S.categoryChipCount}>{count}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div style={S.actionsRow}>
                <button style={S.draftsBtn} onClick={() => navigate("/end-user/drafts")}>📑 My Drafts</button>
                <button style={S.saveDraftBtn} disabled={savingDraft} onClick={handleSaveDraft}>
                  {savingDraft ? "Saving…" : "💾 Save as Draft"}
                </button>
                <button style={S.viewCartBtn} onClick={handleViewCart}>
                  View Cart &amp; Submit →
                </button>
              </div>
            </div>
          </>
        )}

        {/* Full product name hover card */}
        {nameTip && (
          <div style={{ ...S.nameTip, left: nameTip.x, top: nameTip.y }}>
            {nameTip.text}
          </div>
        )}
      </div>
    </EndUserLayout>
  );
}