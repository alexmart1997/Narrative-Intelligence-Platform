# Backend

FastAPI-сервис для прототипа Narrative Intelligence Platform.

## Запуск

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

## Миграции

Перед запуском API поднимите PostgreSQL из корня проекта:

```bash
docker compose up -d postgres
```

Затем примените миграции из папки `backend`:

```bash
alembic upgrade head
```

Healthcheck:

```bash
curl http://localhost:8000/health
```

## Загрузка материалов

```bash
curl http://localhost:8000/ingest/sources
```

```bash
curl -X POST http://localhost:8000/ingest/source-period \
  -H "Content-Type: application/json" \
  -d '{"source_code":"rbc","date_from":"2026-05-01","date_to":"2026-05-30","limit":500}'
```

```bash
curl "http://localhost:8000/articles?source_code=rbc&limit=20"
```

## События

После LLM-анализа и embedding статьи можно определить событие:

```bash
curl -X POST http://localhost:8000/articles/1/detect-event
```

Запустить поиск событий для всех проанализированных статей:

```bash
curl -X POST http://localhost:8000/events/detect-all
```

Список событий с фильтрами:

```bash
curl "http://localhost:8000/events?event_type=politics&q=Молдавия"
```

Граф события:

```bash
curl http://localhost:8000/graph/event/1
```

Расширенный граф статьи со связанными материалами:

```bash
curl "http://localhost:8000/graph/article/1?include_related=true&limit_related=10"
```

## Explainability анализа

После повторного анализа статьи backend сохраняет evidence-цитаты, если модель вернула валидные фрагменты из текста:

```bash
curl -X POST http://localhost:8000/articles/1/analyze
curl http://localhost:8000/articles/1/evidence
```

`GET /articles/{id}/analysis` также возвращает analysis вместе с evidence, сгруппированными по `evidence_type`.
