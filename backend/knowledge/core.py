"""Shared helpers: serialization, proof chips, coverage, employee summaries."""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.db.models import Clone
from backend.db.models_knowledge import Card, InterviewV2, QuestionV2, SourceConsent, SourceItem

KIND_TO_SOURCE = {"mail": "email", "chat": "chat", "file": "file"}
COLORS = ["#7A1F2B", "#9E3B47", "#5B2333", "#B5545F", "#3F1A22", "#8C4A55"]


def iso(d) -> str | None:
    if d is None:
        return None
    return d.isoformat() if isinstance(d, (date, datetime)) else str(d)


def chip_for_item(item: SourceItem, quote: str = "") -> dict:
    when = item.sent_at.strftime("%b %d, %Y") if item.sent_at else ""
    if item.kind == "mail":
        label = f"Email · {item.author.split()[0] if item.author else 'mail'} · {when}"
    elif item.kind == "chat" and (item.meta or {}).get("system") == "github":
        label = f"{(item.meta or {}).get('channel_name') or item.title} · {when}"
    elif item.kind == "chat":
        label = f"Teams · {(item.meta or {}).get('channel_name') or item.title} · {when}"
    else:
        label = f"File · {item.title}"
    return {"kind": KIND_TO_SOURCE[item.kind], "ref": str(item.id), "label": label, "quote": quote[:240],
            "title": item.title[:160]}


def card_dict(c: Card) -> dict:
    return {"id": c.id, "type": c.type, "title": c.title, "body": c.body, "steps": c.steps or [],
            "project": c.project or None, "area": c.area or None, "sources": c.sources or [],
            "confidence": round(float(c.confidence or 0), 2), "status": c.status, "owner": c.clone_id,
            "related_people": c.related_people or [], "related_projects": c.related_projects or [],
            "origin": c.origin, "created_at": iso(c.created_at), "updated_at": iso(c.updated_at)}


# ---------------------------------------------------------------- coverage
def coverage(db: Session, eid: int) -> int:
    """How much of the role is captured well enough to hand over (0–100).

    Each card counts by how well it is backed (verified in interview = 1, otherwise 0.45 + 0.4·confidence);
    each open gap counts as 3 missing cards. No cards → 0."""
    clone = db.get(Clone, eid)
    override = (clone.settings or {}).get("coverage_override") if clone else None
    if override is not None:
        return int(override)
    cards = db.execute(select(Card.status, Card.confidence).where(Card.clone_id == eid)).all()
    if not cards:
        return 0
    have = sum(1.0 if s == "verified_in_interview" else (0.2 if s == "contradicted" else 0.45 + 0.4 * (c or 0.5))
               for s, c in cards)
    open_gaps = open_gap_count(db, eid)
    return max(0, min(100, round(100 * have / (len(cards) + 3 * open_gaps))))


def open_gap_count(db: Session, eid: int) -> int:
    iv = latest_interview(db, eid)
    if iv is None:
        return 0
    return db.scalar(select(func.count()).select_from(QuestionV2).where(
        QuestionV2.interview_id == iv.id, QuestionV2.kind == "gap", QuestionV2.status == "open")) or 0


def latest_interview(db: Session, eid: int) -> InterviewV2 | None:
    return db.scalar(select(InterviewV2).where(InterviewV2.clone_id == eid).order_by(InterviewV2.id.desc()).limit(1))


# ---------------------------------------------------------------- employees
def _count(db, *conds) -> int:
    return db.scalar(select(func.count()).select_from(SourceItem).where(*conds)) or 0


def employee_status(db: Session, c: Clone) -> str:
    st = (c.settings or {}).get("v2_status")
    if st:
        return st
    if db.scalar(select(func.count()).select_from(Card).where(Card.clone_id == c.id)):
        return "read"
    return "not_started"


def set_status(c: Clone, status: str) -> None:
    s = dict(c.settings or {})
    s["v2_status"] = status
    c.settings = s


def employee_dict(db: Session, c: Clone) -> dict:
    s = c.settings or {}
    profile = s.get("profile") or {}
    cards_n = db.scalar(select(func.count()).select_from(Card).where(Card.clone_id == c.id)) or 0
    verified = db.scalar(select(func.count()).select_from(Card).where(
        Card.clone_id == c.id, Card.status == "verified_in_interview")) or 0
    counts = {
        "emails": _count(db, SourceItem.clone_id == c.id, SourceItem.kind == "mail"),
        "chats": _count(db, SourceItem.clone_id == c.id, SourceItem.kind == "chat"),
        "files": _count(db, SourceItem.clone_id == c.id, SourceItem.kind == "file"),
        "screen": db.scalar(select(func.count()).select_from(Card).where(Card.clone_id == c.id, Card.origin == "screen")) or 0,
        "floor": db.scalar(select(func.count()).select_from(Card).where(Card.clone_id == c.id, Card.origin == "floor")) or 0,
        "cards": cards_n, "verified_cards": verified, "gaps_open": open_gap_count(db, c.id),
    }
    return {"id": c.id, "name": c.expert_name, "title": c.title, "team": c.department,
            "years": c.years_at_company, "started_on": profile.get("started_on") or s.get("started_on"),
            "leaving_on": iso(c.leaving_on), "avatar_color": COLORS[c.id % len(COLORS)],
            "coverage": coverage(db, c.id), "status": employee_status(db, c), "counts": counts}


def source_cards(db: Session, eid: int) -> list[dict]:
    consents = {s.kind: s for s in db.scalars(select(SourceConsent).where(SourceConsent.clone_id == eid))}
    out = []
    spec = [("email", "Email", "mail"), ("chat", "Chat", "chat"), ("files", "Files", "file"),
            ("screen", "Screen share", None), ("floor", "Floor walk", None)]
    for kind, label, item_kind in spec:
        c = consents.get(kind)
        if item_kind:
            n = _count(db, SourceItem.clone_id == eid, SourceItem.kind == item_kind)
            ex = _count(db, SourceItem.clone_id == eid, SourceItem.kind == item_kind, SourceItem.excluded.is_(True))
            col = SourceItem.container if item_kind == "file" else SourceItem.thread_key
            threads = db.scalar(select(func.count(func.distinct(col))).where(
                SourceItem.clone_id == eid, SourceItem.kind == item_kind)) or 0
            counts = {"items": n, "threads": threads, "excluded": ex}
            connected = n > 0
        else:
            origin = "screen" if kind == "screen" else "floor"
            n = db.scalar(select(func.count()).select_from(Card).where(Card.clone_id == eid, Card.origin == origin)) or 0
            counts = {"items": n, "excluded": 0}
            connected = bool(c and c.consent)
        out.append({"kind": kind, "label": label, "connected": connected, "consent": bool(c and c.consent),
                    "counts": counts, "connected_at": iso(c.connected_at) if c else None,
                    "provider": c.provider if c else None})
    return out
