from __future__ import annotations

import json
from collections import Counter
from datetime import date, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Article, ArticleAnalysis, NarrativeEvidence, Source


class SourceProfileError(Exception):
    """Ошибка построения аналитического профиля источника."""


def build_source_profile(
    db: Session,
    source_code: str,
    date_from: date | None = None,
    date_to: date | None = None,
    language: str | None = None,
) -> dict[str, Any]:
    """Собирает агрегированный профиль источника по уже проанализированным статьям."""

    source = db.scalar(select(Source).where(Source.code == source_code))
    if source is None:
        raise SourceProfileError("Источник не найден")

    statement = select(Article).where(Article.source_id == source.id).order_by(Article.published_at.desc())
    if date_from:
        statement = statement.where(Article.published_at >= date_from)
    if date_to:
        statement = statement.where(Article.published_at < date_to + timedelta(days=1))
    if language:
        statement = statement.where(Article.language == language)

    articles = list(db.scalars(statement).all())
    analyses = [article.analysis for article in articles if article.analysis is not None]

    sentiment_counter = Counter({item: 0 for item in ["positive", "negative", "neutral", "mixed"]})
    framing_counter: Counter[str] = Counter()
    hypothesis_counter: Counter[str] = Counter()
    sympathy_counter: Counter[str] = Counter()
    criticism_counter: Counter[str] = Counter()
    entity_counter: Counter[tuple[str, str]] = Counter()
    narrative_counter: Counter[str] = Counter()

    for analysis in analyses:
        sentiment_counter[analysis.sentiment.value] += 1
        framing_counter.update([analysis.framing.strip()] if analysis.framing.strip() else [])
        hypothesis_counter.update([analysis.narrative_hypothesis.strip()] if analysis.narrative_hypothesis.strip() else [])
        sympathy_counter.update(_json_list(analysis.sympathizes_with))
        criticism_counter.update(_json_list(analysis.criticizes))

    for article in articles:
        for article_entity in article.entities:
            entity = article_entity.entity
            entity_counter[(entity.name, entity.type.value)] += 1
        for evidence in article.narrative_evidence:
            narrative_counter[evidence.narrative.title] += 1

    return {
        "source": {
            "id": source.id,
            "code": source.code,
            "name": source.name,
            "url": source.url,
            "country": source.country,
            "political_orientation": source.political_orientation,
        },
        "period": {
            "date_from": date_from.isoformat() if date_from else None,
            "date_to": date_to.isoformat() if date_to else None,
            "language": language,
        },
        "articles_count": len(articles),
        "top_entities": [
            {"name": name, "type": entity_type, "count": count}
            for (name, entity_type), count in entity_counter.most_common(15)
        ],
        "top_narratives": [
            {"title": title, "count": count}
            for title, count in narrative_counter.most_common(10)
        ],
        "top_narrative_hypotheses": [
            {"text": text, "count": count}
            for text, count in hypothesis_counter.most_common(10)
        ],
        "sentiment_distribution": dict(sentiment_counter),
        "top_framings": [
            {"framing": framing, "count": count}
            for framing, count in framing_counter.most_common(10)
        ],
        "sympathizes_with_top": [
            {"target": target, "count": count}
            for target, count in sympathy_counter.most_common(10)
        ],
        "criticizes_top": [
            {"target": target, "count": count}
            for target, count in criticism_counter.most_common(10)
        ],
    }


def _json_list(value: str | None) -> list[str]:
    if not value:
        return []
    try:
        data = json.loads(value)
    except json.JSONDecodeError:
        return []
    if not isinstance(data, list):
        return []
    return [item.strip() for item in data if isinstance(item, str) and item.strip()]
