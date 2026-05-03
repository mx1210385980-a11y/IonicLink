"""Add registered_models table

Revision ID: 20260422_0007
Revises: 20260422_0006
Create Date: 2026-04-22

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20260422_0007'
down_revision: Union[str, None] = '20260422_0006'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'registered_models',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('name', sa.String(length=180), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('training_run_id', sa.Integer(), sa.ForeignKey('model_training_runs.id'), nullable=False),
        sa.Column('source_dataset_id', sa.Integer(), sa.ForeignKey('cleaned_datasets.id'), nullable=True),
        sa.Column('group_id', sa.Integer(), sa.ForeignKey('research_groups.id'), nullable=False),
        sa.Column('workspace_id', sa.Integer(), sa.ForeignKey('workspaces.id'), nullable=True),
        sa.Column('created_by_user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('scope_type', sa.String(length=32), nullable=False, server_default='workspace'),
        sa.Column('scope_key', sa.String(length=64), nullable=False),
        sa.Column('config_json', sa.Text(), nullable=False),
        sa.Column('summary_json', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=True),
    )

    op.create_index('ix_registered_models_training_run_id', 'registered_models', ['training_run_id'])
    op.create_index('ix_registered_models_source_dataset_id', 'registered_models', ['source_dataset_id'])
    op.create_index('ix_registered_models_group_id', 'registered_models', ['group_id'])
    op.create_index('ix_registered_models_workspace_id', 'registered_models', ['workspace_id'])
    op.create_index('ix_registered_models_created_by_user_id', 'registered_models', ['created_by_user_id'])
    op.create_index('ix_registered_models_scope_type', 'registered_models', ['scope_type'])
    op.create_index('ix_registered_models_scope_key', 'registered_models', ['scope_key'])


def downgrade() -> None:
    op.drop_index('ix_registered_models_scope_key', table_name='registered_models')
    op.drop_index('ix_registered_models_scope_type', table_name='registered_models')
    op.drop_index('ix_registered_models_created_by_user_id', table_name='registered_models')
    op.drop_index('ix_registered_models_workspace_id', table_name='registered_models')
    op.drop_index('ix_registered_models_group_id', table_name='registered_models')
    op.drop_index('ix_registered_models_source_dataset_id', table_name='registered_models')
    op.drop_index('ix_registered_models_training_run_id', table_name='registered_models')
    op.drop_table('registered_models')
