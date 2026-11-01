# API

JSON over HTTPS under `/api`, cookie sessions, errors as `{ "detail": "…" }`. Interactive docs: `/api/docs`.
`402` means a plan or trial limit (`code: "trial_limit"` for the AI allowance); `503` means the AI didn't answer.

## Accounts — `backend/app/routes_account.py`
| | |
|---|---|
| `GET /system/status` | version, model, plans, desktop download links |
| `POST /auth/signup {org_name, name, email, password}` | creates the organization; the caller is its admin → `Me` |
| `POST /auth/lookup {email}` | sign-in step 1: `{found, org_name, microsoft}` |
| `POST /auth/login {email, password}` · `POST /auth/logout` · `GET /auth/me` | `Me = {user, org{plan, set_up}, home}` |
| `GET /auth/invite/{code}` · `POST /auth/join {invite_code, name, email, password}` | the person leaving accepts their invitation |
| `GET /auth/microsoft/start?email=` | "Continue with Microsoft" (when configured) |
| `POST /voice/transcribe` (audio) | speech to text for Ask |

## Setup assistant — `backend/app/routes_setup.py` (admins)
| | |
|---|---|
| `GET /setup` | `{messages, profile, plan, done}`; the greeting is created on first visit |
| `POST /setup/message {text}` | one turn → `{messages, profile, plan, done}`; people mentioned with an email are invited |
| `POST /setup/finish {skipped}` | open the console |

## The handover conversation — `backend/app/routes_handover.py` (the person leaving)
| | |
|---|---|
| `GET /me/session` · `POST /me/session/start` | `Session = {stage, messages, actions, question, coverage, progress, sources, …}` |
| `POST /me/session/message` (JSON `{text}` or multipart `audio`) | answer → `{messages, session}` |
| `POST /me/session/skip` | skip a question, or skip connecting sources |
| `POST /me/session/read` | read the connected sources (background; poll `GET /me/session`) |
| `POST /me/session/upload` (files) · `POST /me/session/screen` (video) | documents, photos, videos, screen recordings |
| `POST /me/session/walk` · `GET /me/session/walk/feed` | phone floor walk: QR code and live frames |
| `GET /me/session/privacy` | what was set aside as personal or noise, and why |
| `POST /me/session/finish` | summary; the knowledge goes to the organization |
| `GET /connect/providers` · `GET /connect/{google|microsoft|github}/start` | OAuth (full-page redirect) |
| `GET /me/upload-token` | `{token, base}` for large uploads sent straight to the engine |

Stages: `welcome → intro → connect → reading → interview → open → done`. `actions` tells the UI what to offer.

## Console — admins
| | |
|---|---|
| `GET /admin/overview` | people, invitations, organization profile, plan usage, AI allowance, unanswered questions |
| `POST /admin/invite {name, email, title?, leaving_on?, focus?}` | → `{employee, link}`; `402` past the plan limit |
| `GET /employees` · `GET /employees/{eid}` · `GET /employees/{eid}/cards` · `GET /employees/{eid}/briefing` | knowledge packs |
| `GET /map` | people × areas, single points of failure |
| `GET /admin/teams` · `POST /admin/teams {secret}` | Microsoft Teams outgoing webhook |

## Ask — anyone in the organization
| | |
|---|---|
| `POST /ask {eid | null, question, mode}` | `null` = the whole organization; answers cite sources or say "I don't know" |
| `POST /teams/webhook/{slug}` | Teams (HMAC-signed) |

## Phone walk page (the link is the credential)
`GET /walk/{token}` · `POST /walk/{token}/frames` · `POST /walk/{token}/audio` · `POST /walk/{token}/finish`
