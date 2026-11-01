import { useCallback, useEffect, useRef, useState } from "react";
import { friendlyMediaError, speak, stop as stopSpeech } from "@/lib/voice";
import type { OrbState } from "./Orb";

/* ------------------------------------------------------------------ voice + captions */
export function useInterviewer() {
  const [orb, setOrb] = useState<OrbState>("idle");
  const [caption, setCaption] = useState("");
  const [spoken, setSpoken] = useState(Infinity);
  const [pulse, setPulse] = useState(0);
  const [muted, setMuted] = useState(() => {
    try {
      return localStorage.getItem("cf.muted") === "1";
    } catch {
      return false;
    }
  });
  const token = useRef(0);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const say = useCallback(async (text: string, opts: { silent?: boolean } = {}) => {
    const my = ++token.current;
    setCaption(text);
    setSpoken(0);
    setOrb("speaking");
    const words = text.split(/\s+/).length;
    const estimate = (words / 2.7) * 1000;
    let gotBoundary = false;
    let simulated = 0;
    // Word-by-word caption reveal, driven by speech boundaries when available, else timed.
    const sim = window.setInterval(() => {
      if (gotBoundary || token.current !== my) return;
      simulated += 1;
      const idx = nthWordEnd(text, simulated);
      setSpoken(idx);
      setPulse((p) => p + 1);
    }, estimate / words);
    const finish = () => {
      window.clearInterval(sim);
      if (token.current !== my) return;
      setSpoken(Infinity);
      setOrb("idle");
    };
    if (mutedRef.current || opts.silent) {
      await new Promise((r) => setTimeout(r, Math.min(estimate, 5200)));
      finish();
      return;
    }
    const fallback = new Promise<void>((r) => setTimeout(r, estimate * 1.6 + 1500));
    const real = speak(text, {
      onBoundary: (ci) => {
        if (token.current !== my) return;
        gotBoundary = true;
        setSpoken(text.indexOf(" ", ci + 1) < 0 ? text.length : text.indexOf(" ", ci + 1));
        setPulse((p) => p + 1);
      },
    }).catch(() => undefined);
    await Promise.race([real, fallback]);
    finish();
  }, []);

  const toggleMute = () => {
    setMuted((m) => {
      const v = !m;
      try {
        localStorage.setItem("cf.muted", v ? "1" : "0");
      } catch {
        /* ignore */
      }
      if (v) stopSpeech();
      return v;
    });
  };
  useEffect(() => () => {
    token.current++;
    stopSpeech();
  }, []);
  /** Stop talking now: the caption shows in full and the orb goes quiet. */
  const interrupt = useCallback(() => {
    token.current++;
    stopSpeech();
    setSpoken(Infinity);
    setOrb("idle");
  }, []);
  return { orb, setOrb, caption, setCaption, spoken, pulse, say, interrupt, muted, toggleMute };
}
function nthWordEnd(text: string, n: number) {
  let idx = 0;
  for (let i = 0; i < n; i++) {
    const next = text.indexOf(" ", idx + 1);
    if (next < 0) return text.length;
    idx = next;
  }
  return idx;
}

/* ------------------------------------------------------------------ screen recorder */
export function useScreenRecorder() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef(0);
  const streams = useRef<MediaStream[]>([]);
  const cleanup = () => {
    window.clearInterval(timer.current);
    streams.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    streams.current = [];
    setStream(null);
  };
  useEffect(() => cleanup, []);
  const start = async (): Promise<string | null> => {
    if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === "undefined")
      return "Screen sharing isn't supported in this browser. Try Chrome or Edge on a computer.";
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
      streams.current.push(display);
      const tracks = [...display.getVideoTracks()];
      try {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        streams.current.push(mic);
        tracks.push(...mic.getAudioTracks());
      } catch {
        /* narrate-less recording is still useful */
      }
      const mixed = new MediaStream(tracks);
      const mime = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"].find((m) => MediaRecorder.isTypeSupported(m));
      const r = new MediaRecorder(mixed, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.start(500);
      rec.current = r;
      setStream(display);
      const t0 = Date.now();
      setElapsed(0);
      timer.current = window.setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 250);
      display.getVideoTracks()[0]?.addEventListener("ended", () => r.state !== "inactive" && r.stop());
      return null;
    } catch (e) {
      cleanup();
      return friendlyMediaError(e, "screen");
    }
  };
  const stop = (): Promise<Blob | null> =>
    new Promise((resolve) => {
      const r = rec.current;
      if (!r || r.state === "inactive") {
        cleanup();
        resolve(chunks.current.length ? new Blob(chunks.current, { type: chunks.current[0].type }) : null);
        return;
      }
      r.onstop = () => {
        const b = new Blob(chunks.current, { type: chunks.current[0]?.type || r.mimeType || "video/webm" });
        cleanup();
        resolve(b);
      };
      r.stop();
    });
  const cancel = () => {
    if (rec.current && rec.current.state !== "inactive") {
      rec.current.onstop = null;
      rec.current.stop();
    }
    cleanup();
  };
  return { stream, elapsed, start, stop, cancel };
}

/* ------------------------------------------------------------------ caption */
export function Caption({ text, spoken, className }: { text: string; spoken: number; className?: string }) {
  if (!text) return <div className="mt-4 h-[96px]" />;
  const a = text.slice(0, spoken);
  const b = spoken >= text.length ? "" : text.slice(spoken);
  return (
    <p className={className ?? "mt-4 max-w-[30ch] text-balance text-center font-display text-[23px] leading-[1.32] text-ink sm:max-w-[34ch] sm:text-[25px]"}>
      <span>{a}</span>
      <span className="text-ink/25 transition-colors">{b}</span>
    </p>
  );
}

