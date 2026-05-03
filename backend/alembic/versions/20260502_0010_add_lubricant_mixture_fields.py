"""add lubricant mixture fields

Revision ID: 20260502_0010
Revises: 20260501_0009
Create Date: 2026-05-02
"""

from alembic import op
import sqlalchemy as sa


revision = "20260502_0010"
down_revision = "20260501_0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tribology_data", sa.Column("lubricant_components_json", sa.Text(), nullable=True))
    op.add_column("tribology_data", sa.Column("lubricant_alias", sa.String(length=80), nullable=True))
    op.add_column("record_candidates", sa.Column("lubricant_components_json", sa.Text(), nullable=True))
    op.add_column("record_candidates", sa.Column("lubricant_alias", sa.String(length=80), nullable=True))


def downgrade() -> None:
    op.drop_column("record_candidates", "lubricant_alias")
    op.drop_column("record_candidates", "lubricant_components_json")
    op.drop_column("tribology_data", "lubricant_alias")
    op.drop_column("tribology_data", "lubricant_components_json")
