"""Secrets-only redaction patterns: passwords, keys, card/account/ID numbers are removed before any model call."""
from __future__ import annotations

import re

SSN_RE = re.compile(r"(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)")
ACCOUNT_RE = re.compile(
    r"(?i)\b(acct|account|a/c|routing|iban|swift|sort code|account no\.?|acct no\.?|account number|"
    r"bank account|member id|policy (?:no|number))\b[\s#:.-]*(?:is\s*)?([A-Z0-9][A-Z0-9 -]{4,32}[A-Z0-9])")
PASSWORD_RE = re.compile(
    r"(?i)\b(password|passwd|pwd|passcode|pass code|pin|temp(?:orary)? password|login|credentials?|secret)\b"
    r"(\s*(?:is|was|=|:|->|to)\s*[\"'`]?)([^\s\"'`,;]{4,64})")
KEY_RES = [
    re.compile(r"\b(?:sk|pk|rk)[-_](?:live|test|prod)?[-_]?[A-Za-z0-9]{12,}\b"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b"),
    re.compile(r"\bxox[abpr]-[A-Za-z0-9-]{10,}\b"),
    re.compile(r"\bAIza[0-9A-Za-z_-]{30,}\b"),
    re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b"),  # JWT
    re.compile(r"(?i)\b(?:api[_-]?key|token|secret[_-]?key|access[_-]?key)\b\s*[:=]\s*[\"']?([A-Za-z0-9_\-./+=]{12,})"),
    re.compile(r"\b(?=[A-Za-z0-9_\-]*\d)(?=[A-Za-z0-9_\-]*[A-Z])(?=[A-Za-z0-9_\-]*[a-z])[A-Za-z0-9_\-]{32,}\b"),
]
# A token that looks like a credential: mixes letters, digits and symbols (e.g. Gantry78%pL).
CREDENTIAL_TOKEN_RE = re.compile(
    r"(?<![\w@])(?=[^\s]*[a-z])(?=[^\s]*[A-Z])(?=[^\s]*\d)(?=[^\s]*[!#$%^&*+=?~|])[A-Za-z0-9!#$%^&*+=?~|._-]{7,64}(?![\w])")
LOGIN_PAIR_RE = re.compile(r"(?i)\b(login|log-in|sign[- ]?in|username|user)\b([^\n]{0,20}?\b[\w.@-]{2,40})\s*/\s*(\S{4,64})")
CARD_GROUPS_RE = re.compile(r"(?<!\d)\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{2,4}(?!\d)")
CARD_CONTEXT_RE = re.compile(r"(?i)\b(card|visa|mastercard|amex|credit|debit|cc)\b[^\n]{0,30}?((?:\d[ -]?){12,18}\d)")
