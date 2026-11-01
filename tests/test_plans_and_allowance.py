"""Plans and the AI allowance: nothing to connect still works (skip → talk, upload, phone, finish); every
organization has an AI allowance ($2 by default) that stops model calls with a clear message; the Starter plan
includes 3 departing employees; company context reaches every AI step; large uploads can go straight to the engine."""
from __future__ import annotations

import io

from fastapi.testclient import TestClient
from PIL import Image

from backend.app.main import app


def _png() -> bytes:
    b = io.BytesIO()
    Image.new("RGB", (64, 48), (120, 30, 58)).save(b, "PNG")
    return b.getvalue()


def test_uploads_only_session_and_org_allowance(monkeypatch):
    monkeypatch.setenv("ORG_AI_CAP_USD", "2")
    with TestClient(app) as c:
        c.post("/api/auth/signup", json={"org_name": "Harbor Labs", "name": "Ana Admin",
                                         "email": "ana@harbor.example", "password": "password123"})
        o = c.get("/api/admin/overview").json()
        assert o["ai_allowance"]["cap_usd"] == 2 and o["ai_allowance"]["reached"] is False
        inv = c.post("/api/admin/invite", json={"name": "Ben Leaving", "email": "ben@harbor.example"}).json()
        code = inv["link"].rsplit("/", 1)[-1]
        c.post("/api/auth/logout")
        c.post("/api/auth/join", json={"invite_code": code, "name": "Ben Leaving", "email": "ben@harbor.example",
                                       "password": "password123"})
        c.post("/api/me/session/start")
        c.post("/api/me/session/message", json={"text": "I'm the lab manager, here since 2019."})
        s = c.post("/api/me/session/message", json={"text": "I run the freezer inventory and the safety checks."}).json()["session"]
        assert s["stage"] == "connect"
        types = [a["type"] for a in s["actions"]]
        assert "skip_connect" in types and "start_reading" not in types
        s = c.post("/api/me/session/skip").json()["session"]
        assert s["stage"] == "open"
        assert {"screen", "upload", "phone"} <= set(next(a for a in s["actions"] if a["type"] == "add")["modes"])
        r = c.post("/api/me/session/upload", files={"files": ("freezer.md", b"# Freezer -80\n1. Check the alarm log every Monday\n2. Call Thermo rep Lisa\n")}).json()
        assert any(m["kind"] == "cards" for m in r["messages"])
        r = c.post("/api/me/session/upload", files={"files": ("bench.png", _png())}).json()
        assert r["messages"][-1]["role"] == "avatar"
        r = c.post("/api/me/session/message", json={"text": "The backup CO2 tank key is taped under drawer 3 in room 210."}).json()
        assert r["messages"][-1]["role"] == "avatar"
        w = c.post("/api/me/session/walk").json()
        assert w["token"] and "<svg" in w["qr_svg"]
        assert c.get("/api/me/session/walk/feed").status_code == 200
        r = c.post("/api/me/session/finish").json()
        assert r["session"]["stage"] == "done" and any(m["kind"] == "summary" for m in r["messages"])
        eid = r["session"]["eid"]

        # allowance: once the organization has spent $2, model calls stop with a clear message
        from backend.db.models_knowledge import CostLog
        from backend.db.store import SessionLocal
        with SessionLocal() as db:
            db.add(CostLog(clone_id=eid, step="extract", model="test", usd=2.05))
            db.commit()
        r = c.post("/api/me/session/message", json={"text": "One more thing: the eyewash is tested on Fridays."})
        assert r.status_code == 402 and r.json()["code"] == "trial_limit"
        assert "trial limit" in r.json()["detail"].lower()
        c.post("/api/auth/logout")
        c.post("/api/auth/login", json={"email": "ana@harbor.example", "password": "password123"})
        assert c.get("/api/admin/overview").json()["ai_allowance"]["reached"] is True
        r = c.post("/api/ask", json={"eid": None, "question": "Where is the backup CO2 tank key?", "mode": "question"})
        assert r.status_code == 200 and r.json()["known"]


def test_starter_plan_limit_and_company_context(monkeypatch):
    from backend.app import llm_mock

    seen = []
    orig = llm_mock._HANDLERS["V2Answer"]
    monkeypatch.setitem(llm_mock._HANDLERS, "V2Answer", lambda t, m: (seen.append(m[0]["content"]), orig(t, m))[1])
    with TestClient(app) as c:
        c.post("/api/auth/signup", json={"org_name": "Pine Clinic", "name": "Pat Admin",
                                         "email": "pat@pine.example", "password": "password123"})
        c.post("/api/setup/message", json={"text": "We run three family clinics in Madison."})
        c.post("/api/setup/message", json={"text": "vaccine storage, billing codes"})
        links = []
        for i in range(3):
            r = c.post("/api/admin/invite", json={"name": f"Person {i}", "email": f"p{i}@pine.example",
                                                   "focus": "the vaccine fridge log" if i == 0 else ""})
            assert r.status_code == 200
            links.append(r.json()["link"])
        r = c.post("/api/admin/invite", json={"name": "Person 4", "email": "p4@pine.example"})
        assert r.status_code == 402 and "Starter plan includes 3" in r.json()["detail"]
        ov = c.get("/api/admin/overview").json()
        assert ov["plan"]["used"] == 3 and ov["plan"]["left"] == 0
        c.post("/api/auth/logout")
        c.post("/api/auth/join", json={"invite_code": links[0].rsplit("/", 1)[-1], "name": "Person 0",
                                       "email": "p0@pine.example", "password": "password123"})
        c.post("/api/me/session/start")
        c.post("/api/me/session/message", json={"text": "Nurse lead since 2020."})
        c.post("/api/me/session/message", json={"text": "Vaccines and scheduling."})
        c.post("/api/me/session/skip")
        c.post("/api/me/session/message", json={"text": "The fridge log is checked at 8am and 4pm."})
    ctx = seen[-1]
    assert "About Pine Clinic: We run three family clinics" in ctx and "vaccine storage" in ctx
    assert "the vaccine fridge log" in ctx


def test_direct_upload_token(monkeypatch):
    monkeypatch.setenv("UPLOAD_BASE_URL", "https://engine.example.com")
    with TestClient(app) as c:
        c.post("/api/auth/signup", json={"org_name": "Upload Co", "name": "Uma Admin",
                                         "email": "uma@upload.example", "password": "password123"})
        c.post("/api/me/session/start")
        t = c.get("/api/me/upload-token").json()
        assert t["base"] == "https://engine.example.com" and t["token"]
    with TestClient(app) as anon:  # no cookie: the token works for uploads only
        h = {"X-CF-Upload": t["token"]}
        assert anon.get("/api/me/session", headers=h).status_code == 401
        r = anon.post("/api/me/session/upload", headers=h, files={"files": ("n.md", b"# note\nshelf B2 holds the jigs\n")})
        assert r.status_code == 200, r.text
        assert anon.post("/api/me/session/upload", headers={"X-CF-Upload": "bad"}, files={"files": ("n.md", b"x")}).status_code == 401
