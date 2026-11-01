# Deploying Clone Flow (Render + Supabase)

- **Render** runs one service: the Docker build compiles the website, and the engine serves the website and the API
  from the same address. Uploads and video frames live on a persistent disk at `/var/data`.
- **Supabase** provides sign-in (verified emails, password resets, invitation emails) and the Postgres database.
  Without Supabase settings the engine falls back to built-in sign-in and a SQLite file on the disk.

## 1. Create the service (about $7/month + $0.50/month for the 2 GB disk)
1. render.com → **New → Blueprint** → pick the GitHub repo. Render reads `render.yaml` (Docker, Starter plan, disk).
   (Existing service: Settings → make sure it uses the repo's `Dockerfile`; Disks → mount path `/var/data`.)
2. Environment values to fill in:
   - `MODEL_API_KEY` — the Meta Model API key (paste only in Render, never in chat or the repo).
   - `PUBLIC_URL` — the service's own address, e.g. `https://cloneflow-engine.onrender.com` (used in invitation links,
     phone-walk QR codes and sign-in redirects).
   - Leave the Google / Microsoft / GitHub keys empty until those apps exist.
3. Deploy. The first build takes a few minutes. Then open the address: the home page appears, and
   `/api/system/status` shows `"product": true`.

Every push to `main` redeploys automatically.

## 2. Supabase
1. **Connect → Session pooler** → copy the connection string (port 5432, user `postgres.<project-ref>`), put your
   database password in it, and save it in Render as `DATABASE_URL`. (Use the pooler: Render can't reach the direct
   IPv6 address.) On first start the engine creates its tables and turns on Row Level Security for all of them, so
   Supabase's public API can't read Clone Flow data.
2. **Project Settings → API**: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (public) and `SUPABASE_SERVICE_ROLE_KEY` (secret,
   server only) in Render.
3. **Authentication → URL Configuration**: Site URL = the site address; Redirect URLs: `https://<address>/**` and
   `http://localhost:8000/**`.
4. **Authentication → Sign In / Providers → Email**: keep "Confirm email" on. Minimum password length 8.
5. **Authentication → Emails → SMTP Settings**: add your own SMTP (for example Resend) before real customers —
   Supabase's built-in sender only allows a few emails per hour. Edit the "Confirm signup", "Invite user" and
   "Reset password" templates to say Clone Flow.

## 3. Connectors (when the apps exist)
Redirect URLs to register (with the Render address, or your own domain once it points at Render):
- Google: `https://<address>/api/connect/google/callback`
- Microsoft: `https://<address>/api/connect/microsoft/callback`
- GitHub: `https://<address>/api/connect/github/callback`

Add the client id/secret pairs in Render → Environment. The Teams webhook URL is shown on Admin → Teams.

## 4. Your own domain (optional)
Render → the service → Settings → Custom Domains → add e.g. `app.yourdomain.com` and create the DNS record Render
shows. Then change `PUBLIC_URL` to the new address and update the Supabase URL configuration and the connector
redirect URLs.

## 5. Desktop apps (Mac and Windows)
1. GitHub → the repo → Settings → Secrets and variables → Actions → **Variables** → add `CLONEFLOW_URL` = the site
   address.
2. Actions → **Desktop apps** → Run workflow. It builds `CloneFlow.dmg` and `CloneFlow-Setup.exe` and attaches them
   to a release.
3. In Render → Environment add
   `DOWNLOAD_MAC_URL=https://github.com/<owner>/<repo>/releases/latest/download/CloneFlow.dmg` and
   `DOWNLOAD_WINDOWS_URL=https://github.com/<owner>/<repo>/releases/latest/download/CloneFlow-Setup.exe`.
   The Download page and the console switch from "coming soon" to download buttons.
The apps are not code-signed yet: on Mac, right-click → Open the first time; on Windows, "More info → Run anyway".

## Costs and limits
- Every organization gets `ORG_AI_CAP_USD` (default $2) of AI; then "Your trial limit is reached — contact us".
- Personal mail, noise and duplicates never reach the AI; Ask is local retrieval plus at most one small call.

## Test accounts (setup tool)
To fill a TEST Gmail account with a sample mailbox: set `SEED_MAILBOX_DIR` (a folder of `.mbox` files on the
engine) and `SEED_MAILBOX_OWNER` (the address whose messages count as sent), then, signed in as an admin, open
`/api/connect/google/start?seed=1`. Leave both unset in production.
