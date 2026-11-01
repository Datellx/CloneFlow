"""Gmail and Microsoft Graph imports against fake APIs (no network): OAuth state, token sealing, paging,
mail/chat/file mapping, personal masking."""
from __future__ import annotations

import base64
import json
import os
import tempfile
from email.message import EmailMessage

TMP = tempfile.mkdtemp(prefix="cf_conn_")
os.environ.setdefault("DATA_DIR", TMP)
os.environ["LLM_PROVIDER"] = "mock"
CREDS = {"GOOGLE_CLIENT_ID": "gid", "GOOGLE_CLIENT_SECRET": "gs", "MS_CLIENT_ID": "mid", "MS_CLIENT_SECRET": "ms",
         "MS_TENANT_ID": "tenant"}

import httpx  # noqa: E402

from backend.db.models import Clone, Org  # noqa: E402
from backend.db.models_knowledge import SourceItem  # noqa: E402
from backend.db.store import SessionLocal, init_db  # noqa: E402
from backend.handover import connectors as CN  # noqa: E402

_RealClient = httpx.Client


def raw(i, frm, subj, body):
    m = EmailMessage()
    m["From"], m["To"], m["Subject"], m["Date"] = frm, "melissa@wrenfield.example", subj, "Mon, 09 Mar 2026 09:00:00 -0500"
    m["Message-ID"] = f"<g{i}@x>"
    m.set_content(body)
    return base64.urlsafe_b64encode(m.as_bytes()).decode()


def google_handler(req: httpx.Request) -> httpx.Response:
    p = req.url.path
    if p.endswith("/messages"):
        if req.url.params.get("pageToken"):
            return httpx.Response(200, json={"messages": [{"id": "3"}]})
        return httpx.Response(200, json={"messages": [{"id": "1"}, {"id": "2"}], "nextPageToken": "p2"})
    mid = p.rsplit("/", 1)[-1]
    data = {"1": raw(1, "Wei Zhang <wei@kaihong.example>", "RMA lot A2318", "Send failure photos and the lot number."),
            "2": raw(2, "Mom <mom@gmail.com>", "Sunday call?", "Dad wants to call Sunday, and my doctor's appointment went fine."),
            "3": raw(3, "Melissa <melissa@wrenfield.example>", "Torque", "Use 0.25 N·m on horn screws.")}[mid]
    return httpx.Response(200, json={"raw": data, "labelIds": ["SENT"] if mid == "3" else ["INBOX"]})


def graph_handler(req: httpx.Request) -> httpx.Response:
    p = req.url.path.replace("/v1.0", "")
    if p == "/me/mailFolders":
        return httpx.Response(200, json={"value": [{"id": "f1", "displayName": "Inbox"}]})
    if p == "/me/messages":
        return httpx.Response(200, json={"value": [{"id": "m1", "internetMessageId": "<m1@x>", "subject": "Line 2 sync",
            "from": {"emailAddress": {"name": "Rosa", "address": "rosa@wrenfield.example"}}, "toRecipients": [],
            "ccRecipients": [], "sentDateTime": "2026-05-01T10:00:00Z", "body": {"content": "Sync moves to Tuesday 9:30."},
            "conversationId": "c1", "parentFolderId": "f1"}]})
    if p == "/me/chats":
        return httpx.Response(200, json={"value": [{"id": "chat1", "topic": None, "members": [{"displayName": "Jordan Lee"}]}]})
    if p == "/chats/chat1/messages":
        return httpx.Response(200, json={"value": [
            {"id": "a", "messageType": "message", "createdDateTime": "2026-05-02T10:00:00Z",
             "from": {"user": {"displayName": "Jordan Lee"}}, "body": {"content": "<p>do the thing with the wrist first?</p>"}},
            {"id": "b", "messageType": "systemEventMessage", "body": {"content": ""}}]})
    if p == "/me/joinedTeams":
        return httpx.Response(200, json={"value": [{"id": "t1", "displayName": "Northwind"}]})
    if p == "/teams/t1/channels":
        return httpx.Response(200, json={"value": [{"id": "ch1", "displayName": "production-line2"}]})
    if p == "/teams/t1/channels/ch1/messages":
        return httpx.Response(200, json={"value": [{"id": "x1", "messageType": "message", "createdDateTime": "2026-05-03T10:00:00Z",
            "from": {"user": {"displayName": "Tyler Brandt"}}, "body": {"content": "Monday recal done on bench 3"}}]})
    if p.endswith("/replies"):
        return httpx.Response(200, json={"value": []})
    if p == "/me/drive/recent":
        return httpx.Response(200, json={"value": [{"id": "d1", "name": "notes.md", "file": {}, "size": 20,
                                                    "parentReference": {"driveId": "dr"}}]})
    if p == "/drives/dr/items/d1/content":
        return httpx.Response(200, content=b"# Notes\nJig is on bench 3.")
    return httpx.Response(404, json={})


def patch(handler):
    def factory(*a, **k):
        k.pop("transport", None)
        return _RealClient(*a, transport=httpx.MockTransport(handler), **k)
    httpx.Client = factory


def test_imports(monkeypatch):
    for k, v in CREDS.items():
        monkeypatch.setenv(k, v)
    init_db()
    with SessionLocal() as db:
        org = Org(name="Northwind", slug="northwind-conn-test")
        db.add(org)
        db.flush()
        c = Clone(org_id=org.id, expert_name="Melissa", settings={})
        db.add(c)
        db.commit()
        eid = c.id
    url = CN.auth_url("google", eid)
    assert "gmail.readonly" in url and "client_id=gid" in url
    state = url.split("state=")[1]
    assert CN.read_state(state, "google") == eid
    CN.save_token(eid, "google", {"access_token": "t", "expires_at": 9e12, "refresh_token": "r"})
    try:
        patch(google_handler)
        counts = CN._import_google(eid)
        assert counts == {"emails": 3}
        patch(graph_handler)
        CN.save_token(eid, "microsoft", {"access_token": "t", "expires_at": 9e12})
        counts = CN._import_microsoft(eid)
        assert counts == {"emails": 1, "chats": 2, "files": 1}, counts
    finally:
        httpx.Client = _RealClient
    with SessionLocal() as db:
        items = db.query(SourceItem).filter(SourceItem.clone_id == eid).all()
        mom = next(i for i in items if i.title == "Sunday call?")
        assert mom.noise_reason == "Personal" and mom.clean == ""
        sent = next(i for i in items if i.title == "Torque")
        assert sent.container == "Sent"
        chat = next(i for i in items if i.kind == "chat" and "wrist" in i.body)
        assert "<p>" not in chat.body
        assert any(i.kind == "file" and i.title == "notes.md" for i in items)
    # tokens are sealed, not stored in clear text
    with SessionLocal() as db:
        row = db.query(CN.ConnectorToken).first()
        assert "access_token" not in row.secret and json.loads(json.dumps(CN._open(row.secret)))["access_token"] == "t"
