from __future__ import annotations

import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Article, ArticleAnalysis


class GraphError(Exception):
    """Ошибка построения графа статьи."""


def build_article_graph(
    db: Session,
    article_id: int,
    include_related: bool = False,
    limit_related: int = 10,
) -> dict[str, list[dict[str, Any]]]:
    """Строит граф статьи, источника, сущностей, отношений и нарратива."""

    article = db.get(Article, article_id)
    if article is None:
        raise GraphError("Статья не найдена")
    if article.analysis is None:
        raise GraphError("Для статьи сначала нужно выполнить LLM-анализ")

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
        edges.append(
            {
                "id": f"edge_{edge_counter}",
                "source": source,
                "target": target,
                "label": label,
                "data": data or {},
            }
        )
        edge_counter += 1

    article_node_id = f"article_{article.id}"
    source_node_id = f"source_{article.source_id}"
    narrative_node_id = f"narrative_{article.analysis.id}"

    add_node(
        article_node_id,
        article.title,
        "article",
        {
            "article_id": article.id,
            "url": article.url,
            "published_at": article.published_at.isoformat(),
            "language": article.language,
        },
    )
    add_node(
        source_node_id,
        article.source.name if article.source else "unknown",
        "source",
        {
            "source_id": article.source_id,
            "url": article.source.url if article.source else None,
        },
    )
    add_edge(article_node_id, source_node_id, "published_by", {"type": "published_by"})

    entity_nodes_by_name: dict[str, str] = {}
    for item in article.entities:
        entity = item.entity
        node_type = entity.type.value if entity.type.value in _allowed_node_types() else "concept"
        entity_node_id = f"entity_{entity.id}"
        entity_nodes_by_name[entity.name.lower()] = entity_node_id
        add_node(
            entity_node_id,
            entity.name,
            node_type,
            {
                "entity_id": entity.id,
                "role": item.role,
                "importance_score": item.importance_score,
            },
        )
        add_edge(
            article_node_id,
            entity_node_id,
            "mentions",
            {
                "type": "mentions",
                "role": item.role,
                "importance_score": item.importance_score,
            },
        )

    add_node(
        narrative_node_id,
        article.analysis.narrative_hypothesis,
        "narrative",
        {
            "analysis_id": article.analysis.id,
            "confidence": article.analysis.confidence,
        },
    )
    add_edge(
        article_node_id,
        narrative_node_id,
        "supports_narrative",
        {"type": "supports_narrative", "confidence": article.analysis.confidence},
    )

    for name in _json_list(article.analysis.sympathizes_with):
        target_id = _ensure_named_node(add_node, entity_nodes_by_name, name, "concept")
        add_edge(article_node_id, target_id, "sympathizes_with", {"type": "sympathizes_with", "polarity": "positive"})

    for name in _json_list(article.analysis.criticizes):
        target_id = _ensure_named_node(add_node, entity_nodes_by_name, name, "concept")
        add_edge(article_node_id, target_id, "criticizes", {"type": "criticizes", "polarity": "negative"})

    for relation in article.relations:
        source_id = f"entity_{relation.source_entity_id}"
        target_id = f"entity_{relation.target_entity_id}"
        add_edge(
            source_id,
            target_id,
            "relates_to",
            {
                "type": "relates_to",
                "relation_type": relation.relation_type,
                "description": relation.description,
                "confidence": relation.confidence,
            },
        )

    if include_related:
        _add_related_articles(
            db=db,
            article=article,
            add_node=add_node,
            add_edge=add_edge,
            base_article_node_id=article_node_id,
            limit=limit_related,
        )

    return {"nodes": nodes, "edges": edges}


def _add_related_articles(
    db: Session,
    article: Article,
    add_node: Any,
    add_edge: Any,
    base_article_node_id: str,
    limit: int,
) -> None:
    """Добавляет в граф статьи того же события, похожие статьи и похожие нарративы."""

    added_counts: dict[str, int] = {"same_event_as": 0, "similar_to": 0, "shares_narrative": 0}

    for event_link in article.events:
        for related_link in event_link.event.articles:
            if related_link.article_id == article.id or added_counts["same_event_as"] >= limit:
                continue
            related_article = related_link.article
            related_node_id = _add_related_article_node(add_node, related_article, "same_event")
            add_edge(
                base_article_node_id,
                related_node_id,
                "same_event_as",
                {
                    "type": "same_event_as",
                    "event_id": event_link.event_id,
                    "same_event_probability": related_link.same_event_probability,
                },
            )
            added_counts["same_event_as"] += 1

    for item in _similar_articles(db, article.id, limit):
        related_article_id = item.get("article_id")
        if not isinstance(related_article_id, int) or related_article_id == article.id:
            continue
        related_article = db.get(Article, related_article_id)
        if related_article is None:
            continue
        related_node_id = _add_related_article_node(add_node, related_article, "qdrant_similarity")
        add_edge(
            base_article_node_id,
            related_node_id,
            "similar_to",
            {"type": "similar_to", "score": item.get("score", 0.0)},
        )
        added_counts["similar_to"] += 1
        if added_counts["similar_to"] >= limit:
            break

    for related_analysis, score in _similar_narrative_analyses(db, article, limit):
        related_article = related_analysis.article
        related_node_id = _add_related_article_node(add_node, related_article, "narrative_similarity")
        add_edge(
            base_article_node_id,
            related_node_id,
            "shares_narrative",
            {"type": "shares_narrative", "similarity": score},
        )


def _add_related_article_node(add_node: Any, article: Article, relation_hint: str) -> str:
    node_id = f"related_article_{article.id}"
    add_node(
        node_id,
        article.title,
        "article",
        {
            "article_id": article.id,
            "source_name": article.source.name if article.source else "unknown",
            "published_at": article.published_at.isoformat(),
            "relation_hint": relation_hint,
        },
    )
    return node_id


def _similar_articles(db: Session, article_id: int, limit: int) -> list[dict[str, Any]]:
    try:
        from app.vector import VectorError, find_similar_articles

        return find_similar_articles(db, article_id=article_id, limit=limit)
    except Exception:
        return []


def _similar_narrative_analyses(db: Session, article: Article, limit: int) -> list[tuple[ArticleAnalysis, float]]:
    if article.analysis is None or not article.analysis.narrative_hypothesis:
        return []
    try:
        from app.vector import get_embedding_model

        model = get_embedding_model()
        base_vector = [float(value) for value in model.encode(article.analysis.narrative_hypothesis, normalize_embeddings=True).tolist()]
        analyses = list(
            db.scalars(
                select(ArticleAnalysis).where(
                    ArticleAnalysis.article_id != article.id,
                    ArticleAnalysis.narrative_hypothesis != "",
                )
            ).all()
        )
        matches: list[tuple[ArticleAnalysis, float]] = []
        for analysis in analyses:
            vector = [float(value) for value in model.encode(analysis.narrative_hypothesis, normalize_embeddings=True).tolist()]
            score = _cosine_similarity(base_vector, vector)
            if score >= 0.75:
                matches.append((analysis, score))
        matches.sort(key=lambda item: item[1], reverse=True)
        return matches[:limit]
    except Exception:
        return []


def _ensure_named_node(
    add_node: Any,
    entity_nodes_by_name: dict[str, str],
    name: str,
    node_type: str,
) -> str:
    key = name.lower()
    if key in entity_nodes_by_name:
        return entity_nodes_by_name[key]
    node_id = f"concept_{_slug(name)}"
    entity_nodes_by_name[key] = node_id
    add_node(node_id, name, node_type, {"synthetic": True})
    return node_id


def _json_list(value: str | None) -> list[str]:
    if not value:
        return []
    try:
        data = json.loads(value)
    except json.JSONDecodeError:
        return []
    return [item for item in data if isinstance(item, str)] if isinstance(data, list) else []


def _slug(value: str) -> str:
    return "".join(char.lower() if char.isalnum() else "_" for char in value).strip("_") or "unknown"


def _allowed_node_types() -> set[str]:
    return {"person", "organization", "country", "location", "concept"}


def _cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    return sum(a * b for a, b in zip(left, right))
