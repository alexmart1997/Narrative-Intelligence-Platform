from __future__ import annotations

from functools import lru_cache
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.article_similarity import (
    SIMILARITY_GUARD_VERSION,
    articles_are_contextually_related,
    looks_like_same_source_duplicate,
    relation_debug_data,
)
from app.config import settings
from app.models import Article, ArticleAnalysis


class VectorError(Exception):
    """Ошибка векторизации или обращения к Qdrant."""


DEFAULT_SIMILARITY_SCORE_THRESHOLD = 0.68


@lru_cache(maxsize=1)
def get_embedding_model() -> Any:
    """Лениво загружает локальную sentence-transformers модель."""

    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(settings.embedding_model)


@lru_cache(maxsize=1)
def get_qdrant_client() -> Any:
    """Создает клиент Qdrant."""

    from qdrant_client import QdrantClient

    # Для локального Qdrant отключаем proxy из окружения, как и для Ollama.
    return QdrantClient(
        url=f"http://{settings.qdrant_host}:{settings.qdrant_port}",
        prefer_grpc=False,
        timeout=30,
        trust_env=False,
    )


def embed_article(db: Session, article_id: int) -> dict[str, Any]:
    """Создает embedding статьи и сохраняет его в Qdrant."""

    article = db.get(Article, article_id)
    if article is None:
        raise VectorError("Статья не найдена")
    if article.analysis is None:
        raise VectorError("Сначала нужно выполнить LLM-анализ статьи")

    vector = build_embedding(article, article.analysis)
    payload = {
        "article_id": article.id,
        "title": article.title,
        "url": article.url,
        "source_name": article.source.name if article.source else "",
        "published_at": article.published_at.isoformat(),
        "language": article.language,
    }

    try:
        ensure_collection(len(vector))
        client = get_qdrant_client()
        from qdrant_client.models import PointStruct

        client.upsert(
            collection_name=settings.qdrant_collection,
            points=[PointStruct(id=article.id, vector=vector, payload=payload)],
        )
    except Exception as exc:
        raise VectorError(f"Не удалось сохранить embedding в Qdrant: {exc}") from exc

    return {"article_id": article.id, "collection": settings.qdrant_collection, "vector_size": len(vector)}


def embed_all_articles(db: Session) -> dict[str, int]:
    """Векторизует все статьи, у которых уже есть LLM-анализ."""

    articles = list(db.scalars(select(Article).join(ArticleAnalysis)).all())
    embedded = 0
    errors = 0
    for article in articles:
        try:
            embed_article(db, article.id)
            embedded += 1
        except VectorError:
            errors += 1
    return {"total": len(articles), "embedded": embedded, "errors": errors}


def find_similar_articles(
    db: Session,
    article_id: int,
    limit: int,
    min_score: float = DEFAULT_SIMILARITY_SCORE_THRESHOLD,
) -> list[dict[str, Any]]:
    """Ищет похожие статьи в Qdrant для сравнения освещения одного события."""

    article = db.get(Article, article_id)
    if article is None:
        raise VectorError("Статья не найдена")
    if article.analysis is None:
        raise VectorError("Сначала нужно выполнить LLM-анализ статьи")

    query_vector = build_embedding(article, article.analysis)
    try:
        ensure_collection(len(query_vector))
        client = get_qdrant_client()
        from qdrant_client.models import FieldCondition, Filter, MatchValue

        results = client.search(
            collection_name=settings.qdrant_collection,
            query_vector=query_vector,
            query_filter=Filter(
                must_not=[
                    FieldCondition(key="article_id", match=MatchValue(value=article_id)),
                ],
            ),
            # Берем с запасом: ниже можем отфильтровать технические дубли одного материала.
            limit=min(max(limit * 5, limit + 10), 100),
            with_payload=True,
        )
    except Exception as exc:
        raise VectorError(f"Не удалось выполнить поиск в Qdrant: {exc}") from exc

    items = []
    for result in results:
        payload = result.payload or {}
        candidate_article_id = payload.get("article_id")
        if not isinstance(candidate_article_id, int):
            continue
        candidate_article = db.get(Article, candidate_article_id)
        if candidate_article is None:
            continue
        if looks_like_same_source_duplicate(article, candidate_article):
            continue
        if not articles_are_contextually_related(article, candidate_article, float(result.score), mode="vector"):
            continue

        debug_data = relation_debug_data(article, candidate_article, float(result.score))
        item = {
            "score": result.score,
            "article_id": candidate_article_id,
            "title": payload.get("title", ""),
            "source_name": payload.get("source_name", ""),
            "published_at": payload.get("published_at", ""),
            "language": payload.get("language", ""),
            "guard_version": SIMILARITY_GUARD_VERSION,
            "match_reason": debug_data,
        }
        items.append(item)
        if len(items) >= limit:
            break

    # Qdrant всегда возвращает ближайшие точки, даже если реальной смысловой
    # близости почти нет. Для аналитического UI низкие score лучше скрывать.
    return [item for item in items if float(item["score"]) >= min_score]


def build_embedding(article: Article, analysis: ArticleAnalysis) -> list[float]:
    """Строит embedding по title + short_summary + text[:3000]."""

    text = "\n\n".join(
        [
            article.title,
            analysis.short_summary,
            article.text[:3000],
        ]
    )
    model = get_embedding_model()
    vector = model.encode(text, normalize_embeddings=True)
    return [float(value) for value in vector.tolist()]


def ensure_collection(vector_size: int) -> None:
    """Создает коллекцию Qdrant, если ее еще нет."""

    client = get_qdrant_client()
    collections = client.get_collections().collections
    exists = any(collection.name == settings.qdrant_collection for collection in collections)
    if exists:
        return

    from qdrant_client.models import Distance, VectorParams

    client.create_collection(
        collection_name=settings.qdrant_collection,
        vectors_config=VectorParams(size=vector_size, distance=Distance.COSINE),
    )
