import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BadgeCheck, Check, FileText, Loader2, Mail, MessagesSquare, ShieldCheck, Smartphone, Sparkles } from "lucide-react";
import { mediaUrl } from "@/lib/api";
import { cn } from "@/lib/format";
import { Dialog } from "@/components/ui";
import { CountUp, CoverageRing, TypeIcon, TYPE_META } from "../../shared/bits";
import type { Card, WalkFeedItem, WalkStart } from "../../shared/types";
import type { Provider, ReadingPayload, SummaryPayload } from "../types";

/* ------------------------------------------------------------------ providers */
// Neutral marks drawn for Clone Flow (not vendor logos): mail + chat, mail, code branch.
const G = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const PROVIDER_ICON: Record<string, ReactNode> = {
  microsoft: (
    <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" aria-hidden {...G}>
      <rect x="2.5" y="5" width="12" height="9" rx="1.6" />
      <path d="m3 6 5.5 4.2L14 6" />
      <path d="M17 9.5h2.6c.8 0 1.4.6 1.4 1.4v5.2c0 .8-.6 1.4-1.4 1.4H19v2.3l-2.8-2.3h-4.8c-.8 0-1.4-.6-1.4-1.4V16.5" />
    </svg>
  ),
  gmail: (
    <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" aria-hidden {...G}>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="m3.6 6.6 8.4 6.2 8.4-6.2" />
    </svg>
  ),
  github: (
    <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" aria-hidden {...G}>
      <circle cx="6.5" cy="5.5" r="2" />
      <circle cx="6.5" cy="18.5" r="2" />
      <circle cx="17.5" cy="8.5" r="2" />
      <path d="M6.5 7.5v9M17.5 10.5c0 3.5-3 4-6.2 4.6-2.2.4-3.6 1-4.4 2" />
    </svg>
  ),
  demo: <Sparkles className="h-5 w-5" aria-hidden />,
};

/** What each source is, in the founder's words; unknown keys fall back to what the server sends. */
const PROVIDER_COPY: Record<string, { name: string; note: string }> = {
  microsoft: { name: "Microsoft 365", note: "Outlook mail and Teams chats" },
  gmail: { name: "Gmail", note: "Work email" },
  github: { name: "GitHub", note: "Repositories" },
};
const COUNT_LABEL: Record<string, [string, string]> = {
  emails: ["email", "emails"], chats: ["chat", "chats"], files: ["file", "files"], repos: ["repository", "repositories"],
  repositories: ["repository", "repositories"], prs: ["pull request", "pull requests"], pull_requests: ["pull request", "pull requests"],
  docs: ["doc", "docs"], readmes: ["README", "READMEs"], issues: ["issue", "issues"],
};
function countLine(counts?: Record<string, number>) {
  return Object.entries(counts ?? {})
    .filter(([, n]) => typeof n === "number" && n > 0)
    .map(([k, n]) => `${n.toLocaleString()} ${(COUNT_LABEL[k] ?? [k, k])[n === 1 ? 0 : 1]}`)
    .join(" · ");
}

function providerCopy(p: Provider) {
  const c = PROVIDER_COPY[p.key];
  return { name: c?.name ?? p.label, note: c?.note ?? p.note ?? "" };
}

/** One source to connect: real OAuth (full-page), or — when the server has not set it up — "Not available yet". */
export function ProviderTile({
  p, onConnect, busy, compact, vertical,
}: { p: Provider; onConnect: (p: Provider) => void; busy?: boolean; compact?: boolean; vertical?: boolean }) {
  const { name, note } = providerCopy(p);
  const real = p.configured && !!p.start_url;
  const importing = p.connected && p.status === "importing";
  const failed = p.status === "error";
  const counts = countLine(p.counts);
  const icon = (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl ring-1 ring-inset",
        p.connected ? "bg-sure-bg text-sure ring-[#CFE5D8]" : "bg-paper text-brand-800 ring-line",
        vertical ? "h-12 w-12" : compact ? "h-9 w-9" : "h-11 w-11",
      )}
    >
      {PROVIDER_ICON[p.key] ?? PROVIDER_ICON.demo}
    </span>
  );

  const status = p.connected ? (
    <div className={cn("min-w-0 leading-tight", vertical && "flex flex-col items-center")}>
      <span className={cn("inline-flex items-center gap-1 text-[12.5px] font-medium", failed ? "text-[#9B1C1C]" : "text-sure")}>
        {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : failed ? null : <Check className="h-3.5 w-3.5" />}
        {failed ? "Import failed" : importing ? "Importing" : "Connected"}
      </span>
      <span className="mt-0.5 block max-w-full truncate text-[12px] text-ink-muted" title={p.account ?? undefined}>
        {p.account || " "}
      </span>
      {(counts || importing) && (
        <span className="tnum mt-0.5 block max-w-full truncate text-[11.5px] text-ink-faint" aria-live="polite">
          {counts || "Starting…"}
        </span>
      )}
    </div>
  ) : null;

  const action = p.connected && !failed ? null : real ? (
    <button
      type="button"
      onClick={() => onConnect(p)}
      disabled={busy}
      aria-label={`${failed ? "Reconnect" : "Connect"} ${name}`}
      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-brand-700 px-4 text-[13px] font-medium text-white transition-colors hover:bg-brand-800 disabled:opacity-60"
    >
      {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {failed ? "Reconnect" : "Connect"}
    </button>
  ) : (
    <div className={cn("flex shrink-0 flex-col leading-tight", vertical ? "items-center text-center" : "items-end text-right")}>
      <span className="text-[12.5px] font-medium text-ink-muted">Not available yet</span>
      <span className="mt-0.5 text-[11.5px] text-ink-faint">Ask your administrator</span>
    </div>
  );

  if (vertical)
    return (
      <div className={cn("flex flex-col items-center rounded-2xl border bg-white px-4 pb-4 pt-5 text-center shadow-card transition-colors", p.connected ? "border-[#CFE5D8]" : "border-line")}>
        {icon}
        <span className="mt-3 text-[15px] font-semibold text-ink">{name}</span>
        <span className="mt-0.5 text-[12.5px] leading-snug text-ink-muted">{note}</span>
        <div className="mt-3.5 flex min-h-[48px] w-full flex-col items-center justify-center">{status ?? action}</div>
      </div>
    );
  return (
    <div className={cn("flex items-center gap-3 rounded-2xl border bg-white text-left transition-colors", compact ? "px-3 py-2.5" : "px-4 py-3.5 shadow-card", p.connected ? "border-[#CFE5D8]" : "border-line")}>
      {icon}
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-[14px] font-semibold text-ink">{name}</span>
        {p.connected ? status : note && <span className="block truncate text-[12px] text-ink-muted">{note}</span>}
      </span>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------ reading counters */
function Counter({ value, label, icon, compact }: { value: number; label: string; icon: ReactNode; compact?: boolean }) {
  return (
    <div className="flex flex-col items-center">
      <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink-muted">{icon}{label}</div>
      <div className={cn("mt-1 font-display leading-none text-ink", compact ? "text-[24px]" : "text-[34px] sm:text-[40px]")}>
        <CountUp value={value} duration={1100} />
      </div>
    </div>
  );
}
export function ReadingCounters({ p: raw, live, compact }: { p: ReadingPayload; live: boolean; compact?: boolean }) {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const p = {
    ...raw,
    counters: { emails: n(raw.counters?.emails), chats: n(raw.counters?.chats), files: n(raw.counters?.files) },
    noise_skipped: n(raw.noise_skipped),
    personal_skipped: n(raw.personal_skipped),
  };
  const pct = raw.done ? 1 : Math.min(1, n((raw as ReadingPayload & { progress?: number }).progress));
  return (
    <div className="w-full max-w-[520px]">
      <div className="grid grid-cols-3 gap-4">
        <Counter value={p.counters.emails} compact={compact} label="Emails" icon={<Mail className="h-3.5 w-3.5" />} />
        <Counter value={p.counters.chats} compact={compact} label="Chats" icon={<MessagesSquare className="h-3.5 w-3.5" />} />
        <Counter value={p.counters.files} compact={compact} label="Files" icon={<FileText className="h-3.5 w-3.5" />} />
      </div>
      {live && !compact && (
        <div className="mx-auto mt-5 h-1 w-full max-w-[360px] overflow-hidden rounded-full bg-brand-100" aria-hidden>
          <div className="relative h-full rounded-full bg-brand-700 transition-[width] duration-1000 ease-linear" style={{ width: `${Math.max(4, pct * 100)}%` }}>
            <span className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-white/40 to-transparent" />
          </div>
        </div>
      )}
      <div className={cn("flex flex-wrap justify-center gap-2", compact ? "mt-3 text-[11.5px]" : "mt-4 text-[12.5px]")}>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-ink-soft ring-1 ring-inset ring-line">
          <span className="tnum font-semibold text-ink"><CountUp value={p.noise_skipped} duration={1100} /></span> automated skipped
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-ink-soft ring-1 ring-inset ring-line">
          <ShieldCheck className="h-3.5 w-3.5 text-sure" />
          <span className="tnum font-semibold text-ink"><CountUp value={p.personal_skipped} duration={1100} /></span> personal, never read
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ summary */
export function SummaryCard({ s }: { s: SummaryPayload }) {
  const stats = [
    { n: s.processes, label: "processes" },
    { n: s.contacts, label: "contacts" },
    { n: s.open_tasks, label: "open tasks" },
    { n: s.cards ?? 0, label: "cards in all" },
  ];
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      className="w-full max-w-[520px] overflow-hidden rounded-2xl border border-line bg-white shadow-card"
    >
      <div className="flex items-center gap-5 p-5">
        <CoverageRing value={s.coverage_after} size={96} stroke={7} duration={2200} label="captured" />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[13px] font-medium text-sure"><Check className="h-4 w-4" /> Handover complete</div>
          <p className="mt-1 font-display text-[21px] leading-snug text-ink">
            {s.coverage_before}% <span className="text-ink-faint">→</span> {s.coverage_after}% of your work captured
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-4">
        {stats.map((x) => (
          <div key={x.label} className="bg-white px-4 py-3">
            <div className="font-display text-[28px] leading-none text-ink"><CountUp value={x.n} duration={1300} /></div>
            <div className="mt-1 text-[12.5px] text-ink-muted">{x.label}</div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ card pill */
export function CardPill({ card, className }: { card: Card; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5 rounded-xl border border-line bg-white px-3 py-2 shadow-card", className)}>
      <TypeIcon type={card.type} size={26} />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="text-[11.5px] text-ink-muted">{TYPE_META[card.type]?.label}</div>
        <div className="truncate text-[13.5px] font-medium text-ink">{card.title}</div>
      </div>
      {card.status === "verified_in_interview" && (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sure-bg text-sure" title="In your own words" aria-label="In your own words">
          <BadgeCheck className="h-3.5 w-3.5" />
        </span>
      )}
    </div>
  );
}

/** The last few saved cards, sliding in at the corner of the stage. */
export function SavedStack({ cards }: { cards: Card[] }) {
  const first = useRef(true);
  const [fresh, setFresh] = useState<Set<string | number>>(new Set());
  const ids = cards.map((c) => c.id).join("|");
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setFresh(new Set(cards.slice(0, 3).map((c) => c.id)));
    const t = window.setTimeout(() => setFresh(new Set()), 2400);
    return () => window.clearTimeout(t);
  }, [ids]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!cards.length) return null;
  return (
    <div className="pointer-events-none flex w-[280px] flex-col gap-2" aria-label="Recently saved">
      <div className="text-[12px] font-medium text-ink-muted">Saved to your pack</div>
      <AnimatePresence initial={false}>
        {cards.slice(0, 3).map((c) => (
          <motion.div
            key={c.id}
            layout
            initial={{ opacity: 0, x: -24, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
          >
            <CardPill card={c} className={cn("transition-shadow", fresh.has(c.id) && "border-brand-200 shadow-[0_0_0_4px_rgba(122,30,58,0.08)]")} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ phone walk */
export function WalkSheet({
  open, onClose, walk, feed, done,
}: { open: boolean; onClose: () => void; walk: WalkStart | null; feed: WalkFeedItem[]; done: boolean }) {
  return (
    <Dialog open={open} onClose={onClose} title={done ? "Thanks for the tour" : "Walk me around with your phone"} size="lg"
      description={done ? "I kept the moments that matter." : "Scan this with your phone camera. No app needed. Point at things and talk."}>
      {!walk ? (
        <div className="flex h-56 items-center justify-center text-sm text-ink-muted"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Making a link for your phone…</div>
      ) : (
        <div className="pb-2">
          <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
            <div
              className="h-[188px] w-[188px] shrink-0 overflow-hidden rounded-2xl border border-line bg-white p-2 shadow-card [&>svg]:h-full [&>svg]:w-full"
              dangerouslySetInnerHTML={{ __html: walk.qr_svg }}
              role="img"
              aria-label="QR code that opens the phone walk"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[13.5px] font-medium text-ink">
                <Smartphone className="h-4 w-4 text-brand-700" /> Received from your phone
                <span className="tnum ml-auto text-xs font-normal text-ink-muted">{feed.length} moments</span>
              </div>
              {!feed.length ? (
                <div className="mt-3 flex h-32 items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong text-[13px] text-ink-muted">
                  <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-60" /><span className="relative h-2 w-2 rounded-full bg-brand-500" /></span>
                  Waiting for your phone
                </div>
              ) : (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <AnimatePresence initial={false}>
                    {feed.slice(0, 6).map((f) => (
                      <motion.figure key={f.seq} layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="overflow-hidden rounded-lg border border-line bg-white">
                        <img src={mediaUrl(f.frame_url)} alt={f.label} className="aspect-[4/3] w-full bg-[#1d1f24] object-cover" />
                        <figcaption className="truncate px-2 py-1 text-[11.5px] text-ink-soft">{f.label}</figcaption>
                      </motion.figure>
                    ))}
                  </AnimatePresence>
                </div>
              )}
              <a href={walk.url} target="_blank" rel="noreferrer" className="mt-3 block truncate font-mono text-[11.5px] text-ink-muted hover:text-brand-700">{walk.url}</a>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}
