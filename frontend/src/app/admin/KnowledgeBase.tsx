// v4 Admin → Knowledge base: every captured knowledge pack; open one for its cards by type, with proof.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BadgeCheck, BookOpen, ChevronRight, MessagesSquare, Search, UserPlus } from "lucide-react";
import { ErrorState, LinkButton, Skeleton } from "@/components/ui";
import { CoverageRing, PersonAvatar, daysUntil, fmtDay } from "../../shared/bits";
import type { Employee } from "../../shared/types";
import { useOverview } from "../api";
import { useTitle } from "../orgs";

const STATUS_LABEL: Record<Employee["status"], string> = {
  not_started: "Not started", reading: "Reading their work", read: "Read, conversation pending", interviewing: "In conversation", captured: "Complete",
};

export default function KnowledgeBase() {
  useTitle("Knowledge base");
  const q = useOverview();
  const [term, setTerm] = useState("");
  const people = q.data?.people ?? [];
  const packs = useMemo(
    () =>
      people
        .filter((p) => p.counts.cards > 0)
        .filter((p) => !term.trim() || `${p.name} ${p.title} ${p.team}`.toLowerCase().includes(term.trim().toLowerCase()))
        .sort((a, b) => b.counts.cards - a.counts.cards),
    [people, term],
  );
  const total = people.reduce((t, p) => t + p.counts.cards, 0);
  const verified = people.reduce((t, p) => t + p.counts.verified_cards, 0);
  const withPacks = people.filter((p) => p.counts.cards > 0).length;
  const waiting = people.filter((p) => p.counts.cards === 0).length;

  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <div>
      <header className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-[34px] font-normal leading-tight text-ink sm:text-[40px]">Knowledge base</h1>
          <p className="mt-1 max-w-[62ch] text-[14.5px] text-ink-muted">
            Everything captured from handovers: processes, contacts, decisions, open tasks. Every card links to where it came from.
          </p>
        </div>
        {withPacks > 0 && (
          <LinkButton to="/admin/ask" variant="secondary" icon={<MessagesSquare className="h-4 w-4" />} className="shrink-0">Ask the knowledge base</LinkButton>
        )}
      </header>

      {!q.data ? (
        <div className="grid gap-3 md:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[132px] rounded-2xl" />)}</div>
      ) : !withPacks ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-line-strong bg-white/60 px-6 py-14 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700"><BookOpen className="h-5 w-5" /></span>
          <h2 className="mt-4 font-sans text-[16px] font-semibold text-ink">Nothing captured yet</h2>
          <p className="mt-1.5 max-w-[50ch] text-[14px] text-ink-muted">
            {waiting
              ? `${waiting} ${waiting === 1 ? "person has" : "people have"} been invited. Their knowledge pack appears here as soon as Clone Flow starts reading their work.`
              : "Knowledge packs appear here when someone who's leaving connects their work and talks with Clone Flow. Start by inviting them."}
          </p>
          {!waiting && <LinkButton to="/admin" className="mt-5" icon={<UserPlus className="h-4 w-4" />}>Invite someone who's leaving</LinkButton>}
        </div>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-3 overflow-hidden rounded-2xl border border-line bg-white">
            {[["Knowledge packs", withPacks], ["Cards", total], ["Verified in their words", verified]].map(([l, v], i) => (
              <div key={l as string} className={`px-4 py-4 sm:px-6 ${i ? "border-l border-line" : ""}`}>
                <div className="tnum font-display text-[28px] leading-none text-ink sm:text-[32px]">{v}</div>
                <div className="mt-1.5 text-[12.5px] text-ink-muted">{l}</div>
              </div>
            ))}
          </div>
          {withPacks > 4 && (
            <label className="relative mb-4 block max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
              <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Find a person or role" className="input pl-9" aria-label="Find a pack" />
            </label>
          )}
          <ul className="grid gap-3 md:grid-cols-2">
            {packs.map((p) => <PackRow key={p.id} p={p} />)}
          </ul>
        </>
      )}
    </div>
  );
}

function PackRow({ p }: { p: Employee }) {
  const days = daysUntil(p.leaving_on);
  return (
    <li>
      <Link to={`/admin/people/${p.id}`} className="group flex h-full items-center gap-4 rounded-2xl border border-line bg-white p-4 shadow-card transition-colors hover:border-line-strong sm:p-5">
        <PersonAvatar name={p.name} color={p.avatar_color} size={44} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15.5px] font-semibold text-ink">{p.name}</div>
          <div className="truncate text-[13px] text-ink-muted">
            {p.title || STATUS_LABEL[p.status]}
            {p.leaving_on && (days !== null && days < 0 ? ` · left ${fmtDay(p.leaving_on, { year: true })}` : ` · leaving ${fmtDay(p.leaving_on)}`)}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
            <span className="tnum text-ink-soft"><span className="font-semibold text-ink">{p.counts.cards}</span> cards</span>
            {p.counts.verified_cards > 0 && (
              <span className="tnum inline-flex items-center gap-1 text-sure"><BadgeCheck className="h-3.5 w-3.5" /> {p.counts.verified_cards} verified</span>
            )}
            <span className="text-ink-faint">{STATUS_LABEL[p.status]}</span>
          </div>
        </div>
        <CoverageRing value={p.coverage} size={52} stroke={4.5} compact />
        <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5" />
      </Link>
    </li>
  );
}
