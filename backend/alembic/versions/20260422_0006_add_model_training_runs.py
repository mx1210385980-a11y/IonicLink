"""Add model_training_runs table

Revision ID: 20260422_0006
Revises: 20260414_0005
Create Date: 2026-04-22

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20260422_0006'
down_revision: Union[str, None] = '20260414_0005'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'model_training_runs',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('task_id', sa.String(length=64), nullable=False),
        sa.Column('status', sa.String(length=32), nullable=False, server_default='queued'),
        sa.Column('target_column', sa.String(length=80), nullable=False),
        sa.Column('algorithm', sa.String(length=64), nullable=False),
        sa.Column('split_strategy', sa.String(length=64), nullable=False, server_default='random_holdout'),
        sa.Column('group_id', sa.Integer(), sa.ForeignKey('research_groups.id'), nullable=False),
        sa.Column('workspace_id', sa.Integer(), sa.ForeignKey('workspaces.id'), nullable=True),
        sa.Column('cleaned_dataset_id', sa.Integer(), sa.ForeignKey('cleaned_datasets.id'), nullable=True),
        sa.Column('owner_user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('scope_type', sa.String(length=32), nullable=False, server_default='workspace'),
        sa.Column('scope_key', sa.String(length=64), nullable=False),
        sa.Column('usable_records', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('config_json', sa.Text(), nullable=False),
        sa.Column('summary_json', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=True),
        sa.Column('started_at', sa.DateTime(), nullable=True),
        sa.Column('finished_at', sa.DateTime(), nullable=True),
        sa.UniqueConstraint('task_id', name='uq_model_training_runs_task_id'),
    )

    op.create_index('ix_model_training_runs_task_id', 'model_training_runs', ['task_id'])
    op.create_index('ix_model_training_runs_status', 'model_training_runs', ['status'])
    op.create_index('ix_model_training_runs_algorithm', 'model_training_runs', ['algorithm'])
    op.create_index('ix_model_training_runs_group_id', 'model_training_runs', ['group_id'])
    op.create_index('ix_model_training_runs_workspace_id', 'model_training_runs', ['workspace_id'])
    op.create_index('ix_model_training_runs_cleaned_dataset_id', 'model_training_runs', ['cleaned_dataset_id'])
    op.create_index('ix_model_training_runs_owner_user_id', 'model_training_runs', ['owner_user_id'])
    op.create_index('ix_model_training_runs_scope_type', 'model_training_runs', ['scope_type'])
    op.create_index('ix_model_training_runs_scope_key', 'model_training_runs', ['scope_key'])


def downgrade() -> None:
    op.drop_index('ix_model_training_runs_scope_key', table_name='model_training_runs')
    op.drop_index('ix_model_training_runs_scope_type', table_name='model_training_runs')
    op.drop_index('ix_model_training_runs_owner_user_id', table_name='model_training_runs')
    op.drop_index('ix_model_training_runs_cleaned_dataset_id', table_name='model_training_runs')
    op.drop_index('ix_model_training_runs_workspace_id', table_name='model_training_runs')
    op.drop_index('ix_model_training_runs_group_id', table_name='model_training_runs')
    op.drop_index('ix_model_training_runs_algorithm', table_name='model_training_runs')
    op.drop_index('ix_model_training_runs_status', table_name='model_training_runs')
    op.drop_index('ix_model_training_runs_task_id', table_name='model_training_runs')
    op.drop_table('model_training_runs')
