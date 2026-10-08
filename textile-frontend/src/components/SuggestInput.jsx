// src/components/SuggestInput.jsx
//
// Text box with a "suggestions as you type" dropdown — same behaviour as the
// Product Category box on Product Selection. Type, and only options that
// contain what you typed are listed; click (or Enter) to pick one.
//
// Props
//   value, onChange(text)   controlled text value
//   options                 array of strings to suggest from
//   placeholder
//   inputStyle              style for the <input>
//   menuStyle, itemStyle, emptyStyle   optional style overrides for the list
//   maxItems                default 50
//   emptyText               text when nothing matches (default: none shown)
import { useEffect, useMemo, useRef, useState } from "react";

export default function SuggestInput({
  value, onChange, options = [], placeholder, inputStyle,
  menuStyle, itemStyle, emptyStyle, maxItems = 50, emptyText,
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef(null);

  const list = useMemo(() => {
    const q = (value || "").trim().toLowerCase();
    const uniq = Array.from(new Set(options.filter(Boolean).map(String)));
    const hits = q ? uniq.filter((o) => o.toLowerCase().includes(q)) : uniq;
    // Exact/starts-with matches first, so "1155" lists 1155 before 21155.
    hits.sort((a, b) => {
      const as = a.toLowerCase().startsWith(q) ? 0 : 1;
      const bs = b.toLowerCase().startsWith(q) ? 0 : 1;
      return as - bs;
    });
    return hits.slice(0, maxItems);
  }, [options, value, maxItems]);

  useEffect(() => {
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const pick = (v) => { onChange(v); setOpen(false); setActive(-1); };

  const onKeyDown = (e) => {
    if (!open || list.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, list.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); pick(list[active]); }
    else if (e.key === "Escape") setOpen(false);
  };

  const menu = {
    position: "absolute", zIndex: 30, top: "calc(100% + 4px)", left: 0, right: 0,
    maxHeight: 220, overflowY: "auto", background: "#fff",
    border: "1px solid #DBE3EC", borderRadius: 9, boxShadow: "0 8px 24px rgba(15,33,56,0.14)",
    ...menuStyle,
  };
  const item = { padding: "9px 14px", fontSize: 13.5, color: "#0F2138", cursor: "pointer", ...itemStyle };

  return (
    <div ref={boxRef} style={{ position: "relative", width: "100%" }}>
      <input
        style={inputStyle}
        placeholder={placeholder}
        value={value}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(-1); }}
        onKeyDown={onKeyDown}
      />
      {open && (list.length > 0 ? (
        <div style={menu}>
          {list.map((o, i) => (
            <div
              key={o}
              style={{ ...item, background: i === active ? "#F1F5F9" : "transparent" }}
              onMouseEnter={() => setActive(i)}
              onMouseDown={() => pick(o)}
            >
              {o}
            </div>
          ))}
        </div>
      ) : (emptyText && value.trim() && (
        <div style={menu}>
          <div style={{ padding: "10px 14px", fontSize: 12.5, color: "#6B7785", fontStyle: "italic", ...emptyStyle }}>{emptyText}</div>
        </div>
      )))}
    </div>
  );
}