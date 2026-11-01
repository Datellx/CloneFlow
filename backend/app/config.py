"""Runtime configuration.

Values come from environment variables, and also from `.env.local` / `.env` at the repo root
(see .env.example). META_MODEL_API / META_API_KEY are accepted as aliases for MODEL_API_KEY.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

_ALIASES = {
    "META_MODEL_API": "MODEL_API_KEY",
    "META_API_KEY": "MODEL_API_KEY",
}


def _load_env_files() -> None:
    for name in (".env.local", ".env"):
        path = ROOT / name
        if not path.exists():
            continue
        for raw in path.read_text().splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip().removeprefix("export ").strip()
            value = value.strip().strip('"').strip("'")
            os.environ.setdefault(key, value)
            alias = _ALIASES.get(key)
            if alias:
                os.environ.setdefault(alias, value)
    for src, dst in _ALIASES.items():
        if os.environ.get(src) and not os.environ.get(dst):
            os.environ[dst] = os.environ[src]


_load_env_files()


def _bool(name: str, default: bool = False) -> bool:
    v = os.environ.get(name)
    if v is None:
        return default
    return v.strip().lower() in {"1", "true", "yes", "on"}


@dataclass
class Settings:
    model_api_key: str = field(default_factory=lambda: os.environ.get("MODEL_API_KEY", ""))
    model_base_url: str = field(default_factory=lambda: os.environ.get("MODEL_BASE_URL", "https://api.meta.ai/v1"))
    # "meta" uses the Meta Model API; "mock" is an offline heuristic provider used
    # only for UI development when the network is unavailable. Evaluation refuses mock.
    llm_provider: str = field(default_factory=lambda: os.environ.get("LLM_PROVIDER", "").strip().lower())
    # "standard" (content not used for training) or "contributor" (cheap; Meta may train on it).
    cloud_model: str = field(default_factory=lambda: os.environ.get("CLOUD_MODEL", "muse-spark-1.3"))
    transcribe_model: str = field(default_factory=lambda: os.environ.get("TRANSCRIBE_MODEL", "muse-voice-transcribe-1.0"))
    max_concurrency: int = field(default_factory=lambda: int(os.environ.get("LLM_MAX_CONCURRENCY", "24")))

    tts_provider: str = field(default_factory=lambda: os.environ.get("TTS_PROVIDER", "browser").strip().lower())
    tts_api_key: str = field(default_factory=lambda: os.environ.get("TTS_API_KEY", ""))
    tts_voice: str = field(default_factory=lambda: os.environ.get("TTS_VOICE", ""))

    database_url: str = field(default_factory=lambda: os.environ.get("DATABASE_URL", ""))
    data_dir: Path = field(default_factory=lambda: Path(os.environ.get("DATA_DIR", str(ROOT / "data"))))
    secret_key: str = field(default_factory=lambda: os.environ.get("SECRET_KEY", ""))
    cookie_secure: bool = field(default_factory=lambda: _bool("COOKIE_SECURE", False))
    # Master switch for paid model calls. Off means the engine never contacts the model API.
    ai_enabled: bool = field(default_factory=lambda: _bool("AI_ENABLED", True))
    # The site's own address (links in emails, OAuth redirects). Render sets RENDER_EXTERNAL_URL by itself.
    public_url: str = field(default_factory=lambda: (os.environ.get("PUBLIC_URL", "").strip()
                                                     or os.environ.get("RENDER_EXTERNAL_URL", "").strip()
                                                     or "http://localhost:8000"))
    # Supabase (sign-in and email). Postgres is DATABASE_URL above.
    supabase_url: str = field(default_factory=lambda: os.environ.get("SUPABASE_URL", "").strip())
    supabase_anon_key: str = field(default_factory=lambda: os.environ.get("SUPABASE_ANON_KEY", "").strip())
    supabase_service_key: str = field(default_factory=lambda: os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip())

    def __post_init__(self) -> None:
        if not self.llm_provider:
            self.llm_provider = "meta" if self.model_api_key else "mock"
        self.data_dir.mkdir(parents=True, exist_ok=True)
        if not self.database_url:
            self.database_url = f"sqlite:///{self.data_dir / 'cloneflow.db'}"
        (self.data_dir / "uploads").mkdir(exist_ok=True)
        (self.data_dir / "media").mkdir(exist_ok=True)
        if not self.secret_key:
            key_file = self.data_dir / ".secret_key"
            if not key_file.exists():
                key_file.write_text(os.urandom(32).hex())
                key_file.chmod(0o600)
            self.secret_key = key_file.read_text().strip()

    @property
    def chat_model(self) -> str:
        return self.cloud_model


settings = Settings()
