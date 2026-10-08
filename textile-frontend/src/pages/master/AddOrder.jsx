import { useTheme } from "../../ThemeContext";
import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Layout from "../../components/AppLayout";
import { getG, G } from "../../theme";
import API from "../../services/api";
import { SALE_LOSS_PATH, REJECT_PATH, isSaleLossStatus, isRejectedStatus } from "../../utils/orderStatus";

const getThemeColors = () => getG(localStorage.getItem("premier_theme") === "dark");

// Local (not UTC) yyyy-mm-dd, so "today" is right for IST users too.
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// ─── Shared primitives ────────────────────────────────────────────────────────
const Field = ({ label, required, full, children }) => {
  const { isDark } = useTheme();
  return (
    <div style={{ marginBottom: 4, gridColumn: full ? "1 / -1" : undefined, minWidth: 0 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: getG(isDark).textLabel, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
        {label}{required && <span style={{ color: "#B23A3A", marginLeft: 3 }}>*</span>}
      </label>
      {children}
    </div>
  );
};

// Read-only display used when a box is locked (not in Edit mode).
const ReadField = ({ label, value, full }) => (
  <Field label={label} full={full}>
    <div style={{ width: "100%", boxSizing: "border-box", padding: "9px 13px", borderRadius: 9, border: "1px solid rgba(15,33,56,0.10)", fontSize: 14, color: "#0F2138", background: "#F5F7FA", minHeight: 38, display: "flex", alignItems: "center" }}>
      {value === "" || value === null || value === undefined ? "—" : value}
    </div>
  </Field>
);

const Input = (props) => (
  <input {...props} style={{ width: "100%", padding: "9px 13px", borderRadius: 9, border: `1px solid ${"rgba(15,33,56,0.18)"}`, fontSize: 14, fontFamily: "inherit", color: "#0F2138", background: "#fff", outline: "none", boxSizing: "border-box" }} />
);

const Select = ({ children, ...props }) => (
  <select {...props} style={{ width: "100%", padding: "9px 13px", borderRadius: 9, border: `1px solid ${"rgba(15,33,56,0.18)"}`, fontSize: 14, fontFamily: "inherit", color: "#0F2138", background: "#fff", outline: "none", boxSizing: "border-box" }}>
    {children}
  </select>
);

// ─── Embedded Product Picker constants (mirrors ProductSelection.jsx) ─────────
const TAB_COLORS = ["#1F5C99", "#2E7D32", "#6A3FA0", "#C9740B", "#0E7C86", "#B23A3A"];
const TAB_ICONS = { blouse: "👚", dhoti: "📜", uniform: "🎽", "uniform shirting": "🎽", "uniform suiting": "🧥", "premier shirting": "👔", pant: "👖", shirt: "👔", leggings: "🩳", bundle: "🧶", hank: "🧵", cone: "🧵", others: "📦" };

const TYPE_GROUPS = {
  "Blouse": ["Blouse"],
  "Dhoti": ["Dhoti", "BO Grey - Dhothies", "BO Fabric - Dhothies"],
  "Uniform Shirting": ["Uniform Shirting"],
  "Uniform Suiting": ["Uniform Suiting"],
};

function dummyUom(subType) {
  const u = (subType || "").toLowerCase();
  if (u.includes("shirting") || u.includes("suiting") || u.includes("blouse")) return "m";
  return "pcs";
}
const DUMMY_SWATCHES = ["#8FD9A8", "#7FD1E0", "#E893C9", "#9A9AA5", "#F0A15C", "#B7A6E0"];
const DUMMY_TYPES = ["BLD & DYED", "Bld/Dyed", "R.Blue/G.Blue", "Fiber Dyed", "YD Dyed", "YD Slub", "3.7 & 7.4", "8*137 (Box)", "Spl Maroon"];
const DUMMY_SHADE_NOS = ["101", "102", "103", "104", "105", "106"];

function dummyType(product, i) {
  return product.Description || DUMMY_TYPES[i % DUMMY_TYPES.length];
}
function dummyShadeNo(product, i) {
  const num = product.ShadeNo || DUMMY_SHADE_NOS[i % DUMMY_SHADE_NOS.length];
  return `SHADE ${num}`;
}
function dummyDescription(product, i) {
  return `SHADING FABRIC ${dummyShadeNo(product, i)}`;
}

// Meta keys tucked into OrderDetails alongside the real spec fields —
// stripped out before treating the rest as an item's saved spec answers.
const META_DETAIL_KEYS = ["GroupRef", "EnquiryOrderNo", "EnquiryOrderDate"];

function sortNoFor(product) {
  return product?.SortNo || product?.Code || "—";
}

function shadeNoFor(product) {
  return product?.ShadeNo || "SHADE101" || "—";
}

// Real UOM the customer/officer actually picked when placing this line —
// stored in OrderDetails.UOM. Falls back to the product master's UOM.
function uomFor(item, product) {
  return item?.details?.UOM || item?.details?.uom || product?.UOM || null;
}

const UOM_LABEL_OVERRIDES = { Meter: "Mtr", Box: "Cases" };
function uomLabel(value) {
  return UOM_LABEL_OVERRIDES[value] || value;
}

// Builds the OrderDetails object that is saved for one line.
// Requested Mtr, Allocated Qty and Allocated Mtr all ride along in
// OrderDetails (no dedicated columns).
function buildOrderDetails(item, groupRef, form) {
  const orderDetails = { ...(item.details || {}) };

  if (item.reqMtr) orderDetails.ReqMtr = item.reqMtr;
  else delete orderDetails.ReqMtr;

  if (item.allocQty !== "" && item.allocQty != null) orderDetails.AllocQty = item.allocQty;
  else delete orderDetails.AllocQty;

  if (item.allocMtr !== "" && item.allocMtr != null) orderDetails.AllocMtr = item.allocMtr;
  else delete orderDetails.AllocMtr;

  if (groupRef) orderDetails.GroupRef = groupRef;
  if (form.enquiryOrderNo) orderDetails.EnquiryOrderNo = form.enquiryOrderNo;
  if (form.enquiryOrderDate) orderDetails.EnquiryOrderDate = form.enquiryOrderDate;
  return orderDetails;
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function AddOrder() {
  const { isDark } = useTheme();
  const themeG = getG(isDark);

  const card = { background: themeG.card, border: `1px solid ${themeG.border}`, borderRadius: 14, padding: 20, boxShadow: "0 4px 16px rgba(46,122,114,0.05)", minWidth: 0, width: "100%", boxSizing: "border-box" };
  const cardTitle = { fontFamily: "'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", fontSize: 15, fontWeight: 700, margin: "0 0 14px", color: themeG.textMain };

  const navigate = useNavigate();
  const role = localStorage.getItem("role") || "";
  const [searchParams] = useSearchParams();
  const fromEnquiry = searchParams.get("fromEnquiry");
  const prefillCustomerId = searchParams.get("customerId");
  const prefillProductId = searchParams.get("productId");
  const editId = searchParams.get("editId");
  // 👁️ appends &mode=view — every Edit affordance is hidden.
  const viewOnly = !!(editId && searchParams.get("mode") === "view");
  const isNewOrder = !editId && !fromEnquiry;

  const getStoredCat = () => localStorage.getItem("premier_category") || "cloth";
  const [tab, setTab] = useState(getStoredCat);
  const [subType, setSubType] = useState(() => getStoredCat() === "yarn" ? "bundle" : "dhoti");
  const [form, setForm] = useState({ customerId: "", productId: "", qty: "", pricePerUnit: "", deliveryDate: "", notes: "", discount: "", itemDiscount: "", enquiryOrderNo: "", enquiryOrderDate: "" });
  const [draftDetails, setDraftDetails] = useState(null);

  // The delivery date the order had when it was loaded. Old orders may
  // already carry a past date; we only reject a past date the user has
  // CHANGED it to, so those orders can still be updated.
  const [originalDeliveryDate, setOriginalDeliveryDate] = useState("");

  const [items, setItems] = useState([]);
  const [removedItemIds, setRemovedItemIds] = useState([]);
  const [existingGroupRef, setExistingGroupRef] = useState(null);
  // Which row (by tempId) is in Edit mode. Only that row shows the
  // Allocated Qty / Allocated Mtr inputs; every other row is read-only.
  const [editingQtyId, setEditingQtyId] = useState(null);

  // Allocation stage of the order being edited (null until loaded).
  // Same stage names as OrderList.jsx: pending_allocation | partial_allocation |
  // fully_allocated | approved | erp_transfer
  const [allocStage, setAllocStage] = useState(null);
  // Products ticked (checkbox before S.No) to send to Sale Loss / Reject.
  const [selectedIds, setSelectedIds] = useState([]);

  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editPayment, setEditPayment] = useState(!fromEnquiry && !editId);

  useEffect(() => {
    if (viewOnly) setEditPayment(false);
    // eslint-disable-next-line
  }, [viewOnly]);

  // ── Embedded Product Picker state (new manual orders only) ──
  const [pickerType, setPickerType] = useState("");
  const [pickerSubType, setPickerSubType] = useState("");
  const [pickerNameQuery, setPickerNameQuery] = useState("");
  const [pickerNameMenuOpen, setPickerNameMenuOpen] = useState(false);
  const pickerNameBoxRef = useRef(null);
  const [pickerSecondaryQuery, setPickerSecondaryQuery] = useState("");
  const [pickerUomFilter, setPickerUomFilter] = useState("All");
  const [pickerRowQty, setPickerRowQty] = useState({});
  const [pickerJustAddedId, setPickerJustAddedId] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [custRes, prodRes] = await Promise.all([API.get("/customers"), API.get("/products")]);
        setCustomers(custRes.data);
        setProducts(prodRes.data);

        if (editId) {
          try {
            const orderRes = await API.get(`/orders/${editId}`);
            const orderData = orderRes.data;
            const groupRef = orderData.OrderDetails?.GroupRef || null;
            setExistingGroupRef(groupRef);

            // ── Allocation data (same sources as OrderList.jsx / Batches.jsx) ──
            // End User  -> AllocationSummary on GET /orders (they can't read the board)
            // Admin     -> /allocations/board (real allocation / approval / ERP data)
            const isEndUserRole = role === "end_user";
            const allocByOrderId = {};
            let listRows = [];
            try {
              const listParams = isEndUserRole
                ? { scope: "own", with_allocation: 1 }
                : role === "admin" ? { scope: "own_and_team" } : {};
              const allRes = await API.get("/orders", { params: listParams });
              listRows = allRes.data || [];
              listRows.forEach((o) => {
                if (o.AllocationSummary) allocByOrderId[o.Id] = { ...o.AllocationSummary, orderedQty: o.Quantity };
              });
            } catch { /* fall back to whatever we have */ }

            if (!isEndUserRole) {
              try {
                const boardRes = await API.get("/allocations/board");
                (boardRes.data?.products || []).forEach((p) => {
                  (p.customers || []).forEach((c) => { if (c.orderId) allocByOrderId[c.orderId] = c; });
                });
              } catch { /* board unavailable → keep the summary data */ }
            }

            let groupRows = [orderData];
            if (groupRef) {
              // Only show the products in the SAME state as the one opened:
              // opened from Sale Loss -> only its sale-loss products,
              // opened from Reject -> only rejected ones,
              // opened from Order List -> only the still-open ones.
              const kindOf = (st) => (isSaleLossStatus(st) ? "sale_loss" : isRejectedStatus(st) ? "rejected" : "open");
              const myKind = kindOf(orderData.Status);
              const siblings = listRows.filter(
                (o) => o.OrderDetails?.GroupRef === groupRef && kindOf(o.Status) === myKind
              );
              if (siblings.length > 0) groupRows = siblings;
            }

            // ── Allocation stage (same rule as OrderList.jsx computeStage) ──
            let ordered = 0, allocated = 0, allApproved = true, allErp = true;
            groupRows.forEach((o) => {
              const a = allocByOrderId[o.Id];
              ordered += a ? (parseFloat(a.orderedQty) || 0) : (parseFloat(o.Quantity) || 0);
              const usable = a && a.status !== "rejected";
              const saved = usable ? (parseFloat(a.allocatedQty) || 0) : 0;
              allocated += saved;
              if (!(usable && saved > 0 && a.status === "approved")) allApproved = false;
              if (!(usable && saved > 0 && a.erpStatus === "erp_so_created")) allErp = false;
            });
            setAllocStage(
              allocated <= 0 ? "pending_allocation"
                : allocated < ordered ? "partial_allocation"
                  : allErp ? "erp_transfer"
                    : allApproved ? "approved"
                      : "fully_allocated"
            );

            const builtItems = groupRows.map((o) => {
              const productId = o.ProductId ?? o.product?.Id ?? o.Product ?? "";
              const product = o.product || prodRes.data.find((p) => String(p.Id) === String(productId));
              const rawDetails = { ...(o.OrderDetails || {}) };
              META_DETAIL_KEYS.forEach((k) => delete rawDetails[k]);

              // Real allocation counts only when something is actually allocated
              const a = allocByOrderId[o.Id];
              const hasReal = !!a && a.status !== "rejected" && (parseFloat(a.allocatedQty) || 0) > 0;
              const realQty = hasReal ? a.allocatedQty : "";
              const realMtr = hasReal ? (a.meters ?? "") : "";

              return {
                tempId: `existing-${o.Id}`,
                dbId: o.Id,
                category: o.Category,
                subType: o.SubType,
                productId,
                productLabel: product ? `${product.Name} (${product.Code})` : `Product #${productId}`,
                qty: o.Quantity,
                pricePerUnit: o.PricePerUnit,
                discount: o.DiscountPct || 0,
                remarks: rawDetails.Remarks || rawDetails.remarks || "",
                reqMtr: rawDetails.ReqMtr || "",
                // Real allocation wins; OrderDetails is only a fallback
                allocQty: hasReal ? realQty : (rawDetails.AllocQty ?? ""),
                allocMtr: hasReal ? realMtr : (rawDetails.AllocMtr ?? ""),
                // Remember the loaded values so we only send changes on save
                origAllocQty: hasReal ? String(realQty) : "",
                origAllocMtr: hasReal ? String(realMtr) : "",
                allocMeta: { cdFlag: a?.cdFlag ? 1 : 0, priceListCode: a?.priceListCode || null },
                details: Object.keys(rawDetails).length ? rawDetails : null,
              };
            });
            setItems(builtItems);

            const first = groupRows[0];
            localStorage.setItem("premier_category", first.Category);
            setTab(first.Category);
            setSubType(first.SubType);

            const loadedDelivery = first.DeliveryDate ? first.DeliveryDate.substring(0, 10) : "";
            setOriginalDeliveryDate(loadedDelivery);

            setForm((f) => ({
              ...f,
              customerId: first.CustomerId ?? first.customer?.Id ?? "",
              productId: "",
              qty: "",
              pricePerUnit: "",
              itemDiscount: "",
              deliveryDate: loadedDelivery,
              notes: first.Notes || "",
              enquiryOrderNo: first.OrderDetails?.EnquiryOrderNo || first.Code || "",
              enquiryOrderDate: first.OrderDetails?.EnquiryOrderDate || (first.CreatedAt ? first.CreatedAt.substring(0, 10) : ""),
            }));
          } catch {
            setError("Failed to load this order.");
          }
        } else if (fromEnquiry && prefillProductId) {
          const p = prodRes.data.find((pr) => String(pr.Id) === String(prefillProductId));

          let enquiryCode = "", enquiryQty = "", enquiryPrice = p ? p.Price : "", enquiryDiscount = "";
          let enquiryDetails = null, enquiryDeliveryDate = "", enquiryNotes = "";
          try {
            const enqRes = await API.get(`/orders/${fromEnquiry}`);
            enquiryCode = enqRes.data?.Code || "";
            if (enqRes.data?.Quantity != null) enquiryQty = enqRes.data.Quantity;
            if (enqRes.data?.PricePerUnit != null) enquiryPrice = enqRes.data.PricePerUnit;
            if (enqRes.data?.DiscountPct != null) enquiryDiscount = enqRes.data.DiscountPct;
            if (enqRes.data?.OrderDetails) enquiryDetails = enqRes.data.OrderDetails;
            if (enqRes.data?.DeliveryDate) enquiryDeliveryDate = enqRes.data.DeliveryDate;
            if (enqRes.data?.Notes) enquiryNotes = enqRes.data.Notes;
          } catch { /* fall through to auto-generated code below */ }
          if (!enquiryCode) enquiryCode = `ENQ-${String(fromEnquiry).padStart(4, "0")}`;
          const today = new Date().toISOString().substring(0, 10);

          if (p) {
            localStorage.setItem("premier_category", p.Category);
            setTab(p.Category);
            setSubType(p.SubType);
          }
          setDraftDetails(enquiryDetails || null);
          // The enquiry's delivery date is the "original" one — don't block
          // it just because it has since passed; only a NEW past date.
          setOriginalDeliveryDate(enquiryDeliveryDate ? String(enquiryDeliveryDate).substring(0, 10) : "");

          setForm((f) => ({
            ...f,
            customerId: prefillCustomerId || "",
            productId: prefillProductId || "",
            qty: enquiryQty || f.qty,
            pricePerUnit: enquiryPrice || f.pricePerUnit,
            itemDiscount: enquiryDiscount || f.itemDiscount,
            deliveryDate: enquiryDeliveryDate ? String(enquiryDeliveryDate).substring(0, 10) : f.deliveryDate,
            notes: enquiryNotes || f.notes,
            enquiryOrderNo: enquiryCode,
            enquiryOrderDate: today,
          }));
        } else {
          const today = new Date().toISOString().substring(0, 10);
          setForm((f) => ({
            ...f,
            enquiryOrderNo: `ENQ-${Date.now().toString().slice(-6)}`,
            enquiryOrderDate: today,
          }));
        }
      } catch {
        setError("Failed to load customers/products.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line
  }, []);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const buildDraftItem = () => {
    if (!form.productId || !form.qty || !form.pricePerUnit) return null;
    const product = products.find((pr) => String(pr.Id) === String(form.productId));
    return {
      tempId: `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      dbId: undefined,
      category: tab,
      subType,
      productId: form.productId,
      productLabel: product ? `${product.Name} (${product.Code})` : `Product #${form.productId}`,
      qty: form.qty,
      pricePerUnit: form.pricePerUnit,
      discount: form.itemDiscount || 0,
      reqMtr: "",
      allocQty: "",
      allocMtr: "",
      details: draftDetails ? { ...draftDetails } : null,
    };
  };

  const handleRemoveItem = (tempId) => {
    setItems((prev) => {
      const target = prev.find((i) => i.tempId === tempId);
      if (target?.dbId) setRemovedItemIds((r) => [...r, target.dbId]);
      return prev.filter((i) => i.tempId !== tempId);
    });
  };

  // ── Embedded Product Picker — grouping / search / add ──
  const categoryProducts = useMemo(() => products.filter((p) => p.Category === tab), [products, tab]);

  const pickerSubTypes = useMemo(
    () => Array.from(new Set(categoryProducts.map((p) => p.SubType).filter(Boolean))),
    [categoryProducts]
  );

  const pickerGrouped = useMemo(() => {
    const covered = new Set();
    const groups = {};
    for (const [type, subs] of Object.entries(TYPE_GROUPS)) {
      const present = subs.filter((s) => pickerSubTypes.includes(s));
      present.forEach((s) => covered.add(s));
      if (present.length > 0) groups[type] = present;
    }
    const leftover = pickerSubTypes.filter((s) => !covered.has(s));
    if (leftover.length > 0) groups["Others"] = leftover.sort();
    return groups;
  }, [pickerSubTypes]);

  const pickerTypeKeys = Object.keys(pickerGrouped);
  const pickerSubTypesForActiveType = pickerGrouped[pickerType] || [];

  useEffect(() => {
    if (isNewOrder && !pickerType && pickerTypeKeys.length > 0) setPickerType(pickerTypeKeys[0]);
    // eslint-disable-next-line
  }, [isNewOrder, pickerTypeKeys, pickerType]);

  useEffect(() => {
    if (pickerSubTypesForActiveType.length > 0 && !pickerSubTypesForActiveType.includes(pickerSubType)) {
      setPickerSubType(pickerSubTypesForActiveType[0]);
    }
    // eslint-disable-next-line
  }, [pickerType, pickerSubTypesForActiveType]);

  useEffect(() => {
    setPickerNameQuery("");
    setPickerNameMenuOpen(false);
    setPickerSecondaryQuery("");
    setPickerUomFilter("All");
  }, [pickerSubType]);

  useEffect(() => {
    const onClick = (e) => {
      if (pickerNameBoxRef.current && !pickerNameBoxRef.current.contains(e.target)) setPickerNameMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const pickerNamesInSubType = useMemo(() => {
    const names = categoryProducts.filter((p) => p.SubType === pickerSubType).map((p) => p.Name);
    return Array.from(new Set(names)).sort();
  }, [categoryProducts, pickerSubType]);

  const pickerSuggestionNames = useMemo(() => {
    const q = pickerNameQuery.trim().toLowerCase();
    if (!q) return pickerNamesInSubType;
    return pickerNamesInSubType.filter((n) => n.toLowerCase().includes(q));
  }, [pickerNamesInSubType, pickerNameQuery]);

  const pickerTableProducts = useMemo(() => {
    const q = pickerNameQuery.trim().toLowerCase();
    const sq = pickerSecondaryQuery.trim().toLowerCase();
    return categoryProducts
      .filter((p) => p.SubType === pickerSubType)
      .filter((p) => !q || p.Name.toLowerCase().includes(q))
      .filter((p, i) => {
        if (!sq) return true;
        const sortNoVal = String(sortNoFor(p) ?? "").toLowerCase();
        const desc = dummyDescription(p, i).toLowerCase();
        return sortNoVal.includes(sq) || desc.includes(sq);
      })
      .filter((p) => pickerUomFilter === "All" || dummyUom(p.SubType) === pickerUomFilter);
  }, [categoryProducts, pickerSubType, pickerNameQuery, pickerSecondaryQuery, pickerUomFilter]);

  const inOrderQty = (productId) => items.find((i) => String(i.productId) === String(productId))?.qty || 0;
  const getPickerRowQty = (id) => (pickerRowQty[id] !== undefined ? pickerRowQty[id] : inOrderQty(id));
  const setPickerRowQtyFor = (product, qty) => {
    const cap = product.Quantity ?? qty;
    setPickerRowQty((prev) => ({ ...prev, [product.Id]: Math.max(0, Math.min(qty, cap || qty)) }));
  };

  const handlePickerAdd = (product) => {
    const qty = getPickerRowQty(product.Id);
    if (qty <= 0) return;
    setItems((prev) => {
      const existingIdx = prev.findIndex((i) => String(i.productId) === String(product.Id));
      if (existingIdx >= 0) {
        const next = [...prev];
        next[existingIdx] = { ...next[existingIdx], qty };
        return next;
      }
      return [...prev, {
        tempId: `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        dbId: undefined,
        category: tab,
        subType: pickerSubType,
        productId: product.Id,
        productLabel: `${product.Name} (${product.Code})`,
        qty,
        pricePerUnit: product.Price || 0,
        discount: 0,
        reqMtr: "",
        allocQty: "",
        allocMtr: "",
        details: null,
      }];
    });
    setPickerJustAddedId(product.Id);
    setTimeout(() => setPickerJustAddedId((cur) => (cur === product.Id ? null : cur)), 1400);
  };

  const handleSubmit = async () => {
    if (viewOnly) return;
    setError("");
    if (!form.customerId) {
      setError("Please select a customer.");
      return;
    }

    // Past delivery dates are blocked. The `min` on the input only greys
    // out the picker (typing by hand can bypass it), so check here too —
    // but let an untouched, already-past date on an existing order through.
    if (form.deliveryDate && form.deliveryDate < todayStr() && form.deliveryDate !== originalDeliveryDate) {
      setError("Expected Delivery Date cannot be in the past.");
      return;
    }

    const draftItem = buildDraftItem();
    const finalItems = draftItem ? [...items, draftItem] : items;

    if (finalItems.length === 0) {
      setError("This order has no products on it yet — select products above first.");
      return;
    }

    setSaving(true);
    try {
      if (editId) {
        const groupRef = existingGroupRef || (finalItems.length > 1 ? `GRP-${Date.now()}` : null);

        for (const id of removedItemIds) {
          await API.delete(`/orders/${id}`);
        }

        for (const item of finalItems) {
          const orderDetails = buildOrderDetails(item, groupRef, form);

          const payload = {
            customerId: form.customerId,
            productId: item.productId,
            qty: item.qty,
            pricePerUnit: item.pricePerUnit,
            discount: item.discount || 0,
            deliveryDate: form.deliveryDate || null,
            notes: form.notes || null,
            orderDetails: Object.keys(orderDetails).length ? orderDetails : null,
          };

          if (item.dbId) {
            await API.put(`/orders/${item.dbId}`, payload);

            // Admin: push a changed Allocated Qty / Mtr to the real allocation
            // (same endpoint Batches.jsx uses), so Marketing Review stays in sync.
            const newQty = Number(item.allocQty) || 0;
            const changed =
              String(item.allocQty ?? "") !== String(item.origAllocQty ?? "") ||
              String(item.allocMtr ?? "") !== String(item.origAllocMtr ?? "");
            if (role === "admin" && newQty > 0 && changed) {
              if (newQty > Number(item.qty)) {
                throw { response: { data: { message: `Allocated Qty (${newQty}) cannot be more than Requested Qty (${item.qty}).` } } };
              }
              await API.post("/allocations", {
                productId: item.productId,
                allocations: [{
                  orderId: item.dbId,
                  customerId: form.customerId,
                  allocatedQty: newQty,
                  meters: item.allocMtr || "",
                  cdFlag: item.allocMeta?.cdFlag ?? 0,
                  priceListCode: item.allocMeta?.priceListCode ?? null,
                }],
              });
            }
          } else {
            await API.post("/orders", payload);
          }
        }
      } else {
        const groupRef = finalItems.length > 1 ? `GRP-${Date.now()}` : null;

        let first = true;
        for (const item of finalItems) {
          const orderDetails = buildOrderDetails(item, groupRef, form);

          if (fromEnquiry && first) {
            // O2C Step 4 — only the Marketing Head (system_admin) gives the
            // final approval; otherwise the order stays "assigned".
            await API.put(`/orders/${fromEnquiry}`, {
              qty: item.qty,
              pricePerUnit: item.pricePerUnit,
              discount: item.discount || 0,
              deliveryDate: form.deliveryDate || null,
              notes: form.notes || null,
              status: role === "system_admin" ? "approved" : "assigned",
              orderDetails: Object.keys(orderDetails).length ? orderDetails : null,
            });
          } else {
            await API.post("/orders", {
              customerId: form.customerId,
              productId: item.productId,
              qty: item.qty,
              pricePerUnit: item.pricePerUnit,
              discount: item.discount || 0,
              deliveryDate: form.deliveryDate || null,
              notes: form.notes || null,
              orderDetails: Object.keys(orderDetails).length ? orderDetails : null,
            });
          }
          first = false;
        }
      }

      navigate("/master/orders");
    } catch (err) {
      setError(err.response?.data?.message || "Failed to save order.");
    } finally {
      setSaving(false);
    }
  };

  // Sale Loss / Reject (edit mode only, and only while the order is still
  // Pending / Partial Allocation — see canCloseOrder below).
  // Asks for a reason, then calls /orders/close ONCE for all lines of the
  // order, and opens the matching page.
  //   kind = "sale_loss" -> Sale Loss page   |   "rejected" -> Reject page
  const markOrder = async (kind) => {
    const isLoss = kind === "sale_loss";
    const pickedIds = items.filter((i) => i.dbId && selectedIds.includes(i.dbId)).map((i) => i.dbId);
    if (pickedIds.length === 0) {
      setError(`Tick at least one product (checkbox before S.No) to send it to ${isLoss ? "Sale Loss" : "Reject"}.`);
      return;
    }
    const countText = `${pickedIds.length} product${pickedIds.length === 1 ? "" : "s"}`;
    const reason = window.prompt(isLoss ? `Reason for Sale Loss? (${countText})` : `Reason for rejecting? (${countText})`);
    if (reason === null) return; // cancelled
    if (!reason.trim()) {
      setError("Please enter a reason.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await API.patch("/orders/close", {
        kind,
        reason: reason.trim(),
        ids: pickedIds,
      });
      navigate(isLoss ? SALE_LOSS_PATH : REJECT_PATH);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to update order.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Layout pageTitle={viewOnly ? "View Order" : editId ? "Edit Order" : "Add Order"}>
        <p style={{ color: themeG.textSub }}>Loading customers and products…</p>
      </Layout>
    );
  }

  const tdBase = { padding: "11px 12px", fontSize: 13, borderBottom: `1px solid ${themeG.border}`, textAlign: "center" };
  const editInputStyle = { padding: "5px 6px", textAlign: "center", borderRadius: 7, border: `1px solid ${themeG.border}`, fontSize: 13, fontFamily: "inherit", color: themeG.textMain, background: themeG.card, outline: "none", boxSizing: "border-box" };

  // Sale Loss / Reject are allowed only before the order is fully allocated
  // (Pending Allocation or Partial Allocation). Hidden for Fully Allocated,
  // Approved and ERP Transfer.
  const canCloseOrder = allocStage === "pending_allocation" || allocStage === "partial_allocation";

  // Checkbox column (before S.No) — only where Sale Loss / Reject are available.
  const showPick = !viewOnly && !!editId && canCloseOrder;
  const pickable = items.filter((i) => i.dbId);
  const allPicked = pickable.length > 0 && pickable.every((i) => selectedIds.includes(i.dbId));

  return (
    <Layout pageTitle={viewOnly ? "View Order" : editId ? "Edit Order" : "Add Order"}>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        {/* Category locked badge — hidden */}
      </div>

      {fromEnquiry && !editId && (
        <div style={{ marginBottom: 20, background: "rgba(58,37,96,0.08)", border: "1px solid rgba(58,37,96,0.25)", borderRadius: 10, padding: "10px 16px", fontSize: 13, color: "#3A2560", fontWeight: 600 }}>
          Converting enquiry #{fromEnquiry} — customer and product are pre-filled below. Confirm delivery date and remarks, then Approve or Place Order.
        </div>
      )}

      {editId && (
        <div style={{ marginBottom: 20, background: "rgba(91,155,217,0.08)", border: "1px solid rgba(91,155,217,0.25)", borderRadius: 10, padding: "10px 16px", fontSize: 13, color: "#1F5C99", fontWeight: 600 }}>
          {viewOnly
            ? `Viewing order ${form.enquiryOrderNo || `#${editId}`} — read-only.`
            : `Editing order ${form.enquiryOrderNo || `#${editId}`} — everything below is read-only until you click "Edit" on a row (or on Payment & Delivery), then Update Order.`}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

        {error && (
          <div style={{ background: "rgba(178,58,58,0.08)", border: "1px solid rgba(178,58,58,0.25)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#B23A3A" }}>
            {error}
          </div>
        )}

        {/* ── 1. Order Details ── */}
        <div style={card}>
          <h3 style={{ ...cardTitle }}>Order Details</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: "4px 20px", alignItems: "start" }}>
            <Field label="Enquiry Order No">
              <Input type="text" value={form.enquiryOrderNo} disabled />
            </Field>

            <Field label="Enquiry Order Date">
              <Input type="date" value={form.enquiryOrderDate} disabled />
            </Field>

            {(viewOnly || editId) ? (
              <ReadField label="Customer" value={customers.find(c => String(c.Id) === String(form.customerId)) ? `${customers.find(c => String(c.Id) === String(form.customerId)).Name} (${customers.find(c => String(c.Id) === String(form.customerId)).Code})` : "—"} />
            ) : (
              <Field label="Customer" required>
                <Select value={form.customerId} onChange={e => set("customerId", e.target.value)}>
                  <option value="">Select customer…</option>
                  {customers.map(c => <option key={c.Id} value={c.Id}>{c.Name} ({c.Code})</option>)}
                </Select>
              </Field>
            )}
          </div>
        </div>

        {/* ── 2. Select Products — brand-new manual orders only ── */}
        {isNewOrder && !viewOnly && (
          <div style={card}>
            <h3 style={cardTitle}>Select Products</h3>

            {pickerTypeKeys.length > 0 && (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
                {pickerTypeKeys.map((t, i) => (
                  <button key={t} type="button" onClick={() => setPickerType(t)}
                    style={{
                      display: "flex", alignItems: "center", gap: 8, padding: "10px 18px", borderRadius: 10,
                      border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 700,
                      background: pickerType === t ? TAB_COLORS[i % TAB_COLORS.length] : themeG.bg,
                      color: pickerType === t ? "#fff" : themeG.textMain,
                    }}>
                    <span>{TAB_ICONS[t.toLowerCase()] || "🧷"}</span> {t}
                  </button>
                ))}
              </div>
            )}

            {pickerSubTypesForActiveType.length > 1 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
                {pickerSubTypesForActiveType.map((s) => (
                  <button key={s} type="button" onClick={() => setPickerSubType(s)}
                    style={{
                      padding: "6px 14px", borderRadius: 16, border: `1.5px solid ${pickerSubType === s ? themeG.accent : themeG.border}`,
                      cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600,
                      background: pickerSubType === s ? `${themeG.accent}1A` : "transparent",
                      color: pickerSubType === s ? themeG.accent : themeG.textSub,
                    }}>
                    {s}
                  </button>
                ))}
              </div>
            )}

            <div style={{ position: "relative", marginBottom: 14 }} ref={pickerNameBoxRef}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: themeG.textLabel, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Product Name</label>
              <input
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 13px", borderRadius: 9, border: `1px solid ${themeG.border}`, fontSize: 14, fontFamily: "inherit", color: themeG.textMain, background: themeG.card, outline: "none" }}
                placeholder={`Search or choose a ${pickerSubType || pickerType} product…`}
                value={pickerNameQuery}
                onFocus={() => setPickerNameMenuOpen(true)}
                onChange={(e) => { setPickerNameQuery(e.target.value); setPickerNameMenuOpen(true); }}
              />
              {pickerNameMenuOpen && (
                <div style={{ position: "absolute", zIndex: 5, top: "calc(100% + 6px)", left: 0, right: 0, maxHeight: 220, overflowY: "auto", background: themeG.card, border: `1px solid ${themeG.border}`, borderRadius: 9, boxShadow: "0 8px 24px rgba(15,33,56,0.14)" }}>
                  {pickerSuggestionNames.length === 0 ? (
                    <div style={{ padding: "10px 14px", fontSize: 12.5, color: themeG.textSub, fontStyle: "italic" }}>No product name matches "{pickerNameQuery}".</div>
                  ) : (
                    pickerSuggestionNames.map((n) => (
                      <div key={n} style={{ padding: "9px 14px", fontSize: 13.5, color: themeG.textMain, cursor: "pointer" }}
                        onMouseDown={() => { setPickerNameQuery(n); setPickerNameMenuOpen(false); }}>
                        {n}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
              <div style={{ flex: "1 1 240px", minWidth: 200 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: themeG.textLabel, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Search Sort No / Description</label>
                <input
                  style={{ width: "100%", boxSizing: "border-box", padding: "9px 13px", borderRadius: 9, border: `1px solid ${themeG.border}`, fontSize: 13.5, fontFamily: "inherit", color: themeG.textMain, background: themeG.card, outline: "none" }}
                  placeholder="e.g. 1481 or description…"
                  value={pickerSecondaryQuery}
                  onChange={(e) => setPickerSecondaryQuery(e.target.value)}
                />
              </div>
              <div style={{ flex: "0 1 160px", minWidth: 140 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: themeG.textLabel, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>UOM</label>
                <select
                  style={{ width: "100%", boxSizing: "border-box", padding: "9px 13px", borderRadius: 9, border: `1px solid ${themeG.border}`, fontSize: 13.5, fontFamily: "inherit", color: themeG.textMain, background: themeG.card, outline: "none" }}
                  value={pickerUomFilter} onChange={(e) => setPickerUomFilter(e.target.value)}>
                  {["All", "m", "pcs"].map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>

            <div style={{ border: `1px solid ${themeG.border}`, borderRadius: 12, overflow: "hidden" }}>
              {pickerTableProducts.length === 0 ? (
                <div style={{ padding: 26, textAlign: "center", color: themeG.textSub, fontSize: 13 }}>
                  {pickerSubType ? `No ${pickerSubType} products match the current filters.` : "No products available for this category."}
                </div>
              ) : (
                <div style={{ maxHeight: 320, overflowY: "auto", overflowX: "auto" }}>
                  <table style={{ width: "100%", minWidth: 760, borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        {["Sort No", "Shade No", "Product Description", "Type", "UOM", "Colour", "Quantity"].map((h) => (
                          <th key={h} style={{ textAlign: "left", padding: "10px 14px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#FFFFFF", background: "#1F3A63", borderBottom: `1px solid ${themeG.border}`, position: "sticky", top: 0 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pickerTableProducts.map((p, i) => {
                        const qty = getPickerRowQty(p.Id);
                        const swatch = p.Color || DUMMY_SWATCHES[i % DUMMY_SWATCHES.length];
                        const already = inOrderQty(p.Id);
                        return (
                          <tr key={p.Id}>
                            <td style={{ padding: "10px 14px", fontSize: 13, color: themeG.textMain, borderBottom: `1px solid ${themeG.border}` }}>{sortNoFor(p)}</td>
                            <td style={{ padding: "10px 14px", fontSize: 13, color: themeG.textMain, borderBottom: `1px solid ${themeG.border}` }}>{dummyShadeNo(p, i)}</td>
                            <td style={{ padding: "10px 14px", fontSize: 13, color: themeG.textSub, borderBottom: `1px solid ${themeG.border}` }}>{dummyDescription(p, i)}</td>
                            <td style={{ padding: "10px 14px", fontSize: 13, color: themeG.textMain, borderBottom: `1px solid ${themeG.border}` }}>{dummyType(p, i)}</td>
                            <td style={{ padding: "10px 14px", fontSize: 13, color: themeG.textMain, borderBottom: `1px solid ${themeG.border}` }}>{dummyUom(p.SubType)}</td>
                            <td style={{ padding: "10px 14px", borderBottom: `1px solid ${themeG.border}` }}>
                              <div style={{ width: 20, height: 20, borderRadius: "50%", background: swatch, border: "1.5px solid rgba(0,0,0,0.14)" }} />
                            </td>
                            <td style={{ padding: "10px 14px", borderBottom: `1px solid ${themeG.border}` }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  <button type="button" style={{ width: 24, height: 24, borderRadius: 6, border: `1px solid ${themeG.border}`, background: themeG.bg, color: themeG.textMain, fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                                    onClick={() => setPickerRowQtyFor(p, qty - 1)}>−</button>
                                  <input type="number" min={0} max={p.Quantity ?? undefined} value={qty}
                                    onChange={(e) => setPickerRowQtyFor(p, parseInt(e.target.value, 10) || 0)}
                                    style={{ width: 48, textAlign: "center", padding: "4px", borderRadius: 6, border: `1px solid ${themeG.border}`, fontSize: 12.5, fontFamily: "inherit", color: themeG.textMain, background: themeG.card, outline: "none" }} />
                                  <button type="button" style={{ width: 24, height: 24, borderRadius: 6, border: `1px solid ${themeG.border}`, background: themeG.bg, color: themeG.textMain, fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                                    onClick={() => setPickerRowQtyFor(p, qty + 1)}>+</button>
                                </div>
                                <button type="button" onClick={() => handlePickerAdd(p)}
                                  style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: pickerJustAddedId === p.Id ? "#16A34A" : themeG.accent, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                                  {pickerJustAddedId === p.Id ? "✓ Added" : "+ Add"}
                                </button>
                              </div>
                              {already > 0 && <p style={{ fontSize: 10.5, color: themeG.textSub, margin: "4px 0 0" }}>In order: {already}</p>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── 3. Products in this order ──
              Read-only by default. Requested Qty is always the original
              ordered quantity (never editable here). Click a row's Edit to
              turn Allocated Qty / Allocated Mtr into inputs for that row only.
              Click Done to go back to plain text showing the edited value,
              then Update Order to save. */}
        {items.length > 0 && (
          <div style={card}>
            <h3 style={cardTitle}>Products in this Order ({items.length})</h3>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {showPick && (
                      <th style={{ textAlign: "center", background: "#1F3A63", padding: "10px 12px", borderBottom: `2px solid ${themeG.border}`, width: 40 }}>
                        <input
                          type="checkbox"
                          title="Select all products"
                          checked={allPicked}
                          onChange={(e) => setSelectedIds(e.target.checked ? pickable.map((i) => i.dbId) : [])}
                          style={{ width: 16, height: 16, cursor: "pointer" }}
                        />
                      </th>
                    )}
                    {(viewOnly
                      ? ["S.No", "Sort No", "Shade", "Product", "UOM", "Sub-type", "Remarks", "Requested Qty", "Allocated Qty", "Allocated Mtr"]
                      : ["S.No", "Sort No", "Shade", "Product", "UOM", "Sub-type", "Remarks", "Requested Qty", "Allocated Qty", "Allocated Mtr", "Actions"]
                    ).map(h => (
                      <th key={h} style={{ textAlign: "center", fontSize: 11, color: "#FFFFFF", background: "#1F3A63", padding: "10px 12px", borderBottom: `2px solid ${themeG.border}`, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((i, idx) => {
                    const product = products.find((p) => String(p.Id) === String(i.productId));
                    const isEditing = !viewOnly && editingQtyId === i.tempId;
                    return (
                      <tr key={i.tempId} style={showPick && selectedIds.includes(i.dbId) ? { background: "rgba(178,58,58,0.06)" } : undefined}>
                        {showPick && (
                          <td style={tdBase}>
                            <input
                              type="checkbox"
                              checked={selectedIds.includes(i.dbId)}
                              onChange={(e) =>
                                setSelectedIds((prev) =>
                                  e.target.checked ? [...prev, i.dbId] : prev.filter((x) => x !== i.dbId)
                                )
                              }
                              style={{ width: 16, height: 16, cursor: "pointer" }}
                            />
                          </td>
                        )}
                        <td style={{ ...tdBase, color: themeG.textSub }}>{idx + 1}</td>
                        <td style={{ ...tdBase, color: themeG.textMain }}>{sortNoFor(product)}</td>
                        <td style={{ ...tdBase, color: themeG.textMain }}>{shadeNoFor(product)}</td>
                        <td style={{ ...tdBase, color: themeG.textMain }}>{i.productLabel}</td>
                        <td style={{ ...tdBase, color: themeG.textMain }}>{(() => { const u = uomFor(i, product); return u ? uomLabel(u) : "—"; })()}</td>
                        <td style={{ ...tdBase, color: themeG.textSub, textTransform: "capitalize" }}>{i.subType}</td>
                        <td style={{ ...tdBase, color: themeG.textSub }}>{i.remarks || "—"}</td>

                        {/* Requested Qty — original ordered quantity, always read-only */}
                        <td style={tdBase}>
                          <span style={{ fontWeight: 600, color: themeG.textMain }}>{i.qty}</span>
                        </td>

                        {/* Allocated Qty — becomes an input while this row is in Edit mode */}
                        <td style={tdBase}>
                          {isEditing ? (
                            <input
                              type="number"
                              min={0}
                              max={i.qty}
                              value={i.allocQty ?? ""}
                              onChange={(e) =>
                                setItems((prev) =>
                                  prev.map((it) => it.tempId === i.tempId ? { ...it, allocQty: e.target.value } : it)
                                )
                              }
                              style={{ ...editInputStyle, width: 80 }}
                            />
                          ) : (
                            <span style={{ color: themeG.textMain }}>{i.allocQty || "—"}</span>
                          )}
                        </td>

                        {/* Allocated Mtr — becomes an input while this row is in Edit mode */}
                        <td style={tdBase}>
                          {isEditing ? (
                            <input
                              type="text"
                              placeholder="e.g. 5M"
                              value={i.allocMtr ?? ""}
                              onChange={(e) =>
                                setItems((prev) =>
                                  prev.map((it) => it.tempId === i.tempId ? { ...it, allocMtr: e.target.value } : it)
                                )
                              }
                              style={{ ...editInputStyle, width: 80 }}
                            />
                          ) : (
                            <span style={{ color: themeG.textMain }}>{i.allocMtr || "—"}</span>
                          )}
                        </td>

                        {!viewOnly && (
                          <td style={tdBase}>
                            <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                              <button onClick={() => setEditingQtyId((prev) => prev === i.tempId ? null : i.tempId)}
                                style={{ padding: "5px 12px", borderRadius: 7, border: `1px solid ${themeG.accent}55`, background: `${themeG.accent}14`, color: themeG.accent, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                                {isEditing ? "Done" : "Edit"}
                              </button>
                              <button onClick={() => handleRemoveItem(i.tempId)}
                                style={{ padding: "5px 12px", borderRadius: 7, border: "1px solid rgba(178,58,58,0.30)", background: "rgba(178,58,58,0.06)", color: "#B23A3A", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                                Remove
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── 4. Payment & Delivery — locked until Edit ── */}
        <div style={card}>
          <h3 style={{ ...cardTitle }}>Payment & Delivery</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: "4px 20px", alignItems: "start" }}>
            {editPayment ? (
              <Field label="Expected Delivery Date" required>
                {/* min = today → past days are disabled in the picker */}
                <Input type="date" min={todayStr()} value={form.deliveryDate} onChange={e => set("deliveryDate", e.target.value)} />
              </Field>
            ) : (
              <ReadField label="Expected Delivery Date" value={form.deliveryDate || "—"} />
            )}

            {editPayment ? (
              <Field label="Remarks">
                <textarea placeholder="Special instructions, etc." value={form.notes} onChange={e => set("notes", e.target.value)} rows={2}
                  style={{ width: "100%", padding: "9px 13px", borderRadius: 9, border: `1px solid ${themeG.border}`, fontSize: 14, fontFamily: "inherit", color: themeG.textMain, background: themeG.card, outline: "none", resize: "vertical", boxSizing: "border-box" }} />
              </Field>
            ) : (
              <ReadField label="Remarks" value={form.notes || "—"} />
            )}
          </div>
          {!viewOnly && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
              <button type="button" onClick={() => setEditPayment(v => !v)}
                style={{
                  padding: "9px 24px", borderRadius: 9, border: "none", cursor: "pointer",
                  fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: "#fff",
                  background: editPayment ? "#D97706" : "#F59E0B",
                  boxShadow: "0 4px 12px rgba(217,119,6,0.35)"
                }}>
                {editPayment ? "Done" : "Edit"}
              </button>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, marginTop: 28, justifyContent: "flex-end" }}>
        <button onClick={() => navigate("/master/orders")}
          style={{ padding: "10px 24px", borderRadius: 9, border: `1px solid ${themeG.border}`, background: themeG.card, color: themeG.textSub, cursor: "pointer", fontFamily: "inherit", fontSize: 14, fontWeight: 500 }}>
          {viewOnly ? "Close" : "Cancel"}
        </button>

        {!viewOnly && (
          <button onClick={() => setEditPayment(true)}
            style={{ padding: "10px 24px", borderRadius: 9, border: "1.5px solid #1F5C99", background: "transparent", color: "#1F5C99", cursor: "pointer", fontFamily: "inherit", fontSize: 14, fontWeight: 700 }}>
            Edit
          </button>
        )}

        {!viewOnly && !editId && (
          <button onClick={handleSubmit} disabled={saving} data-confirm="Approve and place this order?" data-confirm-title="Approve Order"
            style={{ padding: "10px 24px", borderRadius: 9, border: `1.5px solid ${themeG.accent}`, background: "transparent", color: themeG.accent, cursor: saving ? "not-allowed" : "pointer", fontFamily: "inherit", fontSize: 14, fontWeight: 700, opacity: saving ? 0.6 : 1 }}>
            {saving ? "…" : "Approve"}
          </button>
        )}

        {!viewOnly && (
          <button onClick={handleSubmit} disabled={saving} data-confirm="Submit this order to the next person for approval?" data-confirm-title="Submit Order"
            style={{ padding: "10px 28px", borderRadius: 9, border: "none", background: themeG.accent, color: themeG.card, cursor: saving ? "not-allowed" : "pointer", fontFamily: "inherit", fontSize: 14, fontWeight: 700, boxShadow: "0 2px 10px rgba(91,155,217,0.32)", opacity: saving ? 0.6 : 1 }}>
            {saving
              ? (editId ? "Updating…" : "Placing…")
              : editId
                ? "Update Order"
                : `Place Order${(items.length + (form.productId ? 1 : 0)) > 1 ? ` (${items.length + (form.productId ? 1 : 0)} products)` : ""}`}
          </button>
        )}

        {/* Sale Loss / Reject — edit mode only, and ONLY while the order is
            Pending Allocation or Partial Allocation. Each asks for a reason,
            marks the order and opens its own page (Sale Loss / Reject list). */}
        {!viewOnly && editId && canCloseOrder && (
          <>
            <button type="button" disabled={saving} onClick={() => markOrder("sale_loss")}
              style={{ padding: "10px 24px", borderRadius: 9, border: "1.5px solid #C2571A", background: "transparent", color: "#C2571A", cursor: saving ? "not-allowed" : "pointer", fontFamily: "inherit", fontSize: 14, fontWeight: 700, opacity: saving ? 0.6 : 1 }}>
              Sale Loss
            </button>
            <button type="button" disabled={saving} onClick={() => markOrder("rejected")}
              style={{ padding: "10px 24px", borderRadius: 9, border: "1.5px solid #B23A3A", background: "transparent", color: "#B23A3A", cursor: saving ? "not-allowed" : "pointer", fontFamily: "inherit", fontSize: 14, fontWeight: 700, opacity: saving ? 0.6 : 1 }}>
              Reject
            </button>
          </>
        )}
      </div>
    </Layout>
  );
}