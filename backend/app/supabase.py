"""Supabase Auth: verified emails, passwords, password resets and invitation emails.

The browser signs in with Supabase (supabase-js) and hands the access token to POST /api/auth/session once; the
engine checks it with Supabase, finds or creates the Clone Flow account, and sets its own session cookie. When
SUPABASE_URL / SUPABASE_ANON_KEY are not set (local development, tests) the built-in email + password sign-in is used.
"""
from __future__ import annotations

import logging

import httpx

from .config import settings

log = logging.getLogger("cloneflow.supabase")


def enabled() -> bool:
    return bool(settings.supabase_url and settings.supabase_anon_key)


def public_config() -> dict:
    if not enabled():
        return {"provider": "local"}
    return {"provider": "supabase", "url": settings.supabase_url.rstrip("/"), "anon_key": settings.supabase_anon_key}


def get_user(access_token: str) -> dict | None:
    """The Supabase user behind an access token, or None if the token is invalid or expired."""
    if not enabled() or not access_token:
        return None
    try:
        r = httpx.get(f"{settings.supabase_url.rstrip('/')}/auth/v1/user", timeout=15,
                      headers={"apikey": settings.supabase_anon_key, "Authorization": f"Bearer {access_token}"})
    except httpx.HTTPError:
        log.warning("Supabase is not reachable")
        return None
    return r.json() if r.status_code == 200 else None


def send_invite(email: str, redirect_to: str, data: dict) -> bool:
    """Email an invitation through Supabase (needs SUPABASE_SERVICE_ROLE_KEY). False if not sent (no key, or the
    address already has a Supabase account) — the admin can still copy the link."""
    if not (enabled() and settings.supabase_service_key):
        return False
    key = settings.supabase_service_key
    try:
        r = httpx.post(f"{settings.supabase_url.rstrip('/')}/auth/v1/invite", params={"redirect_to": redirect_to},
                       json={"email": email, "data": data}, timeout=20,
                       headers={"apikey": key, "Authorization": f"Bearer {key}"})
    except httpx.HTTPError:
        log.warning("invite email not sent: Supabase not reachable")
        return False
    if r.status_code >= 300:
        log.info("invite email not sent (%s): %s", r.status_code, r.text[:200])
        return False
    return True
