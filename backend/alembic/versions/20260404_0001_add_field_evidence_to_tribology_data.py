"""Add field-level evidence columns to tribology_data

Revision ID: 20260404_0001
Revises: 20260331_0001
Create Date: 2026-04-04

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260404_0001"
down_revision: Union[str, None] = "20260331_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tribology_data", sa.Column("sample_id", sa.String(length=64), nullable=True))
    op.add_column("tribology_data", sa.Column("series_id", sa.String(length=64), nullable=True))
    op.add_column("tribology_data", sa.Column("field_evidence_json", sa.Text(), nullable=True))
    op.add_column("tribology_data", sa.Column("review_status", sa.String(length=32), nullable=True))
    op.add_column("tribology_data", sa.Column("record_origin", sa.String(length=32), nullable=True))
    op.add_column("tribology_data", sa.Column("assembly_notes", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("tribology_data", "assembly_notes")
    op.drop_column("tribology_data", "record_origin")
    op.drop_column("tribology_data", "review_status")
    op.drop_column("tribology_data", "field_evidence_json")
    op.drop_column("tribology_data", "series_id")
    op.drop_column("tribology_data", "sample_id")
