"""The admin's setup assistant (Milo-style conversation that shapes the console and invites people)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.onboarding import assistant as A
from .auth import Ctx, current, require_ai

router = APIRouter(prefix="/api")


def _admin(ctx: Ctx) -> None:
    if not ctx.is_admin:
        raise HTTPException(403, "Only the organization's admin can do this.")


class SetupMsgIn(BaseModel):
    text: str


@router.get("/setup")
def setup_state(ctx: Ctx = Depends(current)):
    _admin(ctx)
    return A.state(ctx.user)


@router.post("/setup/message")
def setup_message(body: SetupMsgIn, ctx: Ctx = Depends(current)):
    _admin(ctx)
    if not body.text.strip():
        raise HTTPException(400, "Type a message first.")
    require_ai()
    return A.message(ctx.user, body.text)


class FinishIn(BaseModel):
    skipped: bool = False


@router.post("/setup/finish")
def setup_finish(body: FinishIn, ctx: Ctx = Depends(current)):
    _admin(ctx)
    return A.finish(ctx.user, body.skipped)
