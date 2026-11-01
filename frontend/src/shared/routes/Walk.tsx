import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Camera, Check, Loader2, RotateCcw, VideoOff } from "lucide-react";
import { cn } from "@/lib/format";
import { pickAudioMime } from "@/lib/voice";
import { knowledge } from "../api";
import { Orb } from "../Orb";
import { firstName, fmtClock } from "../bits";

type Phase = "intro" | "starting" | "ready" | "recording" | "paused" | "finishing" | "done" | "denied";

export default function Walk() {
  const { token = "" } = useParams();
  const info = useQuery({ queryKey: ["walk", token], queryFn: () => knowledge.walk(token), retry: false, refetchOnWindowFocus: false });
  const [phase, setPhase] = useState<Phase>("intro");
  const [err, setErr] = useState<string | null>(null);
  const [kept, setKept] = useState<string[]>([]);
  const [sent, setSent] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [caption, setCaption] = useState("");
  const [newCards, setNewCards] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const timers = useRef<number[]>([]);
  const audioRec = useRef<MediaRecorder | null>(null);
  const t0 = useRef(0);
  const canvas = useRef<HTMLCanvasElement | null>(null);

  const stopAll = useCallback(() => {
    timers.current.forEach((t) => window.clearInterval(t));
    timers.current = [];
    if (audioRec.current && audioRec.current.state !== "inactive") audioRec.current.stop();
    audioRec.current = null;
  }, []);
  useEffect(
    () => () => {
      stopAll();
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [stopAll],
  );

  const startCamera = async () => {
    setErr(null);
    setPhase("starting");
    if (!navigator.mediaDevices?.getUserMedia) {
      setErr(window.isSecureContext ? "This browser can't open the camera. Try Safari on iPhone or Chrome on Android." : "The camera needs a secure (https) link. Ask for a new QR code from the laptop.");
      setPhase("denied");
      return;
    }
    try {
      let s: MediaStream;
      try {
        s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: { echoCancellation: true, noiseSuppression: true } });
      } catch (e) {
        // Some phones refuse audio+video together; video alone still works.
        if ((e as { name?: string }).name === "NotAllowedError") throw e;
        s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } } });
      }
      stream.current = s;
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play().catch(() => undefined);
      }
      setPhase("ready");
    } catch (e) {
      const name = (e as { name?: string }).name;
      setErr(
        name === "NotAllowedError"
          ? "Camera access was blocked. Allow the camera for this page in your browser settings, then try again."
          : name === "NotFoundError"
            ? "No camera was found on this device."
            : "The camera couldn't start. Close other apps using it and try again.",
      );
      setPhase("denied");
    }
  };

  const grab = (): Promise<{ blob: Blob; url: string } | null> =>
    new Promise((resolve) => {
      const v = video.current;
      if (!v || !v.videoWidth) return resolve(null);
      const c = canvas.current ?? (canvas.current = document.createElement("canvas"));
      const scale = Math.min(1, 960 / v.videoWidth);
      c.width = Math.round(v.videoWidth * scale);
      c.height = Math.round(v.videoHeight * scale);
      c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);
      c.toBlob((b) => resolve(b ? { blob: b, url: URL.createObjectURL(b) } : null), "image/jpeg", 0.72);
    });

  const startAudioChunk = () => {
    const s = stream.current;
    if (!s || !s.getAudioTracks().length || typeof MediaRecorder === "undefined") return;
    const mime = pickAudioMime();
    const rec = new MediaRecorder(new MediaStream(s.getAudioTracks()), mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      const b = new Blob(chunks, { type: chunks[0]?.type || rec.mimeType || mime });
      if (b.size > 1500)
        knowledge.walkAudio(token, b).then((r) => r.transcript && setCaption(r.transcript)).catch(() => undefined);
    };
    rec.start();
    audioRec.current = rec;
  };

  const offset = useRef(0);
  const pause = () => {
    stopAll();
    offset.current = (Date.now() - t0.current) / 1000;
    setPhase("paused");
  };
  const record = () => {
    setPhase("recording");
    t0.current = Date.now() - offset.current * 1000;
    // One frame a second; the server keeps the moments that matter.
    timers.current.push(
      window.setInterval(async () => {
        const t = Math.round((Date.now() - t0.current) / 100) / 10;
        setElapsed(Math.floor(t));
        const f = await grab();
        if (!f) return;
        setSent((n) => n + 1);
        try {
          const r = await knowledge.walkFrame(token, f.blob, t);
          if (r.kept) setKept((k) => [f.url, ...k].slice(0, 24));
          else URL.revokeObjectURL(f.url);
        } catch {
          URL.revokeObjectURL(f.url);
        }
      }, 1000),
    );
    // Audio in ~5 s chunks, each a standalone file.
    startAudioChunk();
    timers.current.push(
      window.setInterval(() => {
        if (audioRec.current && audioRec.current.state !== "inactive") audioRec.current.stop();
        startAudioChunk();
      }, 5000),
    );
  };

  const finish = async () => {
    stopAll();
    setPhase("finishing");
    try {
      const r = await knowledge.walkFinish(token);
      setNewCards(r.new_cards.length);
    } catch {
      /* the laptop still has every frame we sent */
    }
    stream.current?.getTracks().forEach((t) => t.stop());
    setPhase("done");
  };

  const name = info.data ? firstName(info.data.employee_name) : "";
  const live = phase === "ready" || phase === "recording" || phase === "paused" || phase === "finishing";
  const active = phase === "recording" || phase === "paused";

  if (info.isLoading)
    return (
      <Screen>
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-white/70" />
      </Screen>
    );
  if (info.error)
    return (
      <Screen>
        <Orb size={120} className="mx-auto" />
        <h1 className="mt-6 text-center font-display text-[26px] leading-tight text-white">This link has expired</h1>
        <p className="mt-3 text-center text-[15px] text-white/70">{(info.error as Error).message || "Ask for a new QR code on the laptop."}</p>
      </Screen>
    );

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#140a0e] text-white" style={{ height: "100dvh" }}>
      {/* camera */}
      <video ref={video} playsInline muted autoPlay className={cn("absolute inset-0 h-full w-full object-cover transition-opacity duration-500", live ? "opacity-100" : "opacity-0")} />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-black/70 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-black/80 to-transparent" />

      {/* question */}
      <div className="absolute inset-x-0 top-0 px-5" style={{ paddingTop: "max(16px, env(safe-area-inset-top))" }}>
        <div className="flex items-center gap-2 text-[13px] text-white/80">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand-700"><Orb size={22} /></span>
          Clone Flow · floor walk with {name}
          {phase === "paused" && <span className="ml-auto rounded-full bg-white/20 px-2.5 py-0.5 text-[12px] font-semibold">Paused</span>}
          {phase === "recording" && (
            <span className="tnum ml-auto inline-flex items-center gap-1.5 rounded-full bg-[#E5484D] px-2.5 py-0.5 text-[12px] font-semibold">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> {fmtClock(elapsed)}
            </span>
          )}
        </div>
        {info.data?.question && phase !== "done" && (
          <p className={cn("mt-2.5 font-display leading-snug text-white [text-shadow:0_1px_12px_rgba(0,0,0,.5)]", live ? "line-clamp-3 text-[18px]" : "text-[21px]")}>{info.data.question.text}</p>
        )}
      </div>

      {/* intro / denied / done */}
      {!live && (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-7 text-center">
          {phase === "done" ? (
            <>
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-sure text-white"><Check className="h-8 w-8" /></span>
              <h1 className="mt-6 font-display text-[28px] leading-tight">Saved. Thank you, {name}.</h1>
              <p className="mt-3 text-[15px] text-white/70">
                {kept.length} moments went to the laptop{newCards ? ` and became ${newCards} new cards` : ""}. You can close this tab.
              </p>
            </>
          ) : phase === "denied" ? (
            <>
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10"><VideoOff className="h-7 w-7" /></span>
              <h1 className="mt-6 font-display text-[26px] leading-tight">The camera isn't available</h1>
              <p className="mt-3 text-[15px] leading-relaxed text-white/75">{err}</p>
              <button onClick={startCamera} className="mt-8 inline-flex h-14 items-center gap-2 rounded-2xl bg-white px-7 text-[16px] font-semibold text-brand-900">
                <RotateCcw className="h-5 w-5" /> Try again
              </button>
            </>
          ) : (
            <>
              <Orb size={132} state={phase === "starting" ? "thinking" : "idle"} />
              <h1 className="mt-5 font-display text-[28px] leading-tight">Show me around, {name}.</h1>
              <p className="mt-3 max-w-[30ch] text-[15px] leading-relaxed text-white/75">
                Point your camera at what you're explaining and talk as you go. I'll keep the important moments.
              </p>
              <button
                onClick={startCamera}
                disabled={phase === "starting"}
                className="mt-9 inline-flex h-14 w-full max-w-[300px] items-center justify-center gap-2.5 rounded-2xl bg-brand-600 text-[17px] font-semibold text-white shadow-[0_10px_30px_-10px_rgba(174,68,99,.9)] active:bg-brand-700"
              >
                {phase === "starting" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
                Turn on camera
              </button>
              <p className="mt-4 text-[12.5px] text-white/50">Video and sound go only to {name}'s Clone Flow interview.</p>
            </>
          )}
        </div>
      )}

      {/* controls */}
      {live && (
        <div className="absolute inset-x-0 bottom-0 px-5" style={{ paddingBottom: "max(20px, env(safe-area-inset-bottom))" }}>
          {caption && phase === "recording" && (
            <p className="mb-3 line-clamp-2 text-center text-[14px] text-white/85 [text-shadow:0_1px_8px_rgba(0,0,0,.6)]">“{caption}”</p>
          )}
          {kept.length > 0 && (
            <div className="no-scrollbar mb-4 flex gap-2 overflow-x-auto">
              {kept.map((u) => (
                <img key={u} src={u} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover ring-2 ring-white/80" />
              ))}
            </div>
          )}
          <div className="flex items-center justify-between">
            <div className="w-24 text-[13px] leading-tight text-white/85">
              <span className="tnum block text-[22px] font-semibold text-white">{kept.length}</span>
              saved {kept.length === 1 ? "moment" : "moments"}
              {sent > 0 && <span className="tnum block text-[11px] text-white/50">{sent} frames sent</span>}
            </div>
            <button
              onClick={phase === "recording" ? pause : record}
              disabled={phase === "finishing"}
              aria-label={phase === "recording" ? "Pause" : phase === "paused" ? "Resume recording" : "Start recording"}
              className="relative flex h-[84px] w-[84px] items-center justify-center rounded-full border-[5px] border-white/90"
            >
              <span className={cn("block bg-[#E5484D] transition-all duration-200", phase === "recording" ? "h-8 w-8 rounded-lg" : "h-[62px] w-[62px] rounded-full")} />
              {phase === "finishing" && <Loader2 className="absolute h-7 w-7 animate-spin text-white" />}
            </button>
            <div className="flex w-24 justify-end">
              {active && (
                <button onClick={finish} className="h-12 rounded-xl bg-white px-4 text-[15px] font-semibold text-brand-900">
                  Finish
                </button>
              )}
            </div>
          </div>
          {(phase === "ready" || phase === "paused") && <p className="mt-3 text-center text-[13px] text-white/70">{phase === "ready" ? "Tap the red button to start" : "Paused. Tap to keep going, or Finish."}</p>}
        </div>
      )}
    </div>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 flex flex-col justify-center bg-[#140a0e] px-7 text-white" style={{ height: "100dvh" }}>
      {children}
    </div>
  );
}
