"""Two one-click doors for hackathon judges (and anyone evaluating Clone Flow), no account needed:

- Judge tour: the real Northwind Robotics workspace, view-only. Maya Lee's finished handover — knowledge map, every
  card with its proof, the SAM 3.1 calibration video, the successor briefing — and live Ask, the engine that answers
  in Teams. Nothing can be changed (see auth.JUDGE_CAN_POST) and invitation links are hidden.
- Try it yourself: a fresh, private demo workspace in which the visitor is the person leaving, straight into the
  interview: talk or type, share the screen, upload a video. Each workspace has its own small AI allowance.
"""
from __future__ import annotations

import os
import secrets
import time
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import select

from backend.db.models import Clone, Org, User
from backend.db.store import get_db
from .auth import set_session
from .routes_account import _slug

router = APIRouter(prefix="/api/demo", tags=["demo"])

TOUR_ORG = os.environ.get("DEMO_TOUR_ORG", "northwind-robotics")
TOUR_EMAIL = "judge-tour@demo.cloneflow.app"
TRY_CAP_USD = float(os.environ.get("DEMO_TRY_CAP_USD", "1.5"))
_HITS: dict[str, deque] = defaultdict(deque)


def _enabled() -> None:
    if os.environ.get("DEMO_DOORS", "1").lower() in ("0", "false", "no"):
        raise HTTPException(404, "The demo is not available.")


def _limit(request: Request, key: str, n: int, per_s: int = 3600) -> None:
    ip = (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "?")).split(",")[0].strip()
    q, now = _HITS[f"{key}:{ip}"], time.time()
    while q and now - q[0] > per_s:
        q.popleft()
    if len(q) >= n:
        raise HTTPException(429, "Too many demo workspaces from this network. Please try again in a little while.")
    q.append(now)


@router.get("/info")
def info(db=Depends(get_db)):
    org = db.scalar(select(Org).where(Org.slug == TOUR_ORG))
    return {"tour": org is not None, "tour_org": org.name if org else None, "try": True}


@router.post("/tour")
def tour(request: Request, response: Response, db=Depends(get_db)):
    """Sign in to the Northwind Robotics workspace as a view-only judge."""
    _enabled()
    _limit(request, "tour", 60)
    org = db.scalar(select(Org).where(Org.slug == TOUR_ORG))
    if org is None:
        raise HTTPException(404, "The tour workspace isn't available right now.")
    user = db.scalar(select(User).where(User.email == TOUR_EMAIL))
    if user is None:
        user = User(org_id=org.id, name="Hackathon judge", email=TOUR_EMAIL, role="judge")
        db.add(user)
        db.commit()
    elif user.org_id != org.id or user.role != "judge":
        user.org_id, user.role = org.id, "judge"
        db.commit()
    set_session(response, user)
    first = db.scalar(select(Clone.id).where(Clone.org_id == org.id).order_by(Clone.id))
    return {"next": f"/admin/people/{first}" if first else "/admin"}


class TryIn(BaseModel):
    name: str = ""
    role: str = ""


@router.post("/try")
def try_it(body: TryIn, request: Request, response: Response, db=Depends(get_db)):
    """A fresh private workspace where the visitor is the one leaving; lands in their interview."""
    _enabled()
    _limit(request, "try", 15)
    name = (body.name or "").strip()[:60] or "Guest"
    org = Org(name="Demo Company", slug=_slug(db, f"demo-{secrets.token_hex(3)}"), is_demo=True,
              profile={"done": True, "ai_cap_usd": TRY_CAP_USD,
                       "summary": "A demo workspace. The person being interviewed is trying Clone Flow on their own job, "
                                  "whatever it is (office, lab or factory floor)."})
    db.add(org)
    db.flush()
    user = User(org_id=org.id, name=name, email=f"guest-{secrets.token_hex(6)}@demo.cloneflow.app", role="admin")
    db.add(user)
    db.flush()
    db.add(Clone(org_id=org.id, owner_user_id=user.id, expert_name=name, title=(body.role or "").strip()[:200],
                 status="capturing", settings={"owner_email": user.email}))
    db.commit()
    set_session(response, user)
    return {"next": "/session"}
