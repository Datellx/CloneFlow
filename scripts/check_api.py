"""Checks every Meta Model API capability Clone Flow uses.

    python -m scripts.check_api

Prints PASS/FAIL per capability with the reason, and the model IDs the key can see.
Costs a few cents at most.
"""
from __future__ import annotations

import base64
import io
import json
import math
import struct
import sys
import time
import wave

import httpx

from backend.app.config import settings
from backend.app.schemas import DECISION_SCHEMA

OK, BAD = "\033[32mPASS\033[0m", "\033[31mFAIL\033[0m"
results: list[tuple[str, bool, str]] = []


def check(name):
    def deco(fn):
        t = time.time()
        try:
            msg = fn() or ""
            results.append((name, True, f"{msg} ({time.time() - t:.1f}s)"))
        except Exception as exc:
            results.append((name, False, f"{type(exc).__name__}: {str(exc)[:300]}"))
        return fn
    return deco


def headers():
    return {"Authorization": f"Bearer {settings.model_api_key}"}


if not settings.model_api_key:
    print("MODEL_API_KEY (or META_MODEL_API) is not set in .env.local")
    sys.exit(1)

base = settings.model_base_url.rstrip("/")
models: list[str] = []


@check("List models (GET /v1/models)")
def _():
    r = httpx.get(f"{base}/models", headers=headers(), timeout=30)
    r.raise_for_status()
    data = r.json().get("data", [])
    models.extend(m.get("id") for m in data)
    want = [settings.cloud_model, f"{settings.cloud_model}-contributor", settings.transcribe_model, settings.sam_model]
    missing = [m for m in want if m not in models]
    return f"{len(models)} models" + (f"; not listed: {missing}" if missing else "; all expected models listed")


from openai import OpenAI  # noqa: E402

client = OpenAI(base_url=base, api_key=settings.model_api_key)


@check("Schema-constrained JSON (muse-spark-1.3)")
def _():
    resp = client.chat.completions.create(
        model=settings.chat_model,
        messages=[{"role": "system", "content": "Extract one decision record. Use only facts in the event."},
                  {"role": "user", "content": "From: John\nThe customer (tier-1) wants a go-live date. We're in build. "
                                              "I'm holding the date until engineering signs off; counter-proposing a window."}],
        response_format={"type": "json_schema", "json_schema": {"name": "DecisionRecord", "schema": DECISION_SCHEMA}},
    )
    rec = json.loads(resp.choices[0].message.content)
    u = resp.usage
    return f"choice={rec.get('choice')} type={rec.get('decision_type')} tokens in/out={u.prompt_tokens}/{u.completion_tokens}"


@check("reasoning_effort=high accepted")
def _():
    resp = client.chat.completions.create(model=settings.chat_model, reasoning_effort="high",
                                          messages=[{"role": "user", "content": "Reply with the word ok."}])
    return resp.choices[0].message.content[:20]


def _png() -> bytes:
    import cv2
    import numpy as np

    img = np.full((200, 400, 3), 255, np.uint8)
    cv2.putText(img, "Password: Hunter2!", (10, 110), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 0), 2)
    return cv2.imencode(".png", img)[1].tobytes()


@check("Image understanding with grounding boxes")
def _():
    b64 = base64.b64encode(_png()).decode()
    resp = client.chat.completions.create(model=settings.chat_model, messages=[{"role": "user", "content": [
        {"type": "text", "text": "Locate the password in this image. Return JSON {\"regions\":[{\"label\":str,\"box\":[x0,y0,x1,y1]}]} on a 0-1000 grid."},
        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}}]}])
    return resp.choices[0].message.content[:120]


def _wav() -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(b"".join(struct.pack("<h", int(3000 * math.sin(2 * math.pi * 440 * i / 24000))) for i in range(24000)))
    return buf.getvalue()


@check("Speech to text (muse-voice-transcribe-1.0)")
def _():
    req = {"mode": "PUSH_TO_TALK", "model": settings.transcribe_model, "audioEncoding": "WAV"}
    r = httpx.post(f"{base}/asr/transcribe", headers=headers(), timeout=60,
                   files={"request": (None, json.dumps(req), "application/json"), "audio": ("a.wav", _wav(), "audio/wav")})
    if r.status_code >= 400:
        raise RuntimeError(f"HTTP {r.status_code}: {r.text[:300]}")
    return f"HTTP {r.status_code}; response shape: {r.text[:160]!r}"


print()
for name, ok, msg in results:
    print(f"{OK if ok else BAD}  {name}\n      {msg}")
print()
if models:
    print("Models visible to this key:", ", ".join(models[:40]))
sys.exit(0 if all(ok for n, ok, _ in results if "optional" not in n and "Glimmer" not in n) else 1)
