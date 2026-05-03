import { useEffect, useRef, useState } from "react";

// PDFViewer — renders pdfs using pdf.js loaded dynamically from cdn
// i load pdf.js from cdn instead of npm because it avoids the webpack worker config headache
// props:
//   pdfUrl        — blob url from URL.createObjectURL(file) created in App.jsx
//   filename      — just for display in the toolbar
//   highlightPage — when reviewer clicks "view in pdf", we jump to this page
//   highlightText — the source sentence shown in the blue banner at the top

const C = {
  bg: "#0f1117", surface: "#1a1d27", border: "#2a2d3a",
  accent: "#4f6ef7", txt: "#e8eaf0", txt2: "#8b8fa8", txt3: "#4a4f6a",
};

export default function PDFViewer({ pdfUrl, filename, highlightPage, highlightText }) {
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState("");
  const [pageCount, setPageCount] = useState(0);
  const [current,   setCurrent]   = useState(1);
  const canvasRef  = useRef(null);
  const pdfRef     = useRef(null);  // holds the loaded pdf.js document object
  const taskRef    = useRef(null);  // holds the current render task so we can cancel it before starting a new one

  // inject pdf.js script from cdn the first time this component mounts
  // the global check (window.pdfjsLib) means we only do this once even if the component remounts
  useEffect(() => {
    if (window.pdfjsLib) return;
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    s.onload = () => {
      // the worker url must match the library version exactly — took me a while to figure this out
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    };
    document.head.appendChild(s);
  }, []);

  // load the pdf document whenever the blob url changes (i.e. a new file is uploaded)
  // i poll for pdfjsLib to be ready since the cdn script loads async
  useEffect(() => {
    if (!pdfUrl) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true); setError("");
      // wait up to 7.5s for pdf.js to finish loading from cdn
      let attempts = 0;
      while (!window.pdfjsLib && attempts++ < 25) await new Promise(r => setTimeout(r, 300));
      if (!window.pdfjsLib) { setError("PDF.js failed to load"); setLoading(false); return; }
      try {
        const pdf = await window.pdfjsLib.getDocument(pdfUrl).promise;
        if (cancelled) return; // component unmounted while we were loading — bail out
        pdfRef.current = pdf;
        setPageCount(pdf.numPages);
        setCurrent(1);
        setLoading(false);
      } catch (e) {
        if (!cancelled) { setError("Cannot render PDF: " + e.message); setLoading(false); }
      }
    };
    load();
    return () => { cancelled = true; }; // cleanup so we don't set state on an unmounted component
  }, [pdfUrl]);

  // when the reviewer clicks "view in pdf" on a source sentence, jump straight to that page
  useEffect(() => {
    if (highlightPage && highlightPage >= 1) setCurrent(highlightPage);
  }, [highlightPage]);

  // re-render the canvas whenever the current page changes
  // i cancel the previous render task first to avoid overlapping renders on fast page flips
  useEffect(() => {
    if (!pdfRef.current || loading) return;
    const render = async () => {
      if (taskRef.current) { try { taskRef.current.cancel(); } catch {} }
      try {
        const page   = await pdfRef.current.getPage(current);
        const canvas = canvasRef.current;
        if (!canvas) return;
        const vp     = page.getViewport({ scale: 1.5 }); // 1.5x looks crisp without being huge
        canvas.width  = vp.width;
        canvas.height = vp.height;
        const task    = page.render({ canvasContext: canvas.getContext("2d"), viewport: vp });
        taskRef.current = task;
        await task.promise;
      } catch (e) {
        // RenderingCancelledException is expected when we cancel a previous task — suppress it
        if (e.name !== "RenderingCancelledException") console.error(e);
      }
    };
    render();
  }, [current, loading]);

  // empty state when no pdf has been uploaded yet
  if (!pdfUrl) return (
    <div style={s.empty}>
      <div style={{ fontSize: 40, opacity: 0.15, marginBottom: 12 }}>📄</div>
      <div style={s.emptyTxt}>PDF preview</div>
      <div style={s.emptyHint}>Upload a judgment to see it here</div>
    </div>
  );

  return (
    <div style={s.wrap}>
      {/* toolbar — shows filename and prev/next page buttons */}
      <div style={s.toolbar}>
        <span style={s.fname}>{filename || "Judgment"}</span>
        <div style={s.nav}>
          <button style={s.btn} onClick={() => setCurrent(p => Math.max(1, p - 1))} disabled={current <= 1}>‹</button>
          <span style={s.pLabel}>{current} / {pageCount}</span>
          <button style={s.btn} onClick={() => setCurrent(p => Math.min(pageCount, p + 1))} disabled={current >= pageCount}>›</button>
        </div>
      </div>

      {/* highlight banner — shows the source sentence that the reviewer clicked on */}
      {/* truncated at 140 chars so it doesn't push the canvas too far down */}
      {highlightText && (
        <div style={s.banner}>
          <span style={{ opacity: 0.6, flexShrink: 0 }}>◈</span>
          <span style={s.bannerTxt}>"{highlightText.slice(0, 140)}{highlightText.length > 140 ? "…" : ""}"</span>
        </div>
      )}

      {/* canvas where pdf.js draws each page */}
      <div style={s.canvasWrap}>
        {loading && <div style={s.center}><div style={s.spinner} /><div style={s.hint}>Loading…</div></div>}
        {error   && <div style={{ color: "#fca5a5", fontSize: 13, padding: 20, textAlign: "center" }}>{error}</div>}
        {/* canvas is hidden while loading to avoid a flash of blank space */}
        <canvas ref={canvasRef} style={{ width: "100%", display: loading || error ? "none" : "block" }} />
      </div>
    </div>
  );
}

// styles
const s = {
  wrap:       { display:"flex", flexDirection:"column", height:"100%", background:C.bg, borderRadius:10, overflow:"hidden", border:`1px solid ${C.border}` },
  toolbar:    { display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 14px", borderBottom:`1px solid ${C.border}`, background:C.surface, flexShrink:0 },
  fname:      { fontSize:12, color:C.txt2, fontFamily:"monospace", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:160 },
  nav:        { display:"flex", alignItems:"center", gap:6 },
  btn:        { background:"transparent", border:`1px solid ${C.border}`, color:C.txt2, borderRadius:5, width:26, height:26, cursor:"pointer", fontSize:15, lineHeight:"26px", textAlign:"center", padding:0 },
  pLabel:     { fontSize:11, color:C.txt2, fontFamily:"monospace", minWidth:70, textAlign:"center" },
  banner:     { display:"flex", alignItems:"flex-start", gap:8, padding:"7px 14px", background:"rgba(79,110,247,0.1)", borderBottom:`1px solid rgba(79,110,247,0.25)`, flexShrink:0 },
  bannerTxt:  { fontSize:11, color:"#93a8fa", lineHeight:1.5, fontStyle:"italic" },
  canvasWrap: { flex:1, overflowY:"auto", padding:10 },
  center:     { display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:60 },
  spinner:    { width:28, height:28, border:`2px solid ${C.border}`, borderTopColor:C.accent, borderRadius:"50%", animation:"spin 0.8s linear infinite", marginBottom:10 },
  hint:       { fontSize:12, color:C.txt2 },
  empty:      { display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:"100%", padding:40, background:C.surface, borderRadius:10, border:`1px solid ${C.border}` },
  emptyTxt:   { fontSize:14, fontWeight:500, color:C.txt2, marginBottom:4 },
  emptyHint:  { fontSize:11, color:C.txt3 },
};
