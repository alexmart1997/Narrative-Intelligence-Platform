from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any, Literal

from app.models import Article


SIMILARITY_GUARD_VERSION = 3
SimilarityClassification = Literal["same_story", "related_context", "not_related"]

_TOKEN_RE = re.compile(r"[a-zа-яё0-9]{4,}", re.IGNORECASE)

_STOPWORDS = {
    "about",
    "after",
    "against",
    "also",
    "amid",
    "been",
    "from",
    "have",
    "into",
    "over",
    "said",
    "says",
    "that",
    "their",
    "this",
    "with",
    "will",
    "для",
    "его",
    "или",
    "как",
    "над",
    "она",
    "они",
    "при",
    "про",
    "что",
    "это",
    "был",
    "была",
    "были",
    "после",
    "также",
    "среди",
    "может",
    "могут",
    "стали",
    "будет",
    "сообщил",
    "сообщила",
    "заявил",
    "заявила",
}

_BROAD_ENTITY_NAMES = {
    "россия",
    "российская федерация",
    "сша",
    "соединенные штаты",
    "united states",
    "usa",
    "uk",
    "united kingdom",
    "великобритания",
    "китай",
    "иран",
    "украина",
    "евросоюз",
    "ес",
    "european union",
}

# Эти слова часто создают ложное чувство близости политических новостей.
# Если совпадение держится только на них, кандидат не считаем похожим.
_GENERIC_KEYWORDS = {
    "russia",
    "russian",
    "россия",
    "российский",
    "российская",
    "российские",
    "united",
    "states",
    "usa",
    "сша",
    "america",
    "америка",
    "sanctions",
    "санкции",
    "санкций",
    "economy",
    "economic",
    "экономика",
    "экономики",
    "market",
    "markets",
    "рынок",
    "цены",
    "price",
    "prices",
    "government",
    "правительство",
    "president",
    "президент",
    "minister",
    "министр",
    "officials",
    "власти",
    "страна",
    "страны",
    "war",
    "война",
    "conflict",
    "конфликт",
}


def classify_article_similarity(
    base_article: Article,
    candidate_article: Article,
    embedding_similarity: float | None = None,
    *,
    use_llm_rerank: bool = False,
) -> dict[str, Any]:
    """Возвращает объяснимую hybrid-похожесть двух статей.

    Qdrant остается retrieval-слоем, но финальное решение принимает guard:
    сущности, ключевые слова, близость даты, duplicate detection и фильтр
    слишком общих совпадений.
    """

    duplicate = looks_like_same_source_duplicate(base_article, candidate_article)
    features = relation_debug_data(base_article, candidate_article, embedding_similarity)
    features["duplicate"] = duplicate

    if duplicate:
        return _classified(features, "not_related", 0.0, "Технический дубль одной публикации.")

    probability = _same_story_probability(features)
    classification = _classify_from_features(features, probability)
    reason = _build_reason(features, classification)
    result = _classified(features, classification, probability, reason)

    if use_llm_rerank and classification != "not_related":
        return _llm_rerank(base_article, candidate_article, result)
    return result


def articles_are_contextually_related(
    base_article: Article,
    candidate_article: Article,
    score: float | None = None,
    mode: str = "vector",
) -> bool:
    """Совместимость со старым кодом: true только для хороших кандидатов."""

    result = classify_article_similarity(base_article, candidate_article, score)
    if mode == "event":
        return result["classification"] == "same_story"
    if mode == "narrative":
        return result["classification"] in {"same_story", "related_context"} and result["same_story_probability"] >= 0.58
    return result["classification"] in {"same_story", "related_context"}


def relation_debug_data(base_article: Article, candidate_article: Article, score: float | None = None) -> dict[str, Any]:
    """Возвращает объяснимые признаки похожести для payload/debug."""

    base_entities = _entity_names(base_article, include_broad=True)
    candidate_entities = _entity_names(candidate_article, include_broad=True)
    base_specific = _entity_names(base_article, include_broad=False)
    candidate_specific = _entity_names(candidate_article, include_broad=False)
    base_tokens = _article_tokens(base_article)
    candidate_tokens = _article_tokens(candidate_article)
    base_title_tokens = _tokens(base_article.title, include_generic=False)
    candidate_title_tokens = _tokens(candidate_article.title, include_generic=False)
    shared_keywords = sorted((base_tokens & candidate_tokens) - _GENERIC_KEYWORDS)[:10]
    shared_generic_keywords = sorted((base_tokens & candidate_tokens) & _GENERIC_KEYWORDS)[:10]

    return {
        "guard_version": SIMILARITY_GUARD_VERSION,
        "embedding_similarity": float(score or 0.0),
        "score": float(score or 0.0),
        "shared_entities": sorted(base_entities & candidate_entities)[:8],
        "shared_specific_entities": sorted(base_specific & candidate_specific)[:8],
        "shared_keywords": shared_keywords,
        "shared_generic_keywords": shared_generic_keywords,
        "keyword_overlap": _overlap(base_tokens, candidate_tokens),
        "title_overlap": _overlap(base_title_tokens, candidate_title_tokens),
        "date_proximity": _date_proximity(base_article, candidate_article),
        "generic_only": _is_generic_only(base_entities, candidate_entities, shared_keywords, shared_generic_keywords),
    }


def looks_like_same_source_duplicate(base_article: Article, candidate_article: Article) -> bool:
    """Определяет техническую копию одной публикации в рамках одного источника."""

    base_source = base_article.source.name if base_article.source else ""
    candidate_source = candidate_article.source.name if candidate_article.source else ""
    if base_source.strip().lower() != candidate_source.strip().lower():
        return False
    if base_article.url.strip().lower() == candidate_article.url.strip().lower():
        return True
    if base_article.title.strip().lower() == candidate_article.title.strip().lower():
        return True
    title_overlap = _overlap(_tokens(base_article.title, include_generic=True), _tokens(candidate_article.title, include_generic=True))
    return title_overlap >= 0.82


def _classified(
    features: dict[str, Any],
    classification: SimilarityClassification,
    probability: float,
    reason: str,
) -> dict[str, Any]:
    embedding_similarity = float(features.get("embedding_similarity") or 0.0)
    similarity_score = _hybrid_similarity_score(features, probability, classification)
    return {
        "guard_version": SIMILARITY_GUARD_VERSION,
        "classification": classification,
        "embedding_similarity": round(embedding_similarity, 4),
        "similarity_score": round(similarity_score, 4),
        # Старое поле оставляем для совместимости graph/compare.
        "score": round(similarity_score, 4),
        "same_story_probability": round(probability, 4),
        "shared_entities": features.get("shared_specific_entities") or features.get("shared_entities") or [],
        "shared_keywords": features.get("shared_keywords") or [],
        "similarity_reason": reason,
        "match_reason": {
            **features,
            "classification": classification,
            "same_story_probability": round(probability, 4),
            "similarity_score": round(similarity_score, 4),
            "similarity_reason": reason,
        },
    }


def _same_story_probability(features: dict[str, Any]) -> float:
    embedding = min(1.0, max(0.0, float(features.get("embedding_similarity") or 0.0)))
    shared_specific = len(features.get("shared_specific_entities") or [])
    shared_entities = len(features.get("shared_entities") or [])
    keyword_signal = min(1.0, float(features.get("keyword_overlap") or 0.0) / 0.22)
    title_signal = min(1.0, float(features.get("title_overlap") or 0.0) / 0.28)
    date_signal = float(features.get("date_proximity") or 0.0)

    entity_signal = 0.0
    if shared_specific >= 3:
        entity_signal = 1.0
    elif shared_specific == 2:
        entity_signal = 0.86
    elif shared_specific == 1:
        entity_signal = 0.68
    elif shared_entities >= 2:
        entity_signal = 0.32

    probability = (
        0.34 * embedding
        + 0.25 * entity_signal
        + 0.21 * keyword_signal
        + 0.12 * title_signal
        + 0.08 * date_signal
    )

    if features.get("generic_only"):
        probability = min(probability, 0.38)
    if shared_specific == 0 and keyword_signal < 0.18 and title_signal < 0.25:
        probability = min(probability, 0.46)
    if date_signal <= 0.2 and title_signal < 0.2 and shared_specific < 2:
        probability = min(probability, 0.58)
    return max(0.0, min(1.0, probability))


def _classify_from_features(features: dict[str, Any], probability: float) -> SimilarityClassification:
    if features.get("generic_only"):
        return "not_related"

    shared_specific = len(features.get("shared_specific_entities") or [])
    shared_keywords = len(features.get("shared_keywords") or [])
    title_overlap = float(features.get("title_overlap") or 0.0)
    keyword_overlap = float(features.get("keyword_overlap") or 0.0)

    enough_evidence = shared_specific >= 1 or shared_keywords >= 2 or title_overlap >= 0.18
    strong_same_story_bridge = (
        shared_specific >= 2
        or (shared_specific >= 1 and keyword_overlap >= 0.08)
        or title_overlap >= 0.24
        or shared_keywords >= 4
    )

    if probability >= 0.72 and enough_evidence and strong_same_story_bridge:
        return "same_story"
    if probability >= 0.56 and enough_evidence:
        return "related_context"
    return "not_related"


def _hybrid_similarity_score(
    features: dict[str, Any],
    probability: float,
    classification: SimilarityClassification,
) -> float:
    embedding = float(features.get("embedding_similarity") or 0.0)
    if classification == "not_related":
        return min(0.49, probability)
    return min(1.0, 0.62 * probability + 0.38 * embedding)


def _build_reason(features: dict[str, Any], classification: SimilarityClassification) -> str:
    shared_entities = features.get("shared_specific_entities") or features.get("shared_entities") or []
    shared_keywords = features.get("shared_keywords") or []

    if classification == "same_story":
        if shared_entities and shared_keywords:
            return f"Same story: shared entities {', '.join(shared_entities[:3])}; shared keywords {', '.join(shared_keywords[:4])}."
        if shared_entities:
            return f"Same story: shared entities {', '.join(shared_entities[:4])}."
        return "Same story: strong title and keyword overlap around the same development."

    if classification == "related_context":
        if shared_entities:
            return f"Related context: shared entities {', '.join(shared_entities[:3])}, but facts are not close enough for same story."
        if shared_keywords:
            return f"Related context: shared keywords {', '.join(shared_keywords[:4])}."
        return "Related geopolitical context, not the same concrete story."

    if features.get("generic_only"):
        return "Not related: overlap is too generic, such as countries, sanctions or economy."
    return "Not related: no specific shared entities, keywords or close factual bridge."


def _is_generic_only(
    base_entities: set[str],
    candidate_entities: set[str],
    shared_keywords: list[str],
    shared_generic_keywords: list[str],
) -> bool:
    shared_entities = base_entities & candidate_entities
    specific_entities = {name for name in shared_entities if name not in _BROAD_ENTITY_NAMES}
    return not specific_entities and not shared_keywords and bool(shared_generic_keywords or shared_entities)


def _entity_names(article: Article, include_broad: bool) -> set[str]:
    names: set[str] = set()
    for article_entity in article.entities:
        name = article_entity.entity.name.strip().lower()
        if not name:
            continue
        if not include_broad and (
            name in _BROAD_ENTITY_NAMES
            or article_entity.entity.type.value == "country"
        ):
            continue
        names.add(name)
    return names


def _article_tokens(article: Article) -> set[str]:
    chunks = [article.title, article.text[:1200]]
    if article.analysis is not None:
        chunks.extend(
            [
                article.analysis.short_summary,
                article.analysis.framing,
                article.analysis.narrative_hypothesis,
            ]
        )
    return _tokens(" ".join(item for item in chunks if item), include_generic=False)


def _tokens(value: str, *, include_generic: bool) -> set[str]:
    tokens = {
        token.lower()
        for token in _TOKEN_RE.findall(value)
        if token.lower() not in _STOPWORDS
    }
    return tokens if include_generic else tokens - _GENERIC_KEYWORDS


def _overlap(left: set[str], right: set[str]) -> float:
    if not left or not right:
        return 0.0
    return len(left & right) / max(1, min(len(left), len(right)))


def _date_proximity(base_article: Article, candidate_article: Article) -> float:
    left = _naive_datetime(base_article.published_at)
    right = _naive_datetime(candidate_article.published_at)
    days = abs((left - right).total_seconds()) / 86400
    if days <= 1:
        return 1.0
    if days <= 3:
        return 0.86
    if days <= 7:
        return 0.68
    if days <= 14:
        return 0.42
    if days <= 30:
        return 0.22
    return 0.06


def _naive_datetime(value: datetime) -> datetime:
    return value.replace(tzinfo=None) if value.tzinfo else value


def _llm_rerank(base_article: Article, candidate_article: Article, result: dict[str, Any]) -> dict[str, Any]:
    """Опциональный быстрый LLM rerank.

    По умолчанию выключен, потому что локальная модель может заметно замедлить
    поиск. Если включить в настройках, LLM только уточняет уже прошедшие guard
    кандидаты, а не вытаскивает слабые совпадения.
    """

    try:
        from app.llm import call_llm

        prompt = f"""
Верни строго JSON без markdown:
{{
  "classification": "same_story | related_context | not_related",
  "same_story_probability": 0.0,
  "reason": "короткое объяснение на русском"
}}

Сравни две новости. Это один конкретный сюжет, связанный контекст или нерелевантно?

Статья A:
{base_article.title}
{base_article.text[:900]}

Статья B:
{candidate_article.title}
{candidate_article.text[:900]}
""".strip()
        raw = call_llm(prompt)
        match = re.search(r"\{.*\}", raw, flags=re.DOTALL)
        data = json.loads(match.group(0) if match else raw)
        classification = data.get("classification")
        if classification not in {"same_story", "related_context", "not_related"}:
            return result
        probability = float(data.get("same_story_probability", result["same_story_probability"]))
        reason = str(data.get("reason") or result["similarity_reason"])
        reranked = {
            **result,
            "classification": classification,
            "same_story_probability": round(max(0.0, min(1.0, probability)), 4),
            "similarity_reason": reason,
        }
        reranked["match_reason"] = {**result.get("match_reason", {}), "llm_rerank": True, "similarity_reason": reason}
        return reranked
    except Exception:
        return result
