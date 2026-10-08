// src/pages/master/ComplaintsAndClaims.jsx
//
// Single page replacing the old Claims.jsx (admin/system_admin) AND
// EndUserComplaints.jsx (end_user, read-only) — ported from
// CottonMass_fixed's src/pages/shared/Complaints.jsx to look and behave
// exactly the same, but backed by the real GET /complaints and
// PATCH /complaints/{id}/resolve endpoints instead of demo data.
//
// Same trick CottonMass itself uses: the backend only really knows
// Open / In Progress / Resolved / Rejected, so the finer-grained journey
// (Marketing Review -> Assign to QC -> Quality Investigation -> RCA ->
// Management Approval -> Decision -> Confirmed -> Closed -> Feedback)
// is tracked client-side per complaint id, same as the reference file —
// this needs zero backend changes.
//
// FIX (font pass): wrapped the page root in `font-body` so it inherits
// the same Inter stack as Dashboard/OrderView. This page is entirely
// Tailwind-utility-class-driven (no inline fontFamily anywhere), and
// tailwind.config.js has `preflight: false`, so without an explicit
// font-body class it was falling back to the browser's default font
// instead of Inter — which is why it visually clashed with the rest
// of the app.
//
// FIX (Type filter mismatch): this page used to define its own local
// `complaintTypes` list ("Quality" / "Quantity" / "Dispatch Delay" /
// "Delivery Issue") which had zero overlap with the actual Type values
// customers can pick on RaiseComplaint.jsx ("Quality Issue" / "Wrong
// Item / Size" / "Damaged in Transit" / "Delivery Delay" / "Billing
// Issue" / "Other"). Since the Type filter compares directly against
// each complaint's real c.Type value from the backend, the old list
// could never actually match anything a customer submitted — filtering
// by Type was silently broken. Both pages now import COMPLAINT_TYPES
// from the same src/constants/complaintTypes.js, so the values a
// customer picks when filing are exactly the values staff can filter
// and see here. Lives in src/utils/complaintTypes.js.
import React, { useEffect, useMemo, useState } from "react";
import {
  MessageSquareWarning, Search, ClipboardList, Microscope, FileSearch, ShieldCheck,
  GitBranch, CheckCircle2, Circle, ChevronRight, ChevronDown, Truck, Receipt, XCircle,
  Boxes, Hourglass,
} from "lucide-react";
import Layout from "../../components/AppLayout";
import API from "../../services/api";
import { StatCardV2, EmptyState } from "../../components/reviewUiKit";
import { COMPLAINT_TYPES } from "../../utils/complaintTypes";

const INK = "#0F2138";
const SAPPHIRE = "#1F5C99";
const GOLD = "#D69426";
const CLAY = "#B23A3A";
const SLATE = "#526073";
const TEAL = "#2E7A72";

const PRE_STAGES = ["review", "qc", "investigation", "rca", "approval"];
const POST_STAGES = ["decision", "confirmed", "closed"];

const STAGE_LABEL = {
  review: "Marketing Review",
  qc: "Assigned to QC",
  investigation: "Quality Investigation",
  rca: "Root Cause Analysis",
  approval: "Awaiting Management Approval",
  decision: "Decision Recorded",
  confirmed: "Customer Confirmed",
  closed: "Complaint Closed",
};

const STAGE_TAG_CLASS = {
  review: "tag-pending", qc: "tag-pending", investigation: "tag-pending",
  rca: "tag-pending", approval: "tag-pending",
  decision: "tag-approved", confirmed: "tag-approved", closed: "tag-neutral",
};

// resolutionType (backend) -> the label shown on the decision branch
const DECISION_META = {
  Replacement: { icon: Truck, tone: SAPPHIRE, resolutionType: "replacement" },
  "Credit Note": { icon: Receipt, tone: GOLD, resolutionType: "credit_note" },
  Reject: { icon: XCircle, tone: CLAY, resolutionType: "rejected" },
};

const JOURNEY_HEAD = ["Customer Registers Complaint", "Marketing Review", "Assign to QC", "Quality Investigation", "Root Cause Analysis (RCA)", "Management Approval"];
const JOURNEY_TAIL = ["Customer Confirmation", "Complaint Closed"];

const ORDER = ["review", "qc", "investigation", "rca", "approval", "decision", "confirmed", "closed"];
function stepDoneIndex(stage) { return ORDER.indexOf(stage); }

// Map a complaint's real backend Status/ResolutionType onto a starting
// client-side stage the first time we see it (before any local advance).
function initialStageOf(c) {
  if (c.Status === "Resolved" || c.Status === "Rejected") return "closed";
  if (c.Status === "In Progress") return "qc";
  return "review"; // Open
}
function decisionLabelOf(c) {
  const map = { settlement: "Replacement", replacement: "Replacement", credit_note: "Credit Note", rejected: "Reject" };
  return c.ResolutionType ? (map[c.ResolutionType] || null) : null;
}

function JourneySegment({ steps, doneCount }) {
  return (
    <div className="overflow-x-auto scroll pb-1">
      <div className="flex items-center min-w-max">
        {steps.map((step, i) => {
          const done = i < doneCount;
          const isCurrent = i === doneCount - 1;
          return (
            <React.Fragment key={step}>
              <div className="flex flex-col items-center gap-1.5 px-2">
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
                  style={{
                    background: done ? (isCurrent ? SAPPHIRE : `${SAPPHIRE}1A`) : "#EAEFF5",
                    color: done ? (isCurrent ? "#fff" : SAPPHIRE) : "#9AA7B5",
                    border: isCurrent ? `2px solid ${SAPPHIRE}` : "1px solid transparent",
                  }}
                >
                  {done ? <CheckCircle2 size={13} /> : <Circle size={13} />}
                </div>
                <span className="text-[10px] font-medium text-center leading-tight max-w-[86px]" style={{ color: done ? INK : "#9AA7B5" }}>
                  {step}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div className="h-px w-6 shrink-0" style={{ background: i < doneCount - 1 ? SAPPHIRE : "#DBE3EC" }} />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

function DecisionBranch({ decision, reached }) {
  return (
    <div className="flex flex-col items-center my-1">
      <div className="w-px h-3" style={{ background: reached ? SAPPHIRE : "#DBE3EC" }} />
      <div className="flex items-stretch gap-2">
        {Object.entries(DECISION_META).map(([label, meta]) => {
          const taken = decision === label;
          const Icon = meta.icon;
          return (
            <div
              key={label}
              className="flex flex-col items-center gap-1 px-3 py-2 rounded-lg border text-center"
              style={{
                borderColor: taken ? meta.tone : "#DBE3EC",
                background: taken ? `${meta.tone}12` : "#F9FAFC",
                opacity: reached && !taken && decision ? 0.45 : 1,
              }}
            >
              <Icon size={14} style={{ color: taken ? meta.tone : "#9AA7B5" }} />
              <span className="text-[10px] font-semibold" style={{ color: taken ? meta.tone : "#9AA7B5" }}>{label}</span>
            </div>
          );
        })}
      </div>
      <div className="w-px h-3" style={{ background: decision ? SAPPHIRE : "#DBE3EC" }} />
    </div>
  );
}

export default function ComplaintsAndClaims() {
  const role = localStorage.getItem("role") || "";
  const canAct = ["admin", "system_admin"].includes(role); // matches backend's resolve() permission

  const [complaints, setComplaints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Local per-complaint stage tracking — same pattern as the reference file:
  // the backend only knows Open/In Progress/Resolved/Rejected, so the finer
  // stages in between live here, keyed by complaint id.
  const [stages, setStages] = useState({});
  const [expanded, setExpanded] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState("");

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const load = async () => {
    setLoading(true); setError("");
    try {
      const res = await API.get("/complaints");
      setComplaints(res.data || []);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load complaints.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const stageOf = (c) => stages[c.Id] ?? initialStageOf(c);
  const setStage = (id, stage) => setStages((s) => ({ ...s, [id]: stage }));
  const toggleExpand = (id) => setExpanded((s) => ({ ...s, [id]: !s[id] }));
  const advance = (id, next) => setStage(id, next);

  const decide = async (c, decisionLabel) => {
    const meta = DECISION_META[decisionLabel];
    setBusyId(c.Id); setActionError("");
    try {
      await API.patch(`/complaints/${c.Id}/resolve`, {
        resolutionType: meta.resolutionType,
        resolution: `Resolved via ${decisionLabel} decision from the Complaints & Claims desk.`,
      });
      setStage(c.Id, "decision");
      await load();
    } catch (err) {
      setActionError(err.response?.data?.message || "Failed to record the decision.");
    } finally {
      setBusyId(null);
    }
  };

  const enriched = useMemo(
    () => complaints.map((c) => ({ c, stage: stageOf(c) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [complaints, stages]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enriched.filter(({ c, stage }) => {
      const hay = [`CMP-${c.Id}`, c.customer?.Name, c.order?.Code, c.Description].join(" ").toLowerCase();
      if (q && !hay.includes(q)) return false;
      if (typeFilter !== "all" && c.Type !== typeFilter) return false;
      if (statusFilter !== "all" && stage !== statusFilter) return false;
      return true;
    });
  }, [enriched, search, typeFilter, statusFilter]);

  const kpis = useMemo(() => {
    const open = enriched.filter(({ stage }) => stage !== "closed").length;
    const inQc = enriched.filter(({ stage }) => ["qc", "investigation", "rca"].includes(stage)).length;
    const pendingApproval = enriched.filter(({ stage }) => stage === "approval").length;
    const resolved = enriched.filter(({ stage }) => stage === "closed").length;
    return { open, inQc, pendingApproval, resolved };
  }, [enriched]);

  return (
    <Layout pageTitle="Complaints & Claims">
      <div className="font-body">
        {error && (
          <div className="mb-4 rounded-lg border px-3.5 py-2.5 text-sm" style={{ background: "rgba(178,58,58,0.08)", borderColor: "rgba(178,58,58,0.25)", color: CLAY }}>
            {error}
          </div>
        )}
        {actionError && (
          <div className="mb-4 rounded-lg border px-3.5 py-2.5 text-sm" style={{ background: "rgba(178,58,58,0.08)", borderColor: "rgba(178,58,58,0.25)", color: CLAY }}>
            {actionError}
          </div>
        )}

        {/* KPI Cards */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <StatCardV2 icon={MessageSquareWarning} label="Open" value={kpis.open} accent={GOLD} />
          <StatCardV2 icon={Microscope} label="In QC / RCA" value={kpis.inQc} accent={SAPPHIRE} />
          <StatCardV2 icon={Hourglass} label="Pending Approval" value={kpis.pendingApproval} accent={CLAY} />
          <StatCardV2 icon={CheckCircle2} label="Resolved" value={kpis.resolved} accent={TEAL} />
        </div>

        {/* Filters — Type / Status / Search / Clear all sit in one 4-column
            grid, each getting an equal-width cell so Clear matches the
            other fields' size instead of being a small button off to the
            side. Clear is its own dedicated cell (not sharing with Search),
            so there's no overlap. Type options now come from the same
            COMPLAINT_TYPES list customers pick from on RaiseComplaint.jsx,
            so this filter actually matches real complaint data. */}
        <div className="card p-3 mb-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
            <div className="flex flex-col gap-1">
              <label className="field-label">Type</label>
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="field w-full">
                <option value="all">All Types</option>
                {COMPLAINT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="field-label">Status</label>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="field w-full">
                <option value="all">All Statuses</option>
                {[...PRE_STAGES, ...POST_STAGES].map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="field-label">Search</label>
              <div className="relative">
                <Search size={13} className="absolute left-0 top-1/2 -translate-y-1/2 text-slate" />
                <input
                  type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="Complaint / customer / SO…" className="field w-full pl-8"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1 items-end">
              <label className="field-label opacity-0 select-none">Clear</label>
              <button className="btn btn-ghost justify-center" style={{ width: "70%" }} onClick={() => { setSearch(""); setTypeFilter("all"); setStatusFilter("all"); }}>
                Clear
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <span className="text-xs text-slate">
            Showing <span className="font-semibold text-pine">{filtered.length}</span> of {complaints.length} complaints
          </span>
        </div>

        {/* Complaint cards */}
        <div className="flex flex-col gap-4">
          {loading ? (
            <div className="card p-6"><EmptyState icon={Boxes} text="Loading…" /></div>
          ) : (
            <>
              {filtered.map(({ c, stage }) => {
                const isOpen = !!expanded[c.Id];
                const decision = decisionLabelOf(c);
                const doneCount = Math.min(stepDoneIndex(stage) + 2, PRE_STAGES.length + 1);
                const branchReached = doneCount >= PRE_STAGES.length + 1;
                const tailDone = branchReached ? Math.max(0, stepDoneIndex(stage) - stepDoneIndex("decision") + 1) : 0;
                const busy = busyId === c.Id;

                return (
                  <div key={c.Id} className="card p-4">
                    {/* Header */}
                    <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-line">
                      <div className="flex items-center gap-3">
                        <button onClick={() => toggleExpand(c.Id)} className="shrink-0">
                          {isOpen ? <ChevronDown size={15} className="text-slate" /> : <ChevronRight size={15} className="text-slate" />}
                        </button>
                        <span className="grid place-items-center w-9 h-9 rounded-lg shrink-0" style={{ background: `${INK}0D`, color: INK }}>
                          <MessageSquareWarning size={16} />
                        </span>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm text-pine">CMP-{c.Id}</span>
                            <ChevronRight size={12} className="text-slate/50" />
                            <span className="text-sm text-slate">{c.customer?.Name ?? "—"}</span>
                          </div>
                          <div className="text-[11px] text-slate/80 mt-0.5 flex items-center gap-2 flex-wrap">
                            <span className="">{c.order?.Code ?? "—"}</span> · <span>{c.Type}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {decision && (
                          <span
                            className="inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-md"
                            style={{ background: `${DECISION_META[decision]?.tone || SLATE}14`, color: DECISION_META[decision]?.tone || SLATE }}
                          >
                            {decision}
                          </span>
                        )}
                        <span className={`tag ${STAGE_TAG_CLASS[stage]}`}>{STAGE_LABEL[stage]}</span>
                      </div>
                    </div>

                    <div className="text-xs text-slate mt-3">{c.Description}</div>

                    {isOpen && (
                      <div className="pt-4">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate mb-2">Resolution Journey</div>
                        <JourneySegment steps={JOURNEY_HEAD} doneCount={doneCount} />
                        <DecisionBranch decision={decision} reached={branchReached} />
                        <JourneySegment steps={JOURNEY_TAIL} doneCount={tailDone} />
                      </div>
                    )}

                    {/* Staff actions — advance the workflow stage by stage.
                        Everything before "approval" is local UI state (same
                        as the reference file); only the final decision calls
                        the real API, since that's all the backend tracks. */}
                    {canAct && (
                      <div className="mt-4 pt-3 border-t border-line flex flex-wrap items-center gap-2">
                        {stage === "review" && (
                          <button onClick={() => advance(c.Id, "qc")} className="btn btn-secondary btn-sm">
                            <ClipboardList size={12} /> Assign to QC
                          </button>
                        )}
                        {stage === "qc" && (
                          <button onClick={() => advance(c.Id, "investigation")} className="btn btn-secondary btn-sm">
                            <Microscope size={12} /> Start Quality Investigation
                          </button>
                        )}
                        {stage === "investigation" && (
                          <button onClick={() => advance(c.Id, "rca")} className="btn btn-secondary btn-sm">
                            <FileSearch size={12} /> Submit Root Cause Analysis
                          </button>
                        )}
                        {stage === "rca" && (
                          <button onClick={() => advance(c.Id, "approval")} className="btn btn-secondary btn-sm">
                            <ShieldCheck size={12} /> Send for Management Approval
                          </button>
                        )}
                        {stage === "approval" && (
                          <>
                            <span className="text-xs text-slate mr-1 inline-flex items-center gap-1"><GitBranch size={12} /> Decision:</span>
                            <button disabled={busy} onClick={() => decide(c, "Replacement")} className="btn btn-ghost btn-sm">
                              <Truck size={12} /> Replacement
                            </button>
                            <button disabled={busy} onClick={() => decide(c, "Credit Note")} className="btn btn-ghost btn-sm">
                              <Receipt size={12} /> Credit Note
                            </button>
                            <button disabled={busy} onClick={() => decide(c, "Reject")} className="btn btn-ghost btn-sm text-rust">
                              <XCircle size={12} /> Reject
                            </button>
                          </>
                        )}
                        {stage === "decision" && (
                          <button onClick={() => advance(c.Id, "confirmed")} className="btn btn-secondary btn-sm">
                            <CheckCircle2 size={12} /> Confirm with Customer
                          </button>
                        )}
                        {stage === "confirmed" && (
                          <button onClick={() => advance(c.Id, "closed")} className="btn btn-primary btn-sm">
                            <CheckCircle2 size={12} /> Close Complaint
                          </button>
                        )}
                        {stage === "closed" && (
                          <span className="text-xs font-medium inline-flex items-center gap-1.5" style={{ color: TEAL }}>
                            <CheckCircle2 size={13} /> Complaint closed.
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {filtered.length === 0 && complaints.length > 0 && (
                <div className="card p-6"><EmptyState icon={Search} text="No complaints match the current filters." /></div>
              )}
              {complaints.length === 0 && (
                <div className="card p-6"><EmptyState icon={Boxes} text="No complaints raised yet." /></div>
              )}
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}