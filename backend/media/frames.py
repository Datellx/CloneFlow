"""Frame extraction and region blurring (ffmpeg + OpenCV)."""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import cv2
import numpy as np

def _find_ffmpeg() -> str:
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"


def _probe_text(path) -> str:
    """ffmpeg -i prints stream info to stderr; used instead of ffprobe (not always installed)."""
    r = subprocess.run([FFMPEG, "-hide_banner", "-i", str(path)], capture_output=True, text=True, timeout=60)
    return r.stderr


FFMPEG = _find_ffmpeg()


def run(cmd: list[str], timeout: int = 600) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def duration(path: Path) -> float:
    import re as _re

    m = _re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", _probe_text(path))
    if m:
        return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
    if True:
        # webm from MediaRecorder often lacks duration metadata; decode to find it.
        r = run([FFMPEG, "-i", str(path), "-f", "null", "-"], timeout=600)
        import re

        times = re.findall(r"time=(\d+):(\d+):(\d+\.\d+)", r.stderr)
        if times:
            h, m, s = times[-1]
            return int(h) * 3600 + int(m) * 60 + float(s)
        return 0.0


def to_png(src: Path, dst: Path, max_side: int = 1600) -> Path:
    dst.parent.mkdir(parents=True, exist_ok=True)
    img = cv2.imread(str(src), cv2.IMREAD_COLOR)
    if img is None:  # formats OpenCV can't read (heic, gif): let ffmpeg convert
        r = run([FFMPEG, "-y", "-i", str(src), "-frames:v", "1", str(dst)])
        if r.returncode != 0:
            raise ValueError(f"cannot read image {src.name}")
        img = cv2.imread(str(dst))
    img = _limit(img, max_side)
    cv2.imwrite(str(dst), img)
    return dst


def _limit(img: np.ndarray, max_side: int) -> np.ndarray:
    h, w = img.shape[:2]
    scale = max_side / max(h, w)
    if scale < 1:
        img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    return img


def keyframes(video: Path, out_dir: Path, max_frames: int = 24, threshold: float = 0.3,
              max_side: int = 1600) -> list[Path]:
    """Scene-change keyframes (spec stage 0). Falls back to even sampling when the
    recording has few scene changes (e.g. a slow screen walkthrough)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    for f in out_dir.glob("*.png"):
        f.unlink()
    dur = duration(video)
    r = run([FFMPEG, "-y", "-i", str(video), "-vf", f"select='gt(scene,{threshold})',showinfo",
             "-vsync", "vfr", "-frames:v", str(max_frames * 3), str(out_dir / "scene_%05d.png")])
    import re

    times = [float(t) for t in re.findall(r"pts_time:([\d.]+)", r.stderr)]
    scene = sorted(out_dir.glob("scene_*.png"))
    frames: list[tuple[float, Path]] = list(zip(times, scene)) if len(times) == len(scene) else [
        (i, p) for i, p in enumerate(scene)]
    # Always include the first frame and enough even samples to cover long static stretches.
    want_even = max(4, min(max_frames, int(dur // 8) + 1)) if dur else 4
    if len(frames) < want_even and dur > 0:
        step = dur / want_even
        for i in range(want_even):
            t = min(i * step + 0.2, max(dur - 0.1, 0))
            p = out_dir / f"even_{i:05d}.png"
            run([FFMPEG, "-y", "-ss", f"{t:.2f}", "-i", str(video), "-frames:v", "1", str(p)])
            if p.exists():
                frames.append((t, p))
    frames.sort(key=lambda x: x[0])
    frames = _dedupe(frames)
    if len(frames) > max_frames:
        idx = np.linspace(0, len(frames) - 1, max_frames).round().astype(int)
        frames = [frames[i] for i in sorted(set(idx))]
    final: list[Path] = []
    for i, (t, p) in enumerate(frames):
        img = cv2.imread(str(p))
        if img is None:
            continue
        dst = out_dir / f"frame_{i:03d}_{t:07.2f}.png"
        cv2.imwrite(str(dst), _limit(img, max_side))
        final.append(dst)
    for p in out_dir.glob("scene_*.png"):
        p.unlink()
    for p in out_dir.glob("even_*.png"):
        p.unlink()
    return final


def frame_time(path: Path) -> float:
    try:
        return float(path.stem.split("_")[-1])
    except ValueError:
        return 0.0


def _dedupe(frames: list[tuple[float, Path]], min_diff: float = 6.0) -> list[tuple[float, Path]]:
    """Drop near-identical consecutive frames (mean absolute pixel difference)."""
    out: list[tuple[float, Path]] = []
    prev = None
    for t, p in frames:
        img = cv2.imread(str(p), cv2.IMREAD_GRAYSCALE)
        if img is None:
            continue
        small = cv2.resize(img, (160, 90))
        if prev is None or float(np.mean(cv2.absdiff(small, prev))) > min_diff:
            out.append((t, p))
            prev = small
    return out


def blur_boxes(path: Path, boxes: list[list[float]], grid: float = 1000.0) -> int:
    """Blur boxes given on a 0..grid coordinate system. Coordinates are clamped."""
    img = cv2.imread(str(path))
    if img is None:
        return 0
    h, w = img.shape[:2]
    n = 0
    for b in boxes:
        if len(b) != 4:
            continue
        x0, y0, x1, y1 = [max(0.0, min(grid, float(v))) for v in b]
        if x1 <= x0 or y1 <= y0:
            continue
        px0, py0 = int(x0 / grid * w), int(y0 / grid * h)
        px1, py1 = int(np.ceil(x1 / grid * w)), int(np.ceil(y1 / grid * h))
        # pad a little so edges of text are covered
        pad = max(2, int(0.004 * max(w, h)))
        px0, py0, px1, py1 = max(0, px0 - pad), max(0, py0 - pad), min(w, px1 + pad), min(h, py1 + pad)
        roi = img[py0:py1, px0:px1]
        if roi.size == 0:
            continue
        k = max(15, (min(roi.shape[:2]) // 2) * 2 + 1)
        img[py0:py1, px0:px1] = cv2.GaussianBlur(roi, (k, k), 0)
        # pixelate on top so blurred text can't be recovered
        small = cv2.resize(img[py0:py1, px0:px1], (max(1, (px1 - px0) // 12), max(1, (py1 - py0) // 12)))
        img[py0:py1, px0:px1] = cv2.resize(small, (px1 - px0, py1 - py0), interpolation=cv2.INTER_NEAREST)
        n += 1
    cv2.imwrite(str(path), img)
    return n


_face_cascade = None


def local_faces(path: Path) -> list[list[float]]:
    """Open-source face detection (Haar cascade) used when SAM 3.1 is unavailable.
    Returns boxes on the 0..1000 grid."""
    global _face_cascade
    if _face_cascade is None:
        bundled = Path(__file__).with_name("haarcascade_frontalface_default.xml")
        _face_cascade = cv2.CascadeClassifier(str(bundled))
    if _face_cascade.empty():
        return []
    img = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    if img is None:
        return []
    h, w = img.shape[:2]
    faces = _face_cascade.detectMultiScale(img, scaleFactor=1.1, minNeighbors=5, minSize=(24, 24))
    return [[x / w * 1000, y / h * 1000, (x + fw) / w * 1000, (y + fh) / h * 1000] for (x, y, fw, fh) in faces]


def thumbnail(src: Path, dst: Path, width: int = 480) -> Path:
    img = cv2.imread(str(src))
    h, w = img.shape[:2]
    img = cv2.resize(img, (width, int(h * width / w)), interpolation=cv2.INTER_AREA)
    dst.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(dst), img, [cv2.IMWRITE_JPEG_QUALITY, 85] if dst.suffix == ".jpg" else [])
    return dst
