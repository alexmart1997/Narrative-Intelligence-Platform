from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api_responses import analysis_response, event_response, group_evidence, narrative_response
from app.analysis import AnalysisError, analyze_article
from app.comparison import ComparisonError, compare_articles, compare_with_similar
from app.database import get_db
from app.events import (
    EventDetectionError,
    build_event_graph,
    detect_all_events,
    detect_event_for_article,
    query_events,
)
from app.graph import GraphError, build_article_graph
from app.http_errors import comparison_http_error, event_http_error, narrative_http_error, vector_http_error
from app.config import settings
from app.ingestion.service import ingest_source_period, query_articles, supported_sources
from app.jobs import JobError, cancel_job, enqueue_job, get_job_or_raise, job_to_dict, list_jobs
from app.llm import LlmError, call_llm
from app.models import AnalysisEvidence, ArticleAnalysis, Event, Narrative
from app.narratives import NarrativeDiscoveryError, build_narrative_graph, discover_narratives
from app.pipeline import PipelineError, latest_pipeline_run, pipeline_run_to_dict, process_articles_pipeline
from app.precompute import get_cached_compare, get_cached_graph, get_cached_similar, precompute_article_intelligence
from app.source_profile import SourceProfileError, build_source_profile
from app.schemas import (
    AnalysisEvidenceItem,
    ArticleGraphResponse,
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
    JobAnalyzeRequest,
    JobPipelineRequest,
    JobResponse,
    LlmTestRequest,
    LlmTestResponse,
    EventDetectAllResponse,
    EventDetectionResponse,
    EventDetailResponse,
    EventListItem,
    NarrativeDetailResponse,
    NarrativeDiscoveryResponse,
    NarrativeListItem,
    PipelineProcessRequest,
    PipelineProcessResponse,
    PipelineRunResponse,
    PrecomputeRequest,
    PrecomputeResponse,
    SimilarArticlesResponse,
    SourceProfileResponse,
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
    entity_id: Optional[int] = None,
    entity_name: Optional[str] = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> ArticleListResponse:
    """Возвращает загруженные статьи с фильтрами."""

    date_from_utc = _local_date_start_utc(date_from) if date_from else None
    date_to_exclusive = _local_date_start_utc(date_to, add_days=1) if date_to else None
    articles = query_articles(
        db=db,
        source_code=source_code,
        source_name=source_name,
        date_from=date_from_utc,
        date_to=date_to_exclusive,
        language=language,
        material_type=material_type,
        section=section,
        q=q,
        entity_id=entity_id,
        entity_name=entity_name,
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
            has_analysis=article.analysis is not None,
            has_event=len(article.events) > 0,
            event_id=article.events[0].event_id if article.events else None,
        )
        for article in articles
    ]
    return ArticleListResponse(items=items, count=len(items))


def _local_date_start_utc(value: date, add_days: int = 0) -> datetime:
    """Переводит выбранный пользователем день в UTC-границу для БД.

    В интерфейсе даты показываются в локальном времени, поэтому фильтр
    "20-22 мая" должен совпадать с тем, что пользователь видит на карточках,
    а не с UTC-днем в PostgreSQL.
    """

    local_timezone = ZoneInfo("Europe/Moscow")
    local_start = datetime.combine(value, time.min, tzinfo=local_timezone)
    if add_days:
        local_start = local_start + timedelta(days=add_days)
    return local_start.astimezone(timezone.utc)


@router.get("/sources/{source_code}/profile", response_model=SourceProfileResponse)
def source_profile_endpoint(
    source_code: str,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    language: Optional[str] = None,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    """Возвращает аналитический профиль источника по уже сохраненным анализам."""

    try:
        return build_source_profile(
            db=db,
            source_code=source_code,
            date_from=date_from,
            date_to=date_to,
            language=language,
        )
    except SourceProfileError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/llm/test", response_model=LlmTestResponse)
def test_llm(payload: LlmTestRequest) -> LlmTestResponse:
    """Проверяет связь backend с локальной моделью Ollama."""

    try:
        answer = call_llm(payload.prompt)
    except LlmError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return LlmTestResponse(model=settings.ollama_model, response=answer)


@router.post("/jobs/analyze", response_model=JobResponse)
def create_analyze_job(
    payload: JobAnalyzeRequest,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    """Создает фоновую задачу полного анализа одной статьи."""

    job = enqueue_job(db, "analyze", payload.model_dump())
    return job_to_dict(job)


@router.post("/jobs/pipeline", response_model=JobResponse)
def create_pipeline_job(
    payload: JobPipelineRequest,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    """Создает фоновую batch-задачу для статей без Celery/Redis."""

    try:
        job = enqueue_job(db, "pipeline", payload.model_dump())
    except JobError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return job_to_dict(job)


@router.get("/jobs", response_model=list[JobResponse])
def jobs_endpoint(
    status: Optional[str] = None,
    job_type: Optional[str] = Query(default=None, alias="type"),
    limit: int = Query(default=30, ge=1, le=100),
    db: Session = Depends(get_db),
) -> list[dict[str, object]]:
    """Возвращает последние локальные фоновые задачи для polling в UI."""

    jobs = list_jobs(db, status=status, job_type=job_type, limit=limit)
    return [job_to_dict(job) for job in jobs]


@router.get("/jobs/{job_id}", response_model=JobResponse)
def job_endpoint(
    job_id: int,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    """Возвращает состояние одной фоновой задачи."""

    try:
        return job_to_dict(get_job_or_raise(db, job_id))
    except JobError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/jobs/{job_id}/cancel", response_model=JobResponse)
def cancel_job_endpoint(
    job_id: int,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    """Запрашивает отмену фоновой задачи."""

    try:
        return job_to_dict(cancel_job(db, job_id))
    except JobError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


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

    return analysis_response(analysis)


@router.get("/articles/{article_id}/analysis", response_model=ArticleAnalysisResponse)
def get_article_analysis(
    article_id: int,
    db: Session = Depends(get_db),
) -> ArticleAnalysisResponse:
    """Возвращает сохраненный LLM-анализ статьи."""

    analysis = db.query(ArticleAnalysis).filter(ArticleAnalysis.article_id == article_id).one_or_none()
    if analysis is None:
        raise HTTPException(status_code=404, detail="Анализ статьи не найден")
    return analysis_response(analysis)


@router.get("/articles/{article_id}/evidence", response_model=dict[str, list[AnalysisEvidenceItem]])
def get_article_evidence(
    article_id: int,
    db: Session = Depends(get_db),
) -> dict[str, list[AnalysisEvidenceItem]]:
    """Возвращает evidence статьи, сгруппированные по типу вывода."""

    evidence_items = (
        db.query(AnalysisEvidence)
        .filter(AnalysisEvidence.article_id == article_id)
        .order_by(AnalysisEvidence.evidence_type, AnalysisEvidence.created_at)
        .all()
    )
    return group_evidence(evidence_items)


@router.post("/articles/{article_id}/embed", response_model=ArticleEmbedResponse)
def embed_article_endpoint(
    article_id: int,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    """Создает embedding одной статьи и сохраняет его в Qdrant."""

    try:
        return embed_article(db, article_id)
    except VectorError as exc:
        raise vector_http_error(exc) from exc


@router.post("/articles/embed-all", response_model=EmbedAllResponse)
def embed_all_articles_endpoint(db: Session = Depends(get_db)) -> dict[str, int]:
    """Векторизует все статьи, у которых есть LLM-анализ."""

    return embed_all_articles(db)


@router.get("/articles/{article_id}/similar", response_model=SimilarArticlesResponse)
def similar_articles_endpoint(
    article_id: int,
    limit: int = Query(default=10, ge=1, le=50),
    min_score: float = Query(default=0.68, ge=0.0, le=1.0),
    db: Session = Depends(get_db),
) -> SimilarArticlesResponse:
    """Ищет похожие статьи в Qdrant."""

    try:
        if min_score == 0.68:
            cached_items = get_cached_similar(db, article_id)
            if cached_items is not None:
                return SimilarArticlesResponse(article_id=article_id, items=cached_items[:limit])
        items = find_similar_articles(db, article_id=article_id, limit=limit, min_score=min_score)
    except VectorError as exc:
        raise vector_http_error(exc) from exc
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
        raise comparison_http_error(exc) from exc


@router.get("/articles/{article_id}/compare-with-similar", response_model=CompareWithSimilarResponse)
def compare_with_similar_endpoint(
    article_id: int,
    db: Session = Depends(get_db),
) -> CompareWithSimilarResponse:
    """Сравнивает статью с top-3 похожими материалами из Qdrant."""

    try:
        cached_items = get_cached_compare(db, article_id)
        if cached_items is not None:
            return CompareWithSimilarResponse(article_id=article_id, items=cached_items)
        items = compare_with_similar(db, article_id)
    except ComparisonError as exc:
        raise comparison_http_error(exc) from exc
    return CompareWithSimilarResponse(article_id=article_id, items=items)


@router.get("/graph/article/{article_id}", response_model=ArticleGraphResponse)
def article_graph_endpoint(
    article_id: int,
    include_related: bool = False,
    limit_related: int = Query(default=10, ge=1, le=50),
    focus_entity_id: Optional[int] = None,
    db: Session = Depends(get_db),
) -> dict[str, list[dict]]:
    """Возвращает граф статьи, источника, сущностей, отношений и нарратива."""

    try:
        if include_related and focus_entity_id is None:
            cached_graph = get_cached_graph(db, article_id)
            if cached_graph is not None:
                return cached_graph
        return build_article_graph(
            db,
            article_id,
            include_related=include_related,
            limit_related=limit_related,
            focus_entity_id=focus_entity_id,
        )
    except GraphError as exc:
        message = str(exc)
        status_code = 404 if message == "Статья не найдена" else 400
        raise HTTPException(status_code=status_code, detail=message) from exc


@router.post("/pipeline/precompute-intelligence", response_model=PrecomputeResponse)
def precompute_intelligence_endpoint(
    payload: PrecomputeRequest,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    """Заранее считает graph/similar/compare cache для быстрого UI."""

    return precompute_article_intelligence(db, payload.model_dump())


@router.post("/articles/{article_id}/detect-event", response_model=EventDetectionResponse)
def detect_article_event_endpoint(
    article_id: int,
    db: Session = Depends(get_db),
) -> EventDetectionResponse:
    """Определяет событие для одной статьи и связывает ее с event."""

    try:
        event = detect_event_for_article(db, article_id)
    except EventDetectionError as exc:
        raise event_http_error(exc) from exc
    return EventDetectionResponse(event_id=event.id, title=event.title, article_id=article_id)


@router.post("/events/detect-all", response_model=EventDetectAllResponse)
def detect_all_events_endpoint(db: Session = Depends(get_db)) -> dict[str, int]:
    """Запускает event matching для всех проанализированных статей."""

    return detect_all_events(db)


@router.get("/events", response_model=list[EventListItem])
def list_events(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    event_type: Optional[str] = None,
    q: Optional[str] = None,
    db: Session = Depends(get_db),
) -> list[EventListItem]:
    """Возвращает события с фильтрами по дате, типу и поисковой строке."""

    events = query_events(db, date_from=date_from, date_to=date_to, event_type=event_type, q=q)
    return [
        EventListItem(
            id=event.id,
            title=event.title,
            description=event.description,
            event_date=event.event_date,
            event_type=event.event_type,
            location=event.location,
            article_count=len(event.articles),
            created_at=event.created_at,
        )
        for event in events
    ]


@router.get("/events/{event_id}", response_model=EventDetailResponse)
def get_event(
    event_id: int,
    db: Session = Depends(get_db),
) -> EventDetailResponse:
    """Возвращает событие, связанные статьи и главные сущности."""

    event = db.get(Event, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="Событие не найдено")
    return event_response(event)


@router.get("/graph/event/{event_id}", response_model=ArticleGraphResponse)
def event_graph_endpoint(
    event_id: int,
    db: Session = Depends(get_db),
) -> dict[str, list[dict]]:
    """Возвращает граф события: статьи, источники, сущности и нарративы."""

    try:
        return build_event_graph(db, event_id)
    except EventDetectionError as exc:
        raise event_http_error(exc) from exc


@router.post("/pipeline/process-articles", response_model=PipelineProcessResponse)
def process_articles_pipeline_endpoint(
    payload: PipelineProcessRequest,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    """Запускает локальный batch pipeline для выбранных статей."""

    try:
        return process_articles_pipeline(db, payload.model_dump())
    except PipelineError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/pipeline/status", response_model=PipelineRunResponse)
def pipeline_status_endpoint(db: Session = Depends(get_db)) -> dict[str, object]:
    """Возвращает последний запуск batch pipeline."""

    run = latest_pipeline_run(db)
    if run is None:
        raise HTTPException(status_code=404, detail="Pipeline еще не запускался")
    return pipeline_run_to_dict(run)


@router.post("/narratives/discover", response_model=NarrativeDiscoveryResponse)
def discover_narratives_endpoint(db: Session = Depends(get_db)) -> dict[str, int]:
    """Находит общие нарративы по narrative_hypothesis из LLM-анализов."""

    try:
        return discover_narratives(db)
    except NarrativeDiscoveryError as exc:
        raise narrative_http_error(exc) from exc


@router.get("/narratives", response_model=list[NarrativeListItem])
def list_narratives(db: Session = Depends(get_db)) -> list[NarrativeListItem]:
    """Возвращает список найденных нарративов."""

    narratives = db.query(Narrative).order_by(Narrative.created_at.desc()).all()
    return [
        NarrativeListItem(
            id=narrative.id,
            title=narrative.title,
            description=narrative.description,
            frame=narrative.frame,
            evidence_count=len(narrative.evidence),
            created_at=narrative.created_at,
        )
        for narrative in narratives
    ]


@router.get("/narratives/{narrative_id}", response_model=NarrativeDetailResponse)
def get_narrative(
    narrative_id: int,
    db: Session = Depends(get_db),
) -> NarrativeDetailResponse:
    """Возвращает нарратив и статьи-доказательства."""

    narrative = db.get(Narrative, narrative_id)
    if narrative is None:
        raise HTTPException(status_code=404, detail="Нарратив не найден")
    return narrative_response(narrative)


@router.get("/graph/narrative/{narrative_id}", response_model=ArticleGraphResponse)
def narrative_graph_endpoint(
    narrative_id: int,
    db: Session = Depends(get_db),
) -> dict[str, list[dict]]:
    """Возвращает граф нарратива, связанных статей, источников и сущностей."""

    try:
        return build_narrative_graph(db, narrative_id)
    except NarrativeDiscoveryError as exc:
        raise narrative_http_error(exc) from exc
