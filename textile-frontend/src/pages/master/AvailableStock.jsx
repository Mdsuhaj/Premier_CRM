// src/pages/master/AvailableStock.jsx
//
// "Available Stock" — reached from the Marketing Review board's top
// summary card (see Batches.jsx StatCardV2 "Available Stock" ->
// onViewDetails). Lists every product's current available quantity,
// combining:
//   - Oracle (PRODUCT + FULLITEMKEYDECODER for the catalog rows, BALANCE
//     for the live quantity) — the bulk of the catalog.
//   - Local-only products (added via Add Product, never mirrored from
//     Oracle) — auto-created "ORA-..." mirror products are intentionally
//     excluded here since they're already represented by their Oracle row,
//     showing both would double the same item.
// Backend: GET /api/products/available-stock (see ProductController@availableStock).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTheme } from "../../ThemeContext";
import Layout from "../../components/Layout";
import { getG } from "../../theme";
import API from "../../services/api";
import * as XLSX from "xlsx";

const FONT = "'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const PAGE_SIZE = 100;
const LOW_STOCK_THRESHOLD = 2000; // below this => "Stock Shortage"

const TABS = [
    { id: "Blouse", label: "Blouse", icon: "🎀" },
    { id: "Dhoti", label: "Dhoti", icon: "📜" },
    { id: "Uniform Shirting", label: "Uniform Shirting", icon: "👔" },
    { id: "Uniform Suiting", label: "Uniform Suiting", icon: "🧵" },
];

export default function AvailableStock() {
    const { isDark } = useTheme();
    const themeG = getG(isDark);

    const [activeTab, setActiveTab] = useState(TABS[0].id);

    const [rows, setRows] = useState([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    // ── Search box with a suggestions dropdown ──
    const [query, setQuery] = useState("");
    const [sortShade, setSortShade] = useState("");
    const [debouncedSortShade, setDebouncedSortShade] = useState("");
    const [debouncedQuery, setDebouncedQuery] = useState("");
    const [menuOpen, setMenuOpen] = useState(false);
    const searchBoxRef = useRef(null);
    const tableScrollRef = useRef(null);

    useEffect(() => {
        const t = setTimeout(() => {
            setDebouncedQuery(query.trim());
            setDebouncedSortShade(sortShade.trim());
            setPage(1);
        }, 350);
        return () => clearTimeout(t);
    }, [query, sortShade]);

    // Close the suggestions dropdown on an outside click.
    useEffect(() => {
        const onClick = (e) => {
            if (searchBoxRef.current && !searchBoxRef.current.contains(e.target)) setMenuOpen(false);
        };
        document.addEventListener("mousedown", onClick);
        return () => document.removeEventListener("mousedown", onClick);
    }, []);

    // Switching tabs resets paging + search, same pattern as Product Selection.
    const switchTab = (id) => {
        setActiveTab(id);
        setPage(1);
        setQuery("");
        setDebouncedQuery("");
        setSortShade("");
        setDebouncedSortShade("");
        setMenuOpen(false);
        setRows([]);
        setTotal(0);
    };

    useEffect(() => {
        const ctrl = new AbortController();
        setLoading(true);
        API.get("/products/available-stock", {
            params: { type: activeTab, search: debouncedQuery, sort_shade: debouncedSortShade, page, per_page: PAGE_SIZE },
            signal: ctrl.signal,
        })
            .then((res) => {
                const oracleOnly = (res.data.data || []).filter((r) => r.source === "oracle");
                setRows(oracleOnly);
                setTotal(res.data.total || 0);
                setError("");
            })
            .catch((err) => {
                if (err?.code === "ERR_CANCELED" || err?.name === "CanceledError") return;
                setError("Failed to load available stock. Please try again.");
            })
            .finally(() => {
                if (!ctrl.signal.aborted) setLoading(false);
            });
        return () => ctrl.abort();
    }, [activeTab, debouncedQuery, debouncedSortShade, page]);

    const [exporting, setExporting] = useState(false);

    const handleExportExcel = async () => {
        setExporting(true);
        try {
            const res = await API.get("/products/available-stock", {
                params: { type: activeTab, search: debouncedQuery, sort_shade: debouncedSortShade, export: 1 },
            });
            const data = (res.data.data || []).filter((r) => r.source === "oracle").map((r, i) => ({
                "S.No": i + 1,
                "Sort No": r.sortNo || "—",
                "Shade": r.shadeNo || "—",
                "Product Name": r.name,
                "Available Qty": r.availableQty,
                "Status": r.availableQty >= LOW_STOCK_THRESHOLD ? "Stock Available" : "Stock Shortage",
            }));
            const sheet = XLSX.utils.json_to_sheet(data);
            const book = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(book, sheet, activeTab.slice(0, 31));
            XLSX.writeFile(book, `available-stock-${activeTab.toLowerCase().replace(/\s+/g, "-")}.xlsx`);
        } catch {
            setError("Failed to export. Please try again.");
        } finally {
            setExporting(false);
        }
    };

    // Suggestions come from names already on the current page (no extra
    // round trip) — click one to jump straight to searching for it.
    const suggestions = Array.from(new Set(rows.map((r) => r.name).filter(Boolean))).slice(0, 12);

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const pageOffset = (page - 1) * PAGE_SIZE;
    const goToPage = (p) => setPage(Math.min(Math.max(1, p), totalPages));


    // Reset the table's own scroll position back to the top whenever a new
    // page of rows arrives (Next/Prev, or switching tabs) — otherwise the
    // new page opens still scrolled down to wherever the last page was left.
    useLayoutEffect(() => {
        if (tableScrollRef.current) tableScrollRef.current.scrollTop = 0;
    }, [rows]);

    const S = {
        heading: { fontFamily: "'Space Grotesk', " + FONT, fontSize: 24, fontWeight: 700, margin: "0 0 4px", color: themeG.textMain, letterSpacing: "-0.4px" },
        headingSub: { fontSize: 13, color: themeG.textSub, margin: "0 0 20px" },

        titleRow: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 },
        exportBtn: { display: "flex", alignItems: "center", gap: 8, padding: "10px 18px", borderRadius: 10, border: "none", background: "#1C7A4B", color: "#fff", fontWeight: 700, fontSize: 13.5, cursor: "pointer", fontFamily: FONT, whiteSpace: "nowrap" },

        statusPill: (ok) => ({
            display: "inline-block", padding: "4px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700,
            background: ok ? "rgba(30,158,90,0.12)" : "rgba(178,58,58,0.12)",
            color: ok ? "#1E9E5A" : "#B23A3A",
        }),

        tabRow: { display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 },
        tabBtn: (active) => ({
            display: "flex", alignItems: "center", gap: 8, padding: "10px 18px", borderRadius: 10,
            border: `1px solid ${active ? themeG.accent : themeG.border}`,
            background: active ? themeG.accent : themeG.card,
            color: active ? "#fff" : themeG.textMain,
            fontWeight: 700, fontSize: 13.5, cursor: "pointer", fontFamily: FONT,
        }),

        searchRow: { display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 18 },
        searchWrap: { position: "relative", flex: "1 1 320px", maxWidth: 560 },
        searchInput: { width: "100%", boxSizing: "border-box", padding: "11px 14px", borderRadius: 10, border: `1px solid ${themeG.border}`, background: themeG.card, color: themeG.textMain, fontSize: 13.5, fontFamily: FONT, outline: "none" },
        menu: { position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: themeG.card, border: `1px solid ${themeG.border}`, borderRadius: 10, boxShadow: "0 8px 24px rgba(15,33,56,0.14)", zIndex: 20, maxHeight: 260, overflowY: "auto" },
        menuItem: { padding: "9px 14px", fontSize: 13, color: themeG.textMain, cursor: "pointer" },

        tableCard: { background: themeG.card, border: `1px solid ${themeG.border}`, borderRadius: 14, overflow: "hidden", boxShadow: "0 4px 16px rgba(15,33,56,0.06)" },
        tableScroll: { overflowX: "auto", maxHeight: 12 * 49 + 45, overflowY: "auto" },
        table: { width: "100%", minWidth: 700, borderCollapse: "collapse" },
        th: { textAlign: "center", padding: "12px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#FFFFFF", background: "#1F3A63", whiteSpace: "nowrap", position: "sticky", top: 0, zIndex: 1 },
        thCenter: { textAlign: "center", padding: "12px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#FFFFFF", background: "#1F3A63", whiteSpace: "nowrap", position: "sticky", top: 0, zIndex: 1 },
        td: { padding: "12px 16px", fontSize: 13.5, color: themeG.textMain, borderBottom: `1px solid ${themeG.border}`, textAlign: "center" },
        tdCenter: { padding: "12px 16px", fontSize: 13.5, color: themeG.textMain, borderBottom: `1px solid ${themeG.border}`, textAlign: "center" },
        qtyOk: { fontWeight: 700, color: "#1E9E5A" },
        qtyZero: { fontWeight: 700, color: "#B23A3A" },
        empty: { padding: 40, textAlign: "center", color: themeG.textSub, fontSize: 13.5 },

        pagerRow: { display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginTop: 12, fontSize: 12.5, color: themeG.textSub },
        pagerBtns: { display: "flex", alignItems: "center", gap: 6 },
        pagerBtn: (disabled) => ({ padding: "6px 12px", borderRadius: 8, border: `1px solid ${themeG.border}`, background: themeG.card, color: themeG.textMain, fontSize: 12.5, fontWeight: 600, fontFamily: FONT, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1 }),
    };

    return (
        <Layout pageTitle="Available Stock" pageSubtitle="Live stock across Oracle and locally added products.">
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />

            <div style={S.titleRow}>
                <div>
                    <h1 style={S.heading}>📦 Available Stock</h1>
                    <p style={S.headingSub}>
                        {activeTab} — {total.toLocaleString()} product{total === 1 ? "" : "s"}
                    </p>
                </div>
                <button style={S.exportBtn} onClick={handleExportExcel} disabled={exporting || total === 0}>
                    {exporting ? "Exporting…" : "⬇ Export Excel"}
                </button>
            </div>

            <div style={S.tabRow}>
                {TABS.map((t) => (
                    <button key={t.id} style={S.tabBtn(activeTab === t.id)} onClick={() => switchTab(t.id)}>
                        <span>{t.icon}</span> {t.label}
                    </button>
                ))}
            </div>

            <div style={S.searchRow}>
                <div style={S.searchWrap} ref={searchBoxRef}>
                    <input
                        style={S.searchInput}
                        placeholder={`Search ${activeTab} products by name...`}
                        value={query}
                        onChange={(e) => { setQuery(e.target.value); setMenuOpen(true); }}
                        onFocus={() => query && setMenuOpen(true)}
                    />
                    {menuOpen && suggestions.length > 0 && (
                        <div style={S.menu}>
                            {suggestions.map((name) => (
                                <div
                                    key={name}
                                    style={S.menuItem}
                                    onMouseDown={() => { setQuery(name); setDebouncedQuery(name); setPage(1); setMenuOpen(false); }}
                                >
                                    {name}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div style={{ ...S.searchWrap, flex: "0 1 280px" }}>
                    <input
                        style={S.searchInput}
                        placeholder="Search Sort No / Shade… e.g. 1520 black"
                        value={sortShade}
                        onChange={(e) => setSortShade(e.target.value)}
                    />
                </div>
            </div>

            {error && (
                <div style={{ marginBottom: 16, background: "rgba(178,58,58,0.08)", border: "1px solid rgba(178,58,58,0.25)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#B23A3A" }}>
                    {error}
                </div>
            )}

            <div style={S.tableCard}>
                {loading && rows.length === 0 ? (
                    <div style={S.empty}>Loading…</div>
                ) : rows.length === 0 ? (
                    <div style={S.empty}>No {activeTab} products match the current search.</div>
                ) : (
                    <div style={S.tableScroll} ref={tableScrollRef}>
                        <table style={S.table}>
                            <thead>
                                <tr>
                                    <th style={S.thCenter}>S.No</th>
                                    <th style={S.th}>Sort No</th>
                                    <th style={S.th}>Shade</th>
                                    <th style={S.th}>Product Name</th>
                                    <th style={S.thCenter}>Available Qty</th>
                                    <th style={S.thCenter}>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r, i) => (
                                    <tr key={`${r.source}-${r.sortNo}-${r.shadeNo}-${i}`}>
                                        <td style={S.tdCenter}>{pageOffset + i + 1}</td>
                                        <td style={S.td}>{r.sortNo || "—"}</td>
                                        <td style={S.td}>{r.shadeNo || "—"}</td>
                                        <td style={S.td}>{r.name}</td>
                                        <td style={S.tdCenter}>
                                            <span style={r.availableQty > 0 ? S.qtyOk : S.qtyZero}>
                                                {Number(r.availableQty || 0).toLocaleString()}
                                            </span>
                                        </td>
                                        <td style={S.tdCenter}>
                                            <span style={S.statusPill(r.availableQty >= LOW_STOCK_THRESHOLD)}>
                                                {r.availableQty >= LOW_STOCK_THRESHOLD ? "Stock Available" : "Stock Shortage"}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {total > 0 && (
                <div style={S.pagerRow}>
                    <span>
                        Showing {(pageOffset + 1).toLocaleString()}–{(pageOffset + rows.length).toLocaleString()} of {total.toLocaleString()}
                        {loading ? " · Loading…" : ""}
                    </span>
                    <div style={S.pagerBtns}>
                        <button style={S.pagerBtn(page <= 1 || loading)} disabled={page <= 1 || loading} onClick={() => goToPage(1)}>« First</button>
                        <button style={S.pagerBtn(page <= 1 || loading)} disabled={page <= 1 || loading} onClick={() => goToPage(page - 1)}>‹ Prev</button>
                        <span>Page {page} / {totalPages}</span>
                        <button style={S.pagerBtn(page >= totalPages || loading)} disabled={page >= totalPages || loading} onClick={() => goToPage(page + 1)}>Next ›</button>
                        <button style={S.pagerBtn(page >= totalPages || loading)} disabled={page >= totalPages || loading} onClick={() => goToPage(totalPages)}>Last »</button>
                    </div>
                </div>
            )}
        </Layout>
    );
}