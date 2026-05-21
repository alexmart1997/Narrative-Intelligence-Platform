from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from app.models import Article


class GraphError(Exception):
    """Ошибка построения графа статьи."""


def build_article_graph(db: Session, article_id: int) -> dict[str, list[dict[str, Any]]]:
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

    return {"nodes": nodes, "edges": edges}


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
    return {"person", "organization", "country", "concept"}
