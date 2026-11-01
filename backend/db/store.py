"""Engine and session helpers. SQLite by default (one file the owner can export or
delete); any SQLAlchemy URL works, e.g. Postgres for a hosted deployment."""
from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from backend.app.config import settings
from .models import Base

_is_sqlite = settings.database_url.startswith("sqlite")
engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False, "timeout": 30} if _is_sqlite else {},
    pool_pre_ping=True,
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
    settings.database_url,
    connect_args={"check_same_thread": False, "timeout": 0.3} if _is_sqlite else {},
    pool_pre_ping=True,
) if _is_sqlite else engine
QuickSession = sessionmaker(bind=_quick_engine, expire_on_commit=False)


def init_db() -> None:
    from . import models_knowledge  # noqa: F401  (register the knowledge tables)
    from backend.handover import connectors, session, teams  # noqa: F401  (register the handover tables)
    from backend.onboarding import assistant  # noqa: F401  (setup conversation)

    Base.metadata.create_all(engine)
    _add_missing_columns()


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
            dflt = f" DEFAULT '{default}'" if isinstance(default, str) else (f" DEFAULT {int(default)}" if isinstance(default, (bool, int)) else "")
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
