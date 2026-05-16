"""Add model prediction runs

Revision ID: 20260516_0016
Revises: 20260516_0015
Create Date: 2026-05-16

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260516_0016"
down_revision: Union[str, None] = "20260516_0015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "model_prediction_runs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("registered_model_id", sa.Integer(), nullable=True),
        sa.Column("training_run_id", sa.Integer(), nullable=True),
        sa.Column("source_dataset_id", sa.Integer(), nullable=True),
        sa.Column("target_dataset_id", sa.Integer(), nullable=True),
        sa.Column("group_id", sa.Integer(), nullable=False),
        sa.Column("workspace_id", sa.Integer(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("scope_type", sa.String(length=32), nullable=False),
        sa.Column("scope_key", sa.String(length=64), nullable=False),
        sa.Column("registered_model_name", sa.String(length=180), nullable=False),
        sa.Column("training_view", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("target_input_rows", sa.Integer(), nullable=False),
        sa.Column("target_predicted_rows", sa.Integer(), nullable=False),
        sa.Column("dropped_outside_training_view", sa.Integer(), nullable=False),
        sa.Column("scored_rows", sa.Integer(), nullable=False),
        sa.Column("feature_dimensions", sa.Integer(), nullable=False),
        sa.Column("r2", sa.Float(), nullable=True),
        sa.Column("rmse", sa.Float(), nullable=True),
        sa.Column("mae", sa.Float(), nullable=True),
        sa.Column("feature_columns_json", sa.Text(), nullable=False),
        sa.Column("preview_rows_json", sa.Text(), nullable=False),
        sa.Column("result_json", sa.Text(), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["group_id"], ["research_groups.id"]),
        sa.ForeignKeyConstraint(["registered_model_id"], ["registered_models.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["source_dataset_id"], ["cleaned_datasets.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["target_dataset_id"], ["cleaned_datasets.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["training_run_id"], ["model_training_runs.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_model_prediction_runs_created_by_user_id", "model_prediction_runs", ["created_by_user_id"])
    op.create_index("ix_model_prediction_runs_group_id", "model_prediction_runs", ["group_id"])
    op.create_index("ix_model_prediction_runs_registered_model_id", "model_prediction_runs", ["registered_model_id"])
    op.create_index("ix_model_prediction_runs_scope_key", "model_prediction_runs", ["scope_key"])
    op.create_index("ix_model_prediction_runs_scope_type", "model_prediction_runs", ["scope_type"])
    op.create_index("ix_model_prediction_runs_source_dataset_id", "model_prediction_runs", ["source_dataset_id"])
    op.create_index("ix_model_prediction_runs_status", "model_prediction_runs", ["status"])
    op.create_index("ix_model_prediction_runs_target_dataset_id", "model_prediction_runs", ["target_dataset_id"])
    op.create_index("ix_model_prediction_runs_training_run_id", "model_prediction_runs", ["training_run_id"])
    op.create_index("ix_model_prediction_runs_training_view", "model_prediction_runs", ["training_view"])
    op.create_index("ix_model_prediction_runs_workspace_id", "model_prediction_runs", ["workspace_id"])


def downgrade() -> None:
    op.drop_index("ix_model_prediction_runs_workspace_id", table_name="model_prediction_runs")
    op.drop_index("ix_model_prediction_runs_training_view", table_name="model_prediction_runs")
    op.drop_index("ix_model_prediction_runs_training_run_id", table_name="model_prediction_runs")
    op.drop_index("ix_model_prediction_runs_target_dataset_id", table_name="model_prediction_runs")
    op.drop_index("ix_model_prediction_runs_status", table_name="model_prediction_runs")
    op.drop_index("ix_model_prediction_runs_source_dataset_id", table_name="model_prediction_runs")
    op.drop_index("ix_model_prediction_runs_scope_type", table_name="model_prediction_runs")
    op.drop_index("ix_model_prediction_runs_scope_key", table_name="model_prediction_runs")
    op.drop_index("ix_model_prediction_runs_registered_model_id", table_name="model_prediction_runs")
    op.drop_index("ix_model_prediction_runs_group_id", table_name="model_prediction_runs")
    op.drop_index("ix_model_prediction_runs_created_by_user_id", table_name="model_prediction_runs")
    op.drop_table("model_prediction_runs")
