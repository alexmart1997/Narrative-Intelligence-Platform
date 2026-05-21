import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, Float, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class EntityType(str, enum.Enum):
    """Тип сущности, найденной или заведенной в системе."""

    person = "person"
    organization = "organization"
    country = "country"
    location = "location"
    concept = "concept"
    other = "other"


class Sentiment(str, enum.Enum):
    """Общая тональность анализа статьи."""

    positive = "positive"
    negative = "negative"
    neutral = "neutral"
    mixed = "mixed"


class Source(Base):
    """Источник публикаций: СМИ, сайт, канал или другой поставщик текстов."""

    __tablename__ = "sources"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    country: Mapped[str] = mapped_column(String(120), nullable=False)
    political_orientation: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    articles: Mapped[list["Article"]] = relationship(back_populates="source")


class Article(Base):
    """Статья или текстовый материал, который анализирует платформа."""

    __tablename__ = "articles"

    id: Mapped[int] = mapped_column(primary_key=True)
    source_id: Mapped[int] = mapped_column(ForeignKey("sources.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    language: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    source: Mapped[Source] = relationship(back_populates="articles")
    entities: Mapped[list["ArticleEntity"]] = relationship(back_populates="article")
    relations: Mapped[list["Relation"]] = relationship(back_populates="article")
    analysis: Mapped["ArticleAnalysis | None"] = relationship(back_populates="article")
    narrative_evidence: Mapped[list["NarrativeEvidence"]] = relationship(back_populates="article")


class Entity(Base):
    """Сущность, которая участвует в статьях, отношениях и нарративах."""

    __tablename__ = "entities"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[EntityType] = mapped_column(Enum(EntityType, name="entity_type"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )


class ArticleEntity(Base):
    """Связь многие-ко-многим между статьями и найденными сущностями."""

    __tablename__ = "article_entities"

    article_id: Mapped[int] = mapped_column(
        ForeignKey("articles.id", ondelete="CASCADE"),
        primary_key=True,
    )
    entity_id: Mapped[int] = mapped_column(
        ForeignKey("entities.id", ondelete="CASCADE"),
        primary_key=True,
    )
    role: Mapped[str | None] = mapped_column(String(120))
    importance_score: Mapped[float | None] = mapped_column(Float)

    article: Mapped[Article] = relationship(back_populates="entities")
    entity: Mapped[Entity] = relationship()


class Relation(Base):
    """Отношение между двумя сущностями внутри конкретной статьи."""

    __tablename__ = "relations"

    id: Mapped[int] = mapped_column(primary_key=True)
    article_id: Mapped[int] = mapped_column(ForeignKey("articles.id", ondelete="CASCADE"), nullable=False)
    source_entity_id: Mapped[int] = mapped_column(ForeignKey("entities.id", ondelete="CASCADE"), nullable=False)
    target_entity_id: Mapped[int] = mapped_column(ForeignKey("entities.id", ondelete="CASCADE"), nullable=False)
    relation_type: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    article: Mapped[Article] = relationship(back_populates="relations")
    source_entity: Mapped[Entity] = relationship(foreign_keys=[source_entity_id])
    target_entity: Mapped[Entity] = relationship(foreign_keys=[target_entity_id])


class ArticleAnalysis(Base):
    """LLM-анализ статьи: резюме, тональность, фрейминг и гипотеза нарратива."""

    __tablename__ = "article_analysis"

    id: Mapped[int] = mapped_column(primary_key=True)
    article_id: Mapped[int] = mapped_column(
        ForeignKey("articles.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    short_summary: Mapped[str] = mapped_column(Text, nullable=False)
    detailed_summary: Mapped[str] = mapped_column(Text, nullable=False)
    sentiment: Mapped[Sentiment] = mapped_column(Enum(Sentiment, name="sentiment"), nullable=False)
    stance: Mapped[str] = mapped_column(Text, nullable=False)
    framing: Mapped[str] = mapped_column(Text, nullable=False)
    sympathizes_with: Mapped[str | None] = mapped_column(Text)
    criticizes: Mapped[str | None] = mapped_column(Text)
    narrative_hypothesis: Mapped[str] = mapped_column(Text, nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    article: Mapped[Article] = relationship(back_populates="analysis")


class Narrative(Base):
    """Обобщенный нарратив, подтверждаемый набором статей."""

    __tablename__ = "narratives"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    frame: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    evidence: Mapped[list["NarrativeEvidence"]] = relationship(back_populates="narrative")


class NarrativeEvidence(Base):
    """Конкретное текстовое доказательство, связывающее статью с нарративом."""

    __tablename__ = "narrative_evidence"
    __table_args__ = (
        UniqueConstraint("narrative_id", "article_id", "evidence_text", name="uq_narrative_evidence_text"),
    )

    narrative_id: Mapped[int] = mapped_column(
        ForeignKey("narratives.id", ondelete="CASCADE"),
        primary_key=True,
    )
    article_id: Mapped[int] = mapped_column(
        ForeignKey("articles.id", ondelete="CASCADE"),
        primary_key=True,
    )
    evidence_text: Mapped[str] = mapped_column(Text, primary_key=True)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)

    narrative: Mapped[Narrative] = relationship(back_populates="evidence")
    article: Mapped[Article] = relationship(back_populates="narrative_evidence")
