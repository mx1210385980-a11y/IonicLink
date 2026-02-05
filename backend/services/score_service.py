"""
Confidence Scoring Service for IonicLink

Implements dynamic confidence calculation based on data quality.
Replaces the hardcoded 0.9 confidence with intelligent scoring.
"""

from typing import Dict, Any, Optional


def calculate_confidence(record: Dict[str, Any]) -> float:
    """
    Calculate confidence score based on data quality.
    
    Scoring Algorithm:
    - Base Score: 1.0
    - Deductions:
        - Missing material_name or lubricant: -0.2
        - Operator contains '<' or '>': -0.1 (indicates uncertainty)
        - Missing load_value: -0.05
        - Missing speed_value: -0.05
        - Missing temperature: -0.05
        - Abnormal COF value (> 1.5): -0.2
    - Bounds: min 0.1, max 1.0
    
    Args:
        record: Dictionary containing tribology data fields
        
    Returns:
        float: Confidence score between 0.1 and 1.0
    """
    score = 1.0
    
    # === Deduction 1: Missing core fields (Material/Lubricant) ===
    material_name = record.get("material_name") or record.get("materialName")
    lubricant = record.get("lubricant") or record.get("ionic_liquid")
    
    if not material_name or material_name.strip() in ("", "-", "null", "None"):
        score -= 0.2
        
    if not lubricant or lubricant.strip() in ("", "-", "null", "None"):
        score -= 0.2
    
    # === Deduction 2: Uncertainty operators in COF ===
    cof_operator = record.get("cof_operator") or record.get("cofOperator")
    cof_raw = record.get("cof_raw") or record.get("cofRaw") or record.get("cof") or ""
    
    # Check for inequality operators indicating uncertainty
    uncertainty_markers = ("<", ">", "~", "≤", "≥", "约", "approximately")
    has_uncertainty = False
    
    if cof_operator and any(op in str(cof_operator) for op in uncertainty_markers):
        has_uncertainty = True
    if cof_raw and any(op in str(cof_raw) for op in uncertainty_markers):
        has_uncertainty = True
        
    if has_uncertainty:
        score -= 0.1
    
    # === Deduction 3: Missing experimental conditions ===
    # Load
    load_value = record.get("load_value") or record.get("loadValue") or record.get("load")
    if not load_value or str(load_value).strip() in ("", "-", "null", "None"):
        score -= 0.05
    
    # Speed
    speed_value = record.get("speed_value") or record.get("speedValue") or record.get("speed")
    if not speed_value or str(speed_value).strip() in ("", "-", "null", "None"):
        score -= 0.05
    
    # Temperature
    temperature = record.get("temperature")
    if not temperature or str(temperature).strip() in ("", "-", "null", "None"):
        score -= 0.05
    
    # === Deduction 4: Abnormal COF value ===
    cof_value = record.get("cof_value") or record.get("cofValue")
    if cof_value is None:
        # Try to parse from cof field
        cof_str = record.get("cof")
        if cof_str:
            try:
                # Extract numeric value from string like "0.05" or "<0.01"
                import re
                match = re.search(r'[\d.]+', str(cof_str))
                if match:
                    cof_value = float(match.group())
            except (ValueError, AttributeError):
                pass
    
    if cof_value is not None:
        try:
            cof_float = float(cof_value)
            # COF > 1.5 is physically unusual (friction coefficient rarely exceeds 1.0)
            if cof_float > 1.5:
                score -= 0.2
            # COF < 0 is physically impossible
            elif cof_float < 0:
                score -= 0.2
        except (ValueError, TypeError):
            pass
    
    # === Apply bounds ===
    score = max(0.1, min(1.0, score))
    
    return round(score, 2)


def calculate_batch_confidence(records: list) -> list:
    """
    Calculate confidence scores for a batch of records.
    
    Args:
        records: List of tribology data dictionaries
        
    Returns:
        List of records with 'confidence' field updated
    """
    for record in records:
        record["confidence"] = calculate_confidence(record)
    return records
