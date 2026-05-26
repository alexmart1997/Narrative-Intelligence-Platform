from __future__ import annotations

import re
from typing import Any


TERM_REPLACEMENTS: list[tuple[re.Pattern[str], str]] = [
    # Частая машинная калька с английского Strait of Hormuz.
    (re.compile(r"\bStrait of Hormuz\b", re.IGNORECASE), "Ормузский пролив"),
    (re.compile(r"\bСтр(?:ит|ой)[а-яё]*\s+Хорм[уо]з[а-яё]*\b", re.IGNORECASE), "Ормузский пролив"),
    (re.compile(r"\bХорм[уо]зск(?:ий|ого|ому|им|ом)\s+пролив[а-яё]*\b", re.IGNORECASE), "Ормузский пролив"),
    (re.compile(r"\bпролив\s+Хорм[уо]з[а-яё]*\b", re.IGNORECASE), "Ормузский пролив"),
]


def normalize_russian_text(value: str) -> str:
    """Исправляет частые кальки и терминологию в русскоязычных выводах LLM."""

    result = value
    for pattern, replacement in TERM_REPLACEMENTS:
        result = pattern.sub(replacement, result)
    return _normalize_spaces(result)


def normalize_russian_list(value: Any) -> list[str]:
    """Возвращает список строк после русской нормализации."""

    if not isinstance(value, list):
        return []
    return [normalize_russian_text(item.strip()) for item in value if isinstance(item, str) and item.strip()]


def normalize_analysis_payload(data: dict[str, Any]) -> dict[str, Any]:
    """Нормализует LLM JSON перед валидацией и сохранением.

    Цитаты evidence не трогаем: они должны дословно совпадать с текстом статьи.
    """

    next_data = dict(data)
    for field in [
        "short_summary",
        "detailed_summary",
        "stance",
        "framing",
        "narrative_hypothesis",
    ]:
        if isinstance(next_data.get(field), str):
            next_data[field] = normalize_russian_text(next_data[field])

    next_data["sympathizes_with"] = normalize_russian_list(next_data.get("sympathizes_with"))
    next_data["criticizes"] = normalize_russian_list(next_data.get("criticizes"))

    entities = []
    for item in next_data.get("entities", []):
        if not isinstance(item, dict):
            continue
        entity = dict(item)
        if isinstance(entity.get("name"), str):
            entity["name"] = normalize_russian_text(entity["name"])
        if isinstance(entity.get("role"), str):
            entity["role"] = normalize_russian_text(entity["role"])
        entities.append(entity)
    next_data["entities"] = entities

    relations = []
    for item in next_data.get("relations", []):
        if not isinstance(item, dict):
            continue
        relation = dict(item)
        for field in ["source", "target", "relation_type", "description"]:
            if isinstance(relation.get(field), str):
                relation[field] = normalize_russian_text(relation[field])
        relations.append(relation)
    next_data["relations"] = relations

    evidence = []
    for item in next_data.get("evidence", []):
        if not isinstance(item, dict):
            continue
        evidence_item = dict(item)
        for field in ["target", "explanation"]:
            if isinstance(evidence_item.get(field), str):
                evidence_item[field] = normalize_russian_text(evidence_item[field])
        evidence.append(evidence_item)
    next_data["evidence"] = evidence
    return next_data


def _normalize_spaces(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()
