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
cp .env.local.example .env.local
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

## Frontend dashboard

Главная страница `http://localhost:3000/articles` оформлена как premium intelligence command center:

- верхняя command bar с глобальным поиском, быстрыми действиями и переключателем плотности;
- карточки метрик по статьям, событиям, источникам, нарративам, необработанным материалам и средней уверенности;
- timeline strip по дням публикации;
- dark intelligence feed с карточками статей, analysis summary, sentiment, framing, narrative hypothesis и top entities;
- правая insight panel с event spotlight, top narratives, source mix и AI insight callout;
- фильтры по source, date range, language, material type, status, sentiment и search query;
- command palette по `Cmd+K` для быстрого поиска и переходов.

Если часть данных еще не рассчитана backend-ом, dashboard показывает graceful fallback и не ломает основной список статей.

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

Посмотреть доказательства выводов анализа:

```bash
curl http://localhost:8000/articles/1/evidence
```

Backend отправляет текст статьи в локальный Ollama, ожидает структурированный JSON, сохраняет резюме, тональность, stance, framing, гипотезу нарратива, сущности, отношения и evidence-цитаты. Evidence хранит короткие фрагменты текста, которые объясняют выводы по framing, sympathy, criticism, narrative и другим типам. Если модель вернет текст вокруг JSON, backend попробует извлечь JSON автоматически. Если JSON невалидный, API вернет понятную ошибку. Если отдельные evidence-элементы невалидны или цитата не найдена в тексте статьи, backend просто пропустит их.

## Batch pipeline

Для массовой локальной обработки статей есть простой batch pipeline без Celery и очередей. Он последовательно проходит по выбранным статьям и не останавливает весь запуск, если отдельная статья упала.

Загрузить статьи можно через ingestion endpoint:

```bash
curl -X POST http://localhost:8000/ingest/source-period \
  -H "Content-Type: application/json" \
  -d '{
    "source_code": "rbc",
    "date_from": "2026-05-01",
    "date_to": "2026-05-30",
    "limit": 100
  }'
```

Массово проанализировать, векторизовать и привязать события:

```bash
curl -X POST http://localhost:8000/pipeline/process-articles \
  -H "Content-Type: application/json" \
  -d '{
    "source_code": null,
    "date_from": null,
    "date_to": null,
    "language": null,
    "only_without_analysis": true,
    "limit": 100,
    "steps": ["analyze", "embed", "detect_event"]
  }'
```

Для быстрой проверки без LLM можно запустить только embedding на одной уже проанализированной статье:

```bash
curl -X POST http://localhost:8000/pipeline/process-articles \
  -H "Content-Type: application/json" \
  -d '{
    "only_without_analysis": false,
    "limit": 1,
    "steps": ["embed"]
  }'
```

Проверить последний запуск pipeline:

```bash
curl http://localhost:8000/pipeline/status
```

Заранее простроить быстрые данные для UI, чтобы графы и похожие статьи открывались без долгого ожидания:

```bash
curl -X POST http://localhost:8000/pipeline/precompute-intelligence \
  -H "Content-Type: application/json" \
  -d '{
    "date_from": "2026-04-24",
    "date_to": "2026-05-24",
    "only_with_analysis": true,
    "limit": 100,
    "limit_related": 30,
    "similar_limit": 10,
    "include_compare": false
  }'
```

`include_compare=true` заранее считает также LLM-сравнения с похожими статьями, но это медленнее, потому что вызывает Ollama.

Проверить результаты:

```bash
curl "http://localhost:8000/articles?limit=20"
curl "http://localhost:8000/events"
curl "http://localhost:8000/articles/1/analysis"
```

## Source Profile Analytics

Профиль источника показывает, какие сущности, фреймы, нарративы, гипотезы нарратива и тональность чаще встречаются у выбранного СМИ:

```bash
curl "http://localhost:8000/sources/rbc/profile"
```

С фильтрами:

```bash
curl "http://localhost:8000/sources/rbc/profile?date_from=2026-05-01&date_to=2026-05-30&language=ru"
```

## План развития

Технический план доведения MVP до профессионального решения лежит в [docs/PROFESSIONALIZATION_PLAN.md](docs/PROFESSIONALIZATION_PLAN.md).

Во frontend профиль доступен по адресу:

```text
http://localhost:3000/sources/rbc/profile
```

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

## Event Intelligence Layer

Слой событий объединяет несколько статей в одно событие. Он работает поверх уже существующего анализа статей, embeddings в Qdrant и локального Ollama.

Перед запуском event matching у статей должен быть LLM-анализ и embedding:

```bash
curl -X POST http://localhost:8000/articles/1/analyze
curl -X POST http://localhost:8000/articles/1/embed
```

Определить событие для одной статьи:

```bash
curl -X POST http://localhost:8000/articles/1/detect-event
```

Определить события для всех проанализированных статей:

```bash
curl -X POST http://localhost:8000/events/detect-all
```

Посмотреть события:

```bash
curl "http://localhost:8000/events"
```

Фильтры событий:

```bash
curl "http://localhost:8000/events?event_type=politics&q=Молдавия"
curl "http://localhost:8000/events?date_from=2026-05-01&date_to=2026-05-30"
```

Посмотреть одно событие:

```bash
curl http://localhost:8000/events/1
```

Граф события:

```bash
curl http://localhost:8000/graph/event/1
```

Граф статьи можно расширить связанными материалами:

```bash
curl "http://localhost:8000/graph/article/1?include_related=true&limit_related=10"
```

В расширенный граф добавляются статьи того же события, похожие статьи из Qdrant и статьи с похожей `narrative_hypothesis`. Связи: `same_event_as`, `similar_to`, `shares_narrative`.

## Граф статьи

Создать тестовые данные для просмотра графа без реальных новостей:

```bash
cd backend
PYTHONPATH=. python -m app.seed
```

Команда выведет `article_id`, который можно открыть графовым endpoint:

```bash
curl http://localhost:8000/graph/article/12
```

Граф содержит узлы статьи, источника, сущностей, гипотезы нарратива и связи `published_by`, `mentions`, `relates_to`, `sympathizes_with`, `criticizes`, `supports_narrative`.

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
