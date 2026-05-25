from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.article_similarity import SIMILARITY_GUARD_VERSION
from app.comparison import compare_with_similar
from app.events import detect_event_for_article
from app.graph import build_article_graph
from app.models import Article, ArticleAnalysis, ArticlePrecomputeCache, Source
from app.vector import embed_article, find_similar_articles


PRECOMPUTE_CACHE_VERSION = SIMILARITY_GUARD_VERSION


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
        try:
            single_result = precompute_single_article(
                db,
                article.id,
                include_graph=True,
                include_similar=True,
                include_compare=include_compare,
                limit_related=params.get("limit_related", 30),
                similar_limit=params.get("similar_limit", 10),
                ensure_support_layers=True,
            )

            result["processed"] += 1
            result["cached_graphs"] += int(bool(single_result.get("cached_graph")))
            result["cached_similar"] += int(bool(single_result.get("cached_similar")))
            if single_result.get("cached_compare"):
                result["cached_comparisons"] += 1
        except Exception as exc:
            result["failed"] += 1
            result["errors"].append({"article_id": article.id, "error": str(exc)})

    return result


def precompute_single_article(
    db: Session,
    article_id: int,
    *,
    include_graph: bool = True,
    include_similar: bool = True,
    include_compare: bool = False,
    limit_related: int = 30,
    similar_limit: int = 10,
    ensure_support_layers: bool = True,
) -> dict[str, Any]:
    """Готовит кэш для одной статьи.

    Функция используется и старым синхронным endpoint, и новым jobs runner.
    Поэтому здесь держим маленькую атомарную единицу работы: одна статья,
    один cache row, понятный результат.
    """

    article = db.get(Article, article_id)
    if article is None:
        raise ValueError("Статья не найдена")
    if article.analysis is None:
        raise ValueError("Для подготовки похожих материалов и графа сначала нужен анализ статьи")

    cache = _get_or_create_cache(db, article.id)
    cache.status = "running"
    cache.error = None
    db.commit()

    try:
        # Эти шаги делают последующий graph/similar почти мгновенными для пользователя.
        if ensure_support_layers:
            embed_article(db, article.id)
            detect_event_for_article(db, article.id)

        graph = (
            build_article_graph(db, article.id, include_related=True, limit_related=limit_related)
            if include_graph
            else None
        )
        similar = (
            find_similar_articles(db, article_id=article.id, limit=similar_limit, min_score=0.68)
            if include_similar
            else None
        )
        compare = compare_with_similar(db, article.id) if include_compare else None

        if graph is not None:
            cache.graph_json = json.dumps(graph, ensure_ascii=False, default=str)
        if similar is not None:
            cache.similar_json = json.dumps(similar, ensure_ascii=False, default=str)
        if compare is not None:
            cache.compare_json = json.dumps(compare, ensure_ascii=False, default=str)
        cache.status = "ready"
        cache.updated_at = datetime.now(timezone.utc)
        db.commit()
        return {
            "article_id": article.id,
            "cached_graph": graph is not None,
            "cached_similar": similar is not None,
            "cached_compare": compare is not None,
        }
    except Exception as exc:
        db.rollback()
        cache = _get_or_create_cache(db, article.id)
        cache.status = "failed"
        cache.error = str(exc)
        cache.updated_at = datetime.now(timezone.utc)
        db.commit()
        raise


def get_cached_graph(db: Session, article_id: int) -> dict[str, Any] | None:
    cache = db.scalar(select(ArticlePrecomputeCache).where(ArticlePrecomputeCache.article_id == article_id))
    data = _loads_json(cache.graph_json) if cache and cache.graph_json and cache.status == "ready" else None
    if not isinstance(data, dict) or not _has_fresh_graph_shape(data):
        return None
    return data


def get_cached_similar(db: Session, article_id: int) -> list[dict[str, Any]] | None:
    cache = db.scalar(select(ArticlePrecomputeCache).where(ArticlePrecomputeCache.article_id == article_id))
    data = _loads_json(cache.similar_json) if cache and cache.similar_json and cache.status == "ready" else None
    if not isinstance(data, list) or not _has_fresh_list_cache(data):
        return None
    return data


def get_cached_compare(db: Session, article_id: int) -> list[dict[str, Any]] | None:
    cache = db.scalar(select(ArticlePrecomputeCache).where(ArticlePrecomputeCache.article_id == article_id))
    data = _loads_json(cache.compare_json) if cache and cache.compare_json and cache.status == "ready" else None
    if not isinstance(data, list) or not _has_fresh_list_cache(data):
        return None
    return data


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


def _has_fresh_graph_shape(data: dict[str, Any]) -> bool:
    """Не отдаем старый graph cache после изменения payload для русских подписей."""

    nodes = data.get("nodes")
    if not isinstance(nodes, list):
        return False
    for node in nodes:
        if not isinstance(node, dict) or node.get("type") != "article":
            continue
        node_data = node.get("data")
        if (
            not isinstance(node_data, dict)
            or "display_label" not in node_data
            or node_data.get("similarity_guard_version") != PRECOMPUTE_CACHE_VERSION
        ):
            return False
    return True


def _has_fresh_list_cache(data: list[dict[str, Any]]) -> bool:
    """Не используем старые similar/compare cache без версии смыслового фильтра."""

    return all(isinstance(item, dict) and item.get("guard_version") == PRECOMPUTE_CACHE_VERSION for item in data)
