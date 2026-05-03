"""Add regime field to tribology records.

Revision ID: 20260501_0008
Revises: 20260422_0007
Create Date: 2026-05-01
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260501_0008"
down_revision: Union[str, None] = "20260422_0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tribology_data", sa.Column("regime", sa.String(length=160), nullable=True))
    op.add_column("record_candidates", sa.Column("regime", sa.String(length=160), nullable=True))


def downgrade() -> None:
    op.drop_column("record_candidates", "regime")
    op.drop_column("tribology_data", "regime")
