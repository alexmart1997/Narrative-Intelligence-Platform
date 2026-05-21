from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from app.analysis import AnalysisError, parse_llm_json
from app.llm import LlmError, call_llm
from app.models import Article
from app.vector import VectorError, find_similar_articles


class ComparisonError(Exception):
    """Ошибка сравнения двух статей."""


def compare_articles(db: Session, article_id_1: int, article_id_2: int) -> dict[str, Any]:
    """Сравнивает две статьи и возвращает структурированный JSON."""

    article_1 = _get_article_with_analysis(db, article_id_1)
    article_2 = _get_article_with_analysis(db, article_id_2)
    prompt = build_compare_prompt(article_1, article_2)

    try:
        raw_response = call_llm(prompt)
    except LlmError as exc:
        raise ComparisonError(str(exc)) from exc

    data = parse_llm_json(raw_response)
    validate_compare_payload(data)
    return data


def compare_with_similar(db: Session, article_id: int) -> list[dict[str, Any]]:
    """Сравнивает статью с top-3 похожими материалами из Qdrant."""

    try:
        similar_items = find_similar_articles(db, article_id=article_id, limit=3)
    except VectorError as exc:
        raise ComparisonError(str(exc)) from exc

    comparisons: list[dict[str, Any]] = []
    for item in similar_items:
        similar_article_id = item.get("article_id")
        if not isinstance(similar_article_id, int):
            continue
        comparison = compare_articles(db, article_id, similar_article_id)
        comparisons.append(
            {
                "article_id": similar_article_id,
                "similarity_score": item.get("score", 0.0),
                "comparison": comparison,
            }
        )
    return comparisons


def build_compare_prompt(article_1: Article, article_2: Article) -> str:
    """Готовит русский prompt для сравнения освещения двух материалов."""

    return f"""
Ты аналитик политических новостей. Сравни две статьи и верни СТРОГО один JSON без markdown, комментариев и текста вокруг.

Нужно определить:
- об одном ли событии статьи;
- какие факты совпадают;
- какие факты отличаются;
- кто представлен положительно и отрицательно;
- кому симпатизирует каждая статья;
- какой нарратив продвигает каждая статья.

Формат JSON строго такой:
{{
  "same_event_probability": 0.0,
  "fact_overlap": 0.0,
  "main_common_facts": ["..."],
  "differences": ["..."],
  "source_1_framing": "...",
  "source_2_framing": "...",
  "source_1_sympathy": "...",
  "source_2_sympathy": "...",
  "source_1_criticism": "...",
  "source_2_criticism": "...",
  "narrative_difference": "...",
  "conclusion": "..."
}}

Правила:
- same_event_probability и fact_overlap должны быть числами от 0 до 1.
- Если статьи о разных событиях, same_event_probability должен быть низким.
- Используй только данные из статей и их анализа.

СТАТЬЯ 1
Источник: {_source_name(article_1)}
Заголовок: {article_1.title}
Дата: {article_1.published_at.isoformat()}
Краткое резюме: {article_1.analysis.short_summary}
Фрейминг: {article_1.analysis.framing}
Позиция: {article_1.analysis.stance}
Симпатизирует: {_json_list(article_1.analysis.sympathizes_with)}
Критикует: {_json_list(article_1.analysis.criticizes)}
Гипотеза нарратива: {article_1.analysis.narrative_hypothesis}
Фрагмент текста: {article_1.text[:1800]}

СТАТЬЯ 2
Источник: {_source_name(article_2)}
Заголовок: {article_2.title}
Дата: {article_2.published_at.isoformat()}
Краткое резюме: {article_2.analysis.short_summary}
Фрейминг: {article_2.analysis.framing}
Позиция: {article_2.analysis.stance}
Симпатизирует: {_json_list(article_2.analysis.sympathizes_with)}
Критикует: {_json_list(article_2.analysis.criticizes)}
Гипотеза нарратива: {article_2.analysis.narrative_hypothesis}
Фрагмент текста: {article_2.text[:1800]}
""".strip()


def validate_compare_payload(data: dict[str, Any]) -> None:
    """Проверяет структуру JSON сравнения."""

    required_string_fields = [
        "source_1_framing",
        "source_2_framing",
        "source_1_sympathy",
        "source_2_sympathy",
        "source_1_criticism",
        "source_2_criticism",
        "narrative_difference",
        "conclusion",
    ]
    for field in required_string_fields:
        if not isinstance(data.get(field), str):
            raise ComparisonError(f"В JSON отсутствует строковое поле '{field}'")

    for field in ["same_event_probability", "fact_overlap"]:
        data[field] = _score(data.get(field))

    for field in ["main_common_facts", "differences"]:
        if not isinstance(data.get(field), list):
            raise ComparisonError(f"Поле '{field}' должно быть массивом")
        data[field] = [item for item in data[field] if isinstance(item, str)]


def _get_article_with_analysis(db: Session, article_id: int) -> Article:
    article = db.get(Article, article_id)
    if article is None:
        raise ComparisonError(f"Статья {article_id} не найдена")
    if article.analysis is None:
        raise ComparisonError(f"Для статьи {article_id} сначала нужно выполнить LLM-анализ")
    return article


def _source_name(article: Article) -> str:
    return article.source.name if article.source else "unknown"


def _json_list(value: str | None) -> list[str]:
    if not value:
        return []
    try:
        data = json.loads(value)
    except json.JSONDecodeError:
        return []
    return [item for item in data if isinstance(item, str)] if isinstance(data, list) else []


def _score(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return min(max(number, 0.0), 1.0)
