from __future__ import annotations

import json

from app.models import AnalysisEvidence, ArticleAnalysis, Event, Narrative
from app.schemas import (
    AnalysisEntityItem,
    AnalysisEvidenceItem,
    AnalysisRelationItem,
    ArticleAnalysisResponse,
    EventArticleItem,
    EventDetailResponse,
    EventEntityItem,
    NarrativeDetailResponse,
    NarrativeEvidenceItem,
)
from app.text_normalization import normalize_russian_text


def analysis_response(analysis: ArticleAnalysis) -> ArticleAnalysisResponse:
    """Преобразует ORM-модель анализа в API-ответ."""

    entities = [
        AnalysisEntityItem(
            id=item.entity.id,
            name=normalize_russian_text(item.entity.name),
            type=item.entity.type.value,
            role=normalize_russian_text(item.role) if item.role else item.role,
            importance_score=item.importance_score,
        )
        for item in analysis.article.entities
    ]
    relations = [
        AnalysisRelationItem(
            id=relation.id,
            source=normalize_russian_text(relation.source_entity.name),
            target=normalize_russian_text(relation.target_entity.name),
            relation_type=normalize_russian_text(relation.relation_type),
            description=normalize_russian_text(relation.description),
            confidence=relation.confidence,
        )
        for relation in analysis.article.relations
    ]

    return ArticleAnalysisResponse(
        id=analysis.id,
        article_id=analysis.article_id,
        short_summary=normalize_russian_text(analysis.short_summary),
        detailed_summary=normalize_russian_text(analysis.detailed_summary),
        sentiment=analysis.sentiment.value,
        stance=normalize_russian_text(analysis.stance),
        framing=normalize_russian_text(analysis.framing),
        sympathizes_with=[normalize_russian_text(item) for item in _json_list(analysis.sympathizes_with)],
        criticizes=[normalize_russian_text(item) for item in _json_list(analysis.criticizes)],
        narrative_hypothesis=normalize_russian_text(analysis.narrative_hypothesis),
        confidence=analysis.confidence,
        entities=entities,
        relations=relations,
        evidence=group_evidence(analysis.evidence),
    )


def group_evidence(evidence_items: list[AnalysisEvidence]) -> dict[str, list[AnalysisEvidenceItem]]:
    """Группирует evidence по evidence_type для удобного отображения в UI."""

    grouped: dict[str, list[AnalysisEvidenceItem]] = {}
    for item in evidence_items:
        grouped.setdefault(item.evidence_type, []).append(
            AnalysisEvidenceItem(
                id=item.id,
                article_id=item.article_id,
                analysis_id=item.analysis_id,
                evidence_type=item.evidence_type,
                target=normalize_russian_text(item.target),
                quote=item.quote,
                explanation=normalize_russian_text(item.explanation),
                confidence=item.confidence,
                created_at=item.created_at,
            )
        )
    return grouped


def narrative_response(narrative: Narrative) -> NarrativeDetailResponse:
    """Преобразует ORM-модель нарратива в API-ответ."""

    return NarrativeDetailResponse(
        id=narrative.id,
        title=normalize_russian_text(narrative.title),
        description=normalize_russian_text(narrative.description),
        frame=normalize_russian_text(narrative.frame),
        created_at=narrative.created_at,
        evidence=[
            NarrativeEvidenceItem(
                article_id=evidence.article_id,
                article_title=evidence.article.title,
                source_name=evidence.article.source.name if evidence.article.source else "unknown",
                evidence_text=normalize_russian_text(evidence.evidence_text),
                confidence=evidence.confidence,
            )
            for evidence in narrative.evidence
        ],
    )


def event_response(event: Event) -> EventDetailResponse:
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
