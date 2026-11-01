"""One data directory and the offline model for the whole test run (settings are created once per process)."""
import os
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="cf_tests_"))
os.environ["LLM_PROVIDER"] = "mock"
os.environ.pop("DATABASE_URL", None)
for _k in ("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "MS_CLIENT_ID", "MS_CLIENT_SECRET", "GITHUB_CLIENT_ID",
           "GITHUB_CLIENT_SECRET"):
    os.environ[_k] = ""  # tests never depend on a developer's .env.local connector keys

FIXTURES = Path(__file__).parent / "fixtures"


def load_fixture_sources(eid: int) -> dict:
    """Stand-in for a finished Microsoft 365 import: a work mailbox (with a few personal emails), Teams chats and
    project documents, loaded the same way the connectors store them."""
    from datetime import datetime

    from sqlalchemy import select

    from backend.db.models_knowledge import SourceConsent
    from backend.db.store import SessionLocal
    from backend.knowledge import sources as SRC

    n = {}
    with SessionLocal() as db:
        n["emails"] = SRC.load_mbox(db, eid, FIXTURES / "mailbox.mbox")
        n["chats"] = SRC.load_teams_json(db, eid, FIXTURES / "teams_export.json")
        docs = FIXTURES / "docs"
        if not docs.exists():
            docs.mkdir()
            for f in FIXTURES.glob("*.md"):
                (docs / f.name).write_text(f.read_text())
        n["files"] = SRC.load_folder(db, eid, docs)
        for kind in ("email", "chat", "files"):
            c = db.scalar(select(SourceConsent).where(SourceConsent.clone_id == eid, SourceConsent.kind == kind))
            if c is None:
                c = SourceConsent(clone_id=eid, kind=kind)
                db.add(c)
            c.consent, c.provider, c.connected_at = True, "Microsoft 365", datetime.utcnow()
        db.commit()
    return n
