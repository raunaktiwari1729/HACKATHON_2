import { useState, useEffect } from "react";
import { getDashboardCases, getDepartments, getCase } from "../api";

// val() safely pulls .value from a TracedStr field OR returns the raw value if it's already a string
// every extracted field from the backend is a TracedStr object: { value, source_sentence, page_ref, confidence }
function val(field) { return field?.value ?? field ?? "—"; }

// reusable section header for the expanded detail panel
function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{
        fontSize: 10, fontWeight: 800, color: "#4a5070",
        textTransform: "uppercase", letterSpacing: "0.1em",
        marginBottom: 10, paddingBottom: 6,
        borderBottom: "1px solid #252b3d",
        fontFamily: "'IBM Plex Mono',monospace",
      }}>{title}</div>
      {children}
    </div>
  );
}
function InfoRow({ label, value, accent }) {
  if (!value || value === "—") return null;
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", gap: 16,
      padding: "8px 12px", borderRadius: 8,
      background: "rgba(0,0,0,0.2)", marginBottom: 6,
      border: "1px solid #252b3d",
    }}>
      <span style={{ fontSize: 12, color: "#8892aa", flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 12, color: accent || "#e8edf5", fontWeight: 600, textAlign: "right" }}>{value}</span>
    </div>
  );
}

/* ─── Tokens ─────────────────────────────────────────── */
const BG     = "#141824";
const CARD   = "#1a1f2e";
const BORDER = "#252b3d";
const TXT    = "#e8edf5";
const TXT2   = "#8892aa";
const TXT3   = "#4a5070";
const HIGH   = "#ef4444";
const MEDIUM = "#f59e0b";
const LOW    = "#22c55e";

// keyframes are injected globally by App.jsx — no need to duplicate here
// i learned this the hard way — having two @keyframes fadeIn caused jank on first load


/* ─── Urgency badge ─────────────────────────────────── */
function UrgencyBadge({ level }) {
  const styles = {
    HIGH:   { background:"#7f1d1d", color:"#fca5a5", border:"1px solid rgba(239,68,68,0.4)" },
    MEDIUM: { background:"#78350f", color:"#fde68a", border:"1px solid rgba(245,158,11,0.4)" },
    LOW:    { background:"#14532d", color:"#86efac", border:"1px solid rgba(34,197,94,0.4)" },
  };
  const t = styles[level] || { background:"rgba(255,255,255,0.07)", color:TXT2, border:`1px solid ${BORDER}` };
  return (
    <span style={{
      ...t,
      borderRadius: 8,
      padding: "5px 14px",
      fontSize: 13,
      fontWeight: 800,
      letterSpacing: "0.05em",
      fontFamily: "'Inter',sans-serif",
      textTransform: "uppercase",
    }}>
      {level}
    </span>
  );
}

/* ─── Action chip ──────────────────────────────────── */
function ActionChip({ action }) {
  const label = (action||"").replace(/_/g," ");
  return (
    <span style={{
      background: "rgba(91,111,224,0.12)",
      color: "#a5b4fc",
      border: "1px solid rgba(91,111,224,0.35)",
      borderRadius: 8,
      padding: "5px 14px",
      fontSize: 13,
      fontWeight: 700,
      fontFamily: "'Inter',sans-serif",
      letterSpacing: "0.02em",
    }}>
      {label}
    </span>
  );
}

/* ─── Days badge ────────────────────────────────────── */
function DaysBadge({ days }) {
  if (days===null||days===undefined) return null;
  const overdue = days < 0;
  const urgent  = !overdue && days <= 30;
  const [bg, color, border] = overdue
    ? ["#7f1d1d", "#fca5a5", "rgba(239,68,68,0.4)"]
    : urgent
    ? ["#78350f", "#fde68a", "rgba(245,158,11,0.4)"]
    : ["#14532d", "#86efac", "rgba(34,197,94,0.4)"];
  return (
    <div style={{
      background: bg,
      color,
      border: `1px solid ${border}`,
      borderRadius: 20,
      padding: "7px 18px",
      fontSize: 14,
      fontWeight: 800,
      whiteSpace: "nowrap",
      flexShrink: 0,
      letterSpacing: "-0.1px",
    }}>
      {overdue ? `${Math.abs(days)} days overdue` : `${days} days left`}
    </div>
  );
}

// case card — this is the main thing on the dashboard
// clicking "show all details" fetches the full case from the api (not stored in the dashboard list)
// i fetch lazily so the dashboard loads fast and only fetches what the user actually clicks on
function CaseCard({ c, idx }) {
  const [expanded, setExpanded]   = useState(false);
  const [hov,      setHov]        = useState(false);
  const [detail,   setDetail]     = useState(null);
  const [loading,  setLoading]    = useState(false);
  const init = (c.case_number||"??").slice(0,2).toUpperCase();

  const toggle = async () => {
    // only fetch once — if we already have detail data, just toggle visibility
    if (!expanded && !detail) {
      setLoading(true);
      try { const d = await getCase(c.id); setDetail(d); }
      catch { /* ignore */ }
      finally { setLoading(false); }
    }
    setExpanded(v => !v);
  };

  const ex = detail?.extraction;
  const ap = detail?.action_plan;

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: hov ? "#1e2435" : CARD,
        border: `1px solid ${hov ? "#3a4155" : BORDER}`,
        borderRadius: 12,
        overflow: "hidden",
        transition: "all 0.18s ease",
        animation: `fadeIn 0.3s ease ${idx * 0.04}s both`,
      }}
    >
      {/* Main row */}
      <div style={{ display:"flex", alignItems:"center", gap:16, padding:"16px 20px" }}>

        {/* Avatar */}
        <div style={{
          width: 40, height: 40, borderRadius: "50%",
          background: "#2a3045", border: `1px solid ${BORDER}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, fontWeight: 700, color: TXT2,
          flexShrink: 0, letterSpacing: "-0.3px",
        }}>
          {init}
        </div>

        {/* Content */}
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:12, color:TXT2, marginBottom:4, fontWeight:500 }}>
            {c.responsible_department || "General"}
          </div>
          <div style={{
            fontSize: 18, fontWeight: 700, color: TXT,
            marginBottom: 5, lineHeight: 1.25,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {c.case_title}
          </div>
          <div style={{ fontSize:13, color:TXT3, marginBottom:10 }}>
            {c.court_name} – {c.date_of_order} – {c.case_number}
          </div>
          {/* Tags */}
          <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
            <UrgencyBadge level={c.urgency_level} />
            <ActionChip action={c.action_required} />
            {c.primary_deadline && (
              <span style={{
                background: "rgba(239,68,68,0.12)", color: "#fca5a5",
                border: "1px solid rgba(239,68,68,0.35)",
                borderRadius: 8, padding: "5px 14px",
                fontSize: 13, fontWeight: 700, fontFamily: "'Inter',sans-serif",
              }}>
                Due: {c.primary_deadline}
              </span>
            )}
            {c.llm_provider && c.llm_provider !== "Unknown" && (
              <span style={{
                background: c.llm_provider.includes("Gemini") ? "rgba(66, 133, 244, 0.1)" : "rgba(249, 115, 22, 0.1)", 
                color: c.llm_provider.includes("Gemini") ? "#60a5fa" : "#fdba74",
                border: `1px solid ${c.llm_provider.includes("Gemini") ? "rgba(66, 133, 244, 0.3)" : "rgba(249, 115, 22, 0.3)"}`,
                borderRadius: 8, padding: "5px 10px",
                fontSize: 11, fontWeight: 700, fontFamily: "'Inter',sans-serif",
              }}>
                ⚡ {c.llm_provider}
              </span>
            )}
          </div>
        </div>

        {/* Days badge */}
        <DaysBadge days={c.days_remaining} />
      </div>

      {/* Summary + expand */}
      <div style={{
        padding: "10px 20px 14px",
        borderTop: `1px solid ${BORDER}`,
        background: "rgba(0,0,0,0.15)",
      }}>
        <p style={{
          fontSize:13, color:TXT2, lineHeight:1.7, margin:"0 0 6px",
          display: expanded ? "block" : "-webkit-box",
          WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}>
          {c.summary_for_officer}
        </p>
        <button
          onClick={toggle}
          style={{
            background:"none", border:"none", cursor:"pointer",
            color:"#5b6fe0", fontSize:12, padding:"4px 0 0",
            fontFamily:"'Inter',sans-serif", fontWeight:600,
          }}
        >
          {loading ? "Loading…" : expanded ? "Show less ▲" : "Show all details ▼"}
        </button>

        {/* ── Full detail panel ── */}
        {expanded && detail && (
          <div style={{
            marginTop: 20,
            display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16,
          }}>

            {/* Left col */}
            <div>
              {/* Officer Summary */}
              {ap?.summary_for_officer && (
                <Section title="Officer Summary">
                  <p style={{
                    fontSize: 13, color: "#c8d0e0", lineHeight: 1.7,
                    background: "rgba(91,111,224,0.07)",
                    border: "1px solid rgba(91,111,224,0.2)",
                    borderLeft: "3px solid #5b6fe0",
                    borderRadius: "0 8px 8px 0",
                    padding: "10px 14px", margin: 0,
                  }}>
                    {ap.summary_for_officer}
                  </p>
                </Section>
              )}

              {/* Action Steps */}
              {ap?.recommended_steps?.length > 0 && (
                <Section title="Recommended Action Steps">
                  {ap.recommended_steps.map((step, i) => (
                    <div key={i} style={{
                      display: "flex", gap: 12, marginBottom: 10,
                      padding: "10px 12px",
                      background: "rgba(0,0,0,0.2)",
                      border: `1px solid ${BORDER}`,
                      borderRadius: 8,
                    }}>
                      <div style={{
                        width: 22, height: 22, borderRadius: "50%",
                        background: "#5b6fe0", color: "#fff",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 11, fontWeight: 800, flexShrink: 0,
                      }}>{step.step_number}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, color: "#e8edf5", fontWeight: 600, lineHeight: 1.5 }}>
                          {step.description}
                        </div>
                        {step.deadline && (
                          <div style={{ fontSize: 11, color: "#fca5a5", marginTop: 3 }}>
                            📅 Deadline: {step.deadline}
                          </div>
                        )}
                        {step.department && (
                          <div style={{ fontSize: 11, color: "#8892aa", marginTop: 2 }}>
                            🏛 {step.department}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </Section>
              )}

              {/* Court Directions */}
              {ex?.key_directions?.length > 0 && (
                <Section title="Court Directions">
                  {ex.key_directions.map((d, i) => (
                    <div key={i} style={{
                      marginBottom: 8, padding: "10px 12px",
                      background: "rgba(0,0,0,0.2)", border: `1px solid ${BORDER}`,
                      borderRadius: 8,
                    }}>
                      <div style={{ fontSize: 12, color: "#e8edf5", fontWeight: 600, marginBottom: 4 }}>
                        {d.text}
                      </div>
                      <div style={{
                        fontSize: 10, color: "#4a5070",
                        fontFamily: "'IBM Plex Mono',monospace",
                      }}>
                        {d.directive_type?.toUpperCase()} · {d.page_ref}
                      </div>
                    </div>
                  ))}
                </Section>
              )}
            </div>

            {/* Right col */}
            <div>
              {/* Case Details */}
              <Section title="Case Details">
                <InfoRow label="Case Number"    value={val(ex?.case_number)} />
                <InfoRow label="Court"          value={val(ex?.court_name)} />
                <InfoRow label="Date of Order"  value={val(ex?.date_of_order)} />
                <InfoRow label="Subject Matter" value={ex?.subject_matter} />
                <InfoRow label="Petitioner"     value={ex?.petitioner?.name} />
                <InfoRow label="Respondent"     value={ex?.respondent?.name} />
                <InfoRow label="Department"     value={ap?.responsible_department} />
              </Section>

              {/* Appeal Analysis */}
              {ap?.appeal_analysis && (
                <Section title="Appeal Analysis">
                  <div style={{
                    padding: "12px 14px", borderRadius: 8,
                    background: ap.appeal_analysis.recommended
                      ? "rgba(239,68,68,0.08)" : "rgba(34,197,94,0.08)",
                    border: `1px solid ${ap.appeal_analysis.recommended
                      ? "rgba(239,68,68,0.25)" : "rgba(34,197,94,0.25)"}`,
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: ap.appeal_analysis.recommended ? "#fca5a5" : "#86efac", marginBottom: 6 }}>
                      {ap.appeal_analysis.recommended ? "⚠ Appeal Recommended" : "✓ No Appeal Needed"}
                      {ap.appeal_analysis.strength && (
                        <span style={{ fontSize: 11, marginLeft: 8, opacity: 0.7 }}>
                          ({ap.appeal_analysis.strength} case)
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: "#8892aa", lineHeight: 1.6 }}>
                      {ap.appeal_analysis.reason}
                    </div>
                    {ap.appeal_analysis.limitation_date && (
                      <div style={{ fontSize: 11, color: "#fca5a5", marginTop: 8, fontWeight: 600 }}>
                        📅 Appeal Deadline: {ap.appeal_analysis.limitation_date}
                      </div>
                    )}
                  </div>
                </Section>
              )}

              {/* Timelines */}
              {ex?.timelines?.length > 0 && (
                <Section title="Key Dates & Deadlines">
                  {ex.timelines.map((t, i) => (
                    <div key={i} style={{
                      display: "flex", justifyContent: "space-between", gap: 12,
                      padding: "8px 12px", borderRadius: 8,
                      background: t.is_deadline ? "rgba(239,68,68,0.06)" : "rgba(0,0,0,0.2)",
                      border: `1px solid ${t.is_deadline ? "rgba(239,68,68,0.2)" : BORDER}`,
                      marginBottom: 6,
                    }}>
                      <div>
                        <div style={{ fontSize: 12, color: "#e8edf5", fontWeight: 600 }}>{t.event}</div>
                        {t.is_inferred && (
                          <div style={{ fontSize: 10, color: "#4a5070", marginTop: 2 }}>Inferred</div>
                        )}
                      </div>
                      <div style={{
                        fontSize: 12, color: t.is_deadline ? "#fca5a5" : "#8892aa",
                        fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0,
                      }}>{t.date_value}</div>
                    </div>
                  ))}
                </Section>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Stat card ─────────────────────────────────────── */
function StatCard({ label, value }) {
  return (
    <div style={{
      flex: 1, minWidth: 130,
      padding: "18px 22px",
      background: CARD,
      border: `1px solid ${BORDER}`,
      borderRadius: 10,
    }}>
      <div style={{
        fontSize: 11, fontWeight: 700, color: TXT3,
        textTransform: "uppercase", letterSpacing: "0.09em",
        marginBottom: 10,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 48, fontWeight: 800, color: TXT,
        lineHeight: 1,
        fontFamily: "'Inter',sans-serif",
      }}>
        {value}
      </div>
    </div>
  );
}

// main dashboard component
// i load cases on mount and refetch when the department filter changes
export default function Dashboard() {
  const [cases,   setCases]   = useState([]);
  const [depts,   setDepts]   = useState([]);
  const [selDept, setSelDept] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState("");
  const [search,  setSearch]  = useState("");
  const [sortBy,  setSortBy]  = useState("urgency");
  const [deptOpen,setDeptOpen]= useState(false);

  const fetchCases = async (dept) => {
    setLoading(true); setError("");
    try { const d = await getDashboardCases(dept); setCases(d.cases||[]); }
    catch { setError("Could not load cases."); }
    finally { setLoading(false); }
  };

  // load cases and departments on mount
  // departments are needed to populate the filter dropdown
  useEffect(() => {
    fetchCases(null);
    getDepartments().then(setDepts).catch(() => {});
  }, []);

  // client-side search — filters by case number, title, department, or court name
  const filtered = cases.filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.case_number?.toLowerCase().includes(q) ||
      c.case_title?.toLowerCase().includes(q)  ||
      c.responsible_department?.toLowerCase().includes(q) ||
      c.court_name?.toLowerCase().includes(q)
    );
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === "urgency") {
      const r = { HIGH:0, MEDIUM:1, LOW:2 };
      const d = (r[a.urgency_level]??1)-(r[b.urgency_level]??1);
      return d !== 0 ? d : (a.days_remaining??9999)-(b.days_remaining??9999);
    }
    if (sortBy === "date") return (a.days_remaining??9999)-(b.days_remaining??9999);
    if (sortBy === "dept") return (a.responsible_department||"").localeCompare(b.responsible_department||"");
    return 0;
  });

  const grouped = {};
  if (!selDept) for (const c of sorted) {
    const k = c.responsible_department || "Unassigned";
    (grouped[k] = grouped[k]||[]).push(c);
  }

  const high    = cases.filter(c => c.urgency_level === "HIGH").length;
  const overdue = cases.filter(c => (c.days_remaining??1) < 0).length;
  const appeal  = cases.filter(c => c.appeal_recommended).length;

  const currentDeptLabel = selDept
    ? (selDept.length > 18 ? selDept.slice(0,18)+"…" : selDept)
    : "All Departments";

  return (
    <div style={ds.root}>

      {/* ── Dark background image overlay ── */}
      <div style={ds.bgOverlay} />

      <div style={ds.content}>
        {/* ── Page Title ── */}
        <div style={ds.titleRow}>
          <div>
            <h1 style={ds.title}>Verified Case Dashboard</h1>
            <p style={ds.subtitle}>All approved cases — sorted by urgency and deadline</p>
          </div>
          <button
            onClick={() => fetchCases(selDept)}
            style={ds.refreshBtn}
            onMouseEnter={e => { e.currentTarget.style.background="#ffffff"; e.currentTarget.style.color="#111420"; }}
            onMouseLeave={e => { e.currentTarget.style.background="transparent"; e.currentTarget.style.color=TXT2; }}
          >
            ↻ Refresh
          </button>
        </div>

        {/* ── Stats ── */}
        {!loading && !error && (
          <div style={ds.stats}>
          <StatCard label="Total Approved" value={cases.length} />
            <StatCard label="High Urgency"   value={high} />
            <StatCard label="Overdue"        value={overdue} />
            <StatCard label="Appeals"        value={appeal} />
          </div>
        )}

        {/* ── Filter bar ── */}
        <div style={ds.filterBar}>
          {/* Search */}
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter by search..."
            style={ds.searchInput}
          />

          {/* Right side filters */}
          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            {/* Sort */}
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
              style={ds.filterSelect}
            >
              <option value="urgency">Sort: Urgency</option>
              <option value="date">Sort: Deadline</option>
              <option value="dept">Sort: Dept</option>
            </select>

            {/* All / active dept */}
            <button
              onClick={() => { setSelDept(null); fetchCases(null); }}
              style={{
                ...ds.filterBtn,
                ...(selDept===null ? ds.filterBtnActive : {}),
              }}
            >
              All ▾
            </button>

            {/* Dept dropdown */}
            <div style={{ position:"relative" }}>
              <button
                onClick={() => setDeptOpen(v => !v)}
                style={{
                  ...ds.filterBtn,
                  ...(selDept!==null ? ds.filterBtnActive : {}),
                }}
              >
                {currentDeptLabel} ▾
              </button>
              {deptOpen && (
                <div style={ds.deptDropdown}>
                  <button
                    onClick={() => { setSelDept(null); fetchCases(null); setDeptOpen(false); }}
                    style={ds.deptItem}
                  >
                    All Departments
                  </button>
                  {depts.map(d => (
                    <button
                      key={d}
                      onClick={() => { setSelDept(d); fetchCases(d); setDeptOpen(false); }}
                      style={{ ...ds.deptItem, ...(selDept===d ? { color:"#e8edf5" } : {}) }}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Case List ── */}
        <div style={ds.sectionHeader}>
          <span style={ds.sectionTitle}>Case List</span>
          {!loading && (
            <span style={ds.sectionCount}>{sorted.length} case{sorted.length!==1?"s":""}</span>
          )}
        </div>

        {/* Loading */}
        {loading && (
          <div style={ds.center}>
            <div style={ds.spinner} />
            <div style={{ color:TXT2, fontSize:15, marginTop:16 }}>Loading…</div>
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div style={ds.center}>
            <div style={{ fontSize:36, marginBottom:12 }}>⚠</div>
            <div style={{ color:HIGH, fontSize:14, marginBottom:16 }}>{error}</div>
            <button onClick={() => fetchCases(selDept)} style={ds.retryBtn}>Retry</button>
          </div>
        )}

        {/* Empty */}
        {!loading && !error && cases.length===0 && (
          <div style={ds.center}>
            <div style={{ fontSize:48, marginBottom:16, opacity:0.3 }}>📂</div>
            <div style={{ fontSize:18, color:TXT, fontWeight:700, marginBottom:8 }}>
              No approved cases yet
            </div>
            <div style={{ fontSize:14, color:TXT2 }}>
              Upload and review a judgment to populate the dashboard
            </div>
          </div>
        )}

        {/* Cases */}
        {!loading && !error && cases.length>0 && (
          selDept ? (
            <div style={ds.list}>
              {sorted.map((c,i) => <CaseCard key={c.id} c={c} idx={i} />)}
              {sorted.length===0 && (
                <div style={{ color:TXT2, fontSize:14, textAlign:"center", padding:"32px 0" }}>
                  No cases match your search.
                </div>
              )}
            </div>
          ) : (
            Object.entries(grouped).map(([dept, deptCases]) => (
              <div key={dept} style={{ marginBottom:36 }}>
                <div style={ds.groupHeader}>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <span style={ds.groupName}>{dept}</span>
                    {deptCases.some(c => c.urgency_level==="HIGH") && (
                      <span style={{
                        fontSize:10, color:HIGH,
                        background:"rgba(239,68,68,0.1)",
                        border:"1px solid rgba(239,68,68,0.2)",
                        padding:"2px 8px", borderRadius:20,
                        fontWeight:700, letterSpacing:"0.06em",
                      }}>HIGH URGENCY</span>
                    )}
                  </div>
                  <span style={ds.groupCount}>{deptCases.length} case{deptCases.length!==1?"s":""}</span>
                </div>
                <div style={ds.list}>
                  {deptCases.map((c,i) => <CaseCard key={c.id} c={c} idx={i} />)}
                </div>
              </div>
            ))
          )
        )}

      </div>
    </div>
  );
}

/* ─── Styles ─────────────────────────────────────────── */
const ds = {
  root: {
    position: "relative",
    minHeight: "calc(100vh - 90px)",
    fontFamily: "'Inter','Segoe UI',sans-serif",
  },

  /* Dark blurred bg like in screenshot */
  bgOverlay: {
    position: "absolute", inset: 0, zIndex: 0,
    background: `
      linear-gradient(180deg,
        rgba(20,24,36,0.85) 0%,
        rgba(14,17,26,0.92) 40%,
        rgba(10,12,20,0.97) 100%
      )
    `,
    backgroundBlendMode: "multiply",
  },

  content: {
    position: "relative", zIndex: 1,
    padding: "36px 44px",
    animation: "fadeIn 0.25s ease",
  },

  /* Title */
  titleRow: {
    display: "flex", justifyContent: "space-between", alignItems: "flex-start",
    marginBottom: 28,
  },
  title: {
    fontSize: 46, fontWeight: 800, color: TXT,
    letterSpacing: "-0.8px", lineHeight: 1.1, marginBottom: 8,
  },
  subtitle: {
    fontSize: 15, color: TXT2,
  },
  refreshBtn: {
    padding: "9px 20px",
    background: "transparent",
    border: `1px solid ${BORDER}`,
    borderRadius: 8, color: TXT2,
    fontSize: 14, fontWeight: 500, cursor: "pointer",
    transition: "all 0.15s ease",
    fontFamily: "'Inter',sans-serif",
    flexShrink: 0,
  },

  /* Stats */
  stats: {
    display: "flex", gap: 14, flexWrap: "wrap",
    marginBottom: 24,
  },

  /* Filter bar */
  filterBar: {
    display: "flex", alignItems: "center", gap: 10,
    marginBottom: 24,
    flexWrap: "wrap",
  },
  searchInput: {
    flex: "1 1 340px", maxWidth: 480,
    padding: "10px 16px",
    background: CARD,
    border: `1px solid ${BORDER}`,
    borderRadius: 8,
    color: TXT, fontSize: 14,
    fontFamily: "'Inter',sans-serif",
    outline: "none",
  },
  filterSelect: {
    padding: "10px 14px",
    background: CARD,
    border: `1px solid ${BORDER}`,
    borderRadius: 8,
    color: TXT2, fontSize: 14,
    fontFamily: "'Inter',sans-serif",
    cursor: "pointer", outline: "none",
    appearance: "none",
    paddingRight: 28,
  },
  filterBtn: {
    padding: "10px 16px",
    background: CARD,
    border: `1px solid ${BORDER}`,
    borderRadius: 8,
    color: TXT2, fontSize: 14, fontWeight: 500,
    cursor: "pointer", transition: "all 0.15s ease",
    fontFamily: "'Inter',sans-serif", whiteSpace: "nowrap",
  },
  filterBtnActive: {
    background: "rgba(255,255,255,0.08)",
    border: "1px solid #4a5070",
    color: TXT,
    fontWeight: 600,
  },
  deptDropdown: {
    position: "absolute", top: "calc(100% + 6px)", right: 0,
    background: "#1a1f2e",
    border: `1px solid ${BORDER}`,
    borderRadius: 10,
    overflow: "hidden",
    zIndex: 999,
    minWidth: 220,
    boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
  },
  deptItem: {
    display: "block", width: "100%",
    padding: "10px 16px", textAlign: "left",
    background: "transparent",
    border: "none", borderBottom: `1px solid ${BORDER}`,
    color: TXT2, fontSize: 13, cursor: "pointer",
    fontFamily: "'Inter',sans-serif",
    transition: "background 0.1s",
  },

  /* Section header */
  sectionHeader: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 17, fontWeight: 700, color: TXT, letterSpacing: "-0.2px",
  },
  sectionCount: {
    fontSize: 13, color: TXT3,
  },

  /* List */
  list: { display: "flex", flexDirection: "column", gap: 10 },

  groupHeader: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    marginBottom: 12, paddingBottom: 10,
    borderBottom: `1px solid ${BORDER}`,
  },
  groupName: { fontSize: 15, fontWeight: 700, color: TXT },
  groupCount: { fontSize: 12, color: TXT2 },

  /* States */
  center: {
    display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center",
    padding: "80px 0", textAlign: "center",
  },
  spinner: {
    width: 32, height: 32,
    border: `2px solid ${BORDER}`, borderTopColor: "#5b6fe0",
    borderRadius: "50%", animation: "spin 0.8s linear infinite",
  },
  retryBtn: {
    padding: "9px 22px", background: "transparent",
    border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8,
    color: HIGH, fontSize: 14, fontWeight: 600, cursor: "pointer",
  },


};
