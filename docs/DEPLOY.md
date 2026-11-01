# Deploying Clone Flow on Render

One Render service does everything: the Docker build compiles the website, and the engine serves the website and
the API from the same address. The database, uploads and video frames live on a persistent disk at `/var/data`, so
redeploys never erase data.

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

## 2. Connectors (when the apps exist)
Redirect URLs to register (with the Render address, or your own domain once it points at Render):
- Google: `https://<address>/api/connect/google/callback`
- Microsoft: `https://<address>/api/connect/microsoft/callback`
- GitHub: `https://<address>/api/connect/github/callback`

Add the client id/secret pairs in Render → Environment. The Teams webhook URL is shown on Admin → Teams.

## 3. Your own domain (optional)
Render → the service → Settings → Custom Domains → add e.g. `app.yourdomain.com` and create the DNS record Render
shows. Then change `PUBLIC_URL` to the new address and update the connector redirect URLs.

## 4. Desktop apps (Mac and Windows)
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
