"""The website's contact form: every message is stored, and emailed to the team when SMTP is configured
(SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM; CONTACT_TO, default hello@datellx.com)."""
from __future__ import annotations

import logging
import os
import smtplib
import time
from collections import defaultdict, deque
from email.message import EmailMessage

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from backend.db.models import ContactMessage
from backend.db.store import get_db
from .auth import EMAIL_OK

router = APIRouter(prefix="/api")
log = logging.getLogger("cloneflow.contact")
CONTACT_TO = os.environ.get("CONTACT_TO", "hello@datellx.com")
TOPICS = {"demo": "Book a demo", "pricing": "Plans and pricing", "security": "Security and IT", "support": "Support",
          "other": "Something else"}
_HITS: dict[str, deque] = defaultdict(deque)


class ContactIn(BaseModel):
    name: str
    email: str
    company: str = ""
    topic: str = "demo"
    message: str
    website: str = ""  # left empty by people; filled by bots


def _too_many(ip: str, n: int = 5, per_s: int = 3600) -> bool:
    q, now = _HITS[ip], time.time()
    while q and now - q[0] > per_s:
        q.popleft()
    if len(q) >= n:
        return True
    q.append(now)
    return False


def _send(m: ContactMessage) -> bool:
    host = os.environ.get("SMTP_HOST", "").strip()
    if not host:
        return False
    msg = EmailMessage()
    msg["Subject"] = f"Clone Flow · {TOPICS.get(m.topic, 'Contact')} · {m.name}" + (f" ({m.company})" if m.company else "")
    msg["From"] = os.environ.get("SMTP_FROM") or os.environ.get("SMTP_USER") or CONTACT_TO
    msg["To"] = CONTACT_TO
    msg["Reply-To"] = m.email
    msg.set_content(f"{m.message}\n\n— {m.name}, {m.email}" + (f", {m.company}" if m.company else ""))
    try:
        with smtplib.SMTP(host, int(os.environ.get("SMTP_PORT", "587")), timeout=20) as s:
            s.starttls()
            if os.environ.get("SMTP_USER"):
                s.login(os.environ["SMTP_USER"], os.environ.get("SMTP_PASSWORD", ""))
            s.send_message(msg)
        return True
    except Exception as exc:  # the message is stored either way
        log.warning("contact email failed: %s", exc)
        return False


@router.post("/contact")
def contact(body: ContactIn, request: Request, db=Depends(get_db)):
    name, email, msg = body.name.strip(), body.email.strip().lower(), body.message.strip()
    if not name or not EMAIL_OK.match(email):
        raise HTTPException(400, "Enter your name and a valid email address.")
    if len(msg) < 5:
        raise HTTPException(400, "Write a short message so we know how to help.")
    if body.website.strip():  # a bot: answer as if all went well
        return {"ok": True}
    ip = (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "?")).split(",")[0].strip()
    if _too_many(ip):
        raise HTTPException(429, f"Thanks — we already have your messages. You can also write to {CONTACT_TO}.")
    m = ContactMessage(name=name[:200], email=email[:320], company=body.company.strip()[:200],
                       topic=body.topic if body.topic in TOPICS else "other", message=msg[:5000])
    db.add(m)
    db.commit()
    m.emailed = _send(m)
    db.commit()
    return {"ok": True}
