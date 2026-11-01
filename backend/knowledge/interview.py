"""Interview: about-you questions, gap questions with evidence, answers → card updates, screen share, briefing."""
from __future__ import annotations

import logging
import re
import shutil
import uuid
from datetime import datetime
from pathlib import Path

from sqlalchemy import select

from backend.app.config import settings
from backend.db.models import Clone
from backend.db.models_knowledge import Card, InterviewV2, QuestionV2
from backend.db.store import SessionLocal
from backend.knowledge.embed import embed
from . import ai, core, prompts as P

log = logging.getLogger("cloneflow.interview")


def media_dir(eid: int, sub: str) -> Path:
    d = settings.data_dir / "media" / f"clone_{eid}" / sub
    d.mkdir(parents=True, exist_ok=True)
    return d


def media_url(path: Path) -> str:
    rel = path.resolve().relative_to((settings.data_dir / "media").resolve())
    return f"/api/media/{rel.as_posix()}"


def question_dict(db, q: QuestionV2) -> dict:
    ans = None
    if q.answer:
        ids = q.answer.get("card_ids", [])
        cards = [core.card_dict(c) for c in db.scalars(select(Card).where(Card.id.in_(ids)))] if ids else []
        ans = {"transcript": q.answer.get("transcript", ""), "mode": q.answer.get("mode", "text"), "cards": cards,
               "reply": q.answer.get("reply", ""), "at": q.answer.get("at")}
    return {"id": q.id, "index": q.index, "kind": q.kind, "gap_type": q.gap_type, "text": q.text,
            "evidence": q.evidence or [], "project": q.project, "card_ids": q.card_ids or [],
            "status": q.status, "answer": ans}


def interview_dict(db, iv: InterviewV2) -> dict:
    qs = db.scalars(select(QuestionV2).where(QuestionV2.interview_id == iv.id).order_by(QuestionV2.index)).all()
    return {"id": iv.id, "employee_id": iv.clone_id, "status": iv.status, "coverage": core.coverage(db, iv.clone_id),
            "coverage_before": iv.coverage_before, "opening_line": iv.opening_line,
            "questions": [question_dict(db, q) for q in qs], "current_index": iv.current_index,
            "summary": iv.summary, "closing_line": iv.closing_line}


def _advance(db, iv: InterviewV2) -> None:
    qs = db.scalars(select(QuestionV2).where(QuestionV2.interview_id == iv.id).order_by(QuestionV2.index)).all()
    nxt = next((q.index for q in qs if q.status == "open"), len(qs))
    iv.current_index = nxt
    if iv.status == "not_started":
        iv.status = "in_progress"


def _cards_text(cards: list[Card]) -> str:
    return "\n".join(f"#{c.id} [{c.type}] {c.title}: {c.body}"
                     f"{' Steps: ' + '; '.join(c.steps) if c.steps else ''}" for c in cards) or "(none)"


def answer(qid: int, transcript: str, mode: str = "voice") -> dict:
    """One small-model call turns the spoken answer into card updates (and profile facts for about-you)."""
    transcript = (transcript or "").strip()
    with SessionLocal() as db:
        q = db.get(QuestionV2, qid)
        iv = db.get(InterviewV2, q.interview_id)
        eid = iv.clone_id
        clone = db.get(Clone, eid)
        related = db.scalars(select(Card).where(Card.id.in_(q.card_ids or []))).all()
        evidence = "\n".join(f"- {e.get('label')}: “{e.get('quote', '')}”" for e in q.evidence or []) or "(none)"
        user = (f"Employee: {clone.expert_name}\nQuestion ({q.kind}{', ' + q.gap_type if q.gap_type else ''}): {q.text}\n"
                f"Evidence shown:\n{evidence}\nRelated cards:\n{_cards_text(related)}\n\n"
                f"Employee's answer ({mode}):\n{ai.redact(transcript)}")
    out = ai.call_json("answer_cards", eid, P.ANSWER_SYSTEM, user, P.ANSWER_SCHEMA, "V2Answer")
    touched: list[int] = []
    new_ids: list[int] = []
    src = {"kind": "interview", "ref": f"q{qid}", "label": f"Interview · {datetime.now():%b %d}",
           "quote": transcript[:200]}
    with SessionLocal() as db:
        valid = {c.id for c in related}
        for u in out.get("updates", []):
            if u["card_id"] not in valid:
                continue
            c = db.get(Card, u["card_id"])
            if u.get("body"):
                c.body = u["body"]
            if u.get("steps"):
                c.steps = u["steps"]
            c.status = u.get("status", "verified_in_interview")
            c.confidence = 0.95 if c.status == "verified_in_interview" else 0.3
            if not any(s.get("ref") == src["ref"] for s in c.sources or []):
                c.sources = (c.sources or []) + [src]
            c.embedding = embed([f"{c.title}. {c.body}"])[0].round(5).tolist()
            touched.append(c.id)
        for nc in out.get("new_cards", []):
            card = Card(clone_id=eid, type=nc["type"], title=nc["title"][:300], body=nc.get("body", ""),
                        steps=nc.get("steps", []), project=nc.get("project") or q.project, area=nc.get("area") or "General",
                        sources=[src], confidence=0.9, status="verified_in_interview",
                        related_people=nc.get("people", []),
                        related_projects=[nc["project"]] if nc.get("project") else [],
                        embedding=embed([f"{nc['title']}. {nc.get('body', '')}"])[0].round(5).tolist(), origin="interview")
            db.add(card)
            db.flush()
            new_ids.append(card.id)
        if q.kind == "about_you":
            _merge_profile(db, eid, out.get("profile") or {}, transcript)
        q = db.get(QuestionV2, qid)
        q.status = "answered"
        q.answer = {"transcript": transcript, "mode": mode, "card_ids": touched + new_ids,
                    "reply": out.get("reply", ""), "at": datetime.utcnow().isoformat()}
        iv = db.get(InterviewV2, q.interview_id)
        _advance(db, iv)
        c = db.get(Clone, eid)
        core.set_status(c, "interviewing")
        db.commit()
        cards = [core.card_dict(x) for x in db.scalars(select(Card).where(Card.id.in_(touched + new_ids)))]
        return {"question": question_dict(db, q), "new_cards": cards, "reply": out.get("reply", ""),
                "coverage": core.coverage(db, eid), "interview": interview_dict(db, iv)}


def _merge_profile(db, eid: int, prof: dict, transcript: str) -> None:
    c = db.get(Clone, eid)
    s = dict(c.settings or {})
    p = dict(s.get("profile") or {})
    if prof.get("started_on"):
        p["started_on"] = prof["started_on"]
    else:
        m = re.search(r"\b(19|20)\d{2}\b", transcript)
        if m and "started_on" not in p:
            p["started_on"] = m.group(0)
    if prof.get("roles"):
        p["roles"] = prof["roles"]
    if prof.get("summary"):
        p["summary"] = prof["summary"]
    p.setdefault("answers", []).append(transcript[:1000])
    s["profile"] = p
    c.settings = s


def skip(qid: int) -> dict:
    with SessionLocal() as db:
        q = db.get(QuestionV2, qid)
        q.status = "skipped"
        iv = db.get(InterviewV2, q.interview_id)
        _advance(db, iv)
        db.commit()
        return interview_dict(db, iv)


def start(iid: int) -> dict:
    with SessionLocal() as db:
        iv = db.get(InterviewV2, iid)
        _advance(db, iv)
        core.set_status(db.get(Clone, iv.clone_id), "interviewing")
        db.commit()
        return interview_dict(db, iv)


# ---------------------------------------------------------------- screen share
def screen(qid: int, video: Path, narration: str) -> dict:
    from backend.media import frames as vf

    with SessionLocal() as db:
        q = db.get(QuestionV2, qid)
        iv = db.get(InterviewV2, q.interview_id)
        eid, qtext = iv.clone_id, q.text
        who = db.get(Clone, eid).expert_name.split()[0]
    out_dir = media_dir(eid, f"screen/q{qid}_{uuid.uuid4().hex[:6]}")
    clip = out_dir / f"clip{video.suffix or '.webm'}"
    shutil.move(str(video), clip)
    video = clip
    frames = vf.keyframes(video, out_dir, max_frames=8, max_side=1280)
    for f in frames:
        for box in vf.local_faces(f):
            vf.blur_boxes(f, [box])
    images = [f.read_bytes() for f in frames]
    prompt = P.FRAMES_PROMPT.format(who=who, what="how they do it on screen", n=len(images), last=max(0, len(images) - 1),
                                    said=ai.redact(narration or "(no narration)"), question=qtext)
    out = ai.call_vision("screen_narration", eid, prompt, images, P.FRAMES_SCHEMA, "V2Frames")
    chips = [{"kind": "screen", "ref": media_url(video), "video_url": media_url(video), "label": f"Screen · {(out.get('labels') or [''] * len(frames))[i] if i < len(out.get('labels') or []) else f'frame {i + 1}'}",
              "frame_url": media_url(f), "timestamp_s": vf.frame_time(f)} for i, f in enumerate(frames)]
    new_cards = _frame_cards(eid, out, chips, "screen", q_project=None)
    result = answer_link(qid, narration, "screen", new_cards, out.get("narration_back", ""))
    result.update({"narration_back": out.get("narration_back", ""), "frames": chips})
    return result


def _frame_cards(eid: int, out: dict, chips: list[dict], origin: str, q_project: str | None) -> list[int]:
    ids = []
    with SessionLocal() as db:
        for c in out.get("cards", []):
            srcs = [chips[i] for i in c.get("frames", []) if 0 <= i < len(chips)] or chips[:1]
            card = Card(clone_id=eid, type=c["type"], title=c["title"][:300], body=c.get("body", ""), steps=c.get("steps", []),
                        project=q_project, area=c.get("area") or "General", sources=srcs, confidence=0.9,
                        status="verified_in_interview", origin=origin,
                        embedding=embed([f"{c['title']}. {c.get('body', '')}"])[0].round(5).tolist())
            db.add(card)
            db.flush()
            ids.append(card.id)
        db.commit()
    return ids


def answer_link(qid: int, transcript: str, mode: str, card_ids: list[int], reply: str) -> dict:
    """Mark a question answered by cards made elsewhere (screen share / floor walk) without another model call."""
    with SessionLocal() as db:
        q = db.get(QuestionV2, qid)
        iv = db.get(InterviewV2, q.interview_id)
        for cid in q.card_ids or []:
            c = db.get(Card, cid)
            if c and c.status == "inferred":
                c.status, c.confidence = "verified_in_interview", 0.9
        q.status = "answered"
        q.answer = {"transcript": transcript or "", "mode": mode, "card_ids": card_ids, "reply": reply,
                    "at": datetime.utcnow().isoformat()}
        _advance(db, iv)
        db.commit()
        cards = [core.card_dict(x) for x in db.scalars(select(Card).where(Card.id.in_(card_ids)))]
        return {"question": question_dict(db, q), "new_cards": cards, "reply": reply,
                "coverage": core.coverage(db, iv.clone_id), "interview": interview_dict(db, iv)}


# ---------------------------------------------------------------- finish + briefing
def finish(iid: int) -> dict:
    with SessionLocal() as db:
        iv = db.get(InterviewV2, iid)
        eid = iv.clone_id
        clone = db.get(Clone, eid)
        first = clone.expert_name.split()[0]
        cards = db.scalars(select(Card).where(Card.clone_id == eid)).all()
        by = lambda t: sum(1 for c in cards if c.type == t)  # noqa: E731
        cov = core.coverage(db, eid)
        iv.summary = {"processes": by("process"), "contacts": by("contact"), "open_tasks": by("open_task"),
                      "locations": by("location"), "routines": by("routine"), "cards": len(cards),
                      "verified": sum(1 for c in cards if c.status == "verified_in_interview"),
                      "coverage_before": iv.coverage_before, "coverage_after": cov}
        iv.closing_line = (f"Thank you, {first}. Coverage went from {iv.coverage_before}% to {cov}%. "
                           f"Your successor can now ask your knowledge pack anything — and it will say when it doesn't know.")
        iv.status = "done"
        core.set_status(clone, "captured")
        db.commit()
    build_briefing(eid)
    with SessionLocal() as db:
        return interview_dict(db, db.get(InterviewV2, iid))


def build_briefing(eid: int, use_ai: bool = True) -> dict:
    with SessionLocal() as db:
        clone = db.get(Clone, eid)
        cards = db.scalars(select(Card).where(Card.clone_id == eid).order_by(Card.confidence.desc())).all()
        name = clone.expert_name
        projects = (clone.settings or {}).get("projects", {})
        text = "\n".join(f"#{c.id} [{c.type}{', verified' if c.status == 'verified_in_interview' else ''}] "
                         f"{c.title}: {c.body[:200]} ({c.project or 'general'})" for c in cards[:160])
    out = None
    if use_ai and ai.ai_ready():
        try:
            out = ai.call_json("briefing", eid, P.BRIEFING_SYSTEM.format(name=name),
                               f"Projects: {', '.join(projects)}\n\n{text}", P.BRIEFING_SCHEMA, "V2Briefing")
        except ai.LLMError as exc:
            log.warning("briefing fell back to the plain version: %s", exc)
    with SessionLocal() as db:
        cards = db.scalars(select(Card).where(Card.clone_id == eid)).all()
        cmap = {c.id: c for c in cards}
        if out is None:
            out = _plain_briefing(cards, projects)
        will = []
        for w in out.get("will_break", [])[:5]:
            srcs = [s for cid in w.get("card_ids", []) if cid in cmap for s in (cmap[cid].sources or [])[:1]]
            will.append({"title": w["title"], "why": w["why"], "card_ids": [i for i in w.get("card_ids", []) if i in cmap],
                         "sources": srcs[:3]})
        pick = lambda t: [core.card_dict(c) for c in cards if c.type == t][:8]  # noqa: E731
        briefing = {"projects": out.get("projects", []), "open_tasks": pick("open_task"), "contacts": pick("contact"),
                    "routines": pick("routine"), "will_break": will, "made_at": datetime.utcnow().isoformat()}
        clone = db.get(Clone, eid)
        s = dict(clone.settings or {})
        s["briefing"] = briefing
        clone.settings = s
        db.commit()
        return briefing


def _plain_briefing(cards: list[Card], projects: dict) -> dict:
    risky = [c for c in cards if c.type in ("routine", "open_task")] + [c for c in cards if c.type == "process"]
    return {"projects": [{"name": p, "status": "handover needed", "note": (s or "")[:160]} for p, s in projects.items()],
            "will_break": [{"title": c.title, "why": (c.body or "")[:200], "card_ids": [c.id]} for c in risky[:5]]}
