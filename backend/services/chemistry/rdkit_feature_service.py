from __future__ import annotations

import logging
from typing import Any

from .ionic_liquid_dict import lookup_smiles

logger = logging.getLogger(__name__)

try:
    from rdkit import Chem
    from rdkit.Chem import Descriptors

    HAS_RDKIT = True
except Exception as exc:
    HAS_RDKIT = False
    Chem = None
    Descriptors = None
    logger.warning("RDKit is unavailable; diffusion feature engineering will degrade gracefully: %s", exc)


FEATURE_VERSION = "rdkit.v1"


def compute_rdkit_features(smiles: str | None) -> dict[str, Any]:
    empty = {
        "molecular_weight": None,
        "logp": None,
        "tpsa": None,
        "num_h_donors": None,
        "num_h_acceptors": None,
    }
    if not smiles or not HAS_RDKIT:
        return empty

    try:
        mol = Chem.MolFromSmiles(smiles)
        if mol is None:
            return empty
        return {
            "molecular_weight": round(float(Descriptors.MolWt(mol)), 6),
            "logp": round(float(Descriptors.MolLogP(mol)), 6),
            "tpsa": round(float(Descriptors.TPSA(mol)), 6),
            "num_h_donors": int(Descriptors.NumHDonors(mol)),
            "num_h_acceptors": int(Descriptors.NumHAcceptors(mol)),
        }
    except Exception as exc:
        logger.warning("Failed to compute RDKit features for smiles=%s: %s", smiles, exc)
        return empty


def build_feature_payload(ionic_liquid: str | None, smiles: str | None = None) -> tuple[str | None, dict[str, Any]]:
    resolved_smiles = smiles or lookup_smiles(ionic_liquid)
    return resolved_smiles, compute_rdkit_features(resolved_smiles)


def enrich_diffusion_record(record: dict[str, Any]) -> dict[str, Any]:
    enriched = dict(record or {})
    smiles, feature_payload = build_feature_payload(
        ionic_liquid=enriched.get("ionic_liquid"),
        smiles=enriched.get("smiles"),
    )
    enriched["smiles"] = smiles
    enriched["rdkit_features_json"] = feature_payload
    enriched.setdefault("feature_version", FEATURE_VERSION)
    return enriched
