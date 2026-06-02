"""add figure crop overrides

Revision ID: 20260527_0018
Revises: 20260516_0016
Create Date: 2026-05-27 15:30:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260527_0018"
down_revision = "20260516_0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "figure_crop_overrides",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("literature_id", sa.Integer(), sa.ForeignKey("literature.id"), nullable=False),
        sa.Column("label", sa.String(length=120), nullable=False),
        sa.Column("normalized_label", sa.String(length=120), nullable=False),
        sa.Column("page", sa.Integer(), nullable=False),
        sa.Column("caption", sa.Text(), nullable=True),
        sa.Column("bbox_json", sa.Text(), nullable=False),
        sa.Column("algorithm_bbox_json", sa.Text(), nullable=True),
        sa.Column("preview_image_b64", sa.Text(), nullable=False),
        sa.Column("algorithm_version", sa.String(length=80), nullable=False, server_default="pdf-visual-segmentation.v1"),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("updated_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("literature_id", "normalized_label", "page", name="uq_figure_crop_override_target"),
    )
    op.create_index("ix_figure_crop_overrides_literature_id", "figure_crop_overrides", ["literature_id"])
    op.create_index("ix_figure_crop_overrides_normalized_label", "figure_crop_overrides", ["normalized_label"])
    op.create_index("ix_figure_crop_overrides_page", "figure_crop_overrides", ["page"])
    op.create_index("ix_figure_crop_overrides_created_by_user_id", "figure_crop_overrides", ["created_by_user_id"])
    op.create_index("ix_figure_crop_overrides_updated_by_user_id", "figure_crop_overrides", ["updated_by_user_id"])


def downgrade() -> None:
    op.drop_index("ix_figure_crop_overrides_updated_by_user_id", table_name="figure_crop_overrides")
    op.drop_index("ix_figure_crop_overrides_created_by_user_id", table_name="figure_crop_overrides")
    op.drop_index("ix_figure_crop_overrides_page", table_name="figure_crop_overrides")
    op.drop_index("ix_figure_crop_overrides_normalized_label", table_name="figure_crop_overrides")
    op.drop_index("ix_figure_crop_overrides_literature_id", table_name="figure_crop_overrides")
    op.drop_table("figure_crop_overrides")
