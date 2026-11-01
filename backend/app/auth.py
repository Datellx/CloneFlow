"""Password hashing, signed session cookies, and request dependencies."""
from __future__ import annotations

import re
import time
from dataclasses import dataclass

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from backend.db.models import Clone, Org, User
from backend.db.store import get_db
from .config import settings

COOKIE = "cf_session"
TTL = 60 * 60 * 24 * 14
EMAIL_OK = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode()[:72], bcrypt.gensalt(rounds=12)).decode()


def check_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode()[:72], hashed.encode())
    except ValueError:
        return False


def validate_new_account(email: str, password: str, name: str) -> None:
    if not EMAIL_OK.match(email or ""):
        raise HTTPException(400, "Enter a valid email address.")
    if len(password or "") < 8:
        raise HTTPException(400, "Use a password of at least 8 characters.")
    if not (name or "").strip():
        raise HTTPException(400, "Enter your name.")


def set_session(resp: Response, user: User) -> None:
    token = jwt.encode({"sub": str(user.id), "org": user.org_id, "exp": int(time.time()) + TTL},
                       settings.secret_key, algorithm="HS256")
    resp.set_cookie(COOKIE, token, max_age=TTL, httponly=True, samesite="lax", secure=settings.cookie_secure,
                    path="/")


def clear_session(resp: Response) -> None:
    resp.delete_cookie(COOKIE, path="/")


@dataclass
class Ctx:
    user: User
    org: Org
    db: Session

    @property
    def is_admin(self) -> bool:
        return self.user.role == "admin"

    @property
    def actor(self) -> str:
        return self.user.name


UPLOAD_PATHS = ("/api/me/session/upload", "/api/me/session/screen")
UPLOAD_TTL = 30 * 60


def upload_token(user: User) -> str:
    """Short-lived token for large uploads sent straight to the engine (the website's proxy caps request size)."""
    return jwt.encode({"sub": str(user.id), "kind": "upload", "exp": int(time.time()) + UPLOAD_TTL},
                      settings.secret_key, algorithm="HS256")


def current(request: Request, db: Session = Depends(get_db)) -> Ctx:
    token = request.cookies.get(COOKIE)
    upload = request.headers.get("x-cf-upload")
    if not token and upload and request.method == "POST" and request.url.path in UPLOAD_PATHS:
        try:
            data = jwt.decode(upload, settings.secret_key, algorithms=["HS256"])
        except jwt.PyJWTError:
            raise HTTPException(401, "This upload link expired. Please try again.")
        if data.get("kind") != "upload":
            raise HTTPException(401, "Please sign in.")
        token = None
    elif not token:
        raise HTTPException(401, "Please sign in.")
    else:
        try:
            data = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
        except jwt.PyJWTError:
            raise HTTPException(401, "Your session expired. Please sign in again.")
        if data.get("kind") == "upload":
            raise HTTPException(401, "Please sign in.")
    user = db.get(User, int(data["sub"]))
    if user is None:
        raise HTTPException(401, "Please sign in.")
    org = db.get(Org, user.org_id)
    return Ctx(user=user, org=org, db=db)


def require_admin(ctx: Ctx = Depends(current)) -> Ctx:
    if not ctx.is_admin:
        raise HTTPException(403, "Only organization admins can do this.")
    return ctx


def get_clone(ctx: Ctx, clone_id: int) -> Clone:
    clone = ctx.db.get(Clone, clone_id)
    if clone is None or clone.org_id != ctx.org.id:
        raise HTTPException(404, "Clone not found.")
    return clone


def is_owner(ctx: Ctx, clone: Clone) -> bool:
    return clone.owner_user_id == ctx.user.id


def require_owner(ctx: Ctx, clone: Clone) -> None:
    if not is_owner(ctx, clone):
        first = clone.expert_name.split()[0]
        raise HTTPException(403, f"Only {first}, the owner of this clone, can change it.")


def require_ai() -> None:
    """Every action that calls the model checks this first, so nothing is spent while AI is off."""
    if not settings.ai_enabled:
        raise HTTPException(409, "AI is turned off, so this step can't run. Please try again later.")
    if settings.llm_provider == "meta" and not settings.model_api_key:
        raise HTTPException(409, "The AI engine is not configured on this server yet.")
