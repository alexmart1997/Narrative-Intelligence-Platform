from __future__ import annotations

import json
from datetime import date, datetime, time, timezone
from typing import Any, Optional

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from app.analysis import AnalysisError, parse_llm_json
from app.llm import LlmError, call_llm
from app.models import Article, ArticleAnalysis, ArticleEvent, Event, EventEntity
from app.vector import VectorError, find_similar_articles


SAME_EVENT_THRESHOLD = 0.7


class EventDetectionError(Exception):
    """Ошибка определения события для статьи."""


def detect_event_for_article(db: Session, article_id: int) -> Event:
    """Определяет событие для статьи и связывает ее с events/article_events."""

    article = _get_article_with_analysis(db, article_id)
    existing_link = article.events[0] if article.events else None
    if existing_link is not None:
        return existing_link.event

    similar_articles = _load_similar_articles(db, article.id)
    same_event_matches: list[tuple[Article, dict[str, Any]]] = []

    for similar_article in similar_articles:
        comparison = _compare_event(article, similar_article)
        if comparison["same_event_probability"] >= SAME_EVENT_THRESHOLD:
            same_event_matches.append((similar_article, comparison))

    target_event = _find_existing_event(same_event_matches)
    if target_event is None:
        # Если похожие статьи есть, но они еще не привязаны к событию, создаем событие сразу для группы.
        event_articles = [article] + [matched_article for matched_article, _ in same_event_matches]
        target_event = _create_event(db, event_articles)

    _link_article(
        db,
        article=article,
        event=target_event,
        probability=1.0,
        evidence_text="Статья является базовой для определения события.",
    )

    for matched_article, comparison in same_event_matches:
        if not matched_article.events:
            _link_article(
                db,
                article=matched_article,
                event=target_event,
                probability=comparison["same_event_probability"],
                evidence_text=comparison.get("evidence_text"),
            )

    _refresh_event_entities(db, target_event)
    db.commit()
    db.refresh(target_event)
    return target_event


def detect_all_events(db: Session) -> dict[str, int]:
    """Запускает event matching для всех проанализированных статей."""

    articles = list(db.scalars(select(Article).join(ArticleAnalysis)).all())
    detected = 0
    errors = 0
    for article in articles:
        try:
            detect_event_for_article(db, article.id)
            detected += 1
        except EventDetectionError:
            db.rollback()
            errors += 1
    return {"total": len(articles), "detected": detected, "errors": errors}


def query_events(
    db: Session,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    event_type: Optional[str] = None,
    q: Optional[str] = None,
) -> list[Event]:
    """Возвращает события с простыми фильтрами для API."""

    query = db.query(Event)
    if date_from:
        query = query.filter(Event.event_date >= datetime.combine(date_from, time.min, tzinfo=timezone.utc))
    if date_to:
        query = query.filter(Event.event_date <= datetime.combine(date_to, time.max, tzinfo=timezone.utc))
    if event_type:
        query = query.filter(Event.event_type == event_type)
    if q:
        pattern = f"%{q}%"
        query = query.filter(
            or_(
                Event.title.ilike(pattern),
                Event.description.ilike(pattern),
                Event.location.ilike(pattern),
            )
        )
    return query.order_by(Event.event_date.desc().nullslast(), Event.created_at.desc()).all()


def build_event_graph(db: Session, event_id: int) -> dict[str, list[dict[str, Any]]]:
    """Строит граф события: статьи, источники, сущности и гипотезы нарративов."""

    event = db.get(Event, event_id)
    if event is None:
        raise EventDetectionError("Событие не найдено")

    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    seen_nodes: set[str] = set()
    edge_counter = 1

    def add_node(node_id: str, label: str, node_type: str, data: dict[str, Any] | None = None) -> None:
        if node_id in seen_nodes:
            return
        seen_nodes.add(node_id)
        nodes.append({"id": node_id, "label": label, "type": node_type, "data": data or {}})

    def add_edge(source: str, target: str, label: str, data: dict[str, Any] | None = None) -> None:
        nonlocal edge_counter
        edges.append({"id": f"edge_{edge_counter}", "source": source, "target": target, "label": label, "data": data or {}})
        edge_counter += 1

    event_node_id = f"event_{event.id}"
    add_node(
        event_node_id,
        event.title,
        "event",
        {
            "event_id": event.id,
            "description": event.description,
            "event_date": event.event_date.isoformat() if event.event_date else None,
            "event_type": event.event_type,
            "location": event.location,
        },
    )

    entity_to_articles: dict[int, list[str]] = {}
    for link in event.articles:
        article = link.article
        article_node_id = f"article_{article.id}"
        source_node_id = f"source_{article.source_id}"
        narrative_node_id = f"narrative_{article.analysis.id}" if article.analysis else None

        add_node(
            article_node_id,
            article.title,
            "article",
            {
                "article_id": article.id,
                "url": article.url,
                "published_at": article.published_at.isoformat(),
                "same_event_probability": link.same_event_probability,
                "evidence_text": link.evidence_text,
            },
        )
        add_edge(article_node_id, event_node_id, "describes_event", {"same_event_probability": link.same_event_probability})

        add_node(
            source_node_id,
            article.source.name if article.source else "unknown",
            "source",
            {"source_id": article.source_id, "url": article.source.url if article.source else None},
        )
        add_edge(article_node_id, source_node_id, "published_by")

        if article.analysis and narrative_node_id:
            add_node(
                narrative_node_id,
                article.analysis.narrative_hypothesis,
                "narrative",
                {"analysis_id": article.analysis.id, "confidence": article.analysis.confidence},
            )
            add_edge(article_node_id, narrative_node_id, "supports_narrative", {"confidence": article.analysis.confidence})

        for article_entity in article.entities:
            entity = article_entity.entity
            entity_node_id = f"entity_{entity.id}"
            add_node(
                entity_node_id,
                entity.name,
                entity.type.value if entity.type.value != "other" else "concept",
                {
                    "entity_id": entity.id,
                    "role": article_entity.role,
                    "importance_score": article_entity.importance_score,
                },
            )
            add_edge(article_node_id, entity_node_id, "mentions", {"importance_score": article_entity.importance_score})
            entity_to_articles.setdefault(entity.id, []).append(article_node_id)

    for entity_id, article_node_ids in entity_to_articles.items():
        if len(article_node_ids) < 2:
            continue
        entity_node_id = f"entity_{entity_id}"
        for article_node_id in article_node_ids:
            add_edge(article_node_id, entity_node_id, "shares_entity")

    return {"nodes": nodes, "edges": edges}


def _load_similar_articles(db: Session, article_id: int) -> list[Article]:
    try:
        similar_items = find_similar_articles(db, article_id=article_id, limit=8)
    except VectorError:
        return []

    articles: list[Article] = []
    seen_ids: set[int] = set()
    for item in similar_items:
        similar_article_id = item.get("article_id")
        if not isinstance(similar_article_id, int) or similar_article_id in seen_ids:
            continue
        similar_article = db.get(Article, similar_article_id)
        if similar_article and similar_article.analysis:
            articles.append(similar_article)
            seen_ids.add(similar_article_id)
    return articles


def _compare_event(article: Article, candidate: Article) -> dict[str, Any]:
    prompt = f"""
Ты аналитик новостей. Определи, описывают ли две статьи одно и то же событие.
Верни СТРОГО один JSON без markdown и текста вокруг.
Все текстовые значения JSON пиши на русском языке, даже если исходные статьи на английском.

Формат:
{{
  "same_event_probability": 0.0,
  "evidence_text": "краткое объяснение"
}}

Правила:
- same_event_probability число от 0 до 1.
- Высокая вероятность означает одно событие, а не просто одну тему.
- Не выдумывай факты.

СТАТЬЯ 1
Источник: {article.source.name if article.source else "unknown"}
Заголовок: {article.title}
Дата: {article.published_at.isoformat()}
Резюме: {article.analysis.short_summary if article.analysis else ""}
Нарратив: {article.analysis.narrative_hypothesis if article.analysis else ""}
Фрагмент: {article.text[:1200]}

СТАТЬЯ 2
Источник: {candidate.source.name if candidate.source else "unknown"}
Заголовок: {candidate.title}
Дата: {candidate.published_at.isoformat()}
Резюме: {candidate.analysis.short_summary if candidate.analysis else ""}
Нарратив: {candidate.analysis.narrative_hypothesis if candidate.analysis else ""}
Фрагмент: {candidate.text[:1200]}
""".strip()

    try:
        data = parse_llm_json(call_llm(prompt))
    except (LlmError, AnalysisError) as exc:
        raise EventDetectionError(str(exc)) from exc

    data["same_event_probability"] = _score(data.get("same_event_probability"))
    data["evidence_text"] = _optional_string(data.get("evidence_text"))
    return data


def _create_event(db: Session, articles: list[Article]) -> Event:
    data = _generate_event_payload(articles)
    event = Event(
        title=_string(data.get("title"), articles[0].title)[:255],
        description=_string(data.get("description"), articles[0].analysis.short_summary if articles[0].analysis else articles[0].title),
        event_date=_parse_optional_datetime(data.get("event_date")) or articles[0].published_at,
        event_type=_optional_string(data.get("event_type")),
        location=_optional_string(data.get("location")),
    )
    db.add(event)
    db.flush()
    return event


def _generate_event_payload(articles: list[Article]) -> dict[str, Any]:
    article_blocks = "\n\n".join(
        f"""СТАТЬЯ {index}
Источник: {article.source.name if article.source else "unknown"}
Заголовок: {article.title}
Дата: {article.published_at.isoformat()}
Резюме: {article.analysis.short_summary if article.analysis else ""}
Фрейминг: {article.analysis.framing if article.analysis else ""}
Нарратив: {article.analysis.narrative_hypothesis if article.analysis else ""}"""
        for index, article in enumerate(articles, start=1)
    )
    prompt = f"""
Ты аналитик новостей. На основе списка статей сформулируй одно событие.
Верни СТРОГО один JSON без markdown и текста вокруг.
Все текстовые значения JSON пиши на русском языке, даже если исходные статьи на английском.

Формат:
{{
  "title": "...",
  "description": "...",
  "event_date": "YYYY-MM-DD или null",
  "event_type": "...",
  "location": "..."
}}

Правила:
- title короткий и конкретный.
- description объясняет, что произошло.
- event_type может быть politics, economy, society, conflict, technology, other.
- Если дата или место неясны, верни null.
- Используй только данные из статей.

{article_blocks}
""".strip()

    try:
        return parse_llm_json(call_llm(prompt))
    except (LlmError, AnalysisError) as exc:
        raise EventDetectionError(str(exc)) from exc


def _find_existing_event(matches: list[tuple[Article, dict[str, Any]]]) -> Event | None:
    candidates: list[tuple[Event, float]] = []
    for article, comparison in matches:
        probability = comparison["same_event_probability"]
        for link in article.events:
            candidates.append((link.event, probability))
    if not candidates:
        return None
    candidates.sort(key=lambda item: item[1], reverse=True)
    return candidates[0][0]


def _link_article(db: Session, article: Article, event: Event, probability: float, evidence_text: str | None) -> None:
    db.merge(
        ArticleEvent(
            article_id=article.id,
            event_id=event.id,
            same_event_probability=probability,
            evidence_text=evidence_text,
        )
    )
    db.flush()


def _refresh_event_entities(db: Session, event: Event) -> None:
    db.execute(delete(EventEntity).where(EventEntity.event_id == event.id))
    entity_scores: dict[int, tuple[float, str | None]] = {}
    links = list(db.scalars(select(ArticleEvent).where(ArticleEvent.event_id == event.id)).all())
    for link in links:
        for article_entity in link.article.entities:
            score = article_entity.importance_score or 0.0
            current = entity_scores.get(article_entity.entity_id)
            if current is None or score > current[0]:
                entity_scores[article_entity.entity_id] = (score, article_entity.role)

    for entity_id, (score, role) in sorted(entity_scores.items(), key=lambda item: item[1][0], reverse=True)[:20]:
        db.add(
            EventEntity(
                event_id=event.id,
                entity_id=entity_id,
                role=role,
                importance_score=score,
            )
        )
    db.flush()


def _get_article_with_analysis(db: Session, article_id: int) -> Article:
    article = db.get(Article, article_id)
    if article is None:
        raise EventDetectionError("Статья не найдена")
    if article.analysis is None:
        raise EventDetectionError("Сначала нужно выполнить LLM-анализ статьи")
    return article


def _parse_optional_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    normalized = value.strip()
    try:
        if len(normalized) == 10:
            return datetime.combine(date.fromisoformat(normalized), time.min, tzinfo=timezone.utc)
        return datetime.fromisoformat(normalized.replace("Z", "+00:00"))
    except ValueError:
        return None


def _score(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return min(max(number, 0.0), 1.0)


def _string(value: Any, fallback: str) -> str:
    return value.strip() if isinstance(value, str) and value.strip() else fallback


def _optional_string(value: Any) -> str | None:
    if isinstance(value, str) and value.strip() and value.strip().lower() != "null":
        return value.strip()
    return None
