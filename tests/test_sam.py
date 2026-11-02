"""SAM 3.1 output handling: parse a real response (robot arm, 50 frames), pick keyframes, draw masks, render."""
import subprocess
from pathlib import Path

import numpy as np

from backend.media import sam as SAM
from backend.media.frames import FFMPEG

DATA = Path(__file__).parent / "data" / "sam31_robot_arm.txt"


def test_parse_keyframes_draw(tmp_path):
    by = SAM.parse(DATA.read_text(), "robot arm")
    assert len(by) >= 30 and all(o.concept == "robot arm" for objs in by.values() for o in objs)
    o = next(iter(by.values()))[0]
    m = o.mask()
    x1, y1, x2, y2 = o.box
    assert m.shape == (y2 - y1 + 1, x2 - x1 + 1) and 0 < m.mean() < 1

    clip = tmp_path / "clip.mp4"  # a plain 640x360 clip the same length as the response
    subprocess.run([FFMPEG, "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=gray:s=640x360:r=10:d=5",
                    "-pix_fmt", "yuv420p", str(clip)], check=True)
    tr = SAM.Tracks(clip=clip, fps=10, frames=50, size=(640, 360), by_frame=by, concepts=["robot arm"])
    assert tr.found()["robot arm"] == len(by)
    picks = SAM.keyframes(tr, k=6)
    assert 2 <= len(picks) <= 6 and picks == sorted(picks) and all(b - a >= 10 for a, b in zip(picks, picks[1:]))
    frame = np.full((360, 640, 3), 128, np.uint8)
    marked = SAM.draw(frame, by[picks[0]], ["robot arm"])
    assert (marked != frame).any()
    keys, tracked = SAM.render(tr, tmp_path, picks)
    assert len(keys) == len(picks) and tracked is not None and tracked.stat().st_size > 1000
