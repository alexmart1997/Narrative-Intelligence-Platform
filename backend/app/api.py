from __future__ import annotations

from datetime import date, timedelta
import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.analysis import AnalysisError, analyze_article
from app.comparison import ComparisonError, compare_articles, compare_with_similar
from app.database import get_db
from app.ingestion.service import ingest_source_period, query_articles, supported_sources
from app.config import settings
from app.llm import LlmError, call_llm
from app.models import ArticleAnalysis
from app.schemas import (
    AnalysisEntityItem,
    AnalysisRelationItem,
    ArticleEmbedResponse,
    ArticleListItem,
    ArticleListResponse,
    ArticleAnalysisResponse,
    ArticleComparisonResult,
    EmbedAllResponse,
    CompareArticlesRequest,
    CompareWithSimilarResponse,
    IngestSourcePeriodRequest,
    IngestSourcePeriodResponse,
    LlmTestRequest,
    LlmTestResponse,
    SimilarArticlesResponse,
    SourceInfo,
)
from app.vector import VectorError, embed_all_articles, embed_article, find_similar_articles


router = APIRouter()


@router.get("/ingest/sources", response_model=list[SourceInfo])
def list_ingest_sources() -> list[dict[str, str]]:
    """Список источников, для которых есть адаптеры загрузки."""

    return supported_sources()


@router.post("/ingest/source-period", response_model=IngestSourcePeriodResponse)
def ingest_by_source_period(
    payload: IngestSourcePeriodRequest,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    """Загружает материалы выбранного источника за период дат."""

    if payload.date_from > payload.date_to:
        raise HTTPException(status_code=422, detail="date_from должен быть меньше или равен date_to")

    try:
        return ingest_source_period(
            db=db,
            source_code=payload.source_code,
            date_from=payload.date_from,
            date_to=payload.date_to,
            limit=payload.limit,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/articles", response_model=ArticleListResponse)
def list_articles(
    source_code: Optional[str] = None,
    source_name: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    language: Optional[str] = None,
    material_type: Optional[str] = None,
    section: Optional[str] = None,
    q: Optional[str] = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> ArticleListResponse:
    """Возвращает загруженные статьи с фильтрами."""

    date_to_exclusive = date_to + timedelta(days=1) if date_to else None
    articles = query_articles(
        db=db,
        source_code=source_code,
        source_name=source_name,
        date_from=date_from,
        date_to=date_to_exclusive,
        language=language,
        material_type=material_type,
        section=section,
        q=q,
        limit=limit,
        offset=offset,
    )

    items = [
        ArticleListItem(
            id=article.id,
            source_code=article.source.code,
            source_name=article.source.name,
            title=article.title,
            url=article.url,
            published_at=article.published_at,
            language=article.language,
            section=article.section,
            author=article.author,
            material_type=article.material_type.value,
            text_preview=article.text[:500],
        )
        for article in articles
    ]
    return ArticleListResponse(items=items, count=len(items))


@router.post("/llm/test", response_model=LlmTestResponse)
def test_llm(payload: LlmTestRequest) -> LlmTestResponse:
    """Проверяет связь backend с локальной моделью Ollama."""

    try:
        answer = call_llm(payload.prompt)
    except LlmError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return LlmTestResponse(model=settings.ollama_model, response=answer)


@router.post("/articles/{article_id}/analyze", response_model=ArticleAnalysisResponse)
def analyze_article_endpoint(
    article_id: int,
    db: Session = Depends(get_db),
) -> ArticleAnalysisResponse:
    """Запускает LLM-анализ статьи и сохраняет результат."""

    try:
        analysis = analyze_article(db, article_id)
    except AnalysisError as exc:
        message = str(exc)
        status_code = 404 if message == "Статья не найдена" else 422
        if "Ollama" in message:
            status_code = 503
        raise HTTPException(status_code=status_code, detail=message) from exc

    return _analysis_response(analysis)


@router.get("/articles/{article_id}/analysis", response_model=ArticleAnalysisResponse)
def get_article_analysis(
    article_id: int,
    db: Session = Depends(get_db),
) -> ArticleAnalysisResponse:
    """Возвращает сохраненный LLM-анализ статьи."""

    analysis = db.query(ArticleAnalysis).filter(ArticleAnalysis.article_id == article_id).one_or_none()
    if analysis is None:
        raise HTTPException(status_code=404, detail="Анализ статьи не найден")
    return _analysis_response(analysis)


@router.post("/articles/{article_id}/embed", response_model=ArticleEmbedResponse)
def embed_article_endpoint(
    article_id: int,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    """Создает embedding одной статьи и сохраняет его в Qdrant."""

    try:
        return embed_article(db, article_id)
    except VectorError as exc:
        raise _vector_http_error(exc) from exc


@router.post("/articles/embed-all", response_model=EmbedAllResponse)
def embed_all_articles_endpoint(db: Session = Depends(get_db)) -> dict[str, int]:
    """Векторизует все статьи, у которых есть LLM-анализ."""

    return embed_all_articles(db)


@router.get("/articles/{article_id}/similar", response_model=SimilarArticlesResponse)
def similar_articles_endpoint(
    article_id: int,
    limit: int = Query(default=10, ge=1, le=50),
    db: Session = Depends(get_db),
) -> SimilarArticlesResponse:
    """Ищет похожие статьи в Qdrant."""

    try:
        items = find_similar_articles(db, article_id=article_id, limit=limit)
    except VectorError as exc:
        raise _vector_http_error(exc) from exc
    return SimilarArticlesResponse(article_id=article_id, items=items)


@router.post("/compare/articles", response_model=ArticleComparisonResult)
def compare_articles_endpoint(
    payload: CompareArticlesRequest,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    """Сравнивает две статьи через локальную LLM."""

    try:
        return compare_articles(db, payload.article_id_1, payload.article_id_2)
    except ComparisonError as exc:
        raise _comparison_http_error(exc) from exc


@router.get("/articles/{article_id}/compare-with-similar", response_model=CompareWithSimilarResponse)
def compare_with_similar_endpoint(
    article_id: int,
    db: Session = Depends(get_db),
) -> CompareWithSimilarResponse:
    """Сравнивает статью с top-3 похожими материалами из Qdrant."""

    try:
        items = compare_with_similar(db, article_id)
    except ComparisonError as exc:
        raise _comparison_http_error(exc) from exc
    return CompareWithSimilarResponse(article_id=article_id, items=items)


def _analysis_response(analysis: ArticleAnalysis) -> ArticleAnalysisResponse:
    """Преобразует ORM-модель анализа в API-ответ."""

    entities = [
        AnalysisEntityItem(
            id=item.entity.id,
            name=item.entity.name,
            type=item.entity.type.value,
            role=item.role,
            importance_score=item.importance_score,
        )
        for item in analysis.article.entities
    ]
    relations = [
        AnalysisRelationItem(
            id=relation.id,
            source=relation.source_entity.name,
            target=relation.target_entity.name,
            relation_type=relation.relation_type,
            description=relation.description,
            confidence=relation.confidence,
        )
        for relation in analysis.article.relations
    ]

    return ArticleAnalysisResponse(
        id=analysis.id,
        article_id=analysis.article_id,
        short_summary=analysis.short_summary,
        detailed_summary=analysis.detailed_summary,
        sentiment=analysis.sentiment.value,
        stance=analysis.stance,
        framing=analysis.framing,
        sympathizes_with=_json_list(analysis.sympathizes_with),
        criticizes=_json_list(analysis.criticizes),
        narrative_hypothesis=analysis.narrative_hypothesis,
        confidence=analysis.confidence,
        entities=entities,
        relations=relations,
    )


def _json_list(value: str | None) -> list[str]:
    if not value:
        return []
    try:
        data = json.loads(value)
    except json.JSONDecodeError:
        return []
    if not isinstance(data, list):
        return []
    return [item for item in data if isinstance(item, str)]


def _vector_http_error(exc: VectorError) -> HTTPException:
    message = str(exc)
    if message == "Статья не найдена":
        return HTTPException(status_code=404, detail=message)
    if "Сначала нужно выполнить" in message:
        return HTTPException(status_code=400, detail=message)
    return HTTPException(status_code=503, detail=message)


def _comparison_http_error(exc: ComparisonError) -> HTTPException:
    message = str(exc)
    if "не найдена" in message:
        return HTTPException(status_code=404, detail=message)
    if "сначала нужно выполнить" in message:
        return HTTPException(status_code=400, detail=message)
    if "Ollama" in message or "Qdrant" in message:
        return HTTPException(status_code=503, detail=message)
    return HTTPException(status_code=422, detail=message)
