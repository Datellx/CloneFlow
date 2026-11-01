// "See what I kept private" — how personal vs work was separated, shown only to the person leaving.
// GET /api/me/session/privacy → PrivacyReport.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BriefcaseBusiness, ChevronDown, EyeOff, Lock, Mail, MessageSquare, ShieldCheck } from "lucide-react";
import { request } from "@/lib/api";
import { cn } from "@/lib/format";
import { Drawer, ErrorState, Skeleton } from "@/components/ui";
import { fmtDay } from "../../shared/bits";

interface PrivacyExample { kind: "mail" | "chat" | string; from: string; title: string; at?: string | null }
interface PrivacyGroup { reason: string; count: number; kinds?: { mail?: number; chat?: number; [k: string]: number | undefined }; examples?: PrivacyExample[] }
interface PrivacyReport { kept_for_ai: number; excluded_by_you: number; set_aside: PrivacyGroup[]; note?: string }

const usePrivacyReport = (enabled: boolean) =>
  useQuery({ queryKey: ["handover", "session", "privacy"], queryFn: () => request<PrivacyReport>("/me/session/privacy"), enabled, refetchInterval: enabled ? 4000 : false });

/** Plural phrases for the "set aside" groups; unknown reasons fall back to the reason itself. */
const GROUP_LABEL: Record<string, [string, string]> = {
  Newsletter: ["newsletter", "newsletters"],
  Notification: ["notification", "notifications"],
  "Calendar traffic": ["calendar message", "calendar messages"],
  "Auto-reply": ["automatic reply", "automatic replies"],
  "Company announcement": ["company announcement", "company announcements"],
  "Short acknowledgement": ["short acknowledgement", "short acknowledgements"],
};
const n = (v: number) => v.toLocaleString();

export function PrivacyButton({ onClick, compact, className }: { onClick: () => void; compact?: boolean; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-medium text-sure transition-colors hover:bg-sure-bg",
        compact ? "px-2 py-1 text-[12px]" : "bg-white px-3.5 py-1.5 text-[13px] ring-1 ring-inset ring-[#CFE5D8]",
        className,
      )}
    >
      <ShieldCheck className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} /> See what I kept private
    </button>
  );
}

export function PrivacySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const q = usePrivacyReport(open);
  const d = q.data;
  const personal = d?.set_aside.find((g) => g.reason === "Personal");
  const others = (d?.set_aside ?? []).filter((g) => g.reason !== "Personal" && g.count > 0);
  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={520}
      title={
        <div>
          <div className="flex items-center gap-2 text-[17px] font-semibold text-ink"><Lock className="h-4 w-4 text-sure" /> What I kept private</div>
          <p className="mt-0.5 text-[13px] text-ink-muted">Only you can see this page.</p>
        </div>
      }
    >
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !d ? (
        <div className="space-y-3"><Skeleton className="h-40 rounded-2xl" /><Skeleton className="h-14 rounded-xl" /><Skeleton className="h-14 rounded-xl" /></div>
      ) : (
        <div className="space-y-6">
          {/* personal */}
          <section className="overflow-hidden rounded-2xl border border-[#CFE5D8] bg-sure-bg/50">
            <div className="flex items-start gap-3.5 px-5 py-5">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-sure ring-1 ring-inset ring-[#CFE5D8]"><ShieldCheck className="h-5 w-5" /></span>
              <div className="min-w-0">
                <div className="tnum font-display text-[30px] leading-none text-ink">{n(personal?.count ?? 0)}</div>
                <div className="mt-1 text-[15px] font-semibold text-ink">personal {personal?.count === 1 ? "message" : "messages"}</div>
                <p className="mt-0.5 text-[13.5px] text-ink-soft">Never read by AI, never shown to your company.</p>
              </div>
            </div>
            {personal?.examples?.length ? (
              <ul className="divide-y divide-[#DCEBE2] border-t border-[#CFE5D8] bg-white/70">
                {personal.examples.map((e, i) => <ExampleRow key={i} e={e} />)}
              </ul>
            ) : null}
            {personal && personal.count > (personal.examples?.length ?? 0) && (personal.examples?.length ?? 0) > 0 && (
              <div className="border-t border-[#CFE5D8] bg-white/70 px-5 py-2.5 text-[12.5px] text-ink-muted">
                and {n(personal.count - (personal.examples?.length ?? 0))} more. Only the sender and subject are shown, here, to you.
              </div>
            )}
          </section>

          {/* everything else set aside */}
          {others.length > 0 && (
            <section>
              <h3 className="mb-2 font-sans text-[13.5px] font-semibold text-ink">Also set aside, not useful as work knowledge</h3>
              <ul className="space-y-2">{others.map((g) => <GroupRow key={g.reason} g={g} />)}</ul>
            </section>
          )}

          {d.excluded_by_you > 0 && (
            <div className="flex items-center gap-3 rounded-xl border border-line bg-white px-4 py-3 text-[13.5px] text-ink-soft">
              <EyeOff className="h-4 w-4 text-ink-muted" /> <span><span className="tnum font-semibold text-ink">{n(d.excluded_by_you)}</span> you excluded yourself</span>
            </div>
          )}

          {/* kept */}
          <div className="flex items-center gap-3.5 rounded-2xl border border-line bg-paper px-5 py-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-brand-700 ring-1 ring-inset ring-line"><BriefcaseBusiness className="h-5 w-5" /></span>
            <div>
              <div className="text-[15px] text-ink"><span className="tnum font-semibold">{n(d.kept_for_ai)}</span> messages kept as work knowledge</div>
              <div className="text-[12.5px] text-ink-muted">These are what Clone Flow reads to learn your work.</div>
            </div>
          </div>

          {d.note && <p className="text-[12.5px] leading-relaxed text-ink-muted">{d.note}</p>}
        </div>
      )}
    </Drawer>
  );
}

function ExampleRow({ e }: { e: PrivacyExample }) {
  const Icon = e.kind === "chat" ? MessageSquare : Mail;
  return (
    <li className="flex items-center gap-3 px-5 py-2.5">
      <Icon className="h-4 w-4 shrink-0 text-ink-faint" aria-label={e.kind === "chat" ? "Chat" : "Email"} />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-[13.5px] font-medium text-ink">{e.from}</div>
        <div className="truncate text-[12.5px] text-ink-muted">{e.title}</div>
      </div>
      {e.at && <span className="shrink-0 text-[11.5px] text-ink-faint">{fmtDay(e.at)}</span>}
      <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-sure" aria-hidden />
    </li>
  );
}

function GroupRow({ g }: { g: PrivacyGroup }) {
  const [open, setOpen] = useState(false);
  const [one, many] = GROUP_LABEL[g.reason] ?? [g.reason.toLowerCase(), g.reason.toLowerCase()];
  const has = (g.examples?.length ?? 0) > 0;
  return (
    <li className="overflow-hidden rounded-xl border border-line bg-white">
      <button type="button" onClick={() => has && setOpen((v) => !v)} aria-expanded={has ? open : undefined} className={cn("flex w-full items-center gap-3 px-4 py-3 text-left", has && "hover:bg-paper")}>
        <span className="tnum w-12 shrink-0 text-right font-display text-[20px] leading-none text-ink">{n(g.count)}</span>
        <span className="min-w-0 flex-1 text-[13.5px] text-ink-soft">{g.count === 1 ? one : many} set aside</span>
        {has && <ChevronDown className={cn("h-4 w-4 text-ink-faint transition-transform", open && "rotate-180")} />}
      </button>
      {open && has && (
        <ul className="divide-y divide-line border-t border-line bg-paper/50">
          {g.examples!.map((e, i) => (
            <li key={i} className="flex items-center gap-3 px-4 py-2 text-[12.5px]">
              <span className="w-12 shrink-0" />
              <span className="min-w-0 flex-1 truncate"><span className="font-medium text-ink">{e.from}</span> <span className="text-ink-muted">· {e.title}</span></span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
