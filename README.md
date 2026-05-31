# Narrative Intelligence Platform

Narrative Intelligence Platform - локальная AI-платформа для анализа новостного потока, смыслового поиска и выявления нарративов в политических и общественно значимых медиа.

Проект помогает перейти от обычного списка публикаций к аналитической картине: какие события обсуждаются, какие участники и организации фигурируют в материалах, как разные источники подают один сюжет, какие фреймы повторяются и какие нарративы формируются в корпусе новостей.

## Идея продукта

Классический мониторинг СМИ показывает, что, где и когда было опубликовано. Narrative Intelligence Platform добавляет смысловой слой поверх новостного потока:

- превращает статьи в структурированные аналитические объекты;
- выделяет краткое и подробное резюме, тональность, позицию, фрейминг и гипотезу нарратива;
- извлекает сущности, роли и отношения между участниками сюжета;
- сохраняет evidence-цитаты, которые объясняют выводы модели;
- ищет действительно похожие материалы через embeddings и hybrid similarity;
- сравнивает освещение одного события разными источниками;
- объединяет статьи в события и нарративы;
- строит графы связей между статьями, источниками, сущностями, событиями и нарративами;
- показывает обзорную карту информационного поля по нарративам, событиям или источникам.

Платформа ориентирована на аналитиков медиа и коммуникаций, исследователей политических процессов, редакции, fact-check команды, PR/GR-специалистов и исследовательские группы, которым важны локальная обработка, объяснимость и контроль над данными.

## Что реализовано

В текущей версии это рабочий end-to-end прототип:

- загрузка материалов из источников RBC, BBC и CNN;
- хранение статей, анализов, сущностей, отношений, событий, нарративов и evidence в PostgreSQL;
- LLM-анализ статьи через локальный Ollama API;
- evidence layer с проверяемыми цитатами из текста;
- multilingual embeddings через `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`;
- Qdrant для векторного поиска похожих публикаций;
- сравнение двух статей и сравнение статьи с top-N похожими материалами;
- слой событий, который объединяет несколько публикаций в один сюжет;
- слой нарративов по `narrative_hypothesis` из LLM-анализов;
- source profile analytics для анализа повторяющихся фреймов, сущностей и тональности у источника;
- локальные background jobs и batch pipeline для массовой обработки;
- precompute cache для быстрого открытия графов, похожих материалов и сравнений в UI;
- Next.js-интерфейс с разделами Articles, Events, Narratives, Source Profile, Graph, Compare и Intelligence Map.

## Основные сценарии

### Анализ статьи

Статья превращается в аналитическую карточку. Система сохраняет summary, sentiment, stance, framing, sympathizes_with, criticizes, narrative_hypothesis, confidence, сущности, отношения и evidence-цитаты.

### Поиск похожих материалов

Похожие статьи ищутся не только по embedding. В расчете используются semantic similarity, пересечение сущностей, keyword overlap, близость дат и guard против ложных совпадений на слишком общих темах.

### Сравнение освещения

Платформа сравнивает две публикации и показывает вероятность одного события, совпадающие факты, различия, фрейминг каждого источника, симпатии, критику, различие нарративов и аналитический вывод.

### Граф связей

Граф показывает связи между статьей, источником, персонами, организациями, странами, концептами, событиями, похожими публикациями и нарративами. Это помогает исследовать сюжет не линейно, а как сеть смысловых отношений.

### Карта информационного поля

Раздел Intelligence Map показывает корпус как карту: точка - статья, облако - кластер нарратива, события или источника. Размер облака отражает плотность материалов, а инспектор помогает быстро понять состав кластера.

## Архитектура

```text
Source adapters
      |
      v
FastAPI backend ---- PostgreSQL
      |                  |
      |                  +-- articles, analyses, entities, relations
      |                  +-- events, narratives, evidence, jobs, cache
      |
      +---- Ollama / local LLM
      |
      +---- sentence-transformers
      |
      +---- Qdrant vector DB
      |
      v
Next.js frontend
```

Пайплайн обработки:

1. Адаптер источника загружает материалы за выбранный период.
2. PostgreSQL сохраняет статьи и метаданные.
3. Локальная LLM анализирует текст и возвращает структурированный JSON.
4. Backend сохраняет анализ, сущности, отношения и evidence.
5. Embedding-модель строит векторы статей.
6. Qdrant возвращает кандидатов похожих материалов.
7. Hybrid similarity и LLM-сравнение уточняют смысловые связи.
8. Frontend показывает статьи, сравнения, графы, события, нарративы и карту корпуса.

## Стек

- Backend: Python, FastAPI, SQLAlchemy, Alembic
- Frontend: Next.js 14, React, TypeScript
- Database: PostgreSQL
- Vector DB: Qdrant
- LLM runtime: локальный Ollama API
- Embeddings: sentence-transformers
- Graph UI: Three.js / Cytoscape-related types and graph components
- Local infrastructure: Docker Compose

Проект не требует платных LLM API: анализ выполняется локально через Ollama.

## Структура репозитория

```text
.
├── backend/                 # FastAPI API, модели, миграции, пайплайны
├── frontend/                # Next.js приложение
├── docs/                    # презентационные материалы и план развития
├── outputs/                 # результаты внутренней оценки
├── docker-compose.yml       # PostgreSQL и Qdrant
├── .env.example             # пример переменных окружения
└── README.md
```

## Требования

- Python 3.11+
- Node.js 20+
- Docker Desktop
- Ollama

## Быстрый запуск

### 1. Подготовить env

```bash
cp .env.example .env
```

При необходимости измените параметры PostgreSQL, Qdrant и Ollama в `.env`.

### 2. Запустить инфраструктуру

```bash
docker compose up -d
```

Проверка Qdrant:

```bash
curl http://localhost:6333/healthz
```

### 3. Подготовить backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Проверка backend:

```bash
curl http://localhost:8000/health
```

### 4. Подготовить Ollama

```bash
ollama pull qwen3:4b
```

Проверьте `.env`:

```bash
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen3:4b
```

Проверка связи backend с LLM:

```bash
curl -X POST http://localhost:8000/llm/test \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Кратко объясни, что такое фрейминг в политических новостях."}'
```

### 5. Запустить frontend

```bash
cd frontend
cp .env.local.example .env.local
npm install
npm run dev
```

Откройте `http://localhost:3000`.

## Локальные сервисы

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:8000`
- PostgreSQL: `localhost:5432`
- Qdrant REST API: `http://localhost:6333`
- Ollama: `http://localhost:11434`

## Основные разделы интерфейса

- `/` - стартовая страница продукта;
- `/articles` - рабочее пространство со статьями, фильтрами, поиском, анализом и похожими материалами;
- `/articles/{id}/analysis` - подробный LLM-анализ статьи;
- `/articles/{id}/compare` - сравнение статьи с похожими публикациями;
- `/articles/{id}/graph` - граф связей статьи;
- `/events` и `/events/{id}` - события и связанные публикации;
- `/narratives` и `/narratives/{id}/graph` - найденные нарративы и их графы;
- `/sources/{code}/profile` - аналитический профиль источника;
- `/map` - карта информационного поля.

## Примеры API-сценариев

### Доступные источники

```bash
curl http://localhost:8000/ingest/sources
```

### Загрузка материалов за период

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

Поддерживаемые `source_code`: `rbc`, `bbc`, `cnn`.

### Список статей

```bash
curl "http://localhost:8000/articles?source_code=rbc&date_from=2026-05-01&date_to=2026-05-30&limit=50"
```

### Анализ статьи

```bash
curl -X POST http://localhost:8000/articles/1/analyze
curl http://localhost:8000/articles/1/analysis
curl http://localhost:8000/articles/1/evidence
```

### Embeddings и похожие статьи

```bash
curl -X POST http://localhost:8000/articles/1/embed
curl -X POST http://localhost:8000/articles/embed-all
curl "http://localhost:8000/articles/1/similar?limit=10"
```

### Сравнение статей

```bash
curl -X POST http://localhost:8000/compare/articles \
  -H "Content-Type: application/json" \
  -d '{
    "article_id_1": 1,
    "article_id_2": 2
  }'
```

```bash
curl http://localhost:8000/articles/1/compare-with-similar
```

### События

```bash
curl -X POST http://localhost:8000/articles/1/detect-event
curl -X POST http://localhost:8000/events/detect-all
curl "http://localhost:8000/events"
curl http://localhost:8000/events/1
curl http://localhost:8000/graph/event/1
```

### Нарративы

```bash
curl -X POST http://localhost:8000/narratives/discover
curl http://localhost:8000/narratives
curl http://localhost:8000/narratives/1
curl http://localhost:8000/graph/narrative/1
```

### Граф статьи и карта корпуса

```bash
curl "http://localhost:8000/graph/article/1?include_related=true&limit_related=10"
curl "http://localhost:8000/graph/map?mode=narratives&limit=300"
```

### Source Profile Analytics

```bash
curl "http://localhost:8000/sources/rbc/profile"
curl "http://localhost:8000/sources/rbc/profile?date_from=2026-05-01&date_to=2026-05-30&language=ru"
```

## Batch pipeline и фоновые задачи

Для массовой локальной обработки статей есть batch pipeline без Celery и Redis:

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

Проверка последнего запуска:

```bash
curl http://localhost:8000/pipeline/status
```

Предрасчет данных для быстрого UI:

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

Локальные jobs доступны через:

```bash
curl http://localhost:8000/jobs
curl http://localhost:8000/jobs/1
curl -X POST http://localhost:8000/jobs/1/cancel
```

## Миграции БД

Миграции лежат в `backend/alembic`. Команды выполняются из папки `backend`:

```bash
alembic upgrade head
alembic revision --autogenerate -m "describe changes"
```

## Ограничения прототипа

- HTML источников может меняться, поэтому адаптеры парсинга требуют поддержки.
- Часть материалов может быть загружена неполностью из-за ограничений сайтов.
- Локальная LLM медленнее облачных моделей.
- Качество нарративов зависит от модели и промта.
- Сравнение статей требует более дорогих LLM-вызовов, чем embedding search.
- Текущая версия является исследовательским прототипом, а не промышленным crawling pipeline.

## Документация и материалы

- [Backend README](backend/README.md)
- [Frontend README](frontend/README.md)
- [Текст презентации](docs/PRESENTATION_TEXT.md)
- [План профессионализации](docs/PROFESSIONALIZATION_PLAN.md)
- [HTML-презентация](docs/news_intelligence_presentation.html)

## Команда проекта

- Абиев Марик - Machine Learning Engineer
- Барабошкина Кристина - Frontend Engineer
- Варфоломеев Константин - Backend Engineer
- Владынцев Сергей - Backend Engineer
- Мартыненко Алексей - Machine Learning Engineer, Product Manager
- Подгорнов Владислав - Market Analysis & Product Positioning

## Остановка инфраструктуры

```bash
docker compose down
```
