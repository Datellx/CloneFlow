#!/usr/bin/env bash
# Clone Flow — install (first run), build the web app and start at http://localhost:8000 (macOS or Linux).
set -euo pipefail
cd "$(dirname "$0")"

PY=""
for c in python3.12 python3.11 python3.13 python3; do
  if command -v "$c" >/dev/null 2>&1; then PY="$c"; break; fi
done
[ -z "$PY" ] && { echo "Python 3.11+ is required"; exit 1; }
command -v ffmpeg >/dev/null 2>&1 || echo "⚠  ffmpeg not found — voice, video and screen recordings need it"

[ -d .venv ] || "$PY" -m venv .venv
# shellcheck disable=SC1091
source .venv/bin/activate
if [ ! -f .venv/.installed ] || [ requirements.txt -nt .venv/.installed ]; then
  echo "→ Installing Python packages"
  pip install -q --upgrade pip && pip install -q -r requirements.txt && touch .venv/.installed
fi

if [ "${1:-}" = "--check" ]; then exec python -m scripts.check_api; fi

if [ ! -f frontend/dist/index.html ] || [ -n "$(find frontend/src -newer frontend/dist/index.html -print -quit 2>/dev/null)" ]; then
  command -v npm >/dev/null 2>&1 || { echo "Node.js 20+ is required to build the web app"; exit 1; }
  echo "→ Building the web app"
  (cd frontend && npm install --silent && npm run build --silent)
fi

echo "→ Clone Flow on http://localhost:${PORT:-8000}"
exec uvicorn backend.app.main:app --host 127.0.0.1 --port "${PORT:-8000}"
