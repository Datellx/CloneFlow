"""The two doors for judges: a view-only tour of a real workspace (can look and ask, can't change anything or see
invitation links), and a private demo workspace where the visitor is interviewed about their own job."""
from __future__ import annotations

from fastapi.testclient import TestClient

from backend.app import routes_demo as RD
from backend.app.main import app


def test_judge_tour_is_view_only_and_try_it_yourself_interviews():
    with TestClient(app) as c:
        me = c.post("/api/auth/signup", json={"org_name": "Tour Robotics", "name": "Ada Admin",
                                              "email": "ada@tour.example", "password": "password123"}).json()
        r = c.post("/api/admin/invite", json={"name": "Lee Park", "email": "lee@tour.example", "title": "Engineer"})
        assert r.status_code == 200, r.text
        RD.TOUR_ORG = me["org"]["slug"]
        c.post("/api/auth/logout")

        # --- the judge tour
        assert c.get("/api/demo/info").json()["tour"]
        r = c.post("/api/demo/tour").json()
        assert r["next"].startswith("/admin/people/")
        me = c.get("/api/auth/me").json()
        assert me["judge"] and me["is_admin"] and me["home"] == "/admin"
        ov = c.get("/api/admin/overview").json()
        assert ov["people"] and all(i["link"] is None for i in ov["invites"])  # no way in as someone else
        assert c.post("/api/admin/invite", json={"name": "X", "email": "x@tour.example"}).status_code == 403
        assert c.post("/api/admin/teams", json={"token": "abc"}).status_code == 403
        assert c.get("/api/admin/diag/log").status_code == 403
        a = c.post("/api/ask", json={"eid": None, "question": "Who do we call when servos fail?", "mode": "question"})
        assert a.status_code == 200
        c.post("/api/auth/logout")

        # --- try it yourself: a fresh private workspace, straight into the interview
        r = c.post("/api/demo/try", json={"name": "Sam", "role": "Line technician"}).json()
        assert r["next"] == "/session"
        me = c.get("/api/auth/me").json()
        assert me["demo"] and me["home"] == "/session" and not me["judge"]
        s = c.post("/api/me/session/start").json()
        assert s["stage"] == "intro"
        c.post("/api/me/session/message", json={"text": "I run the wave-solder line, been here since 2019."})
        s = c.post("/api/me/session/message", json={"text": "Changeovers, nozzle cleaning and the weekly flux check."}).json()["session"]
        assert s["stage"] == "interview" and s["question"] and s["progress"]["total"] == 3  # demo: no mailbox step
        for _ in range(3):
            c.post("/api/me/session/message", json={"text": "Flux check: dip the card, compare to the chart, log it in the binder by the line."})
        s = c.get("/api/me/session").json()
        assert s["stage"] == "open"
        r = c.post("/api/me/session/finish").json()
        assert r["session"]["stage"] == "done"
        # it is a separate organization: nothing from the tour workspace is visible
        assert c.get("/api/admin/overview").json()["org"]["name"] == "Your company (demo)"
