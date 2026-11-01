"""The one conversation for the person leaving.

Stages: welcome → intro (2 about-you questions) → connect → reading → interview (gap questions) → open
("anything else only you know?") → done. Every avatar line is stored, so the screen can be rebuilt any time.

Cost: intro = 1 small call; each answer = 1 small call; uploads/screen/walk = 1 call each; finish = the
briefing (1 call). Greetings, connect prompts, reading narration and question hand-offs are templates (free).
"""
from __future__ import annotations

import logging
import mimetypes
import re
import shutil
import uuid
from datetime import datetime
from pathlib import Path

from sqlalchemy import JSON, DateTime, ForeignKey, String, Text, func, select
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.config import settings
from backend.db.models import Base, Clone, Org, User, utcnow
from backend.db.models_knowledge import Card, InterviewV2, QuestionV2, Run, SourceConsent, SourceItem
from backend.db.store import SessionLocal
from backend.knowledge.embed import embed
from backend.knowledge import ai, capture as CAP, core, interview as IV, prompts as P, sources as SRC

log = logging.getLogger("cloneflow.session")


class SessionMsg(Base):
    __tablename__ = "session_msgs"
    id: Mapped[int] = mapped_column(primary_key=True)
    clone_id: Mapped[int] = mapped_column(ForeignKey("clones.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(10))       # avatar | user | system
    kind: Mapped[str] = mapped_column(String(20), default="text")
    text: Mapped[str] = mapped_column(Text, default="")
    payload: Mapped[dict | None] = mapped_column(JSON)
    at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


GAP_INTRO = {
    "missing_why": "Here's one where I found what you do, but never why.",
    "contradiction": "Two places disagree on this one.",
    "unfinished_task": "This looks unfinished.",
    "undocumented_step": "Everyone relies on this, but it isn't written down.",
    "who_to_contact": "I couldn't find who to contact for this.",
}

PROFILE_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"}, "team": {"type": "string"}, "started_on": {"type": "string"},
        "years": {"type": "integer"},
        "roles": {"type": "array", "items": {"type": "object", "properties": {
            "title": {"type": "string"}, "from": {"type": "string"}, "to": {"type": "string"}},
            "required": ["title", "from", "to"]}},
        "focus": {"type": "array", "items": {"type": "string"}},
        "summary": {"type": "string"},
        "reply": {"type": "string"},
    },
    "required": ["title", "team", "started_on", "years", "roles", "focus", "summary", "reply"],
}
PROFILE_SYSTEM = """From a departing employee's own words, fill their profile. title/team: current job title and team
("" if not said). started_on: YYYY-MM-DD or YYYY-MM or YYYY ("" if not said). years: whole years at the company (0 if
unknown). roles: their roles over time if said. focus: the 2–6 things they spend their week on, short noun phrases.
summary: one plain sentence. reply: one warm spoken sentence that shows you listened (mention one specific thing
they said), no question, no flattery. Use only what they said."""

FREE_SYSTEM = P.ANSWER_SYSTEM


# ---------------------------------------------------------------- helpers
def _first(name: str) -> str:
    return (name or "there").split()[0]


def _state(c: Clone) -> dict:
    return dict((c.settings or {}).get("session") or {})


def _set_state(c: Clone, **kw) -> None:
    s = dict(c.settings or {})
    st = dict(s.get("session") or {})
    st.update(kw)
    s["session"] = st
    c.settings = s


def say(db, eid: int, text: str, kind: str = "text", payload: dict | None = None, role: str = "avatar") -> SessionMsg:
    m = SessionMsg(clone_id=eid, role=role, kind=kind, text=text, payload=payload)
    db.add(m)
    db.flush()
    return m


def msg_dict(m: SessionMsg) -> dict:
    return {"id": m.id, "role": m.role, "kind": m.kind, "text": m.text, "payload": m.payload, "at": core.iso(m.at)}


def own_clone(db, user: User) -> Clone | None:
    return db.scalar(select(Clone).where(Clone.owner_user_id == user.id).order_by(Clone.id))


# ---------------------------------------------------------------- serialization
def providers(eid: int) -> list[dict]:
    from . import connectors as CN

    st = CN.status(eid)
    out = []
    for key, prov in (("microsoft", "microsoft"), ("gmail", "google"), ("github", "github")):
        meta, tok = CN.PROVIDERS[prov], st.get(prov)
        out.append({"key": key, "label": meta["label"], "note": meta["note"], "configured": CN.configured(prov),
                    "connected": bool(tok), "status": tok["status"] if tok else None,
                    "account": tok["account"] if tok else None, "counts": tok["counts"] if tok else {},
                    "start_url": f"/api/connect/{prov}/start" if CN.configured(prov) else None})
    return out


def _actions(stage: str, db, eid: int) -> list[dict]:
    if stage == "welcome":
        return [{"type": "start"}]
    if stage == "intro":
        return [{"type": "answer"}, {"type": "add", "modes": ["upload"]}]
    if stage == "connect":
        acts = [{"type": "connect", "providers": providers(eid)}, {"type": "answer"}]
        allowed = db.scalar(select(func.count()).select_from(SourceConsent).where(
            SourceConsent.clone_id == eid, SourceConsent.consent.is_(True))) or 0
        items = db.scalar(select(func.count()).select_from(SourceItem).where(SourceItem.clone_id == eid)) or 0
        if allowed and items:
            acts.append({"type": "start_reading", "label": "Start reading"})
        acts.append({"type": "add", "modes": ["upload"]})
        acts.append({"type": "skip_connect", "label": "Skip — I'll show you instead"})
        return acts
    if stage == "reading":
        return []
    if stage == "interview":
        return [{"type": "answer"}, {"type": "skip"}, {"type": "add", "modes": ["screen", "upload", "phone"]},
                {"type": "finish", "label": "Finish for now"}]
    if stage == "open":
        return [{"type": "answer"}, {"type": "add", "modes": ["screen", "upload", "phone"]},
                {"type": "finish", "label": "I'm done"}]
    return []


def session_dict(db, user: User, c: Clone | None) -> dict:
    org = db.get(Org, user.org_id)
    if c is None or not _state(c).get("stage"):
        first = _first(user.name)
        return {"eid": c.id if c else None, "name": user.name, "first_name": first, "company": org.name, "stage": "welcome",
                "messages": [{"id": 0, "role": "avatar", "kind": "text", "at": None, "payload": None,
                              "text": f"Hi {first}. Before you go, let's make sure what you know stays with "
                                      f"{org.name}. It's just a conversation, about 15 minutes."}],
                "actions": [{"type": "start"}], "question": None, "coverage": 0, "coverage_before": None,
                "progress": {"asked": 0, "total": 0}, "run": None, "sources": [], "cards_recent": [],
                "ai_enabled": ai.ai_ready()}
    _sync(db, c)
    st = _state(c)
    stage = st.get("stage", "intro")
    msgs = db.scalars(select(SessionMsg).where(SessionMsg.clone_id == c.id).order_by(SessionMsg.id)).all()
    iv = core.latest_interview(db, c.id)
    q = None
    progress = {"asked": 0, "total": 0}
    if iv is not None:
        qs = db.scalars(select(QuestionV2).where(QuestionV2.interview_id == iv.id, QuestionV2.kind == "gap")
                        .order_by(QuestionV2.index)).all()
        progress = {"asked": sum(1 for x in qs if x.status != "open"), "total": len(qs)}
        if stage == "interview":
            cur = next((x for x in qs if x.status == "open"), None)
            q = IV.question_dict(db, cur) if cur else None
    run = None
    if st.get("run_id"):
        r = db.get(Run, st["run_id"])
        run = CAP.run_dict(r) if r else None
    recent = db.scalars(select(Card).where(Card.clone_id == c.id, Card.origin != "read")
                        .order_by(Card.updated_at.desc()).limit(8)).all()
    out_msgs = [msg_dict(m) for m in msgs]
    if run and stage == "reading":  # the reading line shows live counters (same message id, updated in place)
        for m in reversed(out_msgs):
            if m["kind"] == "reading" and (m["payload"] or {}).get("run_id") == run["id"]:
                k = run["counters"] or {}
                m["payload"] = {**m["payload"], "counters": k, "personal_skipped": k.get("personal_skipped", 0),
                                "noise_skipped": k.get("filtered_out", 0), "stage": run["stage"],
                                "progress": run["progress"], "done": False}
                break
    return {"eid": c.id, "name": c.expert_name, "first_name": _first(c.expert_name), "company": org.name,
            "stage": stage, "messages": out_msgs, "actions": _actions(stage, db, c.id),
            "question": q, "coverage": core.coverage(db, c.id),
            "coverage_before": iv.coverage_before if iv else None, "progress": progress, "run": run,
            "sources": core.source_cards(db, c.id), "cards_recent": [core.card_dict(x) for x in recent],
            "ai_enabled": ai.ai_ready()}


# ---------------------------------------------------------------- background progress → messages
def _sync(db, c: Clone) -> None:
    """Turn finished background work (imports, the reading run) into avatar lines."""
    st = _state(c)
    from . import connectors as CN

    announced = set(st.get("announced", []))
    for prov, info in CN.status(c.id).items():
        key = f"import:{prov}:{info['status']}"
        if info["status"] in ("done", "error") and key not in announced:
            label = CN.PROVIDERS[prov]["label"]
            if info["status"] == "done":
                parts = [f"{v} {k}" for k, v in info["counts"].items() if v]
                say(db, c.id, f"{label} is connected — I can see {', '.join(parts) or 'nothing new yet'}. "
                              f"Add another source, or tap Start reading.")
            else:
                say(db, c.id, f"I couldn't finish reading {label}: {info['error'] or 'unknown error'}. "
                              f"You can try again, or upload files instead.")
            announced.add(key)
            _set_state(c, announced=sorted(announced))
    if st.get("stage") == "reading" and st.get("run_id"):
        r = db.get(Run, st["run_id"])
        if r and r.status == "done":
            _after_reading(db, c, r)
        elif r and r.status == "failed":
            if (r.error or "").startswith(ai.TRIAL_MESSAGE):
                say(db, c.id, ai.TRIAL_MESSAGE)
            else:
                say(db, c.id, f"Something went wrong while reading: {r.error or 'unknown error'}. Let's try again.")
            _set_state(c, stage="connect")
    db.commit()


def _after_reading(db, c: Clone, r: Run) -> None:
    k = r.counters or {}
    first = _first(c.expert_name)
    skipped = k.get("filtered_out", 0)
    personal = k.get("personal_skipped", 0)
    learned = sum(k.get(x, 0) for x in ("processes", "systems", "contacts", "decisions", "open_tasks", "routines",
                                         "locations", "facts"))
    say(db, c.id, f"Done reading. {k.get('emails', 0)} emails, {k.get('chats', 0)} chat messages and "
                  f"{k.get('files', 0)} files had real work in them. I set aside {skipped} automated messages"
                  + (f" and masked {personal} personal ones — those never reached the AI." if personal else "."),
        kind="reading", payload={"counters": k, "personal_skipped": personal, "noise_skipped": skipped, "done": True,
                                 "coverage": r.coverage})
    iv = core.latest_interview(db, c.id)
    gaps = db.scalars(select(QuestionV2).where(QuestionV2.interview_id == iv.id, QuestionV2.kind == "gap")
                      .order_by(QuestionV2.index)).all() if iv else []
    # the about-you questions were already answered at the start of the conversation
    intro = _state(c).get("intro_answers", [])
    if iv:
        for q in db.scalars(select(QuestionV2).where(QuestionV2.interview_id == iv.id, QuestionV2.kind == "about_you")):
            q.status = "answered"
            q.answer = {"transcript": " ".join(intro), "mode": "voice", "card_ids": [], "reply": "",
                        "at": datetime.utcnow().isoformat()}
        iv.status = "in_progress"
        IV._advance(db, iv)
    say(db, c.id, f"I already have {learned} pieces of your knowledge — that's {r.coverage}% of your role. "
                  f"There are {len(gaps)} things only you can tell me. Short answers are fine, {first}; "
                  f"you can also show me on your screen or with your phone.")
    _set_state(c, stage="interview" if gaps else "open")
    if gaps:
        _ask(db, c, gaps[0])
    else:
        _open_stage(db, c)


def _ask(db, c: Clone, q: QuestionV2) -> None:
    lead = GAP_INTRO.get(q.gap_type or "", "")
    say(db, c.id, f"{lead} {q.text}".strip(), kind="evidence" if q.evidence else "text",
        payload={"question_id": q.id, "gap_type": q.gap_type, "sources": q.evidence or [], "project": q.project})


def _ensure_interview(db, eid: int):
    """Someone who skipped connecting email/chat still gets an interview record (walks, screen clips, summary)."""
    from backend.db.models_knowledge import InterviewV2

    iv = core.latest_interview(db, eid)
    if iv is None:
        iv = InterviewV2(clone_id=eid, status="in_progress", opening_line="")
        db.add(iv)
        db.flush()
    return iv


def _open_stage(db, c: Clone) -> None:
    say(db, c.id, "That's everything I had to ask. Is there anything else only you know — something you do that "
                  "isn't written anywhere? Tell me, show your screen, upload a file or video, or walk me around with "
                  "your phone. Tap “I'm done” when you're finished.")
    _set_state(c, stage="open")


def _next(db, c: Clone) -> None:
    iv = core.latest_interview(db, c.id)
    nxt = db.scalar(select(QuestionV2).where(QuestionV2.interview_id == iv.id, QuestionV2.kind == "gap",
                                             QuestionV2.status == "open").order_by(QuestionV2.index).limit(1))
    if nxt:
        _ask(db, c, nxt)
    else:
        _open_stage(db, c)


# ---------------------------------------------------------------- actions
def start(user: User) -> int:
    with SessionLocal() as db:
        c = own_clone(db, user)
        org = db.get(Org, user.org_id)
        if c is None:
            c = Clone(org_id=user.org_id, owner_user_id=user.id, expert_name=user.name, title="", department="",
                      status="capturing", settings={})
            db.add(c)
            db.flush()
        if not _state(c).get("stage") or _state(c).get("stage") == "welcome":
            first = _first(c.expert_name)
            say(db, c.id, f"Hi {first}! I'm here to help you hand over what you know before you leave "
                          f"{org.name}, so whoever comes next doesn't start from zero. Talk or type, whatever's easier.")
            focus, by = (c.settings or {}).get("focus"), (c.settings or {}).get("focus_by")
            if focus:
                say(db, c.id, f"{_first(by) if by else 'Your admin'} asked me to make sure we cover this: {focus.rstrip('.')}. "
                              "We'll get to it.")
            say(db, c.id, "To start — what's your role here, and when did you join?")
            _set_state(c, stage="intro", intro_answers=[])
        db.commit()
        return c.id


INTRO_Q2 = "And what takes up most of your week — the projects and routines people come to you for?"


def message(user: User, text: str, mode: str = "text") -> list[int]:
    """Handle what the person said. Returns ids of new messages."""
    text = (text or "").strip()
    with SessionLocal() as db:
        c = own_clone(db, user)
        before = db.scalar(select(func.max(SessionMsg.id)).where(SessionMsg.clone_id == c.id)) or 0
        st = _state(c)
        stage = st.get("stage", "intro")
        eid = c.id
        say(db, eid, text, role="user", payload={"mode": mode})
        db.commit()
    if stage == "intro":
        _intro(eid, text)
    elif stage == "interview":
        _answer_gap(eid, text, mode)
    elif stage in ("open", "done"):
        _free_knowledge(eid, text, mode)
    else:
        with SessionLocal() as db:
            c = db.get(Clone, eid)
            if stage == "connect":
                say(db, eid, "Got it — I'll keep that in mind. Connect a source above when you're ready, or tap Start "
                             "reading once something is connected.")
            elif stage == "reading":
                say(db, eid, "I'm still reading — I'll come back to you in a moment.")
            db.commit()
    with SessionLocal() as db:
        return [i for (i,) in db.execute(select(SessionMsg.id).where(SessionMsg.clone_id == eid, SessionMsg.id > before))]


def _intro(eid: int, text: str) -> None:
    with SessionLocal() as db:
        c = db.get(Clone, eid)
        answers = list(_state(c).get("intro_answers", [])) + [text]
        _set_state(c, intro_answers=answers)
        if len(answers) == 1:
            m = re.search(r"\b(19|20)\d{2}\b", text)
            ack = f"Since {m.group(0)} — that's a lot of know-how." if m else "Thanks, that helps."
            say(db, eid, f"{ack} {INTRO_Q2}")
            db.commit()
            return
        db.commit()
        org_name = db.get(Org, c.org_id).name
    reply = "Thank you — that gives me the shape of your role."
    if ai.ai_ready():
        try:
            out = ai.call_json("answer_cards", eid, PROFILE_SYSTEM,
                               f"Company: {org_name}\nTheir words:\n" + "\n".join(f"- {a}" for a in answers),
                               PROFILE_SCHEMA, "V3Profile")
            reply = out.get("reply") or reply
            with SessionLocal() as db:
                c = db.get(Clone, eid)
                if out.get("title") and not c.title:
                    c.title = out["title"][:200]
                if out.get("team") and not c.department:
                    c.department = out["team"][:200]
                if out.get("years") and not c.years_at_company:
                    c.years_at_company = int(out["years"])
                s = dict(c.settings or {})
                prof = dict(s.get("profile") or {})
                prof.update({k: out[k] for k in ("started_on", "roles", "summary", "focus") if out.get(k)})
                prof["answers"] = answers
                s["profile"] = prof
                c.settings = s
                db.commit()
        except ai.TrialLimit:
            raise
        except ai.LLMError as exc:
            log.warning("profile step failed: %s", exc)
    with SessionLocal() as db:
        c = db.get(Clone, eid)
        say(db, eid, reply)
        say(db, eid, "Now the part that saves you the most time: let me read your work email and chats, so I only "
                     "ask about what isn't written down anywhere. Personal messages are masked and never sent to the "
                     "AI. Start with the one you use most — or skip this and show me with files, your screen or your phone.", kind="connect", payload={"providers": providers(eid)})
        _set_state(c, stage="connect")
        db.commit()


def start_reading(user: User) -> None:
    with SessionLocal() as db:
        c = own_clone(db, user)
        eid = c.id
    if not ai.ai_ready():
        raise PermissionError("AI is turned off, so I can't read yet. Please try again later.")
    ai.check_org(eid)
    rid = CAP.start(eid)
    with SessionLocal() as db:
        c = db.get(Clone, eid)
        say(db, eid, "Reading now. I'll skip newsletters, notifications and anything personal, and keep only the "
                     "knowledge someone taking over would need.", kind="reading", payload={"run_id": rid})
        _set_state(c, stage="reading", run_id=rid)
        db.commit()


def _current_q(db, eid: int) -> QuestionV2 | None:
    iv = core.latest_interview(db, eid)
    if iv is None:
        return None
    return db.scalar(select(QuestionV2).where(QuestionV2.interview_id == iv.id, QuestionV2.kind == "gap",
                                              QuestionV2.status == "open").order_by(QuestionV2.index).limit(1))


def _answer_gap(eid: int, text: str, mode: str) -> None:
    with SessionLocal() as db:
        q = _current_q(db, eid)
        qid = q.id if q else None
    if qid is None:
        return _free_knowledge(eid, text, mode)
    res = IV.answer(qid, text, mode)
    with SessionLocal() as db:
        c = db.get(Clone, eid)
        if res["new_cards"]:
            say(db, eid, "", kind="cards", payload={"cards": res["new_cards"], "coverage": res["coverage"]})
        say(db, eid, res.get("reply") or "Got it — saved.")
        _next(db, c)
        db.commit()


def skip(user: User) -> None:
    with SessionLocal() as db:
        c = own_clone(db, user)
        if _state(c).get("stage") == "connect":  # no email or chat to read: go straight to showing and telling
            say(db, c.id, "No problem. Then show me instead: tell me what only you know, share your screen while you "
                          "do a task, upload documents, photos or videos, or walk me around with your phone. "
                          "Tap “I'm done” when you're finished.")
            _ensure_interview(db, c.id)
            _set_state(c, stage="open")
            db.commit()
            return
        q = _current_q(db, c.id)
        if q:
            IV.skip(q.id)
            say(db, c.id, "No problem — I'll mark that for someone else to ask.")
            _next(db, c)
        db.commit()


def _free_knowledge(eid: int, text: str, mode: str) -> None:
    """Something new the person volunteers — one small call turns it into cards."""
    with SessionLocal() as db:
        c = db.get(Clone, eid)
        name = c.expert_name
    out = ai.call_json("answer_cards", eid, FREE_SYSTEM,
                       f"Employee: {name}\nQuestion (open): Anything else only you know?\nEvidence shown:\n(none)\n"
                       f"Related cards:\n(none)\n\nEmployee's answer ({mode}):\n{ai.redact(text)}",
                       P.ANSWER_SCHEMA, "V2Answer")
    src = {"kind": "interview", "ref": f"s{eid}", "label": f"Interview · {datetime.now():%b %d}", "quote": text[:200]}
    ids = []
    with SessionLocal() as db:
        for nc in out.get("new_cards", []):
            card = Card(clone_id=eid, type=nc["type"], title=nc["title"][:300], body=nc.get("body", ""),
                        steps=nc.get("steps", []), project=nc.get("project") or None, area=nc.get("area") or "General",
                        sources=[src], confidence=0.9, status="verified_in_interview", origin="interview",
                        related_people=nc.get("people", []),
                        embedding=embed([f"{nc['title']}. {nc.get('body', '')}"])[0].round(5).tolist())
            db.add(card)
            db.flush()
            ids.append(card.id)
        cards = [core.card_dict(x) for x in db.scalars(select(Card).where(Card.id.in_(ids)))] if ids else []
        if cards:
            say(db, eid, "", kind="cards", payload={"cards": cards, "coverage": core.coverage(db, eid)})
        say(db, eid, (out.get("reply") or "Saved.") + " Anything else?")
        db.commit()


# ---------------------------------------------------------------- uploads, screen, phone
VIDEO = {".mp4", ".mov", ".webm", ".m4v"}
IMAGE = {".png", ".jpg", ".jpeg", ".webp"}


def upload(user: User, files: list[tuple[str, bytes]], note: str = "") -> None:
    with SessionLocal() as db:
        c = own_clone(db, user)
        eid = c.id
        q = _current_q(db, eid)
        qtext = q.text if q else "Anything else only you know?"
        qid = q.id if q and _state(c).get("stage") == "interview" else None
        say(db, eid, note or "Uploaded " + ", ".join(n for n, _ in files), role="user", kind="upload",
            payload={"files": [{"name": n, "type": mimetypes.guess_type(n)[0] or "application/octet-stream"}
                               for n, _ in files], "note": note})
        db.commit()
    work = settings.data_dir / "uploads" / f"session_{eid}_{uuid.uuid4().hex[:6]}"
    work.mkdir(parents=True, exist_ok=True)
    docs, media = [], []
    for name, data in files:
        p = work / Path(name).name
        p.write_bytes(data)
        (media if p.suffix.lower() in VIDEO | IMAGE else docs).append(p)
    new_ids: list[int] = []
    learned_lines = []
    if docs:
        with SessionLocal() as db:
            before = {i for (i,) in db.execute(select(SourceItem.id).where(SourceItem.clone_id == eid))}
            for p in docs:
                SRC.load_upload(db, eid, "files", p, work)
            SRC.set_connected(db, eid, "files", "Uploaded files")
            cons = db.scalar(select(SourceConsent).where(SourceConsent.clone_id == eid, SourceConsent.kind == "files"))
            cons.consent = True
            db.commit()
            fresh = db.scalars(select(SourceItem).where(SourceItem.clone_id == eid, SourceItem.id.not_in(before or {-1}))).all()
            batch = [{"kind": "file", "items": [(it.id, it.clean)], "text": ai.redact(f"File: {it.title}\n{it.clean[:6000]}")}
                     for it in fresh if (it.clean or "").strip()]
            name = db.get(Clone, eid).expert_name
        if batch and _state_stage(eid) not in ("welcome", "intro", "connect"):
            body = "\n\n".join(f"[S{i + 1}] {d['text']}" for i, d in enumerate(batch))
            out = ai.call_json("extract", eid, P.EXTRACT_SYSTEM, f"Employee: {name}\n\n{body}", P.EXTRACT_SCHEMA, "V2Extract")
            for cd in out.get("cards", []):
                items = [CAP._source_item(batch[s - 1], cd.get("quote", "")) for s in cd.get("sources", []) if 1 <= s <= len(batch)]
                if items:
                    cd["_items"] = items
                    new_ids.append(CAP._save_card(eid, cd, origin="upload", status="verified_in_interview"))
            learned_lines.append(f"I read {len(batch)} file{'s' if len(batch) != 1 else ''}")
        elif batch:
            learned_lines.append(f"I added {len(batch)} file{'s' if len(batch) != 1 else ''} — I'll read "
                                 f"{'it' if len(batch) == 1 else 'them'} with everything else")
    for p in media:
        if p.suffix.lower() in VIDEO:
            res = _video_cards(eid, p, note, qtext)
        else:
            res = _image_cards(eid, p, note, qtext)
        new_ids += res
        learned_lines.append(f"I watched {p.name}" if p.suffix.lower() in VIDEO else f"I looked at {p.name}")
    with SessionLocal() as db:
        c = db.get(Clone, eid)
        if qid and new_ids:
            IV.answer_link(qid, note, "upload", new_ids, "")
        cards = [core.card_dict(x) for x in db.scalars(select(Card).where(Card.id.in_(new_ids)))] if new_ids else []
        if cards:
            say(db, eid, "", kind="cards", payload={"cards": cards, "coverage": core.coverage(db, eid)})
        say(db, eid, (" and ".join(learned_lines) or "Saved") + (f" — {len(cards)} new piece{'s' if len(cards) != 1 else ''} of knowledge." if cards else "."))
        if qid and new_ids:
            _next(db, c)
        db.commit()
    shutil.rmtree(work, ignore_errors=True)


def _state_stage(eid: int) -> str:
    with SessionLocal() as db:
        return _state(db.get(Clone, eid)).get("stage", "intro")


def _video_cards(eid: int, video: Path, narration: str, qtext: str) -> list[int]:
    from backend.media import frames as vf

    out_dir = IV.media_dir(eid, f"uploads/{uuid.uuid4().hex[:8]}")
    clip = out_dir / video.name
    shutil.copy2(video, clip)
    frames = vf.keyframes(clip, out_dir, max_frames=8, max_side=1280)
    for f in frames:
        for box in vf.local_faces(f):
            vf.blur_boxes(f, [box])
    if not frames:
        return []
    with SessionLocal() as db:
        who = _first(db.get(Clone, eid).expert_name)
    prompt = P.FRAMES_PROMPT.format(who=who, what="a video they recorded", n=len(frames), last=len(frames) - 1,
                                    said=ai.redact(narration or "(no narration)"), question=qtext)
    out = ai.call_vision("frames", eid, prompt, [f.read_bytes() for f in frames], P.FRAMES_SCHEMA, "V2Frames")
    labels = out.get("labels") or []
    chips = [{"kind": "floor", "ref": IV.media_url(clip), "video_url": IV.media_url(clip), "frame_url": IV.media_url(f),
              "label": f"Video · {labels[i] if i < len(labels) else f'frame {i + 1}'}", "timestamp_s": vf.frame_time(f)}
             for i, f in enumerate(frames)]
    return IV._frame_cards(eid, out, chips, "upload", None)


def _image_cards(eid: int, img: Path, note: str, qtext: str) -> list[int]:
    out_dir = IV.media_dir(eid, f"uploads/{uuid.uuid4().hex[:8]}")
    dst = out_dir / img.name
    shutil.copy2(img, dst)
    from backend.media import frames as vf

    for box in vf.local_faces(dst):
        vf.blur_boxes(dst, [box])
    with SessionLocal() as db:
        who = _first(db.get(Clone, eid).expert_name)
    prompt = P.FRAMES_PROMPT.format(who=who, what="a photo", n=1, last=0, said=ai.redact(note or "(nothing said)"),
                                    question=qtext)
    out = ai.call_vision("frames", eid, prompt, [dst.read_bytes()], P.FRAMES_SCHEMA, "V2Frames")
    chips = [{"kind": "file", "ref": IV.media_url(dst), "frame_url": IV.media_url(dst), "label": f"Photo · {img.name}"}]
    return IV._frame_cards(eid, out, chips, "upload", None)


def screen(user: User, video: Path, narration: str) -> None:
    with SessionLocal() as db:
        c = own_clone(db, user)
        eid = c.id
        q = _current_q(db, eid)
        qid = q.id if q and _state(c).get("stage") == "interview" else None
        say(db, eid, narration or "Shared my screen", role="user", kind="upload",
            payload={"screen": True, "files": [{"name": "Screen recording", "type": "video/webm"}], "note": narration})
        db.commit()
    if qid:
        res = IV.screen(qid, video, narration)
        reply, new = res.get("narration_back") or "Got it.", res["new_cards"]
    else:
        ids = _video_cards(eid, video, narration, "Anything else only you know?")
        with SessionLocal() as db:
            new = [core.card_dict(x) for x in db.scalars(select(Card).where(Card.id.in_(ids)))] if ids else []
        reply = "Got it — I saved what you showed me."
    with SessionLocal() as db:
        c = db.get(Clone, eid)
        if new:
            say(db, eid, "", kind="cards", payload={"cards": new, "coverage": core.coverage(db, eid)})
        say(db, eid, reply)
        if qid:
            _next(db, c)
        db.commit()


def walk(user: User) -> dict:
    from backend.knowledge import walk as W

    with SessionLocal() as db:
        c = own_clone(db, user)
        iv = core.latest_interview(db, c.id) or _ensure_interview(db, c.id)
        q = _current_q(db, c.id)
        qid = q.id if q and _state(c).get("stage") == "interview" else None
        out = W.create(iv.id, qid)
        say(db, c.id, "Scan this with your phone, then show me around and talk as you go. I'll keep the moments "
                      "that matter.", kind="walk", payload={"token": out["token"], "url": out["url"]})
        _set_state(c, walk_token=out["token"])
        db.commit()
        return out


def on_walk_finished(token: str, result: dict) -> None:
    from backend.db.models_knowledge import WalkSession

    with SessionLocal() as db:
        ws = db.scalar(select(WalkSession).where(WalkSession.token == token))
        iv = db.get(InterviewV2, ws.interview_id) if ws else None
        if not iv:
            return
        c = db.get(Clone, iv.clone_id)
        if result.get("new_cards"):
            say(db, c.id, "", kind="cards", payload={"cards": result["new_cards"], "coverage": core.coverage(db, c.id)})
        say(db, c.id, result.get("narration_back") or "Thanks for the tour — I saved what you showed me.")
        if ws.question_id and _state(c).get("stage") == "interview":
            _next(db, c)
        db.commit()


def finish(user: User) -> None:
    with SessionLocal() as db:
        c = own_clone(db, user)
        eid = c.id
        iv = core.latest_interview(db, eid)
        iid = iv.id if iv else None
    if iid:
        IV.finish(iid)
    with SessionLocal() as db:
        c = db.get(Clone, eid)
        iv = core.latest_interview(db, eid)
        summ = (iv.summary or {}) if iv else {}
        cov = core.coverage(db, eid)
        first = _first(c.expert_name)
        succ = (c.settings or {}).get("successor") or "your successor"
        say(db, eid, "", kind="summary", payload={**summ, "coverage_after": cov})
        say(db, eid, f"Thank you, {first}. Your knowledge is saved with {db.get(Org, c.org_id).name} — coverage went "
                     f"from {summ.get('coverage_before', 0)}% to {cov}%. {succ.split(' (')[0]} can now ask it anything, "
                     f"and it will say when it doesn't know. You can come back any time to add more.")
        _set_state(c, stage="done")
        core.set_status(c, "captured")
        db.commit()
