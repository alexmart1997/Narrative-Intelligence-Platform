FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for psycopg2/psycopg and other potential libs
RUN apt-get update && apt-get install -y \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Environment variables with defaults for docker-compose networking
ENV POSTGRES_HOST=postgres
ENV QDRANT_HOST=qdrant
ENV OLLAMA_BASE_URL=http://host.docker.internal:11434

EXPOSE 8000

# CMD will be overridden in docker-compose if needed, 
# but providing a default to run migrations and start uvicorn.
# Using a shell form to allow environment variable expansion or multiple commands.
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
