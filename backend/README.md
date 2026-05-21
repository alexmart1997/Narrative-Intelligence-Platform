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
