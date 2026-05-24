from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.comparison import compare_with_similar
from app.events import detect_event_for_article
from app.graph import build_article_graph
from app.models import Article, ArticleAnalysis, ArticlePrecomputeCache, Source
from app.vector import embed_article, find_similar_articles


class PrecomputeError(Exception):
    """Ошибка настройки precompute pipeline."""


def precompute_article_intelligence(db: Session, params: dict[str, Any]) -> dict[str, Any]:
    """Заранее считает быстрые данные для UI: embeddings, события, similar и graph cache."""

    articles = _select_articles(db, params)
    include_compare = bool(params.get("include_compare", False))
    result = {
        "selected_articles": len(articles),
        "processed": 0,
        "failed": 0,
        "cached_graphs": 0,
        "cached_similar": 0,
        "cached_comparisons": 0,
        "errors": [],
    }

    for article in articles:
        cache = _get_or_create_cache(db, article.id)
        cache.status = "running"
        cache.error = None
        db.commit()

        try:
            # Эти шаги делают последующий graph/similar почти мгновенными для пользователя.
            if article.analysis is not None:
                embed_article(db, article.id)
                detect_event_for_article(db, article.id)

            graph = build_article_graph(db, article.id, include_related=True, limit_related=params.get("limit_related", 30))
            similar = find_similar_articles(db, article_id=article.id, limit=params.get("similar_limit", 10), min_score=0.55)
            compare = compare_with_similar(db, article.id) if include_compare else None

            cache.graph_json = json.dumps(graph, ensure_ascii=False, default=str)
            cache.similar_json = json.dumps(similar, ensure_ascii=False, default=str)
            cache.compare_json = json.dumps(compare, ensure_ascii=False, default=str) if compare is not None else cache.compare_json
            cache.status = "ready"
            cache.updated_at = datetime.now(timezone.utc)
            db.commit()

            result["processed"] += 1
            result["cached_graphs"] += 1
            result["cached_similar"] += 1
            if compare is not None:
                result["cached_comparisons"] += 1
        except Exception as exc:
            db.rollback()
            cache = _get_or_create_cache(db, article.id)
            cache.status = "failed"
            cache.error = str(exc)
            cache.updated_at = datetime.now(timezone.utc)
            db.commit()
            result["failed"] += 1
            result["errors"].append({"article_id": article.id, "error": str(exc)})

    return result


def get_cached_graph(db: Session, article_id: int) -> dict[str, Any] | None:
    cache = db.scalar(select(ArticlePrecomputeCache).where(ArticlePrecomputeCache.article_id == article_id))
    return _loads_json(cache.graph_json) if cache and cache.graph_json and cache.status == "ready" else None


def get_cached_similar(db: Session, article_id: int) -> list[dict[str, Any]] | None:
    cache = db.scalar(select(ArticlePrecomputeCache).where(ArticlePrecomputeCache.article_id == article_id))
    data = _loads_json(cache.similar_json) if cache and cache.similar_json and cache.status == "ready" else None
    return data if isinstance(data, list) else None


def get_cached_compare(db: Session, article_id: int) -> list[dict[str, Any]] | None:
    cache = db.scalar(select(ArticlePrecomputeCache).where(ArticlePrecomputeCache.article_id == article_id))
    data = _loads_json(cache.compare_json) if cache and cache.compare_json and cache.status == "ready" else None
    return data if isinstance(data, list) else None


def _select_articles(db: Session, params: dict[str, Any]) -> list[Article]:
    statement = select(Article).join(Article.source).order_by(Article.published_at.desc())
    if params.get("source_code"):
        statement = statement.where(Source.code == params["source_code"])
    if params.get("date_from"):
        statement = statement.where(Article.published_at >= params["date_from"])
    if params.get("date_to"):
        statement = statement.where(Article.published_at < params["date_to"] + timedelta(days=1))
    if params.get("language"):
        statement = statement.where(Article.language == params["language"])
    if params.get("only_with_analysis", True):
        statement = statement.join(ArticleAnalysis)
    return list(db.scalars(statement.limit(params.get("limit", 100))).all())


def _get_or_create_cache(db: Session, article_id: int) -> ArticlePrecomputeCache:
    cache = db.scalar(select(ArticlePrecomputeCache).where(ArticlePrecomputeCache.article_id == article_id))
    if cache:
        return cache
    cache = ArticlePrecomputeCache(article_id=article_id, status="running")
    db.add(cache)
    db.commit()
    db.refresh(cache)
    return cache


def _loads_json(value: str | None) -> Any:
    if not value:
        return None
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return None
