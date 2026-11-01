"""Floor walk: the laptop shows a QR code; the phone streams camera frames + what the employee says.

Keyframe rules (free, on the server): keep the first frame, then a frame only when the picture changed enough
(perceptual-hash distance ≥ 12 of 64 bits) or 8 s passed since the last kept frame with some change (≥ 6).
Faces are blurred locally before storage. One vision call at the end turns ≤ 10 keyframes + the transcript into
location / step cards.
"""
from __future__ import annotations

import io
import secrets
from datetime import datetime, timedelta
from pathlib import Path

import cv2
import numpy as np
from sqlalchemy import func, select

from backend.app.config import settings
from backend.db.models import Clone
from backend.db.models_knowledge import InterviewV2, QuestionV2, WalkFrame, WalkSession
from backend.db.store import SessionLocal
from . import ai, interview as IV, prompts as P

MAX_FRAMES = 30
SEND_FRAMES = 10


def phash(img: np.ndarray) -> str:
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    small = cv2.resize(g, (32, 32), interpolation=cv2.INTER_AREA).astype(np.float32)
    d = cv2.dct(small)[:8, :8].flatten()
    med = np.median(d[1:])
    bits = "".join("1" if v > med else "0" for v in d)
    return f"{int(bits, 2):016x}"


def hamming(a: str, b: str) -> int:
    return bin(int(a, 16) ^ int(b, 16)).count("1")


def qr_svg(url: str) -> str:
    import segno

    buf = io.BytesIO()
    segno.make(url, error="m").save(buf, kind="svg", scale=6, border=2, dark="#5B1420", light="#ffffff")
    return buf.getvalue().decode()


def create(iid: int, qid: int | None) -> dict:
    with SessionLocal() as db:
        if qid is None:  # the question on screen
            iv = db.get(InterviewV2, iid)
            q = db.scalar(select(QuestionV2).where(QuestionV2.interview_id == iid, QuestionV2.index == iv.current_index))
            qid = q.id if q else None
        token = secrets.token_urlsafe(18)
        ws = WalkSession(interview_id=iid, question_id=qid, token=token, status="waiting",
                         expires_at=datetime.utcnow() + timedelta(hours=2))
        db.add(ws)
        db.commit()
    url = f"{settings.public_url.rstrip('/')}/walk/{token}"
    return {"token": token, "url": url, "qr_svg": qr_svg(url)}


def get_session(db, token: str) -> WalkSession | None:
    ws = db.scalar(select(WalkSession).where(WalkSession.token == token))
    if ws is None or ws.expires_at < datetime.utcnow():
        return None
    return ws


def info(token: str) -> dict | None:
    with SessionLocal() as db:
        ws = get_session(db, token)
        if ws is None:
            return None
        iv = db.get(InterviewV2, ws.interview_id)
        clone = db.get(Clone, iv.clone_id)
        q = db.get(QuestionV2, ws.question_id) if ws.question_id else None
        n = db.scalar(select(func.count()).select_from(WalkFrame).where(WalkFrame.session_id == ws.id)) or 0
        return {"employee_name": clone.expert_name, "question": IV.question_dict(db, q) if q else None,
                "status": ws.status, "frames": n}


def add_frame(token: str, data: bytes, t: float, transcript_chunk: str = "") -> dict:
    with SessionLocal() as db:
        ws = get_session(db, token)
        if ws is None:
            raise LookupError("This walk link has expired. Scan the new code on the laptop.")
        if ws.status == "finished":
            return {"kept": False, "reason": "finished"}
        ws.status = "live"
        if transcript_chunk.strip():
            ws.transcript = (ws.transcript + " " + transcript_chunk.strip()).strip()
        img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            db.commit()
            return {"kept": False, "reason": "unreadable"}
        h = phash(img)
        last = db.scalar(select(WalkFrame).where(WalkFrame.session_id == ws.id).order_by(WalkFrame.seq.desc()).limit(1))
        n = db.scalar(select(func.count()).select_from(WalkFrame).where(WalkFrame.session_id == ws.id)) or 0
        reason = None
        if last is None:
            reason = "first"
        elif n < MAX_FRAMES:
            dist = hamming(h, last.phash)
            if dist >= 12:
                reason = "scene"
            elif t - last.t >= 8 and dist >= 6:
                reason = "time"
        if reason is None:
            if last is not None and transcript_chunk.strip():
                last.transcript = (last.transcript + " " + transcript_chunk.strip()).strip()
            db.commit()
            return {"kept": False, "reason": "similar"}
        iv = db.get(InterviewV2, ws.interview_id)
        out = IV.media_dir(iv.clone_id, f"walk/{ws.token[:10]}")
        path = out / f"frame_{n:03d}_{t:07.2f}.jpg"
        scale = 1280 / max(img.shape[:2])
        if scale < 1:
            img = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
        cv2.imwrite(str(path), img, [cv2.IMWRITE_JPEG_QUALITY, 85])
        from backend.media import frames as vf

        for box in vf.local_faces(path):
            vf.blur_boxes(path, [box])
        db.add(WalkFrame(session_id=ws.id, seq=n + 1, t=t, path=str(path), phash=h, reason=reason,
                         transcript=transcript_chunk.strip()))
        ws.last_hash = h
        db.commit()
        return {"kept": True, "reason": reason, "seq": n + 1}


def add_audio(token: str, data: bytes, suffix: str = ".webm") -> dict:
    """Optional paid path: server-side transcription (the phone page uses the free browser recognizer first)."""
    from backend.media import audio as va

    with SessionLocal() as db:
        ws = get_session(db, token)
        if ws is None:
            raise LookupError("This walk link has expired.")
        iv = db.get(InterviewV2, ws.interview_id)
        eid = iv.clone_id
    wav, secs = va.bytes_to_wav(data, settings.data_dir / "uploads" / "walk", suffix)
    text = ai.transcribe(eid, wav, secs)
    with SessionLocal() as db:
        ws = get_session(db, token)
        ws.transcript = (ws.transcript + " " + text).strip()
        last = db.scalar(select(WalkFrame).where(WalkFrame.session_id == ws.id).order_by(WalkFrame.seq.desc()).limit(1))
        if last:
            last.transcript = (last.transcript + " " + text).strip()
        db.commit()
    return {"transcript": text}


def feed(iid: int, after: int = 0) -> dict:
    with SessionLocal() as db:
        ws = db.scalar(select(WalkSession).where(WalkSession.interview_id == iid).order_by(WalkSession.id.desc()).limit(1))
        if ws is None:
            return {"items": [], "status": "none", "done": False}
        frames = db.scalars(select(WalkFrame).where(WalkFrame.session_id == ws.id, WalkFrame.seq > after)
                            .order_by(WalkFrame.seq)).all()
        return {"status": ws.status, "done": ws.status == "finished", "token": ws.token, "transcript": ws.transcript,
                "items": [{"seq": f.seq, "frame_url": IV.media_url(Path(f.path)), "label": f.label,
                           "transcript": f.transcript, "reason": f.reason, "at": f.at.isoformat()} for f in frames]}


def finish(token: str) -> dict:
    with SessionLocal() as db:
        ws = get_session(db, token)
        if ws is None:
            raise LookupError("This walk link has expired.")
        iv = db.get(InterviewV2, ws.interview_id)
        eid = iv.clone_id
        who = db.get(Clone, eid).expert_name.split()[0]
        q = db.get(QuestionV2, ws.question_id) if ws.question_id else None
        frames = db.scalars(select(WalkFrame).where(WalkFrame.session_id == ws.id).order_by(WalkFrame.seq)).all()
        if len(frames) > SEND_FRAMES:
            idx = np.linspace(0, len(frames) - 1, SEND_FRAMES).round().astype(int)
            frames = [frames[i] for i in sorted(set(idx))]
        sel = [(f.id, Path(f.path), f.t, f.transcript) for f in frames]
        said = ws.transcript or " ".join(f.transcript for f in frames)
        qid, qtext, project = (q.id, q.text, q.project) if q else (None, "Show the floor", None)
        ws.status = "finished"
        db.commit()
    if not sel:
        return {"new_cards": [], "narration_back": ""}
    images = [p.read_bytes() for _, p, _, _ in sel]
    said_lines = "\n".join(f"[frame {i}] {tr}" for i, (_, _, _, tr) in enumerate(sel) if tr) or said
    prompt = P.FRAMES_PROMPT.format(who=who, what="the shop floor on a phone camera", n=len(images),
                                    last=len(images) - 1, said=ai.redact(said_lines or "(silent)"), question=qtext)
    out = ai.call_vision("frames", eid, prompt, images, P.FRAMES_SCHEMA, "V2Frames")
    labels = out.get("labels") or []
    chips = []
    with SessionLocal() as db:
        for i, (fid, p, t, _) in enumerate(sel):
            label = labels[i] if i < len(labels) else f"Frame {i + 1}"
            f = db.get(WalkFrame, fid)
            f.label = label[:200]
            chips.append({"kind": "floor", "ref": IV.media_url(p), "label": f"Floor walk · {label}",
                          "frame_url": IV.media_url(p), "timestamp_s": round(t, 1)})
        db.commit()
    ids = IV._frame_cards(eid, out, chips, "floor", project)
    if qid:
        res = IV.answer_link(qid, said, "floor", ids, out.get("narration_back", ""))
        return {"new_cards": res["new_cards"], "narration_back": out.get("narration_back", ""), "coverage": res["coverage"]}
    from backend.db.models_knowledge import Card
    from . import core

    with SessionLocal() as db:
        return {"new_cards": [core.card_dict(c) for c in db.scalars(select(Card).where(Card.id.in_(ids)))],
                "narration_back": out.get("narration_back", "")}
