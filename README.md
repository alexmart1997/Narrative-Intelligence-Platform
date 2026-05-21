# Narrative Intelligence Platform

Локальный прототип платформы для анализа нарративов. Проект не использует платные API: LLM предполагается запускать локально через Ollama, данные хранятся в PostgreSQL, векторное хранилище работает через Qdrant.

## Стек

- Backend: Python + FastAPI
- Frontend: Next.js + TypeScript
- Database: PostgreSQL
- Vector DB: Qdrant
- LLM: локальный Ollama API
- Запуск: локально на MacBook, Docker только для инфраструктуры

## Структура

```text
.
├── backend
├── frontend
├── docker-compose.yml
├── .env.example
└── README.md
```

## Требования

- Python 3.11+
- Node.js 20+
- Docker Desktop
- Ollama

## Первый запуск

1. Создайте локальный env-файл:

```bash
cp .env.example .env
```

2. Запустите PostgreSQL и Qdrant:

```bash
docker compose up -d
```

Проверка Qdrant:

```bash
curl http://localhost:6333/healthz
```

3. Установите зависимости backend:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

4. Примените миграции PostgreSQL:

```bash
alembic upgrade head
```

5. Запустите backend:

```bash
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Проверка:

```bash
curl http://localhost:8000/health
```

6. В отдельном терминале установите зависимости frontend:

```bash
cd frontend
npm install
```

7. Запустите frontend:

```bash
npm run dev
```

Откройте `http://localhost:3000`.

## Ollama

Backend обращается только к локальному Ollama API, платные API не используются.

1. Установите Ollama: скачайте приложение с официального сайта Ollama и запустите его.

2. Скачайте локальную модель:

```bash
ollama pull qwen3:4b
```

3. Проверьте настройки в `.env`:

```bash
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen3:4b
```

4. Запустите backend:

```bash
cd backend
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

5. Проверьте `/llm/test`:

```bash
curl -X POST http://localhost:8000/llm/test \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Кратко объясни, что такое фрейминг в политических новостях."
  }'
```

Если Ollama не запущен или модель не скачана, backend вернет понятную ошибку с HTTP-статусом `503`.

## Локальные сервисы

- Backend: `http://localhost:8000`
- Frontend: `http://localhost:3000`
- PostgreSQL: `localhost:5432`
- Qdrant REST API: `http://localhost:6333`

## Миграции БД

Миграции лежат в `backend/alembic`. Команды выполняются из папки `backend` с активированным виртуальным окружением:

```bash
alembic upgrade head
```

Создать новую миграцию после изменения моделей:

```bash
alembic revision --autogenerate -m "describe changes"
```

## Загрузка материалов

Доступные источники:

```bash
curl http://localhost:8000/ingest/sources
```

Загрузить РБК за 1-30 мая 2026:

```bash
curl -X POST http://localhost:8000/ingest/source-period \
  -H "Content-Type: application/json" \
  -d '{
    "source_code": "rbc",
    "date_from": "2026-05-01",
    "date_to": "2026-05-30",
    "limit": 500
  }'
```

Загрузить BBC за 1-30 мая 2026:

```bash
curl -X POST http://localhost:8000/ingest/source-period \
  -H "Content-Type: application/json" \
  -d '{
    "source_code": "bbc",
    "date_from": "2026-05-01",
    "date_to": "2026-05-30",
    "limit": 500
  }'
```

Загрузить CNN за 1-30 мая 2026:

```bash
curl -X POST http://localhost:8000/ingest/source-period \
  -H "Content-Type: application/json" \
  -d '{
    "source_code": "cnn",
    "date_from": "2026-05-01",
    "date_to": "2026-05-30",
    "limit": 500
  }'
```

Посмотреть загруженные статьи:

```bash
curl "http://localhost:8000/articles?source_code=rbc&date_from=2026-05-01&date_to=2026-05-30&limit=50"
```

Поиск по заголовку и тексту:

```bash
curl "http://localhost:8000/articles?q=election&language=en&limit=20"
```

## LLM-анализ статьи

Запустить анализ загруженной статьи:

```bash
curl -X POST http://localhost:8000/articles/1/analyze
```

Посмотреть сохраненный анализ:

```bash
curl http://localhost:8000/articles/1/analysis
```

Backend отправляет текст статьи в локальный Ollama, ожидает структурированный JSON, сохраняет резюме, тональность, stance, framing, гипотезу нарратива, сущности и отношения. Если модель вернет текст вокруг JSON, backend попробует извлечь JSON автоматически. Если JSON невалидный, API вернет понятную ошибку.

## Векторизация и похожие статьи

Для embeddings используется легкая мультиязычная модель `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`. Она подходит для MacBook и работает с русскими и английскими текстами.

Qdrant запускается через Docker Compose:

```bash
docker compose up -d qdrant
```

Первый запуск embedding может занять время: sentence-transformers скачает модель локально.

Создать embedding одной статьи:

```bash
curl -X POST http://localhost:8000/articles/1/embed
```

Создать embeddings для всех статей, у которых уже есть LLM-анализ:

```bash
curl -X POST http://localhost:8000/articles/embed-all
```

Найти похожие новости:

```bash
curl "http://localhost:8000/articles/1/similar?limit=10"
```

Embedding создается по `title + short_summary + text[:3000]`, а в Qdrant payload сохраняет `article_id`, `title`, `source_name`, `published_at`, `language`. Это нужно для сравнения освещения одного события разными изданиями.

## Сравнение статей

Сравнить две статьи через Ollama:

```bash
curl -X POST http://localhost:8000/compare/articles \
  -H "Content-Type: application/json" \
  -d '{
    "article_id_1": 1,
    "article_id_2": 2
  }'
```

Сравнить статью с top-3 похожими материалами из Qdrant:

```bash
curl http://localhost:8000/articles/1/compare-with-similar
```

Перед сравнением у статей должен быть сохраненный LLM-анализ. Для `compare-with-similar` также нужны embeddings в Qdrant.

### Ограничения MVP-парсеров

- Сайты могут менять HTML, поэтому часть селекторов со временем потребуется обновлять.
- Часть материалов может не парситься полностью или не иметь доступной даты публикации.
- Некоторые сайты могут ограничивать доступ, отдавать региональные версии страниц или блокировать частые запросы.
- Для MVP это нормально: главное сейчас - рабочая архитектура адаптеров, отдельная обработка ошибок по ссылкам и сохранение доступного текста.
- Если полный текст получить не удалось, backend пытается сохранить хотя бы заголовок и доступный preview/summary.

## Остановка инфраструктуры

```bash
docker compose down
```
