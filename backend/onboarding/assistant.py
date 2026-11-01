"""The setup assistant: a short conversation with the admin right after the organization is created.

It learns what the organization does, why it wants Clone Flow, which knowledge it fears losing, the tools people use
and who is leaving soon — and turns that into the organization's profile (which personalizes the console and every
AI step) and into invitations. One small model call per turn; the first greeting costs nothing.
Later, the same assistant is how an admin adds people by chat ("Add Dana Ruiz, dana@acme.com, leaves Dec 12").
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime

from sqlalchemy import JSON, DateTime, ForeignKey, String, Text, select
from sqlalchemy.orm import Mapped, mapped_column

from backend.db.models import Base, Org, User, utcnow
from backend.db.store import SessionLocal
from backend.knowledge import ai, core
from . import people as PEOPLE

log = logging.getLogger("cloneflow.setup")

PROFILE_KEYS = ("summary", "industry", "why", "critical_areas", "teams", "tools", "vocabulary")
LIST_KEYS = ("critical_areas", "teams", "tools", "vocabulary")


class SetupMsg(Base):
    __tablename__ = "setup_msgs"
    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("orgs.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(10))  # assistant | user
    text: Mapped[str] = mapped_column(Text, default="")
    payload: Mapped[dict | None] = mapped_column(JSON)
    at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


SYSTEM = """You are Clone Flow's setup assistant, talking with the admin who just created their organization's account.
Clone Flow interviews employees who are leaving, reads their work email and chats (personal mail is set aside), and
keeps what they know in a knowledge base that colleagues can ask, also in Microsoft Teams.

In a short, warm conversation, learn, in this order:
1. what the organization does (products or services, for whom)
2. why they want Clone Flow: which knowledge they are afraid of losing
3. which teams or roles hold the most know-how that isn't written down
4. which tools their people work in (Microsoft 365 / Outlook / Teams, Google Workspace / Gmail, GitHub, others)
5. whether someone is leaving soon. If yes, collect name, work email, role and last day (and anything specific to
   capture) and return them in "people" so they get an invitation. Use the email address the admin gives exactly
   as given (any domain is fine; don't question it). Return a person only once, and only with an email.

Rules: ask ONE question per reply, 1–3 short sentences, plain words, no flattery, no bullet lists. Use what they
said; never invent facts. If they already answered something, don't ask it again. "profile" is the FULL current
profile (merge what you knew with what they just said; summary = 1–2 sentences in your words; lists = short phrases;
vocabulary = their own names for products, lines, systems). Set done=true once 1–4 are known and they have answered
5 (or said nobody is leaving yet / they'll invite later); then the reply tells them their console is ready and what
it will focus on. After done, keep helping: add people they mention, update the profile, answer briefly."""

SCHEMA = {
    "type": "object",
    "properties": {
        "reply": {"type": "string"},
        "profile": {"type": "object", "properties": {
            "summary": {"type": "string"}, "industry": {"type": "string"}, "why": {"type": "string"},
            "critical_areas": {"type": "array", "items": {"type": "string"}},
            "teams": {"type": "array", "items": {"type": "string"}},
            "tools": {"type": "array", "items": {"type": "string"}},
            "vocabulary": {"type": "array", "items": {"type": "string"}}}},
        "people": {"type": "array", "items": {"type": "object", "properties": {
            "name": {"type": "string"}, "email": {"type": "string"}, "title": {"type": "string"},
            "leaving_on": {"type": "string"}, "focus": {"type": "string"}}, "required": ["name", "email"]}},
        "done": {"type": "boolean"},
    },
    "required": ["reply", "profile", "people", "done"],
}


def _first(name: str) -> str:
    return (name or "there").split()[0]


def _msg(m: SetupMsg) -> dict:
    return {"id": m.id, "role": m.role, "text": m.text, "payload": m.payload, "at": core.iso(m.at)}


def _say(db, org_id: int, text: str, role: str = "assistant", payload: dict | None = None) -> SetupMsg:
    m = SetupMsg(org_id=org_id, role=role, text=text, payload=payload)
    db.add(m)
    db.flush()
    return m


def state(user: User) -> dict:
    """The conversation so far (starts it with a free greeting) and the profile being built."""
    with SessionLocal() as db:
        org = db.get(Org, user.org_id)
        msgs = db.scalars(select(SetupMsg).where(SetupMsg.org_id == org.id).order_by(SetupMsg.id)).all()
        if not msgs:
            _say(db, org.id, f"Hi {_first(user.name)}! I'm Clone Flow. Let's set up {org.name} together — it takes "
                             f"about two minutes, and I'll shape your console around what you tell me.")
            _say(db, org.id, f"To start: what does {org.name} do? What do you make or provide, and for whom?")
            db.commit()
            msgs = db.scalars(select(SetupMsg).where(SetupMsg.org_id == org.id).order_by(SetupMsg.id)).all()
        prof = org.profile or {}
        return {"org": org.name, "done": bool(prof.get("done")), "profile": {k: prof.get(k) for k in PROFILE_KEYS},
                "messages": [_msg(m) for m in msgs], "plan": _plan(db, org),
                "ai_ready": ai.ai_ready()}


def _plan(db, org: Org) -> dict:
    from backend.app.plans import plan_of

    p = plan_of(org)
    used = PEOPLE.leaving_count(db, org.id)
    return {**p, "used": used, "left": max(p["employees"] - used, 0)}


def _merge(old: dict, new: dict) -> dict:
    out = dict(old)
    for k in PROFILE_KEYS:
        v = (new or {}).get(k)
        if k in LIST_KEYS:
            # The model returns the FULL current profile, so its lists replace the old ones (corrections can remove).
            if isinstance(v, list) and v:
                seen, merged = set(), []
                for x in (str(i).strip() for i in v):
                    if x and x.lower() not in seen:
                        seen.add(x.lower())
                        merged.append(x[:80])
                out[k] = merged[:12]
        elif isinstance(v, str) and v.strip():
            out[k] = v.strip()[:600]
    return out


def message(user: User, text: str) -> dict:
    """One turn: the admin's words → the assistant's reply, profile update, and any invitations."""
    text = (text or "").strip()[:3000]
    with SessionLocal() as db:
        org = db.get(Org, user.org_id)
        org_id = org.id
        before = db.scalar(select(SetupMsg.id).where(SetupMsg.org_id == org_id).order_by(SetupMsg.id.desc()).limit(1)) or 0
        _say(db, org_id, text, role="user")
        db.commit()
        history = db.scalars(select(SetupMsg).where(SetupMsg.org_id == org_id).order_by(SetupMsg.id.desc()).limit(14)).all()
        convo = "\n".join(f"{'Admin' if m.role == 'user' else 'You'}: {m.text}" for m in reversed(history) if m.text)
        prof = dict(org.profile or {})
        known = {k: prof.get(k) for k in PROFILE_KEYS if prof.get(k)}
        org_name = org.name
        people_now = PEOPLE.people_in(db, org_id)
    user_prompt = (f"Organization: {org_name}\nAdmin: {user.name}\nToday: {date.today().isoformat()}\n"
                   f"Already set up before this turn: {bool(prof.get('done'))}\n"
                   f"Current profile: {json.dumps(known)}\n"
                   f"Already invited (don't return them in people unless the admin changes their details): "
                   f"{json.dumps(people_now) if people_now else 'nobody yet'}\n\nConversation so far:\n{convo}")
    out = ai.call_json("setup", None, SYSTEM, user_prompt, SCHEMA, "SetupTurn", org_id=org_id)
    invites, problems = [], []
    with SessionLocal() as db:
        org = db.get(Org, org_id)
        admin = db.get(User, user.id)
        merged = _merge(prof, out.get("profile") or {})
        if out.get("done") or prof.get("done"):
            merged["done"] = True
        org.profile = merged
        db.commit()
        for p in (out.get("people") or [])[:10]:
            if PEOPLE.update_existing(db, org, p):  # already invited: details updated, no second invitation
                continue
            try:
                r = PEOPLE.invite(db, org, admin, p)
                invites.append({"name": r["employee"]["name"], "email": p.get("email", "").lower(), "link": r["link"],
                                "eid": r["employee"]["id"], "emailed": r.get("emailed", False)})
            except PEOPLE.InviteError as exc:
                problems.append(str(exc))
        reply = (out.get("reply") or "Got it.").strip()
        if invites:
            names = ", ".join(i["name"] for i in invites)
            sent = all(i["emailed"] for i in invites)
            _say(db, org_id, f"I created {'an invitation' if len(invites) == 1 else 'invitations'} for {names}. "
                             + ("I emailed it; the link below works too." if sent else
                                "Send the link however you like; it opens their private handover conversation."),
                 payload={"invites": invites})
        for prob in problems:
            _say(db, org_id, prob, payload={"problem": True})
        _say(db, org_id, reply, payload={"done": bool(merged.get("done"))})
        db.commit()
        new = db.scalars(select(SetupMsg).where(SetupMsg.org_id == org_id, SetupMsg.id > before).order_by(SetupMsg.id)).all()
        return {"messages": [_msg(m) for m in new], "done": bool(merged.get("done")),
                "profile": {k: merged.get(k) for k in PROFILE_KEYS}, "plan": _plan(db, org)}


def finish(user: User, skipped: bool = False) -> dict:
    """'Go to my console' (or 'Skip for now'): the console opens either way; the assistant stays available."""
    with SessionLocal() as db:
        org = db.get(Org, user.org_id)
        prof = dict(org.profile or {})
        prof["done"] = True
        if skipped and not prof.get("summary"):
            prof["skipped"] = True
        org.profile = prof
        db.commit()
    return {"ok": True}
