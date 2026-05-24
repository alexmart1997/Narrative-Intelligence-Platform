from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.analysis import analyze_article
from app.events import detect_event_for_article
from app.models import Article, ArticleAnalysis, PipelineRun, Source
from app.vector import embed_article


SUPPORTED_STEPS = {"analyze", "embed", "detect_event"}


class PipelineError(Exception):
    """Ошибка настройки batch pipeline."""


def process_articles_pipeline(
    db: Session,
    params: dict[str, Any],
) -> dict[str, Any]:
    """Последовательно обрабатывает статьи выбранными шагами без очередей."""

    steps = _validate_steps(params.get("steps") or [])
    articles = _select_articles(db, params)
    result = _empty_result(selected_articles=len(articles), steps=steps)

    run = PipelineRun(
        status="running",
        selected_articles=len(articles),
        processed=0,
        failed=0,
        params_json=json.dumps(params, ensure_ascii=False, default=str),
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    for article in articles:
        article_failed = False
        for step in steps:
            if _should_skip_step(article, step):
                result["steps"][step]["skipped"] += 1
                continue

            try:
                _run_step(db, article.id, step)
                result["steps"][step]["success"] += 1
                # После commit внутри шага обновляем ORM-объект, чтобы skip-логика видела свежий analysis.
                article = db.get(Article, article.id) or article
            except Exception as exc:
                db.rollback()
                article_failed = True
                result["steps"][step]["failed"] += 1
                result["errors"].append(
                    {
                        "article_id": article.id,
                        "step": step,
                        "error": str(exc),
                    }
                )

        if article_failed:
            result["failed"] += 1
        else:
            result["processed"] += 1

        # Обновляем статус после каждой статьи, чтобы UI/пользователь видел живой прогресс.
        run.processed = result["processed"]
        run.failed = result["failed"]
        run.result_json = json.dumps(result, ensure_ascii=False, default=str)
        db.commit()

    run.status = "completed" if result["failed"] == 0 else "completed_with_errors"
    run.finished_at = datetime.now(timezone.utc)
    run.selected_articles = result["selected_articles"]
    run.processed = result["processed"]
    run.failed = result["failed"]
    run.result_json = json.dumps(result, ensure_ascii=False, default=str)
    db.commit()
    return result


def latest_pipeline_run(db: Session) -> PipelineRun | None:
    """Возвращает последний запуск pipeline из БД."""

    return db.scalar(select(PipelineRun).order_by(PipelineRun.started_at.desc(), PipelineRun.id.desc()).limit(1))


def pipeline_run_to_dict(run: PipelineRun) -> dict[str, Any]:
    """Преобразует ORM-запись запуска в API-ответ."""

    return {
        "id": run.id,
        "started_at": run.started_at,
        "finished_at": run.finished_at,
        "status": run.status,
        "selected_articles": run.selected_articles,
        "processed": run.processed,
        "failed": run.failed,
        "params": _loads_json(run.params_json) or {},
        "result": _loads_json(run.result_json) if run.result_json else None,
    }


def _select_articles(db: Session, params: dict[str, Any]) -> list[Article]:
    statement = select(Article).join(Article.source).order_by(Article.published_at.desc())

    if params.get("source_code"):
        statement = statement.where(Source.code == params["source_code"])
    if params.get("date_from"):
        statement = statement.where(Article.published_at >= params["date_from"])
    if params.get("date_to"):
        statement = statement.where(Article.published_at < params["date_to"] + timedelta(days=1))
    if params.get("language"):
        statement = statement.where(Article.language == params["language"])
    if params.get("only_without_analysis"):
        statement = statement.outerjoin(ArticleAnalysis).where(ArticleAnalysis.id.is_(None))

    statement = statement.limit(params.get("limit", 100))
    return list(db.scalars(statement).all())


def _run_step(db: Session, article_id: int, step: str) -> None:
    if step == "analyze":
        analyze_article(db, article_id)
        return
    if step == "embed":
        embed_article(db, article_id)
        return
    if step == "detect_event":
        detect_event_for_article(db, article_id)
        return
    raise PipelineError(f"Неподдерживаемый шаг pipeline: {step}")


def _should_skip_step(article: Article, step: str) -> bool:
    if step in {"embed", "detect_event"} and article.analysis is None:
        return True
    return False


def _validate_steps(steps: list[str]) -> list[str]:
    if not steps:
        raise PipelineError("Нужно указать хотя бы один шаг pipeline")
    unsupported = [step for step in steps if step not in SUPPORTED_STEPS]
    if unsupported:
        raise PipelineError(f"Неподдерживаемые шаги pipeline: {', '.join(unsupported)}")
    return steps


def _empty_result(selected_articles: int, steps: list[str]) -> dict[str, Any]:
    return {
        "selected_articles": selected_articles,
        "processed": 0,
        "failed": 0,
        "steps": {
            step: {"success": 0, "failed": 0, "skipped": 0}
            for step in steps
        },
        "errors": [],
    }


def _loads_json(value: str | None) -> Any:
    if not value:
        return None
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return None
