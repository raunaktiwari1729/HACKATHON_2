import { useState, useEffect } from "react";
import UploadPanel from "./components/UploadPanel";
import ReviewPanel from "./components/ReviewPanel";
import Dashboard   from "./components/Dashboard";
import PDFViewer   from "./components/PDFViewer";
import { getPendingCases } from "./api";

// inject global styles + fonts + keyframes once at module load
// doing it here so every component inherits the theme without importing a css file
const globalStyle = document.createElement("style");
globalStyle.textContent = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=IBM+Plex+Mono:wght@400;500&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body, #root { height: 100%; }
  body {
    background: #141824;
    color: #e8edf5;
    font-family: 'Inter', 'Segoe UI', sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  ::-webkit-scrollbar { width: 5px; }
  ::-webkit-scrollbar-track { background: #141824; }
  ::-webkit-scrollbar-thumb { background: #2a2f42; border-radius: 3px; }
  @keyframes spin  { to { transform: rotate(360deg); } }
  @keyframes fadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
  input::placeholder { color: #4a5070; }
`;
document.head.appendChild(globalStyle);

const TABS = [
  { key:"upload",    label:"Upload",    icon:"↑" },
  { key:"review",    label:"Review",    icon:"◈" },
  { key:"dashboard", label:"Dashboard", icon:"⊞" },
];

export default function App() {
  const [tab,           setTab]          = useState("upload");
  const [reviewCaseId,  setReviewCaseId] = useState(null);
  const [pendingCount,  setPendingCount] = useState(0);
  const [pdfFile,       setPdfFile]      = useState(null);
  const [pdfObjectUrl,  setPdfObjectUrl] = useState(null);
  const [highlightPage, setHighlightPage]= useState(null);
  const [highlightText, setHighlightText]= useState("");
  const [showPdf,       setShowPdf]      = useState(false);

  // revoke the old blob url whenever we create a new one — avoids memory leak
  // browser keeps the file in memory until you revoke it
  useEffect(() => () => { if (pdfObjectUrl) URL.revokeObjectURL(pdfObjectUrl); }, [pdfObjectUrl]);

  // poll the pending count every 15s so the red badge on the Review tab stays accurate
  // i could use websockets but polling is simpler and works fine for this scale
  useEffect(() => {
    const load = async () => { try { setPendingCount((await getPendingCases()).length); } catch {} };
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, []);

  const handleUploadSuccess = (caseId, file) => {
    // after upload succeeds, automatically switch to review tab and open the pdf side panel
    // this way the reviewer can immediately see the pdf alongside the extracted data
    setReviewCaseId(caseId);
    if (file) {
      if (pdfObjectUrl) URL.revokeObjectURL(pdfObjectUrl);
      setPdfFile(file);
      setPdfObjectUrl(URL.createObjectURL(file));
      setShowPdf(true);
    }
    setTab("review");
    setPendingCount(n => n + 1);
  };

  return (
    <div style={s.root}>
      {/* header */}
      <header style={s.header}>
        <div style={s.brand}>
          <div style={s.logoWrap}>
            <span style={s.logoIcon}>⚖</span>
          </div>
          <div>
            <div style={s.brandName}>JudgmentAI</div>
            <div style={s.brandSub}>AI-powered court judgment analysis</div>
          </div>
        </div>

        <nav style={s.nav}>
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                ...s.navBtn,
                ...(tab === t.key ? s.navBtnActive : {}),
              }}
            >
              <span style={s.navIcon}>{t.icon}</span>
              {t.label}
              {t.key === "review" && pendingCount > 0 && (
                <span style={s.badge}>{pendingCount}</span>
              )}
            </button>
          ))}
        </nav>
      </header>

      {/* main content area */}
      <main style={{ flex:1, overflow:"hidden", display:"flex" }}>
        {/* pdf side panel — slides in next to the review panel when a pdf is loaded */}
        {/* i keep it 460px wide so there's still enough room for the review form */}
        {tab === "review" && showPdf && (
          <div style={s.pdfPanel}>
            <div style={s.pdfBar}>
              <span style={s.pdfLabel}>Source Document</span>
              <button onClick={() => setShowPdf(false)} style={s.pdfClose}>✕</button>
            </div>
            <div style={{ flex:1, overflow:"hidden" }}>
              <PDFViewer
                pdfUrl={pdfObjectUrl}
                filename={pdfFile?.name}
                highlightPage={highlightPage}
                highlightText={highlightText}
              />
            </div>
          </div>
        )}

        <div style={{ flex:1, overflow:"auto", minWidth:0 }}>
          {tab === "upload"    && <UploadPanel onUploadSuccess={handleUploadSuccess} />}
          {tab === "review"    && (
            <ReviewPanel
              initialCaseId={reviewCaseId}
              onReviewComplete={() => { setReviewCaseId(null); setPendingCount(n => Math.max(0, n-1)); }}
              // renamed param from s→snip to avoid shadowing the styles object below
              onHighlight={(page, snip) => { setHighlightPage(page); setHighlightText(snip); setShowPdf(true); }}
              onShowPdf={() => setShowPdf(true)}
              hasPdf={!!pdfObjectUrl}
            />
          )}
          {tab === "dashboard" && <Dashboard />}
        </div>
      </main>
    </div>
  );
}

// color tokens
const BG        = "#141824";
const HEADER_BG = "#111420";
const BORDER    = "#252b3d";
const TXT       = "#e8edf5";
const TXT2      = "#8892aa";

const s = {
  root: {
    minHeight:"100vh", display:"flex", flexDirection:"column",
    background:BG,
  },

  header: {
    display:"flex", alignItems:"center", justifyContent:"space-between",
    padding:"0 40px", height:70,
    background:HEADER_BG,
    borderBottom:`1px solid ${BORDER}`,
    position:"sticky", top:0, zIndex:200, flexShrink:0,
  },
  brand:    { display:"flex", alignItems:"center", gap:14 },
  logoWrap: {
    width:42, height:42, borderRadius:"50%",
    border:"2px solid #3a4155",
    display:"flex", alignItems:"center", justifyContent:"center",
    background:"transparent",
  },
  logoIcon:  { fontSize:20, color:TXT },
  brandName: { fontSize:20, fontWeight:700, color:TXT, letterSpacing:"-0.3px" },
  brandSub:  { fontSize:11, color:TXT2, marginTop:1 },

  nav: { display:"flex", gap:8 },
  navBtn: {
    display:"flex", alignItems:"center", gap:7,
    padding:"8px 20px",
    background:"transparent",
    border:"1px solid #35394d",
    borderRadius:8,
    color:TXT2, fontSize:14, fontWeight:500,
    cursor:"pointer", transition:"all 0.15s ease",
    fontFamily:"'Inter',sans-serif",
    letterSpacing:"-0.1px",
  },
  navBtnActive: {
    background:"#ffffff",
    border:"1px solid #ffffff",
    color:"#111420",
    fontWeight:700,
  },
  navIcon: { fontSize:13 },
  badge: {
    background:"#ef4444", color:"#fff", fontSize:10, fontWeight:700,
    borderRadius:10, padding:"1px 6px", lineHeight:"16px",
  },

  // pdf side panel
  pdfPanel: {
    width:460, flexShrink:0,
    borderRight:`1px solid ${BORDER}`,
    display:"flex", flexDirection:"column",
    background:"#0e1119",
  },
  pdfBar: {
    display:"flex", alignItems:"center", justifyContent:"space-between",
    padding:"8px 16px", borderBottom:`1px solid ${BORDER}`,
    flexShrink:0,
  },
  pdfLabel: {
    fontSize:11, color:"#4a5070",
    textTransform:"uppercase", letterSpacing:"0.08em",
  },
  pdfClose: {
    background:"transparent", border:"none", color:"#4a5070",
    fontSize:14, cursor:"pointer", padding:"2px 6px",
  },
};
