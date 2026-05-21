from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings


class Base(DeclarativeBase):
    """Базовый класс для всех SQLAlchemy-моделей."""


# Пул соединений небольшой, чтобы локальный запуск был легким для MacBook.
engine = create_engine(settings.database_url, pool_pre_ping=True, pool_size=5, max_overflow=5)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db() -> Generator[Session, None, None]:
    """Dependency для FastAPI: выдает сессию БД и закрывает ее после запроса."""

    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
