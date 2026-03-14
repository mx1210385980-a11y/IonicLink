"""SQLAlchemy ORM models for IonicLink."""

from datetime import datetime
from typing import List, Optional

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class ResearchGroup(Base):
    __tablename__ = "research_groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    slug: Mapped[str] = mapped_column(String(120), unique=True, index=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(default=func.now())

    users: Mapped[List["User"]] = relationship("User", back_populates="group")
    workspaces: Mapped[List["Workspace"]] = relationship(
        "Workspace",
        back_populates="group",
        cascade="all, delete-orphan",
    )
    literature: Mapped[List["Literature"]] = relationship("Literature", back_populates="group")
    cleaned_datasets: Mapped[List["CleanedDataset"]] = relationship("CleanedDataset", back_populates="group")


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(80), unique=True, index=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(40), default="researcher", index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("research_groups.id"), index=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(default=func.now())

    group: Mapped["ResearchGroup"] = relationship("ResearchGroup", back_populates="users")
    workspaces: Mapped[List["Workspace"]] = relationship("Workspace", back_populates="owner")
    created_literature: Mapped[List["Literature"]] = relationship("Literature", back_populates="created_by")
    cleaned_datasets: Mapped[List["CleanedDataset"]] = relationship("CleanedDataset", back_populates="created_by")


class Workspace(Base):
    __tablename__ = "workspaces"
    __table_args__ = (UniqueConstraint("group_id", "slug", name="uq_workspaces_group_slug"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("research_groups.id"), index=True, nullable=False)
    owner_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), index=True, nullable=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    slug: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_personal: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(default=func.now())

    group: Mapped["ResearchGroup"] = relationship("ResearchGroup", back_populates="workspaces")
    owner: Mapped[Optional["User"]] = relationship("User", back_populates="workspaces")
    literature: Mapped[List["Literature"]] = relationship("Literature", back_populates="workspace")
    cleaned_datasets: Mapped[List["CleanedDataset"]] = relationship("CleanedDataset", back_populates="workspace")


class CleanedDataset(Base):
    __tablename__ = "cleaned_datasets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    target_key: Mapped[str] = mapped_column(String(40), default="cof", nullable=False)

    source_scope_type: Mapped[str] = mapped_column(String(32), nullable=False, default="group_library")
    source_scope_key: Mapped[str] = mapped_column(String(64), nullable=False, default="group_library")

    group_id: Mapped[int] = mapped_column(ForeignKey("research_groups.id"), index=True, nullable=False)
    workspace_id: Mapped[Optional[int]] = mapped_column(ForeignKey("workspaces.id"), index=True, nullable=True)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    scope_type: Mapped[str] = mapped_column(String(32), default="workspace", index=True, nullable=False)
    scope_key: Mapped[str] = mapped_column(String(64), index=True, nullable=False)

    row_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    config_json: Mapped[str] = mapped_column(Text, nullable=False)
    summary_json: Mapped[str] = mapped_column(Text, nullable=False)
    rows_json: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(default=func.now())

    group: Mapped["ResearchGroup"] = relationship("ResearchGroup", back_populates="cleaned_datasets")
    workspace: Mapped[Optional["Workspace"]] = relationship("Workspace", back_populates="cleaned_datasets")
    created_by: Mapped["User"] = relationship("User", back_populates="cleaned_datasets")


class Literature(Base):
    __tablename__ = "literature"
    __table_args__ = (UniqueConstraint("group_id", "scope_key", "doi", name="uq_literature_scope_doi"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    doi: Mapped[str] = mapped_column(String(100), index=True, nullable=False)

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

    group_id: Mapped[Optional[int]] = mapped_column(ForeignKey("research_groups.id"), index=True, nullable=True)
    workspace_id: Mapped[Optional[int]] = mapped_column(ForeignKey("workspaces.id"), index=True, nullable=True)
    created_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), index=True, nullable=True)
    scope_type: Mapped[str] = mapped_column(String(32), default="group_library", index=True)
    scope_key: Mapped[str] = mapped_column(String(64), default="group_library")

    status: Mapped[str] = mapped_column(String(50), default="pending", index=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(default=func.now())

    group: Mapped[Optional["ResearchGroup"]] = relationship("ResearchGroup", back_populates="literature")
    workspace: Mapped[Optional["Workspace"]] = relationship("Workspace", back_populates="literature")
    created_by: Mapped[Optional["User"]] = relationship("User", back_populates="created_literature")
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
    probe_material: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    probe_geometry: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    probe_radius: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    probe_roughness: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    substrate_material: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    substrate_coating: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    substrate_roughness: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
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
