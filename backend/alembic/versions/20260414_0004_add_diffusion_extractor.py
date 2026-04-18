"""add diffusion extractor tables

Revision ID: 20260414_0004
Revises: 20260404_0003
Create Date: 2026-04-14 19:20:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260414_0004"
down_revision = "20260404_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "extraction_runs",
        sa.Column("extractor_type", sa.String(length=32), nullable=False, server_default="tribology"),
    )
    op.create_index("ix_extraction_runs_extractor_type", "extraction_runs", ["extractor_type"], unique=False)

    op.create_table(
        "diffusion_records",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("literature_id", sa.Integer(), nullable=False),
        sa.Column("system_name", sa.String(length=255), nullable=True),
        sa.Column("confinement_material_class", sa.String(length=64), nullable=True),
        sa.Column("confinement_geometry_class", sa.String(length=64), nullable=True),
        sa.Column("surface_functional_groups", sa.String(length=255), nullable=True),
        sa.Column("confinement_dimensionality", sa.String(length=16), nullable=True),
        sa.Column("ionic_liquid", sa.String(length=255), nullable=True),
        sa.Column("d_total", sa.Float(), nullable=True),
        sa.Column("d_cation", sa.Float(), nullable=True),
        sa.Column("d_anion", sa.Float(), nullable=True),
        sa.Column("d_unit", sa.String(length=64), nullable=True),
        sa.Column("temperature_value", sa.Float(), nullable=True),
        sa.Column("confinement_scale_value", sa.Float(), nullable=True),
        sa.Column("confinement_scale_unit", sa.String(length=32), nullable=True),
        sa.Column("source", sa.String(length=200), nullable=True),
        sa.Column("source_page", sa.Integer(), nullable=True),
        sa.Column("source_bbox", sa.String(length=200), nullable=True),
        sa.Column("evidence", sa.Text(), nullable=True),
        sa.Column("provider", sa.String(length=64), nullable=True),
        sa.Column("prompt_version", sa.String(length=64), nullable=True),
        sa.Column("raw_model_output", sa.Text(), nullable=True),
        sa.Column("review_status", sa.String(length=32), nullable=True),
        sa.Column("record_origin", sa.String(length=32), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=False, server_default=sa.text("0.9")),
        sa.Column("novel_features_json", sa.Text(), nullable=True),
        sa.Column("smiles", sa.String(length=1000), nullable=True),
        sa.Column("rdkit_features_json", sa.Text(), nullable=True),
        sa.Column("extracted_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.ForeignKeyConstraint(["literature_id"], ["literature.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_diffusion_records_literature_id", "diffusion_records", ["literature_id"], unique=False)

    op.create_table(
        "diffusion_candidates",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("literature_id", sa.Integer(), nullable=False),
        sa.Column("promoted_record_id", sa.Integer(), nullable=True),
        sa.Column("system_name", sa.String(length=255), nullable=True),
        sa.Column("confinement_material_class", sa.String(length=64), nullable=True),
        sa.Column("confinement_geometry_class", sa.String(length=64), nullable=True),
        sa.Column("surface_functional_groups", sa.String(length=255), nullable=True),
        sa.Column("confinement_dimensionality", sa.String(length=16), nullable=True),
        sa.Column("ionic_liquid", sa.String(length=255), nullable=True),
        sa.Column("d_total", sa.Float(), nullable=True),
        sa.Column("d_cation", sa.Float(), nullable=True),
        sa.Column("d_anion", sa.Float(), nullable=True),
        sa.Column("d_unit", sa.String(length=64), nullable=True),
        sa.Column("temperature_value", sa.Float(), nullable=True),
        sa.Column("confinement_scale_value", sa.Float(), nullable=True),
        sa.Column("confinement_scale_unit", sa.String(length=32), nullable=True),
        sa.Column("source", sa.String(length=200), nullable=True),
        sa.Column("source_page", sa.Integer(), nullable=True),
        sa.Column("source_bbox", sa.String(length=200), nullable=True),
        sa.Column("evidence", sa.Text(), nullable=True),
        sa.Column("provider", sa.String(length=64), nullable=True),
        sa.Column("prompt_version", sa.String(length=64), nullable=True),
        sa.Column("raw_model_output", sa.Text(), nullable=True),
        sa.Column("review_status", sa.String(length=32), nullable=True),
        sa.Column("record_origin", sa.String(length=32), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=False, server_default=sa.text("0.9")),
        sa.Column("novel_features_json", sa.Text(), nullable=True),
        sa.Column("smiles", sa.String(length=1000), nullable=True),
        sa.Column("rdkit_features_json", sa.Text(), nullable=True),
        sa.Column("extracted_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("promoted_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["literature_id"], ["literature.id"]),
        sa.ForeignKeyConstraint(["promoted_record_id"], ["diffusion_records.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_diffusion_candidates_literature_id", "diffusion_candidates", ["literature_id"], unique=False)
    op.create_index("ix_diffusion_candidates_promoted_record_id", "diffusion_candidates", ["promoted_record_id"], unique=False)

    op.create_table(
        "diffusion_feature_sets",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("literature_id", sa.Integer(), nullable=False),
        sa.Column("candidate_id", sa.Integer(), nullable=True),
        sa.Column("record_id", sa.Integer(), nullable=True),
        sa.Column("ionic_liquid", sa.String(length=255), nullable=True),
        sa.Column("smiles", sa.String(length=1000), nullable=True),
        sa.Column("rdkit_features_json", sa.Text(), nullable=True),
        sa.Column("feature_version", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.ForeignKeyConstraint(["candidate_id"], ["diffusion_candidates.id"]),
        sa.ForeignKeyConstraint(["literature_id"], ["literature.id"]),
        sa.ForeignKeyConstraint(["record_id"], ["diffusion_records.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_diffusion_feature_sets_literature_id", "diffusion_feature_sets", ["literature_id"], unique=False)
    op.create_index("ix_diffusion_feature_sets_candidate_id", "diffusion_feature_sets", ["candidate_id"], unique=False)
    op.create_index("ix_diffusion_feature_sets_record_id", "diffusion_feature_sets", ["record_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_diffusion_feature_sets_record_id", table_name="diffusion_feature_sets")
    op.drop_index("ix_diffusion_feature_sets_candidate_id", table_name="diffusion_feature_sets")
    op.drop_index("ix_diffusion_feature_sets_literature_id", table_name="diffusion_feature_sets")
    op.drop_table("diffusion_feature_sets")

    op.drop_index("ix_diffusion_candidates_promoted_record_id", table_name="diffusion_candidates")
    op.drop_index("ix_diffusion_candidates_literature_id", table_name="diffusion_candidates")
    op.drop_table("diffusion_candidates")

    op.drop_index("ix_diffusion_records_literature_id", table_name="diffusion_records")
    op.drop_table("diffusion_records")

    op.drop_index("ix_extraction_runs_extractor_type", table_name="extraction_runs")
    op.drop_column("extraction_runs", "extractor_type")
