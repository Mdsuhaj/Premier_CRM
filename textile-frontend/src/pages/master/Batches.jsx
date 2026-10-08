// src/pages/master/Batches.jsx
//
// Marketing Review — Quantity Allocation + Final Approval console.
// Admin allocates available stock to each order line and clicks "Approval";
// that hands the row to System Admin as Status = 'pending'. System Admin
// approves / rejects (Actions column), can leave Remarks, and pushes Approved
// rows to ERP with "Transfer to ERP". Every allocation is keyed by
// (ProductId, OrderId) on the server, so orders never share qty/status.
//
// Allocation Status is role-specific: Admin sees the stock position (Fully /
// Partial / Not Allocated / Stock Shortage); System Admin sees the approval
// state (Pending / Approved / Rejected / Not Submitted).
//
// Meter column: free-text manual figure per order. Available Stock is consumed
// at (Allocated Cases × Allocated Mtr); a row with no Mtr does not draw stock.
// CD Flag is a per-row Yes/No dropdown (client-side for now).
//
// Partial orders: a partially allocated order (some qty saved, some still
// owed) gets a chevron in its first column. Opening it shows a "balance" row
// underneath where the remaining qty is allocated. The order stays on this
// board for 48 hours from its first allocation.
//
// ── CHANGES IN THIS VERSION ──
// 1. Allocated Mtr can only be entered after Allocated Qty (alert otherwise).
//    Clearing the qty also clears the Mtr.
// 2. Partial orders (within the 48h window) sort to the top, newest first.
//    Only the PARENT row is orange; the balance (dropdown) row is white like
//    other rows, and neither changes colour on hover.
// 3. Admin submit: inputs of products that failed are kept (only submitted
//    rows are cleared), and the page scrolls up so the message is visible.
// 4. CD Flag / Price reversed: the partial parent is editable until submitted
//    and read-only after; the balance row's CD Flag / Price is editable.
// 5. Category pills always appear in the order Dhoti → Blouse → Uniform
//    Shirting → Uniform Suiting → Others, evenly spaced.
// 6. Allocated Mtr is capped: (Allocated Qty × Mtr) can never exceed the stock
//    left. Typing a bigger Mtr snaps it to the maximum allowed, so Available
//    Stock stops at 0 instead of going negative (see setMeter).
// 7. TOTAL MTR: the Allocated Mtr column now totals Allocated Qty × Mtr —
//    per product (product group row), and as the grand total in the footer
//    "Total" row, the Allocation Summary bar, Excel export and print.
// 8. Delivery Point now comes from the API as "<number> <name>" (backend
//    sends deliveryPointNo / deliveryPointName / deliveryPoint).
// 9. PRODUCT CODE / PRODUCT NAME: only the first 5 words are shown, followed
//    by "...". Hovering shows a card with the full Product Code and Product
//    Name. Applies to Admin + System Admin, Product Wise + Customer Wise
//    (see truncateWords() and the <HoverCard> component at the bottom).
import { useEffect, useMemo, useRef, useState, Fragment } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ClipboardList, PackageCheck, Hourglass, Search,
  Shirt, Layers, Briefcase, LayoutGrid, Send, RotateCcw,
  Zap, ChevronRight, ChevronDown, Check, X, Package, CircleDot, Triangle,
  Ruler, FileDown, Printer, FileText, ArrowUpRight, Truck, AlertTriangle,
  ShoppingCart,
} from "lucide-react";
import * as XLSX from "xlsx";
import Layout from "../../components/AppLayout";
import API from "../../services/api";
import { INDIA_STATES, districtsOfState, stateOfDistrict, sameName } from "../../data/indiaStatesDistricts";

const DRAFT_STORAGE_KEY = "premier_mr_draft";
const PARTIAL_WINDOW_HOURS = 48;
const DEFAULT_PRICE_CODE = "DOMESTIC";
// Orange used for the PARTIAL PARENT row only (the balance row stays white).
const PARTIAL_ROW_BG = "#FFF6E5";

const ADMIN_STATUS_OPTIONS = [
  { value: "", label: "All" },
  { value: "fully_allocated", label: "Fully Allocated" },
  { value: "partial_allocated", label: "Partial Allocated" },
  { value: "not_allocated", label: "Not Allocated" },
  { value: "stock_shortage", label: "Stock Shortage" },
];
const SYSADMIN_STATUS_OPTIONS = [
  { value: "", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

const UOM_LABEL_OVERRIDES = { Meter: "Mtr", Box: "Cases" };
function uomLabel(value) {
  return UOM_LABEL_OVERRIDES[value] || value;
}

// ── Category tabs ─────────────────────────────────────────────────────
const CLOTH_GROUPS = [
  { id: "dhoti", name: "Dhoti", match: ["dhoti", "dothi", "cotton dhoti grey", "cotton dhoti fabric"], icon: Layers, color: "#1C7A4B", tagBg: "#DCF3E6", tagText: "#1C7A4B" },
  { id: "blouse", name: "Blouse", match: ["blouse"], icon: Shirt, color: "#1E5B95", tagBg: "#DCEAF7", tagText: "#1E5B95" },
  { id: "uniform_shirting", name: "Uniform Shirting", match: ["uniform shirting"], icon: Briefcase, color: "#B2622E", tagBg: "#F7E3D2", tagText: "#B2622E" },
  { id: "uniform_suiting", name: "Uniform Suiting", match: ["uniform suiting"], icon: Ruler, color: "#5B4B8C", tagBg: "#E7E1F5", tagText: "#5B4B8C" },
  { id: "others", name: "Others", match: ["others"], icon: LayoutGrid, color: "#D97706", tagBg: "#FBEAD3", tagText: "#D97706" },
];
const YARN_GROUPS = [
  { id: "bundle", name: "Bundle", match: ["bundle"], icon: Package, color: "#1E5B95", tagBg: "#DCEAF7", tagText: "#1E5B95" },
  { id: "hank", name: "Hank", match: ["hank"], icon: CircleDot, color: "#1C7A4B", tagBg: "#DCF3E6", tagText: "#1C7A4B" },
  { id: "cone", name: "Cone", match: ["cone"], icon: Triangle, color: "#5B4B8C", tagBg: "#E7E1F5", tagText: "#5B4B8C" },
];

const CUSTOM_SUBTYPES_KEY = "premier_custom_subtypes";
const FALLBACK_TAB_COLORS = [
  { color: "#7A5C1C", tagBg: "#F5EBD2", tagText: "#7A5C1C" },
  { color: "#3A6B8C", tagBg: "#DCEEF7", tagText: "#3A6B8C" },
  { color: "#8C3A5C", tagBg: "#F7DCE9", tagText: "#8C3A5C" },
];

function getCategoryGroups() {
  const topCat = (localStorage.getItem("premier_category") || "cloth").toLowerCase();
  const base = topCat === "yarn" ? YARN_GROUPS : CLOTH_GROUPS;
  let custom = {};
  try {
    const raw = localStorage.getItem(CUSTOM_SUBTYPES_KEY);
    custom = raw ? (JSON.parse(raw)[topCat] || {}) : {};
  } catch {
    custom = {};
  }
  const extra = Object.keys(custom)
    .filter((key) => !base.some((g) => g.id === key.toLowerCase()))
    .map((key, i) => ({
      id: key.toLowerCase(),
      name: custom[key]?.label || key,
      match: [key.toLowerCase()],
      icon: LayoutGrid,
      ...FALLBACK_TAB_COLORS[i % FALLBACK_TAB_COLORS.length],
    }));
  return [...base, ...extra];
}

const normalize = (v) => (v ?? "").toString().trim().toLowerCase().replace(/\s+/g, " ");

const groupFor = (subType, groups) => {
  const c = normalize(subType);
  if (!c) return groups[groups.length - 1];
  const exact = groups.find((g) => g.match.includes(c));
  if (exact) return exact;
  const partial = groups.find((g) => g.match.some((m) => c.includes(m) || m.includes(c)));
  return partial || groups[groups.length - 1];
};
const warehouseFor = (subType) =>
  normalize(subType) === "blouse" ? "Rack Stock" : "EB4 Dispatch Warehouse";

const DUMMY_SHADE_NOS = ["SH-101", "SH-102", "SH-103", "SH-104", "SH-105", "SH-106"];
const sortNoFallback = (product) => product?.Code || "—";
const shadeNoFor = (product, seed) => product?.ShadeNo || DUMMY_SHADE_NOS[seed % DUMMY_SHADE_NOS.length];

// ── Dummy Tax / Payment / Delivery Point (CD Flag is a real dropdown) ──
const DUMMY_TAX = ["5%", "12%", "18%", "28%"];
const DUMMY_PAYMENT_TERMS = ["Advance", "Credit 15 Days", "Credit 30 Days", "Credit 45 Days"];
const DUMMY_DELIVERY_POINTS = ["Madurai Warehouse", "EB4 Dispatch Warehouse", "Customer Godown", "Direct Ex-Mill"];
function seedFromKey(key) {
  let h = 0;
  const s = String(key || "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
const dummyTax = (key) => DUMMY_TAX[seedFromKey(key) % DUMMY_TAX.length];
const dummyPayment = (key) => DUMMY_PAYMENT_TERMS[seedFromKey(`${key}-pay`) % DUMMY_PAYMENT_TERMS.length];
const dummyDeliveryPoint = (key) => DUMMY_DELIVERY_POINTS[seedFromKey(`${key}-dp`) % DUMMY_DELIVERY_POINTS.length];

const todayStr = () => new Date().toISOString().slice(0, 10);

const formatEnquiryDate = (d) => {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-GB");
};

// ── 48-hour partial window helpers ─────────────────────────────────────
const hoursSince = (iso) => {
  if (!iso) return null;
  const t = new Date(String(iso).replace(" ", "T")).getTime();
  return isNaN(t) ? null : (Date.now() - t) / 36e5;
};
// Partial = something already SAVED against the order, but not all of it.
const isPartialRow = (r) => r.savedAllocated > 0 && r.savedAllocated < r.requested;
// Hours left in the 48h window; null when there's no allocation timestamp yet.
const partialHoursLeft = (r) => {
  const age = hoursSince(r.firstAllocatedAt);
  return age === null ? null : PARTIAL_WINDOW_HOURS - age;
};
// A partial order whose 48h window has run out — it leaves this board.
const isExpiredPartial = (r) => {
  if (!isPartialRow(r)) return false;
  const left = partialHoursLeft(r);
  return left !== null && left <= 0;
};
const fmtLeft = (h) =>
  h === null ? "" : h <= 0 ? "48h window over" : h >= 24 ? `${Math.floor(h / 24)}d ${Math.floor(h % 24)}h left` : `${Math.max(1, Math.floor(h))}h left`;

const stockStatusKey = (row, available, allocated) => {
  if (allocated <= 0) {
    if (available <= 0) return "stock_shortage";
    return "not_allocated";
  }
  if (allocated >= row.requested) return "fully_allocated";
  return "partial_allocated";
};
const STOCK_STATUS_META = {
  stock_shortage: { label: "Stock Shortage", cls: "tag-hold" },
  not_allocated: { label: "Not Allocated", cls: "tag-neutral" },
  fully_allocated: { label: "Fully Allocated", cls: "tag-success" },
  partial_allocated: { label: "Partial Allocated", cls: "tag-pending" },
};
const approvalStatusKey = (row) => {
  if (!row.allocationId) return "not_submitted";
  if (row.status === "approved") return "approved";
  if (row.status === "rejected") return "rejected";
  return "pending";
};
const APPROVAL_STATUS_META = {
  not_submitted: { label: "Not Submitted", cls: "tag-neutral" },
  pending: { label: "Pending", cls: "tag-pending" },
  approved: { label: "Approved", cls: "tag-approved" },
  rejected: { label: "Rejected", cls: "tag-hold" },
};
const stockStatus = (row, available, allocated) => STOCK_STATUS_META[stockStatusKey(row, available, allocated)];
const groupStockStatus = (g) => {
  if (g.allocatedSum <= 0) {
    if (g.poolAvailable <= 0) return { label: "Stock Shortage", cls: "tag-hold" };
    return { label: "Not Allocated", cls: "tag-neutral" };
  }
  if (g.allocatedSum >= g.requestedSum) return { label: "Fully Allocated", cls: "tag-success" };
  return { label: "Partial Allocated", cls: "tag-pending" };
};
const stockColor = (requested, available, allocated) => {
  if (allocated <= 0) {
    if (available <= 0) return "#B23A3A";
    return "#6B7785";
  }
  if (allocated >= requested) return "#1C7A4B";
  return "#8A5A0E";
};

const numOr1 = (v) => {
  const n = parseFloat(String(v).replace(/[^\d.]/g, ""));
  return !isNaN(n) && n > 0 ? n : 1;
};

// Free-text Mtr ("5M", "5.5", "") → number. No usable Mtr = 0 (draws nothing).
const mtrNum = (v) => {
  const n = parseFloat(String(v ?? "").replace(/[^\d.]/g, ""));
  return !isNaN(n) && n > 0 ? n : 0;
};
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
// Total-Mtr display: "—" when nothing is allocated yet.
const fmtMtr = (n) => (n > 0 ? `${round2(n).toLocaleString()}M` : "—");

// Product Code / Product Name display: first 5 words, then "...".
// The full text is shown in the hover card (see <HoverCard> at the bottom).
const PRODUCT_TEXT_WORD_LIMIT = 5;
const truncateWords = (text, limit = PRODUCT_TEXT_WORD_LIMIT) => {
  const s = String(text ?? "").trim();
  if (!s) return "—";
  const words = s.split(/\s+/);
  return words.length > limit ? `${words.slice(0, limit).join(" ")}...` : s;
};

export default function Batches() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const role = localStorage.getItem("role") || "";
  const canManage = ["admin", "system_admin"].includes(role);
  const isSystemAdminRole = role === "system_admin";

  // From Order List's "Allocated" action: /master/batches?enquiry=ORD-1045&focus=45,46
  const focusEnquiry = searchParams.get("enquiry") || "";
  const [focusIds, setFocusIds] = useState(() =>
    (searchParams.get("focus") || "").split(",").map((s) => s.trim()).filter(Boolean)
  );

  const CATEGORY_GROUPS = useMemo(() => getCategoryGroups(), []);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [transferringErp, setTransferringErp] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  // When arriving from Order List, start on "All" so the order isn't hidden
  // behind another category tab.
  const [activeCat, setActiveCat] = useState(() =>
    (searchParams.get("focus") ? "all" : (CATEGORY_GROUPS[0]?.id || "all"))
  );
  const [viewBy, setViewBy] = useState("customer");
  const [globalSearch, setGlobalSearch] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [enquiryNoSearch, setEnquiryNoSearch] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [inquiryDate, setInquiryDate] = useState("");
  // State + District filters (all India). District list follows the chosen State.
  const [stateFilter, setStateFilter] = useState("");
  const [districtFilter, setDistrictFilter] = useState("");
  const [officerFilter, setOfficerFilter] = useState("");
  const [allocStatusFilter, setAllocStatusFilter] = useState("");
  const [uomStatusFilter, setUomStatusFilter] = useState("");
  const [allocInputs, setAllocInputs] = useState({});
  const [remarksInputs, setRemarksInputs] = useState({});
  const [meterInputs, setMeterInputs] = useState({});
  const [cdFlagInputs, setCdFlagInputs] = useState({});
  const [priceCodeInputs, setPriceCodeInputs] = useState({});
  const [priceCodeOptions, setPriceCodeOptions] = useState(["TLODOM", "DOMESTIC"]);
  const [busyDecision, setBusyDecision] = useState(() => new Set());
  const [expandedProducts, setExpandedProducts] = useState({});
  const [selectedRows, setSelectedRows] = useState(() => new Set());

  const [expandedPartials, setExpandedPartials] = useState({});
  const [officerOptions, setOfficerOptions] = useState([]);

  const [alertModalOpen, setAlertModalOpen] = useState(false);

  // ---- Data loading -----------------------------------------------------
  // Request counter: only the LATEST loadBoard() call may update state, so
  // overlapping refreshes can't leave the page stuck on "Loading…" or show
  // older data over newer data.
  const boardReqRef = useRef(0);
  const loadBoard = async () => {
    const reqId = ++boardReqRef.current;
    setLoading(true); setError("");
    try {
      const boardRes = await API.get("/allocations/board");
      if (reqId !== boardReqRef.current) return;
      const activeProducts = boardRes.data?.products || [];

      const flat = [];
      activeProducts.forEach((p) => {
        const subType = p.subType || p.category;
        const productUom = p.uom || p.UOM || "";
        const customersArr = p.customers || [];
        const meterMultOf = (c) => {
          const n = parseFloat(String(c.meters || "").replace(/[^\d.]/g, ""));
          return !isNaN(n) && n > 0 ? n : 0;
        };
        const usedOf = (c) => (c.totalMtr != null ? Number(c.totalMtr) : (c.allocatedQty || 0) * meterMultOf(c));
        const totalConsumed = customersArr.reduce((sum, c) => sum + usedOf(c), 0);
        const poolAvailable = Math.max(0, (p.availableQty || 0) - totalConsumed);
        customersArr.forEach((c) => {
          const rowAvailable = poolAvailable + usedOf(c);
          const uom = c.uom || productUom;
          flat.push({
            key: `${p.productId}-${c.customerId}-${c.orderId ?? c.orderNo ?? ""}`,
            productId: p.productId,
            customerId: c.customerId,
            orderId: c.orderId || null,
            orderNo: c.orderNo || `${p.code}/${c.code}`,
            // Product Code column shows Oracle's exact ORDERITEMCODE
            // (from FULLITEMKEYDECODER) when we have it on record, falling
            // back to our internal Code only if Oracle never had one.
            productCode: p.orderItemCode || p.code,
            productName: p.name,
            uom,
            sortNo: p.sortNo ?? sortNoFallback({ Code: p.code }),
            shadeNo: shadeNoFor({ ShadeNo: p.shadeNo }, p.productId),
            category: subType,
            group: groupFor(subType, CATEGORY_GROUPS),
            customerName: c.name,
            customerCode: c.code,
            district: c.district || "",
            state: c.state || "",
            taluk: c.taluk || "",
            // "<number> <name>" built by the backend; number/name also kept separately.
            deliveryPoint: c.deliveryPoint || "",
            deliveryPointNo: c.deliveryPointNo || "",
            deliveryPointName: c.deliveryPointName || "",
            officerName: c.officerName || "",
            requested: c.orderedQty,
            inquiryDate: c.inquiryDate || null,
            savedAllocated: c.allocatedQty,
            rowAvailable,
            poolAvailable,
            price: p.price || 0,
            warehouse: warehouseFor(subType),
            allocationId: c.allocationId || null,
            status: c.status || null,
            remarks: c.remarks || "",
            meters: c.meters || "",
            savedMtrTotal: Number(c.totalMtr) || 0,
            erpSentCases: Number(c.erpSentCases) || 0,
            erpSentMtr: Number(c.erpSentMtr) || 0,
            cdFlag: c.cdFlag ? "Yes" : "No",
            priceListCode: c.priceListCode || "",
            erpStatus: c.erpStatus || "not_transferred",
            decidedAt: c.decidedAt || null,
            erpTransferredAt: c.erpTransferredAt || null,
            firstAllocatedAt: c.firstAllocatedAt || null,
          });
        });
      });
      setRows(flat);
    } catch (err) {
      if (reqId !== boardReqRef.current) return;
      setError(err.response?.data?.message || "Failed to load Marketing Review data.");
    } finally {
      if (reqId === boardReqRef.current) setLoading(false);
    }
  };

  // Sales Officer = real End Users. (State / District come from the built-in India list.)
  const loadFilters = async () => {
    try {
      const empRes = await API.get("/employees", { params: { role: "end_user" } });
      const employees = empRes.data?.data || empRes.data || [];
      setOfficerOptions(employees.map((e) => e.Name || e.name).filter(Boolean));
    } catch {
      setOfficerOptions([]);
    }
    try {
      const priceRes = await API.get("/allocations/price-list-options");
      if (Array.isArray(priceRes.data) && priceRes.data.length) setPriceCodeOptions(priceRes.data);
    } catch {
      // keep the TLODOM/DOMESTIC fallback already in state
    }
  };

  useEffect(() => { loadBoard(); loadFilters(); }, []);
  useEffect(() => { setSelectedRows(new Set()); }, [customerSearch, enquiryNoSearch, productSearch, inquiryDate, viewBy, globalSearch, stateFilter, districtFilter, officerFilter, allocStatusFilter, uomStatusFilter]);

  useEffect(() => {
    const refresh = () => loadBoard();
    const onStorage = (e) => { if (e.key === "premier_mr_dirty") refresh(); };
    window.addEventListener("premier-allocation-updated", refresh);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("premier-allocation-updated", refresh);
      window.removeEventListener("storage", onStorage);
    };
    // eslint-disable-next-line
  }, []);

  // Open the balance row of the order(s) Order List sent us to. Runs once,
  // as soon as the board rows have loaded.
  const focusOpenedRef = useRef(false);
  useEffect(() => {
    if (focusOpenedRef.current || focusIds.length === 0 || rows.length === 0) return;
    focusOpenedRef.current = true;
    const open = {};
    rows.forEach((r) => {
      if (r.orderId && focusIds.includes(String(r.orderId)) && isPartialRow(r)) open[r.key] = true;
    });
    setExpandedPartials((m) => ({ ...m, ...open }));
    // eslint-disable-next-line
  }, [rows]);

  // System Admin only reviews lines Admin has actually submitted with qty.
  const boardRows = useMemo(() => {
    if (!isSystemAdminRole) return rows;
    return rows.filter((r) => r.allocationId && r.savedAllocated > 0);
  }, [rows, isSystemAdminRole]);

  const draftRestoredRef = useRef(false);
  useEffect(() => {
    if (draftRestoredRef.current || rows.length === 0) return;
    draftRestoredRef.current = true;
    try {
      const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (raw) {
        const draft = JSON.parse(raw);
        const liveKeys = new Set(rows.map((r) => r.key));
        const keepLive = (obj) =>
          Object.fromEntries(Object.entries(obj || {}).filter(([k]) => liveKeys.has(k)));
        if (draft.allocInputs) setAllocInputs(keepLive(draft.allocInputs));
        if (draft.remarksInputs) setRemarksInputs(keepLive(draft.remarksInputs));
        if (draft.meterInputs) setMeterInputs(keepLive(draft.meterInputs));
        if (draft.cdFlagInputs) setCdFlagInputs(keepLive(draft.cdFlagInputs));
        if (draft.priceCodeInputs) setPriceCodeInputs(keepLive(draft.priceCodeInputs));
      }
    } catch {
      // ignore malformed/missing draft
    }
  }, [rows]);

  // ---- Allocation input helpers ------------------------------------------
  const allocFor = (row) => {
    if (row.key in allocInputs) return allocInputs[row.key];
    if (isSystemAdminRole) return row.savedAllocated;
    return 0;
  };
  const totalAllocFor = (row) => {
    const boxValue = allocFor(row);
    if (isSystemAdminRole) return boxValue;
    return row.savedAllocated + boxValue;
  };
  const remarksFor = (row) => (row.key in remarksInputs ? remarksInputs[row.key] : (row.remarks || ""));

  // A partial order that is locked for Admin (already submitted, not rejected).
  // Its ORDER row is read-only; only the balance row below it takes new input.
  const isLockedPartial = (row) =>
    !isSystemAdminRole
    && !!row.allocationId
    && isPartialRow(row)
    && row.status !== "rejected";

  // Mtr for the row's editable box (the balance row for a locked partial
  // order). The balance row starts EMPTY, like a new row, and does not copy
  // the parent's saved Mtr.
  const meterFor = (row) => {
    if (row.key in meterInputs) return meterInputs[row.key];
    if (!isSystemAdminRole && row.savedAllocated === 0) return "";
    if (isLockedPartial(row)) return "";
    return row.meters || "";
  };
  // Mtr to SHOW for the order itself (totals, export, print): a locked
  // partial order keeps showing its own saved Mtr.
  const displayMeterFor = (row) => (isLockedPartial(row) ? (row.meters || "") : meterFor(row));
  // Mtr to SEND on Approval: what was typed, otherwise keep the saved Mtr so
  // it is never blanked out by an increment that has no Mtr of its own.
  const meterToSend = (row) => meterFor(row) || row.meters || "";

  // System Admin only: cases of this line already sent to ERP, while a top-up
  // is waiting for approval. Those are hidden so only the NEW balance shows.
  const sentCasesOf = (row) =>
    isSystemAdminRole && row.erpStatus !== "erp_so_created" && row.erpSentCases > 0 && row.savedAllocated > row.erpSentCases
      ? row.erpSentCases : 0;
  const shownAllocFor = (row) => totalAllocFor(row) - sentCasesOf(row);

  // TOTAL MTR for one order = Allocated Qty × Allocated Mtr.
  // A locked partial order keeps its saved qty × saved Mtr, plus whatever is
  // currently typed in its balance row (new qty × new Mtr).
  // Saved total (from the server) + whatever is typed now (new qty × new Mtr).
  const rowMtrTotal = (row) => {
    const savedTotal = row.savedMtrTotal > 0 ? row.savedMtrTotal : row.savedAllocated * mtrNum(row.meters);
    const typedExtra = isSystemAdminRole ? 0 : (Number(allocFor(row)) || 0) * mtrNum(meterFor(row));
    const alreadySent = sentCasesOf(row) > 0 ? row.erpSentMtr : 0;
    return savedTotal + typedExtra - alreadySent;
  };

  const cdFlagFor = (row) => cdFlagInputs[row.key] ?? row.cdFlag ?? "No";
  const priceCodeFor = (row) =>
    priceCodeInputs[row.key] ?? (row.priceListCode || DEFAULT_PRICE_CODE);

  const mostRecentOne = (list, dateField) => {
    if (list.length === 0) return [];
    if (dateField) {
      const sorted = [...list].sort((a, b) => new Date(b[dateField] || 0) - new Date(a[dateField] || 0));
      return [sorted[0]];
    }
    return [list[list.length - 1]];
  };

  const liveAvailableByProduct = useMemo(() => {
    const map = new Map();
    rows.forEach((r) => {
      if (!map.has(r.productId)) map.set(r.productId, r.poolAvailable);
    });
    rows.forEach((r) => {
      const meterRaw = parseFloat(String(meterFor(r)).replace(/[^\d.]/g, ""));
      const meterMult = !isNaN(meterRaw) && meterRaw > 0 ? meterRaw : 0;
      const delta = (totalAllocFor(r) - r.savedAllocated) * meterMult;
      if (delta !== 0) map.set(r.productId, map.get(r.productId) - delta);
    });
    return map;
  }, [rows, allocInputs, meterInputs]);

  const setAlloc = (row, val) => {
    const liveAvailable = liveAvailableByProduct.get(row.productId) ?? row.poolAvailable;
    const currentBoxVal = allocFor(row);
    const meterMult = numOr1(meterFor(row));
    const cap = Math.floor((liveAvailable + currentBoxVal * meterMult) / meterMult);
    const requestedCap = isSystemAdminRole
      ? row.requested
      : Math.max(0, row.requested - row.savedAllocated);
    const clamped = Math.max(0, Math.min(Number(val) || 0, cap, requestedCap));
    setAllocInputs((s) => ({ ...s, [row.key]: clamped }));
    // No qty → no Mtr (Mtr can only be entered once a qty is entered).
    if (clamped === 0) setMeterInputs((s) => ({ ...s, [row.key]: "" }));
  };
  const autoAllocateRow = (row) => {
    const liveAvailable = liveAvailableByProduct.get(row.productId) ?? row.poolAvailable;
    const currentBoxVal = allocFor(row);
    const meterMult = numOr1(meterFor(row));
    const cap = Math.floor((liveAvailable + currentBoxVal * meterMult) / meterMult);
    const requestedCap = isSystemAdminRole
      ? row.requested
      : Math.max(0, row.requested - row.savedAllocated);
    setAlloc(row, Math.min(requestedCap, cap));
  };

  // Mtr is capped so (Allocated Qty × Mtr) never goes above the stock left.
  // If the typed Mtr is too big, it snaps to the maximum allowed instead of
  // letting Available Stock go negative.
  const setMeter = (row, text) => {
    const raw = String(text);
    const typed = parseFloat(raw.replace(/[^\d.]/g, ""));

    // Empty / non-numeric (e.g. clearing the box, or just "M") → no cap needed.
    if (isNaN(typed) || typed <= 0) {
      setMeterInputs((s) => ({ ...s, [row.key]: raw }));
      return;
    }

    const qty = Number(allocFor(row)) || 0;
    if (qty <= 0) return; // Mtr needs a qty first (the input already alerts about this)

    // Stock left, with THIS row's own current usage added back.
    const liveAvailable = liveAvailableByProduct.get(row.productId) ?? row.poolAvailable;
    const ownMeter = parseFloat(String(meterFor(row)).replace(/[^\d.]/g, ""));
    const ownUse = qty * (!isNaN(ownMeter) && ownMeter > 0 ? ownMeter : 0);
    const maxMeter = Math.floor((liveAvailable + ownUse) / qty);

    if (typed > maxMeter) {
      if (maxMeter <= 0) {
        setMeterInputs((s) => ({ ...s, [row.key]: "" }));
        window.alert("No stock left to allocate Mtr for this product.");
        return;
      }
      const suffix = raw.replace(/[\d.\s]/g, ""); // keep a typed "M" etc.
      setMeterInputs((s) => ({ ...s, [row.key]: `${maxMeter}${suffix}` }));
      return;
    }

    setMeterInputs((s) => ({ ...s, [row.key]: raw }));
  };

  // ---- Final Approval actions (System Admin) -----------------------------
  const patchRowLocally = (allocationId, patch) => {
    setRows((prev) => prev.map((r) => (r.allocationId === allocationId ? { ...r, ...patch } : r)));
  };

  const decideRow = async (row, decision) => {
    if (!row.allocationId || row.status !== "pending") return;
    setBusyDecision((s) => new Set(s).add(row.allocationId));
    setError(""); setOk("");
    try {
      await API.patch(`/allocations/${row.allocationId}/decision`, { status: decision });
      patchRowLocally(row.allocationId, { status: decision, decidedAt: new Date().toISOString() });
      setOk(decision === "approved" ? "Row approved." : "Row rejected.");
      loadStockSummary();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to save the decision.");
    } finally {
      setBusyDecision((s) => { const n = new Set(s); n.delete(row.allocationId); return n; });
    }
  };
  const saveRemarks = async (row) => {
    if (!row.allocationId) return;
    const text = remarksFor(row);
    if (text === (row.remarks || "")) return;
    try {
      await API.patch(`/allocations/${row.allocationId}/decision`, { remarks: text });
      patchRowLocally(row.allocationId, { remarks: text });
    } catch (err) {
      setError(err.response?.data?.message || "Failed to save remarks.");
    }
  };

  // ---- Row selection (System Admin only) ---------------------------------
  const showSelection = isSystemAdminRole;

  const toggleSelectAllRows = (visibleKeys, allCurrentlySelected) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (allCurrentlySelected) visibleKeys.forEach((k) => next.delete(k));
      else visibleKeys.forEach((k) => next.add(k));
      return next;
    });
  };
  const toggleOneRow = (key) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const bulkDecide = async (decision, eligibleRows) => {
    if (eligibleRows.length === 0) return;
    setError(""); setOk("");
    try {
      await API.post("/allocations/bulk-decision", {
        ids: eligibleRows.map((r) => r.allocationId),
        status: decision,
      });
      eligibleRows.forEach((r) => patchRowLocally(r.allocationId, { status: decision, decidedAt: new Date().toISOString() }));
      setOk(`${eligibleRows.length} row(s) ${decision}.`);
      setSelectedRows(new Set());
      loadStockSummary();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to apply the bulk decision.");
    }
  };

  // Expired (48h) partial orders are hidden from the normal list, but when an
  // Enquiry Date is picked they are shown again, so an old order can still be
  // looked up by its date (e.g. ordered 1 Oct, viewed on 4 Oct -> pick 1 Oct).
  const activeRows = useMemo(() => {
    const live = boardRows.filter((r) => inquiryDate || !isExpiredPartial(r));
    if (!isSystemAdminRole) {
      return live.filter((r) => !(r.allocationId && r.savedAllocated >= r.requested));
    }
    return live.filter((r) => r.erpStatus !== "erp_so_created");
  }, [boardRows, isSystemAdminRole, inquiryDate]);

  const enquiryNoOptions = useMemo(
    () => Array.from(new Set(boardRows.map((r) => r.orderNo).filter(Boolean))),
    [boardRows]
  );
  const customerNameOptions = useMemo(
    () => Array.from(new Set(boardRows.map((r) => r.customerName).filter(Boolean))),
    [boardRows]
  );

  // Suggestions for the big search bar: product, customer, order no, sort no, shade.
  const globalSearchOptions = useMemo(() => {
    const set = new Set();
    boardRows.forEach((r) => {
      [r.productName, r.productCode, r.customerName, r.customerCode, r.orderNo, r.sortNo, r.shadeNo]
        .forEach((v) => { if (v !== null && v !== undefined && String(v).trim() && v !== "—") set.add(String(v)); });
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [boardRows]);

  const UOM_FILTER_FALLBACK = ["Box", "Pieces", "Meter"];
  const uomOptions = useMemo(() => {
    const fromData = boardRows.map((r) => r.uom).filter(Boolean);
    const merged = Array.from(new Set([...fromData, ...UOM_FILTER_FALLBACK])).sort();
    return merged.map((u) => ({ value: u, label: UOM_LABEL_OVERRIDES[u] || u }));
  }, [boardRows]);

  // Priority: -1 = partial order inside its 48h window (goes to the very top),
  // 0 = still needs attention, 1 = everything else.
  const rowPriority = (r) => {
    if (isPartialRow(r)) return -1;
    if (isSystemAdminRole) {
      if (!r.allocationId || r.status === "pending") return 0;
      if (r.savedAllocated < r.requested) return 0;
      return 1;
    }
    return r.savedAllocated < r.requested ? 0 : 1;
  };

  // Every filter EXCEPT the category pill. The pill counts are taken from this
  // list, so they follow Enquiry Date / No / Customer / State / District /
  // Sales Officer / search / status filters.
  const filteredNoCat = useMemo(() => {
    let list = activeRows;
    // Coming from Order List "Allocated": show only that order's line(s).
    if (focusIds.length) list = list.filter((r) => focusIds.includes(String(r.orderId)));
    if (globalSearch.trim()) {
      const q = globalSearch.trim().toLowerCase();
      list = list.filter((r) =>
        r.productName.toLowerCase().includes(q) || r.productCode.toLowerCase().includes(q) ||
        r.customerName.toLowerCase().includes(q) || r.customerCode.toLowerCase().includes(q) ||
        (r.orderNo || "").toLowerCase().includes(q) ||
        String(r.sortNo ?? "").toLowerCase().includes(q) ||
        String(r.shadeNo ?? "").toLowerCase().includes(q));
    }
    if (customerSearch.trim()) {
      const q = customerSearch.trim().toLowerCase();
      list = list.filter((r) => r.customerName.toLowerCase().includes(q) || r.customerCode.toLowerCase().includes(q));
    }
    if (enquiryNoSearch.trim()) {
      const q = enquiryNoSearch.trim().toLowerCase();
      list = list.filter((r) => (r.orderNo || "").toLowerCase().includes(q));
    }
    if (productSearch.trim()) {
      const q = productSearch.trim().toLowerCase();
      list = list.filter((r) => r.productName.toLowerCase().includes(q) || r.productCode.toLowerCase().includes(q));
    }
    if (inquiryDate) list = list.filter((r) => r.inquiryDate === inquiryDate);
    if (stateFilter) list = list.filter((r) => (r.state ? sameName(r.state, stateFilter) : stateOfDistrict(r.district) === stateFilter));
    if (districtFilter) {
      const dq = districtFilter.toLowerCase().replace(/[^a-z]/g, "");
      list = list.filter((r) => {
        const rd = String(r.district || "").toLowerCase().replace(/[^a-z]/g, "");
        return rd && (rd === dq || rd.includes(dq));
      });
    }
    if (officerFilter) list = list.filter((r) => r.officerName === officerFilter);
    if (allocStatusFilter) {
      list = list.filter((r) => {
        if (isSystemAdminRole) return approvalStatusKey(r) === allocStatusFilter;
        const available = liveAvailableByProduct.get(r.productId) ?? r.poolAvailable;
        return stockStatusKey(r, available, totalAllocFor(r)) === allocStatusFilter;
      });
    }
    if (uomStatusFilter) list = list.filter((r) => r.uom === uomStatusFilter);
    return list;
  }, [activeRows, globalSearch, customerSearch, productSearch, inquiryDate, stateFilter, districtFilter, officerFilter, allocStatusFilter, uomStatusFilter, enquiryNoSearch, allocInputs, liveAvailableByProduct, focusIds]);

  // Pill counts = order lines left after the filters above, per category.
  const catCounts = useMemo(() => {
    const m = { all: filteredNoCat.length };
    CATEGORY_GROUPS.forEach((g) => { m[g.id] = 0; });
    filteredNoCat.forEach((r) => { m[r.group.id] = (m[r.group.id] || 0) + 1; });
    return m;
  }, [filteredNoCat, CATEGORY_GROUPS]);

  const visibleRows = useMemo(() => {
    const sorted = activeCat === "all" ? [...filteredNoCat] : filteredNoCat.filter((r) => r.group.id === activeCat);
    sorted.sort((a, b) => {
      const pa = rowPriority(a), pb = rowPriority(b);
      if (pa !== pb) return pa - pb;
      // Among partial orders: most recently allocated first.
      if (pa === -1) {
        const ha = hoursSince(a.firstAllocatedAt) ?? Infinity;
        const hb = hoursSince(b.firstAllocatedAt) ?? Infinity;
        if (ha !== hb) return ha - hb;
      }
      return viewBy === "customer"
        ? (a.customerName.localeCompare(b.customerName) || a.productCode.localeCompare(b.productCode))
        : (a.productCode.localeCompare(b.productCode) || a.customerName.localeCompare(b.customerName));
    });
    return sorted;
  }, [filteredNoCat, activeCat, viewBy]);
  const allRowsSelected = visibleRows.length > 0 && visibleRows.every((r) => selectedRows.has(r.key));
  const selectedEligibleForDecision = visibleRows.filter((r) => selectedRows.has(r.key) && r.status === "pending" && r.allocationId);

  // ---- Alerts ------------------------------------------------------------
  const partialAlerts = useMemo(() => {
    return visibleRows
      .map((r) => ({ r, allocated: totalAllocFor(r) }))
      .filter(({ r, allocated }) => allocated > 0 && allocated < r.requested)
      .map(({ r, allocated }) => ({
        key: r.key,
        productName: r.productName,
        orderNo: r.orderNo,
        customerName: r.customerName,
        remaining: r.requested - allocated,
      }));
  }, [visibleRows, allocInputs]);

  const approvedAlerts = useMemo(() => visibleRows.filter((r) => r.status === "approved"), [visibleRows]);
  const rejectedAlerts = useMemo(() => visibleRows.filter((r) => r.status === "rejected"), [visibleRows]);
  const erpCreatedAlerts = useMemo(() => visibleRows.filter((r) => r.erpStatus === "erp_so_created"), [visibleRows]);

  const adminRemarksAlerts = useMemo(() => {
    if (isSystemAdminRole) return [];
    return visibleRows.filter((r) => totalAllocFor(r) > 0 && (r.remarks || "").trim());
  }, [visibleRows, isSystemAdminRole, allocInputs]);

  useEffect(() => {
    if (loading) return;
    const hasAlerts = isSystemAdminRole
      ? partialAlerts.length + approvedAlerts.length + rejectedAlerts.length + erpCreatedAlerts.length > 0
      : partialAlerts.length + adminRemarksAlerts.length > 0;
    if (hasAlerts) setAlertModalOpen(true);
    // eslint-disable-next-line
  }, [loading]);

  // ---- Product Wise View grouping ------------------------------------
  const productGroups = useMemo(() => {
    const map = new Map();
    visibleRows.forEach((r) => {
      if (!map.has(r.productId)) {
        map.set(r.productId, {
          productId: r.productId,
          productCode: r.productCode,
          productName: r.productName,
          uom: r.uom,
          sortNo: r.sortNo,
          shadeNo: r.shadeNo,
          category: r.category,
          group: r.group,
          poolAvailable: liveAvailableByProduct.get(r.productId) ?? r.poolAvailable,
          requestedSum: 0,
          allocatedSum: 0,
          valueSum: 0,
          mtrSum: 0, // Σ (Allocated Qty × Allocated Mtr) for this product
          rows: [],
        });
      }
      const entry = map.get(r.productId);
      const allocated = shownAllocFor(r);
      entry.requestedSum += r.requested;
      entry.allocatedSum += allocated;
      entry.valueSum += allocated * r.price;
      entry.mtrSum += rowMtrTotal(r);
      entry.rows.push(r);
    });
    const groups = Array.from(map.values());
    groups.sort((a, b) => {
      const pa = Math.min(...a.rows.map(rowPriority));
      const pb = Math.min(...b.rows.map(rowPriority));
      if (pa !== pb) return pa - pb;
      return a.productCode.localeCompare(b.productCode);
    });
    return groups;
  }, [visibleRows, liveAvailableByProduct, allocInputs, meterInputs]);

  const toggleProductExpanded = (productId) =>
    setExpandedProducts((s) => ({ ...s, [productId]: !s[productId] }));

  const approvalStatus = (row) => APPROVAL_STATUS_META[approvalStatusKey(row)];
  const groupApprovalStatus = (g) => {
    const keys = g.rows.map((r) => approvalStatusKey(r));
    if (keys.some((k) => k === "pending" || k === "not_submitted")) return APPROVAL_STATUS_META.pending;
    if (keys.some((k) => k === "approved")) return APPROVAL_STATUS_META.approved;
    return APPROVAL_STATUS_META.rejected;
  };

  const groupErpStatus = (g) => {
    const submitted = g.rows.filter((r) => r.allocationId);
    if (submitted.length === 0) return { label: "Not Transferred", cls: "tag-neutral" };
    const allTransferred = submitted.every((r) => r.erpStatus === "erp_so_created");
    if (allTransferred) return { label: "ERP SO Created", cls: "tag-approved" };
    const anyTransferred = submitted.some((r) => r.erpStatus === "erp_so_created");
    if (anyTransferred) return { label: "Partially Transferred", cls: "tag-pending" };
    const pendingErp = submitted.filter((r) => r.erpStatus !== "erp_so_created");
    const allReady = pendingErp.every((r) => r.status === "approved");
    if (allReady) return { label: "Ready for ERP", cls: "tag-pending" };
    const anyReady = pendingErp.some((r) => r.status === "approved");
    if (anyReady) return { label: "Partially Ready", cls: "tag-pending" };
    return { label: "Not Transferred", cls: "tag-neutral" };
  };

  // Footer / summary totals, including the grand total of Allocated Mtr.
  const totals = visibleRows.reduce((a, r) => {
    const allocated = shownAllocFor(r);
    return {
      requested: a.requested + r.requested,
      allocated: a.allocated + allocated,
      value: a.value + allocated * r.price,
      mtr: a.mtr + rowMtrTotal(r),
    };
  }, { requested: 0, allocated: 0, value: 0, mtr: 0 });

  const distinctCustomers = new Set(visibleRows.map((r) => r.customerCode)).size;
  const distinctProductsAvailable = useMemo(() => {
    return visibleRows.reduce((map, r) => {
      if (!map.has(r.productId)) {
        map.set(r.productId, liveAvailableByProduct.get(r.productId) ?? (r.rowAvailable - r.savedAllocated));
      }
      return map;
    }, new Map());
  }, [visibleRows, liveAvailableByProduct]);
  const totalStockScope = Array.from(distinctProductsAvailable.values()).reduce((a, v) => a + v, 0);

  // ---- System Admin's four headline stats ----------------------------
  const pendingFinalApprovalCount = useMemo(() => rows.filter((r) => r.status === "pending").length, [rows]);
  const approvedTodayCount = useMemo(
    () => rows.filter((r) => r.status === "approved" && (r.decidedAt || "").slice(0, 10) === todayStr()).length,
    [rows]
  );
  const totalOrderValue = useMemo(() => rows.reduce((a, r) => a + r.savedAllocated * r.price, 0), [rows]);
  const erpTransferPendingCount = useMemo(
    () => rows.filter((r) => r.status === "approved" && r.erpStatus !== "erp_so_created").length,
    [rows]
  );

  // ---- Admin's four headline stats -----------------------------------
  const todayInquiriesCount = rows.length;
  const pendingAllocationCount = useMemo(
    () => rows.filter((r) => totalAllocFor(r) < r.requested).length,
    [rows, allocInputs]
  );

  const CAT_TO_STOCK_LABEL = {
    dhoti: "Dhoti", blouse: "Blouse", uniform_shirting: "Uniform Shirting",
    uniform_suiting: "Uniform Suiting", others: "Others", all: "all",
  };
  const [stockSummary, setStockSummary] = useState({});
  const loadStockSummary = () => {
    API.get("/products/available-stock-summary")
      .then((res) => setStockSummary(res.data || {}))
      .catch(() => { });
  };
  useEffect(() => { loadStockSummary(); }, []);
  const totalAvailableStockAll = stockSummary[CAT_TO_STOCK_LABEL[activeCat] || "all"] || 0;

  const awaitingApprovalCount = pendingFinalApprovalCount;

  const goToSalesOrder = (view) => navigate(`/master/sales-order?view=${view}`);

  const activeCatLabel = activeCat === "all" ? null : CATEGORY_GROUPS.find((g) => g.id === activeCat)?.name;
  const showCatColumn = activeCat === "all";
  const customerColCount = (isSystemAdminRole ? 19 : 17) + (showCatColumn ? 1 : 0);
  const productColCount = (showSelection ? 1 : 0) + 1 + 1 + 4 + 1 + (showCatColumn ? 1 : 0) + 5 + 5 + (isSystemAdminRole ? 3 : 0);
  const customerFooterSpan = (showCatColumn ? 6 : 5) + 6;
  const productFooterSpan = (showCatColumn ? 6 : 5) + (showSelection ? 1 : 0) + 6;

  // ---- Save / Reset / Draft / Export --------------------------------------
  const handleSaveAll = async () => {
    setSaving(true); setError(""); setOk("");
    try {
      const byProduct = new Map();
      rows.forEach((r) => {
        if (!byProduct.has(r.productId)) byProduct.set(r.productId, []);
        byProduct.get(r.productId).push(r);
      });

      const productErrors = [];
      const submittedKeys = [];
      let anySubmitted = false;

      // Each product is an independent request, so send them all at once
      // instead of waiting for one product to finish before the next.
      const jobs = [];
      for (const [productId, productRows] of byProduct.entries()) {
        const toSubmit = productRows.filter(
          (r) => r.orderId && r.key in allocInputs && Number(allocInputs[r.key]) > 0
        );
        if (toSubmit.length === 0) continue;
        jobs.push(
          API.post("/allocations", {
            productId,
            allocations: toSubmit.map((r) => ({
              orderId: r.orderId,
              customerId: r.customerId,
              allocatedQty: totalAllocFor(r),
              meters: meterToSend(r),
              cdFlag: cdFlagFor(r) === "Yes" ? 1 : 0,
              priceListCode: priceCodeFor(r) || null,
            })),
          })
            .then(() => {
              anySubmitted = true;
              toSubmit.forEach((r) => submittedKeys.push(r.key));
            })
            .catch((err) => {
              const productName = productRows[0]?.productName || `Product ${productId}`;
              const msg = err.response?.data?.message || "Failed to save.";
              productErrors.push(`${productName}: ${msg}`);
            })
        );
      }
      await Promise.all(jobs);

      await Promise.all(
        rows.filter((r) => r.allocationId && remarksFor(r) !== (r.remarks || ""))
          .map((r) => API.patch(`/allocations/${r.allocationId}/decision`, { remarks: remarksFor(r) }).catch(() => { }))
      );

      if (anySubmitted) {
        // Clear ONLY what was submitted — products that failed keep what the
        // user typed so they can fix and retry.
        const drop = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !submittedKeys.includes(k)));
        setAllocInputs(drop);
        setMeterInputs(drop);
        setCdFlagInputs(drop);
        setPriceCodeInputs(drop);
        setRemarksInputs({});
        if (productErrors.length === 0) localStorage.removeItem(DRAFT_STORAGE_KEY);
        try { localStorage.setItem("premier_mr_dirty", Date.now().toString()); } catch { /* ignore */ }
        // Refresh in the background — the button is released as soon as the
        // save itself is done, not after the whole board has been reloaded.
        loadBoard();
        loadStockSummary();
      }

      if (productErrors.length > 0) {
        setError((anySubmitted ? "Some products saved. Errors:\n" : "") + productErrors.join("\n"));
      } else if (anySubmitted) {
        setOk("Allocation saved & submitted for approval.");
      } else {
        setOk("Nothing new to submit — enter an allocated quantity first.");
      }
      // Make sure the message is actually seen.
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err.response?.data?.message || "Failed to save allocation.");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setSaving(false);
    }
  };

  const handleTransferToErp = async () => {
    const readyForErp = rows.filter((r) => r.allocationId && r.status === "approved" && r.erpStatus !== "erp_so_created");
    if (readyForErp.length === 0) return;
    setTransferringErp(true); setError(""); setOk("");
    try {
      const res = await API.post("/allocations/bulk-erp-transfer", { ids: readyForErp.map((r) => r.allocationId) });
      const data = res.data || {};
      const succeeded = data.updated || data.succeeded?.length || 0;
      const failed = data.failed || [];
      if (failed.length > 0 && succeeded === 0) {
        // All failed — show error
        const msgs = failed.map((f) => f.message || "Transfer failed").filter((v, i, a) => a.indexOf(v) === i);
        setError(`ERP transfer failed for all ${failed.length} row(s): ${msgs.join("; ")}`);
      } else if (failed.length > 0) {
        // Partial success
        setOk(`${succeeded} row(s) transferred to ERP. ${failed.length} row(s) failed — check Oracle connectivity.`);
      } else {
        setOk(`${succeeded || readyForErp.length} row(s) transferred to ERP.`);
      }
      await loadBoard();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to transfer to ERP.");
    } finally {
      setTransferringErp(false);
    }
  };


  const handleApprovalClick = () => {
    if (saving) return;
    if (isSystemAdminRole && selectedEligibleForDecision.length > 0) {
      bulkDecide("approved", selectedEligibleForDecision);
      return;
    }
    handleSaveAll();
  };

  const handleReset = () => { setAllocInputs({}); setRemarksInputs({}); setMeterInputs({}); setCdFlagInputs({}); setPriceCodeInputs({}); };

  const handleSaveDraft = () => {
    try {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ allocInputs, remarksInputs, meterInputs, cdFlagInputs, priceCodeInputs }));
      setOk("Draft saved on this device.");
    } catch {
      setError("Could not save draft (browser storage unavailable).");
    }
  };

  const handleExportExcel = () => {
    const data = visibleRows.map((r) => {
      const available = liveAvailableByProduct.get(r.productId) ?? r.poolAvailable;
      const allocated = totalAllocFor(r);
      const status = isSystemAdminRole ? approvalStatus(r).label : stockStatus(r, available, allocated).label;
      const row = {
        "Order No": r.orderNo,
        "Customer Name": r.customerName,
        "Customer Code": r.customerCode,
        "District": r.district,
        "Delivery Point": r.deliveryPoint,
        "Product Code": r.productCode,
        "Product Description": r.productName,
        "UOM": r.uom ? uomLabel(r.uom) : "",
        "Requested Qty": r.requested,
        "Available Stock": available,
        "Allocated Qty": allocated,
        "Meter (M)": displayMeterFor(r),
        "Total Mtr": round2(rowMtrTotal(r)),
        "Status": status,
      };
      if (isSystemAdminRole) {
        row["Remarks"] = remarksFor(r);
        row["ERP SO Status"] = r.erpStatus === "erp_so_created" ? "ERP SO Created" : "Not Transferred";
      }
      return row;
    });
    // Grand total row at the bottom of the sheet.
    if (data.length > 0) {
      data.push({
        "Order No": "TOTAL",
        "Requested Qty": totals.requested,
        "Allocated Qty": totals.allocated,
        "Total Mtr": round2(totals.mtr),
      });
    }
    const sheet = XLSX.utils.json_to_sheet(data);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Marketing Review");
    XLSX.writeFile(book, "marketing-review.xlsx");
  };

  const handlePrintSummary = () => {
    const win = window.open("", "_blank");
    if (!win) return;
    const rowsHtml = visibleRows.map((r) => {
      const available = liveAvailableByProduct.get(r.productId) ?? r.poolAvailable;
      const allocated = totalAllocFor(r);
      const status = isSystemAdminRole ? approvalStatus(r).label : stockStatus(r, available, allocated).label;
      return `<tr><td>${r.orderNo}</td><td>${r.customerName}</td><td>${r.customerCode}</td><td>${r.productCode}</td><td>${r.productName}</td><td>${r.uom ? uomLabel(r.uom) : "—"}</td><td style="text-align:right">${r.requested}</td><td style="text-align:right">${available}</td><td style="text-align:right">${allocated}</td><td style="text-align:center">${displayMeterFor(r) || "—"}</td><td style="text-align:right">${fmtMtr(rowMtrTotal(r))}</td><td>${status}</td></tr>`;
    }).join("");
    win.document.write(`<html><head><title>Marketing Review Summary</title>
      <style>body{font-family:Arial,sans-serif;padding:24px;color:#0F2138}
      table{width:100%;border-collapse:collapse;font-size:12px}
      th,td{border:1px solid #DBE3EC;padding:6px 8px;text-align:left}
      th{background:#122C48;color:#fff}
      tfoot td{font-weight:bold;background:#F1F5F9}
      h1{font-size:18px}</style></head><body>
      <h1>Marketing Review — Allocation Summary</h1>
      <p>Total Requested: ${totals.requested} Pcs · Total Allocated: ${totals.allocated} Pcs · Total Mtr: ${fmtMtr(totals.mtr)}</p>
      <table><thead><tr><th>Order No</th><th>Customer</th><th>Code</th><th>Product Code</th><th>Product</th><th>UOM</th><th>Requested</th><th>Available</th><th>Allocated</th><th>Meter (M)</th><th>Total Mtr</th><th>Status</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
      <tfoot><tr><td colspan="6" style="text-align:right">Total</td><td style="text-align:right">${totals.requested}</td><td></td><td style="text-align:right">${totals.allocated}</td><td></td><td style="text-align:right">${fmtMtr(totals.mtr)}</td><td></td></tr></tfoot></table>
      </body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };

  const statCardsSys = (
    <>
      <StatCardV2 icon={Hourglass} label="Pending Final Approval" value={pendingFinalApprovalCount} accent="#D69426"
        onViewDetails={() => goToSalesOrder("pending_final_approval")} />
      <StatCardV2 icon={ClipboardList} label="Approved Orders Today" value={approvedTodayCount} accent="#2E6B9E"
        onViewDetails={() => goToSalesOrder("approved_today")} />
      <StatCardV2 icon={PackageCheck} label="Total Order Value" value={`₹${totalOrderValue.toLocaleString()}`} accent="#2E7A72"
        onViewDetails={() => goToSalesOrder("total_order_value")} />
      <StatCardV2 icon={Truck} label="ERP Transfer Pending" value={erpTransferPendingCount} accent="#B23A3A"
        onViewDetails={() => goToSalesOrder("erp_transfer_pending")} />
    </>
  );

  const rowProps = (r, sNo) => ({
    r, sNo,
    available: liveAvailableByProduct.get(r.productId) ?? r.poolAvailable,
    showCatColumn,
    canManage,
    inputValue: allocFor(r),
    allocated: totalAllocFor(r),
    shownQty: shownAllocFor(r),
    onAlloc: (v) => setAlloc(r, v),
    onAutoAllocate: () => autoAllocateRow(r),
    meterValue: meterFor(r),
    onMeterChange: (v) => setMeter(r, v),
    cdFlagValue: cdFlagFor(r),
    onCdFlagChange: (v) => setCdFlagInputs((s) => ({ ...s, [r.key]: v })),
    priceCodeValue: priceCodeFor(r),
    onPriceCodeChange: (v) => setPriceCodeInputs((s) => ({ ...s, [r.key]: v })),
    priceCodeOptions: Array.from(new Set([DEFAULT_PRICE_CODE, ...priceCodeOptions])),
    statusTag: isSystemAdminRole ? approvalStatus(r) : stockStatus(r, liveAvailableByProduct.get(r.productId) ?? r.poolAvailable, totalAllocFor(r)),
    isSystemAdminRole,
    busy: busyDecision.has(r.allocationId),
    onApprove: () => decideRow(r, "approved"),
    onReject: () => decideRow(r, "rejected"),
    remarksValue: remarksFor(r),
    onRemarksChange: (v) => setRemarksInputs((s) => ({ ...s, [r.key]: v })),
    onRemarksBlur: () => saveRemarks(r),
    showSelection,
    selected: selectedRows.has(r.key),
    onToggleSelect: () => toggleOneRow(r.key),
    partialOpen: !!expandedPartials[r.key],
    onTogglePartial: () => setExpandedPartials((m) => ({ ...m, [r.key]: !m[r.key] })),
    colSpan: viewBy === "product" ? productColCount : customerColCount,
  });

  return (
    <Layout pageTitle="Marketing Review">
      <div className="font-body">
        {/* Partial parent = orange; balance (dropdown) row = white; no hover colour change on either. */}
        <style>{`
          .data-dark tbody tr.mr-partial-parent > td,
          .data-dark tbody tr.mr-partial-parent:hover > td { background: ${PARTIAL_ROW_BG} !important; }
          .data-dark tbody tr.mr-balance-row > td,
          .data-dark tbody tr.mr-balance-row:hover > td { background: #fff !important; }
        `}</style>

        <div className="mr-grid mr-grid-4 mr-mb-5">
          {isSystemAdminRole ? statCardsSys : (
            <>
              <StatCardV2 icon={ClipboardList} label="Today's Inquiries" value={todayInquiriesCount} accent="#2E6B9E"
                onViewDetails={() => goToSalesOrder("today_inquiries")} />
              <StatCardV2 icon={Hourglass} label="Pending Allocation" value={pendingAllocationCount} accent="#D69426"
                onViewDetails={() => goToSalesOrder("pending_allocation")} />
              <StatCardV2 icon={PackageCheck} label="Available Stock" value={`${totalAvailableStockAll.toLocaleString()} Mtr`} accent="#2E7A72"
                onViewDetails={() => navigate("/master/available-stock")} />
              <StatCardV2 icon={Hourglass} label="Awaiting Approval" value={awaitingApprovalCount} accent="#B23A3A"
                onViewDetails={() => goToSalesOrder("awaiting_approval")} />
            </>
          )}
        </div>

        {focusIds.length > 0 && (
          <div className="tag tag-pending mr-mb-4" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px" }}>
            <span>Showing balance allocation for enquiry <b>{focusEnquiry}</b></span>
            <button className="btn btn-ghost btn-sm" data-no-confirm onClick={() => setFocusIds([])}>Show all</button>
          </div>
        )}

        {error && <div className="tag tag-hold mr-mb-4" style={{ display: "block", padding: "10px 14px", whiteSpace: "pre-line" }}>{error}</div>}
        {ok && <div className="tag tag-approved mr-mb-4" style={{ display: "block", padding: "10px 14px" }}>{ok}</div>}

        <div className="card mr-p-3 mr-mb-4">
          <div style={{ display: "flex", flexWrap: "nowrap", gap: "12px", overflowX: "auto", alignItems: "flex-end" }}>
            <div style={{ flex: "1 1 0%", minWidth: 0, boxSizing: "border-box" }}>
              <label className="field-label">Enquiry Date</label>
              <input type="date" className="field" style={{ width: "100%", minWidth: 0, boxSizing: "border-box", borderColor: "#9AA7B5" }} value={inquiryDate} onChange={(e) => setInquiryDate(e.target.value)} />
            </div>
            <div style={{ flex: "1 1 0%", minWidth: 0, boxSizing: "border-box" }}>
              <label className="field-label">Enquiry No</label>
              <AutocompleteInput value={enquiryNoSearch} onChange={setEnquiryNoSearch} options={enquiryNoOptions} placeholder="Search Enquiry No" />
            </div>
            <div style={{ flex: "1 1 0%", minWidth: 0, boxSizing: "border-box" }}>
              <label className="field-label">Customer Name</label>
              <AutocompleteInput value={customerSearch} onChange={setCustomerSearch} options={customerNameOptions} placeholder="Search Customer" />
            </div>
            <div style={{ flex: "1 1 0%", minWidth: 0, boxSizing: "border-box" }}>
              <label className="field-label">State</label>
              <select className="field" style={{ width: "100%", minWidth: 0, boxSizing: "border-box", borderColor: "#9AA7B5" }} value={stateFilter}
                onChange={(e) => { const v = e.target.value; setStateFilter(v); if (v && districtFilter && !districtsOfState(v).includes(districtFilter)) setDistrictFilter(""); }}>
                <option value="">All States</option>
                {INDIA_STATES.map((st) => <option key={st} value={st}>{st}</option>)}
              </select>
            </div>
            <div style={{ flex: "1 1 0%", minWidth: 0, boxSizing: "border-box" }}>
              <label className="field-label">District</label>
              <select className="field" style={{ width: "100%", minWidth: 0, boxSizing: "border-box", borderColor: "#9AA7B5" }} value={districtFilter} onChange={(e) => setDistrictFilter(e.target.value)}>
                <option value="">{stateFilter ? `All Districts (${stateFilter})` : "All Districts"}</option>
                {districtsOfState(stateFilter).map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div style={{ flex: "1 1 0%", minWidth: 0, boxSizing: "border-box" }}>
              <label className="field-label">Sales Officer</label>
              <select className="field" style={{ width: "100%", minWidth: 0, boxSizing: "border-box", borderColor: "#9AA7B5" }} value={officerFilter} onChange={(e) => setOfficerFilter(e.target.value)}>
                <option value="">All</option>
                {officerOptions.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div style={{ flex: "0 0 auto", display: "flex", gap: 8 }}>
              <button className="btn btn-primary btn-sm" style={{ padding: "7px 14px", fontSize: 12.5, whiteSpace: "nowrap", background: "#1C7A4B" }} onClick={loadBoard}><Search size={12} /> Search</button>
              <button className="btn btn-ghost btn-sm" style={{ padding: "7px 14px", fontSize: 12.5, whiteSpace: "nowrap" }} onClick={() => { setCustomerSearch(""); setEnquiryNoSearch(""); setProductSearch(""); setInquiryDate(""); setStateFilter(""); setDistrictFilter(""); setOfficerFilter(""); setGlobalSearch(""); setAllocStatusFilter(""); setUomStatusFilter(""); setFocusIds([]); }}>Clear</button>
            </div>
          </div>
        </div>

        <div className="mr-flex mr-gap-3 mr-mb-4" style={{ flexWrap: "nowrap", overflowX: "auto" }}>
          {CATEGORY_GROUPS.map((g) => {
            const Icon = g.icon;
            const active = activeCat === g.id;
            return (
              <button
                key={g.id}
                onClick={() => setActiveCat(g.id)}
                className={`cat-tab ${active ? "active" : ""}`}
                style={{ background: g.color, boxShadow: active ? `0 0 0 2px ${g.color}, 0 0 0 4px #ffffff55` : undefined }}
              >
                <span className="cat-tab-icon"><Icon size={15} color="#fff" /></span>
                <span className="mr-text-left">
                  {g.name}
                  <span className="cat-tab-count">{catCounts[g.id] || 0} Order Lines</span>
                </span>
              </button>
            );
          })}
        </div>

        <div style={{ position: "relative", maxWidth: 760, marginBottom: 22 }}>
          <Search size={16} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "#8C96A3", zIndex: 2, pointerEvents: "none" }} />
          <AutocompleteInput
            value={globalSearch}
            onChange={setGlobalSearch}
            options={globalSearchOptions}
            placeholder="Search product, customer, order no, sort no or shade…"
            inputStyle={{ paddingLeft: 40, padding: "10px 14px 10px 40px", fontSize: 13.5 }}
          />
        </div>

        <AlertModal
          open={alertModalOpen}
          onClose={() => setAlertModalOpen(false)}
          sections={[
            {
              icon: AlertTriangle, color: "#B2622E",
              title: `${partialAlerts.length} order${partialAlerts.length === 1 ? "" : "s"} partially allocated — stock still owed`,
              items: mostRecentOne(partialAlerts, null),
              renderItem: (a) => (
                <>
                  <b className="text-pine">{a.productName}</b> — Order <b>{a.orderNo}</b> ({a.customerName}):{" "}
                  <span style={{ color: "#B2622E", fontWeight: 600 }}>{a.remaining} Pcs pending</span>
                </>
              ),
            },
            ...(isSystemAdminRole ? [
              {
                icon: Check, color: "#1C7A4B",
                title: `${approvedAlerts.length} order${approvedAlerts.length === 1 ? "" : "s"} approved`,
                items: mostRecentOne(approvedAlerts, "decidedAt"),
                renderItem: (r) => (
                  <>
                    <b className="text-pine">{r.productName}</b> — Order <b>{r.orderNo}</b> ({r.customerName}):{" "}
                    <span style={{ color: "#1C7A4B", fontWeight: 600 }}>{r.savedAllocated} Pcs</span>
                  </>
                ),
              },
              {
                icon: X, color: "#B23A3A",
                title: `${rejectedAlerts.length} order${rejectedAlerts.length === 1 ? "" : "s"} rejected`,
                items: mostRecentOne(rejectedAlerts, "decidedAt"),
                renderItem: (r) => (
                  <>
                    <b className="text-pine">{r.productName}</b> — Order <b>{r.orderNo}</b> ({r.customerName})
                  </>
                ),
              },
              {
                icon: Truck, color: "#2E6B9E",
                title: `${erpCreatedAlerts.length} order${erpCreatedAlerts.length === 1 ? "" : "s"} — ERP SO Created`,
                items: mostRecentOne(erpCreatedAlerts, "erpTransferredAt"),
                renderItem: (r) => (
                  <>
                    <b className="text-pine">{r.productName}</b> — Order <b>{r.orderNo}</b> ({r.customerName}):{" "}
                    <span style={{ fontWeight: 600 }}>{r.savedAllocated} Pcs</span>
                  </>
                ),
              },
            ] : [
              {
                icon: FileText, color: "#5B4B8C",
                title: `${adminRemarksAlerts.length} order${adminRemarksAlerts.length === 1 ? "" : "s"} — System Admin left remarks`,
                items: mostRecentOne(adminRemarksAlerts, null),
                renderItem: (r) => (
                  <>
                    <b className="text-pine">{r.productName}</b> — Order <b>{r.orderNo}</b> ({r.customerName}),{" "}
                    <span style={{ fontWeight: 600 }}>{totalAllocFor(r)} Pcs</span> allocated — "{r.remarks}"
                  </>
                ),
              },
            ]),
          ]}
        />

        <div className="mr-flex mr-items-center mr-gap-4 mr-mb-3 mr-flex-wrap mr-text-sm">
          <span className="text-slate mr-font-medium">View By:</span>
          <label className="mr-flex mr-items-center mr-gap-1 mr-cursor-pointer">
            <input type="radio" checked={viewBy === "product"} onChange={() => setViewBy("product")} /> Product Wise View
          </label>
          <label className="mr-flex mr-items-center mr-gap-1 mr-cursor-pointer">
            <input type="radio" checked={viewBy === "customer"} onChange={() => setViewBy("customer")} /> Customer Wise View
          </label>
          <div className="mr-flex mr-items-center mr-gap-2" style={{ marginLeft: "auto" }}>
            <select className="field" style={{ minWidth: 110, padding: "7px 10px", fontSize: 12.5, borderColor: "#9AA7B5" }} value={uomStatusFilter} onChange={(e) => setUomStatusFilter(e.target.value)}>
              <option value="">All UOM</option>
              {uomOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select className="field" style={{ minWidth: 150, padding: "7px 10px", fontSize: 12.5, borderColor: "#9AA7B5" }} value={allocStatusFilter} onChange={(e) => setAllocStatusFilter(e.target.value)}>
              {(isSystemAdminRole ? SYSADMIN_STATUS_OPTIONS : ADMIN_STATUS_OPTIONS).map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <button onClick={handleExportExcel} className="btn btn-sm btn-excel" style={{ padding: "9px 16px", fontSize: 13 }}><FileDown size={13} /> Export Excel</button>
            <button onClick={handlePrintSummary} className="btn btn-sm btn-print" style={{ padding: "9px 16px", fontSize: 13 }}><Printer size={13} /> Print Summary</button>
          </div>
        </div>
        {activeCatLabel && <div className="mr-mb-3"></div>}

        <div>
          <div className="card mr-p-3" style={{ minWidth: 0 }}>
            <div className="mr-overflow-x-auto mr-table-viewport" style={{ maxHeight: 560, overflowY: "auto" }}>
              {loading ? (
                <p className="mr-text-center mr-text-sm text-slate mr-py-8">Loading…</p>
              ) : viewBy === "product" ? (
                <table className="data-dark mr-w-full mr-product-table">
                  <colgroup>
                    {showSelection && <col style={{ width: 40 }} />}
                    <col style={{ width: 56 }} />
                    <col style={{ width: 120 }} />
                    <col style={{ width: 110 }} />
                    <col style={{ width: 120 }} />
                    <col style={{ width: 150 }} />
                    <col style={{ width: 260 }} />
                    <col style={{ width: 70 }} />
                    <col style={{ width: 130 }} />
                    <col style={{ width: 90 }} />
                    <col style={{ width: 90 }} />
                    <col style={{ width: 190 }} />
                    <col style={{ width: 90 }} />
                    {showCatColumn && <col style={{ width: 110 }} />}
                    <col style={{ width: 110 }} />
                    <col style={{ width: 120 }} />
                    <col style={{ width: 150 }} />
                    <col style={{ width: 100 }} />
                    <col style={{ width: 130 }} />
                    {isSystemAdminRole && <col style={{ width: 170 }} />}
                    {isSystemAdminRole && <col style={{ width: 150 }} />}
                    {isSystemAdminRole && <col style={{ width: 90 }} />}
                  </colgroup>
                  <thead>
                    <tr>
                      {showSelection && (
                        <th style={{ width: 40 }}>
                          <input type="checkbox" checked={allRowsSelected} onChange={() => toggleSelectAllRows(visibleRows.map((r) => r.key), allRowsSelected)} aria-label="Select all visible rows" />
                        </th>
                      )}
                      <th style={{ textAlign: "center" }}>S.No</th>
                      <th style={{ textAlign: "center" }}>Sort No</th>
                      <th style={{ textAlign: "center" }}>Enquiry Date</th>
                      <th style={{ textAlign: "center" }}>Shade</th>
                      <th style={{ textAlign: "center" }}>Product Code</th>
                      <th style={{ textAlign: "center" }}>Product Name</th>
                      <th style={{ textAlign: "center", whiteSpace: "nowrap" }}>Tax</th>
                      <th style={{ textAlign: "center", whiteSpace: "nowrap" }}>Payment</th>
                      <th style={{ textAlign: "center", whiteSpace: "nowrap" }}>CD Flag</th>
                      <th style={{ textAlign: "center", whiteSpace: "nowrap" }}>Price</th>
                      <th style={{ textAlign: "center", whiteSpace: "nowrap" }}>Delivery Point</th>
                      <th style={{ textAlign: "center" }}>UOM</th>
                      {showCatColumn && <th style={{ textAlign: "center" }}>Category</th>}
                      <th style={{ textAlign: "center" }}>Requested Qty</th>
                      <th style={{ textAlign: "center" }}>Available Stock</th>
                      <th style={{ textAlign: "center" }}>{isSystemAdminRole ? "Confirmed Qty" : "Allocated Qty"}</th>
                      <th style={{ textAlign: "center" }}>Allocated Mtr</th>
                      <th style={{ textAlign: "center" }}>Allocation Status</th>
                      {isSystemAdminRole && <th style={{ textAlign: "center" }}>Remarks</th>}
                      {isSystemAdminRole && <th style={{ textAlign: "center" }}>ERP SO Status</th>}
                      {isSystemAdminRole && <th style={{ textAlign: "center" }}>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {productGroups.map((g, gIdx) => {
                      const expanded = !!expandedProducts[g.productId];
                      const groupStatusTag = isSystemAdminRole ? groupApprovalStatus(g) : groupStockStatus(g);
                      const groupPendingRows = g.rows.filter((r) => r.status === "pending" && r.allocationId);
                      const remarksFilledCount = g.rows.filter((r) => (remarksFor(r) || "").trim()).length;
                      const groupErpTag = groupErpStatus(g);
                      return (
                        <Fragment key={g.productId}>
                          <tr className="mr-product-group-row" onClick={() => toggleProductExpanded(g.productId)}>
                            {showSelection && <td></td>}
                            <td className="text-slate mr-text-center">
                              <span className="mr-flex mr-items-center mr-justify-center mr-gap-2">
                                <span className="mr-product-chevron">
                                  {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                </span>
                                {gIdx + 1}
                              </span>
                            </td>
                            <td className="text-slate mr-text-center">{g.sortNo}</td>
                            <td className="text-slate mr-text-center">—</td>
                            <td className="text-slate mr-text-center">{g.shadeNo}</td>
                            {/* Product Code / Name: first 5 words + "...", full text in the hover card */}
                            <td className="mr-text-center">
                              <HoverCard code={g.productCode} name={g.productName}>
                                <b className="text-pine">{truncateWords(g.productCode)}</b>
                              </HoverCard>
                            </td>
                            <td className="mr-font-semibold text-pine mr-text-center">
                              <HoverCard code={g.productCode} name={g.productName}>
                                {truncateWords(g.productName)}
                              </HoverCard>
                            </td>
                            <td className="mr-text-xs text-slate mr-text-center mr-whitespace-nowrap">{dummyTax(g.productId)}</td>
                            <td className="mr-text-xs text-slate mr-text-center mr-whitespace-nowrap">{dummyPayment(g.productId)}</td>
                            <td className="text-slate mr-text-center">—</td>
                            <td className="text-slate mr-text-center">—</td>
                            <td className="mr-text-xs text-slate mr-text-center mr-whitespace-nowrap">{dummyDeliveryPoint(g.productId)}</td>
                            <td className="mr-text-xs text-slate mr-text-center">{g.uom ? uomLabel(g.uom) : "—"}</td>
                            {showCatColumn && (
                              <td className="mr-whitespace-nowrap mr-text-center"><span className="tag mr-font-semibold" style={{ background: g.group.tagBg, color: g.group.tagText, whiteSpace: "nowrap" }}>{g.group.name}</span></td>
                            )}
                            <td className="mr-font-semibold mr-text-center mr-tabular-nums">{g.requestedSum}</td>
                            <td className="mr-text-center mr-tabular-nums" style={{ color: stockColor(g.requestedSum, g.poolAvailable, g.allocatedSum) }}>{g.poolAvailable}</td>
                            <td className="mr-text-center mr-tabular-nums">{g.allocatedSum}</td>
                            {/* Total Mtr for this product = Σ (Allocated Qty × Mtr) of its orders */}
                            <td className="mr-text-center mr-text-xs mr-font-semibold mr-tabular-nums text-slate">{fmtMtr(g.mtrSum)}</td>
                            <td className="mr-text-center">
                              <span className={`tag ${groupStatusTag.cls}`}>{groupStatusTag.label}</span>
                            </td>
                            {isSystemAdminRole && (
                              <td className="mr-text-xs text-slate mr-whitespace-nowrap mr-text-center">{remarksFilledCount}/{g.rows.length} added</td>
                            )}
                            {isSystemAdminRole && (
                              <td className="mr-text-xs mr-whitespace-nowrap mr-text-center"><span className={`tag ${groupErpTag.cls}`}>{groupErpTag.label}</span></td>
                            )}
                            {isSystemAdminRole && (
                              <td onClick={(e) => e.stopPropagation()} className="mr-text-center">
                                <div className="mr-flex mr-justify-center mr-gap-1">
                                  <button
                                    onClick={() => bulkDecide("approved", groupPendingRows)}
                                    data-confirm={`Approve ${groupPendingRows.length} pending order(s) for this product?`}
                                    data-confirm-title="Approve Orders"
                                    disabled={groupPendingRows.length === 0}
                                    title={groupPendingRows.length ? `Approve ${groupPendingRows.length} pending row(s) for this product` : "No pending rows for this product"}
                                    className="btn btn-primary btn-sm"
                                    style={{ padding: "3px 7px" }}
                                  >
                                    <Check size={12} />
                                  </button>
                                  <button
                                    onClick={() => bulkDecide("rejected", groupPendingRows)}
                                    data-confirm={`Reject ${groupPendingRows.length} pending order(s) for this product?`}
                                    data-confirm-title="Reject Orders"
                                    disabled={groupPendingRows.length === 0}
                                    title={groupPendingRows.length ? `Reject ${groupPendingRows.length} pending row(s) for this product` : "No pending rows for this product"}
                                    className="btn btn-ghost btn-sm"
                                    style={{ padding: "3px 7px", color: "#B23A3A" }}
                                  >
                                    <X size={12} />
                                  </button>
                                </div>
                              </td>
                            )}
                          </tr>
                          {expanded && (
                            <tr className="mr-subhead-row">
                              {showSelection && <td></td>}
                              <td></td>
                              <td>Enquiry No.</td>
                              <td>Enquiry Date</td>
                              <td>Customer Name</td>
                              <td>Customer Code</td>
                              <td></td>
                              <td>Tax</td>
                              <td>Payment</td>
                              <td>CD Flag</td>
                              <td>Price</td>
                              <td>Delivery Point</td>
                              <td>UOM</td>
                              {showCatColumn && <td>Category</td>}
                              <td className="mr-text-center">Requested Qty</td>
                              <td className="mr-text-center">Available Stock</td>
                              <td className="mr-text-center">Allocated Quantity</td>
                              <td className="mr-text-center">Allocated Mtr</td>
                              <td>Allocation Status</td>
                              {isSystemAdminRole && <td>Remarks</td>}
                              {isSystemAdminRole && <td>ERP SO Status</td>}
                              {isSystemAdminRole && <td>Actions</td>}
                            </tr>
                          )}
                          {expanded && g.rows.map((r) => (
                            <AllocationRow key={r.key} showProductCols={false} {...rowProps(r, null)} />
                          ))}
                        </Fragment>
                      );
                    })}
                    {productGroups.length === 0 && (
                      <tr><td colSpan={productColCount} className="mr-text-center mr-text-sm text-slate mr-py-8">No active order demand in this view.</td></tr>
                    )}
                  </tbody>
                  {productGroups.length > 0 && (
                    <tfoot>
                      <tr className="mr-totals-row" style={{ position: "sticky", bottom: 0, zIndex: 2 }}>
                        <td colSpan={productFooterSpan}></td>
                        <td className="mr-text-center mr-font-semibold">Total</td>
                        <td className="mr-text-center mr-tabular-nums">{totals.requested}</td>
                        <td></td>
                        <td className="mr-text-center mr-tabular-nums">{totals.allocated}</td>
                        {/* Grand total Mtr across every product shown */}
                        <td className="mr-text-center mr-tabular-nums mr-font-semibold">{fmtMtr(totals.mtr)}</td>
                        <td></td>
                        {isSystemAdminRole && <><td></td><td></td><td></td></>}
                      </tr>
                    </tfoot>
                  )}
                </table>
              ) : (
                <table className="data-dark mr-w-full">
                  <thead>
                    <tr>
                      {showSelection && (
                        <th style={{ width: 34 }}>
                          <input type="checkbox" checked={allRowsSelected} onChange={() => toggleSelectAllRows(visibleRows.map((r) => r.key), allRowsSelected)} aria-label="Select all visible rows" />
                        </th>
                      )}
                      <th style={{ textAlign: "center" }}>S.No</th>
                      <th style={{ textAlign: "center" }}>Enquiry No</th>
                      <th style={{ textAlign: "center" }}>Enquiry Date</th>
                      <th style={{ textAlign: "center" }}>Customer Name</th>
                      {isSystemAdminRole ? (
                        <th style={{ textAlign: "center" }}>Customer Code</th>
                      ) : (
                        <>
                          <th style={{ textAlign: "center" }}>Product Code</th>
                          <th style={{ textAlign: "center" }}>Product Name</th>
                        </>
                      )}
                      {showCatColumn && <th style={{ textAlign: "center" }}>Category</th>}
                      <th style={{ textAlign: "center", whiteSpace: "nowrap" }}>Tax</th>
                      <th style={{ textAlign: "center", whiteSpace: "nowrap" }}>Payment</th>
                      <th style={{ textAlign: "center", whiteSpace: "nowrap" }}>CD Flag</th>
                      <th style={{ textAlign: "center", whiteSpace: "nowrap" }}>Price</th>
                      <th style={{ textAlign: "center", whiteSpace: "nowrap" }}>Delivery Point</th>
                      <th style={{ textAlign: "center" }}>UOM</th>
                      <th style={{ textAlign: "center" }}>Requested Qty</th>
                      {!isSystemAdminRole && <th style={{ textAlign: "center" }}>Available Stock</th>}
                      <th style={{ textAlign: "center" }}>{isSystemAdminRole ? "Confirmed Qty" : "Allocated Qty"}</th>
                      <th style={{ textAlign: "center" }}>Allocated Mtr</th>
                      <th style={{ textAlign: "center" }}>Allocation Status</th>
                      {isSystemAdminRole && <th style={{ textAlign: "center" }}>Remarks</th>}
                      {isSystemAdminRole && <th style={{ textAlign: "center" }}>ERP SO Status</th>}
                      {isSystemAdminRole && <th style={{ textAlign: "center" }}>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((r, idx) => (
                      <AllocationRow key={r.key} showProductCols {...rowProps(r, idx + 1)} />
                    ))}
                    {visibleRows.length === 0 && (
                      <tr><td colSpan={customerColCount} className="mr-text-center mr-text-sm text-slate mr-py-8">No active order demand in this view.</td></tr>
                    )}
                  </tbody>
                  {visibleRows.length > 0 && (
                    <tfoot>
                      <tr className="mr-totals-row" style={{ position: "sticky", bottom: 0, zIndex: 2 }}>
                        <td colSpan={customerFooterSpan}></td>
                        <td className="mr-text-center mr-font-semibold">Total</td>
                        <td className="mr-text-center mr-tabular-nums">{totals.requested}</td>
                        {!isSystemAdminRole && <td></td>}
                        <td className="mr-text-center mr-tabular-nums">{totals.allocated}</td>
                        {/* Grand total Mtr across every row shown */}
                        <td className="mr-text-center mr-tabular-nums mr-font-semibold">{fmtMtr(totals.mtr)}</td>
                        <td></td>
                        {isSystemAdminRole && <><td></td><td></td><td></td></>}
                      </tr>
                    </tfoot>
                  )}
                </table>
              )}
            </div>

            {canManage && (
              <div className="mr-flex mr-flex-wrap mr-gap-2 mr-justify-center mr-sticky-actions">
                <button
                  onClick={handleApprovalClick}
                  disabled={saving}
                  style={{ background: "#1C7A4B" }}
                  className="btn btn-primary btn-sm"
                  data-confirm={isSystemAdminRole && selectedEligibleForDecision.length > 0
                    ? `Approve ${selectedEligibleForDecision.length} selected order(s)?`
                    : isSystemAdminRole
                      ? undefined
                      : "Submit the allocated orders to System Admin for approval?"}
                  data-confirm-title="Approval"
                >
                  <Send size={20} />{" "}
                  {saving
                    ? "Saving…"
                    : isSystemAdminRole && selectedEligibleForDecision.length > 0
                      ? `Approve ${selectedEligibleForDecision.length} Selected`
                      : "Approval"}
                </button>
                <button onClick={handleReset} className="btn btn-sm btn-reset"><RotateCcw size={13} /> Reset Allocation</button>
                {isSystemAdminRole && (
                  <button
                    onClick={handleTransferToErp}
                    data-confirm={`Transfer ${erpTransferPendingCount} approved order(s) to ERP?`}
                    data-confirm-title="Transfer to ERP"
                    disabled={transferringErp || erpTransferPendingCount === 0}
                    title={erpTransferPendingCount === 0 ? "No Approved rows waiting for ERP transfer" : `Transfer ${erpTransferPendingCount} Approved row(s) to ERP`}
                    className="btn btn-sm btn-erp"
                  >
                    <Truck size={20} /> {transferringErp ? "Transferring…" : "Transfer to ERP"}
                  </button>
                )}
                <button onClick={handleSaveDraft} className="btn btn-sm btn-draft"><FileText size={20} /> Save Draft</button>
              </div>
            )}
          </div>

          <SummaryBar
            title="Allocation Summary"
            rows={[
              { label: "Total Customers", value: distinctCustomers },
              { label: "Total Requested Qty", value: `${totals.requested} Pcs` },
              { label: "Total Allocated Qty", value: `${totals.allocated} Pcs` },
              { label: "Total Allocated Mtr", value: fmtMtr(totals.mtr), color: "#2E6B9E" },
              { label: "Balance Stock", value: `${totalStockScope.toLocaleString()} Pcs` },
              { label: "Pending Final Approval", value: `${pendingFinalApprovalCount} Line(s)`, color: "#D69426" },
            ]}
          />
        </div>
      </div>
    </Layout>
  );
}

// ── Popup alert modal ──
function AlertModal({ open, onClose, sections }) {
  const visibleSections = sections.filter((s) => s.items.length > 0);
  if (!open || visibleSections.length === 0) return null;
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(15,33,56,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
      onClick={onClose}
    >
      <div className="card" style={{ maxWidth: 520, width: "92%", maxHeight: "80vh", overflowY: "auto", padding: 24 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 16px", color: "#0F2138" }}>Updates on this page</h3>
        {visibleSections.map((s, i) => (
          <div key={i} style={{ marginBottom: 16 }}>
            <div className="mr-flex mr-items-center mr-gap-2 mr-mb-2">
              <s.icon size={14} color={s.color} />
              <span className="mr-text-sm mr-font-semibold" style={{ color: s.color }}>{s.title}</span>
            </div>
            <div className="mr-flex-col mr-gap-1">
              {s.items.map((item, j) => (
                <div key={j} className="mr-text-xs text-slate">{s.renderItem(item)}</div>
              ))}
            </div>
          </div>
        ))}
        <div className="mr-flex mr-gap-2 mr-justify-center" style={{ marginTop: 20 }}>
          <button className="btn btn-primary btn-sm" data-no-confirm onClick={onClose}>OK</button>
          <button className="btn btn-ghost btn-sm" data-no-confirm onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Hover card for Product Code / Product Name ──────────────────────────
// Wraps the shortened (5-word) text. On hover it shows a small card with the
// FULL Product Code and Product Name. The card is position:fixed (placed from
// the hovered element's screen position) so the scrolling table container can
// never clip it. It flips above the text when there is no room below.
function HoverCard({ code, name, children }) {
  const [pos, setPos] = useState(null);

  const show = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const CARD_W = 380;
    const half = CARD_W / 2;
    const left = Math.min(Math.max(rect.left + rect.width / 2, half + 8), window.innerWidth - half - 8);
    const below = rect.bottom + 150 < window.innerHeight;
    setPos({ left, top: below ? rect.bottom + 6 : rect.top - 6, below });
  };
  const hide = () => setPos(null);

  return (
    <span
      onMouseEnter={show}
      onMouseLeave={hide}
      style={{ display: "inline-block", cursor: "help", maxWidth: "100%" }}
    >
      {children}
      {pos && (
        <div
          style={{
            position: "fixed",
            left: pos.left,
            top: pos.top,
            transform: pos.below ? "translateX(-50%)" : "translate(-50%, -100%)",
            width: 380,
            maxWidth: "calc(100vw - 16px)",
            zIndex: 2000,
            background: "#fff",
            border: "1px solid #DBE3EC",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(15,33,56,0.22)",
            padding: "12px 14px",
            textAlign: "left",
            whiteSpace: "normal",
            wordBreak: "break-word",
            fontWeight: 400,
            pointerEvents: "none",
          }}
        >
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "#6B7785", marginBottom: 2 }}>
            Product Code
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: "#0F2138", marginBottom: 10 }}>{code || "—"}</div>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "#6B7785", marginBottom: 2 }}>
            Product Name
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: "#0F2138" }}>{name || "—"}</div>
        </div>
      )}
    </span>
  );
}

// ── Shared allocation table row ─────────────────────────────────────────
function AllocationRow({
  r, sNo, available, showCatColumn, showProductCols, canManage, inputValue, allocated, shownQty, onAlloc, onAutoAllocate, statusTag,
  isSystemAdminRole, busy, onApprove, onReject, remarksValue, onRemarksChange, onRemarksBlur,
  meterValue, onMeterChange,
  cdFlagValue, onCdFlagChange,
  priceCodeValue, onPriceCodeChange, priceCodeOptions,
  showSelection, selected, onToggleSelect,
  partialOpen, onTogglePartial, colSpan,
}) {
  const requestedCap = isSystemAdminRole
    ? r.requested
    : Math.max(0, r.requested - r.savedAllocated);
  const meterMult = numOr1(meterValue);
  const maxAlloc = Math.min(requestedCap, Math.floor((available + inputValue * meterMult) / meterMult));
  const canDecide = isSystemAdminRole && r.allocationId && r.status === "pending";
  const isFullyAllocated = r.requested > 0 && r.savedAllocated >= r.requested;
  // Locks once Admin has submitted a real saved number; unlocks only if
  // System Admin rejects it.
  const isLocked = !isSystemAdminRole
    && !!r.allocationId
    && r.savedAllocated > 0
    && r.status !== 'rejected';
  const meterLocked = isLocked;
  // Allocated Mtr can only be typed once an Allocated Qty has been entered.
  const qtyEntered = Number(inputValue) > 0;

  // Partially allocated order (something saved, something still owed): the row
  // gets a chevron; opening it shows a second, column-aligned "balance" row
  // underneath with the REMAINING quantity (48h window from first allocation).
  const partial = isPartialRow(r);
  const remaining = Math.max(0, r.requested - r.savedAllocated);
  const left = partialHoursLeft(r);

  // rem = true renders the "remaining balance" row; false renders the order row.
  // Only the order (parent) row is orange; the balance row is white.
  const renderRow = (rem) => {
    // CD Flag / Price:
    //  - parent row: editable until it is submitted, read-only (saved values) after
    //  - balance row: editable (new increment's CD Flag / Price)
    //  - System Admin: always read-only
    const cdPriceEditable = canManage && !isSystemAdminRole && (rem ? isLocked : !isLocked);
    const showSaved = !rem && isLocked;
    const cdShown = showSaved ? (r.cdFlag || "No") : cdFlagValue;
    const priceShown = showSaved ? (r.priceListCode || DEFAULT_PRICE_CODE) : priceCodeValue;

    return (
      <tr className={rem ? "mr-balance-row" : (partial ? "mr-partial-parent" : undefined)}>
        {showSelection && (
          rem ? <td></td> : (
            <td className="mr-text-center">
              <input type="checkbox" checked={!!selected} onChange={onToggleSelect} aria-label={`Select allocation row ${r.orderNo}`} />
            </td>)
        )}
        {rem ? <td></td> : (
          <td className="text-slate mr-text-center">
            <span className="mr-flex mr-items-center mr-justify-center mr-gap-2">
              {partial && (
                <button
                  type="button" data-no-confirm onClick={onTogglePartial}
                  title={`${remaining} pending${left !== null ? " · " + fmtLeft(left) : ""} — click to ${partialOpen ? "hide" : "show"}`}
                  className="mr-product-chevron"
                  style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "#8A5A0E", display: "inline-flex" }}
                >
                  {partialOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </button>
              )}
              {sNo != null ? sNo : ""}
            </span>
          </td>)}
        <td className="mr-text-xs mr-font-semibold text-pine mr-whitespace-nowrap mr-text-center">{r.orderNo}</td>
        <td className="mr-text-xs text-slate mr-whitespace-nowrap mr-text-center">{formatEnquiryDate(r.inquiryDate)}</td>
        {showProductCols ? (
          <>
            <td className="mr-font-medium mr-text-center">{r.customerName}</td>
            {isSystemAdminRole ? (
              <td className="mr-text-xs mr-whitespace-nowrap mr-text-center">{r.customerCode}</td>
            ) : (
              <>
                {/* Product Code / Name: first 5 words + "...", full text in the hover card */}
                <td className="mr-text-xs mr-whitespace-nowrap mr-text-center">
                  <HoverCard code={r.productCode} name={r.productName}>
                    {truncateWords(r.productCode)}
                  </HoverCard>
                </td>
                <td className="mr-text-xs mr-text-center">
                  <HoverCard code={r.productCode} name={r.productName}>
                    {truncateWords(r.productName)}
                  </HoverCard>
                </td>
              </>
            )}
            {showCatColumn && (
              <td className="mr-whitespace-nowrap mr-text-center"><span className="tag mr-font-semibold" style={{ background: r.group.tagBg, color: r.group.tagText, whiteSpace: "nowrap" }}>{r.group.name}</span></td>
            )}
          </>
        ) : (
          <>
            <td className="mr-font-medium mr-text-center">{r.customerName}</td>
            <td className="mr-text-xs mr-whitespace-nowrap mr-text-center">{r.customerCode}</td>
            <td></td>
          </>
        )}
        <td className="mr-text-xs text-slate mr-text-center mr-whitespace-nowrap">{dummyTax(r.key)}</td>
        <td className="mr-text-xs text-slate mr-text-center mr-whitespace-nowrap">{dummyPayment(r.key)}</td>
        <td className="mr-text-center mr-whitespace-nowrap">
          {!cdPriceEditable ? (
            <span className="mr-text-xs" style={{ color: cdShown === "Yes" ? "#1C7A4B" : "#6B7785", fontWeight: 600 }}>{cdShown}</span>
          ) : (
            <select
              className="field"
              value={cdFlagValue}
              onChange={(e) => onCdFlagChange(e.target.value)}
              style={{ width: 70, padding: "4px 6px", fontSize: 12, textAlign: "center", fontWeight: 600, color: cdFlagValue === "Yes" ? "#1C7A4B" : "#6B7785" }}
            >
              <option value="No">No</option>
              <option value="Yes">Yes</option>
            </select>
          )}
        </td>
        <td className="mr-text-center mr-whitespace-nowrap">
          {!cdPriceEditable ? (
            <span className="mr-text-xs text-slate">{priceShown || "—"}</span>
          ) : (
            <select
              className="field"
              value={priceCodeValue}
              onChange={(e) => onPriceCodeChange(e.target.value)}
              style={{ width: 92, padding: "4px 6px", fontSize: 12, textAlign: "center" }}
            >
              <option value="">—</option>
              {priceCodeOptions.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          )}
        </td>
        {/* Delivery Point: "<number> <name>" from Oracle (dummy only if Oracle has none) */}
        <td className="mr-text-xs text-slate mr-text-center mr-whitespace-nowrap">{r.deliveryPoint || dummyDeliveryPoint(r.key)}</td>
        <td className="mr-text-xs text-slate mr-text-center">{r.uom ? uomLabel(r.uom) : "—"}</td>
        {!showProductCols && showCatColumn && (
          <td className="mr-whitespace-nowrap mr-text-center"><span className="tag mr-font-semibold" style={{ background: r.group.tagBg, color: r.group.tagText, whiteSpace: "nowrap" }}>{r.group.name}</span></td>
        )}
        <td className="mr-font-semibold mr-text-center mr-tabular-nums" style={rem ? { color: "#8A5A0E" } : undefined}>{rem ? remaining : r.requested}</td>
        {(!showProductCols || !isSystemAdminRole) && (
          <td className="mr-text-center mr-tabular-nums" style={{ color: stockColor(r.requested, available, allocated) }}>
            {available}
          </td>
        )}
        {/* Allocated Qty — in the balance row Admin allocates the REMAINING qty
            here (the box is an increment on top of what's already saved). */}
        {rem && isSystemAdminRole ? <td className="mr-text-center text-slate">—</td> : (
          <td className="mr-text-center">
            {!rem && (isLocked || isSystemAdminRole) ? (
              <span className="mr-font-semibold mr-tabular-nums" style={{ color: isFullyAllocated ? "#1C7A4B" : undefined }}>
                {shownQty ?? allocated}
              </span>
            ) : (
              <div className="mr-flex mr-items-center mr-justify-center mr-gap-1">
                <input
                  type="number" min={0} max={maxAlloc}
                  value={inputValue === 0 ? "" : inputValue}
                  placeholder="0"
                  disabled={!canManage}
                  onChange={(e) => onAlloc(e.target.value)}
                  className="field mr-text-right" style={{ width: 64, padding: "4px 6px" }}
                />
                {canManage && (
                  <button title={`Allocate max (${maxAlloc})`} onClick={onAutoAllocate} className="btn btn-ghost btn-sm" style={{ padding: 4 }}>
                    <Zap size={12} />
                  </button>
                )}
              </div>
            )}
          </td>)}

        {/* Allocated Mtr — the order row shows its own saved Mtr; the balance
            row is a fresh, empty box (like a new row), not a copy of the parent's.
            The box only accepts input once an Allocated Qty has been entered.
            Typed values are capped in Batches (setMeter) so stock never goes below 0. */}
        {rem && isSystemAdminRole ? <td className="mr-text-center text-slate">—</td> : (
          <td className="mr-text-center">
            {!rem && (isSystemAdminRole || meterLocked) ? (
              <span className="mr-text-xs text-slate">{(isSystemAdminRole ? meterValue : r.meters) || "—"}</span>
            ) : (
              <input
                type="text"
                placeholder="e.g. 5M"
                disabled={!canManage}
                value={meterValue}
                onFocus={(e) => {
                  if (!qtyEntered) {
                    e.target.blur();
                    window.alert("Enter the Allocated Qty first, then the Allocated Mtr.");
                  }
                }}
                onChange={(e) => { if (qtyEntered) onMeterChange(e.target.value); }}
                className="field mr-text-center"
                style={{ width: 76, padding: "4px 6px", textAlign: "center", opacity: qtyEntered ? 1 : 0.6 }}
              />
            )}
          </td>)}

        <td className="mr-text-center">
          {rem
            ? <span className="tag tag-pending">{`Pending balance${left !== null ? " · " + fmtLeft(left) : ""}`}</span>
            : <span className={`tag ${statusTag.cls}`}>{statusTag.label}</span>}
        </td>
        {isSystemAdminRole && (rem ? <td></td> : (
          <td className="mr-text-center" style={{ minWidth: 140 }}>
            {r.allocationId && r.status !== "pending" ? (
              <span className="mr-text-xs text-slate">{remarksValue || "—"}</span>
            ) : (
              <input
                type="text"
                placeholder="Add remarks…"
                className="field mr-text-xs"
                style={{ width: "100%", padding: "4px 6px" }}
                value={remarksValue}
                onChange={(e) => onRemarksChange(e.target.value)}
                onBlur={onRemarksBlur}
                disabled={!r.allocationId}
              />
            )}
          </td>
        ))}
        {isSystemAdminRole && (rem ? <td></td> : (
          <td className="mr-text-xs mr-whitespace-nowrap mr-text-center">
            {r.erpStatus === "erp_so_created" ? (
              <span className="tag tag-approved">ERP SO Created</span>
            ) : r.status === "approved" ? (
              <span className="tag tag-pending">Ready for ERP</span>
            ) : (
              <span className="tag tag-neutral">Not Transferred</span>
            )}
          </td>
        ))}
        {isSystemAdminRole && (rem ? <td></td> : (
          <td className="mr-text-center">
            <div className="mr-flex mr-justify-center mr-gap-1">
              <button
                onClick={onApprove}
                data-confirm="Approve this order? It moves on to ERP transfer."
                data-confirm-title="Approve Order"
                disabled={!canDecide || busy}
                title={canDecide ? "Approve" : "Only a Pending row can be actioned"}
                className="btn btn-primary btn-sm"
                style={{ padding: "3px 7px" }}
              >
                <Check size={12} />
              </button>
              <button
                onClick={onReject}
                data-confirm="Reject this order? It goes back to Admin."
                data-confirm-title="Reject Order"
                disabled={!canDecide || busy}
                title={canDecide ? "Reject" : "Only a Pending row can be actioned"}
                className="btn btn-ghost btn-sm"
                style={{ padding: "3px 7px", color: "#B23A3A" }}
              >
                <X size={12} />
              </button>
            </div>
          </td>
        ))}
      </tr>
    );
  };

  return (
    <>
      {renderRow(false)}
      {partial && partialOpen && renderRow(true)}
    </>
  );
}

// ── Autocomplete text input ─────────────────────────────────────────
function AutocompleteInput({ value, onChange, options, placeholder, inputStyle }) {
  const [open, setOpen] = useState(false);
  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return [];
    return options.filter((o) => o.toLowerCase().includes(q)).slice(0, 12);
  }, [options, value]);
  return (
    <div style={{ position: "relative" }}>
      <input
        type="text"
        placeholder={placeholder}
        className="field"
        style={{ width: "100%", minWidth: 0, boxSizing: "border-box", borderColor: "#9AA7B5", ...inputStyle }}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => value.trim() && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && filtered.length > 0 && (
        <div
          style={{
            position: "absolute", top: "calc(100% + 2px)", left: 0, right: 0, zIndex: 30,
            background: "#fff", border: "1px solid #DBE3EC", borderRadius: 6,
            maxHeight: 190, overflowY: "auto", boxShadow: "0 6px 16px rgba(15,33,56,0.14)",
          }}
        >
          {filtered.map((opt) => (
            <div
              key={opt}
              onMouseDown={() => { onChange(opt); setOpen(false); }}
              className="mr-text-xs"
              style={{ padding: "8px 12px", cursor: "pointer", color: "#0F2138" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#F1F5F9")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {opt}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCardV2({ icon: Icon, label, value, accent, onViewDetails }) {
  return (
    <div className="stat-v2" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
      <div className="mr-flex mr-items-center mr-gap-3">
        <div className="stat-v2-icon" style={{ background: `${accent}1E` }}>
          <Icon size={19} color={accent} />
        </div>
        <div className="mr-flex-col mr-min-w-0">
          <div className="stat-v2-label">{label}</div>
          <div className="stat-v2-value" style={{ color: accent }}>{value}</div>
        </div>
      </div>
      {onViewDetails && (
        <button onClick={onViewDetails} className="stat-v2-link" style={{ background: "none", border: "none", cursor: "pointer", color: accent, padding: 0 }}>
          View Details <ArrowUpRight size={12} />
        </button>
      )}
    </div>
  );
}

function SummaryBar({ title, rows }) {
  return (
    <div className="card mr-p-3 mr-mt-4">
      {title && (
        <div className="mr-flex mr-items-center mr-gap-2 mr-mb-3">
          <ShoppingCart size={15} className="text-pine" />
          <span className="mr-font-semibold mr-text-sm text-pine">{title}</span>
        </div>
      )}
      <div className="mr-flex mr-flex-wrap" style={{ gap: 0 }}>
        {rows.map((r, i) => (
          <div key={i} style={{ minWidth: 140, padding: "0 24px", marginBottom: 8, borderRight: i < rows.length - 1 ? "1px solid #B7C2CE" : "none" }}>
            <div className="mr-text-xs text-slate" style={{ marginBottom: 4 }}>{r.label}</div>
            <div className="mr-font-semibold" style={{ fontSize: 16, color: r.color || undefined }}>{r.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}