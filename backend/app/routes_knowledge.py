"""Knowledge API (docs/API.md): people and their knowledge packs, source viewers, the phone floor walk, Ask, the map."""
from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import case, extract, func, or_, select

from backend.db.models import Clone
from backend.db.models_knowledge import (AskV2, Card, SourceItem)
from backend.knowledge import ask as ASK, core, mockai, walk as WALK
from .auth import Ctx, current, get_clone, require_ai

router = APIRouter(prefix="/api")
_ = mockai  # registers offline handlers
READ_ONLY = os.environ.get("READ_ONLY", "").lower() in ("1", "true", "yes")  # maintenance switch


def writable() -> None:
    if READ_ONLY:
        raise HTTPException(503, "Clone Flow is in read-only maintenance for a few minutes. You can still browse and ask.")


def _clone(ctx: Ctx, eid: int) -> Clone:
    """Owner or admin only: a person's sources, cards and interview are theirs (and the company admin's)."""
    c = get_clone(ctx, eid)
    if not ctx.is_admin and c.owner_user_id != ctx.user.id:
        raise HTTPException(403, "Only the person and the company admin can see this.")
    return c


def _org_clone(ctx: Ctx, eid: int) -> Clone:
    """Anyone in the organization (asking a knowledge pack, the takeover briefing)."""
    return get_clone(ctx, eid)


def _admin(ctx: Ctx) -> None:
    if not ctx.is_admin:
        raise HTTPException(403, "Only the company admin can see this.")


# ------------------------------------------------------------------ employees
@router.get("/employees")
def employees(ctx: Ctx = Depends(current)):
    cs = ctx.db.scalars(select(Clone).where(Clone.org_id == ctx.org.id).order_by(Clone.leaving_on.is_(None), Clone.leaving_on))
    return [core.employee_dict(ctx.db, c) for c in cs]


@router.get("/employees/{eid}")
def employee(eid: int, ctx: Ctx = Depends(current)):
    c = _org_clone(ctx, eid)
    out = core.employee_dict(ctx.db, c)
    s = c.settings or {}
    prof = dict(s.get("profile") or {})
    projects = []
    for name in (s.get("projects") or {}):
        n = ctx.db.scalar(select(func.count()).select_from(Card).where(Card.clone_id == eid, Card.project == name)) or 0
        first = ctx.db.scalar(select(func.min(SourceItem.sent_at)).where(
            SourceItem.clone_id == eid, or_(SourceItem.title.ilike(f"%{name}%"), SourceItem.clean.ilike(f"%{name}%"))))
        last = ctx.db.scalar(select(func.max(SourceItem.sent_at)).where(
            SourceItem.clone_id == eid, or_(SourceItem.title.ilike(f"%{name}%"), SourceItem.clean.ilike(f"%{name}%"))))
        years = f"{first.year}–{last.year}" if first and last and first.year != last.year else (str(first.year) if first else "")
        projects.append({"id": name, "name": name, "years": years, "cards": n,
                         "summary": (s.get("projects") or {}).get(name, "")})
    out["profile"] = {"started_on": prof.get("started_on") or s.get("started_on"), "roles": prof.get("roles", []),
                      "summary": prof.get("summary", ""), "projects": projects}
    out["timeline"] = _timeline(ctx.db, eid)
    return out


def _timeline(db, eid: int) -> list[dict]:
    """Year-by-year activity for the knowledge map / profile (free: counts only)."""
    yr = extract("year", SourceItem.sent_at)  # works on Postgres and SQLite
    rows = db.execute(select(yr, SourceItem.kind, func.count())
                      .where(SourceItem.clone_id == eid, SourceItem.sent_at.is_not(None))
                      .group_by(yr, SourceItem.kind)).all()
    years: dict[str, dict] = {}
    for y, k, n in rows:
        if y:
            y = str(int(y))
            years.setdefault(y, {"year": int(y), "mail": 0, "chat": 0, "file": 0})[k] = n
    return [years[y] for y in sorted(years)]


# ------------------------------------------------------------------ source viewers
def _mail_item(it: SourceItem) -> dict:
    snippet = " ".join((it.clean or it.body or "").split())[:160]
    return {"id": it.id, "thread_id": it.thread_key, "folder": it.container, "subject": it.title or "(no subject)",
            "from_name": it.author, "from_email": it.author_email, "to": it.recipients or [],
            "sent_at": core.iso(it.sent_at), "snippet": snippet, "unread": False, "excluded": it.excluded,
            "is_noise": it.is_noise, "noise_reason": it.noise_reason,
            "noise_tag": (it.noise_reason or "").lower().replace("newsletter or receipt", "newsletter") or None}


@router.get("/employees/{eid}/mail")
def mail(eid: int, folder: str = "", q: str = "", offset: int = 0, limit: int = 50, ctx: Ctx = Depends(current)):
    _clone(ctx, eid)
    base = [SourceItem.clone_id == eid, SourceItem.kind == "mail"]
    folders = [{"name": n, "count": c} for n, c in ctx.db.execute(
        select(SourceItem.container, func.count()).where(*base).group_by(SourceItem.container)
        .order_by(func.count().desc())).all()]
    conds = list(base)
    if folder:
        conds.append(SourceItem.container == folder)
    if q:
        like = f"%{q}%"
        conds.append(or_(SourceItem.title.ilike(like), SourceItem.body.ilike(like), SourceItem.author.ilike(like)))
    total = ctx.db.scalar(select(func.count()).select_from(SourceItem).where(*conds)) or 0
    items = ctx.db.scalars(select(SourceItem).where(*conds).order_by(SourceItem.sent_at.desc())
                           .offset(offset).limit(min(limit, 200))).all()
    return {"folders": folders, "total": total, "items": [_mail_item(i) for i in items]}


def _item(ctx: Ctx, iid: int, kind: str | None = None) -> SourceItem:
    it = ctx.db.get(SourceItem, iid)
    if it is None or (kind and it.kind != kind):
        raise HTTPException(404, "Not found.")
    _clone(ctx, it.clone_id)
    return it


@router.get("/mail/{iid}")
def mail_item(iid: int, ctx: Ctx = Depends(current)):
    it = _item(ctx, iid, "mail")
    thread = ctx.db.scalars(select(SourceItem).where(SourceItem.clone_id == it.clone_id, SourceItem.kind == "mail",
                                                     SourceItem.thread_key == it.thread_key)
                            .order_by(SourceItem.sent_at)).all()
    return {**_mail_item(it), "body_text": it.body,
            "thread": [{**_mail_item(t), "body_text": t.body} for t in thread]}


@router.get("/employees/{eid}/chat")
def chat(eid: int, ctx: Ctx = Depends(current)):
    _clone(ctx, eid)
    rows = ctx.db.execute(select(SourceItem.container, func.count(), func.max(SourceItem.meta))
                          .where(SourceItem.clone_id == eid, SourceItem.kind == "chat")
                          .group_by(SourceItem.container)).all()
    out = []
    for cid, n, _ in rows:
        sample = ctx.db.scalar(select(SourceItem).where(SourceItem.clone_id == eid, SourceItem.kind == "chat",
                                                        SourceItem.container == cid).limit(1))
        m = sample.meta or {}
        out.append({"id": cid, "name": m.get("channel_name") or sample.title, "kind": m.get("channel_kind", "channel"),
                    "members": m.get("members", []), "count": n, "employee_id": eid})
    out.sort(key=lambda c: (c["kind"] != "channel", c["name"].lower()))
    return {"channels": out}


@router.get("/employees/{eid}/chat/{cid}")
def chat_channel(eid: int, cid: str, offset: int = 0, limit: int = 300, ctx: Ctx = Depends(current)):
    _clone(ctx, eid)
    items = ctx.db.scalars(select(SourceItem).where(SourceItem.clone_id == eid, SourceItem.kind == "chat",
                                                    SourceItem.container == cid)
                           .order_by(SourceItem.sent_at).offset(offset).limit(min(limit, 1000))).all()
    replies: dict[str, int] = {}
    for i in items:
        replies[i.thread_key] = replies.get(i.thread_key, 0) + 1
    return {"items": [{"id": i.id, "channel_id": cid, "thread_id": i.thread_key, "author": i.author,
                       "sent_at": core.iso(i.sent_at), "text": i.body, "reactions": (i.meta or {}).get("reactions", []),
                       "reply_count": max(0, replies.get(i.thread_key, 1) - 1), "excluded": i.excluded,
                       "is_noise": i.is_noise} for i in items]}


@router.get("/chat/channels/{cid}")
def chat_channel_compat(cid: str, eid: int | None = None, offset: int = 0, limit: int = 300, ctx: Ctx = Depends(current)):
    if eid is None:
        it = ctx.db.scalar(select(SourceItem).join(Clone, Clone.id == SourceItem.clone_id)
                           .where(Clone.org_id == ctx.org.id, SourceItem.kind == "chat", SourceItem.container == cid).limit(1))
        if it is None:
            raise HTTPException(404, "Not found.")
        eid = it.clone_id
    return chat_channel(eid, cid, offset, limit, ctx)


def _file_node(it: SourceItem) -> dict:
    m = it.meta or {}
    return {"id": it.id, "name": it.title, "path": m.get("path", it.title), "kind": m.get("file_kind", "other"),
            "size": m.get("size", 0), "modified_at": core.iso(it.sent_at), "excluded": it.excluded}


@router.get("/employees/{eid}/files")
def files_tree(eid: int, ctx: Ctx = Depends(current)):
    _clone(ctx, eid)
    items = ctx.db.scalars(select(SourceItem).where(SourceItem.clone_id == eid, SourceItem.kind == "file")
                           .order_by(SourceItem.ext_id)).all()
    root: dict = {"children": {}}
    for it in items:
        parts = (it.meta or {}).get("path", it.title).split("/")
        node = root
        for i, p in enumerate(parts[:-1]):
            node = node["children"].setdefault(p, {"id": "/".join(parts[:i + 1]), "name": p,
                                                   "path": "/".join(parts[:i + 1]), "kind": "folder", "size": 0,
                                                   "modified_at": None, "children": {}})
        node["children"][parts[-1]] = _file_node(it)

    def flat(n):
        kids = []
        for v in n["children"].values():
            if v.get("kind") == "folder":
                v = {**v, "children": flat(v)}
            kids.append(v)
        kids.sort(key=lambda x: (x["kind"] != "folder", x["name"].lower()))
        return kids

    return {"tree": flat(root)}


@router.get("/files/{iid}")
def file_item(iid: int, ctx: Ctx = Depends(current)):
    it = _item(ctx, iid, "file")
    node = _file_node(it)
    m = it.meta or {}
    kind, url = m.get("file_kind"), m.get("url")
    if kind in ("image", "video", "pdf"):
        preview = {"type": "image" if kind == "image" else kind, "url": url, "text": it.body[:20000] if kind == "pdf" else None}
    elif kind == "sheet":
        import csv
        import io

        rows = list(csv.reader(io.StringIO(it.body[:200000])))[:200]
        preview = {"type": "table", "rows": rows}
    elif it.body:
        preview = {"type": "text", "text": it.body[:60000]}
    else:
        preview = {"type": "none", "url": url}
    return {**node, "preview": preview, "url": url}


class ExcludeIn(BaseModel):
    excluded: bool


@router.post("/items/{kind}/{iid}/exclude")
def exclude(kind: str, iid: int, body: ExcludeIn, ctx: Ctx = Depends(current)):
    writable()
    it = _item(ctx, iid, kind)
    if kind == "mail":  # excluding a message excludes its whole thread
        for t in ctx.db.scalars(select(SourceItem).where(SourceItem.clone_id == it.clone_id, SourceItem.kind == "mail",
                                                         SourceItem.thread_key == it.thread_key)):
            t.excluded = body.excluded
    else:
        it.excluded = body.excluded
    ctx.db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ cards
@router.get("/employees/{eid}/cards")
def cards(eid: int, type: str = "", project: str = "", status: str = "", q: str = "", ctx: Ctx = Depends(current)):
    _clone(ctx, eid)
    conds = [Card.clone_id == eid]
    if type:
        conds.append(Card.type == type)
    if project:
        conds.append(Card.project == project)
    if status:
        conds.append(Card.status == status)
    if q:
        conds.append(or_(Card.title.ilike(f"%{q}%"), Card.body.ilike(f"%{q}%")))
    rows = ctx.db.scalars(select(Card).where(*conds).order_by(Card.status != "verified_in_interview", Card.id)).all()
    return [core.card_dict(c) for c in rows]


# ------------------------------------------------------------------ floor walk
# ------------------------------------------------------------------ floor walk (phone page, link is the credential)
@router.get("/walk/{token}")
def walk_info(token: str):
    info = WALK.info(token)
    if info is None:
        raise HTTPException(404, "This walk link has expired. Scan the new code on the laptop.")
    return info


@router.post("/walk/{token}/frames")
async def walk_frame(token: str, frame: UploadFile = File(...), t: float = Form(0.0), transcript_chunk: str = Form("")):
    data = await frame.read()
    if len(data) > 8 * 1024 * 1024:
        raise HTTPException(413, "Frame too large.")
    try:
        return WALK.add_frame(token, data, t, transcript_chunk)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.post("/walk/{token}/audio")
async def walk_audio(token: str, audio: UploadFile = File(...)):
    require_ai()
    try:
        return WALK.add_audio(token, await audio.read(), Path(audio.filename or "a.webm").suffix or ".webm")
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.post("/walk/{token}/finish")
def walk_finish(token: str):
    require_ai()
    try:
        res = WALK.finish(token)
        from backend.handover import session as S

        S.on_walk_finished(token, res)
        return res
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc


# ------------------------------------------------------------------ ask
class AskIn(BaseModel):
    eid: int | None = None
    question: str
    mode: str = "question"


@router.post("/ask")
def ask(body: AskIn, ctx: Ctx = Depends(current)):
    if not body.question.strip():
        raise HTTPException(400, "Type a question.")
    from backend.knowledge import ai as _ai

    # past the organization's AI allowance, answers still come straight from the knowledge cards (free)
    allow = not _ai.org_budget(ctx.org.id)["reached"]
    if body.eid is None:  # ask everyone: route to the pack that knows best (free, local retrieval)
        out = ASK.ask_org(ctx.org.id, body.question.strip()[:1000], ctx.user.id, allow_ai=allow)
    else:
        _org_clone(ctx, body.eid)
        out = ASK.ask(body.eid, body.question.strip()[:1000], body.mode, ctx.user.id, allow_ai=allow)
    return {k: v for k, v in out.items() if k != "cost_usd"}


@router.get("/employees/{eid}/asks")
def asks(eid: int, ctx: Ctx = Depends(current)):
    c = _org_clone(ctx, eid)
    conds = [AskV2.clone_id == eid]
    if not ctx.is_admin and c.owner_user_id != ctx.user.id:
        conds.append(AskV2.user_id == ctx.user.id)
    rows = ctx.db.scalars(select(AskV2).where(*conds).order_by(AskV2.id.desc()).limit(100)).all()
    return [{**{k: v for k, v in (r.answer or {}).items() if k != "cost_usd"}, "id": r.id, "question": r.question,
             "at": core.iso(r.created_at)} for r in rows]


@router.get("/employees/{eid}/briefing")
def briefing(eid: int, ctx: Ctx = Depends(current)):
    c = _org_clone(ctx, eid)
    b = (c.settings or {}).get("briefing")
    if not b:
        raise HTTPException(404, "The takeover briefing is made when the interview is finished.")
    return b


# ------------------------------------------------------------------ knowledge map
@router.get("/map")
def knowledge_map(ctx: Ctx = Depends(current)):
    _admin(ctx)
    clones = ctx.db.scalars(select(Clone).where(Clone.org_id == ctx.org.id)).all()
    ids = [c.id for c in clones]
    rows = ctx.db.execute(select(Card.clone_id, Card.area, func.count(),
                                 func.sum(case((Card.status == "verified_in_interview", 1), else_=0)))
                          .where(Card.clone_id.in_(ids)).group_by(Card.clone_id, Card.area)).all() if ids else []
    area_tot: dict[str, int] = {}
    for _, a, n, _v in rows:
        area_tot[a or "General"] = area_tot.get(a or "General", 0) + n
    areas = [a for a, _ in sorted(area_tot.items(), key=lambda x: -x[1])][:10]
    holders: dict[str, set] = {}
    for eid, a, n, _v in rows:
        if n >= 2:
            holders.setdefault(a or "General", set()).add(eid)
    status = {c.id: core.employee_status(ctx.db, c) for c in clones}
    cells = []
    for eid, a, n, v in rows:
        a = a or "General"
        if a not in areas:
            continue
        sole = holders.get(a, set()) == {eid}
        cells.append({"eid": eid, "area": a, "cards": n, "verified": int(v or 0), "sole_holder": sole,
                      "captured": status[eid] == "captured" or (v or 0) >= max(1, n // 2)})
    leaving = {c.id: c for c in clones if c.leaving_on}
    at_risk = [{"area": cell["area"], "holder": leaving[cell["eid"]].expert_name, "eid": cell["eid"],
                "captured": cell["captured"], "leaving_on": core.iso(leaving[cell["eid"]].leaving_on)}
               for cell in cells if cell["sole_holder"] and cell["eid"] in leaving]
    orphaned = [core.card_dict(c) for c in ctx.db.scalars(
        select(Card).where(Card.clone_id.in_(list(leaving) or [-1]), Card.type == "open_task").limit(30))]
    return {"people": [{"eid": c.id, "name": c.expert_name, "title": c.title, "team": c.department,
                        "coverage": core.coverage(ctx.db, c.id), "status": status[c.id],
                        "leaving_on": core.iso(c.leaving_on), "avatar_color": core.COLORS[c.id % len(core.COLORS)]}
                       for c in clones],
            "areas": areas, "cells": cells, "at_risk": at_risk, "orphaned_tasks": orphaned}
