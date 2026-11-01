"""The Meta client against a local fake OpenAI-compatible server: request wiring,
429 retry with Retry-After, schema validation with a corrective retry, Responses-API
vision with chat fallback, and lenient transcription parsing."""
from __future__ import annotations

import json
import os
import threading
import time

import pytest
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

PORT = 8765
STATE = {"chat_calls": 0, "rate_limited": False, "bad_once": True, "responses_calls": 0}
app = FastAPI()


def _completion(content: str) -> dict:
    return {"id": "x", "object": "chat.completion", "created": 0, "model": "muse-spark-1.3",
            "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": content}}],
            "usage": {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150}}


@app.post("/v1/chat/completions")
async def chat(req: Request):
    body = await req.json()
    STATE["chat_calls"] += 1
    assert body["model"].startswith("muse-spark")
    if not STATE["rate_limited"]:
        STATE["rate_limited"] = True
        return JSONResponse({"error": {"message": "slow down"}}, status_code=429, headers={"retry-after": "0.1"})
    rf = body.get("response_format")
    if rf and rf["json_schema"]["name"] == "Probe":
        if STATE["bad_once"]:
            STATE["bad_once"] = False
            return _completion('{"wrong": 1}')
        return _completion('{"question": "What changed between #1 and #2?"}')
    if rf and rf["json_schema"]["name"] == "SensitiveRegions":
        assert any(p.get("type") == "image_url" for p in body["messages"][-1]["content"])
        return _completion('{"regions": [{"label": "password", "box": [10, 10, 200, 60]}]}')
    return _completion("ok")


@app.post("/v1/responses")
async def responses(req: Request):
    STATE["responses_calls"] += 1
    return JSONResponse({"error": {"message": "not found"}}, status_code=404)


@app.post("/v1/asr/transcribe")
async def asr(req: Request):
    form = await req.form()
    meta = json.loads(form["request"])
    assert meta["model"] == "muse-voice-transcribe-1.0" and meta["audioEncoding"] == "WAV"
    return {"turns": [{"text": "We escalate anything"}, {"text": "with that supplier."}]}


@pytest.fixture(scope="module", autouse=True)
def server():
    cfg = uvicorn.Config(app, port=PORT, log_level="error")
    srv = uvicorn.Server(cfg)
    t = threading.Thread(target=srv.run, daemon=True)
    t.start()
    for _ in range(100):
        if srv.started:
            break
        time.sleep(0.05)
    yield
    srv.should_exit = True


def make_llm():
    os.environ["MODEL_API_KEY"] = "test-key"
    from backend.app import config

    config.settings.model_api_key = "test-key"
    config.settings.model_base_url = f"http://127.0.0.1:{PORT}/v1"
    from backend.app.llm import LLM

    return LLM(provider="meta", model="muse-spark-1.3")


PROBE_SCHEMA = {"type": "object", "properties": {"question": {"type": "string"}}, "required": ["question"]}
REGIONS_SCHEMA = {"type": "object", "properties": {"regions": {"type": "array", "items": {"type": "object", "properties": {
    "label": {"type": "string"}, "box": {"type": "array", "items": {"type": "number"}}}}}}, "required": ["regions"]}


def test_retry_schema_repair_and_usage():
    from backend.app.llm import USAGE

    llm = make_llm()
    before = USAGE.snapshot()["calls"]
    out = llm.json([{"role": "user", "content": "q"}], PROBE_SCHEMA, "Probe")
    assert out["question"].startswith("What changed")
    assert USAGE.snapshot()["calls"] - before == 2  # invalid first answer, corrected second
    assert STATE["rate_limited"]


def test_vision_falls_back_to_chat_and_transcribe():

    llm = make_llm()
    out = llm.vision_json("find secrets", [b"\x89PNG fake"], REGIONS_SCHEMA, "SensitiveRegions")
    assert out["regions"][0]["box"] == [10, 10, 200, 60]
    assert STATE["responses_calls"] == 1
    assert llm.transcribe(b"RIFF....WAVE", seconds=1.0) == "We escalate anything with that supplier."
