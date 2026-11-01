"""Optional server-side text-to-speech. Default is the browser's own voice (free, no
key). Set TTS_PROVIDER=openai or elevenlabs with TTS_API_KEY for a premium voice.
The clone never imitates the expert's voice: a neutral narrator reads answers."""
from __future__ import annotations

import httpx

from backend.app.config import settings


def synthesize(text: str) -> tuple[bytes | None, str | None]:
    p = settings.tts_provider
    if p == "openai" and settings.tts_api_key:
        r = httpx.post("https://api.openai.com/v1/audio/speech",
                       headers={"Authorization": f"Bearer {settings.tts_api_key}"},
                       json={"model": "gpt-4o-mini-tts", "voice": settings.tts_voice or "alloy", "input": text,
                             "response_format": "mp3"}, timeout=60)
        r.raise_for_status()
        return r.content, "audio/mpeg"
    if p == "elevenlabs" and settings.tts_api_key:
        voice = settings.tts_voice or "21m00Tcm4TlvDq8ikWAM"
        r = httpx.post(f"https://api.elevenlabs.io/v1/text-to-speech/{voice}",
                       headers={"xi-api-key": settings.tts_api_key, "accept": "audio/mpeg"},
                       json={"text": text, "model_id": "eleven_turbo_v2_5"}, timeout=60)
        r.raise_for_status()
        return r.content, "audio/mpeg"
    return None, None
