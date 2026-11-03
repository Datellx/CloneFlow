"""Video understanding with Meta's SAM 3.1 (Meta Model API).

When someone shows a physical task on video (calibrating an arm, changing a tool), SAM 3.1 tracks the things being
worked on — segmentation masks and stable object identities, frame by frame. Clone Flow uses the tracks to:
  1. pick the moments where something actually moves (keyframes), instead of sampling blindly;
  2. draw the masks onto those frames, so the proof a successor sees shows *what* moved;
  3. render a short tracked clip for the knowledge card.
Muse Spark (vision) then reads the marked-up keyframes plus what the person said (Muse Voice Transcribe) and writes
the steps. SAM is used only for the physical world: screen shares and photos don't go through it.
"""
from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import httpx
import numpy as np

from backend.app.config import settings
from backend.media.frames import FFMPEG, run

log = logging.getLogger("cloneflow.sam")

MODEL = os.environ.get("SAM_MODEL", "sam-3.1")
FPS = float(os.environ.get("SAM_FPS", "8"))
MAX_SECONDS = float(os.environ.get("SAM_MAX_SECONDS", "120"))
WIDTH = int(os.environ.get("SAM_WIDTH", "640"))
# The API bills video per frame (minimum 50 per request); the per-frame price is configurable for the allowance.
USD_PER_FRAME = float(os.environ.get("SAM_USD_PER_FRAME", "0.0002"))
COLORS = [(58, 30, 122), (150, 140, 30), (40, 160, 235)]  # BGR: burgundy, teal, amber

_REC = re.compile(r"(\d+)<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)(?:;c=([\d.]+))?\|>"
                  r"<\|mask;x=0;y=0(?:;c=[\d.]+)?;data=(\d+),(\d+),([~!])(.*?)\|>")


@dataclass
class Obj:
    concept: str
    oid: str
    box: tuple[int, int, int, int]  # x1, y1, x2, y2 (inclusive)
    conf: float | None
    _enc: str = ""
    _payload: str = ""
    _hw: tuple[int, int] = (0, 0)
    _mask: np.ndarray | None = field(default=None, repr=False)

    def mask(self, keep: bool = False) -> np.ndarray:
        """Boolean raster covering the box, decoded on demand. Not kept by default: a long video has thousands of
        masks, and keeping them all would not fit in a small server's memory."""
        if self._mask is not None:
            return self._mask
        from meta_sam_parser import decode_mask_to_raster
        from meta_sam_parser._types import SegmentationMask

        h, w = self._hw
        raw = decode_mask_to_raster(SegmentationMask("one_bit" if self._enc == "!" else "lossless",
                                                     self._enc + self._payload, w, h))
        m = np.frombuffer(raw, dtype=np.uint8).reshape(h, w).astype(bool)
        if keep:
            self._mask = m
        return m


@dataclass
class Tracks:
    clip: Path
    fps: float
    frames: int
    size: tuple[int, int]
    by_frame: dict[int, list[Obj]]
    concepts: list[str]
    seconds: float = 0.0
    frames_billed: int = 0

    def found(self) -> dict[str, int]:
        out = {c: 0 for c in self.concepts}
        for objs in self.by_frame.values():
            for c in {o.concept for o in objs}:
                out[c] += 1
        return out


def _key() -> str:
    return settings.model_api_key


def prepare(video: Path, out_dir: Path) -> tuple[Path, int, tuple[int, int]]:
    """A small H.264 MP4 the API accepts (it takes MP4/MOV with H.264/H.265, not WebM): ≤120 s, 8 fps, longest side
    640 px (phone videos are often portrait; this keeps the masks, and the server's memory, small)."""
    clip = out_dir / "sam_input.mp4"
    r = run([FFMPEG, "-y", "-i", str(video), "-t", str(MAX_SECONDS), "-vf", f"fps={FPS},scale={WIDTH}:{WIDTH}:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2",
             "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", str(clip)])
    if r.returncode != 0:
        raise RuntimeError("could not prepare the video for SAM: " + r.stderr[-300:])
    cap = cv2.VideoCapture(str(clip))
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    size = (int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)))
    cap.release()
    return clip, n, size


def _upload(clip: Path) -> str:
    r = httpx.post(f"{settings.model_base_url}/files", headers={"Authorization": f"Bearer {_key()}"}, timeout=180,
                   files={"file": (clip.name, clip.read_bytes(), "video/mp4")}, data={"purpose": "user_data"})
    r.raise_for_status()
    return r.json()["id"]


def _segment(file_id: str, concept: str) -> tuple[str, int]:
    body = {"model": MODEL, "metadata": {"mask_encoding": "one_bit", "include_confidence": "true"},
            "input": [{"type": "message", "role": "user", "content": [
                {"type": "input_text", "text": concept}, {"type": "input_video", "file_id": file_id}]}]}
    for attempt in range(3):
        r = httpx.post(f"{settings.model_base_url}/responses", headers={"Authorization": f"Bearer {_key()}"},
                       json=body, timeout=600)
        if r.status_code in (429, 500, 502, 503, 504) and attempt < 2:
            time.sleep(2 + attempt * 3)
            continue
        r.raise_for_status()
        js = r.json()
        text = "".join(c.get("text", "") for o in js.get("output", []) for c in (o.get("content") or []))
        return text, int((js.get("usage") or {}).get("video_frames_processed") or 0)
    raise RuntimeError("SAM did not answer")


def parse(text: str, concept: str) -> dict[int, list[Obj]]:
    """SAM's per-frame lines: <Nf>id<|box…|><|mask…|>,id<|box…|><|mask…|> (frame index read, never assumed)."""
    out: dict[int, list[Obj]] = {}
    for line in text.splitlines():
        m = re.match(r"<(\d+)f>", line)
        if not m:
            continue
        f = int(m.group(1))
        for r in _REC.finditer(line, m.end()):
            out.setdefault(f, []).append(Obj(
                concept=concept, oid=r.group(1),
                box=(int(r.group(2)), int(r.group(3)), int(r.group(4)), int(r.group(5))),
                conf=float(r.group(8)) if r.group(8) else None,
                _enc=r.group(11), _payload=r.group(12), _hw=(int(r.group(9)), int(r.group(10)))))
    return out


def track(video: Path, out_dir: Path, concepts: list[str]) -> Tracks:
    """Run SAM 3.1 once per concept on one uploaded clip; merge the tracks by frame."""
    t0 = time.monotonic()
    clip, n, size = prepare(video, out_dir)
    log.info("sam: prepared %d frames %s in %.1fs", n, size, time.monotonic() - t0)
    fid = _upload(clip)
    log.info("sam: uploaded at %.1fs", time.monotonic() - t0)
    by: dict[int, list[Obj]] = {}
    billed = 0
    for c in concepts[:3]:
        text, frames = _segment(fid, c)
        billed += max(frames, 50)
        log.info("sam: '%s' segmented (%d chars) at %.1fs", c, len(text), time.monotonic() - t0)
        for f, objs in parse(text, c).items():
            by.setdefault(f, []).extend(objs)
        del text
    tr = Tracks(clip=clip, fps=FPS, frames=n, size=size, by_frame=by, concepts=concepts[:3],
                seconds=round(time.monotonic() - t0, 1), frames_billed=billed)
    log.info("sam: %d frames, %s found, %.1fs", n, tr.found(), tr.seconds)
    return tr


def _sharpness(clip: Path, want: set[int]) -> dict[int, float]:
    """Focus measure (variance of the Laplacian) for the frames we may pick."""
    out: dict[int, float] = {}
    cap = cv2.VideoCapture(str(clip))
    i = 0
    while want and i <= max(want):
        ok, fr = cap.read()
        if not ok:
            break
        if i in want:
            h, w = fr.shape[:2]
            g = cv2.cvtColor(cv2.resize(fr, (320, max(1, int(320 * h / w)))), cv2.COLOR_BGR2GRAY)
            out[i] = float(cv2.Laplacian(g, cv2.CV_64F).var())
        i += 1
    cap.release()
    return out


def keyframes(tr: Tracks, k: int = 6) -> list[int]:
    """Frames where the tracked object actually moves: spread k picks over the cumulative motion of the first concept
    that was found (box centre + size change), keeping them at least 1 s apart; always the first and last sighting."""
    main = next((c for c in tr.concepts if tr.found().get(c)), None)
    seen = sorted(f for f, objs in tr.by_frame.items() if any(o.concept == main for o in objs)) if main else []
    if not seen:
        return [int(i) for i in np.linspace(0, max(tr.frames - 1, 0), num=min(k, max(tr.frames, 1)))]
    def geom(f):
        bs = [o.box for o in tr.by_frame[f] if o.concept == main]
        x1, y1 = min(b[0] for b in bs), min(b[1] for b in bs)
        x2, y2 = max(b[2] for b in bs), max(b[3] for b in bs)
        return np.array([(x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1], dtype=float)
    g = [geom(f) for f in seen]
    motion = np.concatenate([[0.0], np.cumsum([np.abs(g[i] - g[i - 1]).sum() for i in range(1, len(g))])])
    sharp = _sharpness(tr.clip, set(seen))
    W, H = tr.size
    def score(f):  # in focus, and the object big enough to see
        return (sharp.get(f, 1.0) ** 0.5) * min(1.0, 0.25 + g[seen.index(f)][2] * g[seen.index(f)][3] / max(W * H, 1) * 4)
    win = max(1, int(tr.fps))
    def best_near(i):  # handheld video blurs while moving: take the sharpest sighting within ~1 s
        lo, hi = max(0, i - win), min(len(seen), i + win + 1)
        return max(seen[lo:hi], key=score)
    idx = [0]
    if motion[-1] > 0:
        idx += [int(np.searchsorted(motion, q)) for q in np.linspace(0, motion[-1], num=k)[1:-1]]
    idx.append(len(seen) - 1)
    picks = [best_near(min(i, len(seen) - 1)) for i in idx]
    gap = max(1, int(tr.fps))
    out: list[int] = []
    for f in sorted(set(picks)):
        if not out or f - out[-1] >= gap:
            out.append(f)
    return out[:k]


def draw(frame: np.ndarray, objs: list[Obj], concepts: list[str]) -> np.ndarray:
    """Masks tinted in the concept's colour, outlined, with a label chip — the proof a successor sees."""
    img = frame.copy()
    overlay = img.copy()
    H, W = img.shape[:2]
    for o in objs:
        col = COLORS[concepts.index(o.concept) % len(COLORS)] if o.concept in concepts else COLORS[0]
        x1, y1, x2, y2 = o.box
        try:
            m = o.mask()
        except Exception as exc:  # label still drawn; say why the mask is missing (once)
            if not getattr(draw, "_warned", False):
                log.warning("SAM mask decode failed: %s", exc)
                draw._warned = True
            continue
        h, w = m.shape
        h, w = min(h, H - y1), min(w, W - x1)
        if h <= 0 or w <= 0:
            continue
        full = np.zeros((H, W), dtype=np.uint8)
        full[y1:y1 + h, x1:x1 + w] = m[:h, :w]
        overlay[full.astype(bool)] = col
        cnts, _ = cv2.findContours(full, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        cv2.drawContours(img, cnts, -1, col, 2, cv2.LINE_AA)
    img = cv2.addWeighted(overlay, 0.42, img, 0.58, 0)
    for o in objs:  # labels on top
        col = COLORS[concepts.index(o.concept) % len(COLORS)] if o.concept in concepts else COLORS[0]
        x1, y1 = o.box[0], o.box[1]
        label = o.concept
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
        y = max(th + 6, y1 - 4)
        cv2.rectangle(img, (x1, y - th - 6), (x1 + tw + 8, y + 2), col, -1)
        cv2.putText(img, label, (x1 + 4, y - 3), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1, cv2.LINE_AA)
    cv2.putText(img, "SAM 3.1", (W - 78, H - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1, cv2.LINE_AA)
    return img


def render(tr: Tracks, out_dir: Path, picks: list[int]) -> tuple[list[Path], Path | None]:
    """Marked-up keyframes (JPEG) and a tracked clip (H.264, plays in any browser)."""
    cap = cv2.VideoCapture(str(tr.clip))
    w, h = tr.size
    clip_out = out_dir / "sam_tracked.mp4"
    ff = subprocess.Popen([FFMPEG, "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{w}x{h}",
                           "-r", str(tr.fps), "-i", "-", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                           "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(clip_out)], stdin=subprocess.PIPE)
    keys: dict[int, Path] = {}
    i = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        marked = draw(frame, tr.by_frame.get(i, []), tr.concepts)
        try:
            ff.stdin.write(marked.tobytes())
        except BrokenPipeError:
            break
        if i in picks:
            p = out_dir / f"sam_key_{i:04d}.jpg"
            big = cv2.resize(marked, (w * 2, h * 2), interpolation=cv2.INTER_CUBIC) if w < 900 else marked
            cv2.imwrite(str(p), big, [cv2.IMWRITE_JPEG_QUALITY, 90])
            keys[i] = p
        i += 1
    cap.release()
    ff.stdin.close()
    ok = ff.wait() == 0
    return [keys[f] for f in sorted(keys)], (clip_out if ok and clip_out.exists() else None)


def summary(tr: Tracks) -> dict:
    return {"model": MODEL, "frames": tr.frames, "fps": tr.fps, "seconds": tr.seconds, "found": tr.found(),
            "frames_billed": tr.frames_billed}


def bill(eid: int, tr: Tracks) -> None:
    """Record SAM usage in the organization's AI allowance (per-frame billing)."""
    try:
        from backend.knowledge import ai

        ai._db_sink(step="sam_video", eid=eid, model=MODEL, input_tokens=0, output_tokens=0,
                    usd=round(tr.frames_billed * USD_PER_FRAME, 5), audio_s=0)
    except Exception as exc:  # usage logging never blocks the knowledge
        log.warning("sam usage not logged: %s", exc)


__all__ = ["track", "keyframes", "render", "summary", "bill", "parse", "Tracks", "Obj"]
_ = json
