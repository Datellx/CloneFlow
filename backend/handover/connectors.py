"""Real connections: Gmail (Google OAuth) and Microsoft 365 (Outlook mail, Teams chats + channels, OneDrive files).

Secrets come only from the server environment (.env.local). Tokens are stored encrypted per employee.
Imports run in the background and land as SourceItems, so the same free filters (noise, personal) apply and the
'Read everything' run works the same as for exports. No model calls here.
"""
from __future__ import annotations

import base64
import email
import email.policy
import hashlib
import json
import logging
import os
import random
import re
import secrets
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from html import unescape
from pathlib import Path
from urllib.parse import urlencode

import httpx
import jwt
from sqlalchemy import JSON, DateTime, ForeignKey, String, Text, UniqueConstraint, select
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.config import settings
from backend.db.models import Base, utcnow
from backend.db.models_knowledge import SourceConsent, SourceItem
from backend.db.store import SessionLocal
from backend.knowledge import clean as C, sources as SRC

log = logging.getLogger("cloneflow.connect")
MAX_MAIL = int(os.environ.get("CONNECT_MAX_MAIL", "600"))
MAX_CHAT = int(os.environ.get("CONNECT_MAX_CHAT", "1500"))
MAX_FILES = int(os.environ.get("CONNECT_MAX_FILES", "80"))
TEXT_EXT = {".md", ".txt", ".csv", ".tsv", ".json", ".yaml", ".yml", ".py", ".pdf", ".docx", ".pptx", ".xlsx",
            ".png", ".jpg", ".jpeg"}


class ConnectorToken(Base):
    __tablename__ = "connector_tokens"
    __table_args__ = (UniqueConstraint("clone_id", "provider"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    clone_id: Mapped[int] = mapped_column(ForeignKey("clones.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(20))           # google | microsoft
    account: Mapped[str] = mapped_column(String(320), default="")
    secret: Mapped[str] = mapped_column(Text)                  # encrypted token JSON
    status: Mapped[str] = mapped_column(String(20), default="connected")  # connected | importing | done | error
    counts: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


# ---------------------------------------------------------------- config
PROVIDERS = {
    "google": {"label": "Gmail", "note": "Your work email", "kinds": ["email"]},
    "microsoft": {"label": "Microsoft 365", "note": "Outlook mail and Teams chats", "kinds": ["email", "chat", "files"]},
    "github": {"label": "GitHub", "note": "Repositories: docs, READMEs, pull requests", "kinds": ["files", "chat"]},
}
GITHUB_SCOPES = "repo read:user"
MAX_REPOS = int(os.environ.get("CONNECT_MAX_REPOS", "8"))
GOOGLE_SCOPES = "openid email https://www.googleapis.com/auth/gmail.readonly"
MS_SCOPES = ("offline_access openid email User.Read Mail.Read Chat.Read ChannelMessage.Read.All Team.ReadBasic.All "
             "Channel.ReadBasic.All Files.Read.All")


def configured(provider: str) -> bool:
    if provider == "google":
        return bool(os.environ.get("GOOGLE_CLIENT_ID") and os.environ.get("GOOGLE_CLIENT_SECRET"))
    if provider == "microsoft":
        return bool(os.environ.get("MS_CLIENT_ID") and os.environ.get("MS_CLIENT_SECRET"))
    if provider == "github":
        return bool(os.environ.get("GITHUB_CLIENT_ID") and os.environ.get("GITHUB_CLIENT_SECRET"))
    return False


def redirect_uri(provider: str) -> str:
    base = os.environ.get("OAUTH_REDIRECT_BASE") or settings.public_url
    return f"{base.rstrip('/')}/api/connect/{provider}/callback"


# ---------------------------------------------------------------- crypto
def _fernet():
    from cryptography.fernet import Fernet

    key = base64.urlsafe_b64encode(hashlib.sha256(f"connectors:{settings.secret_key}".encode()).digest())
    return Fernet(key)


def _seal(data: dict) -> str:
    return _fernet().encrypt(json.dumps(data).encode()).decode()


def _open(secret: str) -> dict:
    return json.loads(_fernet().decrypt(secret.encode()))


def _state(eid: int, provider: str, seed: bool = False) -> str:
    return jwt.encode({"eid": eid, "p": provider, "seed": seed, "n": secrets.token_hex(8),
                       "exp": int(time.time()) + 900}, settings.secret_key, algorithm="HS256")


def read_state(state: str, provider: str) -> int:
    return int(read_state_full(state, provider)["eid"])


def read_state_full(state: str, provider: str) -> dict:
    data = jwt.decode(state, settings.secret_key, algorithms=["HS256"])
    if data.get("p") != provider:
        raise ValueError("state mismatch")
    return data


# ---------------------------------------------------------------- auth urls + token exchange
def login_url(org_id: int) -> str:
    """'Continue with Microsoft' on the organization sign-in page (OpenID only; same app + redirect as Connect)."""
    st = jwt.encode({"eid": 0, "org": org_id, "p": "microsoft", "login": True, "n": secrets.token_hex(8),
                     "exp": int(time.time()) + 900}, settings.secret_key, algorithm="HS256")
    tenant = os.environ.get("MS_TENANT_ID", "organizations")
    return f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize?" + urlencode({
        "client_id": os.environ["MS_CLIENT_ID"], "redirect_uri": redirect_uri("microsoft"), "response_type": "code",
        "response_mode": "query", "scope": "openid email profile User.Read", "state": st})


def exchange_login(code: str) -> dict:
    r = httpx.post(_token_endpoint("microsoft"), data={**_client("microsoft"), "code": code,
                   "grant_type": "authorization_code", "redirect_uri": redirect_uri("microsoft"),
                   "scope": "openid email profile User.Read"}, timeout=30)
    if r.status_code >= 400:
        raise RuntimeError(f"Microsoft sign-in failed: {r.text[:300]}")
    tok = r.json()
    claims = jwt.decode(tok.get("id_token", ""), options={"verify_signature": False})
    return {"email": (claims.get("email") or claims.get("preferred_username") or "").lower(),
            "name": claims.get("name", "")}


def auth_url(provider: str, eid: int, seed: bool = False) -> str:
    st = _state(eid, provider, seed)
    if provider == "github":
        return "https://github.com/login/oauth/authorize?" + urlencode({
            "client_id": os.environ["GITHUB_CLIENT_ID"], "redirect_uri": redirect_uri("github"),
            "scope": GITHUB_SCOPES, "state": st, "allow_signup": "false"})
    if provider == "google":
        scope = GOOGLE_SCOPES + (" https://www.googleapis.com/auth/gmail.insert" if seed else "")
        return "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode({
            "client_id": os.environ["GOOGLE_CLIENT_ID"], "redirect_uri": redirect_uri("google"),
            "response_type": "code", "scope": scope, "access_type": "offline", "prompt": "consent",
            "include_granted_scopes": "true", "state": st})
    tenant = os.environ.get("MS_TENANT_ID", "organizations")
    return f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize?" + urlencode({
        "client_id": os.environ["MS_CLIENT_ID"], "redirect_uri": redirect_uri("microsoft"), "response_type": "code",
        "response_mode": "query", "scope": MS_SCOPES, "state": st, "prompt": "select_account"})


def _token_endpoint(provider: str) -> str:
    if provider == "github":
        return "https://github.com/login/oauth/access_token"
    if provider == "google":
        return "https://oauth2.googleapis.com/token"
    return f"https://login.microsoftonline.com/{os.environ.get('MS_TENANT_ID', 'organizations')}/oauth2/v2.0/token"


def _client(provider: str) -> dict:
    if provider == "github":
        return {"client_id": os.environ["GITHUB_CLIENT_ID"], "client_secret": os.environ["GITHUB_CLIENT_SECRET"]}
    if provider == "google":
        return {"client_id": os.environ["GOOGLE_CLIENT_ID"], "client_secret": os.environ["GOOGLE_CLIENT_SECRET"]}
    return {"client_id": os.environ["MS_CLIENT_ID"], "client_secret": os.environ["MS_CLIENT_SECRET"]}


def exchange(provider: str, code: str) -> dict:
    data = {**_client(provider), "code": code, "grant_type": "authorization_code", "redirect_uri": redirect_uri(provider)}
    if provider == "microsoft":
        data["scope"] = MS_SCOPES
    r = httpx.post(_token_endpoint(provider), data=data, timeout=30, headers={"Accept": "application/json"})
    if r.status_code >= 400 or "error" in r.json():
        raise RuntimeError(f"{provider} sign-in failed: {r.text[:300]}")
    tok = r.json()
    if provider == "github":  # GitHub tokens don't expire and have no id_token
        tok["expires_at"] = time.time() + 10 * 365 * 86400
        try:
            u = httpx.get("https://api.github.com/user", headers={"Authorization": f"Bearer {tok['access_token']}"}, timeout=20)
            tok["login"] = u.json().get("login", "")
        except Exception:
            pass
    tok["expires_at"] = time.time() + int(tok.get("expires_in", 3600)) - 60
    return tok


def _refresh(provider: str, tok: dict) -> dict:
    if tok.get("expires_at", 0) > time.time() or not tok.get("refresh_token"):
        return tok
    data = {**_client(provider), "grant_type": "refresh_token", "refresh_token": tok["refresh_token"]}
    if provider == "microsoft":
        data["scope"] = MS_SCOPES
    r = httpx.post(_token_endpoint(provider), data=data, timeout=30)
    r.raise_for_status()
    new = r.json()
    new.setdefault("refresh_token", tok["refresh_token"])
    new["expires_at"] = time.time() + int(new.get("expires_in", 3600)) - 60
    return new


def _account_from(tok: dict) -> str:
    if tok.get("login"):
        return tok["login"]
    try:
        claims = jwt.decode(tok.get("id_token", ""), options={"verify_signature": False})
        return claims.get("email") or claims.get("preferred_username") or ""
    except Exception:
        return ""


def save_token(eid: int, provider: str, tok: dict) -> None:
    with SessionLocal() as db:
        row = db.scalar(select(ConnectorToken).where(ConnectorToken.clone_id == eid, ConnectorToken.provider == provider))
        if row is None:
            row = ConnectorToken(clone_id=eid, provider=provider, secret="")
            db.add(row)
        row.secret, row.account, row.status, row.error = _seal(tok), _account_from(tok), "connected", None
        for kind in PROVIDERS[provider]["kinds"]:  # connecting = consent for those sources
            c = db.scalar(select(SourceConsent).where(SourceConsent.clone_id == eid, SourceConsent.kind == kind))
            if c is None:
                c = SourceConsent(clone_id=eid, kind=kind)
                db.add(c)
            c.consent, c.provider = True, f"{PROVIDERS[provider]['label']} ({row.account})" if row.account else PROVIDERS[provider]["label"]
            c.connected_at = datetime.utcnow()
        db.commit()


def status(eid: int) -> dict[str, dict]:
    with SessionLocal() as db:
        return {t.provider: {"status": t.status, "account": t.account, "counts": t.counts or {}, "error": t.error}
                for t in db.scalars(select(ConnectorToken).where(ConnectorToken.clone_id == eid))}


# ---------------------------------------------------------------- import
def start_import(eid: int, provider: str) -> None:
    threading.Thread(target=_import_guard, args=(eid, provider), daemon=True, name=f"import-{provider}-{eid}").start()


def _set(eid: int, provider: str, **fields) -> None:
    with SessionLocal() as db:
        row = db.scalar(select(ConnectorToken).where(ConnectorToken.clone_id == eid, ConnectorToken.provider == provider))
        for k, v in fields.items():
            setattr(row, k, v)
        db.commit()


def _import_guard(eid: int, provider: str) -> None:
    _set(eid, provider, status="importing", error=None)
    try:
        counts = {"google": _import_google, "microsoft": _import_microsoft, "github": _import_github}[provider](eid)
        _set(eid, provider, status="done", counts=counts)
    except Exception as exc:
        log.exception("%s import failed", provider)
        _set(eid, provider, status="error", error=str(exc)[:500])


def _token(eid: int, provider: str) -> dict:
    with SessionLocal() as db:
        row = db.scalar(select(ConnectorToken).where(ConnectorToken.clone_id == eid, ConnectorToken.provider == provider))
        tok = _open(row.secret)
        new = _refresh(provider, tok)
        if new is not tok:
            row.secret = _seal(new)
            db.commit()
        return new


# -- Gmail
def _import_google(eid: int) -> dict:
    tok = _token(eid, "google")
    h = {"Authorization": f"Bearer {tok['access_token']}"}
    base = "https://gmail.googleapis.com/gmail/v1/users/me"
    ids: list[str] = []
    page = None
    with httpx.Client(timeout=30, headers=h) as cx:
        while len(ids) < MAX_MAIL:
            params = {"maxResults": 100, "q": "-in:chats newer_than:6y"}
            if page:
                params["pageToken"] = page
            r = cx.get(f"{base}/messages", params=params)
            r.raise_for_status()
            js = r.json()
            ids += [m["id"] for m in js.get("messages", [])]
            page = js.get("nextPageToken")
            if not page:
                break
        ids = ids[:MAX_MAIL]

        problems: list[str] = []

        def fetch(mid):
            # Gmail answers 403 (rateLimitExceeded / userRateLimitExceeded) or 429 when read too fast: back off and retry.
            for attempt in range(6):
                rr = cx.get(f"{base}/messages/{mid}", params={"format": "raw"})
                if rr.status_code == 200:
                    return rr.json()
                body = rr.text[:300]
                if rr.status_code in (429, 500, 502, 503) or (rr.status_code == 403 and "ateLimit" in body):
                    time.sleep(min(2 ** attempt, 20) + random.random())
                    continue
                problems.append(f"{rr.status_code}: {body}")
                return None
            problems.append("rate limited")
            return None

        with ThreadPoolExecutor(max_workers=4) as ex:
            raws = list(ex.map(fetch, ids))
        if ids and not any(raws):
            log.warning("gmail import: no message could be read: %s", problems[:3])
            raise RuntimeError("Gmail didn't let Clone Flow read the messages. Reconnect and allow reading email.")
        if problems:
            log.info("gmail import: %d of %d messages skipped (%s)", len(problems), len(ids), problems[0][:200])
    n = 0
    with SessionLocal() as db:
        seen = {i for (i,) in db.execute(select(SourceItem.ext_id).where(SourceItem.clone_id == eid, SourceItem.kind == "mail"))}
        for js in raws:
            if not js:
                continue
            msg = email.message_from_bytes(base64.urlsafe_b64decode(js["raw"] + "=="), policy=email.policy.default)
            labels = js.get("labelIds", [])
            folder = "Sent" if "SENT" in labels else ("Inbox" if "INBOX" in labels else "Archive")
            n += SRC._add_mail(db, eid, msg, folder, seen)
        db.commit()
    return {"emails": n}


# -- Microsoft Graph
GRAPH = "https://graph.microsoft.com/v1.0"


def _strip_html(s: str) -> str:
    s = re.sub(r"(?is)<(script|style).*?</\1>", " ", s or "")
    s = re.sub(r"(?i)<br\s*/?>|</p>|</div>", "\n", s)
    return unescape(re.sub(r"<[^>]+>", " ", s)).replace("\xa0", " ").strip()


def _paged(cx: httpx.Client, url: str, params: dict | None = None, limit: int = 1000) -> list[dict]:
    out: list[dict] = []
    while url and len(out) < limit:
        r = cx.get(url, params=params)
        if r.status_code in (403, 404):
            log.info("graph %s → %s", url, r.status_code)
            return out
        r.raise_for_status()
        js = r.json()
        out += js.get("value", [])
        url, params = js.get("@odata.nextLink"), None
    return out[:limit]


def _import_microsoft(eid: int) -> dict:
    tok = _token(eid, "microsoft")
    h = {"Authorization": f"Bearer {tok['access_token']}", "Prefer": 'outlook.body-content-type="text"'}
    counts = {"emails": 0, "chats": 0, "files": 0}
    with httpx.Client(timeout=60, headers=h) as cx:
        folders = {f["id"]: f["displayName"] for f in _paged(cx, f"{GRAPH}/me/mailFolders", {"$top": 50}, 200)}
        msgs = _paged(cx, f"{GRAPH}/me/messages", {"$top": 50, "$select": "id,internetMessageId,subject,from,toRecipients,"
                      "ccRecipients,sentDateTime,body,conversationId,parentFolderId,internetMessageHeaders"}, MAX_MAIL)
        with SessionLocal() as db:
            seen = {i for (i,) in db.execute(select(SourceItem.ext_id).where(SourceItem.clone_id == eid, SourceItem.kind == "mail"))}
            from email.message import EmailMessage

            for m in msgs:
                em = EmailMessage()
                fa = (m.get("from") or {}).get("emailAddress", {})
                em["From"] = f'{fa.get("name", "")} <{fa.get("address", "")}>'
                em["To"] = ", ".join(f'{r["emailAddress"].get("name", "")} <{r["emailAddress"].get("address", "")}>'
                                     for r in m.get("toRecipients", []) + m.get("ccRecipients", []))
                em["Subject"] = m.get("subject") or ""
                em["Message-ID"] = m.get("internetMessageId") or m["id"]
                em["References"] = f"<conv-{m.get('conversationId', '')}>"
                if m.get("sentDateTime"):
                    em["Date"] = datetime.fromisoformat(m["sentDateTime"].replace("Z", "+00:00")).strftime("%a, %d %b %Y %H:%M:%S +0000")
                for hd in m.get("internetMessageHeaders") or []:
                    if hd.get("name", "").lower() in ("list-unsubscribe", "auto-submitted", "precedence"):
                        em[hd["name"]] = hd.get("value", "")
                em.set_content((m.get("body") or {}).get("content", ""))
                counts["emails"] += SRC._add_mail(db, eid, em, folders.get(m.get("parentFolderId"), "Inbox"), seen)
            db.commit()
        # Teams: 1:1 / group chats, then channels
        chat_rows: list[tuple[str, str, str, list, dict]] = []
        for ch in _paged(cx, f"{GRAPH}/me/chats", {"$expand": "members", "$top": 50}, 200):
            members = [m.get("displayName", "") for m in ch.get("members", [])]
            name = ch.get("topic") or ", ".join(members[:3]) or "Chat"
            for msg in _paged(cx, f"{GRAPH}/chats/{ch['id']}/messages", {"$top": 50}, 400):
                chat_rows.append((ch["id"], name, "dm", members, msg))
        for team in _paged(cx, f"{GRAPH}/me/joinedTeams", None, 50):
            for chan in _paged(cx, f"{GRAPH}/teams/{team['id']}/channels", None, 50):
                cname = f"{team.get('displayName', '')} › {chan.get('displayName', '')}"
                for msg in _paged(cx, f"{GRAPH}/teams/{team['id']}/channels/{chan['id']}/messages", {"$top": 50}, 400):
                    chat_rows.append((chan["id"], cname, "channel", [], msg))
                    for rep in _paged(cx, f"{GRAPH}/teams/{team['id']}/channels/{chan['id']}/messages/{msg['id']}/replies",
                                      {"$top": 50}, 100):
                        rep.setdefault("replyToId", msg["id"])
                        chat_rows.append((chan["id"], cname, "channel", [], rep))
        with SessionLocal() as db:
            for cid, name, kind, members, msg in chat_rows[:MAX_CHAT]:
                if msg.get("messageType") not in (None, "message"):
                    continue
                text = _strip_html((msg.get("body") or {}).get("content", ""))
                if not text:
                    continue
                author = (((msg.get("from") or {}).get("user")) or {}).get("displayName", "")
                reason = C.classify_personal(author, "", text, "x") or C.classify_chat(text)
                thread = msg.get("replyToId") or msg["id"]
                db.add(SourceItem(clone_id=eid, kind="chat", ext_id=f"{cid}:{msg['id']}"[:300], container=cid[:300],
                                  thread_key=f"{cid}:{thread}"[:300], title=name[:500], author=author,
                                  sent_at=SRC._dt(msg.get("createdDateTime")), body=text,
                                  clean="" if reason == "Personal" else text, is_noise=bool(reason), noise_reason=reason,
                                  meta={"channel_kind": kind, "members": members, "channel_name": name,
                                        "reactions": [{"emoji": r.get("reactionType"), "count": 1} for r in msg.get("reactions", [])]}))
                counts["chats"] += 1
            db.commit()
        # OneDrive files (recent, text-bearing)
        store = SRC.media_dir(eid)
        tmp = settings.data_dir / "uploads" / f"onedrive_{eid}"
        tmp.mkdir(parents=True, exist_ok=True)
        got = 0
        for it in _paged(cx, f"{GRAPH}/me/drive/recent", None, 200):
            if got >= MAX_FILES or "file" not in it or Path(it.get("name", "")).suffix.lower() not in TEXT_EXT:
                continue
            if it.get("size", 0) > 15 * 1024 * 1024:
                continue
            drive = (it.get("remoteItem") or {}).get("parentReference", {}).get("driveId") or it.get("parentReference", {}).get("driveId")
            url = f"{GRAPH}/drives/{drive}/items/{it['id']}/content" if drive else f"{GRAPH}/me/drive/items/{it['id']}/content"
            r = cx.get(url, follow_redirects=True)
            if r.status_code != 200:
                continue
            (tmp / it["name"]).write_bytes(r.content)
            got += 1
        _ = store
        if got:
            with SessionLocal() as db:
                counts["files"] = SRC.load_folder(db, eid, tmp, prefix="OneDrive/")
                db.commit()
    return counts


# ---------------------------------------------------------------- test-account seeding (setup tool, not product)
def seed_gmail(tok: dict, mbox_dir: Path, me_addr: str = "") -> dict:
    """Setup tool: copy a folder of .mbox files into a TEST Gmail account so 'Connect Gmail' pulls
    realistic mail. Uses messages.import (keeps original dates; nothing is sent)."""
    import mailbox
    import os

    me_addr = me_addr or os.environ.get("SEED_MAILBOX_OWNER", "")
    h = {"Authorization": f"Bearer {tok['access_token']}"}
    done = failed = 0
    with httpx.Client(timeout=60, headers=h) as cx:
        for mb in sorted(mbox_dir.glob("*.mbox")):
            for msg in mailbox.mbox(str(mb)):
                raw = msg.as_bytes()
                sent = bool(me_addr) and me_addr in str(msg.get("From", ""))
                body = {"raw": base64.urlsafe_b64encode(raw).decode(), "labelIds": ["SENT"] if sent else ["INBOX"]}
                for attempt in range(4):
                    r = cx.post("https://gmail.googleapis.com/gmail/v1/users/me/messages/import",
                                params={"internalDateSource": "dateHeader", "neverMarkSpam": "true"}, json=body)
                    if r.status_code == 429:
                        time.sleep(1 + attempt)
                        continue
                    break
                if r.status_code < 300:
                    done += 1
                else:
                    failed += 1
                    log.warning("gmail import failed: %s", r.text[:200])
    return {"imported": done, "failed": failed}


# -- GitHub
GH = "https://api.github.com"
DOC_EXT = {".md", ".markdown", ".txt", ".rst", ".yaml", ".yml"}


def _import_github(eid: int) -> dict:
    tok = _token(eid, "github")
    h = {"Authorization": f"Bearer {tok['access_token']}", "Accept": "application/vnd.github+json",
         "X-GitHub-Api-Version": "2022-11-28"}
    counts = {"repos": 0, "docs": 0, "threads": 0}
    tmp = settings.data_dir / "uploads" / f"github_{eid}"
    tmp.mkdir(parents=True, exist_ok=True)
    chat_rows: list[dict] = []
    with httpx.Client(timeout=40, headers=h, follow_redirects=True) as cx:
        repos = cx.get(f"{GH}/user/repos", params={"sort": "pushed", "per_page": MAX_REPOS,
                                                   "affiliation": "owner,collaborator,organization_member"}).json()
        for repo in repos[:MAX_REPOS] if isinstance(repos, list) else []:
            full, branch = repo["full_name"], repo.get("default_branch", "main")
            counts["repos"] += 1
            tree = cx.get(f"{GH}/repos/{full}/git/trees/{branch}", params={"recursive": 1}).json().get("tree", [])
            docs = [t for t in tree if t.get("type") == "blob" and Path(t["path"]).suffix.lower() in DOC_EXT
                    and t.get("size", 0) < 200_000][:25]
            for t in docs:
                r = cx.get(f"{GH}/repos/{full}/contents/{t['path']}", headers={"Accept": "application/vnd.github.raw"},
                           params={"ref": branch})
                if r.status_code == 200:
                    dst = tmp / repo["name"] / t["path"]
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    dst.write_bytes(r.content)
                    counts["docs"] += 1
            for kind in ("pulls", "issues"):
                items = cx.get(f"{GH}/repos/{full}/{kind}", params={"state": "all", "per_page": 30}).json()
                for it in items if isinstance(items, list) else []:
                    if kind == "issues" and it.get("pull_request"):
                        continue
                    num = it["number"]
                    label = f"{repo['name']} #{num}"
                    chat_rows.append({"cid": f"gh:{full}", "name": f"GitHub · {repo['name']}", "thread": f"gh:{full}:{num}",
                                      "id": f"gh:{full}:{num}:0", "author": (it.get("user") or {}).get("login", ""),
                                      "at": it.get("created_at"), "text": f"{'PR' if kind == 'pulls' else 'Issue'} {label}: "
                                      f"{it.get('title', '')} [{it.get('state')}{', merged' if it.get('merged_at') else ''}]\n"
                                      f"{(it.get('body') or '')[:4000]}", "url": it.get("html_url")})
                    comments = cx.get(f"{GH}/repos/{full}/issues/{num}/comments", params={"per_page": 50}).json()
                    if kind == "pulls":
                        rc = cx.get(f"{GH}/repos/{full}/pulls/{num}/comments", params={"per_page": 50}).json()
                        comments = (comments if isinstance(comments, list) else []) + (rc if isinstance(rc, list) else [])
                    for k, cm in enumerate(comments if isinstance(comments, list) else [], 1):
                        chat_rows.append({"cid": f"gh:{full}", "name": f"GitHub · {repo['name']}", "thread": f"gh:{full}:{num}",
                                          "id": f"gh:{full}:{num}:{cm.get('id', k)}",
                                          "author": (cm.get("user") or {}).get("login", ""), "at": cm.get("created_at"),
                                          "text": (cm.get("body") or "")[:3000], "url": cm.get("html_url")})
    with SessionLocal() as db:
        seen = {i for (i,) in db.execute(select(SourceItem.ext_id).where(SourceItem.clone_id == eid, SourceItem.kind == "chat"))}
        for row in chat_rows:
            if row["id"] in seen or not row["text"].strip():
                continue
            db.add(SourceItem(clone_id=eid, kind="chat", ext_id=row["id"][:300], container=row["cid"][:300],
                              thread_key=row["thread"][:300], title=row["name"][:500], author=row["author"],
                              sent_at=SRC._dt(row["at"]), body=row["text"], clean=row["text"], is_noise=False,
                              noise_reason="", meta={"system": "github", "channel_name": row["name"], "url": row["url"],
                                                     "channel_kind": "channel", "members": [], "reactions": []}))
            counts["threads"] += 1
        if counts["docs"]:
            SRC.load_folder(db, eid, tmp, prefix="GitHub/")
        db.commit()
    return counts


