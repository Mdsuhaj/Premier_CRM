// src/utils/orderStatus.js
// Shared helpers + paths for the Sale Loss / Reject pages.
//
// ⚠️ Status strings written by AddOrder.jsx are "sale_loss" and "rejected".
//    If your backend uses different values, add them to the lists below.

export const SALE_LOSS_PATH = "/master/sale-loss";
export const REJECT_PATH = "/master/rejected";

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");

export const isSaleLossStatus = (s) => ["saleloss", "lost"].includes(norm(s));
export const isRejectedStatus = (s) => ["rejected", "declined"].includes(norm(s));