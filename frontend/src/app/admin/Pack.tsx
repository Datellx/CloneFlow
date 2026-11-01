import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CalendarClock, ChevronDown, MessagesSquare, RotateCcw, TriangleAlert } from "lucide-react";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/format";
import { Button, Dialog, EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { handover } from "../api";
import { useBriefing, useCards, useEmployee } from "../../shared/api";
import { CoverageRing, PersonAvatar, ProofChip, TYPE_META, TypeIcon, VerifiedBadge, daysUntil, firstName, fmtDay } from "../../shared/bits";
import { ProofModal } from "../../shared/viewers";
import type { Card, CardType, Proof } from "../../shared/types";
import { useTitle } from "../orgs";

const ORDER: CardType[] = ["open_task", "process", "routine", "contact", "decision", "system", "location", "fact"];
const PLURAL: Record<CardType, string> = {
  open_task: "Open tasks", process: "Processes", routine: "Routines", contact: "Contacts", decision: "Decisions", system: "Systems", location: "Locations", fact: "Facts",
};

/** One person's knowledge pack, as the company sees it. */
export default function Pack() {
  const eid = Number(useParams().eid);
  const emp = useEmployee(eid);
  const cards = useCards(eid);
  const [tab, setTab] = useState<"pack" | "briefing">("pack");
  const [proof, setProof] = useState<Proof | null>(null);
  const [onlyVerified, setOnlyVerified] = useState(false);

  const groups = useMemo(() => {
    const list = (cards.data ?? []).filter((c) => !onlyVerified || c.status === "verified_in_interview");
    return ORDER.map((t) => ({ type: t, cards: list.filter((c) => c.type === t) })).filter((g) => g.cards.length);
  }, [cards.data, onlyVerified]);

  useTitle(emp.data?.name ?? "Knowledge pack");
  if (emp.error) return <ErrorState error={emp.error} onRetry={() => emp.refetch()} />;
  const e = emp.data;
  const name = e ? firstName(e.name) : "";
  const days = daysUntil(e?.leaving_on);
  const verified = (cards.data ?? []).filter((c) => c.status === "verified_in_interview").length;

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-3">
        <Link to="/admin/knowledge" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-muted hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> Knowledge base
        </Link>
        {e && <StartOver eid={eid} name={e.name} />}
      </div>
      {!e ? (
        <Skeleton className="h-32 rounded-2xl" />
      ) : (
        <header className="card flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:p-6">
          <PersonAvatar name={e.name} color={e.avatar_color} size={64} />
          <div className="min-w-0 flex-1">
            <h1 className="text-[30px] font-normal leading-tight text-ink">{e.name}</h1>
            <p className="mt-0.5 text-[14px] text-ink-muted">
              {e.title}
              {e.team ? ` · ${e.team}` : ""}
              {e.leaving_on && (days !== null && days < 0 ? ` · left ${fmtDay(e.leaving_on, { year: true })}` : ` · leaving ${fmtDay(e.leaving_on)}`)}
            </p>
            {e.profile?.summary && <p className="mt-2 max-w-[62ch] text-[14.5px] leading-relaxed text-ink-soft">{e.profile.summary}</p>}
            {e.profile?.roles?.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {e.profile.roles.map((r) => (
                  <span key={r.title + r.from} className="rounded-full bg-paper px-2.5 py-1 text-[12px] text-ink-soft ring-1 ring-inset ring-line">
                    {r.title} <span className="text-ink-faint">{r.from.slice(0, 4)}–{r.to ? r.to.slice(0, 4) : "now"}</span>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-5">
            <div className="text-[12.5px] leading-tight text-ink-muted">
              <div><span className="tnum text-[15px] font-semibold text-ink">{e.counts.cards}</span> cards</div>
              <div className="mt-1"><span className="tnum text-[15px] font-semibold text-sure">{e.counts.verified_cards}</span> verified</div>
            </div>
            <CoverageRing value={e.coverage} size={84} stroke={6.5} label="captured" />
          </div>
        </header>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div role="tablist" className="inline-flex rounded-xl bg-white p-1 ring-1 ring-inset ring-line">
          {([["pack", "Knowledge pack"], ["briefing", "Handover briefing"]] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={cn("rounded-lg px-3.5 py-1.5 text-[13.5px] font-medium transition-colors", tab === k ? "bg-brand-50 text-brand-800" : "text-ink-muted hover:text-ink")}>
              {l}
            </button>
          ))}
        </div>
        {tab === "pack" && verified > 0 && (
          <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-ink-soft">
            <input type="checkbox" checked={onlyVerified} onChange={(ev) => setOnlyVerified(ev.target.checked)} className="h-4 w-4 accent-[#7A1E3A]" />
            Only what {name || "they"} verified ({verified})
          </label>
        )}
        <Link to={`/admin/ask?eid=${eid}`} className="ml-auto">
          <Button variant="secondary" icon={<MessagesSquare className="h-4 w-4" />}>Ask about {name ? `${name}'s` : "their"} work</Button>
        </Link>
      </div>

      <div className="mt-6">
        {tab === "pack" ? (
          cards.isLoading ? (
            <div className="grid gap-3 md:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}</div>
          ) : !groups.length ? (
            <EmptyState className="rounded-2xl border border-dashed border-line-strong bg-white" title="Nothing captured yet">
              Cards appear here as {name || "they"} connect their work and talk with Clone Flow.
            </EmptyState>
          ) : (
            <div className="space-y-9">
              {groups.map((g) => (
                <section key={g.type}>
                  <h2 className="mb-3 flex items-center gap-2 font-sans text-[14.5px] font-semibold text-ink">
                    <TypeIcon type={g.type} size={24} /> {PLURAL[g.type]} <span className="tnum font-normal text-ink-muted">{g.cards.length}</span>
                  </h2>
                  <div className="grid gap-3 md:grid-cols-2">
                    {g.cards.map((c) => <PackCard key={c.id} c={c} onOpen={setProof} />)}
                  </div>
                </section>
              ))}
            </div>
          )
        ) : (
          <Briefing eid={eid} name={name} onOpen={setProof} />
        )}
      </div>
      <ProofModal eid={eid} proof={proof} onClose={() => setProof(null)} />
    </div>
  );
}

function PackCard({ c, onOpen }: { c: Card; onOpen: (p: Proof) => void }) {
  const [open, setOpen] = useState(false);
  const verified = c.status === "verified_in_interview";
  return (
    <article className={cn("flex flex-col rounded-2xl border bg-white p-4 shadow-card", verified ? "border-[#D9EADF]" : "border-line")}>
      <div className="flex items-start gap-2">
        <h3 className="min-w-0 flex-1 font-sans text-[15px] font-semibold leading-snug text-ink">{c.title}</h3>
        {verified ? <VerifiedBadge className="shrink-0" /> : <span className="shrink-0 rounded-full bg-paper px-2 py-0.5 text-xs text-ink-muted ring-1 ring-inset ring-line">{TYPE_META[c.type].label}</span>}
      </div>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-soft">{c.body}</p>
      {c.steps.length > 0 && (
        <>
          <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="mt-2 inline-flex w-fit items-center gap-1 text-[12.5px] font-medium text-brand-700 hover:underline">
            {c.steps.length} steps <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
          </button>
          {open && (
            <ol className="mt-2 space-y-1.5">
              {c.steps.map((s, i) => (
                <li key={i} className="flex gap-2.5 text-[13.5px] leading-snug text-ink-soft">
                  <span className="tnum flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[11px] font-semibold text-brand-800">{i + 1}</span>
                  {s}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
      {c.sources.length > 0 && (
        <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
          {c.sources.slice(0, 4).map((s, i) => <ProofChip key={i} proof={s} onOpen={onOpen} className="!text-[12px]" />)}
        </div>
      )}
    </article>
  );
}

function Briefing({ eid, name, onOpen }: { eid: number; name: string; onOpen: (p: Proof) => void }) {
  const b = useBriefing(eid);
  if (b.isLoading) return <Skeleton className="h-64 rounded-2xl" />;
  if (b.error) {
    if (b.error instanceof ApiError && b.error.status === 404)
      return (
        <EmptyState className="rounded-2xl border border-dashed border-line-strong bg-white" icon={<CalendarClock className="h-5 w-5" />} title="The Day-1 briefing isn't ready yet">
          It's written once, when {name || "their"} exit conversation finishes.
        </EmptyState>
      );
    return <ErrorState error={b.error} onRetry={() => b.refetch()} />;
  }
  const d = b.data!;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <section className="card p-5 sm:p-6">
        <h2 className="mb-4 flex items-center gap-2 font-sans text-[15px] font-semibold text-ink"><TriangleAlert className="h-4 w-4 text-brand-700" /> What breaks first if nobody picks it up</h2>
        <ol className="space-y-4">
          {d.will_break.map((w, i) => (
            <li key={i} className="flex gap-3.5">
              <span className="tnum mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-700 text-[12px] font-semibold text-white">{i + 1}</span>
              <div className="min-w-0">
                <div className="text-[15px] font-semibold text-ink">{w.title}</div>
                <div className="mt-0.5 text-[14px] text-ink-soft">{w.why}</div>
                <div className="mt-2 flex flex-wrap gap-1.5">{w.sources.map((p, j) => <ProofChip key={j} proof={p} onOpen={onOpen} />)}</div>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <section className="card p-5 sm:p-6">
        <h2 className="mb-4 font-sans text-[15px] font-semibold text-ink">Projects</h2>
        <ul className="space-y-3.5">
          {d.projects.map((p) => (
            <li key={p.name}>
              <div className="flex items-center gap-2">
                <span className="text-[14.5px] font-medium text-ink">{p.name}</span>
                <span className="rounded-full bg-paper px-2 py-0.5 text-[11.5px] text-ink-muted ring-1 ring-inset ring-line">{p.status}</span>
              </div>
              <p className="mt-0.5 text-[13.5px] text-ink-muted">{p.note}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** Admin: clear someone's handover so they can go through it again from the start. */
function StartOver({ eid, name }: { eid: number; name: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async (keep: boolean) => {
    setBusy(true);
    try {
      await handover.restart(eid, keep);
      toast.success(`${firstName(name)}'s handover starts over on their next visit.`);
      qc.invalidateQueries();
      setOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium text-ink-muted hover:bg-white hover:text-ink">
        <RotateCcw className="h-3.5 w-3.5" /> Start over
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Start ${firstName(name)}'s handover over?`}
        description="Their conversation, knowledge cards and interview are cleared. Their invitation link keeps working.">
        <div className="flex flex-col gap-2 pb-3 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="secondary" loading={busy} onClick={() => run(true)}>Keep connected email and chats</Button>
          <Button loading={busy} onClick={() => run(false)}>Start completely fresh</Button>
        </div>
      </Dialog>
    </>
  );
}
