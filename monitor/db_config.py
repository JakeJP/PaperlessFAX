from __future__ import annotations

import os
from pathlib import Path


APP_ENV_KEY = "APP_ENV"
DATABASE_PATH_KEY = "DATABASE_PATH"
DATABASE_URL_KEY = "DATABASE_URL"


def _project_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _default_db_path(app_env: str) -> Path:
    normalized = app_env.lower()
    data_dir = _project_root() / "data"

    if normalized == "prod":
        return data_dir / "yokinspaperless.db"
    if normalized == "stg":
        return data_dir / "yokinspaperless-stg.db"
    return data_dir / "yokinspaperless-dev.db"


def get_database_path() -> Path:
    database_path = os.getenv(DATABASE_PATH_KEY, "").strip()
    if database_path:
        return Path(database_path)

    database_url = os.getenv(DATABASE_URL_KEY, "").strip()
    if database_url:
        if database_url.startswith("sqlite:///"):
            return Path(database_url.removeprefix("sqlite:///"))
        return Path(database_url)

    app_env = os.getenv(APP_ENV_KEY, "dev").strip() or "dev"
    return _default_db_path(app_env)


def ensure_database_directory() -> Path:
    db_path = get_database_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    return db_path
