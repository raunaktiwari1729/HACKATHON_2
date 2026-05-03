"""
pdf_utils.py — PDF text extraction
Handles both digital PDFs (PyMuPDF) and scanned PDFs (pytesseract OCR).

Strategy:
  1. Try PyMuPDF first — fast, preserves layout, gives exact page numbers
  2. If a page returns < MIN_CHARS characters, it's likely a scanned image
  3. Fall back to pytesseract OCR for those pages only
  4. Return a list of PageText objects — one per page — with page number attached

Why page-by-page instead of one big string?
  Because every extracted field needs a page_ref ("PAGE 8").
  If you join all text first, you lose that information.
"""

import io
import logging
from dataclasses import dataclass

import fitz  # PyMuPDF — import name is fitz, install name is pymupdf

logger = logging.getLogger(__name__)

# A page is considered "scanned" (image-based) if it yields fewer than this
# many characters via PyMuPDF. Typical digital pages yield 500-3000 chars.
MIN_CHARS_DIGITAL = 50


# ---------------------------------------------------------------------------
# Data structure
# ---------------------------------------------------------------------------

@dataclass
class PageText:
    """Text content of a single PDF page."""
    page_number: int    # 1-indexed, matches what you'd cite as "PAGE 8"
    text:        str    # Extracted text, newlines preserved
    is_ocr:      bool   # True if this page came from pytesseract


@dataclass
class PDFContent:
    """Full extraction result for one PDF file."""
    pages:         list[PageText]
    total_pages:   int
    filename:      str
    has_ocr_pages: bool  # True if any page needed OCR

    def full_text(self) -> str:
        """
        All pages joined with page markers.
        Used when you need to send the whole document to the LLM.
        Format: --- PAGE 1 ---\n{text}\n--- PAGE 2 ---\n{text}...
        """
        parts = []
        for page in self.pages:
            parts.append(f"--- PAGE {page.page_number} ---")
            parts.append(page.text.strip())
        return "\n\n".join(parts)

    def page_range_text(self, start: int, end: int) -> str:
        """
        Text from page start to page end (inclusive, 1-indexed).
        Used by chunker.py to extract specific sections.
        """
        parts = []
        for page in self.pages:
            if start <= page.page_number <= end:
                parts.append(f"--- PAGE {page.page_number} ---")
                parts.append(page.text.strip())
        return "\n\n".join(parts)

    def get_page(self, page_number: int) -> str:
        """Text of a single page. Returns empty string if page not found."""
        for page in self.pages:
            if page.page_number == page_number:
                return page.text
        return ""


# ---------------------------------------------------------------------------
# Core extraction
# ---------------------------------------------------------------------------

def extract_pdf(file_bytes: bytes, filename: str = "upload.pdf") -> PDFContent:
    """
    Main entry point. Pass raw PDF bytes (from FastAPI UploadFile.read()).
    Returns PDFContent with per-page text and metadata.

    Usage in main.py:
        contents = await file.read()
        pdf = extract_pdf(contents, file.filename)
    """
    pages: list[PageText] = []
    has_ocr = False

    try:
        doc = fitz.open(stream=file_bytes, filetype="pdf")
    except Exception as e:
        logger.error(f"Failed to open PDF {filename}: {e}")
        raise ValueError(f"Cannot open PDF: {e}")

    total_pages = len(doc)
    logger.info(f"Opened {filename} — {total_pages} pages")

    for page_index in range(total_pages):
        page_num = page_index + 1  # convert to 1-indexed
        fitz_page = doc[page_index]

        # Try digital extraction first
        text = fitz_page.get_text("text")  # type: ignore

        if len(text.strip()) >= MIN_CHARS_DIGITAL:
            # Good digital page
            pages.append(PageText(
                page_number = page_num,
                text        = text,
                is_ocr      = False,
            ))
        else:
            # Likely a scanned page — fall back to OCR
            logger.info(f"Page {page_num} is scanned — running OCR")
            ocr_text = _ocr_page(fitz_page)
            has_ocr = True
            pages.append(PageText(
                page_number = page_num,
                text        = ocr_text,
                is_ocr      = True,
            ))

    doc.close()

    return PDFContent(
        pages         = pages,
        total_pages   = total_pages,
        filename      = filename,
        has_ocr_pages = has_ocr,
    )


# ---------------------------------------------------------------------------
# OCR fallback — pytesseract
# ---------------------------------------------------------------------------

def _ocr_page(fitz_page) -> str:
    """
    Render a single PyMuPDF page to an image, then run Tesseract OCR on it.
    Only called for pages that returned < MIN_CHARS_DIGITAL characters.

    Requires: pytesseract installed + Tesseract binary on PATH
      Linux:   sudo apt-get install tesseract-ocr
      Mac:     brew install tesseract
      Windows: download installer from github.com/UB-Mannheim/tesseract/wiki
    """
    try:
        import pytesseract
        from PIL import Image

        # Render at 2x resolution for better OCR accuracy
        mat  = fitz.Matrix(2.0, 2.0)
        pix  = fitz_page.get_pixmap(matrix=mat)
        img  = Image.open(io.BytesIO(pix.tobytes("png")))

        # lang="eng" — add "hin" or other langs if needed for Hindi text
        text = pytesseract.image_to_string(img, lang="eng")
        return text

    except ImportError:
        logger.warning(
            "pytesseract or Pillow not installed — scanned pages will be empty. "
            "Run: pip install pytesseract pillow"
        )
        return "[SCANNED PAGE — OCR NOT AVAILABLE]"

    except Exception as e:
        logger.error(f"OCR failed: {e}")
        return f"[OCR FAILED: {e}]"


# ---------------------------------------------------------------------------
# Utility — find which page a sentence appears on
# ---------------------------------------------------------------------------

def find_sentence_page(pdf_content: PDFContent, sentence: str) -> str:
    """
    Given a sentence that was extracted by the LLM, find which page it's on.
    Returns "PAGE N" or "PAGE N-M" if it spans pages.

    Used as a fallback if the LLM returns a source_sentence but not a page_ref.
    Search is case-insensitive and strips extra whitespace.
    """
    sentence_clean = " ".join(sentence.lower().split())

    # Try exact match first
    for page in pdf_content.pages:
        page_clean = " ".join(page.text.lower().split())
        if sentence_clean in page_clean:
            return f"PAGE {page.page_number}"

    # Try partial match — use first 60 chars of sentence
    fragment = sentence_clean[:60]
    for page in pdf_content.pages:
        page_clean = " ".join(page.text.lower().split())
        if fragment in page_clean:
            return f"PAGE {page.page_number}"

    return "PAGE UNKNOWN"


# ---------------------------------------------------------------------------
# Utility — get page count without full extraction
# ---------------------------------------------------------------------------

def get_page_count(file_bytes: bytes) -> int:
    """Quick check — how many pages is this PDF? No text extraction."""
    try:
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        count = len(doc)
        doc.close()
        return count
    except Exception:
        return 0
