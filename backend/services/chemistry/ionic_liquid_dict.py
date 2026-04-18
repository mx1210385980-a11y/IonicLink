from __future__ import annotations

import importlib.util
import logging
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_WORKSPACE_ROOT = Path(__file__).resolve().parents[3]
_LEGACY_DICT_PATH = _WORKSPACE_ROOT / "PaperData" / "rdkit_feature_engineering.py"

_CORE_IONIC_LIQUID_SMILES: dict[str, str] = {
    "[emim][bf4]": "CCN1C=C[N+](=C1)C.F[B-](F)(F)F",
    "[emim][pf6]": "CCN1C=C[N+](=C1)C.F[P-](F)(F)(F)(F)F",
    "[emim][tfsi]": "CCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[bmim][bf4]": "CCCCN1C=C[N+](=C1)C.F[B-](F)(F)F",
    "[bmim][pf6]": "CCCCN1C=C[N+](=C1)C.F[P-](F)(F)(F)(F)F",
    "[bmim][tfsi]": "CCCCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[bmim][ntf2]": "CCCCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[hmim][tfsi]": "CCCCCCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[omim][tfsi]": "CCCCCCCCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[pyr13][tfsi]": "CCC[N+]1(C)CCCC1.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[pyr14][tfsi]": "CCCC[N+]1(C)CCCC1.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "ean": "CC[NH3+].[O-][N+](=O)[O-]",
}


def normalize_ionic_liquid_key(value: str | None) -> str:
    text = str(value or "").strip().lower()
    text = text.replace("] [", "][")
    text = text.replace("]i[", "][")
    text = re.sub(r"\s+", "", text)
    return text


def _load_legacy_smiles_dict() -> dict[str, str]:
    if not _LEGACY_DICT_PATH.exists():
        return {}

    try:
        spec = importlib.util.spec_from_file_location("_legacy_rdkit_feature_engineering", _LEGACY_DICT_PATH)
        if not spec or not spec.loader:
            return {}
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        payload: Any = getattr(module, "IL_SMILES_DICT", {})
        if not isinstance(payload, dict):
            return {}
        return {
            normalize_ionic_liquid_key(key): str(value)
            for key, value in payload.items()
            if str(key or "").strip() and str(value or "").strip()
        }
    except Exception as exc:
        logger.warning("Failed to load legacy ionic liquid dictionary from %s: %s", _LEGACY_DICT_PATH, exc)
        return {}


@lru_cache(maxsize=1)
def get_ionic_liquid_smiles_dict() -> dict[str, str]:
    merged = {normalize_ionic_liquid_key(key): value for key, value in _CORE_IONIC_LIQUID_SMILES.items()}
    merged.update(_load_legacy_smiles_dict())
    return merged


def lookup_smiles(name: str | None) -> str | None:
    normalized = normalize_ionic_liquid_key(name)
    if not normalized:
        return None

    smiles_dict = get_ionic_liquid_smiles_dict()
    direct = smiles_dict.get(normalized)
    if direct:
        return direct

    bracketed = normalized
    if not bracketed.startswith("[") and not bracketed.endswith("]") and normalized.count("[") == 0:
        bracketed = normalized.replace("-", "")
    return smiles_dict.get(bracketed)
