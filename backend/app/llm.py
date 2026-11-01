"""Model client for the Meta Model API (OpenAI-compatible wire format).

One object handles chat, schema-constrained JSON, vision and speech-to-text, with:
  * a concurrency cap and exponential backoff with jitter (honours Retry-After),
  * schema validation with one retry (the API constrains decoding, but sampling
    providers such as hosted Glimmer do not),
  * a usage ledger so every run can report tokens and cost.

`LLM_PROVIDER=mock` swaps in an offline heuristic provider (backend/app/llm_mock.py)
so the UI can be developed without network access. Evaluation refuses to run on it.
"""
from __future__ import annotations

import base64
import json
import logging
import random
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

import httpx

from .config import settings

log = logging.getLogger("cloneflow.llm")

# USD per 1M tokens (input, cached input, output). Reasoning tokens bill as output.
PRICES = {
    "muse-spark-1.3": (1.25, 0.15, 4.25),
    "muse-spark-1.3-contributor": (0.10, 0.002, 0.20),
    "meta-models/Muse-Glimmer-30B": (0.35, 0.35, 1.50),
}


class LLMError(RuntimeError):
    pass


@dataclass
class Usage:
    calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    audio_seconds: float = 0.0
    images: int = 0
    by_model: dict = field(default_factory=dict)
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def add(self, model: str, inp: int, out: int, cached: int = 0) -> None:
        p = PRICES.get(model, PRICES["muse-spark-1.3"])
        cost = ((inp - cached) * p[0] + cached * p[1] + out * p[2]) / 1e6
        _emit(model, inp, out, cost)
        with self.lock:
            self.calls += 1
            self.input_tokens += inp
            self.output_tokens += out
            self.cost_usd += cost
            m = self.by_model.setdefault(model, {"calls": 0, "in": 0, "out": 0, "cost": 0.0})
            m["calls"] += 1
            m["in"] += inp
            m["out"] += out
            m["cost"] += cost

    def snapshot(self) -> dict:
        with self.lock:
            return {
                "calls": self.calls,
                "input_tokens": self.input_tokens,
                "output_tokens": self.output_tokens,
                "cost_usd": round(self.cost_usd, 4),
                "audio_seconds": round(self.audio_seconds, 1),
                "images": self.images,
                "by_model": json.loads(json.dumps(self.by_model)),
            }


USAGE = Usage()

# ---------------------------------------------------------------- per-step metering
# The current pipeline step (and employee) is thread-local; every recorded call is attributed to it and
# forwarded to optional sinks (backend/knowledge/ai.py persists it to the cost log).
_meter = threading.local()
COST_SINKS: list = []


class metered:
    """with metered("extract", eid): ... — attribute model spend in this thread to a step."""

    def __init__(self, step: str, eid: int | None = None) -> None:
        self.step, self.eid = step, eid

    def __enter__(self):
        self.prev = (getattr(_meter, "step", None), getattr(_meter, "eid", None))
        _meter.step, _meter.eid = self.step, self.eid
        return self

    def __exit__(self, *exc):
        _meter.step, _meter.eid = self.prev
        return False


def in_step(step: str, eid: int | None, fn):
    """Wrap fn so it runs inside metered(step, eid) — for thread-pool workers."""
    def _run(*a, **k):
        with metered(step, eid):
            return fn(*a, **k)
    return _run


def _emit(model: str, inp: int, out: int, cost: float, seconds: float = 0.0) -> None:
    step, eid = getattr(_meter, "step", None) or "other", getattr(_meter, "eid", None)
    for sink in COST_SINKS:
        try:
            sink(step=step, eid=eid, model=model, input_tokens=inp, output_tokens=out, usd=cost, audio_s=seconds)
        except Exception:  # metering must never break a call
            log.debug("cost sink failed", exc_info=True)


# ---------------------------------------------------------------- validation
def validate(obj: Any, schema: dict, path: str = "$") -> list[str]:
    """Small JSON-schema validator covering what our schemas use."""
    errs: list[str] = []
    t = schema.get("type")
    if "enum" in schema and obj not in schema["enum"]:
        errs.append(f"{path}: {obj!r} not in {schema['enum']}")
        return errs
    if t == "object":
        if not isinstance(obj, dict):
            return [f"{path}: expected object"]
        for k in schema.get("required", []):
            if k not in obj:
                errs.append(f"{path}.{k}: missing")
        for k, sub in schema.get("properties", {}).items():
            if k in obj and obj[k] is not None:
                errs += validate(obj[k], sub, f"{path}.{k}")
    elif t == "array":
        if not isinstance(obj, list):
            return [f"{path}: expected array"]
        for i, item in enumerate(obj):
            errs += validate(item, schema.get("items", {}), f"{path}[{i}]")
    elif t == "string" and not isinstance(obj, str):
        errs.append(f"{path}: expected string")
    elif t == "integer" and not (isinstance(obj, int) and not isinstance(obj, bool)):
        if isinstance(obj, float) and obj.is_integer():
            return errs
        errs.append(f"{path}: expected integer")
    elif t == "number" and not isinstance(obj, (int, float)):
        errs.append(f"{path}: expected number")
    elif t == "boolean" and not isinstance(obj, bool):
        errs.append(f"{path}: expected boolean")
    return errs


def _coerce(obj: Any, schema: dict) -> Any:
    """Fix harmless type slips (e.g. 3.0 for an integer)."""
    t = schema.get("type")
    if t == "integer" and isinstance(obj, float) and obj.is_integer():
        return int(obj)
    if t == "object" and isinstance(obj, dict):
        return {k: _coerce(v, schema.get("properties", {}).get(k, {})) for k, v in obj.items()}
    if t == "array" and isinstance(obj, list):
        return [_coerce(v, schema.get("items", {})) for v in obj]
    return obj


def _extract_json(text: str) -> Any:
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text[text.find("\n") + 1:] if "\n" in text else text
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    for open_c, close_c in (("{", "}"), ("[", "]")):
        s, e = text.find(open_c), text.rfind(close_c)
        if s != -1 and e > s:
            try:
                return json.loads(text[s:e + 1])
            except json.JSONDecodeError:
                continue
    raise LLMError("model did not return JSON")


# ---------------------------------------------------------------- client
class LLM:
    def __init__(self, provider: str | None = None, model: str | None = None) -> None:
        self.provider = provider or settings.llm_provider
        self._sem = threading.BoundedSemaphore(settings.max_concurrency)
        self._client = None
        if self.provider == "meta":
            from openai import OpenAI

            if not settings.model_api_key:
                raise LLMError("The AI engine is not configured on this server yet (MODEL_API_KEY).")
            self._client = OpenAI(base_url=settings.model_base_url, api_key=settings.model_api_key,
                                  max_retries=0, timeout=180)
            self.model = model or settings.chat_model
        elif self.provider == "mock":
            from . import llm_mock

            self._mock = llm_mock
            self.model = "mock"
        else:
            raise LLMError(f"unknown LLM provider {self.provider}")

    # -- retry wrapper -------------------------------------------------------
    def _with_retry(self, fn: Callable[[], Any], attempts: int = 6) -> Any:
        if self.provider == "meta" and not settings.ai_enabled:
            raise LLMError("AI is turned off on this server.")
        delay = 1.0
        for i in range(attempts):
            try:
                with self._sem:
                    return fn()
            except Exception as exc:  # openai / httpx errors
                status = getattr(exc, "status_code", None) or getattr(getattr(exc, "response", None), "status_code", None)
                retryable = status in (408, 409, 429, 500, 502, 503, 504) or status is None and "timeout" in str(exc).lower()
                if not retryable or i == attempts - 1:
                    raise LLMError(f"{type(exc).__name__}: {exc}") from exc
                wait = delay
                resp = getattr(exc, "response", None)
                if resp is not None:
                    ra = resp.headers.get("retry-after")
                    if ra:
                        try:
                            wait = max(wait, float(ra))
                        except ValueError:
                            pass
                time.sleep(wait + random.uniform(0, wait / 2))
                delay = min(delay * 2, 30)
        raise LLMError("unreachable")

    def _record(self, resp: Any) -> None:
        u = getattr(resp, "usage", None)
        if not u:
            return
        inp = getattr(u, "prompt_tokens", None) or getattr(u, "input_tokens", 0) or 0
        out = getattr(u, "completion_tokens", None) or getattr(u, "output_tokens", 0) or 0
        details = getattr(u, "prompt_tokens_details", None) or getattr(u, "input_tokens_details", None)
        cached = getattr(details, "cached_tokens", 0) if details else 0
        USAGE.add(self.model, int(inp), int(out), int(cached or 0))

    # -- chat ------------------------------------------------------------------
    def chat(self, messages: list[dict], *, temperature: float | None = None, max_tokens: int | None = None,
             reasoning_effort: str | None = None, name: str = "chat") -> str:
        if self.provider == "mock":
            return self._mock.chat(messages, name=name)
        kwargs: dict[str, Any] = {"model": self.model, "messages": messages}
        if temperature is not None:
            kwargs["temperature"] = temperature
        if max_tokens:
            kwargs["max_tokens"] = max_tokens
        if reasoning_effort and self.provider == "meta":
            kwargs["reasoning_effort"] = reasoning_effort

        def call():
            try:
                return self._client.chat.completions.create(**kwargs)
            except Exception as exc:
                # Some deployments reject reasoning_effort; retry once without it.
                if "reasoning_effort" in kwargs and "reasoning" in str(exc).lower():
                    kwargs.pop("reasoning_effort")
                    return self._client.chat.completions.create(**kwargs)
                raise

        resp = self._with_retry(call)
        self._record(resp)
        return resp.choices[0].message.content or ""

    def json(self, messages: list[dict], schema: dict, name: str, *, temperature: float | None = None,
             max_tokens: int | None = None, reasoning_effort: str | None = None) -> Any:
        """Schema-constrained JSON. Validates and retries once with the error fed back."""
        if self.provider == "mock":
            out = self._mock.json(messages, schema, name)
            errs = validate(out, schema)
            if errs:
                raise LLMError(f"mock {name} invalid: {errs[:3]}")
            return out
        msgs = list(messages)
        last_err = ""
        for attempt in range(2):
            kwargs: dict[str, Any] = {
                "model": self.model,
                "messages": msgs,
                "response_format": {"type": "json_schema", "json_schema": {"name": name, "schema": schema}},
            }
            if temperature is not None:
                kwargs["temperature"] = temperature
            if max_tokens:
                kwargs["max_tokens"] = max_tokens
            if reasoning_effort and self.provider == "meta":
                kwargs["reasoning_effort"] = reasoning_effort

            def call(kw=kwargs):
                try:
                    return self._client.chat.completions.create(**kw)
                except Exception as exc:
                    msg = str(exc).lower()
                    if "reasoning_effort" in kw and "reasoning" in msg:
                        kw.pop("reasoning_effort")
                        return self._client.chat.completions.create(**kw)
                    if "response_format" in msg or "json_schema" in msg:
                        # Provider without structured output: fall back to instructions.
                        kw.pop("response_format", None)
                        kw["messages"] = kw["messages"] + [{"role": "user", "content":
                            "Reply with only JSON matching this schema:\n" + json.dumps(schema)}]
                        return self._client.chat.completions.create(**kw)
                    raise

            resp = self._with_retry(call)
            self._record(resp)
            text = resp.choices[0].message.content or ""
            try:
                obj = _coerce(_extract_json(text), schema)
                errs = validate(obj, schema)
                if not errs:
                    return obj
                last_err = "; ".join(errs[:5])
            except LLMError as exc:
                last_err = str(exc)
            msgs = messages + [
                {"role": "assistant", "content": text[:4000]},
                {"role": "user", "content": f"That output was invalid ({last_err}). Return corrected JSON only."},
            ]
        raise LLMError(f"{name}: invalid JSON after retry: {last_err}")

    def samples(self, fn: Callable[[], Any], n: int) -> list[Any]:
        """Run n independent samples in parallel; failed samples are dropped."""
        with ThreadPoolExecutor(max_workers=min(n, settings.max_concurrency)) as ex:
            futs = [ex.submit(fn) for _ in range(n)]
            out = []
            for f in futs:
                try:
                    out.append(f.result())
                except Exception as exc:  # keep partial results
                    log.warning("sample failed: %s", exc)
            return out

    # -- vision ------------------------------------------------------------------
    def vision_json(self, prompt: str, images: list[bytes], schema: dict, name: str,
                    *, system: str | None = None) -> Any:
        """Image(s) + prompt → schema JSON. Up to 50 images per request."""
        if self.provider == "mock":
            return self._mock.vision_json(prompt, images, schema, name)
        urls = []
        for img in images[:50]:
            b64 = base64.b64encode(img).decode()
            mime = "image/png" if img[:4] == b"\x89PNG" else "image/jpeg"
            urls.append(f"data:{mime};base64,{b64}")
        USAGE.images += len(urls)
        if self.provider == "meta" and not getattr(self, "_responses_unsupported", False):
            # The documented image pattern: Responses API with input_image parts.
            try:
                return self._vision_responses(prompt, urls, schema, name, system)
            except LLMError as exc:
                if "404" in str(exc) or "not found" in str(exc).lower() or "unsupported" in str(exc).lower():
                    self._responses_unsupported = True
                else:
                    log.info("responses vision call failed (%s); retrying via chat completions", exc)
        content: list[dict] = [{"type": "text", "text": prompt}] + [
            {"type": "image_url", "image_url": {"url": u}} for u in urls]
        msgs = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": content}]
        return self.json(msgs, schema, name)

    def _vision_responses(self, prompt: str, urls: list[str], schema: dict, name: str, system: str | None) -> Any:
        parts = [{"type": "input_text", "text": prompt + "\nReturn only JSON matching this schema:\n" + json.dumps(schema)}]
        parts += [{"type": "input_image", "image_url": u} for u in urls]
        inp = ([{"type": "message", "role": "system", "content": system}] if system else []) + [
            {"type": "message", "role": "user", "content": parts}]

        def call():
            try:
                return self._client.responses.create(
                    model=self.model, input=inp,
                    text={"format": {"type": "json_schema", "name": name, "schema": schema}})
            except Exception as exc:
                if "format" in str(exc).lower() or "json_schema" in str(exc).lower():
                    return self._client.responses.create(model=self.model, input=inp)
                raise

        resp = self._with_retry(call, attempts=4)
        self._record(resp)
        text = getattr(resp, "output_text", None) or ""
        obj = _coerce(_extract_json(text), schema)
        errs = validate(obj, schema)
        if errs:
            raise LLMError(f"{name}: invalid JSON from responses API: {errs[:3]}")
        return obj

    # -- speech ------------------------------------------------------------------
    def transcribe(self, wav: bytes, keywords: list[str] | None = None, seconds: float = 0.0) -> str:
        if self.provider == "mock":
            return self._mock.transcribe(wav)
        req = {"mode": "PUSH_TO_TALK", "model": settings.transcribe_model, "audioEncoding": "WAV"}
        if keywords:
            req["keywords"] = keywords[:50]

        def call():
            r = httpx.post(
                settings.model_base_url.rstrip("/") + "/asr/transcribe",
                headers={"Authorization": f"Bearer {settings.model_api_key}"},
                files={"request": (None, json.dumps(req), "application/json"),
                       "audio": ("answer.wav", wav, "audio/wav")},
                timeout=120,
            )
            if r.status_code >= 400:
                err = httpx.HTTPStatusError(r.text[:500], request=r.request, response=r)
                err.status_code = r.status_code  # type: ignore[attr-defined]
                raise err
            return r

        r = self._with_retry(call)
        USAGE.audio_seconds += seconds
        _emit(settings.transcribe_model, 0, 0, seconds / 3600 * 0.18, seconds)
        return _transcript_text(r)


def _transcript_text(r: httpx.Response) -> str:
    """The transcription response shape is parsed leniently (text, transcript or turns)."""
    try:
        data = r.json()
    except ValueError:
        # Possibly newline-delimited JSON events.
        parts = []
        for line in r.text.splitlines():
            line = line.strip()
            if line.startswith("data:"):
                line = line[5:].strip()
            try:
                parts.append(_text_from(json.loads(line)))
            except ValueError:
                continue
        return " ".join(p for p in parts if p).strip()
    return _text_from(data).strip()


def _text_from(data: Any) -> str:
    if isinstance(data, str):
        return data
    if isinstance(data, list):
        return " ".join(_text_from(x) for x in data)
    if isinstance(data, dict):
        for key in ("text", "transcript", "transcription"):
            if isinstance(data.get(key), str):
                return data[key]
        for key in ("turns", "results", "segments", "utterances", "data"):
            if key in data:
                return _text_from(data[key])
    return ""


_default: LLM | None = None
_lock = threading.Lock()


def get_llm() -> LLM:
    global _default
    with _lock:
        if _default is None:
            _default = LLM()
        return _default


def image_bytes(path: str | Path) -> bytes:
    return Path(path).read_bytes()
