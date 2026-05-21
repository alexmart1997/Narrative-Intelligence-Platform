from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


ROOT_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """Настройки приложения, которые читаются из .env в корне проекта."""

    app_name: str = "Narrative Intelligence Platform"
    postgres_db: str = "narrative"
    postgres_user: str = "narrative"
    postgres_password: str = "narrative"
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    qdrant_host: str = "localhost"
    qdrant_port: int = 6333
    ollama_base_url: str = "http://localhost:11434"

    @property
    def database_url(self) -> str:
        """DSN PostgreSQL для SQLAlchemy и Alembic."""

        return (
            "postgresql+psycopg://"
            f"{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    model_config = SettingsConfigDict(
        env_file=ROOT_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
