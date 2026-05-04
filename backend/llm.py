# llm.py — brain of the app
# uses gemini (primary, huge context) and groq (fallback) + instructor (structured json output)
# rotates through available keys automatically if rate limits are hit

import os
import logging
from datetime import datetime

import groq
from google import genai
from google.genai.errors import APIError
import instructor
from groq import APIStatusError
from dotenv import load_dotenv, find_dotenv

from models import (
    ActionPlan, CaseExtraction, VerificationRecord, VerificationStatus, FieldEdit,
)
from chunker import DocumentChunks
from prompt import extraction_prompt, action_plan_prompt, regeneration_prompt

load_dotenv(find_dotenv())
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# multi-provider setup
# primary: Gemini 2.5 Flash (250k TPM, 1M context, no looping issues)
# fallback: Groq (fast, but 12k TPM limit)
# ---------------------------------------------------------------------------

def _load_groq_keys() -> list[str]:
    keys = []
    primary = os.getenv("GROQ_API_KEY")
    if primary: keys.append(primary)
    i = 2
    while True:
        key = os.getenv(f"GROQ_API_KEY_{i}")
        if not key: break
        keys.append(key)
        i += 1
    return keys

_GEMINI_KEY = os.getenv("GEMINI_API_KEY")
_GROQ_KEYS = _load_groq_keys()

if not _GEMINI_KEY and not _GROQ_KEYS:
    raise EnvironmentError(
        "No API keys found. Set GEMINI_API_KEY and/or GROQ_API_KEY in your .env file."
    )

logger.info(f"loaded 1 gemini key, {len(_GROQ_KEYS)} groq key(s)")

# Gemini has a 1M token context window, so we don't need to truncate aggressively
# Groq has a 12k limit, but since Gemini is primary, we can use larger chunks.
# If it falls back to Groq, the prompt might be too large, but that's a known Groq limitation.
# We'll set the limits to 50,000 chars (approx 12k tokens) which easily fits both.
_MAX_IDENTITY_CHARS   = 50_000
_MAX_DIRECTIONS_CHARS = 50_000

MAX_RETRIES = 1


def _call_gemini(model_kwargs: dict):
    """Make a call using Gemini 2.5 Flash via google-genai and instructor"""
    logger.info("attempting extraction via Gemini 2.5 Flash")
    client = instructor.from_genai(
        client=genai.Client(api_key=_GEMINI_KEY),
        mode=instructor.Mode.GENAI_STRUCTURED_OUTPUTS,
    )
    
    # map standard openai kwargs to gemini kwargs
    # response_model and messages are identical in instructor
    return client.chat.completions.create(
        model="gemini-2.5-flash",
        response_model=model_kwargs["response_model"],
        max_retries=model_kwargs.get("max_retries", MAX_RETRIES),
        messages=model_kwargs["messages"],
    )


def _call_groq(model_kwargs: dict, key_index: int):
    """Make a call using Groq"""
    logger.info(f"attempting extraction via Groq key #{key_index + 1}")
    gc = groq.Groq(api_key=_GROQ_KEYS[key_index])
    client = instructor.from_groq(gc, mode=instructor.Mode.JSON)
    
    return client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        response_model=model_kwargs["response_model"],
        max_retries=model_kwargs.get("max_retries", MAX_RETRIES),
        messages=model_kwargs["messages"],
        temperature=0.0,
    )


def _call_with_fallback(model_kwargs: dict):
    """
    try Gemini first (if key exists).
    on error (rate limit, etc), fall back to Groq keys in order.
    """
    last_error = None
    
    # 1. Try Gemini
    gemini_error = None
    if _GEMINI_KEY:
        try:
            return _call_gemini(model_kwargs), "Gemini 2.5 Flash"
        except Exception as e:
            logger.warning(f"Gemini failed: {e}")
            gemini_error = e
            last_error = e

    # 2. Fall back to Groq keys
    for i in range(len(_GROQ_KEYS)):
        try:
            return _call_groq(model_kwargs, i), f"Groq Llama-3.3 (Key {i+1})"
        except APIStatusError as e:
            status = getattr(e, "status_code", None)
            err_str = str(e).lower()
            
            # looping error - fail immediately
            if "looping content" in err_str or "model output error" in err_str:
                logger.error(f"groq loop detection (key #{i + 1}): {e}")
                raise RuntimeError(
                    "The AI flagged this content as repetitive. Try a cleaner digital PDF."
                ) from e
                
            # 413 request too large - fail immediately
            if status == 413:
                logger.error(f"groq 413: request too large. PDF text exceeds 12k Groq limit.")
                msg = "PDF text is too large for Groq fallback (exceeds 12,000 token limit). "
                if gemini_error: msg += f"Gemini failed to load with error: {gemini_error}"
                raise RuntimeError(msg) from e
                
            logger.warning(f"groq key #{i + 1} failed (HTTP {status}) — trying next key")
            last_error = e
            continue
            
        except Exception as e:
            err_str = str(e).lower()
            if "413" in str(e) or "request too large" in err_str or "tokens per minute" in err_str:
                logger.error(f"groq 413 (wrapped by instructor): PDF too large for model.")
                msg = "PDF text is too large for Groq fallback (exceeds 12,000 token limit). "
                if gemini_error: msg += f"Gemini failed to load with error: {gemini_error}"
                raise RuntimeError(msg) from e
                
            logger.error(f"unexpected error on groq key #{i + 1}: {e}")
            last_error = e
            continue

    error_msg = f"All AI providers failed. Last Groq error: {last_error}"
    if gemini_error:
        error_msg = f"Gemini failed with error: {gemini_error}. Then fallback to Groq failed with: {last_error}"
        
    raise RuntimeError(error_msg)


def _truncate_start(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    logger.warning(f"identity chunk trimmed {len(text)} → {max_chars} chars")
    return text[:max_chars] + "\n...[truncated]"


def _truncate_end(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    logger.warning(f"directions chunk trimmed {len(text)} → {max_chars} chars")
    return "[truncated]...\n" + text[-max_chars:]


def process_judgment(chunks: DocumentChunks, filename: str) -> VerificationRecord:
    logger.info(f"starting llm processing for: {filename}")
    extraction, provider1 = extract_case_data(chunks)
    action_plan, provider2 = generate_action_plan(extraction)
    return VerificationRecord(
        pdf_filename = filename,
        extracted_at = datetime.utcnow(),
        extraction   = extraction,
        action_plan  = action_plan,
        status       = VerificationStatus.PENDING,
        edits_made   = [],
        llm_provider = provider1,
    )


def extract_case_data(chunks: DocumentChunks) -> tuple[CaseExtraction, str]:
    identity_text   = _truncate_start(chunks.best_identity_chunk(),   _MAX_IDENTITY_CHARS)
    directions_text = _truncate_end(chunks.best_directions_chunk(), _MAX_DIRECTIONS_CHARS)
    prompt = extraction_prompt(identity_text, directions_text, chunks.used_fallback)

    return _call_with_fallback({
        "response_model": CaseExtraction,
        "max_retries":    MAX_RETRIES,
        "messages":       [{"role": "user", "content": prompt}],
    })


def generate_action_plan(extraction: CaseExtraction) -> tuple[ActionPlan, str]:
    prompt = action_plan_prompt(extraction.model_dump_json(indent=2))

    return _call_with_fallback({
        "response_model": ActionPlan,
        "max_retries":    MAX_RETRIES,
        "messages":       [{"role": "user", "content": prompt}],
    })


def regenerate_action_plan(extraction: CaseExtraction) -> tuple[ActionPlan, str]:
    logger.info("reviewer made edits — regenerating action plan to match")
    prompt = regeneration_prompt(extraction.model_dump_json(indent=2))

    return _call_with_fallback({
        "response_model": ActionPlan,
        "max_retries":    MAX_RETRIES,
        "messages":       [{"role": "user", "content": prompt}],
    })
