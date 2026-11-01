"""Handover API (docs/API.md): the departing employee's conversation, source connections, the admin console, Teams."""
from __future__ import annotations

import uuid
from datetime import date
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import func, select

from backend.db.models import Clone, Invite, User
from backend.db.store import get_db
from backend.db.models_knowledge import AskV2
from backend.knowledge import core
from backend.handover import connectors as CN, session as S
from .auth import Ctx, current, require_ai
from .config import settings
from .plans import plan_of
from .routes_knowledge import READ_ONLY, writable

router = APIRouter(prefix="/api")


def _own(ctx: Ctx) -> Clone:
    c = S.own_clone(ctx.db, ctx.user)
    if c is None:
        raise HTTPException(409, "Start the conversation first.")
    return c


def _session(ctx: Ctx) -> dict:
    ctx.db.expire_all()
    return S.session_dict(ctx.db, ctx.user, S.own_clone(ctx.db, ctx.user))


def _reply(ctx: Ctx, ids: list[int] | None = None) -> dict:
    sess = _session(ctx)
    new = [m for m in sess["messages"] if ids is None or m["id"] in ids]
    return {"messages": new, "session": sess}


# ------------------------------------------------------------------ session
@router.get("/me/session")
def get_session(ctx: Ctx = Depends(current)):
    return _session(ctx)


@router.post("/me/session/start")
def start_session(ctx: Ctx = Depends(current)):
    writable()
    S.start(ctx.user)
    return _session(ctx)


@router.post("/me/session/message")
async def session_message(request: Request, ctx: Ctx = Depends(current)):
    writable()
    _own(ctx)
    text, mode = "", "text"
    if request.headers.get("content-type", "").startswith("application/json"):
        body = await request.json()
        text, mode = str(body.get("text", "")), str(body.get("mode", "text"))
    else:
        form = await request.form()
        text, mode = str(form.get("text") or ""), str(form.get("mode") or "")
        audio = form.get("audio")
        if not text.strip() and audio is not None and hasattr(audio, "read"):
            require_ai()
            from backend.knowledge import ai
            from backend.media import audio as va

            data = await audio.read()
            wav, secs = va.bytes_to_wav(data, settings.data_dir / "uploads" / "answers",
                                        Path(getattr(audio, "filename", "") or "a.webm").suffix or ".webm")
            text = ai.transcribe(_own(ctx).id, wav, secs)
            mode = "voice"
        mode = mode or "voice"
    if not text.strip():
        raise HTTPException(400, "I didn't catch that. Try again or type it.")
    stage = S._state(_own(ctx)).get("stage")
    if stage in ("intro", "interview", "open", "done") and not (stage == "intro" and len(S._state(_own(ctx)).get("intro_answers", [])) == 0):
        require_ai()
    try:
        ids = S.message(ctx.user, text[:4000], mode)
    except S.ai.TrialLimit:
        raise
    except S.ai.LLMError as exc:
        raise HTTPException(503, f"The AI didn't answer: {exc}") from exc
    return _reply(ctx, ids)


def _since(ctx: Ctx) -> int:
    c = S.own_clone(ctx.db, ctx.user)
    return ctx.db.scalar(select(func.max(S.SessionMsg.id)).where(S.SessionMsg.clone_id == c.id)) or 0 if c else 0


def _new_since(ctx: Ctx, before: int) -> dict:
    sess = _session(ctx)
    return {"messages": [m for m in sess["messages"] if m["id"] > before], "session": sess}


@router.post("/me/session/skip")
def session_skip(ctx: Ctx = Depends(current)):
    writable()
    before = _since(ctx)
    S.skip(ctx.user)
    return _new_since(ctx, before)


@router.post("/me/session/read")
def session_read(ctx: Ctx = Depends(current)):
    writable()
    _own(ctx)
    before = _since(ctx)
    try:
        S.start_reading(ctx.user)
    except PermissionError as exc:
        raise HTTPException(409, str(exc)) from exc
    return _new_since(ctx, before)


@router.post("/me/session/finish")
def session_finish(ctx: Ctx = Depends(current)):
    writable()
    _own(ctx)
    before = _since(ctx)
    S.finish(ctx.user)
    return _new_since(ctx, before)


@router.post("/me/session/upload")
async def session_upload(files: list[UploadFile] = File(...), note: str = Form(""), ctx: Ctx = Depends(current)):
    writable()
    _own(ctx)
    payload = []
    for f in files:
        data = await f.read()
        if len(data) > 500 * 1024 * 1024:
            raise HTTPException(413, f"{f.filename} is larger than 500 MB.")
        payload.append((Path(f.filename or "upload").name, data))
    before = _since(ctx)
    try:
        S.upload(ctx.user, payload, note)
    except S.ai.TrialLimit:
        raise
    except S.ai.LLMError as exc:
        raise HTTPException(503, f"The AI didn't answer: {exc}") from exc
    return _new_since(ctx, before)


@router.post("/me/session/screen")
async def session_screen(video: UploadFile = File(...), narration: str = Form(""), ctx: Ctx = Depends(current)):
    writable()
    require_ai()
    c = _own(ctx)
    d = S.IV.media_dir(c.id, "screen_uploads")
    path = d / f"{uuid.uuid4().hex}{Path(video.filename or 'v.webm').suffix or '.webm'}"
    path.write_bytes(await video.read())
    before = _since(ctx)
    S.screen(ctx.user, path, narration)
    return _new_since(ctx, before)


@router.post("/me/session/walk")
def session_walk(ctx: Ctx = Depends(current)):
    writable()
    _own(ctx)
    try:
        return S.walk(ctx.user)
    except PermissionError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.get("/me/session/walk/feed")
def session_walk_feed(after: int = 0, ctx: Ctx = Depends(current)):
    c = _own(ctx)
    iv = core.latest_interview(ctx.db, c.id)
    if iv is None:
        return {"items": [], "done": False}
    from backend.knowledge import walk as W

    return W.feed(iv.id, after)


# ------------------------------------------------------------------ connections
@router.get("/connect/providers")
def connect_providers(ctx: Ctx = Depends(current)):
    c = S.own_clone(ctx.db, ctx.user)
    return S.providers(c.id) if c else []


@router.get("/connect/{provider}/start")
def connect_start(provider: str, seed: bool = False, ctx: Ctx = Depends(current)):
    if provider not in CN.PROVIDERS:
        raise HTTPException(404, "Unknown provider.")
    if not CN.configured(provider):
        raise HTTPException(409, f"{CN.PROVIDERS[provider]['label']} isn't set up on this server yet.")
    if seed:  # setup tool: copy a mailbox folder (SEED_MAILBOX_DIR) into a TEST Gmail account (admin only)
        import os

        if not ctx.is_admin or provider != "google" or not os.environ.get("SEED_MAILBOX_DIR"):
            raise HTTPException(403, "Seeding a test account isn't enabled on this server.")
        c = S.own_clone(ctx.db, ctx.user) or ctx.db.scalar(select(Clone).where(Clone.org_id == ctx.org.id))
        return RedirectResponse(CN.auth_url(provider, c.id if c else 0, seed=True), status_code=302)
    c = _own(ctx)
    return RedirectResponse(CN.auth_url(provider, c.id), status_code=302)


@router.get("/connect/{provider}/callback")
def connect_callback(provider: str, code: str = "", state: str = "", error: str = "", error_description: str = ""):
    from urllib.parse import quote

    key = "gmail" if provider == "google" else provider
    if error or not code:
        S.log.warning("connect %s refused: %s %s", provider, error, error_description[:300])
        why = quote((error_description or error or "cancelled").split("\r")[0][:160])
        return RedirectResponse(f"/session?connect_error={key}&why={why}", status_code=302)
    try:
        st = CN.read_state_full(state, provider)
        if st.get("login"):
            try:
                return _microsoft_login(st, code)
            except Exception:
                S.log.exception("microsoft sign-in failed")
                return RedirectResponse("/login?error=microsoft", status_code=302)
        eid = int(st["eid"])
        tok = CN.exchange(provider, code)
        if st.get("seed"):
            import os
            import threading

            folder = Path(os.environ["SEED_MAILBOX_DIR"])
            threading.Thread(target=lambda: S.log.info("gmail seed: %s", CN.seed_gmail(tok, folder)),
                             daemon=True).start()
            return RedirectResponse("/admin?seeding=gmail", status_code=302)
        CN.save_token(eid, provider, tok)
        CN.start_import(eid, provider)
    except Exception as exc:
        S.log.exception("connect callback failed")
        detail = getattr(getattr(exc, "response", None), "text", "") or str(exc)
        return RedirectResponse(f"/session?connect_error={key}&why={quote(detail[:160])}", status_code=302)
    return RedirectResponse(f"/session?connected={key}", status_code=302)


def _microsoft_login(st: dict, code: str):
    """Match the Microsoft account to a Clone Flow account in that organization (by email, then by mailbox name)."""
    from backend.db.models import Org, User
    from backend.db.store import SessionLocal

    from .auth import set_session
    from .routes_account import me_payload

    who = CN.exchange_login(code)
    with SessionLocal() as db:
        org = db.get(Org, int(st["org"]))
        users = list(db.scalars(select(User).where(User.org_id == org.id)))
        local = who["email"].split("@")[0].replace(".", "")
        user = next((u for u in users if u.email == who["email"]), None) or next(
            (u for u in users if u.email.split("@")[0].replace(".", "") == local), None) or next(
            (u for u in users if who["name"] and u.name.lower() == who["name"].lower()), None)
        if user is None:
            return RedirectResponse("/login?error=no_account", status_code=302)
        resp = RedirectResponse(me_payload(db, user)["home"], status_code=302)
        set_session(resp, user)
        return resp


@router.get("/ask/targets")
def ask_targets(ctx: Ctx = Depends(current)):
    """Whose knowledge packs exist (names only) — for colleagues picking who to ask."""
    rows = ctx.db.scalars(select(Clone).where(Clone.org_id == ctx.org.id).order_by(Clone.expert_name)).all()
    return [{"eid": c.id, "name": c.expert_name, "title": c.title, "status": core.employee_status(ctx.db, c),
             "leaving_on": core.iso(c.leaving_on), "has_briefing": bool((c.settings or {}).get("briefing")),
             "avatar_color": core.COLORS[c.id % len(core.COLORS)]} for c in rows]


# ------------------------------------------------------------------ admin console
def _admin(ctx: Ctx) -> None:
    if not ctx.is_admin:
        raise HTTPException(403, "Only the company admin can see this.")


@router.get("/admin/overview")
def admin_overview(ctx: Ctx = Depends(current)):
    _admin(ctx)
    clones = ctx.db.scalars(select(Clone).where(Clone.org_id == ctx.org.id).order_by(
        Clone.leaving_on.is_(None), Clone.leaving_on)).all()
    ids = [c.id for c in clones] or [-1]
    invites = ctx.db.scalars(select(Invite).where(Invite.org_id == ctx.org.id, Invite.accepted.is_(False))).all()
    unanswered = []
    for c in clones:
        unanswered += [{"eid": c.id, "name": c.expert_name, "question": q} for q in (c.settings or {}).get("unanswered", [])]
    asks = ctx.db.scalar(select(func.count()).select_from(AskV2).where(AskV2.clone_id.in_(ids))) or 0
    plan = plan_of(ctx.org)
    leaving = _leaving_count(ctx)
    return {"org": {"id": ctx.org.id, "name": ctx.org.name, "profile": ctx.org.profile or {}},
            "plan": {**plan, "used": leaving, "left": max(plan["employees"] - leaving, 0)},
            "people": [core.employee_dict(ctx.db, c) for c in clones],
            "invites": [_invite_row(ctx, i, clones) for i in invites],
            "ai_allowance": S.ai.org_budget(ctx.org.id),
            "asks": asks, "unanswered": unanswered[-20:]}


def _invite_row(ctx: Ctx, i, clones) -> dict:
    c = next((c for c in clones if (c.settings or {}).get("owner_email") == i.email), None)
    return {"id": i.id, "email": i.email, "name": c.expert_name if c else (i.name or i.email), "eid": c.id if c else None,
            "kind": "handover" if c else (i.kind or "colleague"),
            "accepted": i.accepted, "link": f"{settings.public_url.rstrip('/')}/join/{i.code}",
            "created_at": core.iso(i.created_at)}


def _leaving_count(ctx: Ctx) -> int:
    from backend.onboarding.people import leaving_count

    return leaving_count(ctx.db, ctx.org.id)


class InviteIn(BaseModel):
    name: str
    email: str
    title: str = ""
    team: str = ""
    leaving_on: date | None = None
    focus: str = ""  # what the admin wants captured from this person


@router.post("/admin/invite")
def admin_invite(body: InviteIn, ctx: Ctx = Depends(current)):
    from backend.onboarding.people import InviteError, invite

    _admin(ctx)
    writable()
    try:
        return invite(ctx.db, ctx.org, ctx.user, body.model_dump())
    except InviteError as exc:
        raise HTTPException(exc.status, str(exc)) from exc


class ColleagueIn(BaseModel):
    name: str
    email: str


@router.post("/admin/colleagues")
def admin_invite_colleague(body: ColleagueIn, ctx: Ctx = Depends(current)):
    """Invite a colleague who stays: they can ask the knowledge base on the web (Teams needs no invitation)."""
    from backend.onboarding.people import InviteError, invite_colleague

    _admin(ctx)
    writable()
    try:
        return invite_colleague(ctx.db, ctx.org, ctx.user, body.model_dump())
    except InviteError as exc:
        raise HTTPException(exc.status, str(exc)) from exc


@router.get("/admin/colleagues")
def admin_colleagues(ctx: Ctx = Depends(current)):
    """Everyone who can ask (colleagues who joined), for the console."""
    _admin(ctx)
    owners = {c.owner_user_id for c in ctx.db.scalars(select(Clone).where(Clone.org_id == ctx.org.id))}
    rows = ctx.db.scalars(select(User).where(User.org_id == ctx.org.id, User.role != "admin")).all()
    return [{"id": u.id, "name": u.name, "email": u.email} for u in rows if u.id not in owners]


@router.post("/admin/invites/{invite_id}/resend")
def admin_invite_resend(invite_id: int, ctx: Ctx = Depends(current)):
    """Send the invitation email again (with the current site address)."""
    from backend.app import supabase

    _admin(ctx)
    inv = ctx.db.get(Invite, invite_id)
    if inv is None or inv.org_id != ctx.org.id or inv.accepted:
        raise HTTPException(404, "This invitation is no longer open.")
    link = f"{settings.public_url.rstrip('/')}/join/{inv.code}"
    sent = supabase.send_invite(inv.email, link, {"invite_code": inv.code, "org_name": ctx.org.name,
                                                  "invited_by": ctx.user.name}) \
        or supabase.send_sign_in_link(inv.email, link)
    return {"emailed": sent, "link": link}


_ = READ_ONLY


@router.get("/auth/microsoft/start")
def auth_microsoft_start(email: str = "", next: str = "", db=Depends(get_db)):
    """'Continue with Microsoft' on the sign-in page: the email tells us which organization."""
    user = db.scalar(select(User).where(User.email == email.strip().lower())) if email else None
    if user is None or not CN.configured("microsoft"):
        return RedirectResponse("/login?error=microsoft", status_code=302)
    return RedirectResponse(CN.login_url(user.org_id), status_code=302)


# ------------------------------------------------------------------ Microsoft Teams (outgoing webhook)
from fastapi.responses import FileResponse, JSONResponse  # noqa: E402

from backend.handover import teams as TM  # noqa: E402


@router.get("/admin/teams")
def admin_teams(ctx: Ctx = Depends(current)):
    _admin(ctx)
    return {"webhook_url": TM.webhook_url(ctx.org), "configured": TM.configured(ctx.org.id), "bot_name": "Clone Flow",
            "public": not settings.public_url.startswith("http://localhost")}


class TeamsSecretIn(BaseModel):
    secret: str


@router.post("/admin/teams")
def admin_teams_save(body: TeamsSecretIn, ctx: Ctx = Depends(current)):
    _admin(ctx)
    import base64 as _b64

    try:
        _b64.b64decode(body.secret.strip(), validate=True)
    except Exception as exc:
        raise HTTPException(400, "That doesn't look like a Teams security token — copy it again from Teams.") from exc
    TM.save_secret(ctx.org.id, body.secret)
    return admin_teams(ctx)


@router.post("/teams/webhook/{slug}")
async def teams_webhook(slug: str, request: Request):
    from backend.db.models import Org
    from backend.db.store import SessionLocal

    raw = await request.body()
    with SessionLocal() as db:
        org = db.scalar(select(Org).where(Org.slug == slug))
    if org is None or not TM.verify(org.id, request.headers.get("authorization", ""), raw):
        return JSONResponse({"type": "message", "text": "This Clone Flow connection isn't set up correctly."}, status_code=401)
    import json as _json

    activity = _json.loads(raw or b"{}")
    import anyio

    reply = await anyio.to_thread.run_sync(TM.answer, org.id, TM.question_from(activity))
    return JSONResponse(reply)


@router.get("/public/media/{tok}")
def public_media(tok: str):
    try:
        rel = TM.read_signed(tok)
    except Exception as exc:
        raise HTTPException(404, "This link has expired.") from exc
    base = (settings.data_dir / "media").resolve()
    full = (base / rel).resolve()
    if base not in full.parents or not full.is_file():
        raise HTTPException(404, "Not found.")
    return FileResponse(full, headers={"Cache-Control": "public, max-age=86400"})


# ------------------------------------------------------------------ what was kept private (the employee's own view)
@router.get("/me/session/privacy")
def session_privacy(ctx: Ctx = Depends(current)):
    """Only for the person themself: what the code set aside before any AI read anything, and why."""
    from backend.db.models_knowledge import SourceItem

    c = _own(ctx)
    rows = ctx.db.execute(select(SourceItem.noise_reason, SourceItem.kind, func.count())
                          .where(SourceItem.clone_id == c.id, SourceItem.is_noise.is_(True))
                          .group_by(SourceItem.noise_reason, SourceItem.kind)).all()
    groups: dict[str, dict] = {}
    for reason, kind, n in rows:
        g = groups.setdefault(reason or "Other", {"reason": reason or "Other", "count": 0, "kinds": {}})
        g["count"] += n
        g["kinds"][kind] = g["kinds"].get(kind, 0) + n
    examples: dict[str, list] = {}
    for reason in groups:
        its = ctx.db.scalars(select(SourceItem).where(SourceItem.clone_id == c.id, SourceItem.noise_reason == reason)
                             .order_by(SourceItem.sent_at.desc()).limit(5)).all()
        examples[reason] = [{"kind": i.kind, "from": i.author, "title": i.title if i.kind == "mail" else "",
                             "at": core.iso(i.sent_at)} for i in its]
    kept = ctx.db.scalar(select(func.count()).select_from(SourceItem).where(
        SourceItem.clone_id == c.id, SourceItem.is_noise.is_(False), SourceItem.excluded.is_(False))) or 0
    excluded = ctx.db.scalar(select(func.count()).select_from(SourceItem).where(
        SourceItem.clone_id == c.id, SourceItem.excluded.is_(True))) or 0
    order = ["Personal", "Newsletter", "Notification", "Calendar traffic", "Auto-reply", "Company announcement",
             "Short acknowledgement", "Automatic message", "Newsletter or receipt"]
    out = sorted(groups.values(), key=lambda g: (order.index(g["reason"]) if g["reason"] in order else 99, -g["count"]))
    for g in out:
        g["examples"] = examples.get(g["reason"], [])
    return {"kept_for_ai": kept, "excluded_by_you": excluded, "set_aside": out,
            "note": "Set aside by code before any AI saw anything. Personal items are never sent to the AI or shown to your company."}


# ------------------------------------------------------------------ large uploads (web)
@router.get("/me/upload-token")
def me_upload_token(ctx: Ctx = Depends(current)):
    """Videos and screen recordings can be larger than the website proxy allows, so the browser may send them
    straight to the engine (UPLOAD_BASE_URL) with this short-lived token. Without UPLOAD_BASE_URL, upload as usual."""
    import os

    from .auth import upload_token

    base = os.environ.get("UPLOAD_BASE_URL", "").strip().rstrip("/") or None
    return {"token": upload_token(ctx.user) if base else None, "base": base}
