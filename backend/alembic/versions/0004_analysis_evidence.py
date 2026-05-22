"""analysis evidence

Revision ID: 0004_analysis_evidence
Revises: 0003_event_intelligence
Create Date: 2026-05-21 00:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0004_analysis_evidence"
down_revision: Union[str, None] = "0003_event_intelligence"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "analysis_evidence",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("article_id", sa.Integer(), nullable=False),
        sa.Column("analysis_id", sa.Integer(), nullable=True),
        sa.Column("evidence_type", sa.String(length=50), nullable=False),
        sa.Column("target", sa.String(length=255), nullable=False),
        sa.Column("quote", sa.Text(), nullable=False),
        sa.Column("explanation", sa.Text(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["analysis_id"], ["article_analysis.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["article_id"], ["articles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_analysis_evidence_article_id", "analysis_evidence", ["article_id"])
    op.create_index("ix_analysis_evidence_type", "analysis_evidence", ["evidence_type"])


def downgrade() -> None:
    op.drop_index("ix_analysis_evidence_type", table_name="analysis_evidence")
    op.drop_index("ix_analysis_evidence_article_id", table_name="analysis_evidence")
    op.drop_table("analysis_evidence")
