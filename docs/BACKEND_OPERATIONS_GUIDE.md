# Backend Operations Guide

## Purpose

This note documents the minimum operational checks for the FastAPI backend. It is intended for local development, demo runs, and lightweight pre-release verification.

## Service Readiness

Before starting backend work, verify that the required infrastructure is available:

- PostgreSQL is running and accepts connections from the backend container or local process.
- Alembic migrations are applied to the target database.
- Optional AI services such as Ollama and Qdrant are available before running analysis or vector search flows.

## Startup Checklist

1. Start infrastructure from the project root:

   ```bash
   docker compose up -d postgres qdrant
   ```

2. Apply database migrations from the backend directory:

   ```bash
   alembic upgrade head
   ```

3. Start the API:

   ```bash
   uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
   ```

4. Check API health:

   ```bash
   curl http://localhost:8000/health
   ```

## Operational Smoke Tests

Use these checks after backend startup or configuration changes:

- `GET /health` returns a successful response.
- `GET /ingest/sources` returns configured ingestion sources.
- `GET /articles?limit=1` returns a valid JSON response.
- `GET /pipeline/status` returns the latest pipeline state or an empty status without crashing.

## Failure Triage

When the backend returns an error, start with the dependency class:

- `404` usually means the requested article, event, narrative, or source does not exist.
- `400` usually means a required preprocessing step has not been completed.
- `503` usually points to an unavailable external service such as Ollama or Qdrant.
- `422` usually means the request was valid HTTP but could not be completed by the domain flow.

## Release Hygiene

For backend-only changes, keep the verification narrow and repeatable:

- Run migrations against a disposable database before demo data is loaded.
- Capture the smoke-test commands and their status in the pull request notes.
- Avoid mixing API behavior changes with documentation, presentation assets, or frontend polish.
