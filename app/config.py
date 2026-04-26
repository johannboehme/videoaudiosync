from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    secret_key: str = "dev-secret-change-me"
    base_url: str = "http://localhost:8000"
    data_dir: Path = Path("./data")
    max_user_quota_gb: int = 5
    max_upload_mb: int = 1024
    session_max_age_days: int = 30
    sample_rate: int = 22050

    @property
    def uploads_dir(self) -> Path:
        return self.data_dir / "uploads"

    @property
    def renders_dir(self) -> Path:
        return self.data_dir / "renders"

    @property
    def cache_dir(self) -> Path:
        return self.data_dir / "cache"

    @property
    def tmp_dir(self) -> Path:
        return self.data_dir / "tmp"

    @property
    def db_path(self) -> Path:
        return self.data_dir / "db.sqlite"

    def ensure_dirs(self) -> None:
        for d in (self.uploads_dir, self.renders_dir, self.cache_dir, self.tmp_dir):
            d.mkdir(parents=True, exist_ok=True)


settings = Settings()
