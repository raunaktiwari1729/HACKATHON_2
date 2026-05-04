# llm.py — this is the brain of the whole app
# i'm using groq (free, super fast) + instructor (structured json output, no parsing headaches)
# the model is llama 3.3 70b — it's surprisingly good at reading legal language

import os
import logging
from datetime import datetime

import groq
import instructor
from groq import APIStatusError   # gives us typed access to groq http errors
from dotenv import load_dotenv, find_dotenv

from models import (
    ActionPlan, CaseExtraction, VerificationRecord, VerificationStatus, FieldEdit,
)
from chunker import DocumentChunks
from prompt import extraction_prompt, action_plan_prompt, regeneration_prompt

load_dotenv(find_dotenv())
logger = logging.getLogger(__name__)

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
if not GROQ_API_KEY:
    # crash immediately if no key — better than a cryptic error 5 functions deep
    raise EnvironmentError("GROQ_API_KEY not set in .env file")

groq_client = groq.Groq(api_key=GROQ_API_KEY)

# instructor wraps groq so the LLM returns a pydantic model, not raw text
# i'm using mode.json because it saves ~5k tokens vs mode.tools — matters on free tier
_client = instructor.from_groq(groq_client, mode=instructor.Mode.JSON)

MAX_RETRIES = 2   # was 3 — lower so we fail fast instead of compounding loop errors

# groq's free tier is 12k tokens per request — i learned this the hard way
# keeping text budgets tight also reduces the chance of the model entering a
# looping-repetition pattern (which groq flags as an error and Instructor retries,
# making the loop worse). shorter input = shorter, more focused output.
_MAX_IDENTITY_CHARS   = 3_500  # was 4000 — top of doc: case number, court, parties
_MAX_DIRECTIONS_CHARS = 3_500  # was 5000 — bottom of doc: the actual orders


def _truncate_start(text: str, max_chars: int) -> str:
    # keep first N chars — the case header is always at the top
    if len(text) <= max_chars:
        return text
    logger.warning(f"identity chunk trimmed {len(text)} → {max_chars} chars")
    return text[:max_chars] + "\n...[truncated]"


def _truncate_end(text: str, max_chars: int) -> str:
    # keep last N chars — court orders always appear near the end of the judgment
    if len(text) <= max_chars:
        return text
    logger.warning(f"directions chunk trimmed {len(text)} → {max_chars} chars")
    return "[truncated]...\n" + text[-max_chars:]


def process_judgment(chunks: DocumentChunks, filename: str) -> VerificationRecord:
    # main entry point — runs both phases and wraps everything into a pending record
    logger.info(f"starting llm processing for: {filename}")
    extraction  = extract_case_data(chunks)
    action_plan = generate_action_plan(extraction)
    return VerificationRecord(
        pdf_filename = filename,
        extracted_at = datetime.utcnow(),
        extraction   = extraction,
        action_plan  = action_plan,
        status       = VerificationStatus.PENDING,  # human still needs to approve this
        edits_made   = [],
    )


def extract_case_data(chunks: DocumentChunks) -> CaseExtraction:
    # phase 1 — pull case identity, parties, directions, timelines from the pdf text
    # i give it identity chunk from the top + directions chunk from the bottom of the doc
    identity_text   = _truncate_start(chunks.best_identity_chunk(),   _MAX_IDENTITY_CHARS)
    directions_text = _truncate_end(chunks.best_directions_chunk(), _MAX_DIRECTIONS_CHARS)
    prompt = extraction_prompt(identity_text, directions_text, chunks.used_fallback)
    try:
        return _client.chat.completions.create(
            model          = "llama-3.3-70b-versatile",
            response_model = CaseExtraction,   # instructor enforces this schema
            max_retries    = MAX_RETRIES,
            max_tokens     = 1500,             # was 2000 — shorter forces concise output, less looping
            messages       = [{"role": "user", "content": prompt}],
        )
    except APIStatusError as e:
        # groq flags repetitive/looping model output with a 400 "model output error".
        # instructor would normally retry — but retrying the same prompt just loops again.
        # we catch it here and surface a clear error so main.py can return a 422 to the user.
        if "looping content" in str(e).lower() or "model output error" in str(e).lower():
            logger.error(f"groq loop detection on extraction: {e}")
            raise RuntimeError(
                "The AI flagged this PDF's text as repetitive (possible scanned/OCR artefact). "
                "Try uploading a cleaner digital PDF."
            ) from e
        raise


def generate_action_plan(extraction: CaseExtraction) -> ActionPlan:
    # phase 2 — given what we extracted, tell the officer what to actually DO
    # this is the part that makes the app useful vs just being a search tool
    prompt = action_plan_prompt(extraction.model_dump_json(indent=2))
    try:
        return _client.chat.completions.create(
            model          = "llama-3.3-70b-versatile",
            response_model = ActionPlan,
            max_retries    = MAX_RETRIES,
            max_tokens     = 4096,
            messages       = [{"role": "user", "content": prompt}],
        )
    except APIStatusError as e:
        if "looping content" in str(e).lower() or "model output error" in str(e).lower():
            logger.error(f"groq loop detection on action plan: {e}")
            raise RuntimeError(
                "The AI flagged the action plan output as repetitive. "
                "Extraction succeeded — try approving the case with the extracted data only."
            ) from e
        raise


def regenerate_action_plan(extraction: CaseExtraction) -> ActionPlan:
    # if the reviewer corrected any extracted fields, we rebuild the action plan
    # so the plan stays consistent with what the reviewer verified
    logger.info("reviewer made edits — regenerating action plan to match")
    prompt = regeneration_prompt(extraction.model_dump_json(indent=2))
    return _client.chat.completions.create(
        model          = "llama-3.3-70b-versatile",
        response_model = ActionPlan,
        max_retries    = MAX_RETRIES,
        max_tokens     = 4096,
        messages       = [{"role": "user", "content": prompt}],
    )
