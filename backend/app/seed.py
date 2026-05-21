from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import (
    Article,
    ArticleAnalysis,
    ArticleEntity,
    Entity,
    EntityType,
    MaterialType,
    Relation,
    Sentiment,
    Source,
)


def seed_demo_graph_data() -> int:
    """Создает тестовую статью с анализом, сущностями и отношениями для графа."""

    db = SessionLocal()
    try:
        return _seed(db)
    finally:
        db.close()


def _seed(db: Session) -> int:
    source = db.scalar(select(Source).where(Source.code == "demo"))
    if source is None:
        source = Source(
            code="demo",
            name="Demo News",
            url="https://example.local/demo-news",
            country="Demo",
        )
        db.add(source)
        db.flush()

    article = db.scalar(select(Article).where(Article.url == "https://example.local/demo-news/moldova-security"))
    if article is None:
        article = Article(
            source_id=source.id,
            title="Демо: спор вокруг безопасности и отношений России и Молдавии",
            url="https://example.local/demo-news/moldova-security",
            published_at=datetime(2026, 5, 21, 12, 0, tzinfo=timezone.utc),
            text=(
                "В демо-материале описывается политический спор между Россией и Молдавией. "
                "Российский МИД предупреждает граждан о рисках поездок, а власти Молдавии "
                "объясняют свои действия вопросами безопасности."
            ),
            language="ru",
            section="demo",
            material_type=MaterialType.article,
        )
        db.add(article)
        db.flush()

    db.query(Relation).filter(Relation.article_id == article.id).delete()
    db.query(ArticleEntity).filter(ArticleEntity.article_id == article.id).delete()
    db.query(ArticleAnalysis).filter(ArticleAnalysis.article_id == article.id).delete()

    entities = {
        "Россия": _get_or_create_entity(db, "Россия", EntityType.country),
        "Молдавия": _get_or_create_entity(db, "Молдавия", EntityType.country),
        "МИД России": _get_or_create_entity(db, "МИД России", EntityType.organization),
        "безопасность": _get_or_create_entity(db, "безопасность", EntityType.concept),
    }

    for name, entity in entities.items():
        db.add(
            ArticleEntity(
                article_id=article.id,
                entity_id=entity.id,
                role="участник материала" if name != "безопасность" else "ключевой фрейм",
                importance_score=0.8 if name != "безопасность" else 0.7,
            )
        )

    analysis = ArticleAnalysis(
        article_id=article.id,
        short_summary="Демо-статья описывает спор России и Молдавии через фрейм безопасности.",
        detailed_summary=(
            "Материал показывает, как российская сторона предупреждает граждан о рисках, "
            "а молдавская сторона связывает свои действия с вопросами безопасности."
        ),
        sentiment=Sentiment.mixed,
        stance="Текст показывает конфликт позиций России и Молдавии.",
        framing="Безопасность и международные отношения",
        sympathizes_with=json.dumps(["Россия", "МИД России"], ensure_ascii=False),
        criticizes=json.dumps(["Молдавия"], ensure_ascii=False),
        narrative_hypothesis="Политический конфликт представлен как вопрос безопасности граждан.",
        confidence=0.75,
    )
    db.add(analysis)
    db.flush()

    db.add_all(
        [
            Relation(
                article_id=article.id,
                source_entity_id=entities["МИД России"].id,
                target_entity_id=entities["Молдавия"].id,
                relation_type="warns_about",
                description="МИД России предупреждает о рисках поездок в Молдавию.",
                confidence=0.85,
            ),
            Relation(
                article_id=article.id,
                source_entity_id=entities["Молдавия"].id,
                target_entity_id=entities["безопасность"].id,
                relation_type="frames_as",
                description="Молдавия объясняет действия вопросами безопасности.",
                confidence=0.7,
            ),
        ]
    )

    db.commit()
    return article.id


def _get_or_create_entity(db: Session, name: str, entity_type: EntityType) -> Entity:
    entity = db.scalar(select(Entity).where(Entity.name == name, Entity.type == entity_type))
    if entity:
        return entity
    entity = Entity(name=name, type=entity_type)
    db.add(entity)
    db.flush()
    return entity


if __name__ == "__main__":
    article_id = seed_demo_graph_data()
    print(f"Seed graph article_id={article_id}")
