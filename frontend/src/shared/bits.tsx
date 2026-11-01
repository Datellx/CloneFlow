import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BadgeCheck, CircleDot, Cpu, FileText, FolderKanban, GitBranch, HelpCircle, Lightbulb, ListChecks, Mail, MapPin,
  MessageSquare, Mic, Play, Repeat, Smartphone, Sparkles, Split, UserRound, Users, Footprints, CircleDashed, Contact,
} from "lucide-react";
import { cn } from "@/lib/format";
import type { CardType, GapType, Proof } from "./types";

/* ------------------------------------------------------------ formatting */
export const initials = (n: string) =>
  n.replace(/\(.*?\)/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
export const firstName = (n: string) => n.split(/\s+/)[0];

export function fmtDay(iso: string | null | undefined, opts: { year?: boolean } = {}) {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(opts.year || !sameYear ? { year: "numeric" } : {}) });
}
export function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
export function fmtClock(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}
export function daysUntil(iso: string | null | undefined) {
  if (!iso) return null;
  return Math.ceil((new Date(iso + "T23:59:00").getTime() - Date.now()) / 86_400_000);
}

/* ------------------------------------------------------------ card types */
type Meta = { label: string; icon: typeof Mail; tint: string };
export const TYPE_META: Record<CardType | "project" | "person" | "note", Meta> = {
  process: { label: "Process", icon: ListChecks, tint: "text-brand-700 bg-brand-50" },
  decision: { label: "Decision", icon: GitBranch, tint: "text-[#5B4A8B] bg-[#F1EEF8]" },
  system: { label: "System", icon: Cpu, tint: "text-[#3D5A73] bg-[#EDF2F6]" },
  contact: { label: "Contact", icon: UserRound, tint: "text-[#2F6F4F] bg-sure-bg" },
  location: { label: "Location", icon: MapPin, tint: "text-[#8A5A12] bg-maybe-bg" },
  open_task: { label: "Open task", icon: CircleDot, tint: "text-[#9B1C1C] bg-[#FBEDEC]" },
  routine: { label: "Routine", icon: Repeat, tint: "text-brand-700 bg-brand-50" },
  fact: { label: "Fact", icon: Lightbulb, tint: "text-[#6B5A2E] bg-[#F6F1E4]" },
  project: { label: "Project", icon: FolderKanban, tint: "text-white bg-brand-700" },
  person: { label: "Person", icon: Users, tint: "text-ink-soft bg-[#F1ECEA]" },
  note: { label: "Note", icon: Sparkles, tint: "text-ink-muted bg-[#F4F0EE]" },
};
export function TypeIcon({ type, size = 32, className }: { type: keyof typeof TYPE_META; size?: number; className?: string }) {
  const m = TYPE_META[type] ?? TYPE_META.note;
  const I = m.icon;
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center rounded-lg", m.tint, className)}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <I style={{ width: size * 0.5, height: size * 0.5 }} />
    </span>
  );
}

/* ------------------------------------------------------------ gap types */
const GAP_META: Record<GapType, { label: string; icon: typeof Mail; cls: string }> = {
  missing_why: { label: "Missing why", icon: HelpCircle, cls: "bg-brand-50 text-brand-800 ring-brand-100" },
  contradiction: { label: "Contradiction", icon: Split, cls: "bg-maybe-bg text-[#7A4D0C] ring-[#F1DDB8]" },
  unfinished_task: { label: "Unfinished task", icon: CircleDashed, cls: "bg-[#FBEDEC] text-[#8E1F1F] ring-[#F3D3D0]" },
  undocumented_step: { label: "Undocumented step", icon: Footprints, cls: "bg-[#EDF2F6] text-[#2E4A61] ring-[#D6E1EA]" },
  who_to_contact: { label: "Who to contact", icon: Contact, cls: "bg-sure-bg text-[#24573E] ring-[#CFE5D8]" },
};
export function GapBadge({ type, className }: { type: GapType | null; className?: string }) {
  if (!type) return null;
  const m = GAP_META[type];
  const I = m.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] font-medium ring-1 ring-inset", m.cls, className)}>
      <I className="h-3.5 w-3.5" /> {m.label}
    </span>
  );
}

export function VerifiedBadge({ className, label = "Verified" }: { className?: string; label?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full bg-sure-bg px-2 py-0.5 text-xs font-medium text-sure", className)}>
      <BadgeCheck className="h-3.5 w-3.5" /> {label}
    </span>
  );
}

/* ------------------------------------------------------------ proofs */
const PROOF_ICON: Record<Proof["kind"], typeof Mail> = {
  email: Mail, chat: MessageSquare, file: FileText, screen: Play, floor: Smartphone, interview: Mic,
};
export function proofLabel(p: Proof) {
  if (p.kind === "interview") return "Verified in exit interview";
  if ((p.kind === "screen" || p.kind === "floor") && p.timestamp_s != null) return `${fmtClock(p.timestamp_s)} · ${p.label}`;
  return p.label;
}
export function ProofChip({ proof, onOpen, className }: { proof: Proof; onOpen?: (p: Proof) => void; className?: string }) {
  const I = PROOF_ICON[proof.kind] ?? FileText;
  const verified = proof.kind === "interview";
  const media = proof.kind === "screen" || proof.kind === "floor";
  const content = (
    <>
      <span
        className={cn(
          "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md",
          verified ? "bg-sure text-white" : media ? "bg-brand-700 text-white" : "bg-white text-ink-muted ring-1 ring-inset ring-line",
        )}
      >
        <I className={cn("h-3 w-3", media && "fill-current")} />
      </span>
      <span className="truncate">{proofLabel(proof)}</span>
    </>
  );
  const cls = cn(
    "inline-flex max-w-full items-center gap-1.5 rounded-lg border py-1 pl-1 pr-2.5 text-[12.5px] font-medium transition-colors",
    verified ? "border-[#CFE5D8] bg-sure-bg text-[#24573E]" : "border-line bg-paper text-ink-soft",
    onOpen && !verified && "hover:border-brand-200 hover:bg-brand-50 hover:text-brand-800",
    className,
  );
  if (!onOpen || verified) return <span className={cls} title={proof.quote || undefined}>{content}</span>;
  return (
    <button type="button" className={cls} onClick={() => onOpen(proof)} title={proof.quote || `Open ${proof.label}`}>
      {content}
    </button>
  );
}

/* ------------------------------------------------------------ knowledge card (compact) */

/* ------------------------------------------------------------ count up */
function useCountUp(target: number, duration = 900) {
  const [v, setV] = useState(target);
  const from = useRef(target);
  const raf = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || a === target) {
      setV(target);
      from.current = target;
      return;
    }
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const e = 1 - Math.pow(1 - t, 3);
      const val = a + (target - a) * e;
      setV(val);
      from.current = val;
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, duration]);
  return v;
}
export function CountUp({ value, duration, format = (n) => String(Math.round(n)) }: { value: number; duration?: number; format?: (n: number) => string }) {
  const v = useCountUp(value, duration);
  return <span className="tnum">{format(v)}</span>;
}

/* ------------------------------------------------------------ coverage ring */
export function CoverageRing({
  value, size = 120, stroke = 9, label = "coverage", duration = 1400, compact = false,
}: { value: number; size?: number; stroke?: number; label?: ReactNode; duration?: number; compact?: boolean }) {
  const v = useCountUp(value, duration);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }} role="img" aria-label={`Coverage ${Math.round(value)}%`}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#F1E6E8" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#7A1E3A" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c - (Math.max(0, Math.min(100, v)) / 100) * c}
        />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="tnum font-display text-ink" style={{ fontSize: size * (compact ? 0.3 : 0.27) }}>
          {Math.round(v)}
          <span style={{ fontSize: size * 0.14 }} className="text-ink-muted">%</span>
        </span>
        {!compact && label && <span className="mt-1 text-[11px] text-ink-muted" style={{ fontSize: Math.max(10, size * 0.09) }}>{label}</span>}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------ person avatar */
const PALETTE = ["#7A1E3A", "#3F5C4A", "#4A5A7A", "#8A6A2E", "#6B4A6E", "#2E5E6B", "#7A4A3A"];
function colorFor(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
export function PersonAvatar({ name, size = 32, color, className }: { name: string; size?: number; color?: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 select-none items-center justify-center rounded-full font-medium text-white", className)}
      style={{ width: size, height: size, background: color || colorFor(name), fontSize: size * 0.38 }}
    >
      {initials(name)}
    </span>
  );
}

/* ------------------------------------------------------------ toggle */

/* ------------------------------------------------------------ mini markdown */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  let list: { ordered: boolean; items: ReactNode[] } | null = null;
  const flush = () => {
    if (!list) return;
    const L = list.ordered ? "ol" : "ul";
    out.push(
      <L key={out.length} className={cn("my-3 space-y-1.5 pl-5", list.ordered ? "list-decimal" : "list-disc", "marker:text-ink-faint")}>
        {list.items}
      </L>,
    );
    list = null;
  };
  const inline = (s: string) =>
    s.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((p, i) =>
      p.startsWith("`") ? (
        <code key={i} className="rounded bg-[#F3EEEC] px-1 py-0.5 font-mono text-[0.86em] text-ink">{p.slice(1, -1)}</code>
      ) : p.startsWith("**") ? (
        <strong key={i}>{p.slice(2, -2)}</strong>
      ) : (
        p
      ),
    );
  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    let m;
    if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) {
      flush();
      const lvl = m[1].length;
      out.push(
        lvl === 1 ? <h1 key={i} className="mb-3 mt-1 text-[26px] font-normal leading-tight text-ink">{m[2]}</h1>
          : lvl === 2 ? <h2 key={i} className="mb-2 mt-6 text-[19px] font-medium text-ink">{m[2]}</h2>
            : <h3 key={i} className="mb-1 mt-4 font-sans text-[15px] font-semibold text-ink">{m[2]}</h3>,
      );
    } else if ((m = /^\s*-\s+\[( |x)\]\s+(.*)$/.exec(line))) {
      if (!list || list.ordered) { flush(); list = { ordered: false, items: [] }; }
      list.items.push(
        <li key={i} className="flex list-none items-start gap-2 -ml-5">
          <span className={cn("mt-[5px] h-3.5 w-3.5 shrink-0 rounded border", m[1] === "x" ? "border-brand-700 bg-brand-700" : "border-line-strong bg-white")} />
          <span>{inline(m[2])}</span>
        </li>,
      );
    } else if ((m = /^\s*[-*]\s+(.*)$/.exec(line))) {
      if (!list || list.ordered) { flush(); list = { ordered: false, items: [] }; }
      list.items.push(<li key={i}>{inline(m[1])}</li>);
    } else if ((m = /^\s*\d+\.\s+(.*)$/.exec(line))) {
      if (!list || !list.ordered) { flush(); list = { ordered: true, items: [] }; }
      list.items.push(<li key={i}>{inline(m[1])}</li>);
    } else if (!line.trim()) {
      flush();
    } else {
      flush();
      out.push(<p key={i} className="my-2.5">{inline(line)}</p>);
    }
  });
  flush();
  return <div className={cn("text-[15px] leading-relaxed text-ink-soft", className)}>{out}</div>;
}

/* ------------------------------------------------------------ data table */
export function DataTable({ rows, highlight }: { rows: string[][]; highlight?: string }) {
  if (!rows.length) return null;
  const [head, ...body] = rows;
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full border-collapse text-left text-[13.5px]">
        <thead className="bg-paper">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap border-b border-line px-3.5 py-2 font-medium text-ink-muted">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, i) => {
            const hit = highlight && r.join(" ").toLowerCase().includes(highlight.toLowerCase());
            return (
              <tr key={i} className={cn("border-b border-line last:border-0", hit && "bg-maybe-bg")}>
                {r.map((c, j) => (
                  <td key={j} className="tnum whitespace-nowrap px-3.5 py-2 text-ink">{c}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------ section label */
