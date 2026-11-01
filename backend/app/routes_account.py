"""Accounts: system status, organization sign-up, sign-in, invitations (join), current user, media, server voice."""
from __future__ import annotations

import os
import re

from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select

from backend.db.models import Clone, Invite, Org, User
from backend.db.store import get_db
from .auth import (Ctx, check_password, clear_session, current, get_clone, hash_password, require_ai, set_session,
                   validate_new_account)
from .config import settings
from .flags import FEATURE_FLAGS
from .plans import PLANS, plan_of

router = APIRouter(prefix="/api")


def user_dict(u: User) -> dict:
    return {"id": u.id, "name": u.name, "email": u.email, "role": u.role,
            "initials": "".join(p[0] for p in u.name.split()[:2]).upper()}


def _downloads() -> dict:
    """Desktop app installers (set DOWNLOAD_MAC_URL / DOWNLOAD_WINDOWS_URL once a release is published)."""
    mac, win = os.environ.get("DOWNLOAD_MAC_URL") or None, os.environ.get("DOWNLOAD_WINDOWS_URL") or None
    return {"mac": mac, "windows": win, "coming_soon": [k for k, v in (("mac", mac), ("windows", win)) if not v]}


# ------------------------------------------------------------------ system
@router.get("/system/status")
def system_status():
    return {"ai_enabled": settings.ai_enabled, "llm_provider": settings.llm_provider,
            "model": settings.chat_model if settings.llm_provider != "mock" else "mock",
            "tts_provider": settings.tts_provider, "version": "1.0.0", "product": True,
            "flags": FEATURE_FLAGS, "plans": list(PLANS.values()), "download": _downloads(),
            "desktop_mode": False}


# ------------------------------------------------------------------ auth
class SignupIn(BaseModel):
    org_name: str
    name: str
    email: str
    password: str


class LoginIn(BaseModel):
    email: str
    password: str


class JoinIn(BaseModel):
    invite_code: str
    name: str
    email: str
    password: str


def _slug(db, name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "org"
    slug, i = base, 1
    while db.scalar(select(Org).where(Org.slug == slug)):
        i += 1
        slug = f"{base}-{i}"
    return slug


def me_payload(db, user: User) -> dict:
    org = db.get(Org, user.org_id)
    owned = [c for (c,) in db.execute(select(Clone.id).where(Clone.owner_user_id == user.id))]
    return {"user": user_dict(user), "org": {"id": org.id, "name": org.name, "slug": org.slug, "plan": plan_of(org),
                                             "set_up": bool((org.profile or {}).get("done")),
                                             "created_at": org.created_at.isoformat()},
            "owned_clone_ids": owned, "is_admin": user.role == "admin", "home": _home(db, user, owned)}


def _home(db, user: User, owned: list[int]) -> str:
    """The person leaving lands in their conversation; a company admin lands in the console."""
    if user.role == "admin":  # the organization is run from the console (setup conversation first)
        org = db.get(Org, user.org_id)
        return "/admin" if (org.profile or {}).get("done") else "/setup"
    if owned:
        return "/session"
    return "/ask"  # a colleague: they ask the knowledge base


@router.post("/auth/signup")
def signup(body: SignupIn, response: Response, db=Depends(get_db)):
    email = body.email.strip().lower()
    validate_new_account(email, body.password, body.name)
    if not body.org_name.strip():
        raise HTTPException(400, "Enter your organization's name.")
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, "An account with this email already exists. Sign in instead.")
    org = Org(name=body.org_name.strip()[:200], slug=_slug(db, body.org_name))
    db.add(org)
    db.flush()
    user = User(org_id=org.id, name=body.name.strip()[:200], email=email, password_hash=hash_password(body.password),
                role="admin")
    db.add(user)
    db.flush()
    db.commit()
    set_session(response, user)
    return me_payload(db, user)


@router.post("/auth/login")
def login(body: LoginIn, response: Response, db=Depends(get_db)):
    user = db.scalar(select(User).where(User.email == body.email.strip().lower()))
    if not user or not check_password(body.password, user.password_hash):
        raise HTTPException(401, "That email and password don't match.")
    set_session(response, user)
    return me_payload(db, user)


@router.post("/auth/join")
def join(body: JoinIn, response: Response, db=Depends(get_db)):
    inv = db.scalar(select(Invite).where(Invite.code == body.invite_code.strip()))
    if not inv or inv.accepted:
        raise HTTPException(404, "This invite link is invalid or was already used.")
    email = body.email.strip().lower()
    validate_new_account(email, body.password, body.name)
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, "An account with this email already exists. Sign in instead.")
    user = User(org_id=inv.org_id, name=body.name.strip()[:200], email=email,
                password_hash=hash_password(body.password), role=inv.role)
    db.add(user)
    inv.accepted = True
    db.flush()
    # A clone created for this person's email becomes theirs.
    for c in db.scalars(select(Clone).where(Clone.org_id == inv.org_id, Clone.owner_user_id.is_(None))):
        if (c.settings or {}).get("owner_email") == email:
            c.owner_user_id = user.id
    db.commit()
    set_session(response, user)
    return me_payload(db, user)


@router.get("/auth/invite/{code}")
def invite_info(code: str, db=Depends(get_db)):
    inv = db.scalar(select(Invite).where(Invite.code == code))
    if not inv or inv.accepted:
        raise HTTPException(404, "This invite link is invalid or was already used.")
    org = db.get(Org, inv.org_id)
    clone = next((c for c in db.scalars(select(Clone).where(Clone.org_id == org.id, Clone.owner_user_id.is_(None)))
                  if (c.settings or {}).get("owner_email") == inv.email), None)
    inviter = db.get(User, inv.created_by) if inv.created_by else None
    return {"org_name": org.name, "email": inv.email, "role": inv.role, "name": clone.expert_name if clone else "",
            "title": clone.title if clone else "", "leaving_on": clone.leaving_on.isoformat() if clone and clone.leaving_on else None,
            "inviter": inviter.name if inviter else None}


class LookupIn(BaseModel):
    email: str


@router.post("/auth/lookup")
def lookup(body: LookupIn, db=Depends(get_db)):
    """Sign-in step 1: which organization this work email belongs to (no organization directory)."""
    from backend.handover import connectors as CN

    user = db.scalar(select(User).where(User.email == body.email.strip().lower()))
    org = db.get(Org, user.org_id) if user else None
    return {"found": bool(user), "org_name": org.name if org else None, "microsoft": bool(user) and CN.configured("microsoft"),
            "org_slug": org.slug if org else None}


@router.post("/auth/logout")
def logout(response: Response):
    clear_session(response)
    return {"ok": True}


@router.get("/auth/me")
def me(ctx: Ctx = Depends(current)):
    return me_payload(ctx.db, ctx.user)


@router.post("/voice/transcribe")
async def transcribe(audio: UploadFile = File(...), ctx: Ctx = Depends(current)):
    """Speech to text for the Ask box (counts toward the organization's AI allowance)."""
    from backend.knowledge import ai
    from backend.media.audio import bytes_to_wav

    require_ai()
    data = await audio.read()
    if not data:
        raise HTTPException(400, "The recording was empty.")
    try:
        wav, secs = bytes_to_wav(data, settings.data_dir / "work" / "voice", Path(audio.filename or "a.webm").suffix or ".webm")
    except ValueError:
        raise HTTPException(400, "That audio format couldn't be read.")
    if secs > 300:
        raise HTTPException(400, "Please keep a question under 5 minutes.")
    ai.check_org(org_id=ctx.org.id)
    return {"text": ai.transcribe(None, wav, secs, org_id=ctx.org.id)}


class SpeakIn(BaseModel):
    text: str


@router.post("/voice/speak")
def speak(body: SpeakIn, ctx: Ctx = Depends(current)):
    from backend.media.tts import synthesize

    audio, mime = synthesize(body.text[:4000])
    if audio is None:
        raise HTTPException(501, "Server voice is not configured; the browser voice is used.")
    return Response(content=audio, media_type=mime)


# ------------------------------------------------------------------ media
@router.get("/media/{path:path}")
def media(path: str, ctx: Ctx = Depends(current)):
    base = (settings.data_dir / "media").resolve()
    full = (base / path).resolve()
    if base not in full.parents or not full.is_file():
        raise HTTPException(404, "Not found.")
    m = re.match(r"clone_(\d+)/", path)
    if not m:
        raise HTTPException(404, "Not found.")
    get_clone(ctx, int(m.group(1)))
    return FileResponse(full, headers={"Cache-Control": "private, max-age=3600"})
