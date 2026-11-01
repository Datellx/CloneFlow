import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldAlert, ShieldCheck, CircleDot } from "lucide-react";
import { cn } from "@/lib/format";
import { Button, ErrorState, Skeleton } from "@/components/ui";
import { useMap } from "../api";
import { PersonAvatar, ProofChip, firstName, fmtDay, daysUntil } from "../bits";
import type { KnowledgeMap } from "../types";

// Sequential burgundy ramp for "captured" cells, light to dark by card count.
const RAMP = ["#F6E3E8", "#ECC6D0", "#DE9DAE", "#AE4463", "#7A1E3A"];
function rampFor(cards: number) {
  if (cards <= 2) return RAMP[0];
  if (cards <= 4) return RAMP[1];
  if (cards <= 6) return RAMP[2];
  if (cards <= 9) return RAMP[3];
  return RAMP[4];
}
const HATCH = "repeating-linear-gradient(135deg, #F3EEEC 0 6px, #E9E1DE 6px 8px)";

export default function KnowledgeMapPage({ personHref = (eid: number) => `/app/e/${eid}/exit` }: { personHref?: (eid: number) => string } = {}) {
  const q = useMap();
  const nav = useNavigate();
  const d = q.data;
  const next = useMemo(() => (d ? nextToCapture(d) : null), [d]);
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!d)
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-[640px] max-w-full" />
        <Skeleton className="h-5 w-[420px] max-w-full" />
        <Skeleton className="mt-6 h-[360px] w-full rounded-2xl" />
      </div>
    );
  if (!d.cells.length)
    return (
      <div>
        <h1 className="text-[34px] font-normal leading-tight text-ink sm:text-[40px]">Knowledge map</h1>
        <p className="mt-1 max-w-[62ch] text-[14.5px] text-ink-muted">Who knows what, and which areas only one person holds.</p>
        <div className="mt-8 flex flex-col items-center rounded-2xl border border-dashed border-line-strong bg-white/60 px-6 py-14 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700"><CircleDot className="h-5 w-5" /></span>
          <h2 className="mt-4 font-sans text-[16px] font-semibold text-ink">The map draws itself as handovers are captured</h2>
          <p className="mt-1.5 max-w-[52ch] text-[14px] text-ink-muted">
            Each knowledge area someone covers shows up here, so you can see what's safe and what only one person still holds.
          </p>
        </div>
      </div>
    );
  const sole = d.at_risk.length;
  const uncaptured = d.at_risk.filter((r) => !r.captured).length;

  return (
    <div>
      <header className="mb-9 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-[46rem]">
          <h1 className="text-[36px] font-normal leading-[1.08] text-ink sm:text-[44px]">Protect what your team knows before people leave.</h1>
          <p className="mt-3 text-[15.5px] leading-relaxed text-ink-muted">
            {sole} knowledge areas are held by only one person. {uncaptured === 0 ? "All of them are captured." : `${uncaptured} ${uncaptured === 1 ? "has" : "have"} never been captured.`}
          </p>
        </div>
        {next && (
          <Button size="lg" className="shrink-0" onClick={() => nav(personHref(next.eid))}>
            Capture {firstName(next.name)}'s knowledge
          </Button>
        )}
      </header>

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* matrix */}
        <section className="card overflow-hidden" aria-labelledby="matrix-h">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
            <h2 id="matrix-h" className="font-sans text-[15px] font-semibold text-ink">Who knows what</h2>
            <Legend />
          </div>
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full border-separate border-spacing-0 text-left">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 w-[240px] min-w-[200px] bg-white px-5 py-3 text-[12.5px] font-medium text-ink-muted">Person</th>
                  {d.areas.map((a) => (
                    <th key={a} className="px-1.5 py-3 text-center align-bottom text-[12.5px] font-medium leading-tight text-ink-muted">
                      <span className="mx-auto block max-w-[84px]">{a}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.people.map((p) => {
                  const left = p.leaving_on && (daysUntil(p.leaving_on) ?? 0) < 0;
                  const leaving = p.leaving_on && !left;
                  return (
                    <tr key={p.eid} className="group">
                      <th scope="row" className="sticky left-0 z-10 border-t border-line bg-white px-5 py-2.5 font-normal group-hover:bg-paper">
                        <button onClick={() => nav(personHref(p.eid))} className="flex items-center gap-3 text-left">
                          <PersonAvatar name={p.name} size={30} className={cn(left && "grayscale opacity-70")} />
                          <span className="min-w-0 leading-tight">
                            <span className={cn("block truncate text-[14px] font-medium", left ? "text-ink-muted" : "text-ink")}>{p.name.replace(/\s*\(.*\)/, "")}</span>
                            <span className="block truncate text-[12px] text-ink-muted">
                              {left ? `Left ${fmtDay(p.leaving_on, { year: true })}` : leaving ? <span className="font-medium text-brand-700">Leaving {fmtDay(p.leaving_on)}</span> : p.title}
                            </span>
                          </span>
                        </button>
                      </th>
                      {d.areas.map((a) => {
                        const c = d.cells.find((x) => x.eid === p.eid && x.area === a);
                        return (
                          <td key={a} className="border-t border-line px-1.5 py-2 text-center group-hover:bg-paper">
                            <Cell c={c} area={a} person={p.name} />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* side */}
        <div className="grid gap-6 lg:grid-cols-2 2xl:flex 2xl:flex-col">
          <section className="card p-5" aria-labelledby="risk-h">
            <h2 id="risk-h" className="font-sans text-[15px] font-semibold text-ink">At risk</h2>
            <p className="mb-3.5 mt-0.5 text-[13px] text-ink-muted">Knowledge only one person holds</p>
            <ul className="space-y-2">
              {d.at_risk.map((r) => (
                <li key={r.area + r.holder} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5">
                  {r.captured ? <ShieldCheck className="h-[18px] w-[18px] shrink-0 text-sure" /> : <ShieldAlert className="h-[18px] w-[18px] shrink-0 text-[#9B1C1C]" />}
                  <div className="min-w-0 flex-1 leading-tight">
                    <div className="truncate text-[14px] font-medium text-ink">{r.area}</div>
                    <div className="truncate text-[12.5px] text-ink-muted">{r.holder}</div>
                  </div>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", r.captured ? "bg-sure-bg text-sure" : "bg-[#FBEDEC] text-[#9B1C1C]")}>
                    {r.captured ? "Captured" : "Not captured"}
                  </span>
                </li>
              ))}
            </ul>
          </section>

        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="card p-5" aria-labelledby="cov-h">
          <h2 id="cov-h" className="font-sans text-[15px] font-semibold text-ink">Coverage by person</h2>
          <p className="mb-4 mt-0.5 text-[13px] text-ink-muted">How much of each person's work Clone Flow can answer for</p>
          <ul className="space-y-3.5">
            {d.people.map((p) => (
              <li key={p.eid} className="grid grid-cols-[150px_minmax(0,1fr)_44px] items-center gap-3">
                <span className="truncate text-[13.5px] text-ink">{p.name.replace(/\s*\(.*\)/, "")}</span>
                <div className="h-2 overflow-hidden rounded-full bg-[#F1E6E8]">
                  <div className="h-full rounded-full bg-brand-700 transition-[width] duration-700" style={{ width: `${p.coverage}%` }} />
                </div>
                <span className={cn("tnum text-right text-[13px] font-medium", p.coverage ? "text-ink" : "text-ink-faint")}>{p.coverage}%</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="card p-5" aria-labelledby="orph-h">
          <h2 id="orph-h" className="font-sans text-[15px] font-semibold text-ink">Orphaned open tasks</h2>
          <p className="mb-4 mt-0.5 text-[13px] text-ink-muted">Unfinished work whose owner is leaving or gone</p>
          {d.orphaned_tasks.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-[13.5px] text-ink-muted">No orphaned tasks. Every open task has an owner.</p>
          ) : (
            <ul className="space-y-3">
              {d.orphaned_tasks.map((t) => (
                <li key={t.id} className="flex gap-3">
                  <CircleDot className="mt-0.5 h-4 w-4 shrink-0 text-[#9B1C1C]" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-medium leading-snug text-ink">{t.title}</div>
                    <div className="mt-0.5 text-[12.5px] text-ink-muted">{t.project ?? "No project"}{t.related_people.length ? ` · with ${t.related_people.join(", ")}` : ""}</div>
                    {t.sources[0] && <div className="mt-1.5"><ProofChip proof={t.sources[0]} /></div>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Cell({ c, area, person }: { c: KnowledgeMap["cells"][number] | undefined; area: string; person: string }) {
  const base = "mx-auto flex h-10 w-full min-w-[56px] max-w-[96px] items-center justify-center rounded-lg text-[12.5px] font-semibold";
  if (!c) return <span className={cn(base, "text-ink-faint")} aria-label={`${person}: nothing on ${area}`}><span className="h-1 w-1 rounded-full bg-line-strong" /></span>;
  const outline = c.sole_holder ? "ring-2 ring-offset-1 ring-brand-700" : "";
  const label = `${person}, ${area}: ${c.captured ? `${c.cards} cards captured, ${c.verified} verified` : "not captured"}${c.sole_holder ? ", only holder" : ""}`;
  if (!c.captured)
    return (
      <span className={cn(base, outline, "text-ink-muted")} style={{ background: HATCH }} title={label} aria-label={label}>
        {c.cards > 0 ? c.cards : ""}
      </span>
    );
  const bg = rampFor(c.cards);
  const dark = c.cards > 6;
  return (
    <span className={cn(base, outline, dark ? "text-white" : "text-brand-900")} style={{ background: bg }} title={label} aria-label={label}>
      <span className="tnum">{c.cards}</span>
    </span>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-ink-muted">
      <span className="flex items-center gap-1.5">
        <span className="flex overflow-hidden rounded">{RAMP.map((c) => <span key={c} className="h-3 w-3" style={{ background: c }} />)}</span>
        Captured cards
      </span>
      <span className="flex items-center gap-1.5"><span className="h-3 w-4 rounded" style={{ background: HATCH }} /> Not captured</span>
      <span className="flex items-center gap-1.5"><span className="h-3 w-4 rounded ring-2 ring-brand-700" /> Only holder</span>
    </div>
  );
}

function nextToCapture(d: KnowledgeMap) {
  const active = d.people.filter((p) => !(p.leaving_on && (daysUntil(p.leaving_on) ?? 0) < 0));
  const notCaptured = active.filter((p) => p.coverage === 0);
  const score = (eid: number) => d.cells.filter((c) => c.eid === eid && !c.captured).length;
  return notCaptured.sort((a, b) => score(b.eid) - score(a.eid))[0] ?? null;
}
