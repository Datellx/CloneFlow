"""Offline stand-in for the model, used ONLY when LLM_PROVIDER=mock (tests and local development without a key).
Each structured step registers a small deterministic handler (see backend/knowledge/mockai.py)."""
from __future__ import annotations

_HANDLERS: dict = {}         # schema name -> fn(last_user_text, messages) -> dict
VISION_HANDLERS: dict = {}   # schema name -> fn(prompt, images) -> dict


def _last_user(messages: list[dict]) -> str:
    for m in reversed(messages):
        if m["role"] == "user":
            c = m["content"]
            return c if isinstance(c, str) else " ".join(x.get("text", "") for x in c if isinstance(x, dict))
    return ""


def chat(messages: list[dict], name: str = "chat") -> str:
    return "(Offline mode) Connect the Meta Model API to get real answers."


def transcribe(wav: bytes) -> str:
    return "(offline transcript — connect the Meta Model API for real speech recognition)"


def json(messages: list[dict], schema: dict, name: str):
    fn = _HANDLERS.get(name)
    if fn is None:
        raise ValueError(f"offline mode has no handler for {name}")
    return fn(_last_user(messages), messages)


def vision_json(prompt: str, images: list[bytes], schema: dict, name: str):
    fn = VISION_HANDLERS.get(name)
    if fn is None:
        raise ValueError(f"offline mode has no vision handler for {name}")
    return fn(prompt, images)
