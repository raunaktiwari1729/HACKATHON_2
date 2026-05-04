# llm.py — brain of the app
# uses groq (free, fast) + instructor (structured json output)
# supports multiple groq api keys — if one hits a rate limit, it rotates to the next

import os
import logging
from datetime import datetime

import groq
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
# multi-key setup — add as many keys as you have groq accounts
# reads GROQ_API_KEY, GROQ_API_KEY_2, GROQ_API_KEY_3, ... from env
# ---------------------------------------------------------------------------

def _load_api_keys() -> list[str]:
    keys = []
    # always check the primary key first
    primary = os.getenv("GROQ_API_KEY")
    if primary:
        keys.append(primary)
    # then check numbered fallbacks: GROQ_API_KEY_2, GROQ_API_KEY_3, ...
    i = 2
    while True:
        key = os.getenv(f"GROQ_API_KEY_{i}")
        if not key:
            break
        keys.append(key)
        i += 1
    return keys

_API_KEYS = _load_api_keys()

if not _API_KEYS:
    raise EnvironmentError(
        "No GROQ_API_KEY found in environment. "
        "Set GROQ_API_KEY (and optionally GROQ_API_KEY_2, GROQ_API_KEY_3) in your .env file."
    )

logger.info(f"loaded {len(_API_KEYS)} groq api key(s)")

# current key index — rotates forward on failure
_current_key_index = 0


def _make_client(key: str):
    """build an instructor-wrapped groq client for a given api key."""
    gc = groq.Groq(api_key=key)
    return instructor.from_groq(gc, mode=instructor.Mode.JSON)


def _get_client():
    """return a client using the current active key."""
    return _make_client(_API_KEYS[_current_key_index])


def _rotate_key() -> bool:
    """
    rotate to the next available api key.
    returns True if a new key is available, False if all keys are exhausted.
    """
    global _current_key_index
    if _current_key_index + 1 < len(_API_KEYS):
        _current_key_index += 1
        logger.warning(f"rotated to groq api key #{_current_key_index + 1}")
        return True
    logger.error("all groq api keys exhausted")
    return False


def _call_with_fallback(model_kwargs: dict):
    """
    try the groq call with the current key.
    on rate limit (429) or auth error (401), rotate to next key and retry.
    on 413 (request too large): fail immediately — all keys have the same token limit,
      rotating won't help. the fix is smaller input, not a different key.
    on loop/repetition errors, raise immediately (retrying won't help).
    """
    global _current_key_index
    # reset to key 0 at the start of each top-level call (fresh attempt)
    _current_key_index = 0

    last_error = None
    for attempt in range(len(_API_KEYS)):
        client = _get_client()
        try:
            return client.chat.completions.create(**model_kwargs)
        except APIStatusError as e:
            status = getattr(e, "status_code", None)

            # loop/repetition errors — retrying with another key won't help
            err_str = str(e).lower()
            if "looping content" in err_str or "model output error" in err_str:
                logger.error(f"groq loop detection (key #{_current_key_index + 1}): {e}")
                raise RuntimeError(
                    "The AI flagged this content as repetitive. "
                    "Try a cleaner digital PDF."
                ) from e

            # 413 = request too large — ALL keys have the same 12k token limit,
            # rotating to another key will just get the same error. fail fast.
            if status == 413:
                logger.error(f"groq 413: request too large ({status}). PDF text needs further trimming.")
                raise RuntimeError(
                    "PDF text is too large for the AI model (exceeds 12,000 token limit). "
                    "Try uploading a shorter PDF or one with fewer pages."
                ) from e

            # rate limit or auth error — try next key
            if status in (429, 401, 403):
                logger.warning(
                    f"groq key #{_current_key_index + 1} failed "
                    f"(HTTP {status}) — trying next key"
                )
                last_error = e
                if not _rotate_key():
                    break
                continue

            # any other error — surface it immediately
            raise

        except Exception as e:
            err_str = str(e).lower()
            # instructor wraps 413 in its own exception format — catch it here too
            if "413" in str(e) or "request too large" in err_str or "tokens per minute" in err_str:
                logger.error(f"groq 413 (wrapped by instructor): PDF too large for model.")
                raise RuntimeError(
                    "PDF text is too large for the AI model (exceeds 12,000 token limit). "
                    "Try uploading a shorter PDF or one with fewer pages."
                ) from e
            logger.error(f"unexpected error on key #{_current_key_index + 1}: {e}")
            last_error = e
            if not _rotate_key():
                break
            continue

    raise RuntimeError(
        f"All {len(_API_KEYS)} Groq API key(s) failed. Last error: {last_error}"
    )


MAX_RETRIES = 1   # was 2 — instructor was retrying twice on 413, doubling the waste

# groq free tier: 12k tokens per request
# rough budget: prompt template ≈ 8k tokens, so content budget ≈ 3.5k tokens total
# keeping these low avoids 413s on large legal PDFs
_MAX_IDENTITY_CHARS   = 2_000  # was 3500 — case header: number, court, parties
_MAX_DIRECTIONS_CHARS = 2_000  # was 3500 — court orders near end of doc


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
    extraction  = extract_case_data(chunks)
    action_plan = generate_action_plan(extraction)
    return VerificationRecord(
        pdf_filename = filename,
        extracted_at = datetime.utcnow(),
        extraction   = extraction,
        action_plan  = action_plan,
        status       = VerificationStatus.PENDING,
        edits_made   = [],
    )


def extract_case_data(chunks: DocumentChunks) -> CaseExtraction:
    identity_text   = _truncate_start(chunks.best_identity_chunk(),   _MAX_IDENTITY_CHARS)
    directions_text = _truncate_end(chunks.best_directions_chunk(), _MAX_DIRECTIONS_CHARS)
    prompt = extraction_prompt(identity_text, directions_text, chunks.used_fallback)

    return _call_with_fallback({
        "model":          "llama-3.3-70b-versatile",
        "response_model": CaseExtraction,
        "max_retries":    MAX_RETRIES,
        "max_tokens":     1500,
        "messages":       [{"role": "user", "content": prompt}],
    })


def generate_action_plan(extraction: CaseExtraction) -> ActionPlan:
    prompt = action_plan_prompt(extraction.model_dump_json(indent=2))

    return _call_with_fallback({
        "model":          "llama-3.3-70b-versatile",
        "response_model": ActionPlan,
        "max_retries":    MAX_RETRIES,
        "max_tokens":     4096,
        "messages":       [{"role": "user", "content": prompt}],
    })


def regenerate_action_plan(extraction: CaseExtraction) -> ActionPlan:
    logger.info("reviewer made edits — regenerating action plan to match")
    prompt = regeneration_prompt(extraction.model_dump_json(indent=2))

    return _call_with_fallback({
        "model":          "llama-3.3-70b-versatile",
        "response_model": ActionPlan,
        "max_retries":    MAX_RETRIES,
        "max_tokens":     4096,
        "messages":       [{"role": "user", "content": prompt}],
    })
