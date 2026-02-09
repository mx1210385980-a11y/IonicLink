import os
import fitz  # PyMuPDF
from typing import List

import base64
import io

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
