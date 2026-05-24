from __future__ import annotations

import re
from typing import Any

from app.models import Article


SIMILARITY_GUARD_VERSION = 2

_TOKEN_RE = re.compile(r"[a-zа-яё0-9]{4,}", re.IGNORECASE)

_STOPWORDS = {
    "about",
    "after",
    "against",
    "also",
    "from",
    "have",
    "into",
    "over",
    "said",
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


def articles_are_contextually_related(
    base_article: Article,
    candidate_article: Article,
    score: float | None = None,
    mode: str = "vector",
) -> bool:
    """Отсекает ложную похожесть: одного embedding-score недостаточно.

    Для политических новостей часто встречаются общие слова вроде "Россия",
    "санкции" или "регуляторные меры". Поэтому похожесть принимаем только
    если есть пересечение важных сущностей или заметное пересечение ключевых
    слов. Очень высокий score тоже требует хотя бы слабого текстового мостика.
    """

    if looks_like_same_source_duplicate(base_article, candidate_article):
        return False

    relation = relation_debug_data(base_article, candidate_article, score)
    shared_specific = len(relation["shared_specific_entities"])
    shared_entities = len(relation["shared_entities"])
    keyword_overlap = float(relation["keyword_overlap"])
    title_overlap = float(relation["title_overlap"])
    safe_score = float(score or 0)

    if shared_specific >= 1 and safe_score >= 0.58:
        return True
    if shared_entities >= 2 and safe_score >= 0.6:
        return True

    if mode == "narrative":
        return (keyword_overlap >= 0.18 and safe_score >= 0.78) or (title_overlap >= 0.16 and safe_score >= 0.74)

    if mode == "event":
        return (
            (safe_score >= 0.9 and (keyword_overlap >= 0.06 or title_overlap >= 0.05 or shared_entities >= 1))
            or (keyword_overlap >= 0.16 and safe_score >= 0.72)
            or (title_overlap >= 0.14 and safe_score >= 0.7)
            or (shared_entities >= 1 and keyword_overlap >= 0.08 and safe_score >= 0.76)
        )

    return (
        (keyword_overlap >= 0.16 and safe_score >= 0.68)
        or (title_overlap >= 0.14 and safe_score >= 0.66)
        or (safe_score >= 0.84 and keyword_overlap >= 0.08)
    )


def relation_debug_data(base_article: Article, candidate_article: Article, score: float | None = None) -> dict[str, Any]:
    """Возвращает объяснимые признаки похожести для payload/debug."""

    base_entities = _entity_names(base_article, include_broad=True)
    candidate_entities = _entity_names(candidate_article, include_broad=True)
    base_specific = _entity_names(base_article, include_broad=False)
    candidate_specific = _entity_names(candidate_article, include_broad=False)
    base_tokens = _article_tokens(base_article)
    candidate_tokens = _article_tokens(candidate_article)
    base_title_tokens = _tokens(base_article.title)
    candidate_title_tokens = _tokens(candidate_article.title)

    return {
        "guard_version": SIMILARITY_GUARD_VERSION,
        "score": score,
        "shared_entities": sorted(base_entities & candidate_entities)[:8],
        "shared_specific_entities": sorted(base_specific & candidate_specific)[:8],
        "keyword_overlap": _overlap(base_tokens, candidate_tokens),
        "title_overlap": _overlap(base_title_tokens, candidate_title_tokens),
    }


def looks_like_same_source_duplicate(base_article: Article, candidate_article: Article) -> bool:
    """Определяет техническую копию одной публикации в рамках одного источника."""

    base_source = base_article.source.name if base_article.source else ""
    candidate_source = candidate_article.source.name if candidate_article.source else ""
    return (
        base_source.strip().lower() == candidate_source.strip().lower()
        and base_article.title.strip().lower() == candidate_article.title.strip().lower()
    )


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
    return _tokens(" ".join(item for item in chunks if item))


def _tokens(value: str) -> set[str]:
    return {
        token.lower()
        for token in _TOKEN_RE.findall(value)
        if token.lower() not in _STOPWORDS
    }


def _overlap(left: set[str], right: set[str]) -> float:
    if not left or not right:
        return 0.0
    return len(left & right) / max(1, min(len(left), len(right)))
