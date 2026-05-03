"""add shear rate to tribology records

Revision ID: 20260501_0009
Revises: 20260501_0008
Create Date: 2026-05-01
"""

from alembic import op
import sqlalchemy as sa


revision = "20260501_0009"
down_revision = "20260501_0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tribology_data", sa.Column("shear_rate", sa.String(length=100), nullable=True))
    op.add_column("record_candidates", sa.Column("shear_rate", sa.String(length=100), nullable=True))


def downgrade() -> None:
    op.drop_column("record_candidates", "shear_rate")
    op.drop_column("tribology_data", "shear_rate")
