"""'Read everything' — the one place the AI reads the inbox, chat and files.

Cost discipline (spec rule: spend once at capture, almost nothing at ask time):
  1. code filters noise, quotes, signatures, duplicates and excluded items (free)
  2. surviving threads are packed into ~9k-character batches → one small-model call per batch
  3. cards are de-duplicated with local embeddings (free)
  4. ONE large-model call plans the interview gaps over all cards (max 10 questions)
"""
from __future__ import annotations

import logging
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

from sqlalchemy import delete, func, select

from backend.db.models import Clone
from backend.db.models_knowledge import Card, FeedItem, InterviewV2, QuestionV2, Run, SourceItem
from backend.db.store import SessionLocal
from backend.knowledge.embed import cosine, embed
from . import ai, clean as C, core, prompts as P

log = logging.getLogger("cloneflow.capture")
BATCH_CHARS = 9000
DOC_CHARS = 3500
MAX_GAPS = 10


_running: dict[int, int] = {}
_lock = threading.Lock()

GAP_LABEL = {"missing_why": "Missing why", "contradiction": "Contradiction", "unfinished_task": "Unfinished",
             "undocumented_step": "Undocumented step", "who_to_contact": "No contact"}
COUNTER_FOR = {"process": "processes", "system": "systems", "contact": "contacts", "decision": "decisions",
               "open_task": "open_tasks", "routine": "routines", "location": "locations", "fact": "facts"}


# ---------------------------------------------------------------- feed helpers
class Feed:
    def __init__(self, run_id: int):
        self.run_id = run_id
        self.seq = 0
        self.lock = threading.Lock()

    def add(self, type_: str, title: str, detail: str = "", source_kind: str = "", card_id: int | None = None):
        with self.lock, SessionLocal() as db:
            self.seq += 1
            db.add(FeedItem(run_id=self.run_id, seq=self.seq, type=type_, title=title[:300], detail=detail[:500],
                            source_kind=source_kind, card_id=card_id))
            db.commit()


def _update_run(run_id: int, **fields) -> None:
    with SessionLocal() as db:
        r = db.get(Run, run_id)
        counters = fields.pop("counters", None)
        for k, v in fields.items():
            setattr(r, k, v)
        if counters:
            r.counters = {**(r.counters or {}), **counters}
        db.commit()


def _bump(run_id: int, lock: threading.Lock, **inc) -> None:
    with lock, SessionLocal() as db:
        r = db.get(Run, run_id)
        c = dict(r.counters or {})
        for k, v in inc.items():
            c[k] = c.get(k, 0) + v
        r.counters = c
        db.commit()


# ---------------------------------------------------------------- documents
def _docs(db, eid: int) -> tuple[list[dict], dict]:
    """Group surviving items into documents (a thread, a chat thread, a file)."""
    from backend.db.models_knowledge import SourceConsent

    allowed = {"email": "mail", "chat": "chat", "files": "file"}
    kinds = [allowed[c.kind] for c in db.scalars(select(SourceConsent).where(
        SourceConsent.clone_id == eid, SourceConsent.consent.is_(True))) if c.kind in allowed]
    items = db.scalars(select(SourceItem).where(SourceItem.clone_id == eid, SourceItem.kind.in_(kinds))
                       .order_by(SourceItem.sent_at)).all()
    stats = {"read": len(items), "personal": 0, "filtered_out": 0, "excluded": 0, "duplicates": 0,
             "emails": 0, "chats": 0, "files": 0, "noise_reasons": {}}
    threads: dict[tuple, list[SourceItem]] = {}
    seen: set[tuple] = set()
    for it in items:
        if it.excluded:
            stats["excluded"] += 1
            continue
        if it.is_noise and it.noise_reason == "Personal":
            stats["personal"] += 1
            continue
        if it.is_noise:
            stats["filtered_out"] += 1
            stats["noise_reasons"][it.noise_reason] = stats["noise_reasons"].get(it.noise_reason, 0) + 1
            continue
        fp = (it.thread_key, C.fingerprint(it.clean))
        if fp in seen or not (it.clean or "").strip():
            stats["duplicates"] += 1
            continue
        seen.add(fp)
        stats[{"mail": "emails", "chat": "chats", "file": "files"}[it.kind]] += 1
        threads.setdefault((it.kind, it.thread_key), []).append(it)
    # Recurring messages (same sender, same subject apart from dates/numbers — e.g. a quarterly reminder): the
    # newest two teach everything the rest would, so only those reach the AI.
    recurring: dict[tuple, list] = {}
    for key, its in threads.items():
        if key[0] == "mail":
            norm = re.sub(r"(?i)\b(re|fwd?|q[1-4])\b|[\d:/.\-]+|\(.*?\)", " ", its[0].title or "").lower()
            recurring.setdefault((its[0].author_email, " ".join(norm.split())), []).append(key)
    for group in recurring.values():
        if len(group) > 2:
            group.sort(key=lambda k: threads[k][-1].sent_at or datetime.min)
            for k in group[:-2]:
                dropped = threads.pop(k)
                stats["duplicates"] += len(dropped)
                stats["emails"] -= len(dropped)
    docs = []
    for (kind, _), its in threads.items():
        if kind == "file":
            it = its[0]
            if (it.meta or {}).get("file_kind") in ("image", "video") or not it.clean.strip():
                continue
            text = f"File: {it.container}/{it.title}\n{it.clean[:DOC_CHARS]}"
        elif kind == "mail":
            parts = [f"Email thread: {its[0].title}"]
            for it in its:
                d = it.sent_at.strftime("%Y-%m-%d") if it.sent_at else ""
                parts.append(f"— {it.author} ({d}): {it.clean[:1400]}")
            text = "\n".join(parts)[:DOC_CHARS]
        else:
            ch = (its[0].meta or {}).get("channel_name") or its[0].title
            parts = [f"Teams chat in {ch}:"]
            for it in its:
                d = it.sent_at.strftime("%Y-%m-%d") if it.sent_at else ""
                parts.append(f"{it.author} ({d}): {it.clean[:800]}")
            text = "\n".join(parts)[:DOC_CHARS]
        docs.append({"kind": kind, "items": [(i.id, i.clean) for i in its], "text": ai.redact(text)})
    return docs, stats


def _batches(docs: list[dict]) -> list[list[dict]]:
    out, cur, size = [], [], 0
    for d in docs:
        if cur and size + len(d["text"]) > BATCH_CHARS:
            out.append(cur)
            cur, size = [], 0
        cur.append(d)
        size += len(d["text"])
    if cur:
        out.append(cur)
    return out


def _source_item(doc: dict, quote: str) -> int:
    q = re.sub(r"\s+", " ", (quote or "").lower()).strip()[:60]
    if q:
        for iid, text in doc["items"]:
            if q in re.sub(r"\s+", " ", (text or "").lower()):
                return iid
    return doc["items"][-1][0]


# ---------------------------------------------------------------- project names (free)
def project_aliases(names: list[str]) -> dict[str, str]:
    """'Driftless State University pilot' and 'Driftless State pilot' are one project: map each name to the
    shortest name whose words it contains."""
    def words(n):
        return {w for w in re.findall(r"[a-z0-9#]+", n.lower()) if w not in ("the", "project", "a", "of")}
    out = {}
    for n in names:
        best = n
        for m in names:
            if m != n and words(m) and words(m) <= words(n) and len(m) < len(best):
                best = m
        out[n] = best
    return out


def merge_projects(eid: int) -> dict[str, str]:
    with SessionLocal() as db:
        clone = db.get(Clone, eid)
        s = dict(clone.settings or {})
        projects = dict(s.get("projects") or {})
        names = sorted(set(projects) | {p for (p,) in db.execute(select(Card.project).where(Card.clone_id == eid)) if p})
        alias = project_aliases(names)
        for c in db.scalars(select(Card).where(Card.clone_id == eid, Card.project.is_not(None))):
            if alias.get(c.project, c.project) != c.project:
                c.project = alias[c.project]
                c.related_projects = [alias.get(p, p) for p in c.related_projects or []]
        merged = {}
        for n, summary in projects.items():
            merged.setdefault(alias.get(n, n), summary)
        s["projects"] = merged
        clone.settings = s
        db.commit()
        return alias


# ---------------------------------------------------------------- run
def start(eid: int) -> int:
    with _lock:
        if eid in _running:
            return _running[eid]
        with SessionLocal() as db:
            r = Run(clone_id=eid, status="running", stage="filter", counters={})
            db.add(r)
            c = db.get(Clone, eid)
            core.set_status(c, "reading")
            db.commit()
            rid = r.id
        _running[eid] = rid
    threading.Thread(target=_guard, args=(_run, eid, rid), daemon=True, name=f"capture-{eid}").start()
    return rid


def _guard(fn, eid: int, rid: int) -> None:
    try:
        fn(eid, rid)
    except Exception as exc:
        log.exception("capture failed")
        with SessionLocal() as db:
            r = db.get(Run, rid)
            r.status, r.error, r.finished_at = "failed", str(exc)[:2000], datetime.utcnow()
            c = db.get(Clone, eid)
            core.set_status(c, "read" if db.scalar(select(func.count()).select_from(Card).where(Card.clone_id == eid)) else "not_started")
            db.commit()
    finally:
        with _lock:
            _running.pop(eid, None)


def _clear_previous(db, eid: int) -> None:
    db.execute(delete(Card).where(Card.clone_id == eid, Card.origin == "read"))
    for iv in db.scalars(select(InterviewV2).where(InterviewV2.clone_id == eid)):
        db.delete(iv)


def _run(eid: int, rid: int) -> None:
    t0 = time.time()
    feed = Feed(rid)
    lock = threading.Lock()
    with SessionLocal() as db:
        _clear_previous(db, eid)
        db.commit()
        clone = db.get(Clone, eid)
        name = clone.expert_name
        org_areas = sorted({a for (a,) in db.execute(
            select(Card.area).join(Clone, Clone.id == Card.clone_id)
            .where(Clone.org_id == clone.org_id, Card.clone_id != eid)) if a and a != "General"})
        docs, stats = _docs(db, eid)
    area_hint = f"\nCompany knowledge areas (use one when it fits): {', '.join(org_areas)}" if org_areas else ""
    _update_run(rid, stage="filter", progress=0.05, counters={
        "read": stats["read"], "filtered_out": stats["filtered_out"] + stats["duplicates"] + stats["excluded"],
        "emails": stats["emails"], "chats": stats["chats"], "files": stats["files"],
        "personal_skipped": stats["personal"]})
    feed.add("note", f"Read {stats['read']} items", f"{stats['emails']} emails · {stats['chats']} chat messages · "
             f"{stats['files']} files kept", "")
    if stats["filtered_out"]:
        why = ", ".join(f"{n} {k.lower()}" for k, n in sorted(stats["noise_reasons"].items(), key=lambda x: -x[1])[:3])
        feed.add("note", f"Skipped {stats['filtered_out']} items that aren't knowledge", why)
    if stats["personal"]:
        feed.add("note", f"Masked {stats['personal']} personal messages", "Family, health, money — never sent to the AI")
    if stats["excluded"]:
        feed.add("note", f"Left out {stats['excluded']} items you excluded", "Never sent to the AI")

    # ---- extract
    batches = _batches(docs)
    _update_run(rid, stage="extract", progress=0.1)
    raw_cards: list[dict] = []
    projects: dict[str, str] = {}
    done = 0

    def work(batch: list[dict]):
        body = "\n\n".join(f"[S{i + 1}] {d['text']}" for i, d in enumerate(batch))
        out = ai.call_json("extract", eid, P.EXTRACT_SYSTEM, f"Employee: {name}{area_hint}\n\n{body}", P.EXTRACT_SCHEMA, "V2Extract")
        return batch, out

    with ThreadPoolExecutor(max_workers=6) as ex:
        futs = [ex.submit(work, b) for b in batches]
        for f in as_completed(futs):
            batch, out = f.result()
            done += 1
            for p in out.get("projects", []):
                if p["name"] and p["name"] not in projects:
                    projects[p["name"]] = p["summary"]
                    feed.add("project", p["name"], p["summary"][:200])
            personal = {n for n in out.get("personal_sources", []) if 1 <= n <= len(batch)}
            if personal:
                _mark_personal([iid for n in personal for iid, _ in batch[n - 1]["items"]])
                _bump(rid, lock, personal_skipped=sum(len(batch[n - 1]["items"]) for n in personal))
            for c in out.get("cards", []):
                if set(c.get("sources", [])) & personal:
                    continue
                srcs = []
                for s in c.get("sources", []):
                    if 1 <= s <= len(batch):
                        srcs.append(_source_item(batch[s - 1], c.get("quote", "")))
                if not srcs:
                    continue
                c["_items"] = list(dict.fromkeys(srcs))
                raw_cards.append(c)
                cid = _save_card(eid, c)
                c["_id"] = cid
                kind = _first_kind(c["_items"])
                feed.add(c["type"], c["title"], c["body"][:180], kind, cid)
                _bump(rid, lock, **{COUNTER_FOR.get(c["type"], "facts"): 1})
            _update_run(rid, progress=0.1 + 0.65 * done / max(1, len(batches)))

    # ---- link (local, free)
    _update_run(rid, stage="link", progress=0.78)
    merged = _dedupe(eid)
    alias = merge_projects(eid) if projects else {}
    projects = {alias.get(k, k): v for k, v in projects.items()}
    if merged:
        feed.add("note", f"Merged {merged} duplicate cards", "Same knowledge seen in several places")
    people = _people_count(eid)
    _bump(rid, lock, projects=len(projects), people=people)

    # ---- gaps (one large call)
    _update_run(rid, stage="gaps", progress=0.85)
    feed.add("note", "Looking for what's missing", "Reasons, contradictions, unfinished work, contacts")
    n_gaps = plan_interview(eid, projects, stats)
    with SessionLocal() as db:
        iv = core.latest_interview(db, eid)
        for q in db.scalars(select(QuestionV2).where(QuestionV2.interview_id == iv.id, QuestionV2.kind == "gap")
                            .order_by(QuestionV2.index)):
            feed.add("gap", f"{GAP_LABEL.get(q.gap_type, 'Gap')}: {q.text}"[:300], q.project or "",
                     (q.evidence or [{}])[0].get("kind", ""), (q.card_ids or [None])[0])
    feed.add("note", f"Found {n_gaps} things only {name.split()[0]} can tell us", "They become the interview")

    with SessionLocal() as db:
        cov = core.coverage(db, eid)
        cost = _run_cost(db, eid, t0)
        r = db.get(Run, rid)
        r.status, r.stage, r.progress, r.coverage, r.gaps = "done", "done", 1.0, cov, n_gaps
        r.cost_usd, r.finished_at = cost, datetime.utcnow()
        c = db.get(Clone, eid)
        s = dict(c.settings or {})
        s["projects"] = projects
        s["capture_cost_usd"] = cost
        c.settings = s
        core.set_status(c, "read")
        db.commit()
    feed.add("note", f"Coverage {cov}%", "Ready for the interview")


def _mark_personal(item_ids: list[int]) -> None:
    with SessionLocal() as db:
        db.query(SourceItem).filter(SourceItem.id.in_(item_ids)).update(
            {"is_noise": True, "noise_reason": "Personal", "clean": ""}, synchronize_session=False)
        db.commit()


def _first_kind(item_ids: list[int]) -> str:
    with SessionLocal() as db:
        it = db.get(SourceItem, item_ids[0])
        return core.KIND_TO_SOURCE.get(it.kind, "") if it else ""


def _save_card(eid: int, c: dict, origin: str = "read", sources: list[dict] | None = None,
               status: str = "inferred") -> int:
    with SessionLocal() as db:
        if sources is None:
            sources = []
            for iid in c.get("_items", []):
                it = db.get(SourceItem, iid)
                if it:
                    sources.append(core.chip_for_item(it, c.get("quote", "") if not sources else ""))
        card = Card(clone_id=eid, type=c["type"], title=c["title"][:300], body=c.get("body", ""),
                    steps=c.get("steps", []), project=c.get("project") or None, area=(c.get("area") or "General")[:200],
                    sources=sources, confidence=max(0.0, min(1.0, float(c.get("confidence", 0.6)))), status=status,
                    related_people=c.get("people", []), related_projects=[c["project"]] if c.get("project") else [],
                    embedding=embed([f"{c['title']}. {c.get('body', '')}"])[0].round(5).tolist(), origin=origin)
        db.add(card)
        db.commit()
        return card.id


def _dedupe(eid: int) -> int:
    merged = 0
    with SessionLocal() as db:
        cards = db.scalars(select(Card).where(Card.clone_id == eid, Card.origin == "read").order_by(Card.id)).all()
        alive: list[Card] = []
        for c in cards:
            dup = next((a for a in alive if a.type == c.type and a.embedding and c.embedding
                        and cosine(a.embedding, c.embedding) > 0.92), None)
            if dup is None:
                alive.append(c)
                continue
            refs = {s["ref"] for s in dup.sources}
            dup.sources = dup.sources + [s for s in c.sources if s["ref"] not in refs]
            dup.confidence = min(0.95, max(dup.confidence, c.confidence) + 0.05)
            dup.related_people = sorted(set(dup.related_people) | set(c.related_people))
            if len(c.steps or []) > len(dup.steps or []):
                dup.steps = c.steps
            db.query(FeedItem).filter(FeedItem.card_id == c.id).update({"card_id": dup.id})
            db.delete(c)
            merged += 1
        db.commit()
    return merged


def _people_count(eid: int) -> int:
    with SessionLocal() as db:
        names = set()
        for (p,) in db.execute(select(Card.related_people).where(Card.clone_id == eid)):
            names |= {x.strip() for x in (p or []) if x.strip()}
        return len(names)


def _run_cost(db, eid: int, t0: float) -> float:
    from backend.db.models_knowledge import CostLog

    since = datetime.utcfromtimestamp(t0 - 1)
    return round(db.scalar(select(func.coalesce(func.sum(CostLog.usd), 0.0)).where(
        CostLog.clone_id == eid, CostLog.at >= since)) or 0.0, 4)


# ---------------------------------------------------------------- interview plan
ABOUT_YOU = [
    "Let's start with you, {first}. When did you join, and what roles have you had here over the years?",
    "Which projects took most of your time, and which one should your successor pick up first?",
]


def opening_line(first: str, stats: dict, n_gaps: int, years: int | None) -> str:
    span = f" from your {years} years here" if years else ""
    return (f"Hi {first} — I've read {stats.get('emails', 0)} emails, {stats.get('chats', 0)} chat messages and "
            f"{stats.get('files', 0)} files{span}. Most of it is captured. There are {n_gaps} things only you can "
            f"tell me. First, a little about you.")


def plan_interview(eid: int, projects: dict, stats: dict) -> int:
    with SessionLocal() as db:
        clone = db.get(Clone, eid)
        first = clone.expert_name.split()[0]
        cards = db.scalars(select(Card).where(Card.clone_id == eid).order_by(Card.id)).all()
        lines = []
        for c in cards:
            when = ", ".join(s["label"].split(" · ")[-1] for s in (c.sources or [])[:2])
            lines.append(f"#{c.id} [{c.type}] {c.title} — {c.body[:220]}"
                         f"{' Steps: ' + '; '.join(c.steps[:5]) if c.steps else ''} ({c.project or 'general'}; {when})")
        user = (f"Employee: {clone.expert_name}, {clone.title}\nProjects: {', '.join(projects) or 'unknown'}\n\n"
                + "\n".join(lines))
        years = clone.years_at_company
    out = ai.call_json("gaps", eid, P.GAPS_SYSTEM.format(limit=MAX_GAPS), user, P.GAPS_SCHEMA, "V2Gaps")
    qs = out.get("questions", [])[:MAX_GAPS]
    with SessionLocal() as db:
        valid = {i for (i,) in db.execute(select(Card.id).where(Card.clone_id == eid))}
        iv = InterviewV2(clone_id=eid, status="not_started", opening_line=opening_line(first, stats, len(qs), years))
        db.add(iv)
        db.flush()
        idx = 0
        for t in ABOUT_YOU:
            db.add(QuestionV2(interview_id=iv.id, index=idx, kind="about_you", text=t.format(first=first), evidence=[]))
            idx += 1
        for q in qs:
            ids = [i for i in q.get("card_ids", []) if i in valid][:4]
            ev: list[dict] = []
            for cid in ids:
                for s in (db.get(Card, cid).sources or [])[:2]:
                    if s["ref"] not in {e["ref"] for e in ev}:
                        ev.append(s)
            db.add(QuestionV2(interview_id=iv.id, index=idx, kind="gap", gap_type=q["gap_type"], text=q["text"],
                              evidence=ev[:4], project=q.get("project") or None, card_ids=ids))
            idx += 1
        db.flush()
        iv.coverage_before = core.coverage(db, eid)
        db.commit()
    return len(qs)


def run_dict(r: Run) -> dict:
    return {"id": r.id, "status": r.status, "stage": r.stage, "progress": round(r.progress or 0, 3),
            "counters": r.counters or {}, "coverage": r.coverage, "gaps": r.gaps,
            "error": r.error, "started_at": core.iso(r.started_at),
            "finished_at": core.iso(r.finished_at)}


# ---------------------------------------------------------------- estimate before spending
def estimate(eid: int) -> dict:
    """What 'Read everything' would cost, computed locally before any call (shown for approval)."""
    from backend.app.llm import PRICES

    with SessionLocal() as db:
        docs, stats = _docs(db, eid)
    batches = _batches(docs)
    p_in, _, p_out = PRICES["muse-spark-1.3"]
    sys_tok = len(P.EXTRACT_SYSTEM) // 4 + 400  # + schema
    in_tok = sum(sum(len(d["text"]) for d in b) // 4 + sys_tok for b in batches)
    out_tok = len(batches) * (14 * 110 + 700)  # cards + low-effort reasoning
    cards_est = min(len(docs), len(batches) * 10)
    gap_in = len(P.GAPS_SYSTEM) // 4 + cards_est * 70
    gap_out = 1500 + 4000  # questions + high-effort reasoning
    usd = (in_tok + gap_in) * p_in / 1e6 + (out_tok + gap_out) * p_out / 1e6
    return {"items": stats["read"], "kept": stats["emails"] + stats["chats"] + stats["files"],
            "filtered_out": stats["filtered_out"] + stats["duplicates"] + stats["excluded"],
            "noise_reasons": stats["noise_reasons"], "documents": len(docs), "calls": len(batches) + 1,
            "input_tokens": in_tok + gap_in, "output_tokens": out_tok + gap_out,
            "usd_low": round(usd * 0.7, 2), "usd_high": round(usd * 1.4, 2), "usd": round(usd, 2)}
