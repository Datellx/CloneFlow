"""Prompts and JSON schemas for every model step. Short prompts, compact inputs, strict outputs."""
from __future__ import annotations

from backend.db.models_knowledge import CARD_TYPES, GAP_TYPES

_CARD = {
    "type": "object",
    "properties": {
        "type": {"type": "string", "enum": list(CARD_TYPES)},
        "title": {"type": "string"},
        "body": {"type": "string"},
        "steps": {"type": "array", "items": {"type": "string"}},
        "project": {"type": "string"},
        "area": {"type": "string"},
        "people": {"type": "array", "items": {"type": "string"}},
        "sources": {"type": "array", "items": {"type": "integer"}},
        "quote": {"type": "string"},
        "confidence": {"type": "number"},
    },
    "required": ["type", "title", "body", "steps", "project", "area", "people", "sources", "quote", "confidence"],
}

EXTRACT_SCHEMA = {
    "type": "object",
    "properties": {
        "cards": {"type": "array", "items": _CARD},
        "projects": {"type": "array", "items": {"type": "object", "properties": {
            "name": {"type": "string"}, "summary": {"type": "string"}}, "required": ["name", "summary"]}},
        "personal_sources": {"type": "array", "items": {"type": "integer"}},
    },
    "required": ["cards", "projects", "personal_sources"],
}

EXTRACT_SYSTEM = """You read a departing employee's work messages and files and write knowledge cards for the person
taking over the role. Only write what a successor needs to do the job: how things are done (process, with steps),
why things are the way they are (decision), systems/tools and how to use them (system), who to contact for what
(contact), where physical things are (location), unfinished work (open_task), recurring duties with a schedule
(routine), and hard facts such as specs, values, part numbers (fact).
Rules:
- One card per distinct piece of knowledge. Merge repeats. Skip small talk, scheduling chatter and anything trivial.
- Use the employee's real wording for values (torques, part numbers, dates). Never invent a value or a reason.
- If a reason is not stated in the text, do not make one up; leave the body factual.
- "sources": the [S#] numbers the card comes from. "quote": a short exact phrase (under 20 words) from one source.
- "project": the project it belongs to (use names that appear in the text) or "" if general. "area": a short
  knowledge area like "Calibration", "Firmware", "Suppliers", "Assembly", "Testing", "Customers".
- confidence 0.3–0.95: how clearly the sources support the card.
- personal_sources: the [S#] numbers that are about the employee's private life (family, health, money, dating,
  home). Write NO cards from them and never repeat their content.
Return at most 14 cards for this batch."""

GAPS_SCHEMA = {
    "type": "object",
    "properties": {"questions": {"type": "array", "items": {"type": "object", "properties": {
        "gap_type": {"type": "string", "enum": list(GAP_TYPES)},
        "text": {"type": "string"},
        "card_ids": {"type": "array", "items": {"type": "integer"}},
        "why_it_matters": {"type": "string"},
        "project": {"type": "string"},
    }, "required": ["gap_type", "text", "card_ids", "why_it_matters", "project"]}}},
    "required": ["questions"],
}

GAPS_SYSTEM = """You plan a short exit interview. Below are knowledge cards already captured from the employee's
email, chat and files. Find the gaps a successor would hit, of exactly these kinds:
- missing_why: something is done a certain way but no reason is recorded anywhere
- contradiction: two cards disagree (different values, steps or owners)
- unfinished_task: work started and not finished, with no handover
- undocumented_step: a step everyone relies on that is never written down
- who_to_contact: a dependency on someone outside the team with no contact recorded
Write at most {limit} questions, most important first. Each question is one or two friendly spoken sentences
addressed to the employee ("you"), names the specific thing, and says what you saw (e.g. "In March you set it to
0.4 newton-metres, but the assembly sheet says 0.25 — which is right?"). card_ids: the cards the gap is about.
Never ask about something the cards already answer."""

ANSWER_SCHEMA = {
    "type": "object",
    "properties": {
        "reply": {"type": "string"},
        "updates": {"type": "array", "items": {"type": "object", "properties": {
            "card_id": {"type": "integer"}, "body": {"type": "string"},
            "steps": {"type": "array", "items": {"type": "string"}},
            "status": {"type": "string", "enum": ["verified_in_interview", "contradicted"]}},
            "required": ["card_id", "body", "steps", "status"]}},
        "new_cards": {"type": "array", "items": _CARD},
        "profile": {"type": "object", "properties": {
            "started_on": {"type": "string"},
            "roles": {"type": "array", "items": {"type": "object", "properties": {
                "title": {"type": "string"}, "from": {"type": "string"}, "to": {"type": "string"}},
                "required": ["title", "from", "to"]}},
            "summary": {"type": "string"}}, "required": ["started_on", "roles", "summary"]},
    },
    "required": ["reply", "updates", "new_cards", "profile"],
}

ANSWER_SYSTEM = """You are Milo, a warm interviewer capturing what a departing employee knows for their successor.
Given the question, the cards it is about and the employee's spoken answer:
- updates: rewrite each related card with what the answer adds (keep it concise; add the reason if given;
  steps as short imperative lines). status verified_in_interview, or contradicted if the answer says the card is wrong.
- new_cards: anything new the answer teaches (sources: []), e.g. a contact with name and what to ask them.
- profile: only for "about you" questions — start date (YYYY-MM-DD or YYYY-MM), roles over the years, a one-line
  summary; otherwise return empty values.
- reply: one short spoken sentence acknowledging the specific thing you learned (no questions, no praise filler).
Use only what the employee said. Never invent names, numbers or reasons."""

FRAMES_SCHEMA = {
    "type": "object",
    "properties": {
        "narration_back": {"type": "string"},
        "cards": {"type": "array", "items": {"type": "object", "properties": {
            "type": {"type": "string", "enum": ["process", "location", "system", "fact", "routine"]},
            "title": {"type": "string"}, "body": {"type": "string"},
            "steps": {"type": "array", "items": {"type": "string"}},
            "frames": {"type": "array", "items": {"type": "integer"}},
            "area": {"type": "string"}},
            "required": ["type", "title", "body", "steps", "frames", "area"]}},
        "labels": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["narration_back", "cards", "labels"],
}

FRAMES_PROMPT = """{who} is showing a successor {what}. The {n} images are keyframes in time order (0…{last}).
What {who} said while showing it:
<said>
{said}
</said>
Question being answered: {question}
Return:
- labels: one 2–6 word label per image saying what it shows ("Torque driver on bench 3").
- cards: 1–4 knowledge cards a successor needs (location: where something physically is and how to find it;
  process: ordered steps). "frames": the image indexes that show it. Use only what is visible or said.
- narration_back: one spoken sentence confirming what you understood, starting "Got it —"."""

ASK_SCHEMA = {
    "type": "object",
    "properties": {
        "known": {"type": "boolean"},
        "answer": {"type": "string"},
        "steps": {"type": "array", "items": {"type": "string"}},
        "used_cards": {"type": "array", "items": {"type": "integer"}},
    },
    "required": ["known", "answer", "steps", "used_cards"],
}

ASK_SYSTEM = """You answer a new engineer's question as {name}'s knowledge pack, in {first}'s practical voice
("I usually…"), using ONLY the cards given. If the cards don't answer it, set known=false and say so in one
sentence. Keep it short: 2–4 sentences, plus steps if it is a procedure. used_cards: the card ids you relied on.
If cards disagree, trust the ones verified by the person in the interview, then the most recent.
Never add facts, numbers or names that are not in the cards."""

BRIEFING_SCHEMA = {
    "type": "object",
    "properties": {
        "projects": {"type": "array", "items": {"type": "object", "properties": {
            "name": {"type": "string"}, "status": {"type": "string"}, "note": {"type": "string"}},
            "required": ["name", "status", "note"]}},
        "will_break": {"type": "array", "items": {"type": "object", "properties": {
            "title": {"type": "string"}, "why": {"type": "string"},
            "card_ids": {"type": "array", "items": {"type": "integer"}}},
            "required": ["title", "why", "card_ids"]}},
    },
    "required": ["projects", "will_break"],
}

BRIEFING_SYSTEM = """You write the Day-1 briefing for the person taking over {name}'s role, from the knowledge cards.
projects: each active project with status (one of "on track", "at risk", "blocked", "handover needed") and one
line on what the successor must do first. will_break: exactly the 5 things most likely to break in the first
weeks if ignored (routines with a schedule, open tasks with deadlines, undocumented steps, fragile settings),
each with one plain sentence on why and the card ids. Only use the cards."""
