"""add structured load and regime fields

Revision ID: 20260502_0012
Revises: 20260502_0011
Create Date: 2026-05-02
"""

from alembic import op
import sqlalchemy as sa


revision = "20260502_0012"
down_revision = "20260502_0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tribology_data", sa.Column("load_conditions_json", sa.Text(), nullable=True))
    op.add_column("tribology_data", sa.Column("tribological_system_json", sa.Text(), nullable=True))
    op.add_column("record_candidates", sa.Column("load_conditions_json", sa.Text(), nullable=True))
    op.add_column("record_candidates", sa.Column("tribological_system_json", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("record_candidates", "tribological_system_json")
    op.drop_column("record_candidates", "load_conditions_json")
    op.drop_column("tribology_data", "tribological_system_json")
    op.drop_column("tribology_data", "load_conditions_json")
