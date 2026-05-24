"""add article precompute cache

Revision ID: 0006_article_precompute_cache
Revises: 0005_pipeline_runs
Create Date: 2026-05-24 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0006_article_precompute_cache"
down_revision: Union[str, None] = "0005_pipeline_runs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "article_precompute_cache",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("article_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=50), server_default="ready", nullable=False),
        sa.Column("graph_json", sa.Text(), nullable=True),
        sa.Column("similar_json", sa.Text(), nullable=True),
        sa.Column("compare_json", sa.Text(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["article_id"], ["articles.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("article_id"),
    )


def downgrade() -> None:
    op.drop_table("article_precompute_cache")
