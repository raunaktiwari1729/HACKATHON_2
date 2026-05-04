import { useState, useRef } from "react";  // useEffect not needed — timers managed via useRef directly
import { uploadJudgment } from "../api";

// color tokens
const BG     = "#141824";
const CARD   = "#1a1f2e";
const BORDER = "#252b3d";
const TXT    = "#e8edf5";
const TXT2   = "#8892aa";
const TXT3   = "#4a5070";
const ACCENT = "#5b6fe0";

const STATUS = { IDLE:"idle", DRAGGING:"dragging", UPLOADING:"uploading", SUCCESS:"success", ERROR:"error" };

// upload-specific keyframes (spin2 avoids clash with App.jsx's spin)
const anim = document.createElement("style");
anim.textContent = `
  @keyframes spin2    { to{transform:rotate(360deg)} }
  @keyframes pulse    { 0%,100%{opacity:1} 50%{opacity:0.45} }
  @keyframes progFill { from{width:0%} to{width:90%} }
`;
document.head.appendChild(anim);

export default function UploadPanel({ onUploadSuccess }) {
  const [status,   setStatus]   = useState(STATUS.IDLE);
  const [file,     setFile]     = useState(null);
  const [progress, setProgress] = useState("");
  const [result,   setResult]   = useState(null);
  const [error,    setError]    = useState("");
  const [elapsed,  setElapsed]  = useState(0);  // seconds since upload started — shown live
  const inputRef   = useRef(null);
  const elapsedRef = useRef(null);               // holds the elapsed-seconds interval id

  // these are the fake progress steps i show while waiting for the api
  // the actual processing is async — i just rotate through these every 4s to keep the user calm
  // llm calls can take 20-30s, without this the user thinks it's frozen
  const STEPS = [
    "Reading PDF pages…",
    "Detecting section structure…",
    "Extracting case details with AI…",
    "Generating action plan…",
    "Saving to database…",
  ];

  // validate before doing anything — only pdfs, nothing else
  const handleFile = (f) => {
    if (!f) return;
    if (!f.name.endsWith(".pdf")) { setError("Only PDF files are accepted."); setStatus(STATUS.ERROR); return; }
    setFile(f); setError(""); setStatus(STATUS.IDLE);
  };

  const handleDrop = (e) => { e.preventDefault(); setStatus(STATUS.IDLE); handleFile(e.dataTransfer.files[0]); };

  const handleUpload = async () => {
    if (!file) return;
    setStatus(STATUS.UPLOADING); setError(""); setElapsed(0);

    // rotate through fake progress steps every 4s so the user sees activity
    let step = 0; setProgress(STEPS[0]);
    const iv = setInterval(() => { step = Math.min(step+1, STEPS.length-1); setProgress(STEPS[step]); }, 4000);

    // live elapsed timer — ticks every second so the user can see time passing
    // this is especially important when Groq hits a rate limit and auto-retries
    // (adds ~25s of wait). without a timer, 60s of silence looks like a crash.
    elapsedRef.current = setInterval(() => setElapsed(s => s + 1), 1000);

    try {
      const data = await uploadJudgment(file);
      clearInterval(iv);
      clearInterval(elapsedRef.current);
      setResult(data); setStatus(STATUS.SUCCESS);
    } catch (err) {
      clearInterval(iv);
      clearInterval(elapsedRef.current);
      setError(err.response?.data?.detail || "Upload failed. Is the backend running?");
      setStatus(STATUS.ERROR);
    }
  };

  // reset clears everything back to idle — used for "upload another" button
  // also clears the file input so the same file can be selected again
  const reset = () => {
    setStatus(STATUS.IDLE); setFile(null); setResult(null);
    setError(""); setProgress(""); setElapsed(0);
    clearInterval(elapsedRef.current);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div style={st.page}>
      <div style={st.card}>
        {/* Accent top strip */}
        <div style={st.topStrip} />

        <div style={st.body}>
          {/* Header */}
          <div style={st.hdr}>
            <div style={st.hdrIcon}>⚖</div>
            <div>
              <h2 style={st.title}>Upload Judgment</h2>
              <p style={st.subtitle}>Court judgment PDF → AI extraction → Action plan</p>
            </div>
          </div>

          {/* Drop zone */}
          {status !== STATUS.SUCCESS && (
            <div
              style={{
                ...st.drop,
                ...(status === STATUS.DRAGGING ? st.dropActive : {}),
                ...(file ? st.dropHasFile : {}),
              }}
              onDragOver={e => { e.preventDefault(); setStatus(STATUS.DRAGGING); }}
              onDragLeave={() => setStatus(STATUS.IDLE)}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
            >
              <input ref={inputRef} type="file" accept=".pdf" style={{display:"none"}} onChange={e => handleFile(e.target.files[0])} />
              {file ? (
                <div style={st.fileRow}>
                  <span style={{fontSize:28}}>📄</span>
                  <div>
                    <div style={st.fileName}>{file.name}</div>
                    <div style={st.fileSize}>{(file.size/1024).toFixed(1)} KB</div>
                  </div>
                </div>
              ) : (
                <div>
                  <div style={st.dropIconWrap}><span style={{fontSize:28}}>📂</span></div>
                  <div style={st.dropText}>Drop judgment PDF here</div>
                  <div style={st.dropHint}>or click to browse · Digital and scanned PDFs supported</div>
                </div>
              )}
            </div>
          )}

          {/* Upload btn */}
          {file && status === STATUS.IDLE && (
            <button style={st.btn} onClick={handleUpload}
              onMouseEnter={e => e.currentTarget.style.background="#4a5cc8"}
              onMouseLeave={e => e.currentTarget.style.background=ACCENT}
            >
              Extract &amp; Generate Action Plan →
            </button>
          )}

          {/* Progress */}
          {status === STATUS.UPLOADING && (
            <div style={st.progBox}>
              <div style={st.spinnerWrap}><div style={st.spinner}/></div>

              {/* current step label — cycles through STEPS every 4s */}
              <div style={st.progText}>{progress}</div>

              {/* primary hint — always visible */}
              <div style={st.progHint}>AI processing typically takes 20–60 seconds</div>

              {/* elapsed timer — shows live seconds so judges know it's still running */}
              <div style={st.elapsedRow}>
                <span style={st.elapsedDot} />
                <span style={st.elapsedTxt}>{elapsed}s elapsed</span>
              </div>

              {/* rate-limit notice — appears after 35s when Groq is likely retrying */}
              {/* this is the most common cause of long waits on the free tier */}
              {elapsed >= 35 && (
                <div style={st.retryNote}>
                  ⟳ API rate limit retry in progress — Groq is automatically retrying. Please wait.
                </div>
              )}

              {/* progress bar animates over 70s — long enough to cover a full Groq retry cycle */}
              <div style={st.progBar}><div style={st.progFill}/></div>
            </div>
          )}

          {/* Error */}
          {status === STATUS.ERROR && (
            <div style={st.errBox}>
              <div style={{fontSize:24, marginBottom:8}}>⚠</div>
              <div style={st.errText}>{error}</div>
              <button style={st.retryBtn} onClick={reset}>Try again</button>
            </div>
          )}

          {/* Success */}
          {status === STATUS.SUCCESS && result && (
            <div style={st.successBox}>
              <div style={st.successHdr}>
                <div style={st.checkIcon}>✓</div>
                <span style={st.successTitle}>Extraction complete</span>
              </div>
              <div style={st.resultGrid}>
                <Row label="Case number" value={result.case_number} />
                <Row label="Case title"  value={result.case_title} />
                <Row label="Pages"       value={`${result.total_pages} pages${result.has_ocr?" (OCR)":""}`} />
                <Row label="Status"      value="Awaiting human review" hi />
              </div>
              <div style={st.actions}>
                <button style={st.btn} onClick={() => onUploadSuccess(result.case_id, file)}
                  onMouseEnter={e => e.currentTarget.style.background="#4a5cc8"}
                  onMouseLeave={e => e.currentTarget.style.background=ACCENT}
                >
                  Open for Review →
                </button>
                <button style={st.ghostBtn} onClick={reset}>Upload another</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, hi }) {
  return (
    <div style={{
      display:"flex", justifyContent:"space-between", alignItems:"flex-start",
      gap:12, fontSize:14, padding:"10px 14px",
      background:"rgba(0,0,0,0.2)", border:`1px solid ${BORDER}`, borderRadius:8,
    }}>
      <span style={{color:TXT2, flexShrink:0}}>{label}</span>
      <span style={{color: hi ? "#f59e0b" : TXT, fontWeight:600, textAlign:"right"}}>{value}</span>
    </div>
  );
}

const st = {
  page: {
    minHeight:"calc(100vh - 90px)", background:BG,
    display:"flex", alignItems:"center", justifyContent:"center",
    padding:"48px 24px",
    fontFamily:"'Inter','Segoe UI',sans-serif",
  },
  card: {
    background:CARD, borderRadius:16,
    border:`1px solid ${BORDER}`,
    boxShadow:"0 16px 48px rgba(0,0,0,0.4)",
    width:"100%", maxWidth:560, overflow:"hidden",
    animation:"fadeIn 0.25s ease",
  },
  topStrip: {
    height:3,
    background:`linear-gradient(90deg,${ACCENT},#7c3aed)`,
  },
  body: { padding:"36px 40px" },
  hdr: { display:"flex", alignItems:"center", gap:16, marginBottom:32 },
  hdrIcon: {
    width:52, height:52, borderRadius:12,
    background:`linear-gradient(135deg,${ACCENT},#7c3aed)`,
    display:"flex", alignItems:"center", justifyContent:"center",
    fontSize:24, color:"#fff", flexShrink:0,
    boxShadow:`0 4px 16px ${ACCENT}55`,
  },
  title: { fontSize:26, fontWeight:800, color:TXT, letterSpacing:"-0.4px" },
  subtitle: { fontSize:13, color:TXT2, marginTop:4 },

  drop: {
    border:`2px dashed ${BORDER}`, borderRadius:12,
    padding:44, textAlign:"center", cursor:"pointer",
    transition:"all 0.2s ease", marginBottom:18,
    background:"rgba(255,255,255,0.015)",
  },
  dropActive: {
    border:`2px dashed ${ACCENT}`,
    background:"rgba(91,111,224,0.06)",
    transform:"scale(1.01)",
  },
  dropHasFile: {
    border:`2px solid ${ACCENT}50`,
    background:"rgba(91,111,224,0.04)", padding:28,
  },
  dropIconWrap: {
    width:60, height:60, borderRadius:"50%",
    background:"rgba(91,111,224,0.08)",
    display:"flex", alignItems:"center", justifyContent:"center",
    margin:"0 auto 14px",
  },
  dropText: { fontSize:17, fontWeight:600, color:TXT, marginBottom:6 },
  dropHint: { fontSize:13, color:TXT3 },
  fileRow: { display:"flex", alignItems:"center", gap:14, textAlign:"left" },
  fileName: { fontSize:15, fontWeight:600, color:TXT, wordBreak:"break-all" },
  fileSize: { fontSize:12, color:TXT2, marginTop:3 },

  btn: {
    width:"100%", padding:"14px 24px",
    background:ACCENT, color:"#fff",
    border:"none", borderRadius:10,
    fontSize:15, fontWeight:700, cursor:"pointer",
    transition:"background 0.15s ease",
    boxShadow:`0 4px 18px ${ACCENT}44`,
    fontFamily:"'Inter',sans-serif",
    letterSpacing:"-0.1px",
  },

  progBox: { textAlign:"center", padding:"36px 0 28px" },
  spinnerWrap: {
    width:54, height:54, borderRadius:"50%",
    background:"rgba(91,111,224,0.08)",
    display:"flex", alignItems:"center", justifyContent:"center",
    margin:"0 auto 18px",
  },
  spinner: {
    width:30, height:30,
    border:`2px solid ${BORDER}`, borderTopColor:ACCENT,
    borderRadius:"50%", animation:"spin2 0.8s linear infinite",
  },
  progText: { fontSize:16, fontWeight:600, color:TXT, marginBottom:6 },
  progHint: { fontSize:13, color:TXT3, marginBottom:10 },

  // live elapsed timer row
  elapsedRow: {
    display:"inline-flex", alignItems:"center", gap:6,
    marginBottom:10, fontSize:12,
    color:"#6b84f8", fontFamily:"'IBM Plex Mono', monospace",
  },
  elapsedDot: {
    width:6, height:6, borderRadius:"50%",
    background:"#6b84f8",
    // pulse so it looks alive, not frozen
    animation:"pulse 1.4s ease-in-out infinite",
  },
  elapsedTxt: {},

  // shown after 35s — explains why the upload is taking so long
  retryNote: {
    fontSize:12, color:"#f59e0b",
    background:"rgba(245,158,11,0.08)",
    border:"1px solid rgba(245,158,11,0.25)",
    borderRadius:8, padding:"8px 14px",
    maxWidth:340, margin:"0 auto 16px",
    lineHeight:1.5,
    fontFamily:"'IBM Plex Mono', monospace",
    animation:"fadeIn 0.3s ease",
  },

  progBar: {
    height:3, background:BORDER, borderRadius:4,
    overflow:"hidden", maxWidth:240, margin:"8px auto 0",
  },
  progFill: {
    height:"100%",
    background:`linear-gradient(90deg,${ACCENT},#7c3aed)`,
    // 70s covers a full Groq free-tier retry cycle (25s wait + processing)
    // 20s was too short — bar reached 85% and froze, looked like a crash
    borderRadius:4, animation:"progFill 70s ease forwards",
  },

  errBox: {
    background:"rgba(239,68,68,0.06)", border:"1px solid rgba(239,68,68,0.2)",
    borderRadius:10, padding:24, textAlign:"center",
  },
  errText: { fontSize:13, color:"#fca5a5", marginBottom:16, lineHeight:1.5 },
  retryBtn: {
    padding:"8px 22px", background:"transparent",
    border:"1px solid rgba(239,68,68,0.3)", borderRadius:8,
    color:"#fca5a5", fontSize:13, fontWeight:600, cursor:"pointer",
  },

  successBox: {
    background:"rgba(91,111,224,0.06)", border:`1px solid ${ACCENT}30`,
    borderRadius:12, padding:26,
  },
  successHdr: { display:"flex", alignItems:"center", gap:12, marginBottom:20 },
  checkIcon: {
    width:30, height:30, background:ACCENT, borderRadius:"50%",
    display:"flex", alignItems:"center", justifyContent:"center",
    fontSize:14, color:"#fff", fontWeight:800, flexShrink:0,
  },
  successTitle: { fontSize:17, fontWeight:700, color:ACCENT },
  resultGrid: { display:"flex", flexDirection:"column", gap:8, marginBottom:22 },
  actions: { display:"flex", flexDirection:"column", gap:10 },
  ghostBtn: {
    width:"100%", padding:"13px 20px",
    background:"transparent", border:`1px solid ${BORDER}`,
    borderRadius:10, color:TXT2,
    fontSize:15, fontWeight:500, cursor:"pointer",
    fontFamily:"'Inter',sans-serif",
  },
};
