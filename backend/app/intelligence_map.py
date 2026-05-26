from __future__ import annotations

import hashlib
import math
import re
from collections import Counter
from datetime import date, datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import Article, ArticleEntity, ArticleEvent, Source


MAP_WIDTH = 1000
MAP_HEIGHT = 680


def build_intelligence_map(
    db: Session,
    date_from: date | None = None,
    date_to: date | None = None,
    source_code: str | None = None,
    language: str | None = None,
    mode: str = "narratives",
    limit: int = 300,
) -> dict[str, Any]:
    """Строит Graphika-like карту корпуса.

    Это не детальный граф статьи, а обзорная карта информационного поля:
    точка = статья, облако = событие/нарратив/источник.
    """

    articles = _load_articles(
        db=db,
        date_from=date_from,
        date_to=date_to,
        source_code=source_code,
        language=language,
        limit=limit,
    )
    clusters = _build_clusters(articles, mode)
    positioned_clusters = _position_clusters(clusters)
    nodes = _article_nodes(positioned_clusters)

    return {
        "nodes": nodes,
        "edges": [],
        "clusters": [_cluster_payload(cluster) for cluster in positioned_clusters],
        "stats": {
            "articles": len(nodes),
            "clusters": len(positioned_clusters),
            "sources": len({article.source.code or article.source.name for article in articles if article.source}),
            "mode": mode,
        },
        "period": {
            "date_from": date_from.isoformat() if date_from else None,
            "date_to": date_to.isoformat() if date_to else None,
        },
    }


def _load_articles(
    db: Session,
    date_from: date | None,
    date_to: date | None,
    source_code: str | None,
    language: str | None,
    limit: int,
) -> list[Article]:
    statement = (
        select(Article)
        .join(Article.source)
        .join(Article.analysis)
        .options(
            selectinload(Article.source),
            selectinload(Article.analysis),
            selectinload(Article.entities).selectinload(ArticleEntity.entity),
            selectinload(Article.events).selectinload(ArticleEvent.event),
            selectinload(Article.narrative_evidence),
        )
        .order_by(Article.published_at.desc())
        .limit(limit)
    )
    if date_from:
        statement = statement.where(Article.published_at >= _local_date_start_utc(date_from))
    if date_to:
        statement = statement.where(Article.published_at < _local_date_start_utc(date_to, add_days=1))
    if source_code:
        statement = statement.where(Source.code == source_code)
    if language:
        statement = statement.where(Article.language == language)
    return list(db.scalars(statement).all())


def _build_clusters(articles: list[Article], mode: str) -> list[dict[str, Any]]:
    if mode == "sources":
        return _group_by_source(articles)
    if mode == "events":
        return _group_by_event_or_narrative(articles)
    return _group_by_narrative_similarity(articles)


def _group_by_source(articles: list[Article]) -> list[dict[str, Any]]:
    buckets: dict[str, list[Article]] = {}
    labels: dict[str, str] = {}
    for article in articles:
        source = article.source
        key = f"source_{source.code or source.id}" if source else "source_unknown"
        buckets.setdefault(key, []).append(article)
        labels[key] = source.name if source else "Unknown source"
    return [_new_cluster(key, labels[key], "source", items) for key, items in buckets.items()]


def _group_by_event_or_narrative(articles: list[Article]) -> list[dict[str, Any]]:
    event_buckets: dict[str, list[Article]] = {}
    labels: dict[str, str] = {}
    fallback: list[Article] = []

    for article in articles:
        if article.events:
            event_link = sorted(article.events, key=lambda item: item.same_event_probability or 0, reverse=True)[0]
            key = f"event_{event_link.event_id}"
            event_buckets.setdefault(key, []).append(article)
            labels[key] = event_link.event.title
        else:
            fallback.append(article)

    clusters = [_new_cluster(key, labels[key], "event", items) for key, items in event_buckets.items()]
    clusters.extend(_group_by_narrative_similarity(fallback))
    return clusters


def _group_by_narrative_similarity(articles: list[Article]) -> list[dict[str, Any]]:
    clusters: list[dict[str, Any]] = []
    for article in articles:
        hypothesis = article.analysis.narrative_hypothesis if article.analysis else article.title
        tokens = _article_signal_tokens(article)
        entity_ids = _top_entity_ids(article)
        best_cluster = None
        best_score = 0.0
        for cluster in clusters:
            entity_overlap = len(entity_ids & cluster["entity_ids"])
            score = max(_jaccard(tokens, cluster["tokens"]), min(0.5, entity_overlap * 0.18))
            if score > best_score:
                best_cluster = cluster
                best_score = score
        if best_cluster and best_score >= 0.14:
            best_cluster["articles"].append(article)
            best_cluster["tokens"].update(tokens)
            best_cluster["entity_ids"].update(entity_ids)
            continue
        clusters.append(
            {
                "id": f"narrative_{_stable_hash(hypothesis)}",
                "label": hypothesis,
                "type": "narrative",
                "articles": [article],
                "tokens": set(tokens),
                "entity_ids": set(entity_ids),
            }
        )
    return [_finalize_cluster(cluster) for cluster in clusters]


def _new_cluster(key: str, label: str, cluster_type: str, articles: list[Article]) -> dict[str, Any]:
    return _finalize_cluster({"id": key, "label": label, "type": cluster_type, "articles": articles, "tokens": set()})


def _finalize_cluster(cluster: dict[str, Any]) -> dict[str, Any]:
    articles = cluster["articles"]
    sources = Counter(article.source.name if article.source else "Unknown" for article in articles)
    entities = Counter()
    sentiments = Counter()
    for article in articles:
        if article.analysis:
            sentiments[article.analysis.sentiment.value] += 1
        for item in sorted(article.entities, key=lambda entity: entity.importance_score or 0, reverse=True)[:4]:
            entities[item.entity.name] += 1

    label = str(cluster["label"])
    if cluster["type"] == "narrative":
        label = _shorten(label, 120)

    return {
        "id": cluster["id"],
        "label": label,
        "type": cluster["type"],
        "articles": articles,
        "count": len(articles),
        "sources": dict(sources.most_common(5)),
        "top_entities": [name for name, _ in entities.most_common(6)],
        "sentiment": dict(sentiments),
        "color": _cluster_color(cluster["id"]),
    }


def _position_clusters(clusters: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ordered = sorted(clusters, key=lambda cluster: (-cluster["count"], cluster["label"]))
    if not ordered:
        return []

    center_x = MAP_WIDTH / 2
    center_y = MAP_HEIGHT / 2
    max_count = max(cluster["count"] for cluster in ordered)

    for index, cluster in enumerate(ordered):
        if index == 0:
            cluster["x"] = center_x
            cluster["y"] = center_y
        else:
            angle = index * 2.399963229728653
            radius = 120 + 52 * math.sqrt(index)
            cluster["x"] = _clamp(center_x + math.cos(angle) * radius, 90, MAP_WIDTH - 90)
            cluster["y"] = _clamp(center_y + math.sin(angle) * radius * 0.72, 90, MAP_HEIGHT - 90)
        density_bonus = ((cluster["count"] - 1) / max(max_count - 1, 1)) * 34
        cluster["radius"] = 28 + math.sqrt(cluster["count"]) * 7 + density_bonus
        cluster["articles"] = _position_articles(cluster)
    return ordered


def _position_articles(cluster: dict[str, Any]) -> list[dict[str, Any]]:
    articles = sorted(cluster["articles"], key=lambda article: article.published_at, reverse=True)
    positioned = []
    for index, article in enumerate(articles):
        random_offset = _stable_unit(f"{cluster['id']}:{article.id}")
        angle = index * 2.399963229728653 + random_offset * 0.8
        radius = min(cluster["radius"] * 0.82, 8 + 6.8 * math.sqrt(index + 1))
        x = _clamp(cluster["x"] + math.cos(angle) * radius, 28, MAP_WIDTH - 28)
        y = _clamp(cluster["y"] + math.sin(angle) * radius * 0.78, 34, MAP_HEIGHT - 34)
        positioned.append({"article": article, "x": x, "y": y})
    return positioned


def _article_nodes(clusters: list[dict[str, Any]]) -> list[dict[str, Any]]:
    nodes: list[dict[str, Any]] = []
    for cluster in clusters:
        for item in cluster["articles"]:
            article = item["article"]
            analysis = article.analysis
            confidence = float(analysis.confidence) if analysis else 0.65
            nodes.append(
                {
                    "id": f"article_{article.id}",
                    "label": _article_display_label(article),
                    "type": "article",
                    "data": {
                        "article_id": article.id,
                        "cluster_id": cluster["id"],
                        "cluster_label": cluster["label"],
                        "cluster_type": cluster["type"],
                        "x": round(item["x"], 2),
                        "y": round(item["y"], 2),
                        "size": round(3.2 + confidence * 4.8 + len(article.entities) * 0.18, 2),
                        "color": cluster["color"],
                        "source_name": article.source.name if article.source else "Unknown",
                        "source_code": article.source.code if article.source else None,
                        "published_at": article.published_at.isoformat(),
                        "language": article.language,
                        "sentiment": analysis.sentiment.value if analysis else None,
                        "confidence": confidence,
                        "summary": analysis.short_summary if analysis else article.text[:220],
                        "framing": analysis.framing if analysis else None,
                        "narrative_hypothesis": analysis.narrative_hypothesis if analysis else None,
                        "url": article.url,
                    },
                }
            )
    return nodes


def _cluster_payload(cluster: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": cluster["id"],
        "label": cluster["label"],
        "type": cluster["type"],
        "count": cluster["count"],
        "x": round(cluster["x"], 2),
        "y": round(cluster["y"], 2),
        "radius": round(cluster["radius"], 2),
        "color": cluster["color"],
        "sources": cluster["sources"],
        "top_entities": cluster["top_entities"],
        "sentiment": cluster["sentiment"],
    }


def _tokens(value: str) -> set[str]:
    stopwords = {
        "the", "and", "with", "that", "this", "from", "into", "для", "что", "как", "или", "это", "при",
        "сша", "россия", "иран", "страна", "может", "могут", "будет", "которые", "через", "после",
    }
    return {
        token
        for token in re.findall(r"[a-zа-яё0-9]{4,}", value.lower())
        if token not in stopwords
    }


def _article_signal_tokens(article: Article) -> set[str]:
    hypothesis = article.analysis.narrative_hypothesis if article.analysis else article.title
    tokens = set(_tokens(hypothesis))
    for item in sorted(article.entities, key=lambda entity: entity.importance_score or 0, reverse=True)[:6]:
        tokens.update(_tokens(item.entity.name))
    return tokens


def _top_entity_ids(article: Article) -> set[int]:
    return {
        item.entity_id
        for item in sorted(article.entities, key=lambda entity: entity.importance_score or 0, reverse=True)[:6]
    }


def _jaccard(left: set[str], right: set[str]) -> float:
    if not left or not right:
        return 0.0
    return len(left & right) / len(left | right)


def _article_display_label(article: Article) -> str:
    if article.language == "ru" or not article.analysis:
        return article.title
    return article.analysis.short_summary or article.title


def _shorten(value: str, limit: int) -> str:
    return value if len(value) <= limit else f"{value[:limit - 3]}..."


def _cluster_color(value: str) -> str:
    palette = ["#4f8cff", "#f2b84b", "#55c78a", "#c084fc", "#f06f90", "#5fd4d6", "#df8f47", "#7aa5ff"]
    return palette[int(_stable_hash(value), 16) % len(palette)]


def _stable_hash(value: str) -> str:
    return hashlib.sha1(value.encode("utf-8")).hexdigest()[:12]


def _stable_unit(value: str) -> float:
    return int(_stable_hash(value), 16) / float(0xFFFFFFFFFFFF)


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def _local_date_start_utc(value: date, add_days: int = 0) -> datetime:
    local_start = datetime.combine(value, time.min, tzinfo=ZoneInfo("Europe/Moscow"))
    if add_days:
        local_start = local_start + timedelta(days=add_days)
    return local_start.astimezone(timezone.utc)
