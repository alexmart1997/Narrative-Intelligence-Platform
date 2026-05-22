from __future__ import annotations

from datetime import date, timedelta
import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

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
from app.ingestion.service import ingest_source_period, query_articles, supported_sources
from app.config import settings
from app.llm import LlmError, call_llm
from app.models import AnalysisEvidence, ArticleAnalysis, Event, Narrative
from app.narratives import NarrativeDiscoveryError, build_narrative_graph, discover_narratives
from app.pipeline import PipelineError, latest_pipeline_run, pipeline_run_to_dict, process_articles_pipeline
from app.source_profile import SourceProfileError, build_source_profile
from app.schemas import (
    AnalysisEntityItem,
    AnalysisEvidenceItem,
    AnalysisRelationItem,
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
    LlmTestRequest,
    LlmTestResponse,
    EventDetectAllResponse,
    EventDetectionResponse,
    EventArticleItem,
    EventDetailResponse,
    EventEntityItem,
    EventListItem,
    NarrativeDetailResponse,
    NarrativeDiscoveryResponse,
    NarrativeEvidenceItem,
    NarrativeListItem,
    PipelineProcessRequest,
    PipelineProcessResponse,
    PipelineRunResponse,
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
            has_analysis=article.analysis is not None,
            has_event=len(article.events) > 0,
        )
        for article in articles
    ]
    return ArticleListResponse(items=items, count=len(items))


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
    return _group_evidence(evidence_items)


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


@router.get("/graph/article/{article_id}", response_model=ArticleGraphResponse)
def article_graph_endpoint(
    article_id: int,
    include_related: bool = False,
    limit_related: int = Query(default=10, ge=1, le=50),
    db: Session = Depends(get_db),
) -> dict[str, list[dict]]:
    """Возвращает граф статьи, источника, сущностей, отношений и нарратива."""

    try:
        return build_article_graph(
            db,
            article_id,
            include_related=include_related,
            limit_related=limit_related,
        )
    except GraphError as exc:
        message = str(exc)
        status_code = 404 if message == "Статья не найдена" else 400
        raise HTTPException(status_code=status_code, detail=message) from exc


@router.post("/articles/{article_id}/detect-event", response_model=EventDetectionResponse)
def detect_article_event_endpoint(
    article_id: int,
    db: Session = Depends(get_db),
) -> EventDetectionResponse:
    """Определяет событие для одной статьи и связывает ее с event."""

    try:
        event = detect_event_for_article(db, article_id)
    except EventDetectionError as exc:
        raise _event_http_error(exc) from exc
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
    return _event_response(event)


@router.get("/graph/event/{event_id}", response_model=ArticleGraphResponse)
def event_graph_endpoint(
    event_id: int,
    db: Session = Depends(get_db),
) -> dict[str, list[dict]]:
    """Возвращает граф события: статьи, источники, сущности и нарративы."""

    try:
        return build_event_graph(db, event_id)
    except EventDetectionError as exc:
        raise _event_http_error(exc) from exc


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
        raise _narrative_http_error(exc) from exc


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
    return _narrative_response(narrative)


@router.get("/graph/narrative/{narrative_id}", response_model=ArticleGraphResponse)
def narrative_graph_endpoint(
    narrative_id: int,
    db: Session = Depends(get_db),
) -> dict[str, list[dict]]:
    """Возвращает граф нарратива, связанных статей, источников и сущностей."""

    try:
        return build_narrative_graph(db, narrative_id)
    except NarrativeDiscoveryError as exc:
        raise _narrative_http_error(exc) from exc


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
        evidence=_group_evidence(analysis.evidence),
    )


def _group_evidence(evidence_items: list[AnalysisEvidence]) -> dict[str, list[AnalysisEvidenceItem]]:
    """Группирует evidence по evidence_type для удобного отображения в UI."""

    grouped: dict[str, list[AnalysisEvidenceItem]] = {}
    for item in evidence_items:
        grouped.setdefault(item.evidence_type, []).append(
            AnalysisEvidenceItem(
                id=item.id,
                article_id=item.article_id,
                analysis_id=item.analysis_id,
                evidence_type=item.evidence_type,
                target=item.target,
                quote=item.quote,
                explanation=item.explanation,
                confidence=item.confidence,
                created_at=item.created_at,
            )
        )
    return grouped


def _narrative_response(narrative: Narrative) -> NarrativeDetailResponse:
    """Преобразует ORM-модель нарратива в API-ответ."""

    return NarrativeDetailResponse(
        id=narrative.id,
        title=narrative.title,
        description=narrative.description,
        frame=narrative.frame,
        created_at=narrative.created_at,
        evidence=[
            NarrativeEvidenceItem(
                article_id=evidence.article_id,
                article_title=evidence.article.title,
                source_name=evidence.article.source.name if evidence.article.source else "unknown",
                evidence_text=evidence.evidence_text,
                confidence=evidence.confidence,
            )
            for evidence in narrative.evidence
        ],
    )


def _event_response(event: Event) -> EventDetailResponse:
    """Преобразует ORM-модель события в API-ответ."""

    return EventDetailResponse(
        id=event.id,
        title=event.title,
        description=event.description,
        event_date=event.event_date,
        event_type=event.event_type,
        location=event.location,
        created_at=event.created_at,
        articles=[
            EventArticleItem(
                article_id=link.article_id,
                article_title=link.article.title,
                source_name=link.article.source.name if link.article.source else "unknown",
                same_event_probability=link.same_event_probability,
                evidence_text=link.evidence_text,
                published_at=link.article.published_at,
            )
            for link in event.articles
        ],
        entities=[
            EventEntityItem(
                entity_id=item.entity_id,
                name=item.entity.name,
                type=item.entity.type.value,
                role=item.role,
                importance_score=item.importance_score,
            )
            for item in event.entities
        ],
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


def _narrative_http_error(exc: NarrativeDiscoveryError) -> HTTPException:
    message = str(exc)
    if "не найден" in message:
        return HTTPException(status_code=404, detail=message)
    if "Ollama" in message:
        return HTTPException(status_code=503, detail=message)
    return HTTPException(status_code=422, detail=message)


def _event_http_error(exc: EventDetectionError) -> HTTPException:
    message = str(exc)
    if "не найден" in message:
        return HTTPException(status_code=404, detail=message)
    if "Сначала нужно" in message:
        return HTTPException(status_code=400, detail=message)
    if "Ollama" in message or "Qdrant" in message:
        return HTTPException(status_code=503, detail=message)
    return HTTPException(status_code=422, detail=message)
