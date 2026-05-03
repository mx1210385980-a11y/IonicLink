import base64
import io
import json
import os
import re
from typing import Any, List, Optional, Union

from PIL import Image

from services.normalization.potential import normalize_potential_text


def clean_and_parse_json(text: str) -> Union[List, dict, None]:
    """Robust JSON cleaning and parsing function."""
    if not text:
        return None

    original_text = text
    text = text.strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    match = re.search(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL | re.IGNORECASE)
    if match:
        candidate = match.group(1).strip()
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass

    first_brace = text.find("{")
    first_bracket = text.find("[")
    if first_brace == -1 and first_bracket == -1:
        print(f"[clean_and_parse_json] No JSON delimiters found. Text: {text[:200]}...")
        return None

    if first_bracket != -1 and (first_brace == -1 or first_bracket < first_brace):
        start_idx = first_bracket
        balance = 0
        end_idx = -1
        for i, ch in enumerate(text[start_idx:]):
            if ch == "[":
                balance += 1
            elif ch == "]":
                balance -= 1
                if balance == 0:
                    end_idx = start_idx + i
                    break
        if end_idx != -1:
            try:
                return json.loads(text[start_idx : end_idx + 1])
            except json.JSONDecodeError:
                pass
    else:
        start_idx = first_brace
        balance = 0
        end_idx = -1
        for i, ch in enumerate(text[start_idx:]):
            if ch == "{":
                balance += 1
            elif ch == "}":
                balance -= 1
                if balance == 0:
                    end_idx = start_idx + i
                    break
        if end_idx != -1:
            try:
                return json.loads(text[start_idx : end_idx + 1])
            except json.JSONDecodeError:
                pass

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
