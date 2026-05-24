from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.analysis import AnalysisError, parse_llm_json
from app.llm import LlmError, call_llm
from app.models import ArticleAnalysis, Narrative, NarrativeEvidence
from app.vector import get_embedding_model


DISCOVERY_THRESHOLD = 0.75


class NarrativeDiscoveryError(Exception):
    """Ошибка поиска и сохранения общих нарративов."""


@dataclass
class HypothesisItem:
    """Гипотеза нарратива вместе с embedding и ссылкой на анализ статьи."""

    analysis: ArticleAnalysis
    hypothesis: str
    vector: list[float]


def discover_narratives(db: Session) -> dict[str, int]:
    """Группирует похожие narrative_hypothesis и сохраняет найденные нарративы."""

    analyses = list(
        db.scalars(
            select(ArticleAnalysis).where(
                ArticleAnalysis.narrative_hypothesis.is_not(None),
                ArticleAnalysis.narrative_hypothesis != "",
            )
        ).all()
    )
    if not analyses:
        return {"total_analyses": 0, "clusters": 0, "created_narratives": 0}

    items = _build_hypothesis_items(analyses)
    clusters = _cluster_items(items, threshold=DISCOVERY_THRESHOLD)

    # Для MVP делаем discovery идемпотентным: каждый запуск пересобирает общий слой нарративов.
    db.execute(delete(NarrativeEvidence))
    db.execute(delete(Narrative))
    db.flush()

    created = 0
    for cluster in clusters:
        narrative_data = _summarize_cluster(cluster)
        narrative = Narrative(
            title=_string(narrative_data.get("title"), "Untitled narrative")[:255],
            description=_string(narrative_data.get("description"), ""),
            frame=_string(narrative_data.get("frame"), ""),
        )
        db.add(narrative)
        db.flush()

        confidence = _score(narrative_data.get("confidence"))
        for item in cluster:
            db.merge(
                NarrativeEvidence(
                    narrative_id=narrative.id,
                    article_id=item.analysis.article_id,
                    evidence_text=item.hypothesis,
                    confidence=confidence or item.analysis.confidence,
                )
            )
        created += 1

    db.commit()
    return {"total_analyses": len(analyses), "clusters": len(clusters), "created_narratives": created}


def build_narrative_graph(db: Session, narrative_id: int) -> dict[str, list[dict[str, Any]]]:
    """Строит граф нарратива: статьи, источники и главные сущности."""

    narrative = db.get(Narrative, narrative_id)
    if narrative is None:
        raise NarrativeDiscoveryError("Нарратив не найден")

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

    narrative_node_id = f"narrative_{narrative.id}"
    add_node(
        narrative_node_id,
        narrative.title,
        "narrative",
        {"narrative_id": narrative.id, "description": narrative.description, "frame": narrative.frame},
    )

    for evidence in narrative.evidence:
        article = evidence.article
        article_node_id = f"article_{article.id}"
        source_node_id = f"source_{article.source_id}"
        add_node(
            article_node_id,
            article.title,
            "article",
            {
                "article_id": article.id,
                "url": article.url,
                "published_at": article.published_at.isoformat(),
                "language": article.language,
                "evidence_text": evidence.evidence_text,
                "confidence": evidence.confidence,
            },
        )
        add_edge(article_node_id, narrative_node_id, "supports_narrative", {"confidence": evidence.confidence})

        add_node(
            source_node_id,
            article.source.name if article.source else "unknown",
            "source",
            {"source_id": article.source_id, "url": article.source.url if article.source else None},
        )
        add_edge(article_node_id, source_node_id, "published_by")

        for article_entity in sorted(
            article.entities,
            key=lambda item: item.importance_score or 0.0,
            reverse=True,
        )[:5]:
            entity = article_entity.entity
            entity_node_id = f"entity_{entity.id}"
            entity_type = entity.type.value if entity.type.value in _allowed_entity_types() else "concept"
            add_node(
                entity_node_id,
                entity.name,
                entity_type,
                {
                    "entity_id": entity.id,
                    "role": article_entity.role,
                    "importance_score": article_entity.importance_score,
                },
            )
            add_edge(article_node_id, entity_node_id, "mentions", {"importance_score": article_entity.importance_score})

    return {"nodes": nodes, "edges": edges}


def _build_hypothesis_items(analyses: list[ArticleAnalysis]) -> list[HypothesisItem]:
    model = get_embedding_model()
    hypotheses = [analysis.narrative_hypothesis.strip() for analysis in analyses]
    vectors = model.encode(hypotheses, normalize_embeddings=True)
    return [
        HypothesisItem(
            analysis=analysis,
            hypothesis=hypothesis,
            vector=[float(value) for value in vector.tolist()],
        )
        for analysis, hypothesis, vector in zip(analyses, hypotheses, vectors)
    ]


def _cluster_items(items: list[HypothesisItem], threshold: float) -> list[list[HypothesisItem]]:
    clusters: list[list[HypothesisItem]] = []
    for item in items:
        target_cluster = None
        for cluster in clusters:
            if any(_cosine_similarity(item.vector, member.vector) >= threshold for member in cluster):
                target_cluster = cluster
                break
        if target_cluster is None:
            clusters.append([item])
        else:
            target_cluster.append(item)
    return clusters


def _summarize_cluster(cluster: list[HypothesisItem]) -> dict[str, Any]:
    prompt = _build_narrative_prompt(cluster)
    try:
        raw_response = call_llm(prompt)
        data = parse_llm_json(raw_response)
    except (LlmError, AnalysisError) as exc:
        raise NarrativeDiscoveryError(str(exc)) from exc

    _validate_narrative_payload(data)
    return data


def _build_narrative_prompt(cluster: list[HypothesisItem]) -> str:
    hypotheses = "\n".join(
        f"{index}. {item.hypothesis}"
        for index, item in enumerate(cluster, start=1)
    )
    return f"""
Ты аналитик политических нарративов. Ниже список похожих гипотез нарратива из разных статей.
Обобщи их в один общий нарратив и верни СТРОГО один JSON без markdown и текста вокруг.
Все текстовые значения JSON пиши на русском языке, даже если гипотезы частично на английском.

Формат JSON:
{{
  "title": "...",
  "description": "...",
  "frame": "...",
  "confidence": 0.0
}}

Правила:
- title должен быть коротким и понятным.
- description объясняет общий смысл нарратива.
- frame описывает фрейм, через который подается событие или тема.
- confidence число от 0 до 1.
- Не добавляй факты, которых нет в гипотезах.

Гипотезы:
{hypotheses}
""".strip()


def _validate_narrative_payload(data: dict[str, Any]) -> None:
    for field in ["title", "description", "frame"]:
        if not isinstance(data.get(field), str) or not data[field].strip():
            raise NarrativeDiscoveryError(f"В JSON отсутствует строковое поле '{field}'")
    data["confidence"] = _score(data.get("confidence"))


def _cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    return sum(a * b for a, b in zip(left, right))


def _score(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return min(max(number, 0.0), 1.0)


def _string(value: Any, fallback: str) -> str:
    return value.strip() if isinstance(value, str) and value.strip() else fallback


def _allowed_entity_types() -> set[str]:
    return {"person", "organization", "country", "location", "concept"}
