"""Accounts: organizations, people, invitations, and the handover record for each departing employee.

Multi-tenant: every row belongs to an organization (directly or through a handover). The knowledge itself
(sources, cards, interviews, asks) lives in models_knowledge.py.
"""
from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import JSON, Boolean, Date, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Base(DeclarativeBase):
    pass


class Org(Base):
    __tablename__ = "orgs"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(200), unique=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    plan: Mapped[str] = mapped_column(String(20), default="starter")  # starter | growth | pro
    profile: Mapped[dict] = mapped_column(JSON, default=dict)  # what the setup conversation learned
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("orgs.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(200), default="")  # empty for Supabase accounts
    auth_id: Mapped[str | None] = mapped_column(String(64), unique=True, index=True)  # Supabase user id
    role: Mapped[str] = mapped_column(String(20), default="member")  # admin | member
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    org: Mapped[Org] = relationship()


class Invite(Base):
    __tablename__ = "invites"
    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("orgs.id", ondelete="CASCADE"), index=True)
    email: Mapped[str] = mapped_column(String(320))
    role: Mapped[str] = mapped_column(String(20), default="member")
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    accepted: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Clone(Base):
    """One departing employee's handover (historically called a clone: the knowledge pack that stays behind)."""
    __tablename__ = "clones"
    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("orgs.id", ondelete="CASCADE"), index=True)
    owner_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    expert_name: Mapped[str] = mapped_column(String(200))
    title: Mapped[str] = mapped_column(String(200), default="")
    department: Mapped[str] = mapped_column(String(200), default="")
    years_at_company: Mapped[int | None] = mapped_column(Integer)
    leaving_on: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default="capturing")
    escalate_name: Mapped[str | None] = mapped_column(String(200))
    escalate_email: Mapped[str | None] = mapped_column(String(320))
    settings: Mapped[dict] = mapped_column(JSON, default=dict)  # thresholds, keep budget, etc.
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    owner: Mapped[User | None] = relationship()
