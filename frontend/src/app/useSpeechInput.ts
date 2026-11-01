import { useCallback, useRef, useState } from "react";

/* Minimal typing for the browser's (free, on-device or vendor) SpeechRecognition. */
interface RecResult { isFinal: boolean; 0: { transcript: string } }
interface RecEvent { resultIndex: number; results: ArrayLike<RecResult> }
interface Rec {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: RecEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
type RecCtor = new () => Rec;

function ctor(): RecCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

/**
 * Live transcript from the browser's SpeechRecognition when it exists. It runs next to the
 * MediaRecorder: if it produces text, the UI sends text (cheaper, instant); if it fails or hears
 * nothing, the UI falls back to sending the recorded audio.
 */
export function useSpeechInput() {
  const [interim, setInterim] = useState("");
  const finalText = useRef("");
  const rec = useRef<Rec | null>(null);
  const failed = useRef(false);
  const supported = !!ctor();

  const start = useCallback(() => {
    finalText.current = "";
    failed.current = false;
    setInterim("");
    const C = ctor();
    if (!C) return;
    try {
      const r = new C();
      r.lang = navigator.language || "en-US";
      r.continuous = true;
      r.interimResults = true;
      r.onresult = (e) => {
        let fin = "";
        let mid = "";
        for (let i = 0; i < e.results.length; i++) {
          const res = e.results[i];
          if (res.isFinal) fin += res[0].transcript;
          else mid += res[0].transcript;
        }
        finalText.current = fin;
        setInterim((fin + " " + mid).trim());
      };
      r.onerror = () => {
        failed.current = true;
      };
      r.onend = () => {
        rec.current = null;
      };
      r.start();
      rec.current = r;
    } catch {
      failed.current = true;
    }
  }, []);

  /** Stop listening and return the best transcript (final + last interim), or "" if none. */
  const stop = useCallback(
    () =>
      new Promise<string>((resolve) => {
        const r = rec.current;
        const done = () => resolve(failed.current ? "" : (finalText.current || interimRef.current).trim());
        if (!r) return done();
        let settled = false;
        r.onend = () => {
          rec.current = null;
          if (!settled) {
            settled = true;
            done();
          }
        };
        try {
          r.stop();
        } catch {
          /* already stopped */
        }
        window.setTimeout(() => {
          if (!settled) {
            settled = true;
            done();
          }
        }, 900);
      }),
    [],
  );
  const interimRef = useRef("");
  interimRef.current = interim;

  const cancel = useCallback(() => {
    try {
      rec.current?.abort();
    } catch {
      /* ignore */
    }
    rec.current = null;
    setInterim("");
  }, []);

  return { supported, interim, start, stop, cancel };
}
