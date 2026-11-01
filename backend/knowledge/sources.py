"""Load real export formats into browsable SourceItems (mail, chat, files). No model calls."""
from __future__ import annotations

import email
import email.policy
import hashlib
import json
import mailbox
import re
import shutil
import zipfile
from datetime import datetime
from email.utils import getaddresses, parseaddr, parsedate_to_datetime
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from backend.app.config import settings
from backend.db.models_knowledge import SourceConsent, SourceItem
from backend.knowledge.parse import _msg_body, _norm_subject, parse_document
from . import clean as C

FILE_KINDS = {".md": "text", ".txt": "text", ".markdown": "text", ".csv": "sheet", ".tsv": "sheet", ".xlsx": "sheet",
              ".pdf": "pdf", ".docx": "doc", ".doc": "doc", ".pptx": "doc", ".json": "text", ".yaml": "text",
              ".yml": "text", ".py": "text", ".ino": "text", ".cpp": "text", ".h": "text", ".c": "text",
              ".png": "image", ".jpg": "image", ".jpeg": "image", ".webp": "image", ".gif": "image",
              ".mp4": "video", ".mov": "video", ".webm": "video", ".m4v": "video"}
SKIP = {".DS_Store", "Thumbs.db"}


def _dt(value) -> datetime | None:
    if not value:
        return None
    try:
        d = parsedate_to_datetime(str(value))
    except Exception:
        try:
            d = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except Exception:
            return None
    return d.astimezone().replace(tzinfo=None) if d.tzinfo else d


def media_dir(eid: int) -> Path:
    d = settings.data_dir / "media" / f"clone_{eid}" / "files"
    d.mkdir(parents=True, exist_ok=True)
    return d


def set_connected(db: Session, eid: int, kind: str, provider: str) -> None:
    c = db.scalar(select(SourceConsent).where(SourceConsent.clone_id == eid, SourceConsent.kind == kind))
    if c is None:
        c = SourceConsent(clone_id=eid, kind=kind, consent=False)
        db.add(c)
    c.provider = provider
    c.connected_at = datetime.utcnow()


# ---------------------------------------------------------------- mail
_DOMAINS: dict[int, str] = {}


def _work_domain(db: Session, eid: int) -> str:
    """The company's email domain (from the person's account, or the most common sender domain)."""
    if eid not in _DOMAINS:
        from collections import Counter

        from backend.db.models import Clone, User

        c = db.get(Clone, eid)
        u = db.get(User, c.owner_user_id) if c and c.owner_user_id else None
        dom = u.email.split("@")[-1] if u and not C.CONSUMER.search(u.email) else ""
        if not dom:
            doms = Counter(e.split("@")[-1] for (e,) in db.execute(
                select(SourceItem.author_email).where(SourceItem.clone_id == eid, SourceItem.kind == "mail")) if e)
            dom = next((d for d, _ in doms.most_common() if not C.CONSUMER.search("@" + d)), "")
        _DOMAINS[eid] = dom
    return _DOMAINS[eid]


def _add_mail(db: Session, eid: int, msg, folder: str, seen: set) -> bool:
    mid = (msg.get("Message-ID") or "").strip() or hashlib.sha1(str(msg).encode("utf-8", "ignore")).hexdigest()
    if mid in seen:
        return False
    seen.add(mid)
    refs = (msg.get("References") or "").split()
    root = refs[0] if refs else (msg.get("In-Reply-To") or "").strip() or None
    subject = str(msg.get("Subject") or "")
    thread_key = root or "subj:" + _norm_subject(subject)
    name, addr = parseaddr(str(msg.get("From") or ""))
    to = [f"{n} <{a}>".strip() if n else a for n, a in getaddresses([str(msg.get("To") or ""), str(msg.get("Cc") or "")]) if a]
    body = _msg_body(msg) or ""
    cleaned = C.clean_mail(body)
    headers = {k: str(v) for k, v in msg.items()}
    reason = C.classify_personal(f"{name} {addr}", subject, cleaned, _work_domain(db, eid)) or \
        C.classify_mail(f"{name} {addr}", subject, body, cleaned, headers)
    if reason == "Personal":
        cleaned = ""  # masked: the AI never sees personal mail; the owner can still open it in their own viewer
    db.add(SourceItem(clone_id=eid, kind="mail", ext_id=mid[:300], container=folder or "Inbox", thread_key=thread_key[:300],
                      title=subject[:500], author=name or addr, author_email=addr, recipients=to[:30],
                      sent_at=_dt(msg.get("Date")), body=body[:60000], clean=cleaned[:20000], is_noise=bool(reason),
                      noise_reason=reason, meta={"in_reply_to": (msg.get("In-Reply-To") or "").strip()}))
    return True


def load_mbox(db: Session, eid: int, path: Path, default_folder: str = "Inbox") -> int:
    box = mailbox.mbox(str(path), factory=lambda f: email.message_from_binary_file(f, policy=email.policy.default))
    seen = {i for (i,) in db.execute(select(SourceItem.ext_id).where(SourceItem.clone_id == eid, SourceItem.kind == "mail"))}
    n = 0
    for msg in box:
        if msg is None:
            continue
        folder = str(msg.get("X-Folder") or msg.get("X-Gmail-Labels", "").split(",")[0] or default_folder).strip()
        n += _add_mail(db, eid, msg, folder, seen)
    return n


def load_eml(db: Session, eid: int, path: Path) -> int:
    msg = email.message_from_bytes(path.read_bytes(), policy=email.policy.default)
    seen = set()
    return int(_add_mail(db, eid, msg, str(msg.get("X-Folder") or "Inbox"), seen))


def load_olm(db: Session, eid: int, path: Path) -> int:
    """Outlook for Mac archive → mail items (folder from the archive path)."""
    import xml.etree.ElementTree as ET

    from email.message import EmailMessage

    seen = {i for (i,) in db.execute(select(SourceItem.ext_id).where(SourceItem.clone_id == eid, SourceItem.kind == "mail"))}
    n = 0
    with zipfile.ZipFile(path) as zf:
        for info in zf.infolist():
            if not info.filename.lower().endswith(".xml") or "__Messages" not in info.filename:
                continue
            try:
                root = ET.fromstring(zf.read(info))
            except ET.ParseError:
                continue
            folder = info.filename.split("com.microsoft.__Messages/")[-1].rsplit("/", 1)[0] or "Inbox"
            for m in root.iter("email"):
                def t(tag):
                    e = m.find(tag)
                    return (e.text or "").strip() if e is not None and e.text else ""

                def addrs(tag):
                    e = m.find(tag)
                    if e is None:
                        return []
                    return [f'{a.get("OPFContactEmailAddressName", "")} <{a.get("OPFContactEmailAddressAddress", "")}>'.strip()
                            for a in e.iter("emailAddress")]
                em = EmailMessage()
                em["Subject"] = t("OPFMessageCopySubject")
                em["From"] = (addrs("OPFMessageCopySenderAddress") or addrs("OPFMessageCopyFromAddresses") or [""])[0]
                em["To"] = ", ".join(addrs("OPFMessageCopyToAddresses"))
                if t("OPFMessageCopyMessageID"):
                    em["Message-ID"] = t("OPFMessageCopyMessageID")
                sent = t("OPFMessageCopySentTime")
                if sent:
                    em["Date"] = sent
                em.set_content(t("OPFMessageCopyBody") or re.sub(r"<[^>]+>", " ", t("OPFMessageCopyHTMLBody")))
                n += _add_mail(db, eid, em, folder, seen)
    return n


# ---------------------------------------------------------------- chat
def load_teams_json(db: Session, eid: int, path: Path) -> int:
    data = json.loads(path.read_text(encoding="utf-8"))
    n = 0
    for ch in data.get("channels", []):
        cid = str(ch.get("id") or ch.get("name"))
        for m in ch.get("messages", []):
            reason = C.classify_personal(m.get("author", ""), "", m.get("text", ""), "x") or \
                C.classify_chat(m.get("text", ""))
            db.add(SourceItem(clone_id=eid, kind="chat", ext_id=f"{cid}:{m.get('id')}"[:300], container=cid,
                              thread_key=f"{cid}:{m.get('thread_id') or m.get('id')}"[:300], title=ch.get("name", cid),
                              author=m.get("author", ""), sent_at=_dt(m.get("sent_at")), body=m.get("text", ""),
                              clean="" if reason == "Personal" else m.get("text", ""), is_noise=bool(reason),
                              noise_reason=reason,
                              meta={"reactions": m.get("reactions", []), "channel_kind": ch.get("kind", "channel"),
                                    "members": ch.get("members", []), "channel_name": ch.get("name", cid)}))
            n += 1
    return n


# ---------------------------------------------------------------- files
def load_folder(db: Session, eid: int, root: Path, prefix: str = "") -> int:
    store = media_dir(eid)
    n = 0
    for f in sorted(root.rglob("*")):
        if not f.is_file() or f.name in SKIP or f.name.startswith("."):
            continue
        rel = (prefix + str(f.relative_to(root))).replace("\\", "/")
        kind = FILE_KINDS.get(f.suffix.lower(), "other")
        dst = store / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(f, dst)
        text = ""
        if kind in ("text", "sheet") and f.suffix.lower() != ".xlsx":
            text = f.read_text(encoding="utf-8", errors="ignore")[:60000]
        elif f.suffix.lower() == ".xlsx":
            text = _xlsx_text(f)
        elif kind in ("pdf", "doc"):
            try:
                text = "\n\n".join(ev.text for ev in parse_document(f))[:60000]
            except Exception:
                text = ""
        db.add(SourceItem(clone_id=eid, kind="file", ext_id=rel[:300], container=str(Path(rel).parent),
                          thread_key=rel[:300], title=f.name, author="", sent_at=datetime.fromtimestamp(f.stat().st_mtime),
                          body=text, clean=text, is_noise=False,
                          meta={"file_kind": kind, "size": f.stat().st_size, "path": rel,
                                "url": f"/api/media/clone_{eid}/files/{rel}"}))
        n += 1
    return n


def _xlsx_text(f: Path) -> str:
    try:
        import openpyxl

        wb = openpyxl.load_workbook(f, read_only=True, data_only=True)
        out = []
        for ws in wb.worksheets:
            for row in ws.iter_rows(values_only=True):
                out.append(",".join("" if v is None else str(v) for v in row))
        return "\n".join(out)[:60000]
    except Exception:
        return ""


def load_upload(db: Session, eid: int, kind: str, path: Path, work: Path) -> int:
    """Upload handler per source card kind."""
    ext = path.suffix.lower()
    if kind == "email":
        if ext == ".olm":
            return load_olm(db, eid, path)
        if ext == ".eml":
            return load_eml(db, eid, path)
        return load_mbox(db, eid, path)
    if kind == "chat":
        return load_teams_json(db, eid, path)
    if kind == "files":
        if ext == ".zip":
            out = work / path.stem
            with zipfile.ZipFile(path) as z:
                z.extractall(out)
            return load_folder(db, eid, out)
        tmp = work / "single"
        tmp.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, tmp / path.name)
        return load_folder(db, eid, tmp)
    raise ValueError(f"unsupported source kind {kind}")


def clear(db: Session, eid: int, kinds=("mail", "chat", "file")) -> None:
    db.execute(delete(SourceItem).where(SourceItem.clone_id == eid, SourceItem.kind.in_(kinds)))
