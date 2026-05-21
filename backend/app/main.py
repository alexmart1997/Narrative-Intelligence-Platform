from fastapi import FastAPI

from app.api import router
from app.config import settings


app = FastAPI(
    title=settings.app_name,
    description="Локальный API для прототипа Narrative Intelligence Platform.",
    version="0.1.0",
)

app.include_router(router)


@app.get("/health")
def health_check() -> dict[str, str]:
    """Простой healthcheck для проверки, что backend запущен."""

    return {"status": "ok", "service": "backend"}
