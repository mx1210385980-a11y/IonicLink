"""Add user_activity_logs table

Revision ID: 20260331_0001
Revises: 20260316_0001
Create Date: 2026-03-31

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20260331_0001'
down_revision: Union[str, None] = '20260316_0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create user_activity_logs table for monitoring user activities."""
    op.create_table(
        'user_activity_logs',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('group_id', sa.Integer(), sa.ForeignKey('research_groups.id'), nullable=False),
        sa.Column('action_type', sa.String(50), nullable=False),
        sa.Column('action_detail', sa.Text(), nullable=True),
        sa.Column('resource_type', sa.String(50), nullable=True),
        sa.Column('resource_id', sa.Integer(), nullable=True),
        sa.Column('ip_address', sa.String(45), nullable=True),
        sa.Column('user_agent', sa.String(500), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=True),
    )

    # Create indexes for efficient querying
    op.create_index('ix_user_activity_logs_user_id', 'user_activity_logs', ['user_id'])
    op.create_index('ix_user_activity_logs_group_id', 'user_activity_logs', ['group_id'])
    op.create_index('ix_user_activity_logs_action_type', 'user_activity_logs', ['action_type'])
    op.create_index('ix_user_activity_logs_created_at', 'user_activity_logs', ['created_at'])


def downgrade() -> None:
    """Remove user_activity_logs table."""
    op.drop_index('ix_user_activity_logs_created_at', table_name='user_activity_logs')
    op.drop_index('ix_user_activity_logs_action_type', table_name='user_activity_logs')
    op.drop_index('ix_user_activity_logs_group_id', table_name='user_activity_logs')
    op.drop_index('ix_user_activity_logs_user_id', table_name='user_activity_logs')
    op.drop_table('user_activity_logs')
