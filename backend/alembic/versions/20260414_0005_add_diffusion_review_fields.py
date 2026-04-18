"""add diffusion review fields

Revision ID: 20260414_0005
Revises: 20260414_0004
Create Date: 2026-04-14 21:10:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260414_0005"
down_revision = "20260414_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("diffusion_records", sa.Column("field_evidence_json", sa.Text(), nullable=True))
    op.add_column("diffusion_records", sa.Column("assembly_notes", sa.Text(), nullable=True))
    op.add_column("diffusion_candidates", sa.Column("field_evidence_json", sa.Text(), nullable=True))
    op.add_column("diffusion_candidates", sa.Column("assembly_notes", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("diffusion_candidates", "assembly_notes")
    op.drop_column("diffusion_candidates", "field_evidence_json")
    op.drop_column("diffusion_records", "assembly_notes")
    op.drop_column("diffusion_records", "field_evidence_json")
