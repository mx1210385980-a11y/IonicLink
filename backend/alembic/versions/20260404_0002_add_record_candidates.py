"""add record candidates table

Revision ID: 20260404_0002
Revises: 20260404_0001
Create Date: 2026-04-04 20:40:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260404_0002"
down_revision = "20260404_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "record_candidates",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("literature_id", sa.Integer(), nullable=False),
        sa.Column("promoted_record_id", sa.Integer(), nullable=True),
        sa.Column("material_name", sa.String(length=255), nullable=False),
        sa.Column("lubricant", sa.String(length=255), nullable=False),
        sa.Column("cof_value", sa.Float(), nullable=True),
        sa.Column("cof_operator", sa.String(length=10), nullable=True),
        sa.Column("cof_raw", sa.String(length=100), nullable=True),
        sa.Column("load_value", sa.String(length=100), nullable=True),
        sa.Column("load_raw", sa.String(length=100), nullable=True),
        sa.Column("speed_value", sa.String(length=100), nullable=True),
        sa.Column("temperature", sa.String(length=100), nullable=True),
        sa.Column("potential", sa.String(length=50), nullable=True),
        sa.Column("water_content", sa.String(length=50), nullable=True),
        sa.Column("probe_material", sa.String(length=255), nullable=True),
        sa.Column("probe_geometry", sa.String(length=100), nullable=True),
        sa.Column("probe_radius", sa.String(length=100), nullable=True),
        sa.Column("probe_roughness", sa.String(length=100), nullable=True),
        sa.Column("substrate_material", sa.String(length=255), nullable=True),
        sa.Column("substrate_coating", sa.String(length=255), nullable=True),
        sa.Column("substrate_roughness", sa.String(length=100), nullable=True),
        sa.Column("surface_roughness", sa.String(length=100), nullable=True),
        sa.Column("residual_film_thickness_d", sa.String(length=100), nullable=True),
        sa.Column("layer_spacing_delta", sa.String(length=100), nullable=True),
        sa.Column("film_thickness", sa.String(length=100), nullable=True),
        sa.Column("mol_ratio", sa.String(length=50), nullable=True),
        sa.Column("cation", sa.String(length=100), nullable=True),
        sa.Column("anion", sa.String(length=100), nullable=True),
        sa.Column("cation_smiles", sa.String(length=500), nullable=True),
        sa.Column("anion_smiles", sa.String(length=500), nullable=True),
        sa.Column("il_smiles", sa.String(length=500), nullable=True),
        sa.Column("il_inchikey", sa.String(length=27), nullable=True),
        sa.Column("alkyl_chain_length", sa.Integer(), nullable=True),
        sa.Column("extracted_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("confidence", sa.Float(), nullable=False, server_default=sa.text("0.9")),
        sa.Column("sample_id", sa.String(length=64), nullable=True),
        sa.Column("series_id", sa.String(length=64), nullable=True),
        sa.Column("field_evidence_json", sa.Text(), nullable=True),
        sa.Column("review_status", sa.String(length=32), nullable=True),
        sa.Column("record_origin", sa.String(length=32), nullable=True),
        sa.Column("assembly_notes", sa.Text(), nullable=True),
        sa.Column("evidence", sa.Text(), nullable=True),
        sa.Column("evidence_page", sa.Integer(), nullable=True),
        sa.Column("evidence_bbox", sa.String(length=200), nullable=True),
        sa.Column("source", sa.String(length=200), nullable=True),
        sa.Column("source_page", sa.Integer(), nullable=True),
        sa.Column("source_figure", sa.String(length=120), nullable=True),
        sa.Column("promoted_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["literature_id"], ["literature.id"]),
        sa.ForeignKeyConstraint(["promoted_record_id"], ["tribology_data.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_record_candidates_literature_id", "record_candidates", ["literature_id"], unique=False)
    op.create_index("ix_record_candidates_promoted_record_id", "record_candidates", ["promoted_record_id"], unique=False)
    op.create_index("ix_record_candidates_il_inchikey", "record_candidates", ["il_inchikey"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_record_candidates_il_inchikey", table_name="record_candidates")
    op.drop_index("ix_record_candidates_promoted_record_id", table_name="record_candidates")
    op.drop_index("ix_record_candidates_literature_id", table_name="record_candidates")
    op.drop_table("record_candidates")
