from __future__ import annotations

from dataclasses import replace
from datetime import date

from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.ingestion.base import NewsSourceAdapter, ParsedArticle
from app.ingestion.bbc import BbcAdapter
from app.ingestion.cnn import CnnAdapter
from app.ingestion.rbc import RbcAdapter
from app.models import Article, ArticleEntity, Entity, MaterialType, Source


ADAPTERS: dict[str, type[NewsSourceAdapter]] = {
    "rbc": RbcAdapter,
    "bbc": BbcAdapter,
    "cnn": CnnAdapter,
}


def supported_sources() -> list[dict[str, str]]:
    """Возвращает список источников, доступных для загрузки."""

    sources: list[dict[str, str]] = []
    for code, adapter_class in ADAPTERS.items():
        sources.append(
            {
                "code": code,
                "name": adapter_class.name,
                "base_url": adapter_class.base_url,
                "language": adapter_class.language,
            }
        )
    return sources


def get_adapter(source_code: str) -> NewsSourceAdapter | None:
    """Создает адаптер по коду источника."""

    adapter_class = ADAPTERS.get(source_code)
    if not adapter_class:
        return None
    return adapter_class()


def ingest_source_period(
    db: Session,
    source_code: str,
    date_from: date,
    date_to: date,
    limit: int,
) -> dict[str, object]:
    """Загружает статьи источника за период и сохраняет новые записи в PostgreSQL."""

    adapter = get_adapter(source_code)
    if adapter is None:
        supported = ", ".join(sorted(ADAPTERS))
        raise ValueError(f"Источник '{source_code}' не поддерживается. Доступно: {supported}")

    found_links = 0
    parsed_articles = 0
    saved_articles = 0
    duplicates = 0
    errors: list[dict[str, str]] = []

    source = _get_or_create_source(db, adapter)
    links = adapter.fetch_article_links(date_from=date_from, date_to=date_to, limit=limit)
    found_links = len(links)

    for url in links:
        try:
            article = adapter.parse_article(url)
            adapter.pause()
        except Exception as exc:
            errors.append({"url": url, "error": str(exc)})
            continue

        if not date_from <= article.published_at.date() <= date_to:
            continue

        article = replace(article, url=adapter.canonical_url(article.url))
        parsed_articles += 1
        if _article_exists(db, source.id, article):
            duplicates += 1
            continue

        try:
            _save_article(db, source, article)
            saved_articles += 1
        except IntegrityError:
            db.rollback()
            duplicates += 1
        except Exception as exc:
            db.rollback()
            errors.append({"url": article.url, "error": str(exc)})

    return {
        "source_code": source_code,
        "date_from": date_from.isoformat(),
        "date_to": date_to.isoformat(),
        "found_links": found_links,
        "parsed_articles": parsed_articles,
        "saved_articles": saved_articles,
        "duplicates": duplicates,
        "errors": errors,
    }


def query_articles(
    db: Session,
    source_code: str | None = None,
    source_name: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    language: str | None = None,
    material_type: str | None = None,
    section: str | None = None,
    q: str | None = None,
    entity_id: int | None = None,
    entity_name: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[Article]:
    """Возвращает статьи с простыми фильтрами для MVP."""

    statement = select(Article).join(Article.source).order_by(Article.published_at.desc())

    if source_code:
        statement = statement.where(Source.code == source_code)
    if source_name:
        statement = statement.where(Source.name.ilike(f"%{source_name}%"))
    if date_from:
        statement = statement.where(Article.published_at >= date_from)
    if date_to:
        statement = statement.where(Article.published_at < date_to)
    if language:
        statement = statement.where(Article.language == language)
    if material_type:
        statement = statement.where(Article.material_type == material_type)
    if section:
        statement = statement.where(Article.section.ilike(f"%{section}%"))
    if q:
        pattern = f"%{q}%"
        statement = statement.where(or_(Article.title.ilike(pattern), Article.text.ilike(pattern)))
    if entity_id or entity_name:
        # Если пришел entity_id, он надежнее названия: фронт может передавать entity_name
        # только для красивой подписи фильтра. Так мы не делаем повторный join одной таблицы.
        statement = statement.join(ArticleEntity)
        if entity_id is not None:
            statement = statement.where(ArticleEntity.entity_id == entity_id)
        elif entity_name:
            statement = statement.join(Entity).where(Entity.name.ilike(f"%{entity_name}%"))

    # В старых загрузках могли остаться технические дубли одной публикации:
    # например, РБК отдает один материал как ?from=newsfeed и ?from=my_rbc.
    # Сначала получаем подходящие статьи, затем схлопываем их по каноническому URL.
    articles = list(db.scalars(statement).unique().all())
    deduplicated = _deduplicate_articles(articles)
    return deduplicated[offset : offset + limit]


def _get_or_create_source(db: Session, adapter: NewsSourceAdapter) -> Source:
    source = db.scalar(select(Source).where(Source.code == adapter.code))
    if source:
        return source

    source = Source(
        code=adapter.code,
        name=adapter.name,
        url=adapter.base_url,
        country=adapter.country,
    )
    db.add(source)
    db.commit()
    db.refresh(source)
    return source


def _article_exists(db: Session, source_id: int, article: ParsedArticle) -> bool:
    """Проверяет дубль с учетом tracking-параметров и старых уже сохраненных URL."""

    canonical_url = NewsSourceAdapter.canonical_url(article.url)
    same_title_articles = db.scalars(
        select(Article).where(
            Article.source_id == source_id,
            Article.title == article.title,
        )
    )
    for existing in same_title_articles:
        if NewsSourceAdapter.canonical_url(existing.url) == canonical_url:
            return True
        if existing.published_at == article.published_at:
            return True
    return False


def _deduplicate_articles(articles: list[Article]) -> list[Article]:
    """Схлопывает технические копии одной статьи, сохраняя порядок выдачи."""

    seen: set[tuple[int | None, str]] = set()
    result: list[Article] = []
    for article in articles:
        key = _article_dedupe_key(article)
        if key in seen:
            continue
        seen.add(key)
        result.append(article)
    return result


def _article_dedupe_key(article: Article) -> tuple[int | None, str]:
    canonical_url = NewsSourceAdapter.canonical_url(article.url).lower().rstrip("/")
    if canonical_url:
        return article.source_id, canonical_url
    fallback = f"{article.title.strip().lower()}:{article.published_at.isoformat()}"
    return article.source_id, fallback


def _save_article(db: Session, source: Source, article: ParsedArticle) -> Article:
    model = Article(
        source_id=source.id,
        title=article.title,
        url=article.url,
        published_at=article.published_at,
        text=article.text,
        language=article.language,
        section=_truncate(article.section, 120),
        author=_truncate(article.author, 255),
        material_type=MaterialType(article.material_type.value),
    )
    db.add(model)
    db.commit()
    db.refresh(model)
    return model


def _truncate(value: str | None, max_length: int) -> str | None:
    """Обрезает метаданные под размер колонок БД.

    Некоторые сайты, особенно live pages CNN, отдают десятки авторов одной
    строкой. Для MVP важнее сохранить материал, чем потерять его из-за
    слишком длинного metadata-поля.
    """

    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    return cleaned[:max_length]
