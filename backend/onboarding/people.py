"""Inviting departing employees: shared by the invite form and the setup assistant. Enforces the plan limit."""
from __future__ import annotations

import secrets
from datetime import date

from sqlalchemy import select

from backend.app.config import settings
from backend.app.plans import plan_of
from backend.db.models import Clone, Invite, Org, User
from backend.knowledge import core


class InviteError(ValueError):
    def __init__(self, msg: str, status: int = 400) -> None:
        super().__init__(msg)
        self.status = status


def leaving_count(db, org_id: int) -> int:
    """Departing employees on the plan: every handover in the organization except the admins' own."""
    admins = {u for (u,) in db.execute(select(User.id).where(User.org_id == org_id, User.role == "admin"))}
    return sum(1 for c in db.scalars(select(Clone).where(Clone.org_id == org_id))
               if c.owner_user_id is None or c.owner_user_id not in admins)


def _date(v) -> date | None:
    if isinstance(v, date) or v is None:
        return v
    try:
        return date.fromisoformat(str(v)[:10]) if str(v).strip() else None
    except ValueError:
        return None


def invite(db, org: Org, by: User, p: dict) -> dict:
    """p: {name, email, title?, team?, leaving_on?, focus?} → {employee, link}."""
    email = str(p.get("email") or "").strip().lower()
    name = str(p.get("name") or "").strip()
    if "@" not in email or "." not in email.split("@")[-1] or not name:
        raise InviteError("Enter the person's name and work email.")
    if db.scalar(select(User).where(User.email == email)) or any(
            (c.settings or {}).get("owner_email") == email for c in db.scalars(select(Clone).where(Clone.org_id == org.id))):
        raise InviteError(f"{email} already has an invitation or an account.", 409)
    plan = plan_of(org)
    if leaving_count(db, org.id) >= plan["employees"]:
        raise InviteError(f"The {plan['name']} plan includes {plan['employees']} departing employees. "
                          "Contact us at hello@datellx.com to move to a bigger plan.", 402)
    st = {"owner_email": email}
    focus = str(p.get("focus") or "").strip()
    if focus:
        st["focus"], st["focus_by"] = focus[:600], by.name
    c = Clone(org_id=org.id, owner_user_id=None, expert_name=name[:200], title=str(p.get("title") or "").strip()[:200],
              department=str(p.get("team") or "").strip()[:200], leaving_on=_date(p.get("leaving_on")),
              status="capturing", settings=st)
    db.add(c)
    inv = Invite(org_id=org.id, email=email, role="member", name=name[:200], kind="handover",
                 code=secrets.token_urlsafe(18), created_by=by.id)
    db.add(inv)
    db.commit()
    link = f"{settings.public_url.rstrip('/')}/join/{inv.code}"
    from backend.app import supabase

    emailed = supabase.send_invite(email, link, {"invite_code": inv.code, "name": c.expert_name, "org_name": org.name,
                                                 "invited_by": by.name})
    return {"employee": core.employee_dict(db, c), "link": link, "emailed": emailed}


def invite_colleague(db, org: Org, by: User, p: dict) -> dict:
    """A colleague who stays: they sign in to ask the knowledge base (no handover, not counted on the plan)."""
    email = str(p.get("email") or "").strip().lower()
    name = str(p.get("name") or "").strip()
    if "@" not in email or "." not in email.split("@")[-1] or not name:
        raise InviteError("Enter the person's name and work email.")
    if db.scalar(select(User).where(User.email == email)) or db.scalar(
            select(Invite).where(Invite.email == email, Invite.org_id == org.id, Invite.accepted.is_(False))):
        raise InviteError(f"{email} already has an invitation or an account.", 409)
    inv = Invite(org_id=org.id, email=email, role="member", name=name[:200], kind="colleague",
                 code=secrets.token_urlsafe(18), created_by=by.id)
    db.add(inv)
    db.commit()
    link = f"{settings.public_url.rstrip('/')}/join/{inv.code}"
    from backend.app import supabase

    emailed = supabase.send_invite(email, link, {"invite_code": inv.code, "name": name, "org_name": org.name,
                                                 "invited_by": by.name})
    return {"id": inv.id, "name": name, "email": email, "link": link, "emailed": emailed}


def people_in(db, org_id: int) -> list[dict]:
    """Everyone already invited to a handover in this organization (for the setup assistant's context)."""
    return [{"name": c.expert_name, "email": (c.settings or {}).get("owner_email"), "title": c.title,
             "leaving_on": c.leaving_on.isoformat() if c.leaving_on else None}
            for c in db.scalars(select(Clone).where(Clone.org_id == org_id)) if (c.settings or {}).get("owner_email")]


def update_existing(db, org: Org, p: dict) -> bool:
    """If this person already has a handover here, update their title / last day / focus instead of inviting again."""
    email = str(p.get("email") or "").strip().lower()
    c = next((c for c in db.scalars(select(Clone).where(Clone.org_id == org.id))
              if (c.settings or {}).get("owner_email") == email), None)
    if c is None:
        return False
    if str(p.get("title") or "").strip():
        c.title = str(p["title"]).strip()[:200]
    if _date(p.get("leaving_on")):
        c.leaving_on = _date(p.get("leaving_on"))
    if str(p.get("focus") or "").strip():
        st = dict(c.settings or {})
        st["focus"] = str(p["focus"]).strip()[:600]
        c.settings = st
    db.commit()
    return True
