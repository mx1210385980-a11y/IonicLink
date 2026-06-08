"""Canonicalize open-ended flexible-field keys before storage.

Extraction can surface the same scientific variable under many labels, such as
``Fe2O3 loading`` or ``iron_oxide_content``. This module collapses certain
aliases into stable canonical keys and preserves unresolved fields for later
frequency audit.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Callable, Optional


@dataclass
class NormalizationResult:
    raw_key: str
    canonical_key: str
    stage: str
    confidence: float
    suggested_merge: Optional[str] = None
    resolved: bool = True
    notes: str = ""

    def to_dict(self) -> dict:
        return {
            "raw_key": self.raw_key,
            "canonical_key": self.canonical_key,
            "stage": self.stage,
            "confidence": round(self.confidence, 4),
            "suggested_merge": self.suggested_merge,
            "resolved": self.resolved,
            "notes": self.notes,
        }


DEFAULT_ALIASES: dict[str, list[str]] = {
    "current": [
        "current",
        "applied current",
        "applied_current",
        "electric current",
        "electric_current",
        "test current",
        "current intensity",
        "current_intensity",
    ],
    "baseline_current": [
        "baseline current",
        "baseline_current",
        "reference current",
        "reference_current",
        "control current",
        "control_current",
        "no-current baseline",
        "zero current",
    ],
    "current_density": [
        "current density",
        "current_density",
        "j",
        "areal current",
    ],
    "iron_oxide_additive_ratio": [
        "iron oxide additive ratio",
        "iron_oxide_additive_ratio",
        "fe2o3 loading",
        "fe2o3_loading",
        "iron oxide content",
        "iron_oxide_content",
        "ferric oxide ratio",
        "fe2o3 wt%",
        "fe2o3 mass fraction",
        "fe3o4 loading",
        "fe3o4_loading",
        "fe3o4 wt%",
        "fe3o4 mass fraction",
        "magnetite loading",
    ],
    "additive_loading": [
        "additive ratio",
        "additive_ratio",
        "additive loading",
        "additive_loading",
        "mass fraction",
        "mass_fraction",
        "additive concentration",
        "additive wt%",
        "additive_wt_percent",
        "wt%",
    ],
    "cof_delta": [
        "cof delta",
        "cof_delta",
        "delta cof",
        "cof increase",
        "coefficient of friction increase",
        "friction coefficient increase",
        "friction coefficient change",
        "friction coefficient increase range",
        "increase range of friction coefficient",
    ],
    "particle_size": [
        "particle size",
        "particle_size",
        "nanoparticle size",
        "grain size",
        "average particle size",
    ],
    "sliding_speed": [
        "sliding speed",
        "sliding_speed",
        "speed",
        "velocity",
        "sliding velocity",
    ],
    "normal_load": [
        "normal load",
        "normal_load",
        "load",
        "applied load",
    ],
    "temperature": [
        "temperature",
        "temp",
        "test temperature",
    ],
    "water_content": [
        "water content",
        "water_content",
        "moisture",
        "humidity",
    ],
}


_UNIT_TOKENS = {
    "wt",
    "wtpercent",
    "wt_percent",
    "percent",
    "pct",
    "a",
    "ma",
    "ua",
    "v",
    "mv",
    "n",
    "mn",
    "mpa",
    "gpa",
    "pa",
    "nm",
    "um",
    "mm",
    "cm",
    "m",
    "c",
    "k",
    "ms",
    "rpm",
    "hz",
    "min",
    "s",
    "h",
}

_PUNCT_RE = re.compile(r"[^\w\s]")
_WS_RE = re.compile(r"\s+")


def rule_clean(key: str) -> str:
    """Collapse surface differences while keeping scientific identity tokens."""
    normalized = unicodedata.normalize("NFKD", str(key or ""))
    cleaned = normalized.encode("ascii", "ignore").decode("ascii")
    cleaned = cleaned.lower().strip()
    cleaned = cleaned.replace("_", " ").replace("-", " ")
    cleaned = _PUNCT_RE.sub(" ", cleaned)
    cleaned = _WS_RE.sub(" ", cleaned).strip()

    tokens = [token for token in cleaned.split(" ") if token]
    if len(tokens) > 1:
        tokens = [token for token in tokens if token not in _UNIT_TOKENS]
    return "_".join(tokens) if tokens else cleaned.replace(" ", "_")


class KeyNormalizer:
    """Normalize flexible-field keys using alias, rule, then semantic stages."""

    def __init__(
        self,
        aliases: Optional[dict[str, list[str]]] = None,
        embedder: Optional[Callable[[str], list[float]]] = None,
        semantic_threshold: float = 0.82,
    ):
        self.embedder = embedder
        self.semantic_threshold = semantic_threshold
        source = aliases if aliases is not None else DEFAULT_ALIASES
        self._canonicals: list[str] = list(source.keys())
        self._alias_to_canon: dict[str, str] = {}
        for canonical, alias_list in source.items():
            for alias in [canonical, *alias_list]:
                self._alias_to_canon[rule_clean(alias)] = canonical
        self._canon_vecs: dict[str, list[float]] = {}

    def normalize(self, raw_key: str) -> NormalizationResult:
        cleaned = rule_clean(raw_key)

        if cleaned in self._alias_to_canon:
            return NormalizationResult(
                raw_key=raw_key,
                canonical_key=self._alias_to_canon[cleaned],
                stage="alias",
                confidence=1.0,
                resolved=True,
                notes="exact alias match",
            )

        if cleaned in self._canonicals:
            return NormalizationResult(
                raw_key=raw_key,
                canonical_key=cleaned,
                stage="rule",
                confidence=1.0,
                resolved=True,
                notes="rule-cleaned to existing canonical",
            )

        if self.embedder is not None:
            best_canonical, similarity = self._nearest_canonical(cleaned)
            if best_canonical is not None and similarity + 1e-12 >= self.semantic_threshold:
                return NormalizationResult(
                    raw_key=raw_key,
                    canonical_key=cleaned,
                    stage="semantic",
                    confidence=similarity,
                    suggested_merge=best_canonical,
                    resolved=False,
                    notes=f"possible same-as '{best_canonical}' (sim={similarity:.3f}); NOT auto-merged",
                )

        return NormalizationResult(
            raw_key=raw_key,
            canonical_key=cleaned,
            stage="new",
            confidence=1.0,
            resolved=False,
            notes="new field; preserved as provisional canonical, pending frequency audit",
        )

    def register_merge(self, alias_key: str, canonical_key: str) -> None:
        self._alias_to_canon[rule_clean(alias_key)] = canonical_key
        if canonical_key not in self._canonicals:
            self._canonicals.append(canonical_key)

    def add_canonical(self, canonical_key: str) -> None:
        cleaned = rule_clean(canonical_key)
        if cleaned not in self._canonicals:
            self._canonicals.append(cleaned)
            self._alias_to_canon[cleaned] = cleaned

    def _nearest_canonical(self, cleaned_key: str) -> tuple[str | None, float]:
        if self.embedder is None or not self._canonicals:
            return None, 0.0
        vector = self.embedder(cleaned_key)
        best_canonical = None
        best_similarity = -1.0
        for canonical in self._canonicals:
            canonical_vector = self._canon_vecs.get(canonical)
            if canonical_vector is None:
                canonical_vector = self.embedder(canonical)
                self._canon_vecs[canonical] = canonical_vector
            similarity = _cosine(vector, canonical_vector)
            if similarity > best_similarity:
                best_canonical = canonical
                best_similarity = similarity
        return best_canonical, best_similarity


def _cosine(a: list[float], b: list[float]) -> float:
    numerator = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(y * y for y in b) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return numerator / (norm_a * norm_b)
