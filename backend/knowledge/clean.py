"""Plain-code filtering before any model sees data (spec 4.2 step 1).

- strip quoted replies ("On … wrote:", "> " lines, "-----Original Message-----", Outlook headers)
- strip signatures ("-- ", "Best,"/"Thanks," + name block, "Sent from my iPhone")
- classify noise: newsletters, notifications, calendar traffic, auto-replies, receipts, one-line thanks
- dedupe: identical cleaned bodies within a thread count once
"""
from __future__ import annotations

import hashlib
import re

QUOTE_HEADERS = [
    re.compile(r"(?im)^\s*On .{3,200}wrote:\s*$"),
    re.compile(r"(?im)^\s*-{2,}\s*Original Message\s*-{2,}\s*$"),
    re.compile(r"(?im)^\s*From:\s.+\n\s*Sent:\s.+\n\s*To:\s", re.M),
    re.compile(r"(?im)^\s*_{10,}\s*$"),
]
SIG_MARKERS = [
    re.compile(r"(?m)^-- ?$"),
    re.compile(r"(?im)^\s*sent from my (iphone|ipad|android|mobile)"),
    re.compile(r"(?im)^\s*get outlook for (ios|android)"),
]
CLOSINGS = re.compile(r"(?im)^\s*(best|thanks|thank you|cheers|regards|best regards|kind regards|warmly|talk soon|—|-)\s*,?\s*$")

NOISE_FROM = re.compile(r"(?i)(no-?reply|noreply|notifications?|newsletter|news@|digest|mailer|updates@|marketing|"
                        r"calendar|jira@|github|atlassian|do-not-reply|donotreply|alerts?@|billing@|shipping@|orders@|"
                        r"hr@|all-?hands|announce)")
NOISE_SUBJECT = re.compile(r"(?i)^(re:\s*)?(accepted|declined|tentative|invitation|updated invitation|canceled|cancelled):|"
                           r"\b(newsletter|weekly digest|webinar|unsubscribe|your order|has shipped|out of office|"
                           r"automatic reply|auto(matic)?[- ]reply|password reset|security alert|receipt|invoice #|"
                           r"\[jira\]|\[github\]|pull request|build (passed|failed)|% off|sale ends)")
NOISE_BODY = re.compile(r"(?i)(unsubscribe|view (this email )?in (your )?browser|manage (your )?preferences|"
                        r"this is an automated (message|email)|do not reply to this|you are receiving this)")
THANKS_ONLY = re.compile(r"(?i)^\W*(thanks|thank you|thx|ty|great|perfect|got it|sounds good|will do|ok|okay|"
                         r"awesome|noted|👍|🙏)[\s!.,:)👍🙏]*(\w+)?\W*$")


def strip_quotes(body: str) -> str:
    text = body.replace("\r\n", "\n")
    cut = len(text)
    for rx in QUOTE_HEADERS:
        m = rx.search(text)
        if m:
            cut = min(cut, m.start())
    text = text[:cut]
    text = "\n".join(ln for ln in text.split("\n") if not ln.lstrip().startswith(">"))
    return text.strip()


def strip_signature(text: str) -> str:
    cut = len(text)
    for rx in SIG_MARKERS:
        m = rx.search(text)
        if m:
            cut = min(cut, m.start())
    text = text[:cut].rstrip()
    lines = text.split("\n")
    # "Thanks,\nDana\nSenior Engineer | Company" at the end → drop the block
    for i in range(len(lines) - 1, max(-1, len(lines) - 8), -1):
        if CLOSINGS.match(lines[i]):
            tail = lines[i + 1:]
            if len(tail) <= 5 and all(len(t) < 80 for t in tail):
                lines = lines[:i]
            break
    return "\n".join(lines).strip()


def clean_mail(body: str) -> str:
    return re.sub(r"\n{3,}", "\n\n", strip_signature(strip_quotes(body))).strip()


ACK_WORDS = set("thanks thank you thx ty great perfect got it sounds good will do ok okay awesome noted cheers much "
                "appreciated appreciate so glad to hear that's lovely nice cool sure super".split())
BROADCAST = re.compile(r"(?i)\b(office (is )?closed|holiday party|open enrollment|all-?hands|benefits|potluck|birthday|"
                       r"password (expires|reset)|vpn maintenance|scheduled maintenance|parking lot|fire drill|"
                       r"payroll|timesheet|pto reminder|wellness|holiday schedule|kitchen|food truck|recycling|picnic|"
                       r"coffee machine|blood drive|ugly sweater|bake sale|fantasy football|lunch is on us)\b")
IT_HR_FROM = re.compile(r"(?i)^(it|hr|helpdesk|help|support|facilities|office|people|payroll)@")


def is_ack(text: str) -> bool:
    words = re.findall(r"[a-z']+", (text or "").lower())
    if not words or len(text) > 70:
        return False
    extra = [w for w in words if w not in ACK_WORDS]
    return len(extra) <= 1 and len(words) - len(extra) >= 1


def classify_mail(sender: str, subject: str, body: str, clean: str, headers: dict | None = None) -> str:
    """Return a noise reason, or '' if the message should be read."""
    h = {k.lower(): v for k, v in (headers or {}).items()}
    if h.get("auto-submitted", "no").lower() not in ("", "no") or h.get("precedence", "").lower() in ("bulk", "list", "junk"):
        return "Automatic message"
    if "list-unsubscribe" in h:
        return "Newsletter"
    if h.get("content-type", "").lower().startswith("text/calendar"):
        return "Calendar traffic"
    if NOISE_SUBJECT.search(subject or ""):
        s = subject.lower()
        if any(k in s for k in ("accepted", "declined", "invitation", "canceled", "cancelled", "tentative")):
            return "Calendar traffic"
        if "out of office" in s or "automatic reply" in s or "auto" in s:
            return "Auto-reply"
        if "[jira]" in s or "[github]" in s or "pull request" in s or "build" in s:
            return "Notification"
        return "Newsletter or receipt"
    if NOISE_FROM.search(sender or ""):
        return "Notification"
    addr = (sender or "").split()[-1] if sender else ""
    if IT_HR_FROM.search(addr) or (BROADCAST.search(subject or "") and len(clean) < 600):
        return "Company announcement"
    if NOISE_BODY.search(body or ""):
        return "Newsletter"
    if (len(clean) < 40 and THANKS_ONLY.match(clean or "")) or is_ack(clean):
        return "Short acknowledgement"
    return ""


def classify_chat(text: str) -> str:
    t = (text or "").strip()
    if not t:
        return "Empty"
    if (len(t) < 25 and THANKS_ONLY.match(t)) or is_ack(t):
        return "Short acknowledgement"
    return ""


def fingerprint(text: str) -> str:
    norm = re.sub(r"\W+", " ", (text or "").lower()).strip()
    return hashlib.sha1(norm.encode()).hexdigest()[:16]


# ---------------------------------------------------------------- personal vs work (code only, never sent to AI)
CONSUMER = re.compile(r"(?i)@(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|mac|aol|proton(mail)?|"
                      r"gmx|comcast|att|verizon)\.")
PERSONAL_CUES = re.compile(
    r"(?i)\b(mom|dad|mum|grandma|grandpa|sis|bro|honey|babe|sweetie|my (wife|husband|partner|kids?|son|daughter|family)|"
    r"doctor'?s? appointment|dentist|prescription|pharmacy|clinic|diagnos\w*|therapy|pregnan\w*|"
    r"wedding|baby shower|birthday party|bachelorette|date night|dinner tonight|movie tonight|"
    r"bank statement|credit card statement|mortgage|rent is due|landlord|lease renewal|tax return|venmo|zelle|"
    r"netflix|spotify|hulu|dating|tinder|bumble|vacation photos|apartment tour|daycare|school pickup|"
    r"parent[- ]teacher|soccer practice|church|yoga class|gym membership)\b")


def classify_personal(sender: str, subject: str, body: str, work_domain: str = "") -> str:
    """'Personal' when the message is clearly about private life. Work talk from a personal address stays work."""
    text = f"{subject}\n{body[:3000]}"
    cues = len(set(m.group(0).lower() for m in PERSONAL_CUES.finditer(text)))
    from_consumer = bool(CONSUMER.search(sender or ""))
    from_work = bool(work_domain) and work_domain.lower() in (sender or "").lower()
    if cues >= 2 or (cues >= 1 and not from_work) or (from_consumer and cues >= 1):
        return "Personal"
    return ""
