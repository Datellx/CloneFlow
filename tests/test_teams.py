"""Microsoft Teams outgoing webhook: the admin saves the security token; '@Clone Flow …' is answered from the
organization's knowledge base; requests with a wrong HMAC signature are refused."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os

from fastapi.testclient import TestClient

from backend.app.main import app


def test_teams_webhook():
    with TestClient(app) as c:
        me = c.post("/api/auth/signup", json={"org_name": "Teams Test Co", "name": "Tess Admin",
                                              "email": "tess@teamstest.example", "password": "password123"}).json()
        slug = me["org"]["slug"]
        t = c.get("/api/admin/teams").json()
        assert not t["configured"] and t["webhook_url"].endswith(f"/api/teams/webhook/{slug}")
        assert c.post("/api/admin/teams", json={"secret": "not base64!!"}).status_code == 400
        secret = base64.b64encode(os.urandom(32)).decode()
        assert c.post("/api/admin/teams", json={"secret": secret}).json()["configured"]
        body = json.dumps({"type": "message", "text": "<at>Clone Flow</at> where is the calibration jig?"}).encode()
        sig = base64.b64encode(hmac.new(base64.b64decode(secret), body, hashlib.sha256).digest()).decode()
        r = c.post(f"/api/teams/webhook/{slug}", content=body, headers={"Authorization": f"HMAC {sig}"})
        assert r.status_code == 200 and r.json()["type"] == "message" and r.json()["text"]
        r = c.post(f"/api/teams/webhook/{slug}", content=body, headers={"Authorization": "HMAC wrong"})
        assert r.status_code == 401
