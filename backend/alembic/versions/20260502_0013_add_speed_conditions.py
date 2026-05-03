"""add structured speed condition fields

Revision ID: 20260502_0013
Revises: 20260502_0012
Create Date: 2026-05-02
"""

from alembic import op
import sqlalchemy as sa


revision = "20260502_0013"
down_revision = "20260502_0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tribology_data", sa.Column("speed_conditions_json", sa.Text(), nullable=True))
    op.add_column("record_candidates", sa.Column("speed_conditions_json", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("record_candidates", "speed_conditions_json")
    op.drop_column("tribology_data", "speed_conditions_json")
