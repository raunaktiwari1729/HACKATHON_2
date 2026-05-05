# main.py — fastapi backend for judgmentai
# wires together: pdf_utils → chunker → llm → database
#
# routes:
#   POST /upload          — upload pdf, extract, generate action plan
#   GET  /pending         — all cases awaiting human review
#   GET  /case/{id}       — full case data for the review ui
#   POST /approve/{id}    — approve a case (moves to dashboard)
#   POST /reject/{id}     — reject a case
#   GET  /dashboard       — all approved cases (department-wise)
#   GET  /departments     — unique department names for the filter dropdown
#   GET  /health          — quick health check

import logging
from contextlib import asynccontextmanager
from typing import Optional

# Form was here but nothing uses it — removed to avoid confusion
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from chunker import chunk_document
from database import (
    approve_case,
    create_db,
    get_all_departments,
    get_case_by_id,
    get_dashboard_cases,
    get_full_record,
    get_pending_cases,
    reject_case,
    save_case,
)
from llm import process_judgment, regenerate_action_plan
from models import ActionPlan, CaseExtraction, FieldEdit
from pdf_utils import extract_pdf

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# create db tables on startup — safe to call even if tables already exist
@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db()
    logger.info("database ready — judgments.db created/verified")
    yield

app = FastAPI(
    title       = "Judgment AI — Court Case Action Planner",
    description = "Extracts structured action plans from Indian court judgment PDFs",
    version     = "1.0.0",
    lifespan    = lifespan,
)

# cors — allows the react frontend on localhost:3000 to hit this backend
# allow_origins=["*"] is fine for a hackathon; lock it down before production
app.add_middleware(
    CORSMiddleware,
    allow_origins     = ["*"],
    allow_credentials = False,
    allow_methods     = ["*"],
    allow_headers     = ["*"],
)


# request/response bodies for the api endpoints
class ApproveRequest(BaseModel):
    reviewed_by:    str
    notes:          Optional[str]        = None
    edits:          list[FieldEdit]      = []
    updated_plan:   Optional[ActionPlan] = None

class RejectRequest(BaseModel):
    reviewed_by: str
    notes:       Optional[str] = None

class UploadResponse(BaseModel):
    case_id:      int
    case_number:  str
    case_title:   str
    total_pages:  int
    has_ocr:      bool
    message:      str


# upload route — the main entry point
# pipeline: pdf bytes → extract text → chunk → llm extraction → llm action plan → save as PENDING
@app.post("/upload", response_model=UploadResponse)
async def upload_judgment(file: UploadFile = File(...)):
    # only accept pdfs
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")

    logger.info(f"received upload: {file.filename}")

    # step 1 — read raw bytes from the upload
    try:
        file_bytes = await file.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read file: {e}")

    # step 2 — extract text from pdf (tries digital first, falls back to ocr for scanned docs)
    try:
        pdf_content = extract_pdf(file_bytes, file.filename)
        logger.info(f"extracted {pdf_content.total_pages} pages, ocr={pdf_content.has_ocr_pages}")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=f"PDF extraction failed: {e}")

    if pdf_content.total_pages == 0:
        raise HTTPException(status_code=422, detail="PDF appears to be empty")

    # step 3 — split into named sections (header, directions, tail, etc.)
    chunks = chunk_document(pdf_content)
    logger.info(f"sections detected: {chunks.sections_detected}")

    # step 4 — llm extraction + action plan via groq
    try:
        record = process_judgment(chunks, file.filename)
    except Exception as e:
        logger.error(f"llm processing failed: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"AI processing failed: {str(e)}. Check your GEMINI_API_KEY / GROQ_API_KEY.",
        )

    # step 5 — save to db as PENDING (human review required before dashboard)
    case_id = save_case(record)
    logger.info(f"saved case_id={case_id}, status=PENDING")

    return UploadResponse(
        case_id     = case_id,
        case_number = record.extraction.case_number.value,
        case_title  = record.extraction.case_title.value,
        total_pages = pdf_content.total_pages,
        has_ocr     = pdf_content.has_ocr_pages,
        message     = "Extraction complete. Ready for human review.",
    )


# all cases waiting for human review — shown in the review queue sidebar
# returns lightweight data (no full json blobs, just the columns)
@app.get("/pending")
def list_pending_cases():
    rows = get_pending_cases()
    return [
        {
            "id":                    row.id,
            "case_number":           row.case_number,
            "case_title":            row.case_title,
            "court_name":            row.court_name,
            "date_of_order":         row.date_of_order,
            "urgency_level":         row.urgency_level,
            "responsible_department": row.responsible_department,
            "pdf_filename":          row.pdf_filename,
            "extracted_at":          row.extracted_at.isoformat(),
        }
        for row in rows
    ]


# full case data for the review ui — includes source_sentences and page_refs for pdf highlighting
@app.get("/case/{case_id}")
def get_case(case_id: int):
    record = get_full_record(case_id)
    if not record:
        raise HTTPException(status_code=404, detail=f"Case {case_id} not found")

    return {
        "id":           record.id,
        "status":       record.status,
        "pdf_filename": record.pdf_filename,
        "extracted_at": record.extracted_at.isoformat(),
        "extraction":   record.extraction.model_dump(),
        "action_plan":  record.action_plan.model_dump(),
        "edits_made":   [e.model_dump() for e in record.edits_made],
    }


# approve a case — moves it to the dashboard
# if reviewer made edits, we regenerate the action plan so it matches what they verified
@app.post("/approve/{case_id}")
def approve(case_id: int, body: ApproveRequest):
    updated_plan = body.updated_plan
    if body.edits and not updated_plan:
        # reviewer changed extraction fields — rebuild the action plan to stay consistent
        record = get_full_record(case_id)
        if record:
            try:
                updated_plan, _ = regenerate_action_plan(record.extraction)
            except Exception as e:
                logger.warning(f"could not regenerate action plan: {e}")

    success = approve_case(
        case_id      = case_id,
        reviewed_by  = body.reviewed_by,
        notes        = body.notes,
        edits        = body.edits,
        updated_plan = updated_plan,
    )

    if not success:
        raise HTTPException(status_code=404, detail=f"Case {case_id} not found")

    return {"message": f"Case {case_id} approved and added to dashboard"}


# reject a case — bad pdf, wrong document, completely wrong extraction
# rejected cases stay in the db but never appear in the ui
@app.post("/reject/{case_id}")
def reject(case_id: int, body: RejectRequest):
    success = reject_case(
        case_id     = case_id,
        reviewed_by = body.reviewed_by,
        notes       = body.notes,
    )
    if not success:
        raise HTTPException(status_code=404, detail=f"Case {case_id} not found")

    return {"message": f"Case {case_id} rejected"}


# approved cases for the dashboard — optionally filtered by department
# always sorted by days_remaining ascending (most urgent first)
# never returns PENDING or REJECTED cases
@app.get("/dashboard")
def dashboard(department: Optional[str] = None):
    cases = get_dashboard_cases(department=department)
    return {
        "total": len(cases),
        "cases": [c.model_dump() for c in cases],
    }


# unique department names for the filter dropdown
@app.get("/departments")
def departments():
    return {"departments": get_all_departments()}


@app.get("/health")
def health():
    return {"status": "ok", "service": "Judgment AI Backend"}
