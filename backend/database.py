# database.py — all sqlite reads and writes live here
# i'm using sqlmodel which combines sqlalchemy + pydantic — cleaner than raw sql
# only APPROVED cases ever reach the dashboard — pending and rejected are filtered out everywhere

import json
from datetime import datetime
from typing import Optional

from sqlmodel import Field, Session, SQLModel, create_engine, select

from models import (
    ActionPlan, CaseExtraction, DashboardCase, FieldEdit,
    UrgencyLevel, ActionType, VerificationRecord, VerificationStatus,
)

DATABASE_URL = "sqlite:///./judgments.db"
engine = create_engine(DATABASE_URL, echo=False)


class CaseRecord(SQLModel, table=True):
    # this is the db table — i flatten the nested pydantic models into columns for fast queries
    # the full extraction + action plan are stored as json blobs so nothing gets lost
    id:                     Optional[int] = Field(default=None, primary_key=True)
    pdf_filename:           str
    extracted_at:           datetime      = Field(default_factory=datetime.utcnow)
    extraction_json:        str           # full CaseExtraction as json string
    action_plan_json:       str           # full ActionPlan as json string
    status:                 str           = VerificationStatus.PENDING
    reviewed_by:            Optional[str] = None
    reviewed_at:            Optional[datetime] = None
    reviewer_notes:         Optional[str] = None
    edits_json:             str           = "[]"
    # these are flattened from the json blobs so the dashboard can query without deserializing
    case_number:            str           = ""
    case_title:             str           = ""
    court_name:             str           = ""
    date_of_order:          str           = ""
    responsible_department: str           = ""
    subject_matter:         Optional[str] = None
    urgency_level:          str           = UrgencyLevel.MEDIUM
    action_required:        str           = ActionType.NO_ACTION
    primary_deadline:       Optional[str] = None
    days_remaining:         Optional[int] = None
    summary_for_officer:    str           = ""
    appeal_recommended:     bool          = False
    appeal_deadline:        Optional[str] = None
    llm_provider:           str           = "Unknown"


def create_db():
    # creates the table if it doesn't exist — called once on startup
    SQLModel.metadata.create_all(engine)


def save_case(record: VerificationRecord) -> int:
    # saves a new case as PENDING after llm extraction
    # returns the db id so the frontend can redirect to the review panel
    ext  = record.extraction
    plan = record.action_plan

    row = CaseRecord(
        pdf_filename           = record.pdf_filename,
        extracted_at           = record.extracted_at,
        extraction_json        = ext.model_dump_json(),
        action_plan_json       = plan.model_dump_json(),
        status                 = VerificationStatus.PENDING,
        edits_json             = "[]",
        # flatten the important fields for fast dashboard queries
        case_number            = ext.case_number.value,
        case_title             = ext.case_title.value,
        court_name             = ext.court_name.value,
        date_of_order          = ext.date_of_order.value,
        responsible_department = plan.responsible_department,
        subject_matter         = ext.subject_matter,
        urgency_level          = plan.urgency_level,
        action_required        = plan.action_required,
        primary_deadline       = plan.primary_deadline,
        days_remaining         = plan.days_remaining,
        summary_for_officer    = plan.summary_for_officer,
        appeal_recommended     = plan.appeal_analysis.recommended,
        appeal_deadline        = plan.appeal_analysis.limitation_date,
        llm_provider           = record.llm_provider,
    )
    with Session(engine) as session:
        session.add(row)
        session.commit()
        session.refresh(row)
        return row.id


# note: edits=[] as a default arg is a python mutable default bug — always pass None + fallback inside
def approve_case(case_id, reviewed_by, notes=None, edits=None, updated_plan=None) -> bool:
    edits = edits or []
    with Session(engine) as session:
        row = session.get(CaseRecord, case_id)
        if not row:
            return False
        row.status         = VerificationStatus.APPROVED
        row.reviewed_by    = reviewed_by
        row.reviewed_at    = datetime.utcnow()
        row.reviewer_notes = notes
        row.edits_json     = json.dumps([e.model_dump() for e in edits], default=str)
        if updated_plan:
            # reviewer corrected fields — update the flattened columns too so dashboard stays fresh
            row.action_plan_json       = updated_plan.model_dump_json()
            row.urgency_level          = updated_plan.urgency_level
            row.action_required        = updated_plan.action_required
            row.primary_deadline       = updated_plan.primary_deadline
            row.days_remaining         = updated_plan.days_remaining
            row.summary_for_officer    = updated_plan.summary_for_officer
            row.appeal_recommended     = updated_plan.appeal_analysis.recommended
            row.appeal_deadline        = updated_plan.appeal_analysis.limitation_date
            row.responsible_department = updated_plan.responsible_department
        session.add(row)
        session.commit()
        return True


def reject_case(case_id, reviewed_by, notes=None) -> bool:
    # rejected cases stay in the db but never appear on the dashboard
    with Session(engine) as session:
        row = session.get(CaseRecord, case_id)
        if not row:
            return False
        row.status         = VerificationStatus.REJECTED
        row.reviewed_by    = reviewed_by
        row.reviewed_at    = datetime.utcnow()
        row.reviewer_notes = notes
        session.add(row)
        session.commit()
        return True


def get_pending_cases():
    # returns lightweight rows — no json blobs, just the columns for the review queue sidebar
    with Session(engine) as session:
        return session.exec(
            select(CaseRecord).where(CaseRecord.status == VerificationStatus.PENDING)
        ).all()


def get_case_by_id(case_id):
    with Session(engine) as session:
        return session.get(CaseRecord, case_id)


def get_full_record(case_id) -> Optional[VerificationRecord]:
    # deserializes the json blobs back into pydantic models for the review panel
    # this is the only place we parse the full extraction + action plan from storage
    with Session(engine) as session:
        row = session.get(CaseRecord, case_id)
        if not row:
            return None
        extraction = CaseExtraction.model_validate_json(row.extraction_json)
        plan       = ActionPlan.model_validate_json(row.action_plan_json)
        edits      = [FieldEdit(**e) for e in json.loads(row.edits_json)]
        return VerificationRecord(
            id             = row.id,
            pdf_filename   = row.pdf_filename,
            extracted_at   = row.extracted_at,
            extraction     = extraction,
            action_plan    = plan,
            status         = row.status,
            reviewed_by    = row.reviewed_by,
            reviewed_at    = row.reviewed_at,
            reviewer_notes = row.reviewer_notes,
            edits_made     = edits,
            llm_provider   = getattr(row, "llm_provider", "Unknown"),
        )


def get_dashboard_cases(department=None):
    # only returns approved cases, sorted by days_remaining (most urgent first)
    # optionally filtered by department name for the dropdown
    with Session(engine) as session:
        query = select(CaseRecord).where(CaseRecord.status == VerificationStatus.APPROVED)
        if department:
            query = query.where(CaseRecord.responsible_department == department)
        rows = session.exec(query.order_by(CaseRecord.days_remaining)).all()
    return [
        DashboardCase(
            id                     = row.id,
            case_number            = row.case_number,
            case_title             = row.case_title,
            court_name             = row.court_name,
            date_of_order          = row.date_of_order,
            responsible_department = row.responsible_department,
            subject_matter         = row.subject_matter,
            urgency_level          = row.urgency_level,
            action_required        = row.action_required,
            primary_deadline       = row.primary_deadline,
            days_remaining         = row.days_remaining,
            summary_for_officer    = row.summary_for_officer,
            appeal_recommended     = row.appeal_recommended,
            appeal_deadline        = row.appeal_deadline,
            reviewed_by            = row.reviewed_by,
            reviewed_at            = row.reviewed_at,
            pdf_filename           = row.pdf_filename,
            llm_provider           = getattr(row, "llm_provider", "Unknown"),
        )
        for row in rows
    ]


def get_all_departments():
    # unique department names for the filter dropdown in the dashboard
    with Session(engine) as session:
        rows = session.exec(
            select(CaseRecord.responsible_department)
            .where(CaseRecord.status == VerificationStatus.APPROVED)
            .distinct()
        ).all()
    return [r for r in rows if r]
