"""Accounts: organization sign-up (admin), invitation → join (departing employee), two-step sign-in by email,
public status (no internal numbers), and the removed demo/legacy routes stay gone."""
from __future__ import annotations

from fastapi.testclient import TestClient

from backend.app.main import app


def test_accounts_and_surface():
    with TestClient(app) as c:
        st = c.get("/api/system/status").json()
        assert st["product"] is True and "usage" not in st
        assert [p["key"] for p in st["plans"]] == ["starter", "growth", "pro"]
        assert st["download"]["coming_soon"] == ["mac", "windows"]
        for path in ("/api/auth/demo", "/api/connect/demo", "/api/clones", "/api/orgs/search"):
            assert c.post(path, json={}).status_code in (404, 405), path
        me = c.post("/api/auth/signup", json={"org_name": "Lakeside Foods", "name": "Dana Owner",
                                              "email": "dana@lakeside.example", "password": "password123"}).json()
        assert me["home"] == "/setup" and me["user"]["role"] == "admin"
        assert c.post("/api/setup/finish", json={"skipped": True}).json()["ok"]
        assert c.get("/api/auth/me").json()["home"] == "/admin"
        inv = c.post("/api/admin/invite", json={"name": "Sam Leaving", "email": "sam@lakeside.example",
                                                 "title": "Controls Engineer", "leaving_on": "2026-12-01",
                                                 "focus": "the line 3 changeover and the SAP export"}).json()
        code = inv["link"].rsplit("/", 1)[-1]
        assert c.post("/api/admin/invite", json={"name": "Sam Again", "email": "sam@lakeside.example"}).status_code == 409
        c.post("/api/auth/logout")
        info = c.get(f"/api/auth/invite/{code}").json()
        assert info["org_name"] == "Lakeside Foods" and info["name"] == "Sam Leaving" and info["inviter"] == "Dana Owner"
        assert c.post("/api/auth/lookup", json={"email": "sam@lakeside.example"}).json()["found"] is False
        me = c.post("/api/auth/join", json={"invite_code": code, "name": "Sam Leaving", "email": "sam@lakeside.example",
                                            "password": "password123"}).json()
        assert me["home"] == "/session"
        s = c.post("/api/me/session/start").json()
        assert s["stage"] == "intro" and s["eid"] == inv["employee"]["id"]
        assert any("line 3 changeover" in m["text"] and "Dana" in m["text"] for m in s["messages"])  # admin's focus
        assert c.get("/api/admin/overview").status_code == 403
        assert c.get("/api/setup").status_code == 403
        c.post("/api/auth/logout")
        assert c.get(f"/api/auth/invite/{code}").status_code == 404  # used
        lk = c.post("/api/auth/lookup", json={"email": "Sam@Lakeside.example"}).json()
        assert lk["found"] and lk["org_name"] == "Lakeside Foods"
        assert c.post("/api/auth/login", json={"email": "sam@lakeside.example", "password": "wrong-pass"}).status_code == 401


def test_supabase_session(monkeypatch):
    """With Supabase configured, the browser signs in there and exchanges the token for a Clone Flow session."""
    from backend.app import supabase
    from backend.app.config import settings

    monkeypatch.setattr(settings, "supabase_url", "https://example.supabase.co")
    monkeypatch.setattr(settings, "supabase_anon_key", "anon")
    users = {
        "t-admin": {"id": "u1", "email": "Kim@Acme.example", "email_confirmed_at": "2026-11-01T00:00:00Z",
                    "user_metadata": {"name": "Kim Admin", "org_name": "Acme Tools"}},
        "t-unconfirmed": {"id": "u2", "email": "x@acme.example", "user_metadata": {}},
        "t-stranger": {"id": "u3", "email": "who@else.example", "email_confirmed_at": "2026-11-01T00:00:00Z", "user_metadata": {}},
    }
    sent = []
    monkeypatch.setattr(supabase, "get_user", lambda tok: users.get(tok))
    monkeypatch.setattr(supabase, "send_invite", lambda email, link, data: sent.append((email, link, data)) or True)
    with TestClient(app) as c:
        st = c.get("/api/system/status").json()
        assert st["auth"] == {"provider": "supabase", "url": "https://example.supabase.co", "anon_key": "anon"}
        assert c.post("/api/auth/signup", json={"org_name": "X", "name": "Y", "email": "y@x.example",
                                                "password": "password123"}).status_code == 409
        assert c.post("/api/auth/session", json={"access_token": "bad"}).status_code == 401
        assert c.post("/api/auth/session", json={"access_token": "t-unconfirmed"}).status_code == 403
        assert c.post("/api/auth/session", json={"access_token": "t-stranger"}).status_code == 404
        me = c.post("/api/auth/session", json={"access_token": "t-admin"}).json()
        assert me["org"]["name"] == "Acme Tools" and me["user"]["email"] == "kim@acme.example" and me["home"] == "/setup"
        inv = c.post("/api/admin/invite", json={"name": "Lee Leaving", "email": "lee@acme.example"}).json()
        assert inv["emailed"] and sent[0][0] == "lee@acme.example" and sent[0][1] == inv["link"]
        code = inv["link"].rsplit("/", 1)[-1]
        c.post("/api/auth/logout")
        users["t-lee"] = {"id": "u4", "email": "lee@acme.example", "email_confirmed_at": "2026-11-01T00:00:00Z",
                          "user_metadata": sent[0][2]}
        users["t-wrong"] = {"id": "u5", "email": "notlee@acme.example", "email_confirmed_at": "2026-11-01T00:00:00Z",
                            "user_metadata": {}}
        assert c.post("/api/auth/session", json={"access_token": "t-wrong", "invite_code": code}).status_code == 403
        me = c.post("/api/auth/session", json={"access_token": "t-lee"}).json()  # invite code from the invite email
        assert me["home"] == "/session" and me["owned_clone_ids"] == [inv["employee"]["id"]]
        c.post("/api/auth/logout")
        assert c.post("/api/auth/session", json={"access_token": "t-admin"}).json()["home"] == "/setup"  # returning
