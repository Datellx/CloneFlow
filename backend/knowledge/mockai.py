"""Offline stand-ins for the model steps (LLM_PROVIDER=mock only). Keyword-based, deterministic, free —
they exist so every screen can be built and tested without spending anything."""
from __future__ import annotations

import re

from backend.app import llm_mock

TYPE_RULES = [
    ("routine", r"every (monday|tuesday|wednesday|thursday|friday|week|morning|day|shift)|weekly|each morning|daily"),
    ("open_task", r"\b(todo|not (yet )?finished|still open|unfinished|pending|wip|draft pr|pull request|half[- ]done)\b"),
    ("contact", r"\b(contact|reach out to|rma|account manager|supplier rep|call (him|her|them))\b"),
    ("location", r"\b(shelf|cabinet|drawer|bench \d|bin [a-z0-9]|rack|cage|bay \d|on the wall|storage room)\b"),
    ("decision", r"\b(decided|because|we chose|switched to|went with|the reason)\b"),
    ("process", r"\b(step \d|first,|then |procedure|how to|calibrat|homing|assemble)\b"),
    ("fact", r"\b(\d+(\.\d+)?\s?(n·m|nm|n-m|mm|v|ma|deg|°)|torque|part number|p/n|spec)\b"),
    ("system", r"\b(firmware|script|dashboard|jira|erp|github|repo|software)\b"),
]


def _type(text: str) -> str:
    t = text.lower()
    for name, rx in TYPE_RULES:
        if re.search(rx, t):
            return name
    return "fact"


def _area(text: str) -> str:
    t = text.lower()
    for kw, area in (("calibrat", "Calibration"), ("firmware", "Firmware"), ("servo", "Servos"),
                     ("supplier", "Suppliers"), ("torque", "Assembly"), ("assembl", "Assembly"),
                     ("gripper", "Gripper"), ("test", "Testing"), ("universit", "Customers"), ("customer", "Customers")):
        if kw in t:
            return area
    return "General"


def extract(text: str, _msgs) -> dict:
    docs = re.split(r"\n?\[S(\d+)\]\s*", text)
    cards, projects = [], {}
    for i in range(1, len(docs) - 1, 2):
        num, body = int(docs[i]), docs[i + 1]
        first = body.strip().split("\n")[0]
        title = re.sub(r"^(Email thread|File|Teams chat in)\s*:?\s*", "", first).strip(" :")[:90] or f"Item {num}"
        rest = " ".join(body.split("\n")[1:])
        sentence = re.split(r"(?<=[.!?])\s", re.sub(r"^—\s*[^:]+:\s*", "", rest.strip()))[0][:240]
        m = re.search(r"\b((?:Project|Line|Program) [A-Z0-9][\w-]{0,20}|[A-Z][a-z]+ v\d)\b", body)
        project = m.group(1).strip() if m else ""
        if project:
            projects.setdefault(project, f"Work on {project} seen in messages")
        quote = " ".join(sentence.split()[:12])
        steps = [s.strip() for s in re.findall(r"(?m)^\s*(?:\d+[.)]|-)\s+(.{6,120})$", body)][:6]
        cards.append({"type": _type(body), "title": title, "body": sentence or title, "steps": steps,
                      "project": project, "area": _area(body),
                      "people": sorted(set(re.findall(r"— ([A-Z][a-z]+ [A-Z][a-z]+)", body)))[:4],
                      "sources": [num], "quote": quote, "confidence": 0.6})
    return {"cards": cards[:14], "projects": [{"name": k, "summary": v} for k, v in projects.items()],
            "personal_sources": []}


GAP_TEMPLATES = {
    "routine": ("missing_why", "You do “{t}” on a schedule, but I couldn't find why anywhere. What happens if it's skipped?"),
    "fact": ("contradiction", "I saw “{t}” in your messages. Is that value still right, or has it changed?"),
    "open_task": ("unfinished_task", "“{t}” looks unfinished. What's left, and who should pick it up?"),
    "process": ("undocumented_step", "For “{t}”, is there a step you always do that isn't written down?"),
    "contact": ("who_to_contact", "For “{t}”, who exactly should your successor contact, and what do they ask for?"),
}


def gaps(text: str, _msgs) -> dict:
    out, seen = [], set()
    for m in re.finditer(r"#(\d+) \[(\w+)\] ([^—\n]+)", text):
        cid, ctype, title = int(m.group(1)), m.group(2), m.group(3).strip()
        if ctype in GAP_TEMPLATES and ctype not in seen:
            seen.add(ctype)
            gt, tpl = GAP_TEMPLATES[ctype]
            out.append({"gap_type": gt, "text": tpl.format(t=title[:70]), "card_ids": [cid],
                        "why_it_matters": "Offline mock gap", "project": ""})
    return {"questions": out[:10]}


def answer(text: str, _msgs) -> dict:
    said = text.split("Employee's answer", 1)[-1].split(":\n", 1)[-1].strip()
    ids = [int(x) for x in re.findall(r"(?m)^#(\d+) \[", text.split("Related cards:", 1)[-1])]
    about = "(about_you" in text
    m = re.search(r"\b(19|20)\d{2}\b", said)
    return {"reply": "Got it — I've added that to your knowledge pack.",
            "updates": [{"card_id": i, "body": said[:400], "steps": [], "status": "verified_in_interview"} for i in ids[:2]],
            "new_cards": [] if ids or about or len(said) < 30 else [{
                "type": "fact", "title": said[:60], "body": said[:400], "steps": [], "project": "", "area": "General",
                "people": [], "sources": [], "quote": "", "confidence": 0.9}],
            "profile": {"started_on": m.group(0) if (about and m) else "", "roles": [], "summary": said[:160] if about else ""}}


def ask(text: str, _msgs) -> dict:
    org = re.findall(r"(?m)^#(\d+) \[\w+; ([^;\]]+?)(?:; (\d{4}))?(; verified[^\]]*)?\] ([^:]+): (.*)$", text)
    if org:  # company-wide question: lead with the verified/current card, add what someone else knew before
        top = next((r for r in org if r[3]), org[0])
        answer = top[5][:400]
        used = [int(top[0])]
        other = next((r for r in org[1:5] if r[1] != top[1]), None)
        if other:
            answer += f" Earlier, {other[1].split()[0]}{' (' + other[2] + ')' if other[2] else ''}: {other[4].strip()}."
            used.append(int(other[0]))
        return {"known": True, "answer": answer, "steps": [], "used_cards": used}
    ids = [int(x) for x in re.findall(r"(?m)^#(\d+) \[", text)]
    m = re.search(r"(?m)^#\d+ \[[^\]]*verified[^\]]*\] ([^:]+): (.*)$", text) or \
        re.search(r"(?m)^#\d+ \[[^\]]+\] ([^:]+): (.*)$", text)
    if not ids or not m:
        return {"known": False, "answer": "", "steps": [], "used_cards": []}
    return {"known": True, "answer": m.group(2)[:400], "steps": [], "used_cards": ids[:2]}


def briefing(text: str, _msgs) -> dict:
    projects = [p.strip() for p in text.split("\n", 1)[0].replace("Projects:", "").split(",") if p.strip()]
    rows = re.findall(r"#(\d+) \[(routine|open_task|process)[^\]]*\] ([^:]+):", text)
    return {"projects": [{"name": p, "status": "handover needed", "note": "Offline mock"} for p in projects],
            "will_break": [{"title": t.strip(), "why": "Offline mock reason", "card_ids": [int(i)]} for i, _, t in rows[:5]]}


def frames(prompt: str, images: list[bytes]) -> dict:
    n = len(images)
    return {"narration_back": "Got it — I saw where things are and the order you showed them.",
            "labels": [f"Frame {i + 1}" for i in range(n)],
            "cards": [{"type": "location", "title": "Shown on the walk", "body": "Offline mock card from the shown frames.",
                       "steps": [], "frames": list(range(min(n, 3))), "area": "Floor"}] if n else []}


def profile(text: str, _msgs) -> dict:
    words = text.split("Their words:", 1)[-1]
    m = re.search(r"\b(19|20)\d{2}\b", words)
    t = re.search(r"(?i)\b(?:i'?m (?:a|an|the)|as (?:a|an|the))\s+([a-z ]{3,40}?)(?:[,.]| at | and |$)", words)
    return {"title": (t.group(1).strip().title() if t else ""), "team": "", "started_on": m.group(0) if m else "",
            "years": 0, "roles": [], "focus": [], "summary": words.strip()[:160],
            "reply": "Thanks — that gives me a clear picture of your role."}


def setup_turn(text: str, _msgs) -> dict:
    """Offline setup assistant: fills the profile in checklist order from the admin's latest answer."""
    import json

    m = re.search(r"Current profile: (\{.*\})", text)
    prof = json.loads(m.group(1)) if m else {}
    said = text.rsplit("\nAdmin: ", 1)[-1].strip() if "\nAdmin: " in text else text.rsplit("Admin: ", 1)[-1].strip()
    already = "Already set up before this turn: True" in text
    people = [{"name": (n or e.split("@")[0].replace(".", " ").title()).strip(" ,-"), "email": e, "title": "",
               "leaving_on": "", "focus": ""}
              for n, e in re.findall(r"([A-Z][a-z]+(?: [A-Z][a-z]+)?)?[\s,(<]*([\w.+-]+@[\w-]+\.[\w.]+)", said)]
    phrases = [p.strip() for p in re.split(r",| and |;", said) if 2 < len(p.strip()) < 60][:5]
    new, reply, done = {}, "", False
    if already:
        reply = "Done." if people else "Got it — anything else you'd like me to set up?"
        done = True
    elif not prof.get("summary"):
        new = {"summary": said[:200], "industry": ""}
        reply = "Thanks. What knowledge are you most afraid of losing when someone leaves?"
    elif not prof.get("critical_areas"):
        new = {"why": said[:200], "critical_areas": phrases or [said[:60]]}
        reply = "Which teams or roles hold the most know-how that isn't written down?"
    elif not prof.get("teams"):
        new = {"teams": phrases or [said[:60]]}
        reply = "Which tools do your people work in — Microsoft 365, Google Workspace, GitHub?"
    elif not prof.get("tools"):
        new = {"tools": phrases or [said[:60]]}
        reply = "Is anyone leaving soon? Tell me their name, work email and last day, and I'll invite them."
    else:
        done = True
        reply = "Your console is ready. I'll focus every interview on what you told me."
    return {"reply": reply, "profile": new, "people": people, "done": done}


llm_mock._HANDLERS.update({"SetupTurn": setup_turn, "V3Profile": profile, "V2Extract": extract, "V2Gaps": gaps, "V2Answer": answer, "V2Ask": ask,
                           "V2Briefing": briefing})
llm_mock.VISION_HANDLERS["V2Frames"] = frames
