"""Clone Flow API server. Serves /api and the built frontend (frontend/dist)."""
from __future__ import annotations

import logging
import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.db.store import init_db
from backend.knowledge.ai import TRIAL_MESSAGE, LLMError, TrialLimit
from .config import ROOT, settings
from .routes_account import router as account_router
from .routes_handover import router as handover_router
from .routes_knowledge import router as knowledge_router
from .routes_setup import router as setup_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("cloneflow")

app = FastAPI(title="Clone Flow", version="1.0.0", docs_url="/api/docs", openapi_url="/api/openapi.json")
_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"] + [
    o.strip().rstrip("/") for o in os.environ.get("WEB_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=_ORIGINS, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def security_headers(request: Request, call_next):
    resp = await call_next(request)
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("Referrer-Policy", "same-origin")
    resp.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    resp.headers.setdefault("Permissions-Policy", "camera=(self), microphone=(self), display-capture=(self)")
    return resp


@app.on_event("startup")
def _startup() -> None:
    init_db()
    log.info("Clone Flow ready · model provider=%s", settings.llm_provider)
    if settings.llm_provider == "mock":
        log.warning("Running with the OFFLINE MOCK model provider. Set MODEL_API_KEY to use the Meta Model API.")


app.include_router(account_router)
app.include_router(knowledge_router)
app.include_router(handover_router)
app.include_router(setup_router)


@app.exception_handler(TrialLimit)
async def trial_limit(request: Request, exc: TrialLimit):
    return JSONResponse({"detail": TRIAL_MESSAGE, "code": "trial_limit"}, status_code=402)


@app.exception_handler(LLMError)
async def ai_error(request: Request, exc: LLMError):
    log.warning("AI error on %s: %s", request.url.path, exc)
    return JSONResponse({"detail": "The AI didn't answer just now. Please try again in a moment."}, status_code=503)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    log.exception("unhandled error on %s", request.url.path)
    return JSONResponse({"detail": "Something went wrong on our side. Please try again."}, status_code=500)


DIST = ROOT / "frontend" / "dist"
if (DIST / "assets").exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")


@app.get("/{full_path:path}", include_in_schema=False)
def spa(full_path: str):
    if full_path.startswith("api/"):
        return JSONResponse({"detail": "Not found."}, status_code=404)
    target = (DIST / full_path).resolve()
    if full_path and DIST.exists() and DIST.resolve() in target.parents and target.is_file():
        return FileResponse(target)
    index = DIST / "index.html"
    if index.exists():
        return FileResponse(index, headers={"Cache-Control": "no-cache"})
    return JSONResponse({"detail": "Frontend not built. Run: cd frontend && npm install && npm run build"},
                        status_code=404)


_ = Path
