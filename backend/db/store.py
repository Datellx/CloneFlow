"""Engine and session helpers. Postgres in production (Supabase: DATABASE_URL = the session-pooler connection
string); a local SQLite file when DATABASE_URL is not set (development and tests)."""
from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from backend.app.config import settings
from .models import Base

def _url(u: str) -> str:
    # Supabase / Render give postgres:// or postgresql:// — use the psycopg 3 driver.
    for prefix in ("postgres://", "postgresql://"):
        if u.startswith(prefix):
            return "postgresql+psycopg://" + u[len(prefix):]
    return u


DB_URL = _url(settings.database_url)
_is_sqlite = DB_URL.startswith("sqlite")
engine = create_engine(
    DB_URL,
    connect_args={"check_same_thread": False, "timeout": 30} if _is_sqlite else {},
    pool_pre_ping=True,
    **({} if _is_sqlite else {"pool_size": 5, "max_overflow": 5, "pool_recycle": 300}),
)

if _is_sqlite:
    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _):  # pragma: no cover - trivial
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.execute("PRAGMA synchronous=NORMAL")
        cur.close()

SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)

# Progress updates must never wait on a long-running job's write transaction:
# a separate engine with a short busy timeout lets them skip instead of stalling.
_quick_engine = create_engine(
    DB_URL,
    connect_args={"check_same_thread": False, "timeout": 0.3} if _is_sqlite else {},
    pool_pre_ping=True,
) if _is_sqlite else engine
QuickSession = sessionmaker(bind=_quick_engine, expire_on_commit=False)


def init_db() -> None:
    from . import models_knowledge  # noqa: F401  (register the knowledge tables)
    from backend.handover import connectors, session, teams  # noqa: F401  (register the handover tables)
    from backend.onboarding import assistant  # noqa: F401  (setup conversation)

    if not _is_sqlite:
        # Postgres enforces VARCHAR(n); the app's limits are UI hints, so store text without a hard cap.
        from sqlalchemy import String

        for table in Base.metadata.tables.values():
            for col in table.columns:
                if isinstance(col.type, String) and getattr(col.type, "length", None):
                    col.type.length = None
    Base.metadata.create_all(engine)
    _add_missing_columns()
    if not _is_sqlite:
        _lock_down()


def _lock_down() -> None:
    """Supabase exposes the public schema through its REST API. Row-level security with no policies means the API
    (anon / authenticated keys) can read nothing; the engine connects as the database owner and is unaffected."""
    from sqlalchemy import text

    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            conn.execute(text(f'ALTER TABLE "{table.name}" ENABLE ROW LEVEL SECURITY'))


def _add_missing_columns() -> None:
    """Tiny forward-only migration: add columns introduced after a database was created."""
    from sqlalchemy import inspect, text

    insp = inspect(engine)
    for table in Base.metadata.sorted_tables:
        if not insp.has_table(table.name):
            continue
        have = {c["name"] for c in insp.get_columns(table.name)}
        for col in table.columns:
            if col.name in have:
                continue
            ddl = col.type.compile(engine.dialect)
            default = col.default.arg if col.default is not None and not callable(col.default.arg) else None
            if isinstance(default, bool):
                dflt = f" DEFAULT {'true' if default else 'false'}" if not _is_sqlite else f" DEFAULT {int(default)}"
            elif isinstance(default, (int, float)):
                dflt = f" DEFAULT {default}"
            elif isinstance(default, str):
                dflt = " DEFAULT '" + default.replace("'", "''") + "'"
            else:
                dflt = ""
            with engine.begin() as conn:
                conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {ddl}{dflt}'))


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def session_scope() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
