"""Tie-breaker embeddings over situation summaries (a non-Meta component).

Uses fastembed (BAAI/bge-small-en-v1.5, ONNX, CPU) when installed; otherwise a
stateless hashed bag of words + bigrams, which needs no download. Embeddings only
break ties after structured feature matching; no raw document chunk is embedded for
Clone Flow itself (the plain-RAG baseline embeds chunks with the same function).
"""
from __future__ import annotations

import hashlib
import logging
import re
import threading

import numpy as np

log = logging.getLogger("cloneflow.embed")
DIM = 512
_model = None
_tried = False
_lock = threading.Lock()


def _fast():
    global _model, _tried
    with _lock:
        if not _tried:
            _tried = True
            try:
                import os

                from fastembed import TextEmbedding

                if os.environ.get("CLONEFLOW_EMBEDDINGS", "auto") == "hashed":
                    raise RuntimeError("disabled by CLONEFLOW_EMBEDDINGS=hashed")
                if not _hf_reachable():
                    raise RuntimeError("Hugging Face not reachable and no cached model")
                cache = os.environ.get("FASTEMBED_CACHE_PATH") or None
                if cache and _has_onnx(cache):
                    os.environ.setdefault("HF_HUB_OFFLINE", "1")  # bundled model: never hit the network
                # One thread: small cloud instances get a fraction of a CPU, and ONNX's default (one thread per host
                # core) makes a single short query take ~0.5 s there instead of ~20 ms.
                threads = int(os.environ.get("EMBED_THREADS", "1"))
                _model = TextEmbedding("BAAI/bge-small-en-v1.5", cache_dir=cache, threads=threads)
            except Exception as exc:
                log.info("fastembed unavailable (%s); using hashed embeddings", exc)
                _model = None
    return _model


def _hf_reachable() -> bool:
    """fastembed retries for ~40 s when offline; check once, quickly, first."""
    import os
    from pathlib import Path

    import tempfile

    for c in (os.environ.get("FASTEMBED_CACHE_PATH"), str(Path(tempfile.gettempdir()) / "fastembed_cache")):
        if c and _has_onnx(c):
            return True
    try:
        import httpx

        return httpx.head("https://huggingface.co", timeout=3, follow_redirects=True).status_code < 500
    except Exception:
        return False


def _has_onnx(path: str) -> bool:
    from pathlib import Path

    p = Path(path)
    return p.exists() and any(p.rglob("*.onnx"))


def backend_name() -> str:
    return "bge-small-en-v1.5" if _fast() is not None else "hashed-ngrams"


_TOKEN = re.compile(r"[a-z0-9]+")
_STOP = set("the a an and or of to in on for with at by from is are was were be been it this that as we our you".split())


def _hash_embed(text: str) -> np.ndarray:
    v = np.zeros(DIM, dtype=np.float32)
    toks = [t for t in _TOKEN.findall(text.lower()) if t not in _STOP]
    grams = toks + [f"{a}_{b}" for a, b in zip(toks, toks[1:])]
    for g in grams:
        h = int.from_bytes(hashlib.blake2b(g.encode(), digest_size=8).digest(), "little")
        v[h % DIM] += 1.0 if (h >> 63) & 1 else -1.0
    n = np.linalg.norm(v)
    return v / n if n else v


_QCACHE: dict[str, np.ndarray] = {}
_QLOCK = threading.Lock()


def embed(texts: list[str]) -> np.ndarray:
    if not texts:
        return np.zeros((0, DIM), dtype=np.float32)
    if len(texts) == 1:  # questions: computed once, reused by every path that asks at the same time
        with _QLOCK:
            hit = _QCACHE.get(texts[0])
            if hit is None:
                hit = _embed(texts)[0]
                if len(_QCACHE) > 2000:
                    _QCACHE.clear()
                _QCACHE[texts[0]] = hit
        return hit[None, :]
    return _embed(texts)


def _embed(texts: list[str]) -> np.ndarray:
    m = _fast()
    if m is not None:
        arr = np.array(list(m.embed(texts)), dtype=np.float32)
        arr /= np.linalg.norm(arr, axis=1, keepdims=True) + 1e-9
        return arr
    return np.stack([_hash_embed(t) for t in texts])


def cosine(a, b) -> float:
    a = np.asarray(a, dtype=np.float32)
    b = np.asarray(b, dtype=np.float32)
    if a.shape != b.shape or not a.size:
        return 0.0
    return float(np.dot(a, b) / ((np.linalg.norm(a) * np.linalg.norm(b)) + 1e-9))
