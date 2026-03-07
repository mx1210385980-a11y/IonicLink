import os
import fitz  # PyMuPDF
from typing import List, Optional

import base64
import io
from PIL import Image, ImageDraw

# Figure/table detection keywords (case-insensitive)
_FIGURE_KEYWORDS = {'fig.', 'figure', 'table', 'schematic', 'stribeck', 'chart', 'plot', 'graph', 'image',
                    'photo', 'microscop', 'afm', 'sem', 'xps', 'spectrum', 'curve', 'tribometer'}
_TABLE_KEYWORDS  = {'table', 'tab.'}

# Min fraction of page area that image blocks must cover to count as a "visual page"
_IMAGE_AREA_THRESHOLD = 0.03  # 3% of page area


def classify_pdf_pages(pdf_path: str) -> dict:
    """
    Classify each page of a PDF as either 'visual' (contains figures/tables)
    or 'text_only' (pure prose).  Returns per-page extracted text too.

    Strategy (each flag is OR-combined):
      1. Page contains embedded bitmap/image blocks that cover ≥3% of page area
      2. Full-page text contains figure/table keywords in the *first 400 chars*
         of any block (captures captions near figures)
      3. Page has very little text (< 100 chars) but is non-blank (probably
         a full-page figure scan)

    Args:
        pdf_path: Path to the PDF file on disk.

    Returns:
        {
          "visual_pages":   [0-indexed page numbers that need vision model],
          "text_pages":     [0-indexed page numbers that are text-only],
          "page_texts":     {page_idx: "extracted text"},
        }
    """
    visual_pages = []
    text_pages   = []
    page_texts   = {}

    if not os.path.exists(pdf_path):
        return {"visual_pages": [], "text_pages": [], "page_texts": {}}

    try:
        doc = fitz.open(pdf_path)
        for page_idx, page in enumerate(doc):
            page_area = page.rect.width * page.rect.height
            if page_area == 0:
                continue

            # ── 1. Detect embedded image blocks ──────────────────────────
            image_area = 0.0
            for block in page.get_text("dict")["blocks"]:
                if block.get("type") == 1:  # type 1 = image
                    r = fitz.Rect(block["bbox"])
                    image_area += r.get_area()
            has_large_image = (image_area / page_area) >= _IMAGE_AREA_THRESHOLD

            # ── 2. Keyword scan in text blocks ────────────────────────────
            full_text = page.get_text()
            text_lower = full_text.lower()
            has_figure_keyword = any(kw in text_lower for kw in _FIGURE_KEYWORDS)

            # ── 3. Very-thin-text page (likely full-page figure) ──────────
            is_sparse_text = 0 < len(full_text.strip()) < 100

            # ── Decision ──────────────────────────────────────────────────
            is_visual = has_large_image or has_figure_keyword or is_sparse_text
            page_texts[page_idx] = full_text

            if is_visual:
                visual_pages.append(page_idx)
            else:
                text_pages.append(page_idx)

        doc.close()
    except Exception as e:
        print(f"[PDF Classify] Error: {e}")

    print(f"[PDF Classify] {len(visual_pages)} visual pages, {len(text_pages)} text-only pages "
          f"out of {len(visual_pages) + len(text_pages)} total")
    return {
        "visual_pages": visual_pages,
        "text_pages":   text_pages,
        "page_texts":   page_texts,
    }

def process_pdf_to_base64(content: bytes, file_prefix: str = "page") -> List[str]:
    """
    Convert PDF bytes to high-resolution JPEG base64 strings (In-Memory).
    
    Args:
        content: PDF file bytes
        file_prefix: Prefix for image identifiers (unused in base64 mode but kept for compat)
        
    Returns:
        List of base64 data URIs (e.g., "data:image/jpeg;base64,...")
    """
    base64_images = []
    
    # 关键词列表
    KEYWORDS = ['fig', 'figure', 'table', 'schematic', 'friction', 'wear', 'cof', 'stribeck']
    
    try:
        # Open PDF with fitz
        with fitz.open(stream=content, filetype="pdf") as doc:
            total_pages = len(doc)
            print(f"[PDF Vision] Processing {total_pages} pages (In-Memory)")
            
            processed_count = 0
            skipped_count = 0
            
            for i, page in enumerate(doc):
                # Smart Filter Logic
                # 1. Extract text (fast)
                text = page.get_text().lower()
                
                # 2. Check for keywords
                has_keyword = any(k in text for k in KEYWORDS)
                
                # 3. Check if it looks like a pure Reference page
                is_reference_page = False
                lines = text.strip().split('\n')
                if len(lines) > 0:
                    first_lines = "".join(lines[:5]).lower() # Check header area
                    if "references" in first_lines or "bibliography" in first_lines:
                        # If it has "Figure", might be a figure IN references (rare), but usually we can skip
                        # unless it's strictly a references page. 
                        if not any(x in text for x in ['figure', 'fig.', 'schematic']):
                            is_reference_page = True
                
                # Decision
                if i == 0:
                    should_process = True
                elif is_reference_page:
                    should_process = False
                elif has_keyword:
                    should_process = True
                else:
                    should_process = False
                
                if not should_process:
                    skipped_count += 1
                    continue
                
                # Render page at 300 DPI (approx zoom=3.0)
                zoom = 3.0
                mat = fitz.Matrix(zoom, zoom)
                pix = page.get_pixmap(matrix=mat)
                
                # [Filter] Check Dimensions (Skip < 200px)
                if pix.width < 200 or pix.height < 200:
                    print(f"[PDF Vision] Skipped Page {i+1}: Too small ({pix.width}x{pix.height})")
                    skipped_count += 1
                    continue
                
                # [Filter] Check Size (Skip < 5KB) - In Memory Approach
                # Determine buffer size. 
                # Note: pix.tobytes() gives raw pixels, we need encoded size.
                
                # Save as JPEG to memory buffer
                buffer = io.BytesIO()
                # pix.save() writes to file, for memory we need PIL or fitz specific methods
                # fitz pixmap can be saved to memory via `tobytes` with format
                img_data = pix.tobytes(output="jpg", jpg_quality=85)
                
                if len(img_data) < 5 * 1024:  # 5KB
                     print(f"[PDF Vision] Skipped Page {i+1}: Compressed size too small ({len(img_data)} bytes)")
                     skipped_count += 1
                     continue

                # Encode to Base64
                b64_str = base64.b64encode(img_data).decode('utf-8')
                data_uri = f"data:image/jpeg;base64,{b64_str}"
                
                base64_images.append(data_uri)
                processed_count += 1
                
            print(f"[PDF Vision] Optimization: Processed {processed_count}/{total_pages} pages. Skipped {skipped_count}.")
                
        return base64_images
        
    except Exception as e:
        print(f"[PDF Vision] Error processing PDF: {e}")
        return []

def extract_pdf_text_fitz(content: bytes) -> str:
    """
    Extract text from PDF bytes using PyMuPDF (fitz).
    """
    try:
        with fitz.open(stream=content, filetype="pdf") as doc:
            text_parts = [page.get_text() for page in doc]
            return "\n\n".join(text_parts)
    except Exception as e:
        print(f"[PDF Text] Error extracting text: {e}")
        return ""


def crop_region_to_base64(
    pdf_path: str,
    page_num: int,
    bbox: list,
    padding: int = 12,
    dpi: int = 150,
) -> Optional[str]:
    """
    Crop a region from a PDF page and return as base64-encoded PNG string.

    Args:
        pdf_path: Path to the PDF file on disk.
        page_num: 1-based page number.
        bbox: [x0, y0, x1, y1] in PDF points (top-left origin).
        padding: Extra points to add around the bbox for readability.
        dpi: Rendering DPI (higher = sharper but larger).

    Returns:
        Base64 PNG string (without data URI prefix), or None on error.
    """
    if not os.path.exists(pdf_path):
        print(f"[PDF Crop] File not found: {pdf_path}")
        return None

    try:
        doc = fitz.open(pdf_path)
        page_idx = page_num - 1
        if page_idx < 0 or page_idx >= len(doc):
            print(f"[PDF Crop] Invalid page {page_num} (total={len(doc)})")
            doc.close()
            return None

        page = doc[page_idx]
        pw = page.rect.width
        ph = page.rect.height

        x0, y0, x1, y1 = bbox
        clip = fitz.Rect(
            max(0, x0 - padding),
            max(0, y0 - padding),
            min(pw, x1 + padding),
            min(ph, y1 + padding),
        )

        # Ensure the clip has non-zero area
        if clip.width < 5 or clip.height < 5:
            clip = fitz.Rect(max(0, x0 - 40), max(0, y0 - 40), min(pw, x1 + 40), min(ph, y1 + 40))

        scale = dpi / 72.0
        mat = fitz.Matrix(scale, scale)
        pix = page.get_pixmap(matrix=mat, clip=clip)
        doc.close()

        img_bytes = pix.tobytes("png")
        return base64.b64encode(img_bytes).decode("utf-8")

    except Exception as e:
        print(f"[PDF Crop] Error: {e}")
        return None


def render_page_preview_with_bbox_to_base64(
    pdf_path: str,
    page_num: int,
    bbox: Optional[list] = None,
    dpi: int = 120,
    max_width: int = 900,
) -> Optional[str]:
    """
    Render a full PDF page preview and optionally draw a yellow highlighter overlay over bbox.

    Args:
        pdf_path: Path to PDF
        page_num: 1-based page number
        bbox: [x0,y0,x1,y1] in PDF points
        dpi: render DPI for preview image
        max_width: resize width cap for lighter payload

    Returns:
        Base64 PNG string (without data URI prefix), or None on error.
    """
    if not os.path.exists(pdf_path):
        print(f"[PDF Preview] File not found: {pdf_path}")
        return None

    try:
        doc = fitz.open(pdf_path)
        page_idx = page_num - 1
        if page_idx < 0 or page_idx >= len(doc):
            doc.close()
            return None

        page = doc[page_idx]
        scale = dpi / 72.0
        mat = fitz.Matrix(scale, scale)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        doc.close()

        img = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")

        if bbox and len(bbox) == 4:
            x0, y0, x1, y1 = [float(v) for v in bbox]
            # Convert PDF points to rendered pixel coordinates
            rx0, ry0, rx1, ry1 = x0 * scale, y0 * scale, x1 * scale, y1 * scale
            stroke = max(2, int(3 * scale / 1.5))

            # Slightly expand the core highlight region for better readability.
            box_w = max(1.0, rx1 - rx0)
            box_h = max(1.0, ry1 - ry0)
            core_left_pad = max(8.0, box_w * 0.22)
            core_right_pad = max(5.0, box_w * 0.08)
            core_y_pad = max(3.0, box_h * 0.12)

            cx0 = max(0.0, rx0 - core_left_pad)
            cy0 = max(0.0, ry0 - core_y_pad)
            cx1 = min(float(img.width - 1), rx1 + core_right_pad)
            cy1 = min(float(img.height - 1), ry1 + core_y_pad)

            # Single-layer yellow highlighter (no outer box)
            img_rgba = img.convert("RGBA")
            overlay = Image.new("RGBA", img_rgba.size, (0, 0, 0, 0))
            draw_overlay = ImageDraw.Draw(overlay)
            draw_overlay.rectangle(
                [(cx0, cy0), (cx1, cy1)],
                fill=(255, 235, 59, 125),
                outline=(242, 194, 32, 160),
                width=stroke,
            )

            img = Image.alpha_composite(img_rgba, overlay).convert("RGB")

        if max_width and img.width > max_width:
            ratio = max_width / float(img.width)
            new_size = (max_width, int(img.height * ratio))
            img = img.resize(new_size, Image.Resampling.LANCZOS)

        out = io.BytesIO()
        img.save(out, format="PNG", optimize=True)
        return base64.b64encode(out.getvalue()).decode("utf-8")
    except Exception as e:
        print(f"[PDF Preview] Error: {e}")
        return None
