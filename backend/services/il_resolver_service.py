"""
Ionic Liquid Resolver Service
Converts IL names to SMILES/InChIKey and decomposes into cation/anion/alkyl chain length.

Two-tier strategy:
1. Local dictionary (instant, offline) — covers ~20 common tribology ILs
2. PubChemPy fallback (online, slower) — for unknown ILs
"""

import re
from typing import Optional, Dict, List, Any

# Try importing pubchempy; gracefully degrade if not installed
try:
    import pubchempy as pcp
    HAS_PUBCHEMPY = True
except ImportError:
    HAS_PUBCHEMPY = False
    print("[IL Resolver] PubChemPy not installed. Online fallback disabled.")

# Note: RDKit is NOT used here to avoid numpy version incompatibility crashes.
# InChIKey is obtained via PubChemPy lookup instead.


# ============================================================
# Local Cation/Anion SMILES Dictionary
# ============================================================

CATION_DB: Dict[str, Dict[str, Any]] = {
    # Imidazolium-based
    "EMIM": {
        "smiles": "CCn1cc[n+](C)c1",
        "full_name": "1-ethyl-3-methylimidazolium",
        "family": "imidazolium",
        "alkyl_chain_length": 2,
        "aliases": ["C2MIM", "C2mim", "emim", "EMIM+"],
    },
    "BMIM": {
        "smiles": "CCCCn1cc[n+](C)c1",
        "full_name": "1-butyl-3-methylimidazolium",
        "family": "imidazolium",
        "alkyl_chain_length": 4,
        "aliases": ["C4MIM", "C4mim", "bmim", "BMIM+"],
    },
    "HMIM": {
        "smiles": "CCCCCCn1cc[n+](C)c1",
        "full_name": "1-hexyl-3-methylimidazolium",
        "family": "imidazolium",
        "alkyl_chain_length": 6,
        "aliases": ["C6MIM", "C6mim", "hmim", "HMIM+"],
    },
    "OMIM": {
        "smiles": "CCCCCCCCn1cc[n+](C)c1",
        "full_name": "1-octyl-3-methylimidazolium",
        "family": "imidazolium",
        "alkyl_chain_length": 8,
        "aliases": ["C8MIM", "C8mim", "omim", "OMIM+"],
    },
    "DMIM": {
        "smiles": "CCCCCCCCCCn1cc[n+](C)c1",
        "full_name": "1-decyl-3-methylimidazolium",
        "family": "imidazolium",
        "alkyl_chain_length": 10,
        "aliases": ["C10MIM", "C10mim", "dmim"],
    },
    "MMIM": {
        "smiles": "Cn1cc[n+](C)c1",
        "full_name": "1,3-dimethylimidazolium",
        "family": "imidazolium",
        "alkyl_chain_length": 1,
        "aliases": ["C1MIM", "C1mim", "mmim"],
    },
    # Pyridinium-based
    "BuPy": {
        "smiles": "CCCC[n+]1ccccc1",
        "full_name": "N-butylpyridinium",
        "family": "pyridinium",
        "alkyl_chain_length": 4,
        "aliases": ["bupy", "BPy", "N-butylpyridinium"],
    },
    # Pyrrolidinium-based
    "Pyr13": {
        "smiles": "CCC[N+]1(C)CCCC1",
        "full_name": "N-methyl-N-propylpyrrolidinium",
        "family": "pyrrolidinium",
        "alkyl_chain_length": 3,
        "aliases": ["pyr13", "P13", "p13", "Py13"],
    },
    "Pyr14": {
        "smiles": "CCCC[N+]1(C)CCCC1",
        "full_name": "N-methyl-N-butylpyrrolidinium",
        "family": "pyrrolidinium",
        "alkyl_chain_length": 4,
        "aliases": ["pyr14", "P14", "p14"],
    },
    # Piperidinium-based
    "PIP14": {
        "smiles": "CCCC[N+]1(C)CCCCC1",
        "full_name": "N-methyl-N-butylpiperidinium",
        "family": "piperidinium",
        "alkyl_chain_length": 4,
        "aliases": ["pip14", "Pip14"],
    },
    # Phosphonium-based
    "P66614": {
        "smiles": "CCCCCCCCCCCCCC[P+](CCCCCC)(CCCCCC)CCCCCC",
        "full_name": "trihexyl(tetradecyl)phosphonium",
        "family": "phosphonium",
        "alkyl_chain_length": 14,
        "aliases": ["P6,6,6,14", "p66614", "P 66614"],
    },
    "P4444": {
        "smiles": "CCCC[P+](CCCC)(CCCC)CCCC",
        "full_name": "tetrabutylphosphonium",
        "family": "phosphonium",
        "alkyl_chain_length": 4,
        "aliases": ["P4,4,4,4", "p4444"],
    },
    "P4448": {
        "smiles": "CCCCCCCC[P+](CCCC)(CCCC)CCCC",
        "full_name": "tributyl(octyl)phosphonium",
        "family": "phosphonium",
        "alkyl_chain_length": 8,
        "aliases": ["P4,4,4,8", "p4448", "[P4,4,4,8]"],
    },
    # Ammonium-based
    "N4444": {
        "smiles": "CCCC[N+](CCCC)(CCCC)CCCC",
        "full_name": "tetrabutylammonium",
        "family": "ammonium",
        "alkyl_chain_length": 4,
        "aliases": ["N4,4,4,4", "n4444"],
    },
    # Morpholinium-based
    "MOR11": {
        "smiles": "C[N+]1(C)CCOCC1",
        "full_name": "N,N-dimethylmorpholinium",
        "family": "morpholinium",
        "alkyl_chain_length": 1,
        "aliases": ["mor11", "Mor11"],
    },
    # Guanidinium-based
    "hC3C1C1": {
        "smiles": "CCCN=C(NC)[NH2+]C",
        "full_name": "N,N,N',N'-tetramethyl-N''-propylguanidinium",
        "family": "guanidinium",
        "alkyl_chain_length": 3,
        "aliases": ["hc3c1c1"],
    },
}

ANION_DB: Dict[str, Dict[str, Any]] = {
    "PF6": {
        "smiles": "F[P-](F)(F)(F)(F)F",
        "full_name": "hexafluorophosphate",
        "aliases": ["pf6", "PF6-"],
    },
    "BF4": {
        "smiles": "F[B-](F)(F)F",
        "full_name": "tetrafluoroborate",
        "aliases": ["bf4", "BF4-"],
    },
    "TFSI": {
        "smiles": "O=S(=O)([N-]S(=O)(=O)C(F)(F)F)C(F)(F)F",
        "full_name": "bis(trifluoromethylsulfonyl)imide",
        "aliases": ["tfsi", "NTf2", "ntf2", "Tf2N", "tf2n", "TFSI-", "NTf2-", "BTA", "bta"],
    },
    "BOB": {
        "smiles": "[B-]1(OC(=O)C(=O)O1)OC(=O)C(=O)O",
        "full_name": "bis(oxalato)borate",
        "aliases": ["bob", "BOB-"],
    },
    "BMB": {
        "smiles": "[B-]1(OC(=O)CC(=O)O1)OC(=O)CC(=O)O",
        "full_name": "bis(malonato)borate",
        "aliases": ["bmb", "BMB-"],
    },
    "Cl": {
        "smiles": "[Cl-]",
        "full_name": "chloride",
        "aliases": ["cl", "Cl-"],
    },
    "Br": {
        "smiles": "[Br-]",
        "full_name": "bromide",
        "aliases": ["br", "Br-"],
    },
    "I": {
        "smiles": "[I-]",
        "full_name": "iodide",
        "aliases": ["i", "I-"],
    },
    "DCA": {
        "smiles": "N#C[N-]C#N",
        "full_name": "dicyanamide",
        "aliases": ["dca", "DCA-", "N(CN)2"],
    },
    "OTf": {
        "smiles": "O=S(=O)([O-])C(F)(F)F",
        "full_name": "triflate",
        "aliases": ["otf", "TfO", "CF3SO3", "Triflate"],
    },
    "FAP": {
        "smiles": "F[P-](F)(F)(C(F)(F)F)(C(F)(F)F)C(F)(F)F",
        "full_name": "tris(pentafluoroethyl)trifluorophosphate",
        "aliases": ["fap", "FAP-"],
    },
    "Ac": {
        "smiles": "CC([O-])=O",
        "full_name": "acetate",
        "aliases": ["ac", "OAc", "CH3COO"],
    },
    "SCN": {
        "smiles": "[S-]C#N",
        "full_name": "thiocyanate",
        "aliases": ["scn", "SCN-"],
    },
    "BScB": {
        "smiles": "[B-]1(OC2=CC=CC=C2C(=O)O1)OC3=CC=CC=C3C(=O)O",
        "full_name": "bis(salicylato)borate",
        "aliases": ["bscb", "BScB-", "bis(salicylato)borate"],
    },
}


# ============================================================
# Build reverse lookup indexes
# ============================================================

def _build_lookup(db: Dict[str, Dict]) -> Dict[str, str]:
    """Build a case-insensitive alias → canonical name lookup."""
    lookup = {}
    for canonical, info in db.items():
        lookup[canonical.lower()] = canonical
        for alias in info.get("aliases", []):
            # Strip charge symbols for matching
            clean = alias.replace("+", "").replace("-", "").strip().lower()
            lookup[clean] = canonical
            lookup[alias.lower()] = canonical
    return lookup

_cation_lookup = _build_lookup(CATION_DB)
_anion_lookup = _build_lookup(ANION_DB)


# ============================================================
# Core Functions
# ============================================================

def _find_cation(name: str) -> Optional[str]:
    """Find canonical cation name from input string."""
    clean = name.replace("+", "").replace("[", "").replace("]", "").strip().lower()
    # Also try normalizing phosphonium-style: P6,6,6,14 → p66614
    clean_no_comma = clean.replace(",", "").replace(" ", "")
    
    if clean in _cation_lookup:
        return _cation_lookup[clean]
    if clean_no_comma in _cation_lookup:
        return _cation_lookup[clean_no_comma]
    return None


def _find_anion(name: str) -> Optional[str]:
    """Find canonical anion name from input string."""
    clean = name.replace("-", "").replace("[", "").replace("]", "").strip().lower()
    
    if clean in _anion_lookup:
        return _anion_lookup[clean]
    return None


def parse_il_notation(name: str) -> Dict[str, Optional[str]]:
    """
    Parse ionic liquid notation into cation/anion components.
    
    Handles formats:
      - [Cation][Anion]  → standard bracket notation
      - [Cation]Anion    → mixed notation  
      - CationAnion      → concatenated (e.g., EmimTf2N)
      - Cation Anion      → space-separated
    
    Returns:
        {"cation_raw": str|None, "anion_raw": str|None}
    """
    if not name or not name.strip():
        return {"cation_raw": None, "anion_raw": None}
    
    name = name.strip()
    
    # Strategy 1: Bracket notation [X][Y]
    bracket_match = re.match(r'\[([^\]]+)\]\s*\[([^\]]+)\]', name)
    if bracket_match:
        return {
            "cation_raw": bracket_match.group(1),
            "anion_raw": bracket_match.group(2),
        }
    
    # Strategy 2: Single bracket [X]Y or X[Y]
    single_bracket = re.match(r'\[([^\]]+)\]\s*(.+)', name)
    if single_bracket:
        return {
            "cation_raw": single_bracket.group(1),
            "anion_raw": single_bracket.group(2).strip(),
        }
    single_bracket_r = re.match(r'(.+?)\s*\[([^\]]+)\]', name)
    if single_bracket_r:
        return {
            "cation_raw": single_bracket_r.group(1).strip(),
            "anion_raw": single_bracket_r.group(2),
        }
    
    # Strategy 3: Known cation+anion concatenated (e.g., EmimTFSI, BmimPF6)
    # Try matching against known cation names first
    name_lower = name.lower().replace(" ", "")
    for cation_key in sorted(CATION_DB.keys(), key=len, reverse=True):
        cation_lower = cation_key.lower()
        if name_lower.startswith(cation_lower):
            remainder = name[len(cation_key):]
            if remainder:
                return {"cation_raw": cation_key, "anion_raw": remainder.strip()}
        # Also check aliases
        for alias in CATION_DB[cation_key].get("aliases", []):
            alias_clean = alias.replace("+", "").lower()
            if name_lower.startswith(alias_clean) and len(alias_clean) > 1:
                remainder = name_lower[len(alias_clean):]
                if remainder:
                    return {"cation_raw": cation_key, "anion_raw": remainder.strip()}
    
    # Strategy 4: Space-separated
    parts = name.split()
    if len(parts) == 2:
        return {"cation_raw": parts[0], "anion_raw": parts[1]}
    
    return {"cation_raw": None, "anion_raw": None}


def _smiles_to_inchikey(smiles: str) -> Optional[str]:
    """Convert SMILES to InChIKey using PubChemPy."""
    if not HAS_PUBCHEMPY or not smiles:
        return None
    try:
        compounds = pcp.get_compounds(smiles, 'smiles')
        if compounds and compounds[0].inchikey:
            return compounds[0].inchikey
    except Exception as e:
        print(f"[IL Resolver] InChIKey lookup failed for SMILES '{smiles[:40]}': {e}")
    return None


def _pubchem_lookup(name: str) -> Optional[Dict[str, str]]:
    """Try to resolve an IL via PubChemPy (online fallback)."""
    if not HAS_PUBCHEMPY:
        return None
    try:
        compounds = pcp.get_compounds(name, 'name')
        if compounds:
            c = compounds[0]
            return {
                "smiles": c.canonical_smiles,
                "inchikey": c.inchikey,
            }
    except Exception as e:
        print(f"[IL Resolver] PubChemPy lookup failed for '{name}': {e}")
    return None


def resolve_il(name: str) -> Dict[str, Any]:
    """
    Main IL resolution function.
    
    Args:
        name: IL name string (e.g., "[EMIM][TFSI]", "EmimTf2N", "BMIM PF6")
    
    Returns:
        Dict with resolved structural info:
        {
            "input_name": str,
            "canonical_name": str|None,
            "cation": str|None,
            "anion": str|None,
            "cation_smiles": str|None,
            "anion_smiles": str|None,
            "il_smiles": str|None,
            "il_inchikey": str|None,
            "alkyl_chain_length": int|None,
        }
    """
    result = {
        "input_name": name,
        "canonical_name": None,
        "cation": None,
        "anion": None,
        "cation_smiles": None,
        "anion_smiles": None,
        "il_smiles": None,
        "il_inchikey": None,
        "alkyl_chain_length": None,
    }
    
    if not name or not name.strip() or name.strip().lower() in ("unknown il", "unknown", "-", "n/a", "none", ""):
        return result
    
    # Step 1: Parse into cation/anion
    parsed = parse_il_notation(name)
    cation_raw = parsed["cation_raw"]
    anion_raw = parsed["anion_raw"]
    
    # Step 2: Resolve cation
    cation_canonical = _find_cation(cation_raw) if cation_raw else None
    if cation_canonical and cation_canonical in CATION_DB:
        cation_info = CATION_DB[cation_canonical]
        result["cation"] = cation_canonical
        result["cation_smiles"] = cation_info["smiles"]
        result["alkyl_chain_length"] = cation_info["alkyl_chain_length"]
    
    # Step 3: Resolve anion
    anion_canonical = _find_anion(anion_raw) if anion_raw else None
    if anion_canonical and anion_canonical in ANION_DB:
        anion_info = ANION_DB[anion_canonical]
        result["anion"] = anion_canonical
        result["anion_smiles"] = anion_info["smiles"]
    
    # Step 4: Build canonical name
    if result["cation"] and result["anion"]:
        result["canonical_name"] = f"[{result['cation']}][{result['anion']}]"
    
    # Step 5: Build full IL SMILES (cation.anion salt notation)
    if result["cation_smiles"] and result["anion_smiles"]:
        result["il_smiles"] = f"{result['cation_smiles']}.{result['anion_smiles']}"
        
        # Step 6: Generate InChIKey
        inchikey = _smiles_to_inchikey(result["il_smiles"])
        if inchikey:
            result["il_inchikey"] = inchikey
    
    # Step 7: PubChemPy fallback if local resolution is incomplete
    if not result["il_smiles"] and HAS_PUBCHEMPY:
        print(f"[IL Resolver] Local miss for '{name}', trying PubChemPy...")
        pubchem_result = _pubchem_lookup(name)
        if pubchem_result:
            result["il_smiles"] = pubchem_result.get("smiles")
            result["il_inchikey"] = pubchem_result.get("inchikey")
            print(f"[IL Resolver] PubChemPy hit: SMILES={result['il_smiles']}")
    
    return result


def resolve_and_enrich_records(data_items: List[dict]) -> List[dict]:
    """
    Batch-resolve IL names in extracted data records.
    
    Enriches each record with cation, anion, SMILES, InChIKey, and alkyl chain length.
    Called after normalize_ionic_liquid_terms() in the LLM service pipeline.
    
    Args:
        data_items: List of extracted data dicts (each has 'ionic_liquid' key)
    
    Returns:
        Enriched data items list
    """
    for item in data_items:
        il_name = item.get("ionic_liquid", "")
        if not il_name or il_name.strip().lower() in ("unknown il", "unknown", "-"):
            continue
        
        resolved = resolve_il(il_name)
        
        # Enrich the record (only set if resolved, don't overwrite existing values)
        if resolved["cation"] and not item.get("cation"):
            item["cation"] = resolved["cation"]
        
        # Always set these new fields
        if resolved["anion"]:
            item["anion"] = resolved["anion"]
        if resolved["cation_smiles"]:
            item["cation_smiles"] = resolved["cation_smiles"]
        if resolved["anion_smiles"]:
            item["anion_smiles"] = resolved["anion_smiles"]
        if resolved["il_smiles"]:
            item["il_smiles"] = resolved["il_smiles"]
        if resolved["il_inchikey"]:
            item["il_inchikey"] = resolved["il_inchikey"]
        if resolved["alkyl_chain_length"] is not None:
            item["alkyl_chain_length"] = resolved["alkyl_chain_length"]
        
        # Update canonical name if resolved
        if resolved["canonical_name"]:
            item["ionic_liquid"] = resolved["canonical_name"]
        
        print(f"[IL Resolver] '{il_name}' → cation={resolved['cation']}, anion={resolved['anion']}, "
              f"chain={resolved['alkyl_chain_length']}, inchikey={resolved['il_inchikey']}")
    
    return data_items
