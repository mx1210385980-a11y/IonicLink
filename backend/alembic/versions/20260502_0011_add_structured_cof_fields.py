"""add structured cof fields

Revision ID: 20260502_0011
Revises: 20260502_0010
Create Date: 2026-05-02
"""

from alembic import op
import sqlalchemy as sa


revision = "20260502_0011"
down_revision = "20260502_0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tribology_data", sa.Column("cof_extracted_json", sa.Text(), nullable=True))
    op.add_column("record_candidates", sa.Column("cof_extracted_json", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("record_candidates", "cof_extracted_json")
    op.drop_column("tribology_data", "cof_extracted_json")
