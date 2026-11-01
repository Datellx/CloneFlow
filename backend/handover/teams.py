"""Ask Clone Flow inside Microsoft Teams: an outgoing webhook ("@Clone Flow where are the spare servo horns?").

Teams POSTs the message (HMAC-signed with the token shown when the webhook was created) and waits ≤ 5 s for the reply.
We answer from every captured knowledge pack in the organization: local retrieval first (free), one small model call
when there is time, otherwise the best verified card itself. Images (floor-walk / screen frames) are served through
short-lived signed links so Teams can display them.
"""
from __future__ import annotations

import base64
import concurrent.futures as cf
import hashlib
import hmac
import re
import time

import jwt
from sqlalchemy import ForeignKey, String, Text, select
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.config import settings
from backend.db.models import Base, Org
from backend.db.store import SessionLocal

_POOL = cf.ThreadPoolExecutor(max_workers=4)
REPLY_BUDGET_S = 4.0


class TeamsHook(Base):
    __tablename__ = "teams_hooks"
    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("orgs.id", ondelete="CASCADE"), unique=True)
    secret: Mapped[str] = mapped_column(Text)          # encrypted
    name: Mapped[str] = mapped_column(String(100), default="Clone Flow")


def save_secret(org_id: int, secret: str) -> None:
    from .connectors import _seal

    with SessionLocal() as db:
        row = db.scalar(select(TeamsHook).where(TeamsHook.org_id == org_id))
        if row is None:
            row = TeamsHook(org_id=org_id, secret="")
            db.add(row)
        row.secret = _seal({"s": secret.strip()})
        db.commit()


def configured(org_id: int) -> bool:
    with SessionLocal() as db:
        return db.scalar(select(TeamsHook).where(TeamsHook.org_id == org_id)) is not None


def verify(org_id: int, auth_header: str, body: bytes) -> bool:
    from .connectors import _open

    with SessionLocal() as db:
        row = db.scalar(select(TeamsHook).where(TeamsHook.org_id == org_id))
        if row is None:
            return False
        secret = _open(row.secret)["s"]
    try:
        key = base64.b64decode(secret)
    except Exception:
        return False
    want = base64.b64encode(hmac.new(key, body, hashlib.sha256).digest()).decode()
    got = (auth_header or "").removeprefix("HMAC ").strip()
    return hmac.compare_digest(want, got)


def question_from(activity: dict) -> str:
    text = activity.get("text") or ""
    text = re.sub(r"(?is)<at>.*?</at>", " ", text)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def signed_media(path: str, minutes: int = 60 * 24 * 7) -> str:
    """A public, expiring link to one media file (for images inside Teams)."""
    tok = jwt.encode({"p": path, "exp": int(time.time()) + minutes * 60}, settings.secret_key, algorithm="HS256")
    return f"{settings.public_url.rstrip('/')}/api/public/media/{tok}"


def read_signed(tok: str) -> str:
    return jwt.decode(tok, settings.secret_key, algorithms=["HS256"])["p"]


def answer(org_id: int, question: str) -> dict:
    from backend.knowledge import ask as ASK

    if not question:
        return {"type": "message", "text": "Ask me anything your colleagues knew — for example "
                                           "*where are the spare servo horns?*"}
    from backend.knowledge import ai as _ai
    fut = _POOL.submit(ASK.ask_org, org_id, question, None, not _ai.org_budget(org_id)["reached"])
    try:
        res = fut.result(timeout=REPLY_BUDGET_S)
    except cf.TimeoutError:  # the model is still composing: answer from the best card now (free); cached for next time
        res = ASK.ask_org(org_id, question, None, allow_ai=False)
    return to_teams(res)


def to_teams(res: dict) -> dict:
    who = res.get("from_name") or ""
    if not res.get("known"):
        ap = res.get("ask_person") or {}
        tip = f" Try asking **{ap['name']}** ({ap.get('why', '')})." if ap.get("name") else ""
        return {"type": "message", "text": f"I don't know — no one covered this in what they left behind, so I won't guess.{tip}"}
    head = f"**From {who}'s knowledge**" + (" · ✅ verified in their exit interview" if res.get("verified") else "")
    lines = [head, "", res.get("answer", "")]
    if res.get("steps"):
        lines += [""] + [f"{i}. {s}" for i, s in enumerate(res["steps"], 1)]
    proofs = [p.get("label", "") for p in (res.get("proofs") or [])[:4] if p.get("label")]
    if proofs:
        lines += ["", "_Proof: " + " · ".join(proofs) + "_"]
    msg: dict = {"type": "message", "text": "\n".join(lines)}
    imgs = []
    for url in (res.get("images") or [])[:3]:
        if url.startswith("/api/media/"):
            imgs.append({"url": signed_media(url.removeprefix("/api/media/"))})
    if imgs:
        msg["attachments"] = [{"contentType": "application/vnd.microsoft.card.hero", "content": {"images": imgs}}]
    return msg


def webhook_url(org: Org) -> str:
    return f"{settings.public_url.rstrip('/')}/api/teams/webhook/{org.slug}"
