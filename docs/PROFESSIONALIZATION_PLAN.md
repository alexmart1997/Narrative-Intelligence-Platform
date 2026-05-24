# План профессионализации Narrative Intelligence Platform

Этот документ фиксирует текущее состояние прототипа и следующий порядок улучшений. Цель — двигаться от работающего MVP к надежному локальному intelligence-инструменту без переписывания проекта с нуля.

## Что уже хорошо

- Есть полный локальный контур: FastAPI, PostgreSQL, Qdrant, Ollama, Next.js.
- Архитектура адаптеров для источников отделена от бизнес-логики.
- LLM-анализ сохраняет не только summary, но и сущности, отношения, evidence, нарративную гипотезу.
- Event layer, narrative discovery и source profile уже построены поверх общей модели данных.
- Для 3D-графов и похожих статей появился precompute cache, поэтому UI может открываться быстрее.

## Главные технические риски

1. **Синхронные LLM-задачи в HTTP-запросах.** Сейчас долгий анализ может держать запрос открытым несколько минут. Для локального MVP это терпимо, но для серьезной работы нужен job layer.
2. **Парсеры зависят от HTML сайтов.** BBC/CNN/РБК могут менять разметку, часть материалов будет выпадать.
3. **Качество similar/event зависит от embeddings и дедупликации.** Сейчас фильтруются очевидные URL-дубли, но нужна нормальная canonicalization + fingerprint текста.
4. **Большие frontend-сцены сложно поддерживать.** 3D-граф уже функционален, но его надо разделить на scene engine, layout engine и UI controls.
5. **Нет автоматических тестов критичных контрактов.** Нужны тесты для JSON-парсинга LLM, сохранения анализа, event matching, API schemas.

## Приоритет 1: надежная обработка данных

- Ввести таблицу `jobs` или легкую очередь на базе PostgreSQL: status, progress, logs, retry_count.
- Перевести `analyze`, `embed`, `detect_event`, `precompute` в фоновые задачи.
- Добавить retry policy для Ollama JSON-ошибок: повтор с более коротким prompt и строгим repair prompt.
- Сохранять raw LLM response для отладки невалидного JSON.
- Добавить текстовый fingerprint статьи и дедупликацию по `source_code + title + published_at + text_hash`.

## Приоритет 2: качество аналитики

- Разделить LLM-анализ на два шага: fact extraction и framing/narrative interpretation.
- Добавить schema validation через Pydantic-модели для LLM JSON.
- Считать confidence не только от модели, но и от evidence coverage: сколько выводов подтверждено цитатами.
- Для event matching использовать гибрид: embedding similarity + overlap сущностей + LLM only for candidates.
- Для narrative discovery хранить cluster membership и версию embedding-модели.

## Приоритет 3: профессиональный backend

- Разделить `api.py` на router-модули: `articles`, `events`, `narratives`, `pipeline`, `sources`, `graphs`.
- Добавить сервисный слой с едиными DTO: API не должен напрямую собирать сложные ORM-ответы.
- Добавить unit-тесты для `analysis.py`, `events.py`, `graph.py`, `vector.py`.
- Добавить health endpoints для зависимостей: PostgreSQL, Qdrant, Ollama, embedding model.
- Добавить OpenAPI examples для основных endpoints.

## Приоритет 4: frontend как аналитический продукт

- Разделить 3D-граф на:
  - `graphScene` — Three.js lifecycle;
  - `graphLayout` — координаты и режимы;
  - `graphEncoding` — цвета, размеры, confidence;
  - `GraphDetailsPanel` — UI деталей.
- Добавить нормальные страницы Events: список, detail, event graph.
- Командную панель `Cmd K` сделать настоящей: поиск по статьям, событиям, сущностям, нарративам.
- Добавить progress UI для batch jobs.
- Добавить сохраненные фильтры и workspace presets.

## Приоритет 5: эксплуатация и воспроизводимость

- Добавить `Makefile` или `justfile` с командами `dev`, `migrate`, `ingest-month`, `pipeline-small`, `precompute`.
- Зафиксировать версии Ollama model и embedding model в README.
- Добавить seed-команду и отдельный demo mode, чтобы тестовые данные не смешивались с реальными.
- Добавить smoke-test script: backend health, frontend build, DB migration, Qdrant collection.

## Ближайший практичный спринт

1. Сделать job layer для pipeline и precompute.
2. Добавить Pydantic validation для всех LLM JSON-ответов.
3. Разделить `api.py` на router-модули.
4. Разделить 3D graph page на scene/layout/ui modules.
5. Добавить тесты на analysis parsing, article deduplication и graph response.
