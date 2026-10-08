import { useTheme } from "../../ThemeContext";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../../components/Layout";
import { getG, getRowColors, statusColor } from "../../theme";
import API from "../../services/api";
import ExcelToolbar from "../../components/ExcelToolbar";

const FONT = "'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// Columns shown in the Product List table — Excel download/upload
// columns are always kept identical to this list. Status is left out:
// it's not something that should be edited via a re-uploaded
// spreadsheet, and having it round-trip through Excel was a source of
// confusion (see CUSTOMER_EXCEL_COLUMNS in CustomerList.jsx for the
// same reasoning).
//
// Specs and Price have been dropped from this table/export — they
// aren't relevant at this list level. Sort No and Shade No are pulled
// in instead, matching the columns already shown on the customer-facing
// Product Catalog page (ProductCatalog.jsx), so both screens describe
// a product the same way.
const PRODUCT_EXCEL_COLUMNS = [
  { key: "sortNo",  header: "Sort No" },
  { key: "shadeNo", header: "Shade No" },
  { key: "name",    header: "Product Name" },
  { key: "type",    header: "Type" },
  { key: "color",   header: "Color" },
  { key: "qty",     header: "Qty" },
];

// Built-in defaults shown even if no products of that sub-type exist yet
const YARN_DEFAULTS  = ["Bundle", "Hank", "Cone"];
const CLOTH_DEFAULTS = ["Dhoti", "Blouse", ];

// ── Dummy fallbacks for Sort No / Shade No — same source list used on
// the customer Product Catalog page, so a product looks the same way
// in both places. Real values from the API win whenever they're
// actually present; these only fill the gap.
const DUMMY_SHADE_NOS = ["101", "102", "103", "104", "105", "106"];

function dummySortNo(product, i) {
  return product.SortNo || product.Code || String(i + 1).padStart(3, "0");
}
// Dhoti-family SubTypes use "Border No" instead of "Shade No" — same
// underlying ShadeNo/Code 8 data, different business term for this one
// product family. Prefixing the cell itself (not just the column
// header) keeps this readable even when the list isn't filtered down
// to a single SubType.
const DHOTI_SUBTYPES = new Set(["Dhoti", "dhoti", "Cotton Dhoti Grey", "cotton dhoti grey", "BO Grey - Dhothies", "Cotton Dhoti Fabric", "cotton dhoti fabric", "BO Fabric - Dhothies"]);
function dummyShadeNo(product, i) {
  const num = product.ShadeNo || DUMMY_SHADE_NOS[i % DUMMY_SHADE_NOS.length];
  return DHOTI_SUBTYPES.has(product.SubType) ? `BORDER ${num}` : `SHADE ${num}`;
}

const ColorDot = ({ hex }) => (
  <span style={{ display:"inline-block", width:14, height:14, borderRadius:"50%", background:hex, border:"1.5px solid rgba(0,0,0,0.14)", verticalAlign:"middle", marginRight:7, flexShrink:0 }} />
);

const Badge = ({ text }) => {
  const s = statusColor(text);
  return (
    <span style={{ ...s, padding:"3px 11px", borderRadius:20, fontSize:12, fontWeight:600, border:`1px solid ${s.border}`, fontFamily:FONT }}>
      {text.charAt(0).toUpperCase() + text.slice(1)}
    </span>
  );
};

export default function ProductList() {
  const { isDark } = useTheme();
  const themeG    = getG(isDark);
  const ROW_COLORS = getRowColors(isDark);
  const navigate  = useNavigate();

  // ── Locked to stored category — no toggle shown ──
  const tab = localStorage.getItem("premier_category") || "cloth";

  const [subType, setSubType] = useState("All");
  const [search,  setSearch]  = useState("");
  const [allProducts, setAllProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState("");
  const [deletingId, setDeletingId] = useState(null);

  const load = async () => {
    try {
      const res = await API.get("/products");
      const mapped = res.data.map((p, i) => ({
        id:       p.Code,
        dbId:     p.Id,
        name:     p.Name,
        type:     p.SubType,
        category: p.Category,
        color:    p.Color,
        sortNo:   dummySortNo(p, i),
        shadeNo:  dummyShadeNo(p, i),
        qty:      p.Quantity,
        status:   p.Status,
      }));
      setAllProducts(mapped);
    } catch (err) {
      setError("Failed to load products.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const handleDelete = async (p) => {
    if (!window.confirm(`Delete product ${p.name} (${p.id})? This cannot be undone.`)) return;
    setDeletingId(p.dbId);
    setError("");
    try {
      await API.delete(`/products/${p.dbId}`);
      setAllProducts((list) => list.filter((x) => x.dbId !== p.dbId));
    } catch (err) {
      setError(err.response?.data?.message || "Failed to delete product.");
    } finally {
      setDeletingId(null);
    }
  };

  // A product's own Code + a name/sub-type pairing, both normalised for
  // case/whitespace — used to recognise an uploaded row as something
  // that already exists rather than a genuinely new product.
  const normalizeNameType = (name, type) => `${String(name ?? "").trim().toLowerCase()}|${String(type ?? "").trim().toLowerCase()}`;

  // Bulk-add products from an uploaded Excel file. Category is whatever
  // this page is currently locked to (matches page content).
  //
  // People generally re-download the current list, tweak a few cells,
  // and re-upload it — so most rows in that file already exist. Skip
  // any row that matches a product already in the system instead of
  // inserting it again:
  //   1. Primary check — the row's own "ID" column (that product's
  //      Code, carried over from a previous download) matches an
  //      existing product exactly.
  //   2. Fallback — for a genuinely new row with no Code yet, match by
  //      Name + Type within this category instead, updated as we go so
  //      two duplicate new rows in the same upload don't both get created.
  const handleImportRows = async (rows) => {
    let created = 0, failed = 0, duplicates = 0;
    const existingCodes = new Set(allProducts.map((p) => p.id)); // p.id = Product Code
    const existingNameType = new Set(
      allProducts.filter((p) => p.category === tab).map((p) => normalizeNameType(p.name, p.type))
    );

    for (const row of rows) {
      if (!row.name || !row.type || row.qty === undefined || row.qty === "") { failed++; continue; }

      if (row.id && existingCodes.has(String(row.id).trim())) { duplicates++; continue; }

      const nameTypeKey = normalizeNameType(row.name, row.type);
      if (existingNameType.has(nameTypeKey)) { duplicates++; continue; }

      try {
        await API.post("/products", {
          tab: tab,
          subType: String(row.type).toLowerCase(),
          name: row.name,
          qty: parseInt(row.qty, 10) || 0,
          color: row.color || undefined,
          sortNo: row.sortNo || undefined,
          shadeNo: row.shadeNo || undefined,
        });
        created++;
        existingNameType.add(nameTypeKey);
      } catch {
        failed++;
      }
    }
    await load();
    return { created, failed, duplicates };
  };

  const products = allProducts.filter((p) => p.category === tab);

  const defaults = tab === "yarn" ? YARN_DEFAULTS : CLOTH_DEFAULTS;
  const seenTypes = products.map((p) => p.type).filter(Boolean);
  // Merge defaults with any sub-types actually present in the data (covers custom sub-types like "Lungi", "Saree", "Towel"),
  // de-duplicated case-insensitively, defaults first in their usual order, then any extras alphabetically.
  const extraTypes = [...new Set(seenTypes)]
    .filter((t) => !defaults.some((d) => d.toLowerCase() === t.toLowerCase()))
    .sort((a, b) => a.localeCompare(b));
  const typeList = ["All", ...defaults, ...extraTypes];

  const filtered = products.filter((p) => {
    const matchType = subType === "All" || p.type.toLowerCase() === subType.toLowerCase();
    const matchSrch = p.name.toLowerCase().includes(search.toLowerCase()) || p.id.toLowerCase().includes(search.toLowerCase());
    return matchType && matchSrch;
  });

  if (loading) return <Layout pageTitle="Products"><p style={{ color:themeG.textSub, fontFamily:FONT }}>Loading products…</p></Layout>;

  return (
    <Layout pageTitle="Products">

      {error && (
        <div style={{ marginBottom:16, background:"rgba(178,58,58,0.08)", border:"1px solid rgba(178,58,58,0.25)", borderRadius:10, padding:"10px 14px", fontSize:13, color:"#B23A3A", fontFamily:FONT }}>
          {error}
        </div>
      )}

      {/* ── Category badge (locked, no toggle) ── */}
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:20 }}>
        {/* <div style={{ display:"inline-flex", alignItems:"center", gap:8, padding:"8px 18px", borderRadius:10, background:themeG.card, border:`1px solid ${themeG.border}`, boxShadow:"0 2px 8px rgba(46,122,114,0.06)" }}>
          <span style={{ fontSize:18 }}>{tab === "cloth" ? "👘" : "🧵"}</span>
          <span style={{ fontFamily:FONT, fontSize:14, fontWeight:700, color:themeG.textMain }}>{tab === "cloth" ? "Cloth" : "Yarn"} Products</span>
        </div> */}
        {/* <span style={{ fontSize:12, color:themeG.textSub, fontFamily:FONT }}>
          <span style={{ color:themeG.accent, cursor:"pointer", textDecoration:"underline" }}
            onClick={() => navigate("/select-category")}>Switch category</span>
        </span> */}
      </div>

      {/* ── Sub-type pills ── */}
      <div style={{ display:"flex", gap:8, marginBottom:20, flexWrap:"wrap" }}>
        {typeList.map((t) => (
          <button key={t} onClick={() => setSubType(t)}
            style={{ padding:"5px 16px", borderRadius:20, border:"1px solid", cursor:"pointer", fontFamily:FONT, fontSize:13, fontWeight:500, transition:"all 0.12s",
              background:  subType === t ? "rgba(91,155,217,0.14)" : "transparent",
              color:       subType === t ? themeG.accent : themeG.textSub,
              borderColor: subType === t ? "rgba(91,155,217,0.40)" : themeG.border }}>
            {t.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      {/* ── Toolbar ── */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
        <input placeholder="Search by name or ID…" value={search} onChange={(e) => setSearch(e.target.value)}
          style={{ padding:"9px 14px", borderRadius:9, border:`1px solid ${themeG.border}`, fontSize:13, width:260, fontFamily:FONT, background:themeG.card, outline:"none", color:themeG.textMain }} />
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <ExcelToolbar
            themeG={themeG}
            rows={filtered}
            columns={PRODUCT_EXCEL_COLUMNS}
            filename={`products-${tab}`}
            reportTitle="Product Details"
            onImportRows={handleImportRows}
          />
          <button onClick={() => navigate("/master/products/add")}
            style={{ display:"flex", alignItems:"center", gap:8, padding:"9px 20px", borderRadius:9, background:themeG.accent, color:themeG.card, border:"none", fontFamily:FONT, fontSize:13, fontWeight:600, cursor:"pointer", boxShadow:"0 2px 10px rgba(91,155,217,0.32)" }}>
            + Add Product
          </button>
        </div>
      </div>

      {/* ── Table ── */}
      <div style={{ background:themeG.card, border:`1px solid ${themeG.border}`, borderRadius:14, overflow:"hidden", boxShadow:"0 4px 16px rgba(46,122,114,0.06)" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", tableLayout:"fixed" }}>
          <colgroup>
            <col style={{ width: "9%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "22%" }} />
            <col style={{ width: "20%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "auto" }} />
          </colgroup>
          <thead>
            <tr style={{ borderBottom:`1px solid ${themeG.border}` }}>
              {[
                "Sort No",
                subType !== "All" && DHOTI_SUBTYPES.has(subType) ? "Border No" : "Shade No",
                "Product Name", "Type", "Color", "Qty", "Status", "Actions",
              ].map((h) => (
                <th key={h} style={{ textAlign:"left", fontSize:11, color: "#FFFFFF", background: "#1F3A63", padding:"10px 14px", textTransform:"uppercase", letterSpacing:"0.07em", fontWeight:600, fontFamily:FONT }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign:"center", padding:40, color:themeG.textSub, fontSize:14, fontFamily:FONT }}>No products found.</td></tr>
            ) : filtered.map((p) => {
              const rc = ROW_COLORS[p.type?.toLowerCase()] || ROW_COLORS.yarn;
              return (
                <tr key={p.id} style={{ borderBottom:`1px solid rgba(46,122,114,0.07)`, background:rc.bg }}>
                  <td style={{ padding:"12px 14px", fontSize:13, color:themeG.accent, fontWeight:600, borderLeft:`3px solid ${rc.dot}`, fontFamily:FONT }}>{p.sortNo}</td>
                  <td style={{ padding:"12px 14px", fontSize:13, fontWeight:600, color:themeG.textMain, fontFamily:FONT }}>{p.shadeNo}</td>
                  <td style={{ padding:"12px 14px", fontSize:14, color:themeG.textMain, fontWeight:500, fontFamily:FONT }}>
                    <ColorDot hex={p.color} />{p.name}
                  </td>
                  <td style={{ padding:"12px 14px" }}>
                    <span style={{ display:"inline-block", fontSize:12, fontWeight:600, color:rc.dot, background:`${rc.border}`, border:`1px solid ${rc.border}`, padding:"4px 12px", borderRadius:20, fontFamily:FONT, whiteSpace:"normal", lineHeight:1.35 }}>
                      {p.type.replace(/_/g, " ").charAt(0).toUpperCase() + p.type.replace(/_/g, " ").slice(1)}
                    </span>
                  </td>
                  <td style={{ padding:"12px 14px" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                      <ColorDot hex={p.color} />
                      <span style={{ fontSize:12, color:themeG.textSub, fontFamily:FONT }}>{p.color}</span>
                    </div>
                  </td>
                  <td style={{ padding:"12px 14px", fontSize:13, fontWeight:600, color:p.qty < 50 ? "#B23A3A" : themeG.textMain, fontFamily:FONT }}>{p.qty}</td>
                  <td style={{ padding:"12px 14px" }}><Badge text={p.status} /></td>
                  <td style={{ padding:"12px 14px", whiteSpace:"nowrap" }}>
                    <div style={{ display:"flex", gap:8 }}>
                      <button style={btnStyle("#5B9BD9")} onClick={() => navigate(`/master/products/${p.dbId}`)}>View</button>
                      <button style={btnStyle(themeG.accent)} onClick={() => navigate(`/master/products/${p.dbId}?edit=1`)}>Edit</button>
                      <button style={btnStyle("#B23A3A")} disabled={deletingId === p.dbId} onClick={() => handleDelete(p)}>
                        {deletingId === p.dbId ? "…" : "Delete"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ padding:"10px 14px", borderTop:`1px solid ${themeG.border}`, fontSize:12, color:themeG.textSub, fontFamily:FONT }}>
          Showing {filtered.length} of {products.length} {tab} products
        </div>
      </div>
    </Layout>
  );
}

const btnStyle = (color) => ({
  padding:"5px 13px", borderRadius:7, border:`1px solid ${color}40`,
  background:`${color}14`, color, cursor:"pointer", fontSize:12,
  fontFamily:FONT, fontWeight:600, whiteSpace:"nowrap",
});