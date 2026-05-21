"""ingestion metadata

Revision ID: 0002_ingestion_metadata
Revises: 0001_initial_schema
Create Date: 2026-05-21 00:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0002_ingestion_metadata"
down_revision: Union[str, None] = "0001_initial_schema"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


material_type = sa.Enum(
    "news",
    "article",
    "analytics",
    "opinion",
    "interview",
    "unknown",
    name="material_type",
)


def upgrade() -> None:
    material_type.create(op.get_bind(), checkfirst=True)

    op.add_column("sources", sa.Column("code", sa.String(length=50), nullable=True))
    op.create_unique_constraint("uq_sources_code", "sources", ["code"])

    op.add_column("articles", sa.Column("section", sa.String(length=120), nullable=True))
    op.add_column("articles", sa.Column("author", sa.String(length=255), nullable=True))
    op.add_column(
        "articles",
        sa.Column(
            "material_type",
            material_type,
            server_default="unknown",
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("articles", "material_type")
    op.drop_column("articles", "author")
    op.drop_column("articles", "section")
    op.drop_constraint("uq_sources_code", "sources", type_="unique")
    op.drop_column("sources", "code")

    material_type.drop(op.get_bind(), checkfirst=True)
