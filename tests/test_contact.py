"""The website's contact form: messages are validated, stored, and bots filling the hidden field are ignored."""
from fastapi.testclient import TestClient
from sqlalchemy import select

from backend.app.main import app
from backend.db.models import ContactMessage
from backend.db.store import SessionLocal


def test_contact_form_stores_messages():
    with TestClient(app) as c:
        assert c.post("/api/contact", json={"name": "", "email": "x", "message": "hi there"}).status_code == 400
        r = c.post("/api/contact", json={"name": "Ana Ruiz", "email": "ana@plant.example", "company": "Ruiz Plastics",
                                         "topic": "demo", "message": "Two of our line leads retire in March."})
        assert r.status_code == 200 and r.json()["ok"]
        assert c.post("/api/contact", json={"name": "Bot", "email": "bot@spam.example", "message": "buy now",
                                            "website": "http://spam.example"}).json()["ok"]
    with SessionLocal() as db:
        rows = db.scalars(select(ContactMessage)).all()
        assert [m.email for m in rows] == ["ana@plant.example"] and rows[0].topic == "demo" and not rows[0].emailed
