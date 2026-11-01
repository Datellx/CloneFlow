"""Feature flags and model routing — the only place model names and optional features are set.

Override any flag with an environment variable FLAG_<NAME>=1/0.
"""
from __future__ import annotations

import os

FEATURE_FLAGS: dict[str, bool] = {
    "premium_voice": False,         # ElevenLabs/OpenAI narrator (browser voice by default)
}
for _name in list(FEATURE_FLAGS):
    _v = os.environ.get(f"FLAG_{_name.upper()}")
    if _v is not None:
        FEATURE_FLAGS[_name] = _v.strip().lower() in {"1", "true", "yes", "on"}


def flag(name: str) -> bool:
    return FEATURE_FLAGS.get(name, False)


# Route by task. "small" = fast and cheap (low reasoning effort); "large" = gap analysis and synthesis only.
_BASE = os.environ.get("CLOUD_MODEL", "muse-spark-1.3")
MODELS = {
    "small": {"model": _BASE, "reasoning_effort": "low"},
    "large": {"model": _BASE, "reasoning_effort": "high"},
    "vision": {"model": _BASE, "reasoning_effort": "low"},
    "transcribe": {"model": os.environ.get("TRANSCRIBE_MODEL", "muse-voice-transcribe-1.0")},
}

# Which tier each pipeline step uses (shown in docs and the cost meter).
STEP_TIER = {
    "extract": "small",      # knowledge cards from email/chat/file chunks (batched)
    "gaps": "large",         # interview plan per project cluster
    "answer_cards": "small", # interview answer → card updates
    "frames": "vision",      # keyframes + nearby transcript → location/step cards
    "screen_narration": "vision",
    "ask": "small",          # compose an answer from retrieved cards
    "briefing": "large",     # Day-1 takeover briefing, generated once
    "setup": "small",        # the admin's setup conversation (one call per turn)
    "transcribe": "transcribe",
}
