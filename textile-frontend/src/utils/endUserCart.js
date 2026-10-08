// src/utils/endUserCart.js
//
// Persistent, per-customer cart for the end_user (Field Officer) flow.
// Mirrors utils/customerCart.js's shape (array of {key, product, qty},
// addToCart / getCart / subscribeToCart) but keyed by customerId, since
// a single field officer places enquiries on behalf of many different
// customers and each customer needs their own independent cart.
//
// Storage shape (localStorage key ENDUSER_CART_KEY):
//   { [customerId]: [ { key, product, qty }, ... ] }
//
// "key" is just the product's own Id (stringified) — the end-user flow
// doesn't carry a color/size variant selector the way the customer
// catalog does, so one row per product is enough.

const ENDUSER_CART_KEY = "enduser_cart_v1";
const EVENT_NAME = "enduser-cart-changed";

function readAll() {
  try {
    const raw = localStorage.getItem(ENDUSER_CART_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeAll(all) {
  try {
    localStorage.setItem(ENDUSER_CART_KEY, JSON.stringify(all));
  } catch {
    // storage full / unavailable — fail silently, same as customerCart
  }
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

export function getCart(customerId) {
  if (!customerId) return [];
  const all = readAll();
  return all[String(customerId)] || [];
}

// piecesOfLength: free-text value from the "Pieces of Length" column on
// Product Selection — carried on the cart line alongside qty so it
// survives through to Cart Checkout / order submission. Re-adding the
// same product updates it to whatever was just entered (same as qty
// accumulates), rather than being locked to whatever was typed first.
//
// uom: the UOM (Box / Pieces / Meter) picked on Product Selection's UOM
// dropdown at the moment this row was added — FIX: same bug as
// customerCart.js had. Product Selection was already calling
// addToCart(customerId, { product, qty, uom: uomFilter }), but this
// function never destructured a `uom` param at all, so it was silently
// dropped every time. That meant Cart Checkout's UOM column could never
// show the officer's real choice — see CartCheckout.jsx, which used to
// paper over the gap with a hardcoded dummyUom() always returning "Box".
// Now stored on the line, same as piecesOfLength.
export function addToCart(customerId, { product, qty, piecesOfLength, uom, remarks }) {
  if (!customerId || !product || !qty || qty <= 0) return;
  const all = readAll();
  const cid = String(customerId);
  const list = all[cid] || [];
  const key = String(product.RowKey ?? product.Id);
  const existing = list.find((l) => l.key === key);
  let next;
  if (existing) {
    const cap = product.Quantity ?? existing.qty + qty;
    next = list.map((l) => (l.key === key
      ? { ...l, qty: Math.min(l.qty + qty, cap), piecesOfLength: piecesOfLength ?? l.piecesOfLength ?? "", uom: uom || l.uom || "Box", remarks: remarks ?? l.remarks ?? "" }
      : l));
  } else {
    next = [...list, { key, product, qty: Math.min(qty, product.Quantity ?? qty), piecesOfLength: piecesOfLength ?? "", uom: uom || "Box", remarks: remarks || "" }];
  }
  all[cid] = next;
  writeAll(all);
}

export function updateCartQty(customerId, key, qty) {
  if (!customerId) return;
  const all = readAll();
  const cid = String(customerId);
  const list = all[cid] || [];
  if (qty <= 0) {
    all[cid] = list.filter((l) => l.key !== key);
  } else {
    all[cid] = list.map((l) => (l.key === key ? { ...l, qty } : l));
  }
  writeAll(all);
}

export function removeFromCart(customerId, key) {
  if (!customerId) return;
  const all = readAll();
  const cid = String(customerId);
  all[cid] = (all[cid] || []).filter((l) => l.key !== key);
  writeAll(all);
}

export function clearCart(customerId) {
  if (!customerId) return;
  const all = readAll();
  delete all[String(customerId)];
  writeAll(all);
}

// Wholesale-replaces a customer's live cart with the given line items —
// used when resuming a saved draft (see utils/endUserDrafts.js), which
// hands back its frozen items snapshot to drop straight back into the
// cart the officer left off with.
export function replaceCart(customerId, items) {
  if (!customerId) return;
  const all = readAll();
  all[String(customerId)] = items || [];
  writeAll(all);
}

export function cartCount(customerId) {
  return getCart(customerId).reduce((sum, l) => sum + l.qty, 0);
}

// Total number of distinct customers that currently have at least one
// item sitting in a cart — handy for a badge count in the layout if
// wanted later.
export function activeCartCustomerCount() {
  const all = readAll();
  return Object.values(all).filter((list) => (list || []).length > 0).length;
}

export function subscribeToCart(callback) {
  const handler = () => callback();
  window.addEventListener(EVENT_NAME, handler);
  window.addEventListener("storage", handler); // cross-tab sync
  return () => {
    window.removeEventListener(EVENT_NAME, handler);
    window.removeEventListener("storage", handler);
  };
}