# Backend

FastAPI-сервис для прототипа Narrative Intelligence Platform.

## Запуск

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Healthcheck:

```bash
curl http://localhost:8000/health
```
