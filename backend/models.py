# models.py — every data shape in the app lives here
# the key design decision: every extracted field carries value + source_sentence + page_ref + confidence
# this is what makes the review ui actually trustworthy — the reviewer can trace every ai decision
# back to the exact sentence in the pdf. no blind trust.

from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum
from datetime import date, datetime


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class UrgencyLevel(str, Enum):
    HIGH   = "HIGH"
    MEDIUM = "MEDIUM"
    LOW    = "LOW"

class VerificationStatus(str, Enum):
    PENDING  = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    # note: EDITED was here but never used anywhere — removed to avoid confusion

class ActionType(str, Enum):
    COMPLY         = "COMPLY"
    APPEAL         = "APPEAL"
    COMPLY_APPEAL  = "COMPLY_AND_CONSIDER_APPEAL"
    NO_ACTION      = "NO_ACTION"


# traced field — the core building block for everything we extract
# every extracted value must have: where it came from (source_sentence), which page (page_ref),
# and how confident the llm is (confidence 0.0-1.0)
# without this pattern, the reviewer is just blindly trusting the ai

class TracedStr(BaseModel):
    """A string value with full traceability back to the source PDF."""
    value:           str
    source_sentence: str   = Field(description="Exact sentence(s) from the PDF that produced this value")
    page_ref:        str   = Field(description="e.g. 'PAGE 8' or 'PAGE 8-9'")
    confidence:      float = Field(ge=0.0, le=1.0)

class TracedBool(BaseModel):
    """A boolean value with full traceability."""
    value:           bool
    source_sentence: str
    page_ref:        str
    confidence:      float = Field(ge=0.0, le=1.0)

class TracedDate(BaseModel):
    """A date value — explicit or inferred — with traceability."""
    value:            str            = Field(description="ISO date string YYYY-MM-DD or human string")
    source_sentence:  str
    page_ref:         str
    confidence:       float          = Field(ge=0.0, le=1.0)
    is_inferred:      bool           = Field(
        description="True if this date was computed (e.g. order_date + 2 months), "
                    "False if explicitly stated in the judgment"
    )
    inference_basis:  Optional[str]  = Field(
        default=None,
        description="If is_inferred=True, explain the computation. "
                    "e.g. 'Order date 06.11.2024 + 2 months = 06.01.2025'"
    )


# ---------------------------------------------------------------------------
# Sub-models
# ---------------------------------------------------------------------------

class Party(BaseModel):
    """A party to the case — petitioner or respondent."""
    name:            str
    counsel:         Optional[str]  = None
    source_sentence: str
    page_ref:        str

class KeyDirection(BaseModel):
    """
    A single directive/order issued by the court.
    This is the most important extraction — what the court actually ordered.
    """
    text:            str   = Field(description="Plain-English summary of this directive")
    source_sentence: str   = Field(description="Exact quoted sentence(s) from the judgment")
    page_ref:        str
    confidence:      float = Field(ge=0.0, le=1.0)
    directive_type:  str   = Field(
        description="e.g. 'reinstatement', 'payment', 'fresh order', 'compliance report', 'stay'"
    )

class Timeline(BaseModel):
    """
    A date or deadline — either explicitly stated or inferred from the judgment text.
    Inferred deadlines (order_date + N months/days) are the most critical for government officers.
    """
    event:            str           = Field(description="What happens on this date")
    date_value:       str           = Field(description="YYYY-MM-DD or descriptive string")
    source_sentence:  str
    page_ref:         str
    is_inferred:      bool
    inference_basis:  Optional[str] = None
    is_deadline:      bool          = Field(
        description="True if missing this date has legal consequences (appeal window, compliance period)"
    )

class AppealAnalysis(BaseModel):
    """
    AI analysis of whether the government should consider filing an appeal.
    Must include a reason — not just yes/no.
    """
    recommended:     bool
    strength:        str   = Field(description="'strong' | 'moderate' | 'weak' | 'none'")
    reason:          str   = Field(description="Why appeal is/isn't recommended")
    limitation_days: Optional[int]  = Field(
        default=None,
        description="Days from judgment date within which appeal must be filed (typically 90)"
    )
    limitation_date: Optional[str]  = Field(
        default=None,
        description="Computed deadline date for filing appeal — YYYY-MM-DD"
    )
    source_sentence: str
    page_ref:        str


# ---------------------------------------------------------------------------
# Phase 1 output: CaseExtraction
# What the LLM extracts from the PDF text.
# ---------------------------------------------------------------------------

class CaseExtraction(BaseModel):
    """
    Structured extraction from a court judgment PDF.
    Returned by llm.py after the first Instructor call.
    Every field has source_sentence + page_ref so the UI can highlight it.
    """

    # --- Identity ---
    case_number:       TracedStr
    neutral_citation:  Optional[TracedStr]  = None
    case_title:        TracedStr
    court_name:        TracedStr
    date_of_order:     TracedDate

    # --- Parties ---
    petitioner:        Party
    respondent:        Party

    # --- The actual content ---
    key_directions:    list[KeyDirection]   = Field(
        description="All directives/orders issued by the court. Usually 1-5 items. "
                    "This is the most critical section."
    )
    timelines:         list[Timeline]       = Field(
        description="All dates — past events, order date, compliance deadlines, "
                    "appeal windows. Include inferred deadlines with is_inferred=True."
    )

    # --- High-level flags ---
    compliance_required: TracedBool         = Field(
        description="Does the judgment require the government to DO something?"
    )
    appeal_possible:     TracedBool         = Field(
        description="Is there any ground to challenge this judgment in a higher court?"
    )

    # --- Summary ---
    summary:           str                  = Field(
        description="2-3 sentence plain-English summary of the entire judgment. "
                    "No legal jargon. Written for a non-lawyer government officer."
    )

    # --- Metadata ---
    responsible_department: Optional[TracedStr] = Field(
        default=None,
        description="Which government department/division must act. "
                    "Infer from context if not explicitly stated."
    )
    subject_matter:    Optional[str]        = Field(
        default=None,
        description="Area of law: 'GST', 'Service matters', 'Land acquisition', 'Public works', etc."
    )


# ---------------------------------------------------------------------------
# Phase 2 output: ActionPlan
# Generated from CaseExtraction — structured steps for the officer.
# ---------------------------------------------------------------------------

class ActionStep(BaseModel):
    """A single concrete step the government officer must take."""
    step_number:  int
    description:  str    = Field(description="Concrete, specific action. No vague 'take action' steps.")
    deadline:     Optional[str] = Field(default=None, description="YYYY-MM-DD if this step has a deadline")
    department:   Optional[str] = Field(default=None, description="Which dept/team owns this step")

class ActionPlan(BaseModel):
    """
    AI-generated action plan based on CaseExtraction.
    This is what gets shown to the officer after extraction.
    """
    action_required:    ActionType
    urgency_level:      UrgencyLevel
    primary_deadline:   Optional[str]       = Field(
        default=None,
        description="The most critical deadline. YYYY-MM-DD."
    )
    days_remaining:     Optional[int]       = Field(
        default=None,
        description="Days from today to primary_deadline. Negative = already overdue."
    )
    recommended_steps:  list[ActionStep]
    appeal_analysis:    AppealAnalysis
    responsible_department: str
    summary_for_officer: str               = Field(
        description="One paragraph. Plain language. What does this officer need to do and by when?"
    )


# ---------------------------------------------------------------------------
# Phase 3: VerificationRecord
# What the human reviewer produces — the approved/edited version.
# Only VerificationRecord objects with status=APPROVED reach the dashboard.
# ---------------------------------------------------------------------------

class FieldEdit(BaseModel):
    """Log of a single field that the reviewer changed."""
    field_name:    str
    original:      str
    edited:        str
    edited_at:     datetime

class VerificationRecord(BaseModel):
    """
    The output of the human review step.
    Wraps CaseExtraction + ActionPlan with reviewer decisions.
    Only records with status=APPROVED are shown on the dashboard.
    """
    # --- Source ---
    pdf_filename:      str
    extracted_at:      datetime

    # --- Content ---
    extraction:        CaseExtraction
    action_plan:       ActionPlan

    # --- Review ---
    status:            VerificationStatus = VerificationStatus.PENDING
    reviewed_by:       Optional[str]      = None
    reviewed_at:       Optional[datetime] = None
    reviewer_notes:    Optional[str]      = None
    edits_made:        list[FieldEdit]    = []

    # --- DB identity ---
    id:                Optional[int]      = None


# ---------------------------------------------------------------------------
# Dashboard view — flattened read model for the dashboard UI
# Only approved records are ever serialized to this.
# ---------------------------------------------------------------------------

class DashboardCase(BaseModel):
    """
    Flattened, display-ready version of an approved VerificationRecord.
    No nested models — everything the dashboard card needs is at the top level.
    """
    id:                  int
    case_number:         str
    case_title:          str
    court_name:          str
    date_of_order:       str
    responsible_department: str
    subject_matter:      Optional[str]
    urgency_level:       UrgencyLevel
    action_required:     ActionType
    primary_deadline:    Optional[str]
    days_remaining:      Optional[int]
    summary_for_officer: str
    appeal_recommended:  bool
    appeal_deadline:     Optional[str]
    reviewed_by:         Optional[str]
    reviewed_at:         Optional[datetime]
    pdf_filename:        str
