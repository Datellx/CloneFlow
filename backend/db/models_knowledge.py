"""Knowledge tables: sources and their items, consent, read runs, knowledge cards, interviews, asks, phone walks, cost log.
The departing employee is the `Clone` row in models.py (eid = clone id)."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .models import Base, utcnow

CARD_TYPES = ("process", "decision", "system", "contact", "location", "open_task", "routine", "fact")
GAP_TYPES = ("missing_why", "contradiction", "unfinished_task", "undocumented_step", "who_to_contact")


class SourceItem(Base):
    """One raw item the employee can browse: an email, a chat message, or a file."""
    __tablename__ = "source_items"
    __table_args__ = (UniqueConstraint("clone_id", "kind", "ext_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    clone_id: Mapped[int] = mapped_column(ForeignKey("clones.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(10))            # mail | chat | file
    ext_id: Mapped[str] = mapped_column(String(300))         # Message-ID, chat message id, file path
    container: Mapped[str] = mapped_column(String(300), default="")   # mail folder | channel id | parent dir
    thread_key: Mapped[str] = mapped_column(String(300), default="", index=True)
    title: Mapped[str] = mapped_column(String(500), default="")       # subject | channel name | file name
    author: Mapped[str] = mapped_column(String(200), default="")
    author_email: Mapped[str] = mapped_column(String(320), default="")
    recipients: Mapped[list] = mapped_column(JSON, default=list)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime)
    body: Mapped[str] = mapped_column(Text, default="")              # full text as written
    clean: Mapped[str] = mapped_column(Text, default="")             # quotes/signatures stripped (what AI may see, after masking)
    is_noise: Mapped[bool] = mapped_column(Boolean, default=False)   # filtered by code before AI
    noise_reason: Mapped[str] = mapped_column(String(100), default="")
    excluded: Mapped[bool] = mapped_column(Boolean, default=False)   # employee excluded it
    meta: Mapped[dict] = mapped_column(JSON, default=dict)           # reactions, file kind/size/path, x-folder…


class SourceConsent(Base):
    __tablename__ = "source_consents"
    __table_args__ = (UniqueConstraint("clone_id", "kind"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    clone_id: Mapped[int] = mapped_column(ForeignKey("clones.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(10))            # email | chat | files | screen | floor
    consent: Mapped[bool] = mapped_column(Boolean, default=False)
    provider: Mapped[str | None] = mapped_column(String(100))
    connected_at: Mapped[datetime | None] = mapped_column(DateTime)


class Card(Base):
    """Knowledge card — the core unit of the product."""
    __tablename__ = "cards"
    id: Mapped[int] = mapped_column(primary_key=True)
    clone_id: Mapped[int] = mapped_column(ForeignKey("clones.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(20), index=True)
    title: Mapped[str] = mapped_column(String(300))
    body: Mapped[str] = mapped_column(Text, default="")
    steps: Mapped[list] = mapped_column(JSON, default=list)
    project: Mapped[str | None] = mapped_column(String(200))
    area: Mapped[str | None] = mapped_column(String(200))    # knowledge area for the map
    sources: Mapped[list] = mapped_column(JSON, default=list)  # [{kind, ref, label, timestamp_s?, frame_url?, quote?}]
    confidence: Mapped[float] = mapped_column(Float, default=0.6)
    status: Mapped[str] = mapped_column(String(30), default="inferred")  # inferred | verified_in_interview | contradicted
    related_people: Mapped[list] = mapped_column(JSON, default=list)
    related_projects: Mapped[list] = mapped_column(JSON, default=list)
    embedding: Mapped[list | None] = mapped_column(JSON)
    origin: Mapped[str] = mapped_column(String(20), default="read")   # read | interview | screen | floor
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class Run(Base):
    __tablename__ = "runs"
    id: Mapped[int] = mapped_column(primary_key=True)
    clone_id: Mapped[int] = mapped_column(ForeignKey("clones.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="running")
    stage: Mapped[str] = mapped_column(String(20), default="filter")
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    counters: Mapped[dict] = mapped_column(JSON, default=dict)
    coverage: Mapped[int] = mapped_column(Integer, default=0)
    gaps: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    replay: Mapped[bool] = mapped_column(Boolean, default=False)   # streamed from a cached run
    error: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime)


class FeedItem(Base):
    __tablename__ = "feed_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), index=True)
    seq: Mapped[int] = mapped_column(Integer)
    at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    type: Mapped[str] = mapped_column(String(20))
    title: Mapped[str] = mapped_column(String(300))
    detail: Mapped[str] = mapped_column(String(500), default="")
    source_kind: Mapped[str] = mapped_column(String(10), default="")
    card_id: Mapped[int | None] = mapped_column(Integer)


class InterviewV2(Base):
    __tablename__ = "interviews_v2"
    id: Mapped[int] = mapped_column(primary_key=True)
    clone_id: Mapped[int] = mapped_column(ForeignKey("clones.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="not_started")
    opening_line: Mapped[str] = mapped_column(Text, default="")
    closing_line: Mapped[str | None] = mapped_column(Text)
    summary: Mapped[dict | None] = mapped_column(JSON)
    coverage_before: Mapped[int] = mapped_column(Integer, default=0)
    current_index: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class QuestionV2(Base):
    __tablename__ = "questions_v2"
    id: Mapped[int] = mapped_column(primary_key=True)
    interview_id: Mapped[int] = mapped_column(ForeignKey("interviews_v2.id", ondelete="CASCADE"), index=True)
    index: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(10))           # about_you | gap
    gap_type: Mapped[str | None] = mapped_column(String(30))
    text: Mapped[str] = mapped_column(Text)
    evidence: Mapped[list] = mapped_column(JSON, default=list)
    project: Mapped[str | None] = mapped_column(String(200))
    card_ids: Mapped[list] = mapped_column(JSON, default=list)   # cards the gap is about
    status: Mapped[str] = mapped_column(String(20), default="open")
    answer: Mapped[dict | None] = mapped_column(JSON)       # {transcript, mode, card_ids, at}


class WalkSession(Base):
    __tablename__ = "walk_sessions"
    id: Mapped[int] = mapped_column(primary_key=True)
    interview_id: Mapped[int] = mapped_column(ForeignKey("interviews_v2.id", ondelete="CASCADE"), index=True)
    question_id: Mapped[int | None] = mapped_column(Integer)
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    status: Mapped[str] = mapped_column(String(20), default="waiting")   # waiting | live | finished
    transcript: Mapped[str] = mapped_column(Text, default="")
    last_hash: Mapped[str | None] = mapped_column(String(32))
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class WalkFrame(Base):
    __tablename__ = "walk_frames"
    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("walk_sessions.id", ondelete="CASCADE"), index=True)
    seq: Mapped[int] = mapped_column(Integer)
    t: Mapped[float] = mapped_column(Float, default=0.0)
    path: Mapped[str] = mapped_column(String(1000))
    phash: Mapped[str] = mapped_column(String(32))
    reason: Mapped[str] = mapped_column(String(40), default="scene")    # scene | pointing | first
    transcript: Mapped[str] = mapped_column(Text, default="")
    label: Mapped[str] = mapped_column(String(200), default="")
    at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class AskV2(Base):
    __tablename__ = "asks_v2"
    id: Mapped[int] = mapped_column(primary_key=True)
    clone_id: Mapped[int] = mapped_column(ForeignKey("clones.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int | None] = mapped_column(Integer)
    question: Mapped[str] = mapped_column(Text)
    qkey: Mapped[str] = mapped_column(String(64), index=True)
    answer: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class CostLog(Base):
    __tablename__ = "cost_log"
    id: Mapped[int] = mapped_column(primary_key=True)
    clone_id: Mapped[int | None] = mapped_column(Integer, index=True)
    org_id: Mapped[int | None] = mapped_column(Integer, index=True)
    step: Mapped[str] = mapped_column(String(40), index=True)
    model: Mapped[str] = mapped_column(String(80))
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    audio_s: Mapped[float] = mapped_column(Float, default=0.0)
    usd: Mapped[float] = mapped_column(Float, default=0.0)
    at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
