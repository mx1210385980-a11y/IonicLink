from typing import List, Dict, Tuple, Optional, Any
import re
from collections import defaultdict
from models.tribology import TribologyData
from services.llm.utils import (
    has_core_quantitative_signal,
    normalize_record_value,
    sanitize_numeric_string,
    sanitize_potential,
    sanitize_cof,
)


def _record_has_core_signal(record: TribologyData) -> bool:
    return has_core_quantitative_signal(
        {
            "cof": record.cof,
            "friction_force": record.friction_force,
            "normal_load": record.normal_load or record.load,
            "load": record.load,
            "film_thickness": record.film_thickness,
            "residual_film_thickness_d": record.residual_film_thickness_d,
            "layer_spacing_delta": record.layer_spacing_delta,
            "surface_roughness": record.surface_roughness,
            "wear_rate": record.wear_rate,
            "temperature": record.temperature,
            "speed": record.speed,
            "water_content": record.water_content,
            "concentration": record.concentration,
            "mol_ratio": record.mol_ratio,
        }
    )


def _record_measurement_signature(record: TribologyData) -> str:
    parts = []
    for field in (
        "cof",
        "friction_force",
        "normal_load",
        "load",
        "film_thickness",
        "residual_film_thickness_d",
        "layer_spacing_delta",
        "surface_roughness",
        "wear_rate",
        "temperature",
        "speed",
        "potential",
        "water_content",
        "source",
    ):
        value = normalize_record_value(getattr(record, field, None))
        if value:
            parts.append(f"{field}:{value}")
    return "|".join(parts)

def deduplicate_records(records: List[TribologyData]) -> List[TribologyData]:
    """
    Smart Deduplication and Merging Strategy.
    
    Instead of just filtering duplicates, this function MERGES compatible records.
    Compatibility is defined as:
    1. Same Identity: Material + Ionic Liquid + COF (outcome)
       - If Potential is present in both, it must match.
       - If Temp/Load/Speed are present in both, they must match (approx).
    
    If compatible, records are merged:
    - Missing fields are filled from the other record (e.g. missing Potential filled from text-sourced record)
    - Source/Notes/Evidence are concatenated (e.g. "Figure 3; Text")
    - Confidence is maximized
    """
    if not records:
        return []

    print(f"[Deduplication] Processing {len(records)} candidates with Smart Merge...")

    # --- 1. CLEANING & PRE-PROCESSING ---
    valid_records = []
    for record in records:
        # Pre-clean critical fields
        record.temperature = sanitize_numeric_string(record.temperature)
        record.normal_load = sanitize_numeric_string(record.normal_load)
        record.speed = sanitize_numeric_string(record.speed)
        record.potential = sanitize_potential(record.potential)
        
        # Sanitize COF
        clean_cof = sanitize_cof(record.cof)
        record._clean_cof = round(clean_cof, 3) if clean_cof is not None else None
        if record._clean_cof is None and not _record_has_core_signal(record):
            continue
        valid_records.append(record)

    if len(valid_records) < len(records):
        print(f"[Deduplication] Filtered {len(records)} -> {len(valid_records)} valid records (dropped null/invalid COF).")

    # --- 2. GROUPING (Broad Buckets) ---
    # Group by identity + primary measurement signature.
    # For COF records we retain the historical COF-centric grouping.
    # For AFM / layering records without COF, use a richer measurement signature.
    
    def normalize_str(s):
        if not s: return ""
        # Remove ALL brackets, spaces, underscores, hyphens, lowercase
        # Also normalize common variations
        s = str(s).strip().lower()
        s = re.sub(r'[\[\]\(\)\s_\-–—]', '', s)
        
        # Normalize common ionic liquid name variations
        s = s.replace('emim', '1ethyl3methylimidazolium')
        s = s.replace('bmim', '1butyl3methylimidazolium')
        s = s.replace('hmim', '1hexyl3methylimidazolium')
        s = s.replace('omim', '1octyl3methylimidazolium')
        s = s.replace('dmim', '1decyl3methylimidazolium')
        s = s.replace('tfsi', 'bistriflimide')
        s = s.replace('fsi', 'bis(fluorosulfonyl)imide')
        s = s.replace('pf6', 'hexafluorophosphate')
        s = s.replace('bf4', 'tetrafluoroborate')
        
        # Normalize chemical formulas
        s = s.replace('μ', 'u').replace('µ', 'u')
        
        # Normalize material names
        s = s.replace('sio2', 'silica')
        s = s.replace('sio', 'silica')
        s = s.replace('au', 'gold')
        s = s.replace('cu', 'copper')
        s = s.replace('steel', 'stainlesssteel')
        
        return s
    
    # Normalize source (figure/table reference)
    def normalize_source(s):
        if not s: return ""
        # Extract figure/table number: "Figure 3", "Table 1", "Fig. 2" -> "figure3", "table1"
        s = str(s).strip().lower()
        s = s.replace('fig.', 'figure').replace('fig ', 'figure')
        s = s.replace('table', 'table').replace('tab.', 'table')
        # Remove spaces and special chars
        s = re.sub(r'[\[\]\(\)\s_\-–—:]', '', s)
        return s
    
    # Helper for resolving "Potential" in grouping
    def normalize_potential(p):
        if not p: return ""
        p = str(p).strip().lower()
        # OCP, open circuit potential, null, none -> empty
        if p in ['ocp', 'open circuit potential', 'opencircuitpotential', 'null', 'none', '']:
            return ''
        return p

    groups: Dict[Tuple[str, str, str, str, str], List[TribologyData]] = defaultdict(list)
    
    for r in valid_records:
        key = (
            normalize_str(r.material_name),
            normalize_str(r.ionic_liquid),
            str(r._clean_cof) if r._clean_cof is not None else _record_measurement_signature(r),
            normalize_potential(r.potential),
            normalize_source(r.source) if r.source else ""
        )
        groups[key].append(r)
        
    # Debug: Print group statistics
    print(f"[Deduplication] Created {len(groups)} groups from {len(valid_records)} records")
    for key, recs in groups.items():
        if len(recs) > 1:
            print(f"  Group material={key[0][:20]}... cof={key[2]} source={key[4]} has {len(recs)} records - will merge")

    # --- 3. MERGING WITHIN GROUPS ---
    merged_results = []
    
    for key, candidates in groups.items():
        # Iterate and merge
        # Strategy: Take the first, try to merge with others. If not compatible, keep separate.
        
        unique_in_group = []
        
        while candidates:
            base = candidates.pop(0)
            
            # Identify all candidates that are compatible with 'base'
            # We want to merge ALL compatible ones into base.
            
            next_generation_candidates = []
            
            for other in candidates:
                if are_compatible(base, other):
                    base = merge_records(base, other)
                    # `base` now accumulates info. `other` is consumed.
                else:
                    next_generation_candidates.append(other)
            
            unique_in_group.append(base)
            candidates = next_generation_candidates 
            
        merged_results.extend(unique_in_group)

    print(f"[Deduplication] Merged {len(valid_records)} -> {len(merged_results)} unique records.")
    return merged_results


def are_compatible(a: TribologyData, b: TribologyData) -> bool:
    """Check if two records represent the same experimental point (no conflicts)."""
    
    # Import unit converter
    from services.unit_converter import parse_speed_to_mps, parse_force_to_newtons
    
    # Helper: Normalize Unicode characters in strings (μ, µ -> u)
    def normalize_unicode(s: str) -> str:
        """Normalize Unicode micro symbols to ASCII 'u' for consistent comparison"""
        if not s:
            return s
        # Replace all variants of micro: μ (U+03BC), µ (U+00B5)
        return s.replace('μ', 'u').replace('µ', 'u')
    
    # Helper: Check field compatibility
    # Compatible if: Equal OR One is Missing
    def is_field_compatible(val_a, val_b, field_name=None):
        # Normalize None/Empty to None
        v_a = val_a if val_a and str(val_a).strip() else None
        v_b = val_b if val_b and str(val_b).strip() else None
        
        if not v_a or not v_b:
            return True # One missing -> Compatible
        
        # Special handling for speed and load - normalize units first
        if field_name == 'speed':
            # Normalize Unicode BEFORE parsing (μm/s -> um/s)
            normalized_str_a = normalize_unicode(str(v_a))
            normalized_str_b = normalize_unicode(str(v_b))
            
            # Convert to standard m/s for comparison
            normalized_a = parse_speed_to_mps(normalized_str_a)
            normalized_b = parse_speed_to_mps(normalized_str_b)
            
            if normalized_a is not None and normalized_b is not None:
                # Compare normalized values with relative tolerance
                tolerance = max(1e-10, abs(normalized_a) * 0.01)  # 1% or 1e-10 m/s minimum
                if abs(normalized_a - normalized_b) < tolerance:
                    return True
                else:
                    print(f"[Dedupe Mismatch] Speed conflict: '{val_a}' ({normalized_a:.2e} m/s) vs '{val_b}' ({normalized_b:.2e} m/s)")
                    return False
        
        if field_name == 'normal_load':
            # Convert to standard Newtons for comparison
            normalized_a = parse_force_to_newtons(str(v_a))
            normalized_b = parse_force_to_newtons(str(v_b))
            
            if normalized_a is not None and normalized_b is not None:
                # Compare normalized values with small tolerance
                if abs(normalized_a - normalized_b) < 1e-12:  # 1 pN tolerance
                    return True
                else:
                    print(f"[Dedupe Mismatch] Load conflict: '{val_a}' ({normalized_a} N) vs '{val_b}' ({normalized_b} N)")
                    return False
        
        
        # Normalize: lower, strip, remove ALL internal whitespace, normalize Unicode  
        # "1 μm/s" == "1 um/s"
        str_a = normalize_unicode(str(v_a)).lower().replace(" ", "").replace("_", "").replace("-", "")
        str_b = normalize_unicode(str(v_b)).lower().replace(" ", "").replace("_", "").replace("-", "")
        
        # Simple string equality after aggressive normalization
        if str_a == str_b:
            return True
        
        # Numeric equality check for things like "25" vs "25.0"
        try:
            # Extract just the number
            f_a = float(re.sub(r'[^\d\.]', '', str_a))
            f_b = float(re.sub(r'[^\d\.]', '', str_b))
            if abs(f_a - f_b) < 1e-4:
                return True
        except:
            pass
            
        print(f"[Dedupe Mismatch] Field conflict: '{val_a}' vs '{val_b}'")
        return False

    # Check Critical Parameters with field names
    # If explicit values conflict, they are different experiments.
    
    # Special handling for potential: OCP and null are equivalent (both mean no applied voltage)
    def is_potential_compatible(p_a, p_b):
        """OCP (Open Circuit Potential) and null are semantically equivalent"""
        # Normalize to None/Empty
        val_a = p_a if p_a and str(p_a).strip() and str(p_a).strip().lower() != 'null' else None
        val_b = p_b if p_b and str(p_b).strip() and str(p_b).strip().lower() != 'null' else None
        
        # If both are None/null -> Compatible
        if not val_a and not val_b:
            return True
        
        # If one is None and the other is OCP -> Compatible (both mean no applied voltage)
        if not val_a and val_b:
            return normalize_unicode(str(val_b).strip().upper()) == 'OCP'
        if not val_b and val_a:
            return normalize_unicode(str(val_a).strip().upper()) == 'OCP'
        
        # Both have values -> must match
        normalized_a = normalize_unicode(str(val_a).strip().upper())
        normalized_b = normalize_unicode(str(val_b).strip().upper())
        return normalized_a == normalized_b
    
    # Special handling for water_content: 0%, null, and absence are equivalent
    def is_water_content_compatible(w_a, w_b):
        """0%, null, and empty all mean 'dry' or 'no water added'"""
        # Normalize to None/Empty
        val_a = w_a if w_a and str(w_a).strip() and str(w_a).strip().lower() != 'null' else None
        val_b = w_b if w_b and str(w_b).strip() and str(w_b).strip().lower() != 'null' else None
        
        # Check if value represents zero water content
        def is_zero_water(val):
            if not val:
                return True  # null/empty = no water
            val_str = str(val).strip().lower()
            # Match "0%", "0 %", "0wt%", etc.
            if re.match(r'^0+\.?0*\s*%?$', val_str) or re.match(r'^0+\.?0*\s*wt\s*%?$', val_str):
                return True
            return False
        
        # If both are zero/null -> Compatible
        if is_zero_water(val_a) and is_zero_water(val_b):
            return True
        
        # If one is zero and the other has value -> Incompatible
        if is_zero_water(val_a) != is_zero_water(val_b):
            return False
        
        # Both have non-zero values -> use standard field comparison
        return is_field_compatible(w_a, w_b)
    
    if not is_potential_compatible(a.potential, b.potential): 
        print(f"[Dedupe Mismatch] Potential conflict: '{a.potential}' vs '{b.potential}'")
        return False
    if not is_field_compatible(a.temperature, b.temperature): return False
    if not is_field_compatible(a.normal_load, b.normal_load, 'normal_load'): return False
    if not is_field_compatible(a.speed, b.speed, 'speed'): return False
    if not is_field_compatible(a.film_thickness, b.film_thickness): return False
    if not is_field_compatible(a.residual_film_thickness_d, b.residual_film_thickness_d): return False
    if not is_field_compatible(a.layer_spacing_delta, b.layer_spacing_delta): return False
    if not is_field_compatible(a.surface_roughness, b.surface_roughness): return False
    
    # Less critical: Water content with special handling
    if not is_water_content_compatible(a.water_content, b.water_content):
        print(f"[Dedupe Mismatch] Water content conflict: '{a.water_content}' vs '{b.water_content}'")
        return False
    
    return True


def merge_records(target: TribologyData, source: TribologyData) -> TribologyData:
    """Merge source into target, enriching target with missing info."""
    
    # 1. Fill missing single-value fields (prefer target if both exist)
    fields = ['potential', 'temperature', 'normal_load', 'speed', 
              'water_content', 'mol_ratio', 'residual_film_thickness_d', 
              'layer_spacing_delta', 'film_thickness', 'wear_rate',
              'contact_type', 'base_oil', 'concentration', 
              'cation', 'anion', 'cation_smiles', 'anion_smiles', 
              'il_smiles', 'il_inchikey', 'alkyl_chain_length',
              'friction_force', 'value_origin']
    
    for f in fields:
        val_t = getattr(target, f, None)
        val_s = getattr(source, f, None)
        
        # If target missing, take source
        if (not val_t or str(val_t).strip() == "") and (val_s and str(val_s).strip() != ""):
            setattr(target, f, val_s)
            
        # If both present, maybe prefer the "canonical" one?
        # E.g. "OCP" vs "Open Circuit Potential"?
        # For now we stick to target wins if conflict, but pure merge if one missing.

    # 2. Merge concatenatable fields (Source, Notes, Evidence)
    def merge_text_field(f_name):
        t_val = getattr(target, f_name, "") or ""
        s_val = getattr(source, f_name, "") or ""
        
        # Split by semicolon, clean, unique
        parts = []
        if t_val: parts.extend(re.split(r'[;；]', str(t_val)))
        if s_val: parts.extend(re.split(r'[;；]', str(s_val)))
        
        clean_parts = []
        seen = set()
        for p in parts:
            p_clean = p.strip()
            if p_clean and p_clean.lower() not in seen:
                clean_parts.append(p_clean)
                seen.add(p_clean.lower())
        
        if clean_parts:
            setattr(target, f_name, "; ".join(clean_parts))

    merge_text_field('source')
    merge_text_field('notes')
    merge_text_field('evidence')
    
    # 3. Maximize Confidence
    if hasattr(source, 'confidence') and hasattr(target, 'confidence'):
        target.confidence = max(target.confidence or 0, source.confidence or 0)
        
    return target
