"""Add recommended flag to registered models

Revision ID: 20260506_0014
Revises: 20260502_0013
Create Date: 2026-05-06

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260506_0014"
down_revision: Union[str, None] = "20260502_0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "registered_models",
        sa.Column("is_recommended", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index("ix_registered_models_is_recommended", "registered_models", ["is_recommended"])


def downgrade() -> None:
    op.drop_index("ix_registered_models_is_recommended", table_name="registered_models")
    op.drop_column("registered_models", "is_recommended")
