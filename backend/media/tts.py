"""Server-side voice for the interviewer and the setup assistant: ElevenLabs when configured, otherwise the
browser's own voice (free, no key). Each spoken line is kept on disk, so repeated lines (greetings, prompts) play
instantly and cost nothing the second time. The clone never imitates anyone's real voice."""
from __future__ import annotations

import hashlib
import logging

import httpx

from backend.app.config import settings

log = logging.getLogger("cloneflow.tts")
ELEVEN_DEFAULT_VOICE = "EXAVITQu4vr4xnSDxMaL"  # a calm, clear premade voice; TTS_VOICE picks another
ELEVEN_MODEL = "eleven_turbo_v2_5"            # low latency, good for a live conversation


def _cache_path(key: str):
    d = settings.data_dir / "tts"
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{key}.mp3"


def synthesize(text: str) -> tuple[bytes | None, str | None]:
    p = settings.tts_provider
    if p not in ("openai", "elevenlabs") or not settings.tts_api_key:
        return None, None
    voice = settings.tts_voice or (ELEVEN_DEFAULT_VOICE if p == "elevenlabs" else "alloy")
    key = hashlib.sha1(f"{p}|{voice}|{ELEVEN_MODEL}|{text}".encode()).hexdigest()
    cached = _cache_path(key)
    if cached.exists():
        return cached.read_bytes(), "audio/mpeg"
    if p == "openai":
        r = httpx.post("https://api.openai.com/v1/audio/speech",
                       headers={"Authorization": f"Bearer {settings.tts_api_key}"},
                       json={"model": "gpt-4o-mini-tts", "voice": voice, "input": text, "response_format": "mp3"},
                       timeout=60)
    else:
        r = httpx.post(f"https://api.elevenlabs.io/v1/text-to-speech/{voice}",
                       headers={"xi-api-key": settings.tts_api_key, "accept": "audio/mpeg"},
                       params={"output_format": "mp3_44100_128"},
                       json={"text": text, "model_id": ELEVEN_MODEL,
                             "voice_settings": {"stability": 0.5, "similarity_boost": 0.75, "style": 0.15}},
                       timeout=60)
    if r.status_code >= 300:
        log.warning("voice service answered %s: %s", r.status_code, r.text[:200])
        return None, None
    try:
        cached.write_bytes(r.content)
    except OSError:
        pass
    return r.content, "audio/mpeg"
