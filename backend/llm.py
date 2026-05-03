# llm.py — this is the brain of the whole app
# i'm using groq (free, super fast) + instructor (structured json output, no parsing headaches)
# the model is llama 3.3 70b — it's surprisingly good at reading legal language

import os
import logging
from datetime import datetime

import groq
import instructor
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

MAX_RETRIES = 3

# groq's free tier is 12k tokens per request — i learned this the hard way
# the trick: keep the TOP of the doc (case number, court, parties) + the BOTTOM (actual orders)
# the middle is usually argument summaries we don't need
_MAX_IDENTITY_CHARS   = 4_000
_MAX_DIRECTIONS_CHARS = 5_000


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
    return _client.chat.completions.create(
        model          = "llama-3.3-70b-versatile",
        response_model = CaseExtraction,  # instructor enforces this schema
        max_retries    = MAX_RETRIES,
        max_tokens     = 2000,
        messages       = [{"role": "user", "content": prompt}],
    )


def generate_action_plan(extraction: CaseExtraction) -> ActionPlan:
    # phase 2 — given what we extracted, tell the officer what to actually DO
    # this is the part that makes the app useful vs just being a search tool
    prompt = action_plan_prompt(extraction.model_dump_json(indent=2))
    return _client.chat.completions.create(
        model          = "llama-3.3-70b-versatile",
        response_model = ActionPlan,
        max_retries    = MAX_RETRIES,
        max_tokens     = 4096,
        messages       = [{"role": "user", "content": prompt}],
    )


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
