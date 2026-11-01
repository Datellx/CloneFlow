# Architecture

```
 Browser / desktop app ──► Render: FastAPI engine (serves the website + /api) ──► Meta Model API (Muse)
                                                        │
                                                        ├─ Supabase: Auth (sign-in, email) + Postgres (accounts, knowledge, cost log)
                                                        ├─ persistent disk: uploads, key frames, voice clips
                                                        └─ Microsoft Graph · Gmail API · GitHub API (read-only, OAuth)
```

## The three people

| Who | Sees | Code |
|---|---|---|
| Admin | setup assistant → console: people leaving, invitations, knowledge base, map, Ask, Teams, plan | `frontend/src/app/Setup.tsx`, `app/admin/*`, `backend/onboarding`, `backend/app/routes_handover.py` |
| Person leaving | one conversation (connect → read → interview → show me → done) | `frontend/src/app/Session.tsx`, `backend/handover/session.py` |
| Colleagues | Ask on the web, `@Clone Flow` in Teams | `backend/knowledge/ask.py`, `backend/handover/teams.py` |

## The handover, step by step

1. **Setup** (`onboarding/assistant.py`). One small Muse call per turn fills the organization profile (what it does,
   knowledge at risk, teams, tools, vocabulary) and invites people mentioned in the chat. `knowledge/ai.py` adds this
   profile — and anything the admin asked to capture from a specific person — to every later model call.
2. **Connect** (`handover/connectors.py`). OAuth to Microsoft Graph (mail, Teams chats and channels, OneDrive),
   Gmail or GitHub; tokens are Fernet-encrypted; imports run in the background with live counts.
3. **Separate** (`knowledge/clean.py`, `knowledge/sources.py`). In code: quotes and signatures stripped,
   newsletters/notifications/acknowledgements marked as noise, personal mail recognised and stored as "set aside"
   (its text is never kept for AI), duplicates and recurring reminders collapsed.
4. **Read** (`knowledge/capture.py`). Surviving threads are packed into ~9k-character batches, one small call each,
   returning knowledge cards with source quotes. Cards are de-duplicated with local embeddings. One large call plans
   the interview: at most 10 gap questions (missing why, contradiction, unfinished task, undocumented step, who to
   contact), each with evidence.
5. **Interview** (`knowledge/interview.py`, `handover/session.py`). Answers by voice or text update or create cards
   (`verified_in_interview`). Uploads go through the same extraction; videos, screen recordings and the phone walk
   (`knowledge/walk.py`, `media/frames.py`) keep frames only on scene change, blur faces locally, and send one vision
   call per clip.
6. **Ask** (`knowledge/ask.py`). Local retrieval over every pack in the organization; below the similarity threshold
   the answer is "I don't know" plus who might know (free); otherwise one small call writes the answer from the
   retrieved cards only, with proof. Answers are cached until the knowledge changes. Teams gets an answer within its
   5-second limit (an extractive answer if the model is still composing).

## Cost control

- `ORG_AI_CAP_USD` (default 2): every model call checks the organization's spend in `cost_log` first.
- `MAX_SPEND_USD`: optional hard stop per process (scripts, local runs).
- Every call is logged with step, person, organization, tokens and cost (`cost_log`).
- Offline model (`LLM_PROVIDER=mock`): deterministic stand-ins for every step, used by the test suite.

## Data model

`backend/db/models.py`: organizations (plan, profile), users, invitations, handovers (`clones`: one per person
leaving). `backend/db/models_knowledge.py`: source consent and items, read runs and feed, knowledge cards,
interviews and questions, asks, phone walks and frames, cost log. `handover/session.py`: the conversation
transcript. `handover/connectors.py`: encrypted connector tokens. `onboarding/assistant.py`: the setup transcript.
