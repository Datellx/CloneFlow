import { useCallback, useEffect, useRef, useState } from "react";
import { ensureMicrophone, getDesktop } from "./desktop";

/* ------------------------------------------------------------------ speak */

let currentAudio: HTMLAudioElement | null = null;
let currentUrl: string | null = null;
let serverTtsUnavailable = false;
/** "browser" means the server has no TTS; don't ask it (avoids a 501 per line). */
export function configureTts(provider: string) {
  serverTtsUnavailable = provider === "browser";
}
const listeners = new Set<(speaking: boolean) => void>();
function emit(v: boolean) {
  listeners.forEach((l) => l(v));
}

function pickVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices().filter((v) => /^en[-_](US|GB)/i.test(v.lang) || v.lang === "en");
  if (!voices.length) return null;
  const score = (v: SpeechSynthesisVoice) => {
    const n = v.name;
    let s = 0;
    if (/premium/i.test(n)) s += 100;
    if (/enhanced/i.test(n)) s += 90;
    if (/natural/i.test(n)) s += 85;
    if (/neural/i.test(n)) s += 80;
    if (/\b(Samantha|Ava|Allison|Karen|Daniel)\b/.test(n)) s += 50;
    if (/Google US English/i.test(n)) s += 45;
    if (/Google UK English/i.test(n)) s += 35;
    if (/en[-_]US/i.test(v.lang)) s += 5;
    if (v.localService) s += 1;
    return s;
  };
  return [...voices].sort((a, b) => score(b) - score(a))[0];
}

if (typeof window !== "undefined" && "speechSynthesis" in window) {
  // Chrome loads voices asynchronously.
  window.speechSynthesis.onvoiceschanged = () => void 0;
  window.speechSynthesis.getVoices();
}

export function stop() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  emit(false);
}

interface SpeakOptions {
  /** Fired on each word boundary (browser voices only) with the character index being spoken. */
  onBoundary?: (charIndex: number) => void;
}

function browserSpeak(text: string, opts: SpeakOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!("speechSynthesis" in window)) {
      reject(new Error("Read-aloud isn't supported in this browser."));
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    } else u.lang = "en-US";
    u.rate = 1.0;
    u.pitch = 1.0;
    if (opts.onBoundary) u.onboundary = (e) => opts.onBoundary?.(e.charIndex);
    u.onend = () => {
      emit(false);
      resolve();
    };
    u.onerror = (e) => {
      emit(false);
      if (e.error === "interrupted" || e.error === "canceled") resolve();
      else reject(new Error("Read-aloud stopped unexpectedly."));
    };
    emit(true);
    window.speechSynthesis.speak(u);
  });
}

/** Speak text aloud: server TTS if configured, otherwise the best browser voice. */
export async function speak(text: string, opts: SpeakOptions = {}): Promise<void> {
  stop();
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return;
  if (!serverTtsUnavailable) {
    try {
      const res = await fetch("/api/voice/speak", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: clean }),
      });
      if (res.ok && (res.headers.get("content-type") || "").includes("audio")) {
        const blob = await res.blob();
        currentUrl = URL.createObjectURL(blob);
        const audio = new Audio(currentUrl);
        currentAudio = audio;
        emit(true);
        await new Promise<void>((resolve) => {
          audio.onended = () => resolve();
          audio.onerror = () => resolve();
          audio.play().catch(() => resolve());
        });
        if (currentAudio === audio) stop();
        return;
      }
      if (res.status === 501) serverTtsUnavailable = true;
    } catch {
      /* fall through to browser */
    }
  }
  return browserSpeak(clean, opts);
}

/* ---------------------------------------------------------------- record */

export function pickAudioMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"]) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

export function friendlyMediaError(err: unknown, what: "microphone" | "screen" = "microphone"): string {
  const name = (err as { name?: string })?.name || "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return what === "screen"
      ? "Screen sharing was blocked. Choose a screen or window when your browser asks, or allow screen sharing in your browser settings."
      : "Microphone access is blocked. Click the lock icon in your address bar, allow the microphone, then try again. You can also type instead.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return what === "screen" ? "No screen was available to share." : "No microphone was found. Plug one in or type instead.";
  if (name === "NotReadableError") return `Your ${what} is being used by another app. Close it and try again.`;
  if (name === "AbortError") return "Recording was cancelled.";
  if (typeof window !== "undefined" && !window.isSecureContext)
    return "Recording needs a secure (https) connection.";
  return `Couldn't start the ${what}. You can type instead.`;
}

type RecorderState = "idle" | "requesting" | "recording" | "stopped";

/** Microphone recorder with live input level (0..1) and elapsed seconds. */
export function useRecorder() {
  const [state, setState] = useState<RecorderState>("idle");
  const [level, setLevel] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(32).fill(0));
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  /** True when macOS (desktop app) has blocked the microphone and System Settings must change. */
  const [blocked, setBlocked] = useState(false);

  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number>(0);
  const timerRef = useRef<number>(0);
  const chunks = useRef<Blob[]>([]);
  const resolver = useRef<((b: Blob | null) => void) | null>(null);

  const cleanup = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    window.clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    ctxRef.current?.close().catch(() => void 0);
    ctxRef.current = null;
    setLevel(0);
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const start = useCallback(async () => {
    setError(null);
    setBlob(null);
    setBlocked(false);
    if (getDesktop()) {
      setState("requesting");
      if ((await ensureMicrophone()) === "denied") {
        setState("idle");
        setBlocked(true);
        setError("Clone Flow doesn't have access to your microphone. Turn it on in System Settings, then try again.");
        return false;
      }
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Voice recording isn't supported in this browser. You can type instead.");
      return false;
    }
    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      const mime = pickAudioMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      rec.onstop = () => {
        // Safari can report an empty mimeType; the chunks carry the real container type.
        const type = chunks.current[0]?.type || rec.mimeType || mime || "";
        const b = new Blob(chunks.current, type ? { type } : undefined);
        setBlob(b);
        setState("stopped");
        cleanup();
        resolver.current?.(b);
        resolver.current = null;
      };
      recRef.current = rec;

      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      ctxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const buf = new Uint8Array(an.fftSize);
      let frame = 0;
      const tick = () => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.min(1, Math.sqrt(sum / buf.length) * 3.2);
        setLevel(rms);
        if (frame++ % 3 === 0) setLevels((prev) => [...prev.slice(1), rms]);
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();

      const t0 = Date.now();
      setElapsed(0);
      timerRef.current = window.setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 250);
      rec.start(250);
      setState("recording");
      return true;
    } catch (e) {
      cleanup();
      setState("idle");
      const name = (e as { name?: string })?.name;
      if (getDesktop() && (name === "NotAllowedError" || name === "SecurityError")) {
        setBlocked(true);
        setError("Clone Flow doesn't have access to your microphone. Turn it on in System Settings, then try again.");
      } else setError(friendlyMediaError(e));
      return false;
    }
  }, [cleanup]);

  const stopRec = useCallback((): Promise<Blob | null> => {
    const rec = recRef.current;
    if (!rec || rec.state === "inactive") return Promise.resolve(blob);
    return new Promise((resolve) => {
      resolver.current = resolve;
      rec.stop();
    });
  }, [blob]);

  const reset = useCallback(() => {
    if (recRef.current && recRef.current.state !== "inactive") {
      resolver.current = null;
      recRef.current.onstop = null;
      recRef.current.stop();
    }
    cleanup();
    setBlob(null);
    setElapsed(0);
    setState("idle");
    setBlocked(false);
    setError(null);
    setLevels(Array(32).fill(0));
  }, [cleanup]);

  return { state, level, levels, elapsed, error, blob, blocked, start, stop: stopRec, reset, setError };
}
