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
    model_training_runs: Mapped[List["ModelTrainingRun"]] = relationship(
        "ModelTrainingRun",
        back_populates="group",
        cascade="all, delete-orphan",
    )
    registered_models: Mapped[List["RegisteredModel"]] = relationship(
        "RegisteredModel",
        back_populates="group",
        cascade="all, delete-orphan",
    )
    model_prediction_runs: Mapped[List["ModelPredictionRun"]] = relationship(
        "ModelPredictionRun",
        back_populates="group",
        cascade="all, delete-orphan",
    )


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
    created_literature: Mapped[List["Literature"]] = relationship(
        "Literature",
        back_populates="created_by",
        foreign_keys="Literature.created_by_user_id",
    )
    submitted_literature: Mapped[List["Literature"]] = relationship(
        "Literature",
        back_populates="submitted_by",
        foreign_keys="Literature.submitted_by_user_id",
    )
    reviewed_literature: Mapped[List["Literature"]] = relationship(
        "Literature",
        back_populates="reviewed_by",
        foreign_keys="Literature.reviewed_by_user_id",
    )
    cleaned_datasets: Mapped[List["CleanedDataset"]] = relationship("CleanedDataset", back_populates="created_by")
    activity_logs: Mapped[List["UserActivityLog"]] = relationship(
        "UserActivityLog",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    model_training_runs: Mapped[List["ModelTrainingRun"]] = relationship(
        "ModelTrainingRun",
        back_populates="owner",
        cascade="all, delete-orphan",
    )
    registered_models: Mapped[List["RegisteredModel"]] = relationship(
        "RegisteredModel",
        back_populates="created_by",
        cascade="all, delete-orphan",
    )
    model_prediction_runs: Mapped[List["ModelPredictionRun"]] = relationship(
        "ModelPredictionRun",
        back_populates="created_by",
        cascade="all, delete-orphan",
    )
    figure_crop_overrides: Mapped[List["FigureCropOverride"]] = relationship(
        "FigureCropOverride",
        back_populates="created_by",
        foreign_keys="FigureCropOverride.created_by_user_id",
    )


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
    model_training_runs: Mapped[List["ModelTrainingRun"]] = relationship(
        "ModelTrainingRun",
        back_populates="workspace",
    )
    registered_models: Mapped[List["RegisteredModel"]] = relationship(
        "RegisteredModel",
        back_populates="workspace",
    )
    model_prediction_runs: Mapped[List["ModelPredictionRun"]] = relationship(
        "ModelPredictionRun",
        back_populates="workspace",
    )


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
    model_training_runs: Mapped[List["ModelTrainingRun"]] = relationship(
        "ModelTrainingRun",
        back_populates="cleaned_dataset",
    )
    registered_models: Mapped[List["RegisteredModel"]] = relationship(
        "RegisteredModel",
        back_populates="source_dataset",
    )


class ModelTrainingRun(Base):
    __tablename__ = "model_training_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="queued", index=True, nullable=False)
    target_column: Mapped[str] = mapped_column(String(80), nullable=False)
    algorithm: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    split_strategy: Mapped[str] = mapped_column(String(64), default="random_holdout", nullable=False)

    group_id: Mapped[int] = mapped_column(ForeignKey("research_groups.id"), index=True, nullable=False)
    workspace_id: Mapped[Optional[int]] = mapped_column(ForeignKey("workspaces.id"), index=True, nullable=True)
    cleaned_dataset_id: Mapped[Optional[int]] = mapped_column(ForeignKey("cleaned_datasets.id"), index=True, nullable=True)
    owner_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    scope_type: Mapped[str] = mapped_column(String(32), default="workspace", index=True, nullable=False)
    scope_key: Mapped[str] = mapped_column(String(64), index=True, nullable=False)

    usable_records: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    config_json: Mapped[str] = mapped_column(Text, nullable=False)
    summary_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=func.now())
    started_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)
    finished_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)

    group: Mapped["ResearchGroup"] = relationship("ResearchGroup", back_populates="model_training_runs")
    workspace: Mapped[Optional["Workspace"]] = relationship("Workspace", back_populates="model_training_runs")
    cleaned_dataset: Mapped[Optional["CleanedDataset"]] = relationship("CleanedDataset", back_populates="model_training_runs")
    owner: Mapped["User"] = relationship("User", back_populates="model_training_runs")
    registered_models: Mapped[List["RegisteredModel"]] = relationship(
        "RegisteredModel",
        back_populates="training_run",
    )


class RegisteredModel(Base):
    __tablename__ = "registered_models"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    training_run_id: Mapped[int] = mapped_column(ForeignKey("model_training_runs.id"), index=True, nullable=False)
    source_dataset_id: Mapped[Optional[int]] = mapped_column(ForeignKey("cleaned_datasets.id"), index=True, nullable=True)

    group_id: Mapped[int] = mapped_column(ForeignKey("research_groups.id"), index=True, nullable=False)
    workspace_id: Mapped[Optional[int]] = mapped_column(ForeignKey("workspaces.id"), index=True, nullable=True)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    scope_type: Mapped[str] = mapped_column(String(32), default="workspace", index=True, nullable=False)
    scope_key: Mapped[str] = mapped_column(String(64), index=True, nullable=False)

    config_json: Mapped[str] = mapped_column(Text, nullable=False)
    summary_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    training_view: Mapped[str] = mapped_column(String(64), default="all", index=True, nullable=False)
    is_recommended: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(default=func.now())

    training_run: Mapped["ModelTrainingRun"] = relationship("ModelTrainingRun", back_populates="registered_models")
    source_dataset: Mapped[Optional["CleanedDataset"]] = relationship("CleanedDataset", back_populates="registered_models")
    group: Mapped["ResearchGroup"] = relationship("ResearchGroup", back_populates="registered_models")
    workspace: Mapped[Optional["Workspace"]] = relationship("Workspace", back_populates="registered_models")
    created_by: Mapped["User"] = relationship("User", back_populates="registered_models")


class ModelPredictionRun(Base):
    __tablename__ = "model_prediction_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    registered_model_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("registered_models.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    training_run_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("model_training_runs.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    source_dataset_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("cleaned_datasets.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    target_dataset_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("cleaned_datasets.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )

    group_id: Mapped[int] = mapped_column(ForeignKey("research_groups.id"), index=True, nullable=False)
    workspace_id: Mapped[Optional[int]] = mapped_column(ForeignKey("workspaces.id"), index=True, nullable=True)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    scope_type: Mapped[str] = mapped_column(String(32), default="workspace", index=True, nullable=False)
    scope_key: Mapped[str] = mapped_column(String(64), index=True, nullable=False)

    registered_model_name: Mapped[str] = mapped_column(String(180), nullable=False)
    training_view: Mapped[str] = mapped_column(String(64), default="all", index=True, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="completed", index=True, nullable=False)
    target_input_rows: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    target_predicted_rows: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    dropped_outside_training_view: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    scored_rows: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    feature_dimensions: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    r2: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    rmse: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    mae: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    feature_columns_json: Mapped[str] = mapped_column(Text, nullable=False)
    preview_rows_json: Mapped[str] = mapped_column(Text, nullable=False)
    result_json: Mapped[str] = mapped_column(Text, nullable=False)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=func.now())

    registered_model: Mapped[Optional["RegisteredModel"]] = relationship("RegisteredModel")
    training_run: Mapped[Optional["ModelTrainingRun"]] = relationship("ModelTrainingRun")
    source_dataset: Mapped[Optional["CleanedDataset"]] = relationship(
        "CleanedDataset",
        foreign_keys=[source_dataset_id],
    )
    target_dataset: Mapped[Optional["CleanedDataset"]] = relationship(
        "CleanedDataset",
        foreign_keys=[target_dataset_id],
    )
    group: Mapped["ResearchGroup"] = relationship("ResearchGroup", back_populates="model_prediction_runs")
    workspace: Mapped[Optional["Workspace"]] = relationship("Workspace", back_populates="model_prediction_runs")
    created_by: Mapped["User"] = relationship("User", back_populates="model_prediction_runs")


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
    file_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)

    group_id: Mapped[Optional[int]] = mapped_column(ForeignKey("research_groups.id"), index=True, nullable=True)
    workspace_id: Mapped[Optional[int]] = mapped_column(ForeignKey("workspaces.id"), index=True, nullable=True)
    created_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), index=True, nullable=True)
    scope_type: Mapped[str] = mapped_column(String(32), default="group_library", index=True)
    scope_key: Mapped[str] = mapped_column(String(64), default="group_library")

    status: Mapped[str] = mapped_column(String(50), default="pending", index=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    submission_status: Mapped[Optional[str]] = mapped_column(String(32), default="draft", index=True, nullable=True)
    submission_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    submitted_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)
    submitted_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), index=True, nullable=True)
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)
    reviewed_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), index=True, nullable=True)
    review_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    promoted_literature_id: Mapped[Optional[int]] = mapped_column(ForeignKey("literature.id"), index=True, nullable=True)

    created_at: Mapped[datetime] = mapped_column(default=func.now())

    group: Mapped[Optional["ResearchGroup"]] = relationship("ResearchGroup", back_populates="literature")
    workspace: Mapped[Optional["Workspace"]] = relationship("Workspace", back_populates="literature")
    created_by: Mapped[Optional["User"]] = relationship(
        "User",
        back_populates="created_literature",
        foreign_keys=[created_by_user_id],
    )
    submitted_by: Mapped[Optional["User"]] = relationship(
        "User",
        back_populates="submitted_literature",
        foreign_keys=[submitted_by_user_id],
    )
    reviewed_by: Mapped[Optional["User"]] = relationship(
        "User",
        back_populates="reviewed_literature",
        foreign_keys=[reviewed_by_user_id],
    )
    promoted_literature: Mapped[Optional["Literature"]] = relationship("Literature", remote_side=[id])
    tribology_data: Mapped[List["TribologyData"]] = relationship(
        "TribologyData",
        back_populates="literature",
        cascade="all, delete-orphan",
    )
    record_candidates: Mapped[List["RecordCandidate"]] = relationship(
        "RecordCandidate",
        back_populates="literature",
        cascade="all, delete-orphan",
    )
    extraction_runs: Mapped[List["ExtractionRun"]] = relationship(
        "ExtractionRun",
        back_populates="literature",
        cascade="all, delete-orphan",
    )
    reading_reports: Mapped[List["LiteratureReadingReport"]] = relationship(
        "LiteratureReadingReport",
        back_populates="literature",
        cascade="all, delete-orphan",
    )
    diffusion_candidates: Mapped[List["DiffusionCandidate"]] = relationship(
        "DiffusionCandidate",
        back_populates="literature",
        cascade="all, delete-orphan",
    )
    diffusion_records: Mapped[List["DiffusionRecord"]] = relationship(
        "DiffusionRecord",
        back_populates="literature",
        cascade="all, delete-orphan",
    )
    diffusion_feature_sets: Mapped[List["DiffusionFeatureSet"]] = relationship(
        "DiffusionFeatureSet",
        back_populates="literature",
        cascade="all, delete-orphan",
    )
    figure_crop_overrides: Mapped[List["FigureCropOverride"]] = relationship(
        "FigureCropOverride",
        back_populates="literature",
        cascade="all, delete-orphan",
    )


class LiteratureReadingReport(Base):
    __tablename__ = "literature_reading_reports"
    __table_args__ = (
        UniqueConstraint(
            "literature_id",
            "extractor_type",
            "prompt_version",
            name="uq_literature_reading_report_version",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    literature_id: Mapped[int] = mapped_column(ForeignKey("literature.id"), nullable=False, index=True)
    extractor_type: Mapped[str] = mapped_column(String(32), default="tribology", index=True, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="running", index=True, nullable=False)
    report_markdown: Mapped[str] = mapped_column(Text, default="", nullable=False)
    prompt_version: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    model: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    provider: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    source_summary_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=func.now())
    updated_at: Mapped[datetime] = mapped_column(default=func.now(), onupdate=func.now())

    literature: Mapped["Literature"] = relationship("Literature", back_populates="reading_reports")


class TribologyData(Base):
    __tablename__ = "tribology_data"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    literature_id: Mapped[int] = mapped_column(ForeignKey("literature.id"), nullable=False)

    material_name: Mapped[str] = mapped_column(String(255), nullable=False)
    lubricant: Mapped[str] = mapped_column(String(255), nullable=False)
    lubricant_components_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    lubricant_alias: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)

    cof_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    cof_operator: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    cof_raw: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    cof_extracted_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    load_value: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    load_raw: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    load_conditions_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    speed_value: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    speed_conditions_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    shear_rate: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
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
    regime: Mapped[Optional[str]] = mapped_column(String(160), nullable=True)
    tribological_system_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

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

    sample_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    series_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    field_evidence_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    review_status: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    record_origin: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    assembly_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    evidence: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    evidence_page: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    evidence_bbox: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)

    source: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    source_page: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    source_figure: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)

    literature: Mapped["Literature"] = relationship("Literature", back_populates="tribology_data")
    source_candidates: Mapped[List["RecordCandidate"]] = relationship(
        "RecordCandidate",
        back_populates="promoted_record",
    )


class RecordCandidate(Base):
    __tablename__ = "record_candidates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    literature_id: Mapped[int] = mapped_column(ForeignKey("literature.id"), nullable=False, index=True)
    promoted_record_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tribology_data.id"), nullable=True, index=True)

    material_name: Mapped[str] = mapped_column(String(255), nullable=False)
    lubricant: Mapped[str] = mapped_column(String(255), nullable=False)
    lubricant_components_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    lubricant_alias: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)

    cof_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    cof_operator: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    cof_raw: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    cof_extracted_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    load_value: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    load_raw: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    load_conditions_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    speed_value: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    speed_conditions_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    shear_rate: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
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
    regime: Mapped[Optional[str]] = mapped_column(String(160), nullable=True)
    tribological_system_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

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

    sample_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    series_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    field_evidence_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    review_status: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    record_origin: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    assembly_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    evidence: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    evidence_page: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    evidence_bbox: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)

    source: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    source_page: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    source_figure: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    promoted_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)

    literature: Mapped["Literature"] = relationship("Literature", back_populates="record_candidates")
    promoted_record: Mapped[Optional["TribologyData"]] = relationship("TribologyData", back_populates="source_candidates")


class ExtractionRun(Base):
    __tablename__ = "extraction_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    literature_id: Mapped[int] = mapped_column(ForeignKey("literature.id"), nullable=False, index=True)

    extractor_type: Mapped[str] = mapped_column(String(32), default="tribology", index=True)
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


class FigureCropOverride(Base):
    __tablename__ = "figure_crop_overrides"
    __table_args__ = (
        UniqueConstraint("literature_id", "normalized_label", "page", name="uq_figure_crop_override_target"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    literature_id: Mapped[int] = mapped_column(ForeignKey("literature.id"), nullable=False, index=True)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    normalized_label: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    page: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    caption: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    bbox_json: Mapped[str] = mapped_column(Text, nullable=False)
    algorithm_bbox_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    preview_image_b64: Mapped[str] = mapped_column(Text, nullable=False)
    algorithm_version: Mapped[str] = mapped_column(String(80), default="pdf-visual-segmentation.v1", nullable=False)

    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    updated_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), index=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=func.now())
    updated_at: Mapped[datetime] = mapped_column(default=func.now(), onupdate=func.now())

    literature: Mapped["Literature"] = relationship("Literature", back_populates="figure_crop_overrides")
    created_by: Mapped["User"] = relationship(
        "User",
        back_populates="figure_crop_overrides",
        foreign_keys=[created_by_user_id],
    )
    updated_by: Mapped[Optional["User"]] = relationship("User", foreign_keys=[updated_by_user_id])


class DiffusionRecord(Base):
    __tablename__ = "diffusion_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    literature_id: Mapped[int] = mapped_column(ForeignKey("literature.id"), nullable=False, index=True)

    system_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    confinement_material_class: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    confinement_geometry_class: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    surface_functional_groups: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    confinement_dimensionality: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    ionic_liquid: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    d_total: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    d_cation: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    d_anion: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    d_unit: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    temperature_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    confinement_scale_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    confinement_scale_unit: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)

    source: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    source_page: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    source_bbox: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    evidence: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    provider: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    prompt_version: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    raw_model_output: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    field_evidence_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    review_status: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    record_origin: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    assembly_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    confidence: Mapped[float] = mapped_column(Float, default=0.9)

    novel_features_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    smiles: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    rdkit_features_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    extracted_at: Mapped[datetime] = mapped_column(default=func.now())

    literature: Mapped["Literature"] = relationship("Literature", back_populates="diffusion_records")
    source_candidates: Mapped[List["DiffusionCandidate"]] = relationship(
        "DiffusionCandidate",
        back_populates="promoted_record",
    )
    feature_sets: Mapped[List["DiffusionFeatureSet"]] = relationship(
        "DiffusionFeatureSet",
        back_populates="record",
        cascade="all, delete-orphan",
    )


class DiffusionCandidate(Base):
    __tablename__ = "diffusion_candidates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    literature_id: Mapped[int] = mapped_column(ForeignKey("literature.id"), nullable=False, index=True)
    promoted_record_id: Mapped[Optional[int]] = mapped_column(ForeignKey("diffusion_records.id"), nullable=True, index=True)

    system_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    confinement_material_class: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    confinement_geometry_class: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    surface_functional_groups: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    confinement_dimensionality: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    ionic_liquid: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    d_total: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    d_cation: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    d_anion: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    d_unit: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    temperature_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    confinement_scale_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    confinement_scale_unit: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)

    source: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    source_page: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    source_bbox: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    evidence: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    provider: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    prompt_version: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    raw_model_output: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    field_evidence_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    review_status: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    record_origin: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    assembly_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    confidence: Mapped[float] = mapped_column(Float, default=0.9)

    novel_features_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    smiles: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    rdkit_features_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    extracted_at: Mapped[datetime] = mapped_column(default=func.now())
    promoted_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)

    literature: Mapped["Literature"] = relationship("Literature", back_populates="diffusion_candidates")
    promoted_record: Mapped[Optional["DiffusionRecord"]] = relationship("DiffusionRecord", back_populates="source_candidates")
    feature_sets: Mapped[List["DiffusionFeatureSet"]] = relationship(
        "DiffusionFeatureSet",
        back_populates="candidate",
        cascade="all, delete-orphan",
    )


class DiffusionFeatureSet(Base):
    __tablename__ = "diffusion_feature_sets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    literature_id: Mapped[int] = mapped_column(ForeignKey("literature.id"), nullable=False, index=True)
    candidate_id: Mapped[Optional[int]] = mapped_column(ForeignKey("diffusion_candidates.id"), nullable=True, index=True)
    record_id: Mapped[Optional[int]] = mapped_column(ForeignKey("diffusion_records.id"), nullable=True, index=True)

    ionic_liquid: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    smiles: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    rdkit_features_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    feature_version: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=func.now())

    literature: Mapped["Literature"] = relationship("Literature", back_populates="diffusion_feature_sets")
    candidate: Mapped[Optional["DiffusionCandidate"]] = relationship("DiffusionCandidate", back_populates="feature_sets")
    record: Mapped[Optional["DiffusionRecord"]] = relationship("DiffusionRecord", back_populates="feature_sets")


class UserActivityLog(Base):
    """用户活动日志表，记录所有用户操作用于监控和统计"""
    __tablename__ = "user_activity_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    group_id: Mapped[int] = mapped_column(ForeignKey("research_groups.id"), index=True, nullable=False)

    # 操作类型: login, logout, upload_pdf, extract_data, view_record, edit_record,
    #          delete_record, sync_data, train_model, clean_data, view_dashboard
    action_type: Mapped[str] = mapped_column(String(50), index=True, nullable=False)

    # JSON格式的详细信息，如 {"literature_id": 123, "filename": "paper.pdf"}
    action_detail: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # 关联的资源类型和ID
    resource_type: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    resource_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # 请求元数据
    ip_address: Mapped[Optional[str]] = mapped_column(String(45), nullable=True)  # 支持IPv6
    user_agent: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    created_at: Mapped[datetime] = mapped_column(default=func.now(), index=True)

    # 关系
    user: Mapped["User"] = relationship("User", back_populates="activity_logs")
    group: Mapped["ResearchGroup"] = relationship("ResearchGroup")
