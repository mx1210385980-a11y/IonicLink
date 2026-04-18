"""add literature file hash

Revision ID: 20260404_0003
Revises: 20260404_0002
Create Date: 2026-04-04 21:15:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260404_0003"
down_revision = "20260404_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("literature", sa.Column("file_hash", sa.String(length=64), nullable=True))
    op.create_index("ix_literature_file_hash", "literature", ["file_hash"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_literature_file_hash", table_name="literature")
    op.drop_column("literature", "file_hash")
