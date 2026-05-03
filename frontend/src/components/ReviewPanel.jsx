import { useState, useEffect } from "react";
import { getPendingCases, getCase, approveCase, rejectCase } from "../api";

// color tokens — i kept these in a C object instead of individual consts
// because reviewpanel has a lot of components and C.accent reads cleaner than ACCENT everywhere
const C = {
  bg:        "#141824",
  surface:   "#1a1f2e",
  surface2:  "#111520",
  border:    "#252b3d",
  accent:    "#5b6fe0",
  success:   "#22c55e",
  warning:   "#f59e0b",
  error:     "#ef4444",
  txt:       "#e8edf5",
  txt2:      "#8892aa",
  txt3:      "#4a5070",
  HIGH:      "#ef4444",
  MEDIUM:    "#f59e0b",
  LOW:       "#22c55e",
};

// urgency badge — HIGH=red, MEDIUM=amber, LOW=green
function UrgencyBadge({ level }) {
  const color = C[level] || C.txt2;
  return (
    <span style={{
      background: `${color}18`,
      color,
      border: `1px solid ${color}40`,
      borderRadius: 6,
      padding: "2px 10px",
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: "0.08em",
      fontFamily: "'IBM Plex Mono', monospace",
    }}>
      {level}
    </span>
  );
}

// confidence bar — each extracted field from the llm has a confidence score 0-1
// green >=90%, amber >=70%, red below 70% — reviewer knows what to double-check
function ConfBar({ value }) {
  const pct = Math.round((value || 0) * 100);
  const color = pct >= 90 ? C.success : pct >= 70 ? C.warning : C.error;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 4, background: C.border, borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: 11, color: C.txt2, fontFamily: "'IBM Plex Mono', monospace", minWidth: 30 }}>
        {pct}%
      </span>
    </div>
  );
}

// source quote pill — every field the llm extracted has a source_sentence attached
// clicking it shows the exact text from the pdf + a "view in pdf" link that scrolls the viewer to that page
// this is the traceability feature i'm most proud of — no blind trust in the ai
function SourceQuote({ sentence, pageRef, expanded, onToggle, onJump }) {
  const pageNum = parseInt((pageRef.match(/\d+/) || ["1"])[0]) || 1;
  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
        <button onClick={onToggle} style={{ background:"none", border:"none", cursor:"pointer", color:C.accent, fontSize:11, padding:0, fontFamily:"'IBM Plex Mono', monospace", display:"flex", alignItems:"center", gap:5 }}>
          <span style={{ opacity:0.7 }}>◈</span>
          {pageRef} {expanded ? "▲" : "▼"}
        </button>
        {onJump && sentence && (
          <button onClick={() => onJump(pageNum, sentence)} style={{ background:"none", border:"none", cursor:"pointer", color:"#6b84f8", fontSize:10, padding:0, fontFamily:"'IBM Plex Mono', monospace", textDecoration:"underline" }}>
            → view in PDF
          </button>
        )}
      </div>
      {expanded && (
        <div style={{ marginTop:6, padding:"10px 12px", background:"rgba(79,110,247,0.06)", border:`1px solid ${C.accent}30`, borderLeft:`3px solid ${C.accent}`, borderRadius:"0 6px 6px 0", fontSize:12, color:C.txt2, lineHeight:1.6, fontStyle:"italic", animation:"fadeIn 0.15s ease" }}>
          "{sentence}"
        </div>
      )}
    </div>
  );
}

// editable field row — the core of the review ui
// every extracted field shows: label | confidence bar | value | pencil edit button | source quote
// if the reviewer edits a value, we log it in the edits[] array for the audit trail
function FieldRow({ label, traced, onEdit, onHighlight }) {
  const [showSource, setShowSource] = useState(false);
  const [editing, setEditing]       = useState(false);
  const [editVal, setEditVal]       = useState("");

  if (!traced) return null; // field missing from extraction — just skip it cleanly

  const startEdit = () => { setEditVal(traced.value); setEditing(true); };
  const saveEdit  = () => { onEdit(editVal); setEditing(false); };

  return (
    <div style={fs.row}>
      <div style={fs.labelRow}>
        <span style={fs.label}>{label}</span>
        {traced.confidence !== undefined && <ConfBar value={traced.confidence} />}
      </div>

      {editing ? (
        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
          <input
            value={editVal}
            onChange={e => setEditVal(e.target.value)}
            autoFocus
            style={fs.input}
          />
          <button onClick={saveEdit} style={fs.saveBtn}>Save</button>
          <button onClick={() => setEditing(false)} style={fs.cancelBtn}>✕</button>
        </div>
      ) : (
        <div style={fs.valueRow}>
          <span style={fs.value}>{traced.value}</span>
          <button onClick={startEdit} style={fs.editBtn} title="Edit">✎</button>
        </div>
      )}

      {traced.source_sentence && (
        <div style={{ marginTop: 6 }}>
          <SourceQuote
            sentence={traced.source_sentence}
            pageRef={traced.page_ref || ""}
            expanded={showSource}
            onToggle={() => setShowSource(v => !v)}
            onJump={onHighlight}
          />
        </div>
      )}

      {traced.is_inferred && traced.inference_basis && (
        <div style={fs.inferTag}>
          ⟳ inferred · {traced.inference_basis}
        </div>
      )}
    </div>
  );
}

const fs = {
  row: {
    padding: "12px 0",
    borderBottom: `1px solid ${C.border}`,
  },
  labelRow: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    marginBottom: 4,
  },
  label: {
    fontSize: 11, fontWeight: 600, color: C.txt3,
    textTransform: "uppercase", letterSpacing: "0.08em",
    fontFamily: "'IBM Plex Mono', monospace",
  },
  valueRow: {
    display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8,
  },
  value: {
    fontSize: 14, color: C.txt, lineHeight: 1.5, flex: 1,
  },
  editBtn: {
    background: "none", border: "none", cursor: "pointer",
    color: C.txt3, fontSize: 14, padding: "0 4px",
    transition: "color 0.15s",
  },
  input: {
    flex: 1, padding: "6px 10px",
    background: C.surface2, border: `1px solid ${C.accent}`,
    borderRadius: 6, color: C.txt, fontSize: 13,
    fontFamily: "'IBM Plex Sans', sans-serif", outline: "none",
  },
  saveBtn: {
    padding: "6px 12px", background: C.accent, border: "none",
    borderRadius: 6, color: "#fff", fontSize: 12, cursor: "pointer",
    fontFamily: "'IBM Plex Sans', sans-serif",
  },
  cancelBtn: {
    padding: "6px 10px", background: "transparent",
    border: `1px solid ${C.border}`, borderRadius: 6,
    color: C.txt2, fontSize: 12, cursor: "pointer",
  },
  inferTag: {
    marginTop: 5, fontSize: 11, color: C.warning,
    fontFamily: "'IBM Plex Mono', monospace",
  },
};

// ── Direction card ────────────────────────────────────────────────────────────
function DirectionCard({ dir, index }) {
  const [showSource, setShowSource] = useState(false);
  return (
    <div style={{
      padding: "14px 16px",
      background: C.surface2,
      border: `1px solid ${C.border}`,
      borderLeft: `3px solid ${C.accent}`,
      borderRadius: "0 8px 8px 0",
      marginBottom: 8,
    }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <span style={{
          flexShrink: 0, width: 22, height: 22, borderRadius: "50%",
          background: `${C.accent}20`, color: C.accent,
          fontSize: 11, fontWeight: 700, display: "flex",
          alignItems: "center", justifyContent: "center",
          fontFamily: "'IBM Plex Mono', monospace",
        }}>{index + 1}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, color: C.txt, lineHeight: 1.5, marginBottom: 6 }}>
            {dir.text}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {dir.directive_type && (
              <span style={{
                fontSize: 10, color: C.accent, background: `${C.accent}15`,
                padding: "2px 8px", borderRadius: 4,
                fontFamily: "'IBM Plex Mono', monospace",
              }}>
                {dir.directive_type}
              </span>
            )}
            {dir.confidence !== undefined && <ConfBar value={dir.confidence} />}
          </div>
          {dir.source_sentence && (
            <div style={{ marginTop: 8 }}>
              <SourceQuote
                sentence={dir.source_sentence}
                pageRef={dir.page_ref || ""}
                expanded={showSource}
                onToggle={() => setShowSource(v => !v)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Timeline row ──────────────────────────────────────────────────────────────
function TimelineRow({ tl }) {
  return (
    <div style={{
      display: "flex", gap: 12, padding: "10px 0",
      borderBottom: `1px solid ${C.border}`,
      alignItems: "flex-start",
    }}>
      <div style={{
        flexShrink: 0, width: 8, height: 8, borderRadius: "50%", marginTop: 6,
        background: tl.is_deadline ? C.error : C.accent,
        boxShadow: tl.is_deadline ? `0 0 6px ${C.error}` : "none",
      }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, color: C.txt }}>{tl.event}</div>
        <div style={{ fontSize: 12, color: tl.is_deadline ? C.error : C.txt2, marginTop: 2 }}>
          {tl.date_value}
          {tl.is_inferred && <span style={{ color: C.warning, marginLeft: 8 }}>⟳ inferred</span>}
          {tl.is_deadline && <span style={{ marginLeft: 8 }}>· DEADLINE</span>}
        </div>
      </div>
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────
function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{
        fontSize: 11, fontWeight: 700, color: C.txt3,
        textTransform: "uppercase", letterSpacing: "0.1em",
        fontFamily: "'IBM Plex Mono', monospace",
        marginBottom: 12, paddingBottom: 8,
        borderBottom: `1px solid ${C.border}`,
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

// ── Queue item ────────────────────────────────────────────────────────────────
function QueueItem({ item, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: "100%", textAlign: "left", padding: "12px 14px",
        background: active ? `${C.accent}12` : "transparent",
        border: `1px solid ${active ? C.accent : C.border}`,
        borderRadius: 8, cursor: "pointer", marginBottom: 6,
        transition: "all 0.15s ease",
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: C.txt, marginBottom: 3 }}>
        {item.case_number}
      </div>
      <div style={{ fontSize: 11, color: C.txt2, marginBottom: 6, lineHeight: 1.4 }}>
        {item.case_title}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 10, color: C.txt3, fontFamily: "'IBM Plex Mono', monospace" }}>
          {item.court_name}
        </span>
        <UrgencyBadge level={item.urgency_level} />
      </div>
    </button>
  );
}

// main review panel — this is where human verification happens
// the whole point: ai extracts data, human checks it, then approves or rejects
// i split it into a sidebar (queue) + main area (the actual review form)
export default function ReviewPanel({ initialCaseId, onReviewComplete, onHighlight, onShowPdf, hasPdf }) {
  const [queue,      setQueue]      = useState([]);
  const [caseId,     setCaseId]     = useState(initialCaseId || null);
  const [caseData,   setCaseData]   = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState("");
  const [edits,      setEdits]      = useState([]); // audit log of every field the reviewer changed
  const [reviewer,   setReviewer]   = useState("Reviewer");
  const [notes,      setNotes]      = useState("");
  const [done,       setDone]       = useState(null); // "approved" | "rejected" — shows the completion screen

  // load the pending queue on mount — shows in the left sidebar
  useEffect(() => {
    getPendingCases()
      .then(setQueue)
      .catch(() => setError("Could not load pending cases"));
  }, []);

  // whenever the reviewer picks a different case from the queue, fetch its full data
  // i reset edits here so stale edits from the previous case don't carry over
  useEffect(() => {
    if (!caseId) return;
    setLoading(true);
    setError("");
    setCaseData(null);
    setEdits([]);
    setDone(null);
    getCase(caseId)
      .then(d => { setCaseData(d); setLoading(false); })
      .catch(() => { setError("Could not load case data"); setLoading(false); });
  }, [caseId]);

  // log every reviewer edit as a FieldEdit object
  // if they edit the same field twice, we replace the first entry — only the final value matters
  const handleEdit = (fieldName, original, edited) => {
    setEdits(prev => {
      const existing = prev.findIndex(e => e.field_name === fieldName);
      const entry = { field_name: fieldName, original: String(original), edited, edited_at: new Date().toISOString() };
      if (existing >= 0) { const n = [...prev]; n[existing] = entry; return n; }
      return [...prev, entry];
    });
  };

  // deep-patch the extraction object in state so the ui reflects the edit immediately
  // path looks like "case_number.value" or "court_name.value" — dot notation for nested fields
  const patchExtraction = (path, value) => {
    setCaseData(prev => {
      const next = JSON.parse(JSON.stringify(prev)); // deep clone so react sees a new object
      const parts = path.split(".");
      let obj = next.extraction;
      for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
      const leaf = parts[parts.length - 1];
      const original = obj[leaf];
      obj[leaf] = value;
      handleEdit(path, original, value);
      return next;
    });
  };

  // approve — sends reviewer name, notes, edits[], and optionally an updated action plan
  // on success: removes this case from the queue sidebar and decrements the nav badge
  const handleApprove = async () => {
    if (!caseData) return;
    setSubmitting(true);
    try {
      await approveCase(caseId, reviewer, notes || null, edits, null);
      setDone("approved");
      setQueue(q => q.filter(i => i.id !== caseId));
      onReviewComplete?.();
    } catch (e) {
      setError(e.response?.data?.detail || "Approve failed");
    } finally {
      setSubmitting(false);
    }
  };

  // reject — bad scan, wrong pdf, completely wrong extraction — case goes nowhere
  const handleReject = async () => {
    if (!caseData) return;
    setSubmitting(true);
    try {
      await rejectCase(caseId, reviewer, notes || null);
      setDone("rejected");
      setQueue(q => q.filter(i => i.id !== caseId));
      onReviewComplete?.();
    } catch (e) {
      setError(e.response?.data?.detail || "Reject failed");
    } finally {
      setSubmitting(false);
    }
  };

  // shortcuts so the jsx below doesn't have to say caseData.extraction everywhere
  const ext  = caseData?.extraction;
  const plan = caseData?.action_plan;

  return (
    <div style={ps.root}>
      {/* ── Left: queue ── */}
      <aside style={ps.sidebar}>
        <div style={ps.sidebarHeader}>
          <span style={ps.sidebarTitle}>Pending Review</span>
          <span style={ps.sidebarCount}>{queue.length}</span>
        </div>
        {queue.length === 0 && (
          <div style={ps.empty}>No cases pending.<br />Upload a judgment to begin.</div>
        )}
        {queue.map(item => (
          <QueueItem
            key={item.id}
            item={item}
            active={item.id === caseId}
            onClick={() => setCaseId(item.id)}
          />
        ))}
      </aside>

      {/* ── Right: review pane ── */}
      <div style={ps.main}>
        {!caseId && !loading && (
          <div style={ps.placeholder}>
            <div style={ps.placeholderIcon}>◈</div>
            <div style={ps.placeholderText}>Select a case from the queue to review</div>
            <div style={ps.placeholderSub}>
              Upload a court judgment PDF to get started
            </div>
          </div>
        )}

        {loading && (
          <div style={ps.center}>
            <div style={ps.spinner} />
            <div style={{ color: C.txt2, fontSize: 13, marginTop: 16 }}>Loading case data…</div>
          </div>
        )}

        {error && (
          <div style={ps.center}>
            <div style={{ color: C.error, fontSize: 13 }}>{error}</div>
          </div>
        )}

        {done && (
          <div style={ps.center}>
            <div style={{
              fontSize: 48,
              marginBottom: 16,
              filter: done === "approved"
                ? `drop-shadow(0 0 12px ${C.success})`
                : `drop-shadow(0 0 12px ${C.error})`,
            }}>
              {done === "approved" ? "✓" : "✕"}
            </div>
            <div style={{ fontSize: 18, fontWeight: 600, color: done === "approved" ? C.success : C.error }}>
              Case {done}
            </div>
            <div style={{ color: C.txt2, fontSize: 13, marginTop: 8 }}>
              {done === "approved" ? "Added to verified dashboard" : "Removed from queue"}
            </div>
            <button
              style={{ ...ps.btnPrimary, marginTop: 24 }}
              onClick={() => { setDone(null); setCaseId(null); setCaseData(null); }}
            >
              Review next case
            </button>
          </div>
        )}

        {caseData && !done && (
          <div style={ps.content}>
            {/* ── Case header ── */}
            <div style={ps.caseHeader}>
              <div style={{ flex: 1 }}>
                <div style={ps.caseNumber}>{ext?.case_number?.value || "—"}</div>
                <div style={ps.caseTitle}>{ext?.case_title?.value || "—"}</div>
                <div style={ps.caseMeta}>{ext?.court_name?.value} · {ext?.date_of_order?.value}</div>
              </div>
              <UrgencyBadge level={plan?.urgency_level || "MEDIUM"} />
            </div>

            {/* ── Summary ── */}
            {ext?.summary && (
              <div style={ps.summaryBox}>
                <span style={ps.summaryLabel}>AI SUMMARY</span>
                <p style={ps.summaryText}>{ext.summary}</p>
              </div>
            )}

            <div style={ps.twoCol}>
              {/* ── Left col: extraction fields ── */}
              <div style={ps.col}>
                <Section title="Case Identity">
                  <FieldRow label="Case Number"   traced={ext?.case_number}
                    onEdit={v => patchExtraction("case_number.value", v)}
                    onHighlight={onHighlight} />
                  <FieldRow label="Case Title"    traced={ext?.case_title}
                    onEdit={v => patchExtraction("case_title.value", v)}
                    onHighlight={onHighlight} />
                  <FieldRow label="Court"         traced={ext?.court_name}
                    onEdit={v => patchExtraction("court_name.value", v)}
                    onHighlight={onHighlight} />
                  <FieldRow label="Date of Order" traced={ext?.date_of_order}
                    onEdit={v => patchExtraction("date_of_order.value", v)}
                    onHighlight={onHighlight} />
                  {ext?.responsible_department && (
                    <FieldRow label="Responsible Dept" traced={ext.responsible_department}
                      onEdit={v => patchExtraction("responsible_department.value", v)}
                    onHighlight={onHighlight} />
                  )}
                </Section>

                <Section title="Parties">
                  {ext?.petitioner && (
                    <div style={fs.row}>
                      <div style={fs.label}>Petitioner</div>
                      <div style={fs.value}>{ext.petitioner.name}</div>
                    </div>
                  )}
                  {ext?.respondent && (
                    <div style={fs.row}>
                      <div style={fs.label}>Respondent</div>
                      <div style={fs.value}>{ext.respondent.name}</div>
                    </div>
                  )}
                </Section>

                <Section title="Compliance Flags">
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <FlagChip
                      label="Compliance Required"
                      value={ext?.compliance_required?.value}
                      source={ext?.compliance_required?.source_sentence}
                      pageRef={ext?.compliance_required?.page_ref}
                    />
                    <FlagChip
                      label="Appeal Possible"
                      value={ext?.appeal_possible?.value}
                      source={ext?.appeal_possible?.source_sentence}
                      pageRef={ext?.appeal_possible?.page_ref}
                    />
                  </div>
                </Section>

                <Section title={`Key Directives (${ext?.key_directions?.length || 0})`}>
                  {(ext?.key_directions || []).map((dir, i) => (
                    <DirectionCard key={i} dir={dir} index={i} />
                  ))}
                </Section>

                <Section title="Timelines">
                  {(ext?.timelines || []).map((tl, i) => (
                    <TimelineRow key={i} tl={tl} />
                  ))}
                </Section>
              </div>

              {/* ── Right col: action plan ── */}
              <div style={ps.col}>
                <Section title="Action Plan">
                  <div style={ps.planBox}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                      <span style={ps.actionType}>{plan?.action_required?.replace(/_/g, " ")}</span>
                      <UrgencyBadge level={plan?.urgency_level || "MEDIUM"} />
                    </div>
                    {plan?.primary_deadline && (
                      <div style={ps.deadlineBox}>
                        <span style={ps.deadlineLabel}>PRIMARY DEADLINE</span>
                        <span style={ps.deadlineValue}>{plan.primary_deadline}</span>
                        {plan.days_remaining !== null && plan.days_remaining !== undefined && (
                          <span style={{
                            fontSize: 12,
                            color: plan.days_remaining < 0 ? C.error
                                 : plan.days_remaining < 30 ? C.warning : C.success,
                            fontFamily: "'IBM Plex Mono', monospace",
                          }}>
                            {plan.days_remaining < 0
                              ? `${Math.abs(plan.days_remaining)} days overdue`
                              : `${plan.days_remaining} days remaining`}
                          </span>
                        )}
                      </div>
                    )}
                    <p style={{ fontSize: 13, color: C.txt2, lineHeight: 1.6, marginTop: 12 }}>
                      {plan?.summary_for_officer}
                    </p>
                  </div>
                </Section>

                <Section title="Recommended Steps">
                  {(plan?.recommended_steps || []).map((step, i) => (
                    <div key={i} style={{
                      display: "flex", gap: 12, padding: "10px 0",
                      borderBottom: `1px solid ${C.border}`,
                    }}>
                      <span style={{
                        flexShrink: 0, width: 22, height: 22, borderRadius: "50%",
                        background: `${C.accent}20`, color: C.accent,
                        fontSize: 11, fontWeight: 700, display: "flex",
                        alignItems: "center", justifyContent: "center",
                        fontFamily: "'IBM Plex Mono', monospace",
                      }}>{step.step_number}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, color: C.txt, lineHeight: 1.5 }}>
                          {step.description}
                        </div>
                        {step.deadline && (
                          <div style={{ fontSize: 11, color: C.error, marginTop: 4,
                            fontFamily: "'IBM Plex Mono', monospace" }}>
                            Due: {step.deadline}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </Section>

                <Section title="Appeal Analysis">
                  <div style={{
                    padding: "14px 16px",
                    background: plan?.appeal_analysis?.recommended ? `${C.warning}10` : `${C.success}08`,
                    border: `1px solid ${plan?.appeal_analysis?.recommended ? C.warning : C.success}30`,
                    borderRadius: 8,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: C.txt }}>
                        {plan?.appeal_analysis?.recommended ? "Appeal Recommended" : "Appeal Not Recommended"}
                      </span>
                      <span style={{
                        fontSize: 11, color: C.txt2,
                        fontFamily: "'IBM Plex Mono', monospace",
                        textTransform: "uppercase",
                      }}>
                        {plan?.appeal_analysis?.strength}
                      </span>
                    </div>
                    <p style={{ fontSize: 12, color: C.txt2, lineHeight: 1.5 }}>
                      {plan?.appeal_analysis?.reason}
                    </p>
                    {plan?.appeal_analysis?.limitation_date && (
                      <div style={{ marginTop: 8, fontSize: 12,
                        color: C.error, fontFamily: "'IBM Plex Mono', monospace" }}>
                        Appeal deadline: {plan.appeal_analysis.limitation_date}
                        {plan.appeal_analysis.limitation_days && ` (${plan.appeal_analysis.limitation_days} days)`}
                      </div>
                    )}
                  </div>
                </Section>

                {/* ── Reviewer input ── */}
                <Section title="Reviewer Sign-off">
                  <div style={{ marginBottom: 10 }}>
                    <label style={ps.inputLabel}>Your Name</label>
                    <input
                      value={reviewer}
                      onChange={e => setReviewer(e.target.value)}
                      style={ps.input}
                      placeholder="Enter your name"
                    />
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <label style={ps.inputLabel}>Notes (optional)</label>
                    <textarea
                      value={notes}
                      onChange={e => setNotes(e.target.value)}
                      style={{ ...ps.input, minHeight: 72, resize: "vertical" }}
                      placeholder="Any corrections or observations…"
                    />
                  </div>

                  {edits.length > 0 && (
                    <div style={ps.editsBox}>
                      <div style={{ fontSize: 11, color: C.warning, marginBottom: 6,
                        fontFamily: "'IBM Plex Mono', monospace" }}>
                        {edits.length} field{edits.length > 1 ? "s" : ""} edited
                      </div>
                      {edits.map((e, i) => (
                        <div key={i} style={{ fontSize: 11, color: C.txt2, marginBottom: 2 }}>
                          <span style={{ color: C.warning }}>{e.field_name}</span>
                          {" → "}{e.edited}
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={handleApprove}
                      disabled={submitting}
                      style={{ ...ps.btnPrimary, flex: 1 }}
                    >
                      {submitting ? "…" : "✓ Approve & Push to Dashboard"}
                    </button>
                    <button
                      onClick={handleReject}
                      disabled={submitting}
                      style={ps.btnReject}
                    >
                      ✕ Reject
                    </button>
                  </div>
                </Section>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Flag chip ─────────────────────────────────────────────────────────────────
function FlagChip({ label, value, source, pageRef }) {
  const [show, setShow] = useState(false);
  const color = value ? C.success : C.txt3;
  return (
    <div>
      <button
        onClick={() => source && setShow(v => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 7,
          padding: "6px 12px",
          background: value ? `${C.success}10` : `${C.border}50`,
          border: `1px solid ${value ? C.success : C.border}40`,
          borderRadius: 20, cursor: source ? "pointer" : "default",
          color, fontSize: 12, fontWeight: 500,
        }}
      >
        <span style={{
          width: 7, height: 7, borderRadius: "50%",
          background: color, flexShrink: 0,
        }} />
        {label}
        {source && <span style={{ opacity: 0.5 }}>{show ? "▲" : "▼"}</span>}
      </button>
      {show && source && (
        <div style={{
          marginTop: 6, padding: "8px 12px",
          background: `${C.accent}08`, border: `1px solid ${C.accent}20`,
          borderRadius: 6, fontSize: 11, color: C.txt2,
          fontStyle: "italic", lineHeight: 1.5,
        }}>
          [{pageRef}] "{source}"
        </div>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const ps = {
  root: {
    display: "flex", height: "calc(100vh - 90px)", overflow: "hidden",
    fontFamily: "'Inter', 'Segoe UI', sans-serif",
    background: C.bg,
  },
  sidebar: {
    width: 290, flexShrink: 0,
    background: C.surface,
    borderRight: `1px solid ${C.border}`,
    padding: 18, overflowY: "auto",
  },
  sidebarHeader: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    marginBottom: 16,
  },
  sidebarTitle: {
    fontSize: 12, fontWeight: 700, color: C.txt3,
    textTransform: "uppercase", letterSpacing: "0.1em",
    fontFamily: "'IBM Plex Mono', monospace",
  },
  sidebarCount: {
    background: C.accent, color: "#fff", fontSize: 11, fontWeight: 700,
    borderRadius: 10, padding: "2px 9px",
  },
  empty: {
    fontSize: 13, color: C.txt3, lineHeight: 1.7, textAlign: "center",
    padding: "28px 8px",
  },
  main: {
    flex: 1, overflowY: "auto", position: "relative",
    background: C.bg,
  },
  placeholder: {
    position: "absolute", inset: 0,
    display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center",
    gap: 14,
  },
  placeholderIcon: {
    fontSize: 48, color: C.txt3, opacity: 0.3,
  },
  placeholderText: { fontSize: 18, color: C.txt, fontWeight: 700 },
  placeholderSub:  { fontSize: 14, color: C.txt2 },
  center: {
    position: "absolute", inset: 0,
    display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center",
  },
  spinner: {
    width: 34, height: 34,
    border: `2px solid ${C.border}`, borderTopColor: C.accent,
    borderRadius: "50%", animation: "spin 0.8s linear infinite",
  },
  content: {
    padding: 32, animation: "fadeIn 0.2s ease",
  },
  caseHeader: {
    display: "flex", alignItems: "flex-start", gap: 16,
    marginBottom: 22, paddingBottom: 20, borderBottom: `1px solid ${C.border}`,
  },
  caseNumber: {
    fontSize: 12, color: C.accent, fontWeight: 600,
    fontFamily: "'IBM Plex Mono', monospace", marginBottom: 5,
  },
  caseTitle: {
    fontSize: 20, fontWeight: 700, color: C.txt, marginBottom: 5,
    lineHeight: 1.3,
  },
  caseMeta: {
    fontSize: 13, color: C.txt2,
  },
  summaryBox: {
    padding: "14px 18px",
    background: `${C.accent}0a`,
    border: `1px solid ${C.accent}25`,
    borderRadius: 10, marginBottom: 24,
  },
  summaryLabel: {
    display: "block", fontSize: 10, fontWeight: 700, color: C.accent,
    letterSpacing: "0.1em", fontFamily: "'IBM Plex Mono', monospace",
    marginBottom: 6, textTransform: "uppercase",
  },
  summaryText: { fontSize: 14, color: C.txt2, lineHeight: 1.65 },
  twoCol: {
    display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32,
  },
  col: {},
  planBox: {
    padding: "16px", background: C.surface,
    border: `1px solid ${C.border}`, borderRadius: 10, marginBottom: 10,
  },
  actionType: {
    fontSize: 13, fontWeight: 700, color: C.txt,
    fontFamily: "'IBM Plex Mono', monospace",
  },
  deadlineBox: {
    display: "flex", flexDirection: "column", gap: 3,
    padding: "10px 14px",
    background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)",
    borderRadius: 8,
  },
  deadlineLabel: {
    fontSize: 10, fontWeight: 700, color: C.error,
    letterSpacing: "0.1em", fontFamily: "'IBM Plex Mono', monospace",
  },
  deadlineValue: {
    fontSize: 18, fontWeight: 800, color: C.txt,
    fontFamily: "'Inter', sans-serif",
  },
  inputLabel: {
    display: "block", fontSize: 12, color: C.txt2,
    fontWeight: 600, marginBottom: 6,
  },
  input: {
    width: "100%", padding: "10px 14px",
    background: C.surface2, border: `1px solid ${C.border}`,
    borderRadius: 8, color: C.txt, fontSize: 14,
    fontFamily: "'Inter', sans-serif",
    outline: "none", boxSizing: "border-box",
  },
  editsBox: {
    padding: "12px 14px",
    background: "rgba(245,158,11,0.08)",
    border: "1px solid rgba(245,158,11,0.2)",
    borderRadius: 8, marginBottom: 14,
  },
  btnPrimary: {
    padding: "12px 18px", background: C.accent, border: "none",
    borderRadius: 8, color: "#fff", fontSize: 15, fontWeight: 700,
    cursor: "pointer", fontFamily: "'Inter', sans-serif",
    transition: "opacity 0.15s ease",
  },
  btnReject: {
    padding: "12px 18px", background: "transparent",
    border: "1px solid rgba(239,68,68,0.35)", borderRadius: 8,
    color: "#f87171", fontSize: 15, fontWeight: 600,
    cursor: "pointer", fontFamily: "'Inter', sans-serif",
  },
};
