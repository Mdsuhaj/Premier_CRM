// src/pages/CustomerShop.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import CustomerLayout from "../components/CustomerLayout";
import { useTheme } from "../ThemeContext";
import { getG } from "../theme";
import API from "../services/api";

const FONT = "'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// Friendly icons for known top-level categories — falls back to a generic
// tag icon for anything not in this map, so new categories added on the
// admin side don't break the UI.
const CATEGORY_ICON = { cloth: "👘", yarn: "🧵" };

export default function CustomerShop() {
  const { isDark } = useTheme();
  const themeG = getG(isDark);
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem("user") || "{}");

  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Cascading filters: pick a Category first (Cloth / Yarn / ...), then a
  // SubType within it (Dhoti, Blouse, Cotton, Silk, ...). SubType resets
  // whenever Category changes.
  const [category, setCategory] = useState("all");
  const [subType, setSubType] = useState("all");

  // Cart: { [productId]: { product, qty } }
  const [cart, setCart] = useState({});
  const [cartOpen, setCartOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const role = localStorage.getItem("role");
    if (role !== "customer") { navigate("/login"); return; }
    (async () => {
      try {
        const res = await API.get("/products", { params: { status: "active" } });
        setProducts(res.data);
      } catch {
        setError("Failed to load products. Please refresh.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line
  }, []);

  const categories = useMemo(
    () => ["all", ...Array.from(new Set(products.map(p => p.Category).filter(Boolean)))],
    [products]
  );

  // SubTypes are scoped to the currently selected category so the chip list
  // never shows a Yarn subtype while browsing Cloth, etc.
  const subTypes = useMemo(() => {
    const pool = category === "all" ? products : products.filter(p => p.Category === category);
    return ["all", ...Array.from(new Set(pool.map(p => p.SubType).filter(Boolean)))];
  }, [products, category]);

  const visibleProducts = products.filter((p) => {
    if (category !== "all" && p.Category !== category) return false;
    if (subType !== "all" && p.SubType !== subType) return false;
    return true;
  });

  const handleCategoryChange = (c) => {
    setCategory(c);
    setSubType("all"); // reset dependent filter
  };

  const addToCart = (product) => {
    if (!product.Quantity || product.Quantity <= 0) return;
    setCart((prev) => {
      const existingQty = prev[product.Id]?.qty || 0;
      const nextQty = Math.min(existingQty + 1, product.Quantity);
      return { ...prev, [product.Id]: { product, qty: nextQty } };
    });
    setCartOpen(true);
  };

  const setCartQty = (productId, qty) => {
    setCart((prev) => {
      const item = prev[productId];
      if (!item) return prev;
      const clamped = Math.max(1, Math.min(qty, item.product.Quantity || qty));
      return { ...prev, [productId]: { ...item, qty: clamped } };
    });
  };

  const removeFromCart = (productId) => {
    setCart((prev) => {
      const next = { ...prev };
      delete next[productId];
      return next;
    });
  };

  const cartItems = Object.values(cart);
  const cartCount = cartItems.reduce((sum, i) => sum + i.qty, 0);
  const cartTotal = cartItems.reduce((sum, i) => sum + i.qty * parseFloat(i.product.Price || 0), 0);

  const submitEnquiry = async () => {
    if (cartItems.length === 0) return;
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const res = await API.post("/orders/bulk", {
        items: cartItems.map((i) => ({ productId: i.product.Id, qty: i.qty })),
      });
      setNotice(res.data.message || "Enquiry submitted. Track it under My Orders.");
      setCart({});
      setCartOpen(false);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to submit enquiry.");
    } finally {
      setSubmitting(false);
    }
  };

  const S = {
    topRow: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 },
    heading: { fontFamily: "'Space Grotesk', " + FONT, fontSize: 26, fontWeight: 700, margin: "0 0 4px", color: themeG.textMain, letterSpacing: "-0.4px" },
    headingSub: { fontSize: 13, color: themeG.textSub, margin: 0 },
    cartBtn: { display: "flex", alignItems: "center", gap: 8, padding: "9px 18px", borderRadius: 20, border: `1.5px solid ${themeG.accent}`, background: "transparent", color: themeG.accent, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: FONT },
    cartBadgeInline: { background: themeG.accent, color: "#fff", borderRadius: "50%", width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 },

    filterGroup: { marginBottom: 14 },
    filterLabel: { fontSize: 11, fontWeight: 700, color: themeG.textLabel, textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 8px" },
    filterRow: { display: "flex", gap: 8, flexWrap: "wrap" },
    filterBtn: (active) => ({ padding: "7px 16px", borderRadius: 20, border: "1.5px solid", cursor: "pointer", fontFamily: FONT, fontSize: 12.5, fontWeight: 600, textTransform: "capitalize", background: active ? themeG.accent : themeG.card, color: active ? "#fff" : themeG.textSub, borderColor: active ? themeG.accent : themeG.border, display: "flex", alignItems: "center", gap: 6 }),
    subFilterBtn: (active) => ({ padding: "6px 14px", borderRadius: 16, border: "1.5px solid", cursor: "pointer", fontFamily: FONT, fontSize: 12, fontWeight: 600, textTransform: "capitalize", background: active ? "rgba(15,33,56,0.10)" : "transparent", color: active ? themeG.accent : themeG.textSub, borderColor: active ? themeG.accent : themeG.border }),

    card: { background: themeG.card, border: `1px solid ${themeG.border}`, borderRadius: 14, overflow: "hidden", boxShadow: "0 4px 16px rgba(15,33,56,0.06)", marginTop: 18 },
    productGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14, padding: 20 },
    productCard: { border: `1px solid ${themeG.border}`, borderRadius: 12, padding: 16, background: themeG.bg },
    productName: { fontSize: 14.5, fontWeight: 700, color: themeG.textMain, margin: "0 0 4px" },
    productMeta: { fontSize: 12, color: themeG.textSub, margin: "0 0 10px" },
    stockRow: { display: "flex", alignItems: "center", justifyContent: "space-between" },
    stockQty: (qty) => ({ fontSize: 13, fontWeight: 700, color: qty > 0 ? "#1F5C99" : "#96302F" }),
    price: { fontSize: 13, fontWeight: 600, color: themeG.textMain },
    addBtn: { width: "100%", marginTop: 12, padding: "8px 0", borderRadius: 8, border: "none", background: themeG.accent, color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: FONT },
    addBtnDisabled: { width: "100%", marginTop: 12, padding: "8px 0", borderRadius: 8, border: `1px solid ${themeG.border}`, background: "transparent", color: themeG.textSub, fontSize: 12.5, fontWeight: 600, cursor: "not-allowed", fontFamily: FONT },

    cartFab: { position: "fixed", bottom: 26, right: 26, background: themeG.accent, color: "#fff", border: "none", borderRadius: 30, padding: "13px 22px", fontSize: 14, fontWeight: 700, cursor: "pointer", boxShadow: "0 6px 20px rgba(15,33,56,0.35)", display: "flex", alignItems: "center", gap: 8, fontFamily: FONT, zIndex: 50 },
    cartBadge: { background: "#fff", color: themeG.accent, borderRadius: "50%", width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 },
    overlay: { position: "fixed", inset: 0, background: "rgba(8,20,34,0.35)", display: "flex", alignItems: "center", justifyContent: "flex-end", zIndex: 100 },
    drawer: { background: themeG.card, width: 380, maxWidth: "92vw", height: "100%", padding: 24, overflowY: "auto", boxShadow: "-8px 0 30px rgba(0,0,0,0.15)" },
    drawerHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 },
    drawerTitle: { fontSize: 17, fontWeight: 700, color: themeG.textMain, margin: 0 },
    closeBtn: { background: "transparent", border: "none", fontSize: 20, color: themeG.textSub, cursor: "pointer", lineHeight: 1 },
    cartItem: { display: "flex", alignItems: "center", gap: 10, padding: "12px 0", borderBottom: `1px solid ${themeG.border}` },
    cartItemName: { fontSize: 13.5, fontWeight: 600, color: themeG.textMain, margin: "0 0 3px" },
    cartItemMeta: { fontSize: 11.5, color: themeG.textSub },
    qtyBox: { display: "flex", alignItems: "center", gap: 6 },
    qtyBtn: { width: 24, height: 24, borderRadius: 6, border: `1px solid ${themeG.border}`, background: themeG.bg, color: themeG.textMain, fontSize: 14, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" },
    qtyVal: { fontSize: 13, fontWeight: 600, color: themeG.textMain, minWidth: 20, textAlign: "center" },
    removeBtn: { background: "transparent", border: "none", color: "#96302F", fontSize: 12, cursor: "pointer", fontFamily: FONT },
    cartTotal: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 0", fontSize: 14.5, fontWeight: 700, color: themeG.textMain },
    submitBtn: { width: "100%", padding: "12px 0", borderRadius: 9, border: "none", background: themeG.accent, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: FONT },
  };

  return (
    <CustomerLayout>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />

      <div style={S.topRow}>
        <div>
          <h1 style={S.heading}>Order Enquiry</h1>
          <p style={S.headingSub}>Welcome back, {user.name || "Customer"} — browse stock and add to your enquiry.</p>
        </div>
        <button style={S.cartBtn} onClick={() => setCartOpen(true)}>
          🛒 Cart {cartCount > 0 && <span style={S.cartBadgeInline}>{cartCount}</span>}
        </button>
      </div>

      {error && (
        <div style={{ marginBottom: 20, background: "rgba(178,58,58,0.08)", border: "1px solid rgba(178,58,58,0.25)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#B23A3A" }}>
          {error}
        </div>
      )}

      {notice && (
        <div style={{ marginBottom: 20, background: "rgba(15,33,56,0.08)", border: "1px solid rgba(15,33,56,0.25)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: themeG.accent }}>
          {notice}
        </div>
      )}

      {/* Category filter */}
      <div style={S.filterGroup}>
        <p style={S.filterLabel}>Category</p>
        <div style={S.filterRow}>
          {categories.map((c) => (
            <button key={c} onClick={() => handleCategoryChange(c)} style={S.filterBtn(category === c)}>
              {c !== "all" && CATEGORY_ICON[c.toLowerCase()] ? CATEGORY_ICON[c.toLowerCase()] : null}
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* SubType filter — scoped to whichever category is active above */}
      {subTypes.length > 1 && (
        <div style={S.filterGroup}>
          <p style={S.filterLabel}>Type</p>
          <div style={S.filterRow}>
            {subTypes.map((s) => (
              <button key={s} onClick={() => setSubType(s)} style={S.subFilterBtn(subType === s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={S.card}>
        {loading ? (
          <div style={{ padding: 30, textAlign: "center", color: themeG.textSub, fontSize: 13 }}>Loading stock…</div>
        ) : visibleProducts.length === 0 ? (
          <div style={{ padding: 30, textAlign: "center", color: themeG.textSub, fontSize: 13 }}>No products found for this filter.</div>
        ) : (
          <div style={S.productGrid}>
            {visibleProducts.map((p) => (
              <div key={p.Id} style={S.productCard}>
                <p style={S.productName}>{p.Name}</p>
                <p style={S.productMeta}>{p.Category}{p.SubType ? ` · ${p.SubType}` : ""}</p>
                <div style={S.stockRow}>
                  <span style={S.stockQty(p.Quantity)}>
                    {p.Quantity > 0 ? `${p.Quantity} in stock` : "Out of stock"}
                  </span>
                  <span style={S.price}>₹{parseFloat(p.Price || 0).toLocaleString()}</span>
                </div>
                {p.Quantity > 0 ? (
                  <button style={S.addBtn} onClick={() => addToCart(p)}>
                    {cart[p.Id] ? `In Cart (${cart[p.Id].qty})` : "Add to Cart"}
                  </button>
                ) : (
                  <button style={S.addBtnDisabled} disabled>Out of Stock</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Floating cart button — shown whenever cart has items and drawer is closed */}
      {cartCount > 0 && !cartOpen && (
        <button style={S.cartFab} onClick={() => setCartOpen(true)}>
          🛒 View Cart <span style={S.cartBadge}>{cartCount}</span>
        </button>
      )}

      {/* ── Cart drawer ── */}
      {cartOpen && (
        <div style={S.overlay} onClick={() => setCartOpen(false)}>
          <div style={S.drawer} onClick={(e) => e.stopPropagation()}>
            <div style={S.drawerHeader}>
              <h3 style={S.drawerTitle}>Your Cart</h3>
              <button style={S.closeBtn} onClick={() => setCartOpen(false)}>×</button>
            </div>

            {cartItems.length === 0 ? (
              <p style={{ fontSize: 13, color: themeG.textSub }}>Your cart is empty. Add products to submit an enquiry.</p>
            ) : (
              <>
                {cartItems.map((item) => (
                  <div key={item.product.Id} style={S.cartItem}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={S.cartItemName}>{item.product.Name}</p>
                      <p style={S.cartItemMeta}>₹{parseFloat(item.product.Price || 0).toLocaleString()} each</p>
                    </div>
                    <div style={S.qtyBox}>
                      <button style={S.qtyBtn} onClick={() => setCartQty(item.product.Id, item.qty - 1)}>−</button>
                      <span style={S.qtyVal}>{item.qty}</span>
                      <button style={S.qtyBtn} onClick={() => setCartQty(item.product.Id, item.qty + 1)}>+</button>
                    </div>
                    <button style={S.removeBtn} onClick={() => removeFromCart(item.product.Id)}>Remove</button>
                  </div>
                ))}

                <div style={S.cartTotal}>
                  <span>Total</span>
                  <span>₹{cartTotal.toLocaleString()}</span>
                </div>

                <button style={S.submitBtn} disabled={submitting} onClick={submitEnquiry} data-confirm="Submit this enquiry? It will be sent to the Admin for allocation." data-confirm-title="Submit Enquiry">
                  {submitting ? "Submitting…" : "Submit Enquiry"}
                </button>
                <p style={{ fontSize: 11, color: themeG.textSub, marginTop: 10, textAlign: "center" }}>
                  Prices shown are list price — Marketing may apply discounts when reviewing your enquiry.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </CustomerLayout>
  );
}