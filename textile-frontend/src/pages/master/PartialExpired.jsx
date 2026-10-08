// src/pages/master/PartialExpired.jsx
//
// Partially-allocated orders stay on Marketing Review for 48 hours after their
// FIRST allocation (with a "remaining qty" dropdown). Once that window has
// passed, they leave Marketing Review and are listed here instead, so the
// unfulfilled balance is still visible and can be followed up.
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, ArrowLeft } from "lucide-react";
import Layout from "../../components/AppLayout";
import API from "../../services/api";

export const PARTIAL_WINDOW_HOURS = 48;

const hoursSince = (iso) => {
  if (!iso) return null;
  const t = new Date(String(iso).replace(" ", "T")).getTime();
  return isNaN(t) ? null : (Date.now() - t) / 36e5;
};

export default function PartialExpired() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await API.get("/allocations/board");
        const flat = [];
        (res.data?.products || []).forEach((p) =>
          (p.customers || []).forEach((c) => {
            const allocated = c.allocatedQty || 0;
            const requested = c.orderedQty || 0;
            const age = hoursSince(c.firstAllocatedAt);
            if (allocated > 0 && allocated < requested && age !== null && age >= PARTIAL_WINDOW_HOURS) {
              flat.push({
                key: `${p.productId}-${c.orderId}`,
                orderNo: c.orderNo, customerName: c.name, customerCode: c.code,
                district: c.district || "", productCode: p.code, productName: p.name,
                requested, allocated, remaining: requested - allocated,
                since: c.firstAllocatedAt, hoursOver: Math.floor(age - PARTIAL_WINDOW_HOURS),
              });
            }
          })
        );
        if (alive) setRows(flat);
      } catch (err) {
        if (alive) setError(err.response?.data?.message || "Failed to load expired partial allocations.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => [r.orderNo, r.customerName, r.customerCode, r.productName, r.productCode, r.district]
      .some((v) => String(v || "").toLowerCase().includes(s)));
  }, [rows, q]);

  const th = { padding: "12px 14px", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "#fff", background: "#122C48", textAlign: "center", whiteSpace: "nowrap" };
  const td = { padding: "11px 14px", fontSize: 13, textAlign: "center", borderBottom: "1px solid #DBE3EC" };

  return (
    <Layout pageTitle="Expired Partial Allocations">
      <div className="font-body">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate("/master/batches")}><ArrowLeft size={12} /> Marketing Review</button>
          <div style={{ position: "relative", maxWidth: 420, flex: 1 }}>
            <Search size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#8C96A3" }} />
            <input className="field" style={{ width: "100%", boxSizing: "border-box", paddingLeft: 36 }} placeholder="Search order, customer, product or district…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <span style={{ fontSize: 13, color: "#526073" }}>
            Orders still short of their requested qty {PARTIAL_WINDOW_HOURS} hours after the first allocation.
          </span>
        </div>
        {error && <div className="tag tag-hold" style={{ display: "block", padding: "10px 14px", marginBottom: 12 }}>{error}</div>}
        <div className="card" style={{ padding: 12, overflowX: "auto" }}>
          {loading ? (
            <p style={{ textAlign: "center", padding: 30, color: "#526073" }}>Loading…</p>
          ) : (
            <table className="data-dark" style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["S.No", "Enquiry No", "Customer", "District", "Product Code", "Product", "Requested", "Allocated", "Remaining", "First Allocated", "Expired For"].map((h) => <th key={h} style={th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {visible.map((r, i) => (
                  <tr key={r.key}>
                    <td style={td}>{i + 1}</td>
                    <td style={{ ...td, fontWeight: 600 }}>{r.orderNo}</td>
                    <td style={td}>{r.customerName}<div style={{ fontSize: 11, color: "#6B7785" }}>{r.customerCode}</div></td>
                    <td style={td}>{r.district || "—"}</td>
                    <td style={td}>{r.productCode}</td>
                    <td style={td}>{r.productName}</td>
                    <td style={td}>{r.requested}</td>
                    <td style={td}>{r.allocated}</td>
                    <td style={{ ...td, fontWeight: 700, color: "#B2622E" }}>{r.remaining}</td>
                    <td style={td}>{String(r.since).slice(0, 16).replace("T", " ")}</td>
                    <td style={td}>{r.hoursOver >= 24 ? `${Math.floor(r.hoursOver / 24)}d ${r.hoursOver % 24}h` : `${r.hoursOver}h`}</td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr><td colSpan={11} style={{ ...td, padding: 30, color: "#526073" }}>No expired partial allocations.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Layout>
  );
}
