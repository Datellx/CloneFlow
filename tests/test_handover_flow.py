"""The whole product on the offline model: an admin creates the organization and talks to the setup assistant →
invites someone leaving → that person joins, connects sources, Clone Flow reads them (personal mail set aside),
asks about the gaps, takes an upload, finishes → the admin's knowledge base answers questions; access control."""
from __future__ import annotations

import time

from fastapi.testclient import TestClient

from backend.app.main import app
from conftest import load_fixture_sources


def poll(c, until, n=400):
    for _ in range(n):
        s = c.get("/api/me/session").json()
        if until(s):
            return s
        time.sleep(0.05)
    raise AssertionError(s["stage"])


def test_handover_end_to_end():
    with TestClient(app) as c:
        me = c.post("/api/auth/signup", json={"org_name": "Northwind Robotics", "name": "Dana Okafor",
                                              "email": "dana@northwind.example", "password": "password123"}).json()
        assert me["home"] == "/setup" and me["org"]["plan"]["key"] == "starter"
        # setup assistant (Milo-style): shapes the console and invites by chat
        st = c.get("/api/setup").json()
        assert len(st["messages"]) == 2 and not st["done"]
        for text in ("We build robot arms for university labs and small factories.",
                     "Calibration know-how, supplier contacts, firmware decisions",
                     "Line 2 assembly and the firmware team",
                     "Microsoft 365, Teams and GitHub"):
            r = c.post("/api/setup/message", json={"text": text}).json()
            assert r["messages"][-1]["role"] == "assistant"
        r = c.post("/api/setup/message", json={"text": "Yes, Avery Brooks, avery@northwind.example, leaves Dec 15"}).json()
        assert r["done"] and r["profile"]["summary"].startswith("We build robot arms")
        inv = next(m for m in r["messages"] if (m["payload"] or {}).get("invites"))["payload"]["invites"][0]
        assert inv["email"] == "avery@northwind.example" and "/join/" in inv["link"]
        assert c.get("/api/auth/me").json()["home"] == "/admin"
        ov = c.get("/api/admin/overview").json()
        assert ov["org"]["profile"]["critical_areas"] and ov["plan"]["used"] == 1 and ov["plan"]["left"] == 2

        # the person leaving
        code = inv["link"].rsplit("/", 1)[-1]
        c.post("/api/auth/logout")
        me = c.post("/api/auth/join", json={"invite_code": code, "name": "Avery Brooks",
                                            "email": "avery@northwind.example", "password": "password123"}).json()
        assert me["home"] == "/session"
        s = c.post("/api/me/session/start").json()
        assert s["stage"] == "intro" and s["eid"] == inv["eid"]
        c.post("/api/me/session/message", json={"text": "I'm a robotics engineer, joined in 2021."})
        s = c.post("/api/me/session/message", json={"text": "Mostly Line 2 calibration and the Gripper v2 project."}).json()["session"]
        assert s["stage"] == "connect"
        assert [p["key"] for p in next(a for a in s["actions"] if a["type"] == "connect")["providers"]] == \
            ["microsoft", "gmail", "github"]
        eid = s["eid"]
        n = load_fixture_sources(eid)
        assert n["emails"] > 100 and n["chats"] > 100
        s = c.get("/api/me/session").json()
        assert any(a["type"] == "start_reading" for a in s["actions"])
        priv = c.get("/api/me/session/privacy").json()
        assert priv["set_aside"][0]["reason"] == "Personal" and priv["set_aside"][0]["count"] >= 8
        r = c.post("/api/me/session/read").json()
        assert r["session"]["stage"] == "reading"
        s = poll(c, lambda s: s["stage"] in ("interview", "open"))
        assert s["stage"] == "interview" and s["question"]
        done_msg = next(m for m in s["messages"] if m["kind"] == "reading" and (m["payload"] or {}).get("done"))
        assert done_msg["payload"]["personal_skipped"] >= 8
        r = c.post("/api/me/session/message", json={"text": "Because the wrist encoder drifts when the shop is cold."}).json()
        assert r["messages"]
        assert c.post("/api/me/session/skip").json()["messages"]
        r = c.post("/api/me/session/upload", files={"files": ("wrist_notes.md", b"# Wrist homing\n1. Rotate wrist by hand to the index mark\n2. Run calibrate\n")}).json()
        assert any(m["kind"] == "upload" for m in r["messages"])
        for _ in range(12):
            if c.get("/api/me/session").json()["stage"] != "interview":
                break
            c.post("/api/me/session/message", json={"text": "Ask Wei Zhang at Kaihong; use 0.25 N·m on the horn screws."})
        assert c.get("/api/me/session").json()["stage"] == "open"
        c.post("/api/me/session/message", json={"text": "Also: the spare horns are in bin C4 under bench 2, refill them every Friday."})
        r = c.post("/api/me/session/finish").json()
        assert r["session"]["stage"] == "done" and any(m["kind"] == "summary" for m in r["messages"])
        # a departing employee sees only their own handover
        assert c.get("/api/admin/overview").status_code == 403
        assert c.get("/api/map").status_code == 403

        # the admin's knowledge base
        c.post("/api/auth/logout")
        c.post("/api/auth/login", json={"email": "dana@northwind.example", "password": "password123"})
        ov = c.get("/api/admin/overview").json()
        assert ov["people"][0]["id"] == eid
        assert c.get(f"/api/employees/{eid}/cards").json()
        a = c.post("/api/ask", json={"eid": None, "question": "Where are the spare servo horns?", "mode": "question"}).json()
        assert a["eid"] == eid
        assert c.get("/api/map").status_code == 200
