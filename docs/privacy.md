# Privacy and security

## Personal stays personal
- Every email and chat is classified in code before any AI step. Personal messages (personal email domains,
  family, health, finance, shopping and similar cues; at least two cues, or one from outside the work domain) are
  stored only as "set aside": their text is not kept for AI, they are never sent to a model, and the company never
  sees them. During reading the model may also flag a thread as personal; it is then dropped the same way.
- The person leaving can open "See what I kept private" to check how their mail was separated.

## Secrets
Before any model call, `knowledge/ai.py → redact()` removes passwords and credential-like tokens, API keys (AWS,
GitHub, Slack, Google, JWT and generic), card numbers, account and routing numbers and government-ID shapes.

## Images and video
Key frames are taken only on scene change; faces are blurred locally (OpenCV) before a frame is stored or sent to
the vision model. Phone-walk links are random tokens that expire after two hours.

## Access
- Admins see the organization's console and knowledge base. A person leaving sees only their own conversation.
  Colleagues can ask questions but cannot browse anyone's sources.
- Connections are read-only OAuth grants; tokens are encrypted at rest (Fernet, key derived from `SECRET_KEY`).
- Accounts are verified by email through Supabase Auth; after sign-in the engine uses its own signed, HTTP-only
  session cookie. All database tables have Row Level Security on, so Supabase's public API can't read them.
- Sessions are signed, HTTP-only cookies. Large uploads sent straight to the engine use a 30-minute token that only
  works for the two upload routes.

## Untrusted content
Emails and documents can contain text aimed at the model. Source text is passed as quoted data, prompts tell the
model to use it only as evidence, and every output is constrained to a JSON schema; the model has no tools.

## Data ownership
Captured knowledge belongs to the organization, is stored in its database, and is never used to train models
(the Meta Model API is used in standard mode).
