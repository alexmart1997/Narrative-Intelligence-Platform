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

3. Установите зависимости backend:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

4. Запустите backend:

```bash
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Проверка:

```bash
curl http://localhost:8000/health
```

5. В отдельном терминале установите зависимости frontend:

```bash
cd frontend
npm install
```

6. Запустите frontend:

```bash
npm run dev
```

Откройте `http://localhost:3000`.

## Ollama

Установите и запустите Ollama локально. Пример загрузки модели:

```bash
ollama pull llama3.1:8b
```

Backend пока только хранит адрес Ollama в конфигурации. Интеграция с LLM будет добавлена следующими шагами.

## Локальные сервисы

- Backend: `http://localhost:8000`
- Frontend: `http://localhost:3000`
- PostgreSQL: `localhost:5432`
- Qdrant REST API: `http://localhost:6333`

## Остановка инфраструктуры

```bash
docker compose down
```
