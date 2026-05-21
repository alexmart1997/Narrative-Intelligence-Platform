from __future__ import annotations

from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.ingestion.service import ingest_source_period, query_articles, supported_sources
from app.config import settings
from app.llm import LlmError, call_llm
from app.schemas import (
    ArticleListItem,
    ArticleListResponse,
    IngestSourcePeriodRequest,
    IngestSourcePeriodResponse,
    LlmTestRequest,
    LlmTestResponse,
    SourceInfo,
)


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
