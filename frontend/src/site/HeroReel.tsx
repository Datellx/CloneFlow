import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BadgeCheck, Mail, MessageSquare, Play, Repeat, ShieldCheck, FileText, Volume2 } from "lucide-react";
import { Orb, type OrbState } from "../shared/Orb";
import { CoverageRing } from "../shared/bits";

/** Autoplays muted (captions are burnt in); one tap restarts it with sound and native controls. */
export function HeroVideo({ onFail }: { onFail: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [sound, setSound] = useState(false);
  const playWithSound = () => {
    const v = ref.current;
    if (!v) return;
    v.muted = false;
    v.currentTime = 0;
    v.loop = false;
    setSound(true);
    v.play().catch(() => {
      v.muted = true;
      v.play().catch(() => undefined);
    });
  };
  return (
    <>
      <video
        ref={ref}
        src="/demo.mp4"
        poster="/demo-poster.jpg"
        autoPlay
        muted
        loop={!sound}
        playsInline
        preload="auto"
        controls={sound}
        onError={onFail}
        className="absolute inset-0 h-full w-full bg-[#141416] object-cover"
        aria-label="Clone Flow product video"
      />
      {!sound && (
        <button
          onClick={playWithSound}
          className="group absolute inset-0 flex items-start justify-end p-2 text-left sm:p-5"
          aria-label="Play the video with sound"
        >
          <span className="inline-flex items-center gap-1.5 rounded-full bg-black/55 py-1 pl-1 pr-3 text-[12px] font-medium text-white backdrop-blur-md transition-colors group-hover:bg-black/70 sm:gap-2 sm:py-2 sm:pl-2 sm:pr-4 sm:text-[14.5px]">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-brand-800 sm:h-8 sm:w-8">
              <Play className="ml-0.5 h-3 w-3 fill-current sm:h-4 sm:w-4" />
            </span>
            <span className="hidden sm:inline">Play with sound</span>
            <span className="sm:hidden">Sound</span>
            <Volume2 className="h-3.5 w-3.5 opacity-80 sm:h-4 sm:w-4" />
          </span>
        </button>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ demo reel (no video yet) */
const SCRIPT: { orb: OrbState; line: string; you?: string; show?: "connect" | "reading" | "evidence" | "card" | "ring" }[] = [
  { orb: "speaking", line: "Hi Sam. How are you doing today?" },
  { orb: "listening", line: "Hi Sam. How are you doing today?", you: "Good! A little sad to be leaving." },
  { orb: "speaking", line: "Let's connect your Microsoft 365, so I can read what you already wrote down.", show: "connect" },
  { orb: "thinking", line: "Reading now. Personal messages are skipped, never read.", show: "reading" },
  { orb: "speaking", line: "You recalibrate the wrist every Monday. Nothing I read says why. What goes wrong if it's skipped?", show: "evidence" },
  { orb: "listening", line: "You recalibrate the wrist every Monday. Nothing I read says why.", you: "The shop is cold all weekend, so the wrist servos drift.", show: "evidence" },
  { orb: "speaking", line: "That makes sense. I saved it in your words.", show: "card" },
  { orb: "idle", line: "The whole team can ask it, in Teams or here, with proof.", show: "ring" },
];

export function DemoReel() {
  const [i, setI] = useState(0);
  const [pulse, setPulse] = useState(0);
  const [level, setLevel] = useState(0);
  const step = SCRIPT[i];
  useEffect(() => {
    const t = window.setTimeout(() => setI((x) => (x + 1) % SCRIPT.length), step.you ? 2600 : 3400);
    return () => window.clearTimeout(t);
  }, [i, step.you]);
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      if (now - last > 170) {
        last = now;
        if (step.orb === "speaking") setPulse((p) => p + 1);
        if (step.orb === "listening") setLevel(0.25 + Math.abs(Math.sin(now / 260)) * 0.6);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step.orb]);

  return (
    <div className="absolute inset-0 flex bg-paper text-left" role="img" aria-label="Animated preview: the Clone Flow interviewer talking with someone who is leaving">
      <div className="relative flex min-w-0 flex-1 flex-col items-center justify-center px-[5%]">
        <div
          className="pointer-events-none absolute left-1/2 top-[40%] h-[70%] w-[70%] -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ background: "radial-gradient(closest-side, rgba(222,157,174,0.45), rgba(251,248,247,0))" }}
          aria-hidden
        />
        <div className="relative w-[clamp(84px,19%,190px)]">
          <Orb state={step.orb} pulse={pulse} level={level} size={170} className="!h-auto !w-full [&>svg]:!h-auto [&>svg]:!w-full" />
        </div>
        <AnimatePresence mode="wait">
          <motion.p
            key={step.line}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.35 }}
            className="relative mt-[3%] max-w-[30ch] text-balance text-center font-display text-[clamp(13px,2.3vw,25px)] leading-snug text-ink"
          >
            {step.line}
          </motion.p>
        </AnimatePresence>
        <div className="relative mt-[3%] flex h-[22%] w-full items-start justify-center">
          <AnimatePresence mode="wait">
            {step.show === "connect" && (
              <motion.div key="c" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex gap-2">
                {["Microsoft 365", "GitHub"].map((n, k) => (
                  <span key={n} className="inline-flex items-center gap-2 rounded-xl border border-line bg-white px-3 py-2 text-[clamp(9px,1.2vw,13px)] font-medium text-ink shadow-card">
                    {n}
                    <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9 + k * 0.6 }} className="rounded-full bg-sure-bg px-2 py-0.5 text-sure">Connected</motion.span>
                  </span>
                ))}
              </motion.div>
            )}
            {step.show === "reading" && (
              <motion.div key="r" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex gap-[4%]">
                {[["Emails", 312, Mail], ["Chats", 248, MessageSquare], ["Files", 29, FileText]].map(([n, v, I]) => {
                  const Icon = I as typeof Mail;
                  return (
                    <div key={n as string} className="text-center">
                      <div className="flex items-center justify-center gap-1 text-[clamp(8px,1vw,12px)] text-ink-muted"><Icon className="h-3 w-3" />{n as string}</div>
                      <TickNumber to={v as number} className="font-display text-[clamp(16px,3vw,34px)] leading-none text-ink" />
                    </div>
                  );
                })}
                <div className="self-end text-[clamp(8px,1vw,12px)] text-ink-muted"><ShieldCheck className="mr-1 inline h-3 w-3 text-sure" />23 personal skipped</div>
              </motion.div>
            )}
            {step.show === "evidence" && (
              <motion.div key="e" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-wrap justify-center gap-2">
                {["Reminder: wrist recal before first shift", "#production-line2, Oct 6"].map((n) => (
                  <span key={n} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1 text-[clamp(8px,1.05vw,12.5px)] font-medium text-ink-soft shadow-card">
                    <Mail className="h-3 w-3 text-ink-muted" /> {n}
                  </span>
                ))}
              </motion.div>
            )}
            {step.show === "card" && (
              <motion.div key="k" initial={{ opacity: 0, x: -30, scale: 0.95 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0 }} transition={{ type: "spring", stiffness: 240, damping: 24 }}
                className="flex items-center gap-2.5 rounded-xl border border-brand-200 bg-white px-3 py-2 shadow-[0_0_0_4px_rgba(122,30,58,0.08)]">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-50 text-brand-700"><Repeat className="h-3.5 w-3.5" /></span>
                <span className="text-[clamp(9px,1.2vw,14px)] font-medium text-ink">Monday wrist recalibration</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-sure-bg px-2 py-0.5 text-[clamp(8px,1vw,12px)] font-medium text-sure"><BadgeCheck className="h-3 w-3" /> Verified</span>
              </motion.div>
            )}
            {step.show === "ring" && (
              <motion.div key="g" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-3">
                <CoverageRing value={88} size={72} stroke={6} duration={1600} label="captured" />
                <span className="text-left font-display text-[clamp(12px,1.8vw,20px)] text-ink">64% → 88%<br /><span className="font-sans text-[clamp(8px,1vw,12px)] text-ink-muted">of their work, captured</span></span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      {/* faint transcript rail */}
      <div className="hidden w-[30%] flex-col gap-2 border-l border-line bg-[#F7F3F2] p-[2%] sm:flex">
        <div className="mb-1 text-[clamp(8px,1vw,12px)] font-semibold text-ink">Conversation</div>
        <AnimatePresence initial={false}>
          {SCRIPT.slice(0, i + 1).filter((s, k, a) => k === a.findIndex((x) => x.line === s.line)).slice(-4).map((s) => (
            <motion.div key={s.line} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl rounded-tl-sm border border-line bg-white px-2 py-1.5 text-[clamp(7px,0.9vw,11px)] leading-snug text-ink-soft">
              {s.line}
            </motion.div>
          ))}
          {step.you && (
            <motion.div key={step.you} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="ml-auto max-w-[85%] rounded-xl rounded-br-sm bg-brand-700 px-2 py-1.5 text-[clamp(7px,0.9vw,11px)] leading-snug text-white">
              {step.you}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function TickNumber({ to, className }: { to: number; className?: string }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / 2400);
      setV(Math.round(to * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <div className={`tnum ${className ?? ""}`}>{v}</div>;
}
