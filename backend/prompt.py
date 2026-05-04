"""
prompt.py — All LLM prompt strings in one place
Keep prompts here, not scattered inside llm.py function bodies.
Makes it easy to tune, A/B test, or swap prompts without touching logic.

Note: These are used by llm.py — you don't call this file directly.
"""

from datetime import date


# ---------------------------------------------------------------------------
# Extraction prompt
# Sent to Groq (llama-3.3-70b-versatile) with the judgment text chunks.
# Goal: extract structured CaseExtraction object.
# ---------------------------------------------------------------------------

def extraction_prompt(
    identity_text:   str,
    directions_text: str,
    used_fallback:   bool = False,
) -> str:
    """
    Builds the prompt for Phase 1 — case data extraction.

    identity_text   = header chunk (case number, parties, date, court)
    directions_text = directions/order chunk (the critical section)
    used_fallback   = True if section headers weren't detected in PDF
    """

    fallback_warning = (
        "\nWARNING: Formal section headers were not detected in this document. "
        "The directions section below is estimated from the document tail. "
        "Search carefully for the actual court order — it may start with phrases like "
        "'In view of the above', 'Accordingly', 'It is ordered', or 'The petition is allowed/dismissed'.\n"
        if used_fallback else ""
    )

    return f"""You are a senior legal analyst specializing in Indian court judgments.
Your task is to extract structured information from a court judgment for government compliance tracking.

CRITICAL RULES:
1. For EVERY field, provide the exact sentence(s) from the document as source_sentence
   IMPORTANT: source_sentence must be 1-2 sentences only (max 150 chars). Do NOT copy large blocks.
2. For page_ref, use the --- PAGE N --- markers in the text. Format: "PAGE 8" or "PAGE 8-9"
3. confidence: 1.0 = explicitly stated, 0.8 = clearly inferred, 0.6 = uncertain
4. For computed dates (e.g. "within 2 months of 06.11.2024"):
   - Set is_inferred = true
   - Set inference_basis = "Order date 06.11.2024 + 2 months = 06.01.2025"
   - Compute the actual calendar date correctly
5. responsible_department: Infer from the respondent and subject matter
   Examples: GST matter + State of UP → "Commercial Tax Department, Govt of UP"
             Service matter + Central Govt → "Ministry of [relevant ministry]"
6. summary: Plain English, no legal jargon, 2-3 sentences max
   Written for a non-lawyer IAS officer reading this at 8am
7. Extract ALL directives — judgments often have 2-5 separate orders
8. Extract ALL timelines — both past events and future deadlines
9. DO NOT REPEAT yourself. Output each value once. No looping, no duplicate sentences.
{fallback_warning}

=== CASE HEADER ===
(Contains: case number, court, parties, date of order, counsel names)

{identity_text}

=== DIRECTIONS / ORDER SECTION ===
(Contains: court's actual orders, compliance requirements, timelines, limitation periods)

{directions_text}

Fill the schema. Be concise. Each field: one clean value, one short source quote, done.
"""


# ---------------------------------------------------------------------------
# Action plan prompt
# Sent to Groq (llama-3.3-70b-versatile) with validated CaseExtraction JSON.
# Goal: generate structured ActionPlan object.
# ---------------------------------------------------------------------------

def action_plan_prompt(extraction_json: str) -> str:
    """
    Builds the prompt for Phase 2 — action plan generation.

    extraction_json = CaseExtraction.model_dump_json(indent=2)
    Takes validated extracted data as input, NOT raw PDF text.
    This grounds the action plan in verified information.
    """

    today = date.today().isoformat()

    return f"""You are a legal compliance officer at an Indian state government department.
A court has passed a judgment affecting your department. 
Structured data has been extracted from the judgment (already validated by a legal analyst).

Today's date: {today}

=== EXTRACTED JUDGMENT DATA ===

{extraction_json}

=== YOUR TASK ===

Generate a structured action plan for the responsible government officer.
This officer is senior (IAS/IPS level) but may not have a legal background.
They need to know: What do I do? By when? Who else is involved? Should we appeal?

INSTRUCTIONS:

action_required — choose ONE:
  COMPLY              → Court ordered something, government must do it, no grounds to appeal
  APPEAL              → Strong grounds to challenge, compliance may be stayed pending appeal
  COMPLY_AND_CONSIDER_APPEAL → Must comply with deadline AND separately evaluate appeal
  NO_ACTION           → Judgment doesn't require government action (rare)

urgency_level — based on primary_deadline from today ({today}):
  HIGH   → deadline within 30 days OR immediate stay/payment required
  MEDIUM → deadline 31-90 days away
  LOW    → deadline > 90 days OR no specific deadline

primary_deadline — the single most important date. YYYY-MM-DD format.
  If multiple deadlines exist, pick the earliest one.

days_remaining — integer. Compute: primary_deadline minus today ({today}).
  Negative number = already overdue. This is critical for dashboard urgency sorting.

recommended_steps — 3 to 6 concrete steps. Each step must answer:
  WHO does WHAT by WHEN.
  BAD:  "Take necessary action as per court order"
  GOOD: "Director, Commercial Tax Division to pass fresh GST penalty order 
         under Section 129(1)(a) within 2 months (by 06.01.2025)"

appeal_analysis:
  recommended   → true only if there are genuine legal grounds
  strength      → "strong" / "moderate" / "weak" / "none"
  reason        → SPECIFIC legal reason (not "the order seems wrong")
                  e.g. "HC found factual error in authority's reliance on unverified 
                  Delhi CGST communication — grounds for SLP exist but are weak"
  limitation_days → 90 for HC→SC (Special Leave Petition), 30 for lower→HC
  limitation_date → Compute from date_of_order. YYYY-MM-DD.

responsible_department — Full department name.
  e.g. "Commercial Tax Department, Government of Uttar Pradesh"
  e.g. "Public Works Department, Municipal Corporation of Delhi"

summary_for_officer — ONE paragraph, plain language.
  Start with: "This judgment requires..." or "You must..."
  Include: what to do, by when, and whether appeal is worth considering.
  End with the single most important deadline.
  No Latin, no legal citations, no jargon.
"""


# ---------------------------------------------------------------------------
# Regeneration prompt
# Used when reviewer edits extraction fields and action plan needs updating.
# ---------------------------------------------------------------------------

def regeneration_prompt(updated_extraction_json: str) -> str:
    """
    Builds the prompt for regenerating action plan after reviewer edits.
    Same as action_plan_prompt but with a note that data was human-corrected.
    """
    today = date.today().isoformat()

    return f"""You are a legal compliance officer at an Indian state government department.

A human legal reviewer has verified and corrected the extracted judgment data below.
This data is now authoritative — generate a fresh action plan based on it.

Today's date: {today}

=== HUMAN-VERIFIED JUDGMENT DATA ===

{updated_extraction_json}

Generate the action plan following the same rules as before.
Pay special attention to any corrected dates — recalculate all deadlines 
from the verified date_of_order.
"""
