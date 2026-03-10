"""SQLAlchemy ORM models for IonicLink."""

from datetime import datetime
from typing import List, Optional

from sqlalchemy import Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class Literature(Base):
    __tablename__ = "literature"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    doi: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False)

    title: Mapped[str] = mapped_column(String(500), nullable=False)
    authors: Mapped[str] = mapped_column(Text, nullable=False)
    journal: Mapped[str] = mapped_column(String(200), nullable=False)
    issn: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)

    year: Mapped[int] = mapped_column(Integer, nullable=False)
    volume: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    issue: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    pages: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    file_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    status: Mapped[str] = mapped_column(String(50), default="pending", index=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(default=func.now())

    tribology_data: Mapped[List["TribologyData"]] = relationship(
        "TribologyData",
        back_populates="literature",
        cascade="all, delete-orphan",
    )
    extraction_runs: Mapped[List["ExtractionRun"]] = relationship(
        "ExtractionRun",
        back_populates="literature",
        cascade="all, delete-orphan",
    )


class TribologyData(Base):
    __tablename__ = "tribology_data"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    literature_id: Mapped[int] = mapped_column(ForeignKey("literature.id"), nullable=False)

    material_name: Mapped[str] = mapped_column(String(255), nullable=False)
    lubricant: Mapped[str] = mapped_column(String(255), nullable=False)

    cof_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    cof_operator: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    cof_raw: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    load_value: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    load_raw: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    speed_value: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    temperature: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    potential: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    water_content: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    surface_roughness: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    residual_film_thickness_d: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    layer_spacing_delta: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    film_thickness: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    mol_ratio: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    cation: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    anion: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    cation_smiles: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    anion_smiles: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    il_smiles: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    il_inchikey: Mapped[Optional[str]] = mapped_column(String(27), nullable=True, index=True)
    alkyl_chain_length: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    extracted_at: Mapped[datetime] = mapped_column(default=func.now())
    confidence: Mapped[float] = mapped_column(Float, default=0.9)

    evidence: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    evidence_page: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    evidence_bbox: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)

    source: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    source_page: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    source_figure: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)

    literature: Mapped["Literature"] = relationship("Literature", back_populates="tribology_data")


class ExtractionRun(Base):
    __tablename__ = "extraction_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    literature_id: Mapped[int] = mapped_column(ForeignKey("literature.id"), nullable=False, index=True)

    profile: Mapped[str] = mapped_column(String(32), default="high_accuracy")
    status: Mapped[str] = mapped_column(String(32), default="running", index=True)

    candidate_count: Mapped[int] = mapped_column(Integer, default=0)
    final_count: Mapped[int] = mapped_column(Integer, default=0)

    dropped_by_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    page_coverage: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    summary_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(default=func.now())
    updated_at: Mapped[datetime] = mapped_column(default=func.now(), onupdate=func.now())

    literature: Mapped["Literature"] = relationship("Literature", back_populates="extraction_runs")
    candidates: Mapped[List["ExtractionCandidate"]] = relationship(
        "ExtractionCandidate",
        back_populates="run",
        cascade="all, delete-orphan",
    )


class ExtractionCandidate(Base):
    __tablename__ = "extraction_candidates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("extraction_runs.run_id"), index=True, nullable=False)

    stage: Mapped[str] = mapped_column(String(32), nullable=False)
    modality: Mapped[str] = mapped_column(String(32), nullable=False)
    page: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    source_figure: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    panel_label: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)

    raw_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    normalized_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    drop_reason: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    merged_into: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)

    created_at: Mapped[datetime] = mapped_column(default=func.now())

    run: Mapped["ExtractionRun"] = relationship("ExtractionRun", back_populates="candidates")
