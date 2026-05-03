"""
chunker.py — Section-based PDF splitting
Splits a PDFContent object into named legal sections so llm.py can send
the RIGHT section to the RIGHT prompt instead of the whole document.

Why this matters:
  - Court directives are ALWAYS near the end (page 8-12 of a 15-page judgment)
  - Your old project truncated at 15k chars — never even reached the directions
  - This file finds the directions section no matter what page it starts on

Strategy:
  1. Scan each page for known section header keywords
  2. Build a map: section_name → [start_page, end_page]
  3. Return a DocumentChunks object with named text chunks
  4. llm.py uses DocumentChunks.directions for the extraction prompt

Two detection methods (applied in order):
  A. Keyword matching — fast, works on most High Court judgments
  B. Positional fallback — if no headers found, split by page thirds
     (header=first 20%, body=middle 60%, tail=last 20%)
     The tail almost always contains the directions and limitation period.
"""

import re
import logging
from dataclasses import dataclass, field

from pdf_utils import PDFContent, PageText

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Section header keywords
# Tuned for Indian High Court and Supreme Court judgment language.
# Order matters — more specific patterns first.
# ---------------------------------------------------------------------------

SECTION_PATTERNS: dict[str, list[str]] = {
    "directions": [
        r"\bORDER\b",
        r"\bDIRECTIONS?\b",
        r"\bJUDGMENT\s+AND\s+ORDER\b",
        r"\bIT\s+IS\s+(HEREBY\s+)?ORDERED\b",
        r"\bTHIS\s+COURT\s+(HEREBY\s+)?DIRECTS?\b",
        r"\bIN\s+VIEW\s+OF\s+(THE\s+)?ABOVE",
        r"\bIN\s+THE\s+RESULT\b",
        r"\bFOR\s+THE\s+(ABOVE\s+)?REASONS?\b",
        r"\bACCORDINGLY\b",
        r"\bDISPOSED?\s+OF\b",
    ],
    "limitation": [
        r"\bLIMITATION\s+PERIOD\b",
        r"\bAPPEAL\s+(MUST|SHALL|SHOULD)\s+BE\s+FILED\b",
        r"\bWITHIN\s+\d+\s+DAYS?\b",
        r"\bWITHIN\s+\d+\s+WEEKS?\b",
        r"\bWITHIN\s+\d+\s+MONTHS?\b",
        r"\bLIMITATION\b",
    ],
    "facts": [
        r"\bFACTS?\s+OF\s+THE\s+CASE\b",
        r"\bBRIEF\s+FACTS?\b",
        r"\bBACKGROUND\b",
        r"\bFACTUAL\s+BACKGROUND\b",
        r"\bFACTS?\s+AND\s+CIRCUMSTANCES?\b",
        r"\bBRIEF\s+BACKGROUND\b",
    ],
    "issues": [
        r"\bISSUES?\s+(INVOLVED|FOR\s+CONSIDERATION|RAISED)\b",
        r"\bQUESTIONS?\s+OF\s+LAW\b",
        r"\bPOINTS?\s+FOR\s+DETERMINATION\b",
    ],
    "analysis": [
        r"\bANALYSIS\b",
        r"\bDISCUSSION\b",
        r"\bCONSIDERATION\b",
        r"\bFINDINGS?\b",
        r"\bREASONS?\s+AND\s+FINDINGS?\b",
        r"\bHELD\b",
    ],
}

# These sections are compiled once at module load for speed
_COMPILED: dict[str, list[re.Pattern]] = {
    section: [re.compile(p, re.IGNORECASE | re.MULTILINE)
              for p in patterns]
    for section, patterns in SECTION_PATTERNS.items()
}


# ---------------------------------------------------------------------------
# Output data structure
# ---------------------------------------------------------------------------

@dataclass
class DocumentChunks:
    """
    Named text sections extracted from a judgment PDF.
    Each chunk is a string with --- PAGE N --- markers preserved.
    A chunk is empty string "" if that section wasn't detected.

    Usage in llm.py:
        chunks = chunk_document(pdf_content)
        # Send only the directions section for directive extraction
        directives = extract_directives(chunks.directions or chunks.tail)
        # Send header for case identity
        identity = extract_identity(chunks.header)
    """
    header:     str = ""   # Case number, parties, court, date — usually page 1-2
    facts:      str = ""   # Background facts
    issues:     str = ""   # Legal issues framed
    analysis:   str = ""   # Court's reasoning
    directions: str = ""   # THE CRITICAL SECTION — actual orders/directives
    limitation: str = ""   # Appeal window, compliance deadlines
    tail:       str = ""   # Last 25% of document — fallback if no section detected
    full:       str = ""   # Entire document with page markers (for short PDFs)

    # Metadata
    total_pages:        int  = 0
    sections_detected:  list[str] = field(default_factory=list)
    used_fallback:      bool = False

    def best_directions_chunk(self) -> str:
        """
        Returns the best available chunk for directive extraction.
        Priority: directions → limitation+directions combined → tail → full
        """
        if self.directions:
            # Include limitation section too if it exists (often same pages)
            if self.limitation and self.limitation != self.directions:
                return self.directions + "\n\n" + self.limitation
            return self.directions
        if self.tail:
            logger.warning("No directions section detected — using document tail")
            return self.tail
        logger.warning("No directions or tail — using full document")
        return self.full

    def best_identity_chunk(self) -> str:
        """Returns the best chunk for case identity extraction (header or first 3 pages)."""
        return self.header if self.header else self.full


# ---------------------------------------------------------------------------
# Main function
# ---------------------------------------------------------------------------

def chunk_document(pdf_content: PDFContent) -> DocumentChunks:
    """
    Split a PDFContent into named legal sections.
    Returns DocumentChunks — use .best_directions_chunk() in llm.py.
    """
    pages      = pdf_content.pages
    total      = pdf_content.total_pages
    chunks     = DocumentChunks(total_pages=total)
    chunks.full = pdf_content.full_text()

    if total == 0:
        return chunks

    # Always store the full document for very short PDFs (≤ 4 pages)
    if total <= 4:
        chunks.header     = pdf_content.page_range_text(1, total)
        chunks.directions = chunks.full
        chunks.tail       = chunks.full
        chunks.sections_detected = ["full_document"]
        return chunks

    # --- Step 1: Detect section boundaries ---
    section_start_pages = _detect_sections(pages)

    if section_start_pages:
        chunks = _build_chunks_from_sections(
            section_start_pages, pdf_content, chunks
        )
    else:
        # --- Step 2: Positional fallback ---
        logger.info(
            f"{pdf_content.filename}: No section headers found — "
            "using positional fallback (tail = last 25%)"
        )
        chunks = _positional_fallback(pdf_content, chunks)

    return chunks


# ---------------------------------------------------------------------------
# Section detection
# ---------------------------------------------------------------------------

def _detect_sections(pages: list[PageText]) -> dict[str, int]:
    """
    Scan pages for section header keywords.
    Returns dict mapping section_name → first page number where it starts.
    e.g. {"directions": 8, "facts": 3, "limitation": 11}
    """
    found: dict[str, int] = {}

    for page in pages:
        text = page.text
        for section, patterns in _COMPILED.items():
            if section in found:
                continue  # Already found this section — keep the first occurrence
            for pattern in patterns:
                if pattern.search(text):
                    found[section] = page.page_number
                    logger.info(
                        f"Section '{section}' detected on page {page.page_number}"
                    )
                    break

    return found


def _build_chunks_from_sections(
    section_starts: dict[str, int],
    pdf_content:    PDFContent,
    chunks:         DocumentChunks,
) -> DocumentChunks:
    """
    Given section start pages, extract text ranges for each section.
    Each section runs from its start page to the next section's start page - 1.
    """
    total = pdf_content.total_pages

    # Sort sections by page number so we can compute end pages
    ordered = sorted(section_starts.items(), key=lambda x: x[1])

    # Header = everything before the first detected section (or first 2 pages)
    first_section_page = ordered[0][1] if ordered else total
    header_end = min(first_section_page - 1, 2)
    if header_end >= 1:
        chunks.header = pdf_content.page_range_text(1, header_end)

    # Extract each section's text
    for i, (section_name, start_page) in enumerate(ordered):
        # This section ends where the next one begins (or at the last page)
        if i + 1 < len(ordered):
            end_page = ordered[i + 1][1] - 1
        else:
            end_page = total

        text = pdf_content.page_range_text(start_page, end_page)

        if section_name == "directions":
            chunks.directions = text
        elif section_name == "facts":
            chunks.facts = text
        elif section_name == "issues":
            chunks.issues = text
        elif section_name == "analysis":
            chunks.analysis = text
        elif section_name == "limitation":
            chunks.limitation = text

    chunks.sections_detected = list(section_starts.keys())
    chunks.used_fallback      = False

    # Always compute tail regardless (used as fallback in best_directions_chunk)
    tail_start = max(1, int(total * 0.75))
    chunks.tail = pdf_content.page_range_text(tail_start, total)

    return chunks


def _positional_fallback(
    pdf_content: PDFContent,
    chunks:      DocumentChunks,
) -> DocumentChunks:
    """
    No section headers found — split by position.
    Header  = first 20% of pages
    Body    = middle 55% of pages
    Tail    = last 25% of pages  ← directions are almost always here
    """
    total = pdf_content.total_pages

    header_end   = max(1, int(total * 0.20))
    tail_start   = max(header_end + 1, int(total * 0.75))

    chunks.header     = pdf_content.page_range_text(1, header_end)
    chunks.facts      = pdf_content.page_range_text(header_end + 1, tail_start - 1)
    chunks.tail       = pdf_content.page_range_text(tail_start, total)
    chunks.directions = chunks.tail  # Best guess for directives
    chunks.used_fallback      = True
    chunks.sections_detected  = ["positional_fallback"]

    logger.info(
        f"Positional fallback: header=1-{header_end}, "
        f"body={header_end+1}-{tail_start-1}, tail={tail_start}-{total}"
    )
    return chunks


# ---------------------------------------------------------------------------
# Utility — find page ref for a sentence (used by llm.py to validate page_refs)
# ---------------------------------------------------------------------------

def find_page_for_sentence(sentence: str, pdf_content: PDFContent) -> str:
    """
    Given a sentence returned by the LLM, find which page it appears on.
    Returns "PAGE N" string matching the page_ref format used in models.py.
    Falls back to "PAGE UNKNOWN" if not found.
    """
    needle = " ".join(sentence.lower().split())[:80]  # First 80 chars, normalised

    for page in pdf_content.pages:
        haystack = " ".join(page.text.lower().split())
        if needle in haystack:
            return f"PAGE {page.page_number}"

    return "PAGE UNKNOWN"
