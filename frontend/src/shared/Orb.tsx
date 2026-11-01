import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/format";

export type OrbState = "idle" | "speaking" | "listening" | "thinking";

/**
 * The Clone Flow interviewer: a soft burgundy orb with eyes.
 * - idle: slow breathing, occasional blink
 * - speaking: mouth opens with `pulse` (bumped on each spoken word)
 * - listening: rings swell with mic `level` (0..1)
 * - thinking: eyes glance up, three dots orbit
 */
export function Orb({
  state = "idle", level = 0, pulse = 0, size = 220, className,
}: { state?: OrbState; level?: number; pulse?: number; size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  const [mouth, setMouth] = useState(0);
  const raf = useRef(0);
  const target = useRef(0);

  // Each word boundary kicks the mouth open; it eases closed between words.
  useEffect(() => {
    if (state !== "speaking") {
      target.current = 0;
      return;
    }
    target.current = 0.55 + Math.random() * 0.45;
  }, [pulse, state]);
  useEffect(() => {
    let last = performance.now();
    let fallbackT = 0;
    const tick = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      if (state === "speaking") {
        // Gentle syllable wobble so the mouth keeps moving even without boundary events.
        fallbackT += dt;
        if (fallbackT > 170) {
          fallbackT = 0;
          target.current = Math.max(target.current * 0.35, 0.2 + Math.random() * 0.55);
        }
      }
      const goal = state === "speaking" ? target.current : 0;
      target.current *= state === "speaking" ? 0.94 : 0;
      setMouth((m) => {
        const next = m + (goal - m) * Math.min(1, dt / 70);
        return Math.abs(next - m) < 0.001 ? goal : next;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [state]);

  const lv = state === "listening" ? Math.min(1, level * 1.4) : 0;
  const thinking = state === "thinking";
  const mouthH = 3 + mouth * 15;

  return (
    <div className={cn("orb relative select-none", `orb-${state}`, className)} style={{ width: size, height: size }} aria-hidden>
      {/* listening rings */}
      <div className="absolute inset-0 flex items-center justify-center">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="absolute rounded-full border border-brand-300 transition-[transform,opacity] duration-150"
            style={{
              width: size * 0.78,
              height: size * 0.78,
              transform: `scale(${state === "listening" ? 1.04 + i * 0.1 + lv * (0.12 + i * 0.1) : 0.9})`,
              opacity: state === "listening" ? 0.55 - i * 0.15 + lv * 0.2 : 0,
            }}
          />
        ))}
      </div>
      <svg viewBox="0 0 200 200" width={size} height={size} className="relative overflow-visible">
        <defs>
          <radialGradient id={`body-${id}`} cx="38%" cy="32%" r="75%">
            <stop offset="0%" stopColor="#C96B85" />
            <stop offset="45%" stopColor="#922D4C" />
            <stop offset="100%" stopColor="#55182B" />
          </radialGradient>
          <radialGradient id={`glow-${id}`} cx="50%" cy="50%" r="50%">
            <stop offset="60%" stopColor="#AE4463" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#AE4463" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`shine-${id}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="100" cy="104" r="96" fill={`url(#glow-${id})`} className="orb-glow" />
        <g className="orb-body">
          <path
            className="orb-blob"
            d="M100 22c34 0 70 22 74 62 4 42-22 86-74 88-50 2-78-36-76-82 2-42 34-68 76-68z"
            fill={`url(#body-${id})`}
          />
          <ellipse cx="72" cy="58" rx="26" ry="16" fill={`url(#shine-${id})`} transform="rotate(-24 72 58)" />
          {/* face */}
          <g
            style={{
              transform: thinking ? "translate(6px,-7px)" : state === "listening" ? "translate(0,-2px)" : "translate(0,0)",
              transition: "transform .5s cubic-bezier(.3,.7,.3,1)",
            }}
          >
            <g className="orb-eyes">
              <ellipse cx="78" cy="96" rx="11" ry="13" fill="#FFF8F9" />
              <ellipse cx="122" cy="96" rx="11" ry="13" fill="#FFF8F9" />
              <circle cx={thinking ? 82 : 79} cy={thinking ? 91 : 98} r="6" fill="#300914" style={{ transition: "all .4s" }} />
              <circle cx={thinking ? 126 : 123} cy={thinking ? 91 : 98} r="6" fill="#300914" style={{ transition: "all .4s" }} />
              <circle cx={thinking ? 84 : 81} cy={thinking ? 89 : 96} r="1.8" fill="#fff" style={{ transition: "all .4s" }} />
              <circle cx={thinking ? 128 : 125} cy={thinking ? 89 : 96} r="1.8" fill="#fff" style={{ transition: "all .4s" }} />
            </g>
            <ellipse cx="62" cy="118" rx="9" ry="5" fill="#F3C9D4" opacity=".35" />
            <ellipse cx="138" cy="118" rx="9" ry="5" fill="#F3C9D4" opacity=".35" />
            {/* mouth: a smile at rest, an open oval while speaking */}
            {state === "speaking" && mouth > 0.04 ? (
              <g>
                <path d={`M${89 - mouth * 2} 120 Q100 ${121 + mouthH * 1.7} ${111 + mouth * 2} 120 Z`} fill="#300914" />
                <path d={`M${95} ${120 + mouthH * 0.55} Q100 ${120 + mouthH * 1.05} ${105} ${120 + mouthH * 0.55}`} stroke="#DE9DAE" strokeWidth={mouthH > 9 ? 3 : 0} strokeLinecap="round" fill="none" />
              </g>
            ) : (
              <path d={state === "listening" ? "M92 124 q8 6 16 0" : "M89 122 q11 9 22 0"} stroke="#300914" strokeWidth="3.6" strokeLinecap="round" fill="none" />
            )}
          </g>
        </g>
        {/* thinking dots */}
        <g className={cn("transition-opacity duration-300", thinking ? "opacity-100" : "opacity-0")}>
          <g className="orb-orbit" style={{ transformOrigin: "100px 100px" }}>
            <circle cx="100" cy="6" r="5" fill="#C96B85" />
            <circle cx="186" cy="118" r="4" fill="#DE9DAE" />
            <circle cx="24" cy="140" r="3.5" fill="#ECC6D0" />
          </g>
        </g>
      </svg>
    </div>
  );
}
