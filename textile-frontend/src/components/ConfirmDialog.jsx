// src/components/ConfirmDialog.jsx
//
// Project-wide confirmation popup.
//
//  1. <ConfirmProvider> (mounted once in main.jsx) renders the dialog and installs
//     a click guard for buttons that carry a data-confirm attribute. It is
//     OPT-IN: only the buttons that hand an order to the next person
//     (End User -> Admin -> System Admin -> ERP) have it, e.g.
//         <button data-confirm="Submit this enquiry to Admin?">Submit</button>
//     The first click opens "Are you sure?"; only after OK is the click replayed.
//  2. askConfirm({ title, message, confirmText }) -> Promise<boolean> can be
//     called from any handler for a one-off confirmation.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { BRAND } from "../brand";

const ConfirmCtx = createContext(null);
let openRef = null;

export function askConfirm(opts) {
  if (openRef) return openRef(opts);
  return Promise.resolve(window.confirm(opts?.message || "Are you sure?"));
}
export const useConfirm = () => useContext(ConfirmCtx) || askConfirm;

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null); // { title, message, confirmText, resolve }
  const stateRef = useRef(null);
  stateRef.current = state;

  const open = useCallback((opts = {}) => new Promise((resolve) => {
    setState({
      title: opts.title || "Please confirm",
      message: opts.message || "Are you sure you want to continue?",
      confirmText: opts.confirmText || "OK",
      resolve,
    });
  }), []);

  useEffect(() => { openRef = open; return () => { openRef = null; }; }, [open]);

  const close = (result) => {
    const s = stateRef.current;
    setState(null);
    s?.resolve(result);
  };

  // Global click guard (capture phase, runs before React's handlers).
  useEffect(() => {
    const onClick = (e) => {
      const el = e.target.closest && e.target.closest("button[data-confirm]");
      if (!el || el.disabled || el.dataset.confirmed === "1") return;
      if (el.closest("[data-confirm-dialog]") || el.hasAttribute("data-no-confirm")) return;

      const forced = el.getAttribute("data-confirm");
      if (!forced) return;
      const label = (el.getAttribute("data-confirm-title") || el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();

      e.preventDefault();
      e.stopImmediatePropagation();
      open({
        title: label || "Please confirm",
        message: forced,
        confirmText: "Yes, continue",
      }).then((ok) => {
        if (!ok) return;
        el.dataset.confirmed = "1";
        try { el.click(); } finally { setTimeout(() => { delete el.dataset.confirmed; }, 0); }
      });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [open]);

  return (
    <ConfirmCtx.Provider value={open}>
      {children}
      {state && (
        <div
          data-confirm-dialog
          onClick={() => close(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(15,33,56,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 5000 }}
        >
          <div
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            style={{ background: "#fff", borderRadius: 14, padding: 24, width: "min(420px, 92%)", boxShadow: "0 16px 48px rgba(0,0,0,0.25)", fontFamily: "'Inter','Segoe UI',Roboto,Arial,sans-serif" }}
          >
            <h3 style={{ margin: "0 0 8px", fontSize: 17, color: BRAND.blue }}>{state.title}</h3>
            <p style={{ margin: "0 0 20px", fontSize: 13.5, color: "#526073", lineHeight: 1.5 }}>{state.message}</p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => close(false)} style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: BRAND.red, color: "#fff", fontWeight: 700, cursor: "pointer" }}>
                Cancel
              </button>
              <button autoFocus onClick={() => close(true)} style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: BRAND.green, color: "#fff", fontWeight: 700, cursor: "pointer" }}>
                {state.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmCtx.Provider>
  );
}