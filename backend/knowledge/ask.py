"""Ask: answer from the knowledge cards. Retrieval and 'I don't know' are free (local embeddings);
a known answer costs at most one small-model call, and the same question is answered from cache."""
from __future__ import annotations

import hashlib
import re

import numpy as np
from sqlalchemy import func, select

from backend.db.models import Clone, Org
from backend.db.models_knowledge import AskV2, Card
from backend.db.store import SessionLocal
from backend.knowledge.embed import backend_name, embed
from . import ai, core, prompts as P

STOP = set("a an the of to in on for and or is are was were be do does did i we you it how what when where who why "
           "which with at by from my our your this that there their can should would will".split())


def _words(t: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9.]+", (t or "").lower()) if w not in STOP and len(w) > 1}


def qkey(eid: int, question: str, mode: str, version: int) -> str:
    norm = " ".join(sorted(_words(question)))
    return hashlib.sha1(f"{eid}|{mode}|{version}|{norm}".encode()).hexdigest()


def threshold() -> float:
    # Calibrated on a test knowledge pack (bge-small): known questions score ≥ 0.80, off-topic ones ≤ 0.69.
    return 0.74 if backend_name().startswith(("fastembed", "bge")) else 0.22


def retrieve(db, eid: int, question: str, k: int = 6) -> list[tuple[float, Card]]:
    cards = db.scalars(select(Card).where(Card.clone_id == eid, Card.status != "contradicted")).all()
    if not cards:
        return []
    qv = embed([question])[0]
    qw = _words(question)
    scored = []
    for c in cards:
        if not c.embedding:
            continue
        cos = float(np.dot(qv, np.asarray(c.embedding, dtype=np.float32)))
        cw = _words(f"{c.title} {c.body} {' '.join(c.steps or [])}")
        overlap = len(qw & cw) / max(1, len(qw))
        bonus = 0.08 if c.status == "verified_in_interview" else 0.0
        if not c.sources:  # placeholder / unproven cards never outrank real knowledge
            bonus -= 0.25
        scored.append((cos + 0.15 * overlap + bonus, c))
    scored.sort(key=lambda x: -x[0])
    return scored[:k]


def _version(db, eid: int) -> int:
    n = db.scalar(select(func.count()).select_from(Card).where(Card.clone_id == eid)) or 0
    latest = db.scalar(select(func.max(Card.updated_at)).where(Card.clone_id == eid))
    return hash((n, str(latest))) & 0xFFFFFF


def ask(eid: int, question: str, mode: str = "question", user_id: int | None = None, allow_ai: bool = True) -> dict:
    with SessionLocal() as db:
        clone = db.get(Clone, eid)
        name, first = clone.expert_name, clone.expert_name.split()[0]
        if mode == "takeover":
            return _takeover(db, clone, question, user_id)
        key = qkey(eid, question, mode, _version(db, eid)) + ("" if allow_ai and ai.ai_ready() else "x")
        hit = db.scalar(select(AskV2).where(AskV2.clone_id == eid, AskV2.qkey == key).limit(1))
        if hit:
            ans = dict(hit.answer)
            ans.update({"id": hit.id, "question": question, "cached": True, "cost_usd": 0.0})
            return ans
        top = retrieve(db, eid, question)
        best = top[0][0] if top else 0.0
        good = [c for s, c in top if s >= threshold() - 0.08][:5]
        snapshot = [(c.id, c.type, c.title, c.body, c.steps, c.status) for c in good]
        cards_by_id = {c.id: c for c in good}
    known = best >= threshold() and bool(good)
    cost = 0.0
    answer, steps, used = "", [], []
    if known and ai.ai_ready() and allow_ai:
        user = "Cards:\n" + "\n".join(f"#{i} [{t}{', verified by ' + first if st == 'verified_in_interview' else ''}] "
                                      f"{ti}: {b}{' Steps: ' + '; '.join(sp) if sp else ''}"
                                      for i, t, ti, b, sp, st in snapshot) + f"\n\nQuestion: {question}"
        from backend.app.llm import USAGE

        before = USAGE.snapshot()["cost_usd"]
        out = ai.call_json("ask", eid, P.ASK_SYSTEM.format(name=name, first=first), user, P.ASK_SCHEMA, "V2Ask")
        cost = round(USAGE.snapshot()["cost_usd"] - before, 5)
        known = bool(out.get("known")) and bool(out.get("answer"))
        answer, steps = out.get("answer", ""), out.get("steps", [])
        used = [i for i in out.get("used_cards", []) if i in cards_by_id] or [snapshot[0][0]]
    elif known:  # AI off / read-only site: answer straight from the best card, no model
        # prefer what the person confirmed in the interview when it's nearly as relevant
        verified = [x for x in snapshot[:3] if x[5] == "verified_in_interview"]
        cid, _, title, body, sp, _ = verified[0] if verified else snapshot[0]
        answer, steps, used = body or title, sp or [], [cid]
    with SessionLocal() as db:
        used_cards = [db.get(Card, i) for i in used if db.get(Card, i)]
        proofs = []
        for c in used_cards:
            for s in c.sources or []:
                if len(proofs) < 6 and s not in proofs:
                    proofs.append(s)
        images = [s["frame_url"] for s in proofs if s.get("frame_url")][:4]
        ask_person = None
        if not known:
            answer = (f"I don't know — {first} never covered this in email, chat, files or the interview, "
                      f"so I won't guess.")
            ask_person = _who_to_ask(db, eid, question, clone_name=name)
            _remember_unknown(db, eid, question)
        proofs = [{**p, "eid": eid} for p in proofs]
        result = {"question": question, "known": known, "answer": answer, "steps": steps, "eid": eid,
                  "cards": [core.card_dict(c) for c in used_cards], "proofs": proofs,
                  "verified": any(c.status == "verified_in_interview" for c in used_cards),
                  "ask_person": ask_person, "images": images, "cached": False, "cost_usd": cost,
                  "mode": mode, "score": round(best, 3)}
        row = AskV2(clone_id=eid, user_id=user_id, question=question, qkey=key, answer=result)
        db.add(row)
        db.commit()
        result["id"] = row.id
        return result


def _who_to_ask(db, eid: int, question: str, clone_name: str) -> dict:
    contacts = db.scalars(select(Card).where(Card.clone_id == eid, Card.type == "contact")).all()
    contacts = [c for c in contacts if c.related_people and c.embedding]
    if contacts:
        qv = embed([question])[0]
        scored = sorted(((float(np.dot(qv, np.asarray(c.embedding))), c) for c in contacts), key=lambda x: -x[0])
        if scored[0][0] >= threshold() - 0.15:
            best = scored[0][1]
            person = best.related_people[0]
            return {"name": person, "why": best.title, "email": _email_for(db, eid, person)}
    clone = db.get(Clone, eid)
    if clone.escalate_name:
        return {"name": clone.escalate_name, "why": f"{clone_name.split()[0]}'s manager",
                "email": _email_for(db, eid, clone.escalate_name)}
    return {"name": clone_name, "why": "Ask before their last day", "email": None}


def _email_for(db, eid: int, name: str) -> str | None:
    from backend.db.models_knowledge import SourceItem

    if not name:
        return None
    hit = db.scalar(select(SourceItem.author_email).where(SourceItem.clone_id == eid, SourceItem.kind == "mail",
                                                          SourceItem.author.ilike(f"%{name.strip()}%"),
                                                          SourceItem.author_email != "").limit(1))
    return hit or None


def _remember_unknown(db, eid: int, question: str) -> None:
    clone = db.get(Clone, eid)
    s = dict(clone.settings or {})
    u = list(s.get("unanswered", []))
    if question not in u:
        u.append(question[:300])
    s["unanswered"] = u[-50:]
    clone.settings = s


def _takeover(db, clone: Clone, question: str, user_id: int | None) -> dict:
    b = (clone.settings or {}).get("briefing")
    first = clone.expert_name.split()[0]
    if not b:
        return {"id": None, "question": question, "known": False, "mode": "takeover",
                "answer": f"The takeover briefing is made when {first}'s interview is finished.", "steps": [],
                "cards": [], "proofs": [], "verified": False, "ask_person": None, "images": [], "cached": True,
                "cost_usd": 0.0, "briefing": None}
    steps = [f"{w['title']} — {w['why']}" for w in b.get("will_break", [])]
    proofs = [s for w in b.get("will_break", []) for s in w.get("sources", [])][:6]
    return {"id": None, "question": question, "known": True, "mode": "takeover",
            "answer": f"Here's what you need to take over {first}'s role. Five things will break if you ignore them:",
            "steps": steps, "cards": b.get("open_tasks", [])[:3] + b.get("routines", [])[:2], "proofs": proofs,
            "verified": True, "ask_person": None, "images": [], "cached": True, "cost_usd": 0.0, "briefing": b}


ORG_SYSTEM = """You answer a colleague's question from {org}'s captured knowledge — what people who left or are leaving
knew. Use ONLY the cards given; each says whose knowledge it is and when. Answer in 2–4 plain sentences, plus steps
if it's a procedure. Say whose knowledge it is and when when that helps ("In 2019 Amy fixed this by…"). For how things
are done today, trust cards verified in an exit interview and the most recent ones. If the cards don't answer the
question, set known=false. used_cards: the card ids you relied on. Never add facts, numbers or names not in the cards."""

_DATE = re.compile(r"([A-Z][a-z]{2} \d{2}, (\d{4}))")


def _card_year(c: Card) -> str:
    years = [m.group(2) for s in (c.sources or []) for m in [_DATE.search(s.get("label", ""))] if m]
    return max(years) if years else ""


def ask_org(org_id: int, question: str, user_id: int | None = None, allow_ai: bool = True) -> dict:
    """'Ask everyone': search every captured pack in the organization (local, free), then answer once from the best
    cards across people — so history ("Amy solved this in 2019") and current practice come together."""
    with SessionLocal() as db:
        clones = {c.id: c for c in db.scalars(select(Clone).where(Clone.org_id == org_id))}
        pool = []
        for c in clones.values():
            for sc, card in retrieve(db, c.id, question, k=3):
                pool.append((sc, card))
        pool.sort(key=lambda x: -x[0])
        if not pool:
            return {"id": None, "question": question, "known": False, "mode": "question", "eid": None,
                    "answer": "No one's knowledge has been captured yet.", "steps": [], "cards": [], "proofs": [],
                    "verified": False, "ask_person": None, "images": [], "cached": False, "cost_usd": 0.0}
        best_score, best_card = pool[0]
        best_eid = best_card.clone_id
        per: dict[int, int] = {}
        good = []
        for sc, card in pool:
            if sc < threshold() - 0.08 or len(good) >= 6 or per.get(card.clone_id, 0) >= 4:
                continue
            per[card.clone_id] = per.get(card.clone_id, 0) + 1
            good.append(card)
        version = sum(_version(db, e) for e in per) & 0xFFFFFF
        key = "org" + qkey(org_id, question, "org", version)[:56] + ("" if allow_ai and ai.ai_ready() else "x")
        hit = db.scalar(select(AskV2).where(AskV2.clone_id == best_eid, AskV2.qkey == key).limit(1))
        if hit:
            ans = dict(hit.answer)
            ans.update({"id": hit.id, "question": question, "cached": True, "cost_usd": 0.0})
            return ans
        snap = [(c.id, c.type, c.title, c.body, c.steps, c.status, clones[c.clone_id].expert_name, _card_year(c))
                for c in good]
        org_name = db.get(Org, clones[best_eid].org_id).name
    known = best_score >= threshold() and bool(snap)
    answer, steps, used, cost = "", [], [], 0.0
    if known and ai.ai_ready() and allow_ai:
        from backend.app.llm import USAGE

        user = "Cards:\n" + "\n".join(
            f"#{i} [{t}; {who}{'; ' + yr if yr else ''}{'; verified in exit interview' if st == 'verified_in_interview' else ''}] "
            f"{ti}: {b}{' Steps: ' + '; '.join(sp) if sp else ''}" for i, t, ti, b, sp, st, who, yr in snap) + \
            f"\n\nQuestion: {question}"
        before = USAGE.snapshot()["cost_usd"]
        out = ai.call_json("ask", best_eid, ORG_SYSTEM.format(org=org_name), user, P.ASK_SCHEMA, "V2Ask")
        cost = round(USAGE.snapshot()["cost_usd"] - before, 5)
        known = bool(out.get("known")) and bool(out.get("answer"))
        answer, steps = out.get("answer", ""), out.get("steps", [])
        valid = {x[0] for x in snap}
        used = [i for i in out.get("used_cards", []) if i in valid] or [snap[0][0]]
    elif known:  # no model: the best card (verified first), plus what someone else knew about it
        verified = [x for x in snap[:3] if x[5] == "verified_in_interview"]
        top = verified[0] if verified else snap[0]
        answer, steps, used = top[3] or top[2], top[4] or [], [top[0]]
        other = next((x for x in snap[1:4] if x[6] != top[6]), None)
        if other:
            answer += f" Earlier, {other[6].split()[0]}{' (' + other[7] + ')' if other[7] else ''}: {other[2]}."
            used.append(other[0])
    with SessionLocal() as db:
        used_cards = [db.get(Card, i) for i in used if db.get(Card, i)]
        proofs = []
        for c in used_cards:
            who = clones[c.clone_id].expert_name.split()[0]
            for src in (c.sources or [])[:3]:
                if len(proofs) < 6:
                    proofs.append({**src, "eid": c.clone_id, "label": f"{who} · {src.get('label', '')}"})
        names = list(dict.fromkeys(clones[c.clone_id].expert_name for c in used_cards))
        ask_person = None
        if not known:
            answer = "I don't know — no one covered this in what they left behind, so I won't guess."
            ask_person = _who_to_ask(db, best_eid, question, clone_name=clones[best_eid].expert_name)
            _remember_unknown(db, best_eid, question)
        result = {"question": question, "known": known, "answer": answer, "steps": steps,
                  "eid": used_cards[0].clone_id if used_cards else best_eid,
                  "from_name": " and ".join(n.split()[0] for n in names) if names else clones[best_eid].expert_name,
                  "people": names, "cards": [core.card_dict(c) for c in used_cards], "proofs": proofs,
                  "verified": any(c.status == "verified_in_interview" for c in used_cards), "ask_person": ask_person,
                  "images": [p["frame_url"] for p in proofs if p.get("frame_url")][:4], "cached": False,
                  "cost_usd": cost, "mode": "question", "score": round(best_score, 3)}
        row = AskV2(clone_id=best_eid, user_id=user_id, question=question, qkey=key, answer=result)
        db.add(row)
        db.commit()
        result["id"] = row.id
        return result
