import base64
import io
import json
import logging
import os
import re
from typing import Any, List, Optional, Union

from PIL import Image

from services.normalization.potential import normalize_potential_text

logger = logging.getLogger(__name__)


def _payload_row_count(parsed: Union[List, dict, None]) -> Optional[int]:
    """Best-effort count of recovered rows, for diagnostics logging."""
    if isinstance(parsed, list):
        return len(parsed)
    if isinstance(parsed, dict):
        for key in ("data", "records", "rows"):
            value = parsed.get(key)
            if isinstance(value, list):
                return len(value)
    return None


_TRAILING_COMMA_RE = re.compile(r",(\s*[}\]])")


def _strip_trailing_commas(text: str) -> str:
    """Remove commas that directly precede a closing brace/bracket."""
    prev = None
    while prev != text:
        prev = text
        text = _TRAILING_COMMA_RE.sub(r"\1", text)
    return text


def _loads_or_none(text: str) -> Union[List, dict, None]:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


def _scan_json(text: str, start: int) -> dict:
    """String-aware scan of the JSON value beginning at ``text[start]``.

    Unlike a naive brace counter, braces/brackets that appear *inside* quoted
    strings are ignored, so an evidence quote like ``"missing } brace"`` no
    longer truncates the payload at the wrong place.

    Returns:
      - complete: structure closed (balanced) before EOF
      - end:      index just past the closing bracket when complete, else len(text)
      - in_string: EOF was reached while still inside a string
      - stack:    closing chars still open at the stop point (LIFO; last = innermost)
      - closes:   (index_after_close, stack_copy) for every close that left at
                  least one container open — i.e. safe truncation cut points
    """
    stack: List[str] = []
    closes: List[tuple] = []
    in_str = False
    esc = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            stack.append("}")
        elif ch == "[":
            stack.append("]")
        elif ch in "}]":
            if stack:
                stack.pop()
            if not stack:
                return {"complete": True, "end": i + 1, "in_string": False, "stack": [], "closes": closes}
            closes.append((i + 1, list(stack)))
    return {"complete": False, "end": len(text), "in_string": in_str, "stack": stack, "closes": closes}


def _recover_json(span: str, scan: dict) -> Union[List, dict, None]:
    """Best-effort parse of a possibly-truncated JSON span."""
    # 1) As-is, then with trailing commas stripped.
    for candidate in (span, _strip_trailing_commas(span)):
        parsed = _loads_or_none(candidate)
        if parsed is not None:
            return parsed

    if scan["complete"]:
        return None

    # 2) Truncated output: rebuild from the last fully-closed sub-structure.
    #    This keeps every complete element (e.g. all finished rows in `data`)
    #    and drops only the partially-written trailing one. Highest index first
    #    so we recover the most rows possible.
    for cut, stack in reversed(scan["closes"]):
        repaired = _strip_trailing_commas(span[:cut].rstrip()) + "".join(reversed(stack))
        parsed = _loads_or_none(repaired)
        if parsed is not None:
            logger.warning(
                "Recovered truncated LLM payload: model output was cut off "
                "(%d chars); kept %s complete row(s), dropped the partial trailing one. "
                "Frequent occurrences suggest raising the extraction max_tokens.",
                len(span),
                _payload_row_count(parsed),
            )
            return parsed

    # 3) Last resort: close whatever is still open at EOF (recovers a final row
    #    that was cut right after a complete value, e.g. `{"a":1,"b":2`).
    tail = span + ('"' if scan["in_string"] else "")
    tail = _strip_trailing_commas(tail.rstrip().rstrip(",").rstrip())
    parsed = _loads_or_none(tail + "".join(reversed(scan["stack"])))
    if parsed is not None:
        logger.warning(
            "Recovered truncated LLM payload by closing open containers (%d chars); "
            "kept %s row(s). Frequent occurrences suggest raising the extraction max_tokens.",
            len(span),
            _payload_row_count(parsed),
        )
    return parsed


def clean_and_parse_json(text: str) -> Union[List, dict, None]:
    """Robustly extract JSON from (possibly messy or truncated) LLM output."""
    if not text:
        return None

    original_text = text
    text = text.strip()

    # Fast path: already-valid JSON.
    parsed = _loads_or_none(text)
    if parsed is not None:
        return parsed

    # Strip a ```json ... ``` code fence if present; parse or continue within it.
    match = re.search(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL | re.IGNORECASE)
    if match:
        fenced = match.group(1).strip()
        parsed = _loads_or_none(fenced)
        if parsed is not None:
            return parsed
        if fenced:
            text = fenced

    # Locate the first JSON value and scan it string-aware, with truncation recovery.
    first_brace = text.find("{")
    first_bracket = text.find("[")
    starts = [idx for idx in (first_brace, first_bracket) if idx != -1]
    if not starts:
        print(f"[clean_and_parse_json] No JSON delimiters found. Text: {text[:200]}...")
        return None

    start = min(starts)
    scan = _scan_json(text, start)
    parsed = _recover_json(text[start : scan["end"]], scan)
    if parsed is not None:
        return parsed

    print(f"[clean_and_parse_json] All parsing failed. Original length: {len(original_text)}")
    return None


def prepare_image_input(
    image_input: str,
    max_side: int = 1800,
    jpeg_quality: int = 85,
) -> Optional[str]:
    """Prepare image input for LLM with controllable compression."""
    if not image_input:
        return None

    try:
        img_data = None

        if image_input.startswith("data:image"):
            try:
                _, encoded = image_input.split(",", 1)
                img_data = base64.b64decode(encoded)
            except ValueError:
                print("[LLM Utils] Invalid base64 image format")
                return None
        elif os.path.exists(image_input):
            with open(image_input, "rb") as image_file:
                img_data = image_file.read()
        else:
            print(f"[LLM Utils] Image input not found: {str(image_input)[:50]}...")
            return None

        if not img_data:
            return None

        pil_img = Image.open(io.BytesIO(img_data))
        if pil_img.mode != "RGB":
            pil_img = pil_img.convert("RGB")

        max_side = max(512, int(max_side))
        jpeg_quality = max(50, min(95, int(jpeg_quality)))
        pil_img.thumbnail((max_side, max_side))

        output_buffer = io.BytesIO()
        pil_img.save(output_buffer, format="JPEG", quality=jpeg_quality)

        b64_str = base64.b64encode(output_buffer.getvalue()).decode("utf-8")
        return f"data:image/jpeg;base64,{b64_str}"
    except Exception as e:
        print(f"[LLM Utils] Image processing failed: {e}")
        return None


def clean_json_string(text: str) -> str:
    result = clean_and_parse_json(text)
    if result is None:
        return text
    return json.dumps(result)


def parse_json_response(response_text: str) -> List[dict]:
    """Parse JSON response with robust cleaning."""
    try:
        result = clean_and_parse_json(response_text)

        if result is None:
            print(f"[LLM Utils] Failed to parse JSON. Raw: {response_text[:500]}...")
            return []

        if isinstance(result, list):
            return result
        if isinstance(result, dict):
            if "data" in result and isinstance(result["data"], list):
                return result["data"]
            if "records" in result and isinstance(result["records"], list):
                return result["records"]
            return [result]

        print(f"[LLM Utils] Unexpected JSON type: {type(result)}")
        return []
    except Exception as e:
        print(f"[LLM Utils] Unexpected parse error: {e}")
        return []


def is_valid_numeric_entry(value: Union[str, float, int]) -> bool:
    if value is None:
        return False
    val_str = str(value).strip()
    if len(val_str) > 20:
        return False
    forbidden_words = ["increase", "decrease", "depend", "versus", "function", "correla", "high", "low", "vary", "varies"]
    if any(word in val_str.lower() for word in forbidden_words):
        return False
    return bool(re.search(r"\d", val_str))


def sanitize_numeric_string(value: Union[str, float, int]) -> Optional[str]:
    if value is None:
        return None
    s = str(value).strip()
    if len(s) > 80:
        return None
    if re.search(r"\d", s):
        return s
    return None


def sanitize_potential(value: Union[str, float, int]) -> Optional[str]:
    normalized = normalize_potential_text(value)
    if normalized is None:
        return None
    if re.search(r"\d|\bOCP\b|\bOCV\b|open[-\s]*circuit", normalized, flags=re.IGNORECASE):
        return normalized
    return None


def sanitize_cof(value: Union[str, float, int]) -> Optional[float]:
    if value is None:
        return None
    try:
        match = re.search(r"-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?", str(value))
        if not match:
            return None
        val_float = float(match.group(0))
        if 0.0001 <= val_float <= 5.0:
            return val_float
    except Exception:
        pass
    return None


def normalize_record_value(value: Any) -> str:
    """Normalize extracted record values for comparison and deduplication."""
    if value is None:
        return ""

    normalized = str(value).strip().lower()
    if not normalized or normalized in {"-", "--", "null", "none", "n/a", "na", "unknown"}:
        return ""

    normalized = (
        normalized
        .replace("μ", "u")
        .replace("µ", "u")
        .replace("渭", "u")
        .replace("碌", "u")
    )
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized


def has_explicit_numeric_value(value: Any) -> bool:
    normalized = normalize_record_value(value)
    if not normalized:
        return False

    if any(token in normalized for token in ("increase", "decrease", "trend", "varies", "function of")):
        return False

    return bool(re.search(r"-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?", normalized))


def has_core_quantitative_signal(record: dict[str, Any]) -> bool:
    """Return True when a record has at least one core quantitative field."""
    if not record:
        return False

    primary_fields = (
        "cof",
        "friction_force",
        "normal_load",
        "load",
        "film_thickness",
        "residual_film_thickness_d",
        "layer_spacing_delta",
        "surface_roughness",
        "wear_rate",
    )
    if any(has_explicit_numeric_value(record.get(field)) for field in primary_fields):
        return True

    secondary_fields = (
        "temperature",
        "speed",
        "shear_rate",
        "water_content",
        "concentration",
        "mol_ratio",
    )
    secondary_hits = sum(1 for field in secondary_fields if has_explicit_numeric_value(record.get(field)))
    return secondary_hits >= 2
