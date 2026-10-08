// src/utils/customerCart.js
//
// The cart used to live only inside CustomerShop.jsx's component state,
// which meant it vanished the moment you navigated away. Now that
// "browse + specify requirements" (ProductCatalog) and "review + submit"
// (OrderEnquiry) are separate pages, the cart needs to survive the
// navigation between them — so it's backed by localStorage here, with a
// custom event so any mounted component (e.g. the sidebar cart badge)
// can react immediately without waiting on the native `storage` event
// (which doesn't fire in the same tab that made the change).
//
// This cart is a single flat array under one CART_KEY — it is NOT
// scoped per customer (unlike utils/endUserCart.js, which is keyed by
// customerId because one officer works with many customers). A
// customer only ever has their own cart, so there's nothing to key by.
//
// ── FIX (Clear Cart) ──
// clearCart() used to take a `customerId` argument and early-return via
// `if (!customerId) return;`, then call readAll()/writeAll() — neither
// of which exists in this file. That combination meant:
//   - Calling clearCart(customerId) from a page with no `customerId` in
//     scope threw a ReferenceError before this function even ran.
//   - Calling clearCart() with no argument hit the `!customerId` guard
//     and silently no-op'd — the cart was never touched, even though
//     calling code went on to show a "Cart cleared" notice regardless.
// This function was clearly copy-pasted from a per-customer-keyed cart
// implementation and never adapted to this file's actual flat-array
// shape. Fixed to just take no argument and reset the array to empty,
// same as every other mutator here goes through writeCart().
const CART_KEY = "customer_cart";
export const CUSTOMER_CART_EVENT = "customer-cart-updated";

function readCart() {
  try {
    const raw = localStorage.getItem(CART_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeCart(items) {
  localStorage.setItem(CART_KEY, JSON.stringify(items));
  window.dispatchEvent(new Event(CUSTOMER_CART_EVENT));
}

export function getCart() {
  return readCart();
}

export function getCartCount() {
  return readCart().reduce((sum, i) => sum + (i.qty || 0), 0);
}

// A "line" is a product + a specific Color/Size requirement. The same
// product with a different color/size is tracked as its own line so a
// customer can request e.g. 5 Red-M and 3 Blue-L of the same product.
// piecesOfLength: free-text value from the "Pieces of Length" column on
// the Product Catalog page — carried on the cart line alongside qty so
// it survives through to Order Enquiry submission, same as color/size.
//
// uom: the UOM (Box / Pieces / Meter) the customer had selected on the
// Product Catalog page's UOM dropdown at the moment this row was added
// — FIX: this used to be silently dropped because this function never
// destructured a `uom` param at all, even though ProductCatalog.jsx was
// already passing `uom: uomFilter` into every addToCart() call. That
// meant every cart line (and everything downstream of it — Order
// Enquiry's UOM column, the submitted enquiry) always fell back to
// whatever hardcoded default a page used, never the UOM the customer
// actually picked. Now stored on the line, same as piecesOfLength.
// remarks: free-text note typed on Product Catalog's per-row Remarks
// column — FIX: same class of bug as piecesOfLength/uom above. This
// function never destructured a `remarks` param, so even though
// ProductCatalog.jsx was already passing `remarks: getRowRemarks(...)`
// into every addToCart() call, it was silently dropped and never made
// it onto the cart line — which is why Order Enquiry's Remarks column
// always showed "—". Now stored on the line the same way.
export function addToCart({ product, qty, color, size, piecesOfLength, uom, remarks }) {
  const items = readCart();
  const key = `${product.RowKey ?? product.Id}::${color || ""}::${size || ""}`;
  const existing = items.find((i) => i.key === key);
  const cap = product.Quantity || Infinity;

  if (existing) {
    existing.qty = Math.min(existing.qty + qty, cap);
    existing.piecesOfLength = piecesOfLength ?? existing.piecesOfLength ?? "";
    existing.uom = uom || existing.uom || "Box";
    existing.remarks = remarks ?? existing.remarks ?? "";
  } else {
    items.push({
      key,
      product,
      qty: Math.min(Math.max(qty, 1), cap),
      color: color || "",
      size: size || "",
      piecesOfLength: piecesOfLength || "",
      uom: uom || "Box",
      remarks: remarks || "",
    });
  }
  writeCart(items);
  return items;
}

export function updateCartQty(key, qty) {
  const items = readCart();
  const item = items.find((i) => i.key === key);
  if (!item) return items;
  const cap = item.product.Quantity || qty;
  item.qty = Math.max(1, Math.min(qty, cap));
  writeCart(items);
  return items;
}

export function removeFromCart(key) {
  const items = readCart().filter((i) => i.key !== key);
  writeCart(items);
  return items;
}

// Empties the single flat cart. No customerId involved — this cart
// belongs to whichever customer is logged in, there's only ever one.
export function clearCart() {
  writeCart([]);
}

export function subscribeToCart(callback) {
  window.addEventListener(CUSTOMER_CART_EVENT, callback);
  return () => window.removeEventListener(CUSTOMER_CART_EVENT, callback);
}