// src/pages/master/CustomerList.jsx
//
// Customers hub — three tabs in one place instead of three separate pages:
//   1. Customer List   — the master CRUD table (was this file, alone)
//   2. Customer Orders  — pick a customer, see their order history
//   3. Customer Status — approve / decline / reset a customer's account
//                          (was pages/status/StatusCustomers.jsx)
import { useTheme } from "../../ThemeContext";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../../components/Layout";
import { getG, statusColor } from "../../theme";
import API from "../../services/api";
import ExcelToolbar from "../../components/ExcelToolbar";

// Columns shown in the Customer List table — the Excel download/upload
// columns are always kept identical to this list.
const CUSTOMER_EXCEL_COLUMNS = [
  { key: "id", header: "ID" },
  { key: "name", header: "Customer Name" },
  { key: "phone", header: "Phone" },
  { key: "district", header: "District" },
  { key: "taluk", header: "Taluk" },
  { key: "type", header: "Type" },
  { key: "orders", header: "Orders" },
  { key: "balance", header: "Balance (₹)" },
  { key: "status", header: "Status" },
];

const FONT = "'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const getThemeColors = () => getG(localStorage.getItem("premier_theme") === "dark");

/* Row color by customer type */
const typeColors = {
  wholesale: { bg: "rgba(216,230,243,0.22)", dot: "#5B9BD9", border: "rgba(91,155,217,0.20)" },
  retail: { bg: "rgba(200,240,200,0.22)", dot: "#1F5C99", border: "rgba(46,122,114,0.18)" },
};

const Badge = ({ text }) => {
  const s = statusColor(text);
  return (
    <span style={{ ...s, padding: "3px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, border: `1px solid ${s.border}` }}>
      {text.charAt(0).toUpperCase() + text.slice(1)}
    </span>
  );
};

const TypeBadge = ({ type }) => {
  const tc = typeColors[type] || typeColors.retail;
  return (
    <span style={{ fontSize: 12, fontWeight: 600, color: tc.dot, background: `${tc.border}`, border: `1px solid ${tc.border}`, padding: "2px 10px", borderRadius: 20 }}>
      {type.charAt(0).toUpperCase() + type.slice(1)}
    </span>
  );
};

const btnStyle = (color) => ({ width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", padding: 0, borderRadius: 7, border: `1px solid ${color}40`, background: `${color}14`, color, cursor: "pointer", fontSize: 13, fontFamily: "inherit", fontWeight: 600, flexShrink: 0 });

function FilterPills({ values, active, onSelect }) {
  const themeG = getThemeColors();
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {values.map((v) => (
        <button
          key={v}
          onClick={() => onSelect(v)}
          style={{ padding: "6px 14px", borderRadius: 20, border: "1px solid", cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 500, transition: "all 0.12s", background: active === v ? "rgba(91,155,217,0.14)" : "transparent", color: active === v ? themeG.textLabel : themeG.textSub, borderColor: active === v ? "rgba(91,155,217,0.40)" : themeG.border }}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

export default function CustomerList() {
  const { isDark } = useTheme();
  const themeG = getG(isDark);
  const navigate = useNavigate();

  const [tab, setTab] = useState("list"); // "list" | "orders" | "status"

  const tabBtn = (key, label) => (
    <button
      onClick={() => setTab(key)}
      style={{
        padding: "9px 20px", borderRadius: 9, border: "none", cursor: "pointer",
        fontFamily: FONT, fontSize: 13.5, fontWeight: 700,
        background: tab === key ? themeG.accent : "transparent",
        color: tab === key ? "#fff" : themeG.textSub,
      }}
    >
      {label}
    </button>
  );

  return (
    <Layout pageTitle="Customers">
      <div style={{ display: "inline-flex", background: themeG.bg, border: `1px solid ${themeG.border}`, borderRadius: 11, padding: 3, marginBottom: 22 }}>
        {tabBtn("list", "Customer List")}
        {tabBtn("orders", "Customer Orders")}
        {tabBtn("status", "Customer Status")}
      </div>

      {tab === "list" && <CustomerListTab themeG={themeG} navigate={navigate} />}
      {tab === "orders" && <CustomerOrdersTab themeG={themeG} navigate={navigate} />}
      {tab === "status" && <CustomerStatusTab themeG={themeG} navigate={navigate} />}
    </Layout>
  );
}

/* ───────────────────────── Tab 1: Customer List ───────────────────────── */

function CustomerListTab({ themeG, navigate }) {
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("All");
  const [filterStatus, setFilterStatus] = useState("All");
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState(null);

  const load = async () => {
    try {
      const res = await API.get("/customers");
      const mapped = res.data.map((c) => ({
        id: c.Code,
        dbId: c.Id,
        name: c.Name,
        phone: c.Phone,
        district: c.District,
        taluk: c.Taluk,
        type: c.Type,
        status: c.Status,
        orders: c.orders_count ?? 0,
        balance: parseFloat(c.Outstanding) || 0,
      }));
      setCustomers(mapped);
    } catch (err) {
      setError("Failed to load customers.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const handleDelete = async (c) => {
    if (!window.confirm(`Delete customer ${c.name} (${c.id})? This cannot be undone.`)) return;
    setDeletingId(c.dbId);
    setError("");
    try {
      await API.delete(`/customers/${c.dbId}`);
      setCustomers((list) => list.filter((x) => x.dbId !== c.dbId));
    } catch (err) {
      setError(err.response?.data?.message || "Failed to delete customer.");
    } finally {
      setDeletingId(null);
    }
  };

  // Bulk-add customers from an uploaded Excel file — one API call per
  // row, required fields matching what Add Customer itself requires.
  const handleImportRows = async (rows) => {
    let created = 0, failed = 0;
    for (const row of rows) {
      if (!row.name || !row.phone || !row.district || !row.taluk) { failed++; continue; }
      try {
        await API.post("/customers", {
          name: row.name,
          phone: String(row.phone),
          type: (row.type || "retail").toString().toLowerCase(),
          district: row.district,
          taluk: row.taluk,
        });
        created++;
      } catch {
        failed++;
      }
    }
    await load();
    return { created, failed };
  };

  const filtered = customers.filter((c) => {
    const matchSearch = c.name.toLowerCase().includes(search.toLowerCase()) || c.id.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search);
    const matchType = filterType === "All" || c.type === filterType.toLowerCase();
    const matchStatus = filterStatus === "All" || c.status === filterStatus.toLowerCase();
    return matchSearch && matchType && matchStatus;
  });

  if (loading) return <p style={{ color: themeG.textSub }}>Loading customers…</p>;

  return (
    <>
      {error && (
        <div style={{ marginBottom: 16, background: "rgba(178,58,58,0.08)", border: "1px solid rgba(178,58,58,0.25)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#B23A3A" }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <input
          placeholder="Search name, ID or phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: "9px 14px", borderRadius: 9, border: `1px solid ${themeG.border}`, fontSize: 13, width: 260, fontFamily: FONT, background: themeG.card, outline: "none", color: themeG.textMain }}
        />
        <FilterPills label="Type" values={["All", "Wholesale", "Retail"]} active={filterType} onSelect={setFilterType} />
        <FilterPills label="Status" values={["All", "Approved", "Pending", "Declined"]} active={filterStatus} onSelect={setFilterStatus} />
        <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "flex-start" }}>
          <ExcelToolbar
            themeG={themeG}
            rows={filtered}
            columns={CUSTOMER_EXCEL_COLUMNS}
            filename="customers"
            reportTitle="Customer Details"
            onImportRows={handleImportRows}
          />
          <button
            onClick={() => navigate("/master/customers/add")}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 20px", borderRadius: 9, background: themeG.accent, color: themeG.card, border: "none", fontFamily: FONT, fontSize: 13, fontWeight: 600, cursor: "pointer", boxShadow: "0 2px 10px rgba(91,155,217,0.32)" }}
          >
            + Add Customer
          </button>
        </div>
      </div>

      <div style={{ background: themeG.card, border: `1px solid ${themeG.border}`, borderRadius: 14, boxShadow: "0 4px 16px rgba(46,122,114,0.06)" }}>
        <div style={{ overflowX: "auto", borderRadius: "14px 14px 0 0" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${themeG.border}` }}>
                {["ID", "Customer Name", "Phone", "District", "Taluk", "Type", "Orders", "Balance (₹)", "Status", "Actions"].map((h) => (
                  <th key={h} style={{ textAlign: "center", fontSize: 11, padding: "10px 12px", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, whiteSpace: "nowrap", color: "#FFFFFF", background: "#1F3A63" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={10} style={{ textAlign: "center", padding: 40, color: themeG.textSub, fontSize: 14 }}>No customers found.</td></tr>
              ) : filtered.map((c) => {
                const rc = typeColors[c.type] || typeColors.retail;
                return (
                  <tr key={c.id} style={{ borderBottom: "1px solid rgba(46,122,114,0.06)", background: "#FFFFFF" }}>
                    <td style={{ padding: "12px 12px", fontSize: 13, color: themeG.accent, fontWeight: 600, borderLeft: `3px solid ${rc.dot}`, whiteSpace: "nowrap", textAlign: "center" }}>{c.id}</td>
                    <td style={{ padding: "12px 12px", fontSize: 14, color: themeG.textMain, fontWeight: 500, textAlign: "center" }}>
                      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={c.name}>{c.name}</span>
                    </td>
                    <td style={{ padding: "12px 12px", fontSize: 13, color: themeG.textSub, whiteSpace: "nowrap", textAlign: "center" }}>{c.phone}</td>
                    <td style={{ padding: "12px 12px", fontSize: 13, color: themeG.textMain, whiteSpace: "nowrap", textAlign: "center" }}>{c.district}</td>
                    <td style={{ padding: "12px 12px", fontSize: 13, color: themeG.textSub, whiteSpace: "nowrap", textAlign: "center" }}>{c.taluk}</td>
                    <td style={{ padding: "12px 12px", whiteSpace: "nowrap", textAlign: "center" }}><TypeBadge type={c.type} /></td>
                    <td style={{ padding: "12px 12px", fontSize: 13, fontWeight: 600, color: themeG.textMain, whiteSpace: "nowrap", textAlign: "center" }}>{c.orders}</td>
                    <td style={{ padding: "12px 12px", fontSize: 13, fontWeight: 700, color: c.balance > 0 ? "#B23A3A" : themeG.textSub, whiteSpace: "nowrap", textAlign: "center" }}>
                      {c.balance > 0 ? `₹${c.balance.toLocaleString()}` : "—"}
                    </td>
                    <td style={{ padding: "12px 12px", whiteSpace: "nowrap", textAlign: "center" }}><Badge text={c.status} /></td>
                    <td style={{ padding: "12px 12px", textAlign: "center" }}>
                      <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                        <button style={btnStyle("#5B9BD9")} onClick={() => navigate(`/master/customers/${c.dbId}`)} title="View">👁️</button>
                        <button style={btnStyle(themeG.accent)} onClick={() => navigate(`/master/customers/${c.dbId}?edit=1`)} title="Edit">✏️</button>
                        <button
                          style={btnStyle("#B23A3A")}
                          disabled={deletingId === c.dbId}
                          onClick={() => handleDelete(c)}
                          title="Delete customer"
                        >
                          {deletingId === c.dbId ? "…" : "🗑️"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ padding: "10px 13px", borderTop: `1px solid ${themeG.border}`, fontSize: 12, color: themeG.textSub }}>
          Showing {filtered.length} of {customers.length} customers
        </div>
      </div>
    </>
  );
}

/* ──────────────────────── Tab 2: Customer Orders ───────────────────────── */

function CustomerOrdersTab({ themeG, navigate }) {
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [orders, setOrders] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await API.get("/customers");
        setCustomers(res.data);
        if (res.data.length > 0) setSelected(res.data[0]);
      } catch (err) {
        setError("Failed to load customers.");
      } finally {
        setListLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selected) return;
    (async () => {
      setOrdersLoading(true);
      try {
        const res = await API.get("/orders", { params: { customer_id: selected.Id } });
        setOrders(res.data);
      } catch (err) {
        setError("Failed to load orders for this customer.");
      } finally {
        setOrdersLoading(false);
      }
    })();
  }, [selected]);

  const filteredCustomers = customers.filter((c) =>
    c.Name.toLowerCase().includes(search.toLowerCase()) || c.Code.toLowerCase().includes(search.toLowerCase())
  );

  const totalValue = orders.reduce((s, o) => s + (parseFloat(o.TotalAmount) || 0), 0);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "270px 1fr", gap: 18, alignItems: "start" }}>
      {/* ── Customer picker ── */}
      <div style={{ background: themeG.card, border: `1px solid ${themeG.border}`, borderRadius: 14, overflow: "hidden", boxShadow: "0 4px 16px rgba(46,122,114,0.05)" }}>
        <div style={{ padding: 12, borderBottom: `1px solid ${themeG.border}` }}>
          <input
            placeholder="Search customer…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: 8, border: `1px solid ${themeG.border}`, fontSize: 13, fontFamily: FONT, background: themeG.bg, outline: "none", color: themeG.textMain }}
          />
        </div>
        <div style={{ maxHeight: 520, overflowY: "auto" }}>
          {listLoading ? (
            <p style={{ padding: 20, fontSize: 13, color: themeG.textSub }}>Loading…</p>
          ) : filteredCustomers.length === 0 ? (
            <p style={{ padding: 20, fontSize: 13, color: themeG.textSub }}>No customers found.</p>
          ) : filteredCustomers.map((c) => (
            <div
              key={c.Id}
              onClick={() => setSelected(c)}
              style={{
                padding: "11px 14px", cursor: "pointer", borderBottom: `1px solid ${themeG.border}`,
                background: selected?.Id === c.Id ? "rgba(15,33,56,0.08)" : "transparent",
                borderLeft: selected?.Id === c.Id ? `3px solid ${themeG.accent}` : "3px solid transparent",
              }}
            >
              <p style={{ margin: "0 0 2px", fontSize: 13.5, fontWeight: 600, color: themeG.textMain }}>{c.Name}</p>
              <p style={{ margin: 0, fontSize: 11.5, color: themeG.textSub }}>{c.Code} · {c.orders_count ?? 0} order(s)</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Orders for selected customer ── */}
      <div style={{ background: themeG.card, border: `1px solid ${themeG.border}`, borderRadius: 14, padding: 22, boxShadow: "0 4px 16px rgba(46,122,114,0.05)" }}>
        {error && (
          <div style={{ marginBottom: 16, background: "rgba(178,58,58,0.08)", border: "1px solid rgba(178,58,58,0.25)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#B23A3A" }}>
            {error}
          </div>
        )}
        {!selected ? (
          <p style={{ color: themeG.textSub, fontSize: 13.5 }}>Select a customer to see their order history.</p>
        ) : (
          <>
            <h3 style={{ fontFamily: FONT, fontSize: 17, fontWeight: 700, color: themeG.textMain, margin: "0 0 4px" }}>{selected.Name}</h3>
            <p style={{ fontSize: 12.5, color: themeG.textSub, margin: "0 0 16px" }}>
              {selected.Code} · {orders.length} order(s) · Total value ₹{totalValue.toLocaleString()}
            </p>

            {ordersLoading ? (
              <p style={{ fontSize: 13, color: themeG.textSub }}>Loading orders…</p>
            ) : orders.length === 0 ? (
              <p style={{ fontSize: 13, color: themeG.textSub }}>No orders placed by this customer yet.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Order", "Product", "Qty", "Amount", "Date", "Status", "Payment"].map((h) => (
                      <th key={h} style={{ textAlign: "left", fontSize: 11, color: themeG.textLabel, padding: "10px 12px", borderBottom: `1px solid ${themeG.border}`, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.Id}>
                      <td style={{ padding: "11px 12px", fontSize: 13, color: themeG.accent, fontWeight: 700, cursor: "pointer", borderBottom: `1px solid ${themeG.border}` }} onClick={() => navigate(`/master/orders/${o.Id}`)}>{o.Code}</td>
                      <td style={{ padding: "11px 12px", fontSize: 13, color: themeG.textMain, borderBottom: `1px solid ${themeG.border}` }}>{o.product?.Name ?? "—"}</td>
                      <td style={{ padding: "11px 12px", fontSize: 13, color: themeG.textMain, borderBottom: `1px solid ${themeG.border}` }}>{o.Quantity}</td>
                      <td style={{ padding: "11px 12px", fontSize: 13, fontWeight: 600, color: themeG.textMain, borderBottom: `1px solid ${themeG.border}` }}>₹{parseFloat(o.TotalAmount).toLocaleString()}</td>
                      <td style={{ padding: "11px 12px", fontSize: 12, color: themeG.textSub, borderBottom: `1px solid ${themeG.border}` }}>{o.CreatedAt?.substring(0, 10)}</td>
                      <td style={{ padding: "11px 12px", borderBottom: `1px solid ${themeG.border}` }}><Badge text={o.Status} /></td>
                      <td style={{ padding: "11px 12px", borderBottom: `1px solid ${themeG.border}` }}><Badge text={o.PaymentStatus} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ──────────────────────── Tab 3: Customer Status ───────────────────────── */

function CustomerStatusTab({ themeG, navigate }) {
  const [filter, setFilter] = useState("approved");
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actingId, setActingId] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await API.get("/customers", { params: filter !== "all" ? { status: filter } : {} });
      setCustomers(res.data);
    } catch (err) {
      setError("Failed to load customers.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filter]);

  const th = { textAlign: "left", fontSize: 11, color: "#FFFFFF", background: "#1F3A63", padding: "12px 16px", borderBottom: "1px solid rgba(46,122,114,0.13)", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 };
  const td = { padding: "13px 16px", fontSize: 13.5, color: themeG.textMain };

  const actionBtn = (bg, color, border) => ({
    padding: "7px 16px", borderRadius: 8, border: `1px solid ${border}`, background: bg, color,
    cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap",
  });

  const setStatus = async (id, status) => {
    setActingId(id);
    setError("");
    try {
      await API.patch(`/customers/${id}/status`, { status });
      setCustomers((list) => list.filter((c) => c.Id !== id || filter === "all"));
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to update status.");
    } finally {
      setActingId(null);
    }
  };

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        {["pending", "approved", "declined", "all"].map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ padding: "8px 18px", borderRadius: 20, border: "1.5px solid", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600, textTransform: "capitalize", background: filter === f ? themeG.accent : themeG.card, color: filter === f ? themeG.card : themeG.textSub, borderColor: filter === f ? themeG.accent : themeG.border }}>
            {f}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ marginBottom: 16, background: "rgba(178,58,58,0.08)", border: "1px solid rgba(178,58,58,0.25)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#B23A3A" }}>
          {error}
        </div>
      )}

      <div style={{ background: themeG.card, border: `1px solid ${themeG.border}`, borderRadius: 14, overflow: "hidden", boxShadow: "0 4px 16px rgba(46,122,114,0.05)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["ID", "Name", "Phone", "District", "Type", "Status", "Actions"].map((h) => (
                <th key={h} style={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ ...td, textAlign: "center", padding: 30 }}>Loading…</td></tr>
            ) : customers.length === 0 ? (
              <tr><td colSpan={7} style={{ ...td, textAlign: "center", padding: 30, color: themeG.textSub }}>No customers in this filter.</td></tr>
            ) : customers.map((c) => (
              <tr key={c.Id} style={{ borderBottom: "1px solid rgba(46,122,114,0.08)" }}>
                <td style={{ ...td, fontWeight: 600, color: themeG.accent, cursor: "pointer" }} onClick={() => navigate(`/master/customers/${c.Id}`)}>{c.Code}</td>
                <td style={td}>{c.Name}</td>
                <td style={td}>{c.Phone}</td>
                <td style={td}>{c.District}</td>
                <td style={td}>{c.Type}</td>
                <td style={td}><Badge text={c.Status} /></td>
                <td style={td}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {c.Status !== "approved" && (
                      <button disabled={actingId === c.Id} onClick={() => setStatus(c.Id, "approved")} style={actionBtn("rgba(91,155,217,0.12)", themeG.accent, "rgba(91,155,217,0.30)")}>
                        Approve
                      </button>
                    )}
                    {c.Status !== "declined" && (
                      <button disabled={actingId === c.Id} onClick={() => setStatus(c.Id, "declined")} style={actionBtn("rgba(178,58,58,0.08)", "#B23A3A", "rgba(178,58,58,0.26)")}>
                        Decline
                      </button>
                    )}
                    {c.Status !== "pending" && (
                      <button disabled={actingId === c.Id} onClick={() => setStatus(c.Id, "pending")} style={actionBtn("rgba(214,148,38,0.10)", "#8A5A0E", "rgba(214,148,38,0.28)")}>
                        Reset
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ marginTop: 14, fontSize: 13, color: themeG.textSub }}>
        Showing {customers.length} customer{customers.length !== 1 ? "s" : ""} ({filter})
      </p>
    </>
  );
}