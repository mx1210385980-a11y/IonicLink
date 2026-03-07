import os
import json
import re
import base64
import io
from typing import List, Optional, Union
from PIL import Image


def clean_and_parse_json(text: str) -> Union[List, dict, None]:
    """
    Robust JSON cleaning and parsing function.
    Handles:
    - Pure JSON
    - JSON wrapped in ```json ... ```
    - JSON with leading/trailing text
    - Nested markdown blocks
    
    Returns parsed JSON object or None if all parsing fails.
    """
    if not text:
        return None
    
    original_text = text
    text = text.strip()
    
    # Strategy 1: Try direct parse first
    try:
        result = json.loads(text)
        return result
    except json.JSONDecodeError:
        pass
    
    # Strategy 2: Remove markdown code blocks ```json ... ``` or ``` ... ```
    match = re.search(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL | re.IGNORECASE)
    if match:
        candidate = match.group(1).strip()
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass
    
    # Strategy 3: Find outermost { } or [ ] and extract
    first_brace = text.find('{')
    first_bracket = text.find('[')
    
    if first_brace == -1 and first_bracket == -1:
        print(f"[clean_and_parse_json] No JSON delimiters found. Text: {text[:200]}...")
        return None
    
    # Determine which delimiter is first
    if first_bracket != -1 and (first_brace == -1 or first_bracket < first_brace):
        start_idx = first_bracket
        bracket_count = 0
        end_idx = -1
        for i, char in enumerate(text[start_idx:]):
            if char == '[':
                bracket_count += 1
            elif char == ']':
                bracket_count -= 1
                if bracket_count == 0:
                    end_idx = start_idx + i
                    break
        if end_idx != -1:
            candidate = text[start_idx:end_idx+1]
            try:
                return json.loads(candidate)
            except json.JSONDecodeError as e:
                print(f"[clean_and_parse_json] Bracket extraction failed: {e}")
    else:
        start_idx = first_brace
        brace_count = 0
        end_idx = -1
        for i, char in enumerate(text[start_idx:]):
            if char == '{':
                brace_count += 1
            elif char == '}':
                brace_count -= 1
                if brace_count == 0:
                    end_idx = start_idx + i
                    break
        if end_idx != -1:
            candidate = text[start_idx:end_idx+1]
            try:
                return json.loads(candidate)
            except json.JSONDecodeError as e:
                print(f"[clean_and_parse_json] Brace extraction failed: {e}")
    
    # All strategies failed
    print(f"[clean_and_parse_json] All parsing failed. Original length: {len(original_text)}")
    return None


def prepare_image_input(image_input: str) -> Optional[str]:
    """
    Prepare image input for LLM with COMPRESSION.
    Accepts either a local file path or a base64 data URI.
    Returns a sanitized and compressed base64 data URI string.
    """
    if not image_input:
        return None
        
    try:
        img_data = None
        
        # Case 1: Already a Base64 Data URI
        if image_input.startswith("data:image"):
            try:
                header, encoded = image_input.split(",", 1)
                img_data = base64.b64decode(encoded)
            except ValueError:
                print(f"[LLM Utils] Invalid base64 string format")
                return None
        
        # Case 2: File Path
        elif os.path.exists(image_input):
            with open(image_input, "rb") as image_file:
                img_data = image_file.read()
        else:
            print(f"[LLM Utils] Image input not found: {str(image_input)[:50]}...")
            return None

        if not img_data:
            return None

        # Process with Pillow
        with Image.open(io.BytesIO(img_data)):
            pil_img = Image.open(io.BytesIO(img_data))
            if pil_img.mode != 'RGB':
                pil_img = pil_img.convert('RGB')
            
            MAX_SIZE = (1024, 1024)
            pil_img.thumbnail(MAX_SIZE)
            
            output_buffer = io.BytesIO()
            pil_img.save(output_buffer, format='JPEG', quality=70)
            
            b64_str = base64.b64encode(output_buffer.getvalue()).decode('utf-8')
            return f"data:image/jpeg;base64,{b64_str}"
            
    except Exception as e:
        print(f"[LLM Utils] Image processing failed: {e}")
        return None


def clean_json_string(text: str) -> str:
    """Legacy function - now uses clean_and_parse_json internally"""
    result = clean_and_parse_json(text)
    if result is None:
        return text
    return json.dumps(result)


def parse_json_response(response_text: str) -> List[dict]:
    """Parse JSON response with robust cleaning"""
    try:
        result = clean_and_parse_json(response_text)
        
        if result is None:
            print(f"[LLM Utils] Failed to parse JSON. Raw: {response_text[:500]}...")
            return []
        
        if isinstance(result, list):
            return result
        elif isinstance(result, dict):
            if "data" in result:
                return result["data"]
            elif "records" in result:
                return result["records"]
            else:
                return [result]
        else:
            print(f"[LLM Utils] Unexpected JSON type: {type(result)}")
            return []
            
    except Exception as e:
        print(f"[LLM Utils] Unexpected parse error: {e}")
        return []


def is_valid_numeric_entry(value: Union[str, float, int]) -> bool:
    if not value:
        return False
    val_str = str(value).strip()
    if len(val_str) > 20:
        return False
    forbidden_words = ['increase', 'decrease', 'depend', 'versus', 'function', 'correla', 'high', 'low', 'vary', 'varies']
    if any(word in val_str.lower() for word in forbidden_words):
        return False
    if not re.search(r'\d', val_str):
        return False
    return True


def sanitize_numeric_string(value: Union[str, float, int]) -> Optional[str]:
    if not value:
        return None
    s = str(value).strip()
    if len(s) > 50:
        return None
    if re.match(r'^-?\d', s) and re.search(r'\d', s):
        return s
    return None


def sanitize_potential(value: Union[str, float, int]) -> Optional[str]:
    if not value:
        return None
    s = str(value).strip()
    if any(x in s.upper() for x in ["OCP", "OPEN", "CIRCUIT"]):
        return "OCP"
    if re.match(r'^[+-]?\d', s):
        return s
    return None


def sanitize_cof(value: Union[str, float, int]) -> Optional[float]:
    if not value:
        return None
    try:
        match = re.search(r'-?\d+(\.\d+)?([eE][-+]?\d+)?', str(value))
        if not match:
            return None
        val_float = float(match.group(0))
        if 0.0001 <= val_float <= 5.0:
            return val_float
        return None
    except:
        return None
