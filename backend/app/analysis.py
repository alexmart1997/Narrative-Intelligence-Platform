from __future__ import annotations

import json
import re
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.llm import LlmError, call_llm
from app.models import (
    Article,
    ArticleAnalysis,
    ArticleEntity,
    AnalysisEvidence,
    Entity,
    EntityType,
    Relation,
    Sentiment,
)


class AnalysisError(Exception):
    """Ошибка анализа статьи через LLM."""


def analyze_article(db: Session, article_id: int) -> ArticleAnalysis:
    """Анализирует статью через Ollama и сохраняет результат в БД."""

    article = db.get(Article, article_id)
    if article is None:
        raise AnalysisError("Статья не найдена")

    prompt = build_analysis_prompt(article)
    try:
        raw_response = call_llm(prompt)
    except LlmError as exc:
        raise AnalysisError(str(exc)) from exc

    data = parse_llm_json(raw_response)
    validate_analysis_payload(data)
    analysis = save_analysis(db, article, data)

    # После LLM-анализа сразу кладем embedding в Qdrant для поиска похожих материалов.
    from app.vector import VectorError, embed_article

    try:
        embed_article(db, article.id)
    except VectorError as exc:
        raise AnalysisError(str(exc)) from exc
    return analysis


def build_analysis_prompt(article: Article) -> str:
    """Готовит русский prompt для политического анализа новости."""

    # Для локального batch на MacBook держим prompt компактным:
    # длинные статьи резко замедляют Ollama и блокируют массовую обработку.
    text = article.text[:5000]
    return f"""
Ты аналитик политических новостей. Проанализируй статью и верни СТРОГО один JSON без markdown, комментариев и текста вокруг.
Все текстовые значения JSON пиши на русском языке. Если статья на английском, переведи смысл выводов на русский.

Нужно определить:
- кто главные участники;
- что произошло;
- кто показан положительно;
- кто показан отрицательно;
- кому симпатизирует текст;
- какой фрейм используется;
- какой нарратив может продвигаться.

Формат JSON строго такой:
{{
  "short_summary": "...",
  "detailed_summary": "...",
  "sentiment": "positive | negative | neutral | mixed",
  "stance": "...",
  "framing": "...",
  "sympathizes_with": ["..."],
  "criticizes": ["..."],
  "narrative_hypothesis": "...",
  "entities": [
    {{
      "name": "...",
      "type": "person | organization | country | location | concept | other",
      "role": "...",
      "importance_score": 0.0
    }}
  ],
  "relations": [
    {{
      "source": "...",
      "target": "...",
      "relation_type": "...",
      "description": "...",
      "confidence": 0.0
    }}
  ],
  "confidence": 0.0,
  "evidence": [
    {{
      "evidence_type": "framing",
      "target": "...",
      "quote": "точная цитата или короткий фрагмент из статьи",
      "explanation": "почему этот фрагмент подтверждает вывод",
      "confidence": 0.0
    }}
  ]
}}

Правила:
- sentiment выбери только из: positive, negative, neutral, mixed.
- type выбери только из: person, organization, country, location, concept, other.
- confidence и importance_score должны быть числами от 0 до 1.
- short_summary: максимум 2 предложения.
- detailed_summary: максимум 5 предложений.
- stance, framing, narrative_hypothesis: по одному компактному абзацу.
- entities: максимум 12 главных сущностей.
- relations: максимум 8 главных связей.
- evidence: максимум 8 самых важных фрагментов.
- evidence_type выбери только из: sentiment, stance, framing, sympathy, criticism, narrative, entity_role, relation.
- quote должен быть коротким, до 300 символов, и дословно взят из текста статьи.
- Для framing, sympathy, criticism и narrative обязательно добавь evidence, если в тексте есть явный фрагмент.
- Если явного доказательства нет, не добавляй evidence.
- Если данных мало, используй пустые массивы, unknown/other не выдумывай сверх текста.

Источник: {article.source.name if article.source else "unknown"}
Заголовок: {article.title}
Язык статьи: {article.language}
Текст статьи:
\"\"\"
{text}
\"\"\"
""".strip()


def parse_llm_json(raw_response: str) -> dict[str, Any]:
    """Достает JSON из ответа модели, даже если вокруг есть лишний текст."""

    cleaned = raw_response.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)

    candidates = [cleaned]
    match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
    if match:
        candidates.append(match.group(0))

    for candidate in candidates:
        try:
            data = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(data, dict):
            return data

    preview = cleaned[:500]
    raise AnalysisError(f"LLM вернула невалидный JSON. Начало ответа: {preview}")


def validate_analysis_payload(data: dict[str, Any]) -> None:
    """Проверяет минимальную структуру ответа LLM перед сохранением."""

    required_string_fields = [
        "short_summary",
        "detailed_summary",
        "sentiment",
        "stance",
        "framing",
        "narrative_hypothesis",
    ]
    for field in required_string_fields:
        if not isinstance(data.get(field), str) or not data[field].strip():
            raise AnalysisError(f"В JSON отсутствует строковое поле '{field}'")

    if data["sentiment"] not in {item.value for item in Sentiment}:
        raise AnalysisError("Поле sentiment содержит неподдерживаемое значение")
    if not isinstance(data.get("entities"), list):
        raise AnalysisError("Поле entities должно быть массивом")
    if not isinstance(data.get("relations"), list):
        raise AnalysisError("Поле relations должно быть массивом")
    if not isinstance(data.get("sympathizes_with"), list):
        raise AnalysisError("Поле sympathizes_with должно быть массивом")
    if not isinstance(data.get("criticizes"), list):
        raise AnalysisError("Поле criticizes должно быть массивом")


def save_analysis(db: Session, article: Article, data: dict[str, Any]) -> ArticleAnalysis:
    """Сохраняет анализ, сущности и отношения. Повторный запуск перезаписывает анализ статьи."""

    db.execute(delete(Relation).where(Relation.article_id == article.id))
    db.execute(delete(ArticleEntity).where(ArticleEntity.article_id == article.id))
    db.execute(delete(AnalysisEvidence).where(AnalysisEvidence.article_id == article.id))
    db.execute(delete(ArticleAnalysis).where(ArticleAnalysis.article_id == article.id))

    analysis = ArticleAnalysis(
        article_id=article.id,
        short_summary=data["short_summary"],
        detailed_summary=data["detailed_summary"],
        sentiment=Sentiment(data["sentiment"]),
        stance=data["stance"],
        framing=data["framing"],
        sympathizes_with=json.dumps(_string_list(data.get("sympathizes_with")), ensure_ascii=False),
        criticizes=json.dumps(_string_list(data.get("criticizes")), ensure_ascii=False),
        narrative_hypothesis=data["narrative_hypothesis"],
        confidence=_score(data.get("confidence")),
    )
    db.add(analysis)
    db.flush()

    entities_by_name: dict[str, Entity] = {}
    for entity_data in data.get("entities", []):
        entity = _save_entity(db, entity_data)
        if entity is None:
            continue
        entities_by_name[entity.name.lower()] = entity
        db.merge(
            ArticleEntity(
                article_id=article.id,
                entity_id=entity.id,
                role=_optional_string(entity_data.get("role")),
                importance_score=_optional_score(entity_data.get("importance_score")),
            )
        )

    for relation_data in data.get("relations", []):
        source = entities_by_name.get(str(relation_data.get("source", "")).strip().lower())
        target = entities_by_name.get(str(relation_data.get("target", "")).strip().lower())
        if source is None or target is None:
            continue
        db.add(
            Relation(
                article_id=article.id,
                source_entity_id=source.id,
                target_entity_id=target.id,
                relation_type=_string(relation_data.get("relation_type"), "unknown")[:120],
                description=_string(relation_data.get("description"), ""),
                confidence=_score(relation_data.get("confidence")),
            )
        )

    for evidence_data in data.get("evidence", []):
        evidence = _save_evidence(article, analysis, evidence_data)
        if evidence is not None:
            db.add(evidence)

    db.commit()
    db.refresh(analysis)
    return analysis


def _save_evidence(article: Article, analysis: ArticleAnalysis, data: Any) -> AnalysisEvidence | None:
    """Сохраняет только валидные evidence; невалидные элементы тихо пропускает."""

    if not isinstance(data, dict):
        return None

    evidence_type = _string(data.get("evidence_type"), "").strip()
    if evidence_type not in _allowed_evidence_types():
        return None

    target = _string(data.get("target"), "").strip()
    quote = _string(data.get("quote"), "").strip()
    explanation = _string(data.get("explanation"), "").strip()
    if not target or not quote or not explanation:
        return None
    if len(quote) > 300:
        return None
    if quote not in article.text:
        return None

    return AnalysisEvidence(
        article_id=article.id,
        analysis_id=analysis.id,
        evidence_type=evidence_type,
        target=target[:255],
        quote=quote,
        explanation=explanation,
        confidence=_score(data.get("confidence")),
    )


def _save_entity(db: Session, data: Any) -> Entity | None:
    if not isinstance(data, dict):
        return None

    name = _string(data.get("name"), "").strip()
    if not name:
        return None

    raw_type = _string(data.get("type"), EntityType.other.value)
    entity_type = EntityType(raw_type) if raw_type in {item.value for item in EntityType} else EntityType.other

    entity = db.scalar(select(Entity).where(Entity.name == name, Entity.type == entity_type))
    if entity:
        return entity

    entity = Entity(name=name, type=entity_type)
    db.add(entity)
    db.flush()
    return entity


def _string(value: Any, default: str) -> str:
    return value if isinstance(value, str) else default


def _optional_string(value: Any) -> str | None:
    return value if isinstance(value, str) and value.strip() else None


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def _score(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return min(max(number, 0.0), 1.0)


def _optional_score(value: Any) -> float | None:
    if value is None:
        return None
    return _score(value)


def _allowed_evidence_types() -> set[str]:
    return {
        "sentiment",
        "stance",
        "framing",
        "sympathy",
        "criticism",
        "narrative",
        "entity_role",
        "relation",
    }
