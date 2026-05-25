from __future__ import annotations

import enum
from datetime import datetime
from typing import Optional

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


class MaterialType(str, enum.Enum):
    """Тип текстового материала источника."""

    news = "news"
    article = "article"
    analytics = "analytics"
    opinion = "opinion"
    interview = "interview"
    unknown = "unknown"


class Job(Base):
    """Локальная фоновая задача без Celery/Redis.

    Храним состояние в PostgreSQL, чтобы frontend мог показывать прогресс,
    а долгий анализ не блокировал HTTP-запрос.
    """

    __tablename__ = "jobs"

    id: Mapped[int] = mapped_column(primary_key=True)
    type: Mapped[str] = mapped_column(String(50), nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="pending", server_default="pending")
    progress: Mapped[float] = mapped_column(Float, nullable=False, default=0.0, server_default="0")
    params_json: Mapped[str] = mapped_column(Text, nullable=False)
    result_json: Mapped[Optional[str]] = mapped_column(Text)
    logs_json: Mapped[Optional[str]] = mapped_column(Text)
    error: Mapped[Optional[str]] = mapped_column(Text)
    retry_count: Mapped[int] = mapped_column(nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))


class PipelineRun(Base):
    """Последний/исторический запуск локального batch pipeline."""

    __tablename__ = "pipeline_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(50), nullable=False)
    selected_articles: Mapped[int] = mapped_column(nullable=False, default=0, server_default="0")
    processed: Mapped[int] = mapped_column(nullable=False, default=0, server_default="0")
    failed: Mapped[int] = mapped_column(nullable=False, default=0, server_default="0")
    params_json: Mapped[str] = mapped_column(Text, nullable=False)
    result_json: Mapped[Optional[str]] = mapped_column(Text)


class ArticlePrecomputeCache(Base):
    """Кэш заранее рассчитанных данных для быстрого UI без ожидания онлайн-вычислений."""

    __tablename__ = "article_precompute_cache"

    id: Mapped[int] = mapped_column(primary_key=True)
    article_id: Mapped[int] = mapped_column(ForeignKey("articles.id", ondelete="CASCADE"), unique=True, nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="ready", server_default="ready")
    graph_json: Mapped[Optional[str]] = mapped_column(Text)
    similar_json: Mapped[Optional[str]] = mapped_column(Text)
    compare_json: Mapped[Optional[str]] = mapped_column(Text)
    error: Mapped[Optional[str]] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    article: Mapped["Article"] = relationship()


class Source(Base):
    """Источник публикаций: СМИ, сайт, канал или другой поставщик текстов."""

    __tablename__ = "sources"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[Optional[str]] = mapped_column(String(50), unique=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    country: Mapped[str] = mapped_column(String(120), nullable=False)
    political_orientation: Mapped[Optional[str]] = mapped_column(String(120))
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
    section: Mapped[Optional[str]] = mapped_column(String(120))
    author: Mapped[Optional[str]] = mapped_column(String(255))
    material_type: Mapped[MaterialType] = mapped_column(
        Enum(MaterialType, name="material_type"),
        nullable=False,
        default=MaterialType.unknown,
        server_default=MaterialType.unknown.value,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    source: Mapped[Source] = relationship(back_populates="articles")
    entities: Mapped[list["ArticleEntity"]] = relationship(back_populates="article")
    relations: Mapped[list["Relation"]] = relationship(back_populates="article")
    analysis: Mapped[Optional["ArticleAnalysis"]] = relationship(back_populates="article")
    narrative_evidence: Mapped[list["NarrativeEvidence"]] = relationship(back_populates="article")
    events: Mapped[list["ArticleEvent"]] = relationship(back_populates="article")
    analysis_evidence: Mapped[list["AnalysisEvidence"]] = relationship(back_populates="article")


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
    role: Mapped[Optional[str]] = mapped_column(String(120))
    importance_score: Mapped[Optional[float]] = mapped_column(Float)

    article: Mapped[Article] = relationship(back_populates="entities")
    entity: Mapped[Entity] = relationship()


class Event(Base):
    """Событие, которое может быть описано несколькими статьями разных источников."""

    __tablename__ = "events"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    event_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    event_type: Mapped[Optional[str]] = mapped_column(String(120))
    location: Mapped[Optional[str]] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    articles: Mapped[list["ArticleEvent"]] = relationship(back_populates="event")
    entities: Mapped[list["EventEntity"]] = relationship(back_populates="event")


class ArticleEvent(Base):
    """Связь статьи с событием и уверенность, что статья описывает именно его."""

    __tablename__ = "article_events"

    article_id: Mapped[int] = mapped_column(
        ForeignKey("articles.id", ondelete="CASCADE"),
        primary_key=True,
    )
    event_id: Mapped[int] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"),
        primary_key=True,
    )
    same_event_probability: Mapped[float] = mapped_column(Float, nullable=False)
    evidence_text: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    article: Mapped[Article] = relationship(back_populates="events")
    event: Mapped[Event] = relationship(back_populates="articles")


class EventEntity(Base):
    """Главная сущность события, собранная из сущностей связанных статей."""

    __tablename__ = "event_entities"

    event_id: Mapped[int] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"),
        primary_key=True,
    )
    entity_id: Mapped[int] = mapped_column(
        ForeignKey("entities.id", ondelete="CASCADE"),
        primary_key=True,
    )
    role: Mapped[Optional[str]] = mapped_column(String(120))
    importance_score: Mapped[Optional[float]] = mapped_column(Float)

    event: Mapped[Event] = relationship(back_populates="entities")
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
    sympathizes_with: Mapped[Optional[str]] = mapped_column(Text)
    criticizes: Mapped[Optional[str]] = mapped_column(Text)
    narrative_hypothesis: Mapped[str] = mapped_column(Text, nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    article: Mapped[Article] = relationship(back_populates="analysis")
    evidence: Mapped[list["AnalysisEvidence"]] = relationship(back_populates="analysis")


class AnalysisEvidence(Base):
    """Цитата или фрагмент статьи, который объясняет вывод LLM-анализа."""

    __tablename__ = "analysis_evidence"

    id: Mapped[int] = mapped_column(primary_key=True)
    article_id: Mapped[int] = mapped_column(ForeignKey("articles.id", ondelete="CASCADE"), nullable=False)
    analysis_id: Mapped[Optional[int]] = mapped_column(ForeignKey("article_analysis.id", ondelete="SET NULL"))
    evidence_type: Mapped[str] = mapped_column(String(50), nullable=False)
    target: Mapped[str] = mapped_column(String(255), nullable=False)
    quote: Mapped[str] = mapped_column(Text, nullable=False)
    explanation: Mapped[str] = mapped_column(Text, nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    article: Mapped[Article] = relationship(back_populates="analysis_evidence")
    analysis: Mapped[Optional[ArticleAnalysis]] = relationship(back_populates="evidence")


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
