# ⚖️ JudgmentAI

> *"Every court order deserves action — not a forgotten pile on someone's desk."*

**JudgmentAI** is an AI-powered platform built for Indian government departments to stop drowning in court judgments. Drop a PDF, and in under 30 seconds you get a structured action plan, compliance deadlines, and an appeal recommendation — verified by a human before it ever reaches the dashboard.

Built for **Hackathon — AI for Bharat 🇮🇳**

---

## 🤯 The Problem We're Solving

Every day, Indian government departments receive hundreds of court orders. Most of them require some action — pay someone, reinstate an employee, file a compliance report, or appeal within 90 days.

But what actually happens? The order gets passed around, no one fully reads it, the deadline slips, and the department ends up in contempt of court.

We built JudgmentAI so that never happens again.

---

## ✨ What It Does

```
📄 Upload PDF
      ↓
🤖 AI reads the full judgment (Groq + LLaMA 3.3 70B)
      ↓
📋 Extracts: case details, court orders, deadlines, parties, appeal windows
      ↓
🗺️ Generates: a step-by-step action plan for the officer
      ↓
👁️ Human reviewer verifies and approves
      ↓
📊 Appears on the verified Dashboard — sorted by urgency
```

No missed deadlines. No confusion. No contempt of court.

---

## 🛠️ Tech Stack

| Layer | What I Used | Why |
|-------|------------|-----|
| **AI / LLM** | Groq API + LLaMA 3.3 70B | fastest free inference, handles legal text well |
| **Structured Output** | Instructor library | forces the LLM to return valid typed JSON — no regex hacks |
| **Backend** | FastAPI + Python | clean async API, auto-generates docs at `/docs` |
| **Database** | SQLite via SQLModel | zero config, works offline, perfect for hackathon scope |
| **PDF Processing** | pdfplumber + pytesseract | handles both digital and scanned/OCR PDFs |
| **Frontend** | React (CRA) | component-based, state flows clearly |
| **Styling** | Pure inline CSS | full control, no class name conflicts, ships fast |

---

## 🚀 Getting Started

### Prerequisites

- Python 3.11+
- Node.js 18+
- A free [Groq API key](https://console.groq.com) (takes 30 seconds to get)

---

### 1. Clone the repo

```bash
git clone https://github.com/YOUR_USERNAME/JudgmentAI.git
cd JudgmentAI
```

### 2. Set up the backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # Mac/Linux
pip install -r requirements.txt
```

Create a `.env` file inside `/backend`:

```env
GROQ_API_KEY=your_groq_api_key_here
```

Start the backend:

```bash
python -m uvicorn main:app --reload
```

Backend → `http://127.0.0.1:8000`
Auto-generated API docs → `http://127.0.0.1:8000/docs`

---

### 3. Set up the frontend

```bash
cd frontend
npm install
npm start
```

Frontend → `http://localhost:3000`

---

## 📁 Project Structure

```
JudgmentAI/
├── backend/
│   ├── main.py          # all the api routes live here
│   ├── llm.py           # groq + instructor magic happens here
│   ├── database.py      # sqlite reads/writes
│   ├── models.py        # pydantic schemas for every data shape
│   ├── chunker.py       # splits pdf into smart sections
│   ├── pdf_utils.py     # pdf text extraction + ocr fallback
│   ├── prompt.py        # all llm prompts — the most important file tbh
│   └── judgments.db     # auto-created on first run, don't commit this
│
├── frontend/
│   └── src/
│       ├── App.jsx              # root layout, nav, tab routing
│       ├── api.js               # all backend calls in one place
│       └── components/
│           ├── UploadPanel.jsx  # drag-and-drop pdf upload flow
│           ├── ReviewPanel.jsx  # human review + edit + approve/reject
│           ├── Dashboard.jsx    # approved cases, search, filter, expand
│           └── PDFViewer.jsx    # side-by-side pdf with text highlighting
│
└── README.md
```

---

## 🧪 How to Use It

1. **Upload** — Drag and drop any Indian court judgment PDF
2. **Wait ~20s** — AI reads it and builds a structured action plan
3. **Review** — Verify the extraction, correct any errors, then Approve or Reject
4. **Dashboard** — Approved cases show here sorted by urgency. Click "Show all details" for the full breakdown

---

## 🔑 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GROQ_API_KEY` | ✅ Yes | get it free at console.groq.com |

That's literally it. One key and you're running.

---

## ⚠️ Known Limitations

- Groq's free tier caps at **12,000 tokens per request** — long PDFs get smart-truncated (we keep the case header + court orders, skip the middle filler)
- OCR quality depends on scan quality — blurry PDFs = noisy text = lower AI confidence
- `days_remaining` is computed at upload time, not updated daily (future feature)
- No auth system — single user for now (out of hackathon scope)

---

## 🌱 What's Next

- [ ] Daily cron job to refresh `days_remaining`
- [ ] Email/SMS deadline alerts
- [ ] Multi-department login with role-based access
- [ ] Bulk PDF processing
- [ ] Hindi language support for regional courts

---

## 👨‍💻 Built By

Made with chai ☕ and zero sleep 😅 for **AI for Bharat Hackathon 2026**.

If this saves even one officer from missing a court deadline, we've done something real.

---

## 📄 License

MIT — use it, fork it, build on it. Just don't blame us if the AI misreads a particularly chaotic court order 😄

---

> *"The law moves slowly. Our action plans don't."*
