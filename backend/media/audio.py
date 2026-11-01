"""Audio conversion for Muse Voice Transcribe: WAV, mono, 16-bit PCM, 24 kHz,
≤10 minutes and ≤32 MB per request. Long recordings are split into 9-minute chunks."""
from __future__ import annotations

import subprocess
from pathlib import Path

from backend.media.frames import FFMPEG, _probe_text
CHUNK_SECONDS = 540


def has_audio(path: Path) -> bool:
    return " Audio: " in _probe_text(path)


def to_wav(src: Path, dst: Path, start: float | None = None, length: float | None = None) -> Path:
    cmd = [FFMPEG, "-y"]
    if start is not None:
        cmd += ["-ss", f"{start:.2f}"]
    cmd += ["-i", str(src)]
    if length is not None:
        cmd += ["-t", f"{length:.2f}"]
    cmd += ["-vn", "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le", "-map_metadata", "-1", str(dst)]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
    if r.returncode != 0 or not dst.exists():
        raise ValueError(f"audio conversion failed: {r.stderr[-300:]}")
    return dst


def wav_seconds(path: Path) -> float:
    size = path.stat().st_size
    return max(0.0, (size - 44) / (24000 * 2))


def to_wav_chunks(src: Path, work_dir: Path) -> list[tuple[Path, float]]:
    work_dir.mkdir(parents=True, exist_ok=True)
    full = to_wav(src, work_dir / f"{src.stem}_full.wav")
    total = wav_seconds(full)
    if total <= CHUNK_SECONDS:
        return [(full, total)]
    out = []
    start, i = 0.0, 0
    while start < total:
        length = min(CHUNK_SECONDS, total - start)
        out.append((to_wav(full, work_dir / f"{src.stem}_{i:02d}.wav", start, length), length))
        start += CHUNK_SECONDS
        i += 1
    full.unlink(missing_ok=True)
    return out


def bytes_to_wav(data: bytes, work_dir: Path, suffix: str = ".webm") -> tuple[bytes, float]:
    work_dir.mkdir(parents=True, exist_ok=True)
    import uuid

    src = work_dir / f"in_{uuid.uuid4().hex}{suffix}"
    src.write_bytes(data)
    dst = src.with_suffix(".wav")
    try:
        to_wav(src, dst)
        wav = dst.read_bytes()
        return wav, wav_seconds(dst)
    finally:
        src.unlink(missing_ok=True)
        dst.unlink(missing_ok=True)
