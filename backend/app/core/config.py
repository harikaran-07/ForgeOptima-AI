"""Central application configuration.

All values can be overridden with environment variables or a backend/.env file.
Never commit real secrets; see .env.example at the repository root.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import List

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(str(REPO_DIR / ".env"), str(BACKEND_DIR / ".env")),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- Application -------------------------------------------------------
    app_name: str = "ForgeOptima AI"
    app_version: str = "1.0.0"
    environment: str = "development"          # development | staging | production
    api_prefix: str = "/api"
    log_level: str = "INFO"

    # --- Database ----------------------------------------------------------
    # Local development defaults to SQLite so the app runs with zero setup.
    # Set DATABASE_URL=postgresql+psycopg://user:pass@host:5432/forgeoptima
    # for PostgreSQL (production / Render).
    database_url: str = f"sqlite:///{(BACKEND_DIR / 'forgeoptima.db').as_posix()}"
    sql_echo: bool = False

    # --- CORS --------------------------------------------------------------
    cors_origins: List[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
        "https://forge-optima-ai.vercel.app",
    ]

    # --- Ollama / SHAKTHI AI ----------------------------------------------
    # Local default; in production point this at a secured inference host.
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "qwen2.5:3b"
    ollama_timeout_seconds: float = 180.0
    ai_context_heat_limit: int = 12
    ai_max_message_chars: int = 4000

    # --- Domain defaults ---------------------------------------------------
    emission_factor_kg_per_kwh: float = 0.71   # grid factor, configurable in Settings UI
    max_upload_mb: int = 10
    rate_limit_per_minute: int = 240
    anomaly_threshold: float = 0.0             # IsolationForest decision_function cut

    # --- ML ----------------------------------------------------------------
    model_dir: str = str(BACKEND_DIR / "artifacts")
    dataset_path: str = str(BACKEND_DIR / "data" / "synthetic_heats.csv")

    @field_validator("database_url", mode="before")
    @classmethod
    def _normalize_database_url(cls, value):
        if isinstance(value, str):
            if value.startswith("postgres://"):
                value = value.replace("postgres://", "postgresql+psycopg://", 1)
            if value.startswith("postgresql://") and "+psycopg" not in value:
                value = value.replace("postgresql://", "postgresql+psycopg://", 1)
            if "postgresql+psycopg://" in value and "sslmode" not in value and "localhost" not in value and "127.0.0.1" not in value:
                sep = "&" if "?" in value else "?"
                value = f"{value}{sep}sslmode=require"
        return value

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value):
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
