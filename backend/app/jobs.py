from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.analysis import analyze_article
from app.database import SessionLocal
from app.events import detect_event_for_article
from app.models import Article, ArticleAnalysis, Job, Source
from app.precompute import precompute_single_article
from app.vector import embed_article


JOB_TYPES = {"analyze", "embed", "similar", "graph_precompute", "compare_precompute", "pipeline"}
JOB_STATUSES = {"pending", "running", "completed", "failed", "cancelled"}
PIPELINE_STEPS = {"analyze", "embed", "detect_event", "similar", "graph_precompute", "compare_precompute"}

# Локальный MacBook лучше не грузить несколькими LLM-задачами одновременно.
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="nip-job")


class JobError(Exception):
    """Ошибка локальной фоновой задачи."""


class JobCancelled(Exception):
    """Сигнал кооперативной отмены фоновой задачи."""


def enqueue_job(db: Session, job_type: str, params: dict[str, Any]) -> Job:
    """Создает запись job и сразу ставит ее в локальный executor."""

    if job_type not in JOB_TYPES:
        raise JobError(f"Неподдерживаемый тип job: {job_type}")

    job = Job(
        type=job_type,
        status="pending",
        progress=0.0,
        params_json=json.dumps(params, ensure_ascii=False, default=str),
        logs_json=json.dumps([], ensure_ascii=False),
        retry_count=0,
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    _executor.submit(_run_job, job.id)
    return job


def list_jobs(
    db: Session,
    *,
    status: str | None = None,
    job_type: str | None = None,
    limit: int = 30,
) -> list[Job]:
    """Возвращает последние задачи для polling в UI."""

    statement = select(Job).order_by(Job.created_at.desc(), Job.id.desc()).limit(limit)
    if status:
        statement = statement.where(Job.status == status)
    if job_type:
        statement = statement.where(Job.type == job_type)
    return list(db.scalars(statement).all())


def get_job_or_raise(db: Session, job_id: int) -> Job:
    job = db.get(Job, job_id)
    if job is None:
        raise JobError("Job не найден")
    return job


def cancel_job(db: Session, job_id: int) -> Job:
    """Помечает job отмененной.

    Если задача уже внутри LLM-вызова, она остановится после ближайшей
    контрольной точки. Это нормальное ограничение lightweight-local runner.
    """

    job = get_job_or_raise(db, job_id)
    if job.status in {"completed", "failed", "cancelled"}:
        return job
    job.status = "cancelled"
    job.finished_at = datetime.now(timezone.utc)
    _append_log_value(job, "Пользователь запросил отмену задачи.")
    db.commit()
    db.refresh(job)
    return job


def job_to_dict(job: Job) -> dict[str, Any]:
    """Преобразует job в JSON-friendly dict для API."""

    return {
        "id": job.id,
        "type": job.type,
        "status": job.status,
        "progress": job.progress,
        "params": _loads_json(job.params_json) or {},
        "result": _loads_json(job.result_json) if job.result_json else None,
        "logs": _loads_json(job.logs_json) if job.logs_json else [],
        "error": job.error,
        "retry_count": job.retry_count,
        "created_at": job.created_at,
        "started_at": job.started_at,
        "finished_at": job.finished_at,
    }


def _run_job(job_id: int) -> None:
    """Точка входа для фонового потока."""

    with SessionLocal() as db:
        job = db.get(Job, job_id)
        if job is None:
            return
        if job.status == "cancelled":
            return

        try:
            _mark_running(db, job)
            params = _loads_json(job.params_json) or {}
            if job.type == "analyze":
                result = _run_analyze_job(db, job.id, params)
            elif job.type == "pipeline":
                result = _run_pipeline_job(db, job.id, params)
            elif job.type in {"embed", "similar", "graph_precompute", "compare_precompute"}:
                result = _run_single_step_job(db, job.id, job.type, params)
            else:
                raise JobError(f"Неподдерживаемый тип job: {job.type}")
            _finish_job(db, job.id, "completed", result=result, progress=1.0)
        except JobCancelled:
            _finish_job(db, job.id, "cancelled", progress=1.0)
        except Exception as exc:
            db.rollback()
            _finish_job(db, job.id, "failed", error=str(exc))


def _run_analyze_job(db: Session, job_id: int, params: dict[str, Any]) -> dict[str, Any]:
    article_id = int(params.get("article_id") or 0)
    if article_id <= 0:
        raise JobError("article_id обязателен для analyze job")

    include_compare = bool(params.get("include_compare", False))
    _ensure_not_cancelled(db, job_id)
    _set_progress(db, job_id, 0.08, "Запускаю LLM-анализ статьи.")
    analysis = analyze_article(db, article_id)

    _ensure_not_cancelled(db, job_id)
    _set_progress(db, job_id, 0.55, "Готовлю связь статьи с сюжетом.")
    detect_event_for_article(db, article_id)

    _ensure_not_cancelled(db, job_id)
    _set_progress(db, job_id, 0.72, "Считаю похожие материалы и граф связей.")
    precompute = precompute_single_article(
        db,
        article_id,
        include_graph=True,
        include_similar=True,
        include_compare=include_compare,
        ensure_support_layers=False,
    )

    _set_progress(db, job_id, 0.96, "Фоновая подготовка статьи завершена.")
    return {
        "article_id": article_id,
        "analysis_id": analysis.id,
        "precompute": precompute,
    }


def _run_single_step_job(db: Session, job_id: int, job_type: str, params: dict[str, Any]) -> dict[str, Any]:
    article_id = int(params.get("article_id") or 0)
    if article_id <= 0:
        raise JobError("article_id обязателен для job")
    _run_article_step(db, job_id, article_id, job_type, ensure_support_layers=True)
    return {"article_id": article_id, "step": job_type}


def _run_pipeline_job(db: Session, job_id: int, params: dict[str, Any]) -> dict[str, Any]:
    steps = _validate_steps(params.get("steps") or ["analyze", "embed", "similar", "graph_precompute"])
    articles = _select_articles(db, params)
    total_units = max(len(articles) * len(steps), 1)
    completed_units = 0
    result = _empty_pipeline_result(len(articles), steps)

    _set_progress(db, job_id, 0.02, f"Выбрано статей: {len(articles)}.")

    for article in articles:
        article_failed = False
        for step in steps:
            _ensure_not_cancelled(db, job_id)
            if _should_skip_step(article, step):
                result["steps"][step]["skipped"] += 1
                completed_units += 1
                _set_pipeline_progress(db, job_id, completed_units, total_units, f"Пропущен шаг {step} для статьи {article.id}.")
                continue

            try:
                _run_article_step(db, job_id, article.id, step, ensure_support_layers=False)
                result["steps"][step]["success"] += 1
                article = db.get(Article, article.id) or article
            except Exception as exc:
                db.rollback()
                article_failed = True
                result["steps"][step]["failed"] += 1
                result["errors"].append({"article_id": article.id, "step": step, "error": str(exc)})

            completed_units += 1
            _set_pipeline_progress(db, job_id, completed_units, total_units, f"Обработана статья {article.id}, шаг {step}.", result)

        if article_failed:
            result["failed"] += 1
        else:
            result["processed"] += 1
        _set_pipeline_progress(db, job_id, completed_units, total_units, f"Статья {article.id} завершена.", result)

    return result


def _run_article_step(
    db: Session,
    job_id: int,
    article_id: int,
    step: str,
    *,
    ensure_support_layers: bool,
) -> None:
    if step == "analyze":
        _set_progress(db, job_id, None, f"LLM-анализ статьи {article_id}.")
        analyze_article(db, article_id)
        return
    if step == "embed":
        _set_progress(db, job_id, None, f"Embedding статьи {article_id}.")
        embed_article(db, article_id)
        return
    if step == "detect_event":
        _set_progress(db, job_id, None, f"Служебная связка сюжета для статьи {article_id}.")
        detect_event_for_article(db, article_id)
        return
    if step == "similar":
        _set_progress(db, job_id, None, f"Кэш похожих материалов для статьи {article_id}.")
        precompute_single_article(
            db,
            article_id,
            include_graph=False,
            include_similar=True,
            include_compare=False,
            ensure_support_layers=ensure_support_layers,
        )
        return
    if step == "graph_precompute":
        _set_progress(db, job_id, None, f"Кэш графа для статьи {article_id}.")
        precompute_single_article(
            db,
            article_id,
            include_graph=True,
            include_similar=False,
            include_compare=False,
            ensure_support_layers=ensure_support_layers,
        )
        return
    if step == "compare_precompute":
        _set_progress(db, job_id, None, f"Кэш сравнений для статьи {article_id}.")
        precompute_single_article(
            db,
            article_id,
            include_graph=False,
            include_similar=True,
            include_compare=True,
            ensure_support_layers=ensure_support_layers,
        )
        return
    raise JobError(f"Неподдерживаемый шаг pipeline: {step}")


def _mark_running(db: Session, job: Job) -> None:
    job.status = "running"
    job.started_at = datetime.now(timezone.utc)
    job.progress = max(job.progress, 0.01)
    _append_log_value(job, "Задача запущена.")
    db.commit()


def _finish_job(
    db: Session,
    job_id: int,
    status: str,
    *,
    result: dict[str, Any] | None = None,
    error: str | None = None,
    progress: float | None = None,
) -> None:
    job = db.get(Job, job_id)
    if job is None:
        return
    if job.status == "cancelled" and status != "cancelled":
        return
    job.status = status
    if progress is not None:
        job.progress = progress
    job.result_json = json.dumps(result, ensure_ascii=False, default=str) if result is not None else job.result_json
    job.error = error
    job.finished_at = datetime.now(timezone.utc)
    _append_log_value(job, "Задача завершена." if status == "completed" else f"Задача завершилась со статусом {status}.")
    db.commit()


def _set_pipeline_progress(
    db: Session,
    job_id: int,
    completed_units: int,
    total_units: int,
    message: str,
    result: dict[str, Any] | None = None,
) -> None:
    progress = min(0.98, max(0.02, completed_units / total_units))
    _set_progress(db, job_id, progress, message, result=result)


def _set_progress(
    db: Session,
    job_id: int,
    progress: float | None,
    message: str,
    *,
    result: dict[str, Any] | None = None,
) -> None:
    job = db.get(Job, job_id)
    if job is None:
        raise JobError("Job не найден")
    db.refresh(job)
    if job.status == "cancelled":
        raise JobCancelled()
    if progress is not None:
        job.progress = max(0.0, min(1.0, progress))
    if result is not None:
        job.result_json = json.dumps(result, ensure_ascii=False, default=str)
    _append_log_value(job, message)
    db.commit()


def _ensure_not_cancelled(db: Session, job_id: int) -> None:
    job = db.get(Job, job_id)
    if job is None:
        raise JobError("Job не найден")
    db.refresh(job)
    if job.status == "cancelled":
        raise JobCancelled()


def _append_log_value(job: Job, message: str) -> None:
    logs = _loads_json(job.logs_json) or []
    if not isinstance(logs, list):
        logs = []
    logs.append({"ts": datetime.now(timezone.utc).isoformat(), "message": message})
    job.logs_json = json.dumps(logs[-80:], ensure_ascii=False, default=str)


def _select_articles(db: Session, params: dict[str, Any]) -> list[Article]:
    statement = select(Article).join(Article.source).order_by(Article.published_at.desc())

    if params.get("source_code"):
        statement = statement.where(Source.code == params["source_code"])
    if params.get("date_from"):
        statement = statement.where(Article.published_at >= _parse_date(params["date_from"]))
    if params.get("date_to"):
        statement = statement.where(Article.published_at < _parse_date(params["date_to"]) + timedelta(days=1))
    if params.get("language"):
        statement = statement.where(Article.language == params["language"])
    if params.get("only_without_analysis"):
        statement = statement.outerjoin(ArticleAnalysis).where(ArticleAnalysis.id.is_(None))
    elif params.get("only_with_analysis"):
        statement = statement.join(ArticleAnalysis)

    return list(db.scalars(statement.limit(params.get("limit", 100))).all())


def _should_skip_step(article: Article, step: str) -> bool:
    return step in {"embed", "detect_event", "similar", "graph_precompute", "compare_precompute"} and article.analysis is None


def _validate_steps(steps: list[str]) -> list[str]:
    unsupported = [step for step in steps if step not in PIPELINE_STEPS]
    if unsupported:
        raise JobError(f"Неподдерживаемые шаги pipeline: {', '.join(unsupported)}")
    if not steps:
        raise JobError("Нужно указать хотя бы один шаг pipeline")
    return steps


def _empty_pipeline_result(selected_articles: int, steps: list[str]) -> dict[str, Any]:
    return {
        "selected_articles": selected_articles,
        "processed": 0,
        "failed": 0,
        "steps": {step: {"success": 0, "failed": 0, "skipped": 0} for step in steps},
        "errors": [],
    }


def _parse_date(value: Any) -> date:
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value))


def _loads_json(value: str | None) -> Any:
    if not value:
        return None
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return None
