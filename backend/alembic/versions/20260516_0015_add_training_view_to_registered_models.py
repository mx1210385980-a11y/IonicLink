"""Add training view to registered models

Revision ID: 20260516_0015
Revises: 20260506_0014
Create Date: 2026-05-16

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260516_0015"
down_revision: Union[str, None] = "20260506_0014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "registered_models",
        sa.Column("training_view", sa.String(length=64), nullable=False, server_default="all"),
    )
    op.create_index("ix_registered_models_training_view", "registered_models", ["training_view"])


def downgrade() -> None:
    op.drop_index("ix_registered_models_training_view", table_name="registered_models")
    op.drop_column("registered_models", "training_view")
