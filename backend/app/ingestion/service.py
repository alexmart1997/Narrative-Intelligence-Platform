from __future__ import annotations

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

        parsed_articles += 1
        if _article_exists(db, article.url):
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

    statement = statement.limit(limit).offset(offset)
    return list(db.scalars(statement).all())


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


def _article_exists(db: Session, url: str) -> bool:
    return db.scalar(select(Article.id).where(Article.url == url)) is not None


def _save_article(db: Session, source: Source, article: ParsedArticle) -> Article:
    model = Article(
        source_id=source.id,
        title=article.title,
        url=article.url,
        published_at=article.published_at,
        text=article.text,
        language=article.language,
        section=article.section,
        author=article.author,
        material_type=MaterialType(article.material_type.value),
    )
    db.add(model)
    db.commit()
    db.refresh(model)
    return model
