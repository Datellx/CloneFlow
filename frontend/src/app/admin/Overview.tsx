import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BookOpen, Check, ChevronRight, Copy, Mail, MessageCircleQuestion, Sparkles, UserPlus, X } from "lucide-react";
import { useMe } from "@/lib/api";
import { cn } from "@/lib/format";
import { Button, Dialog, ErrorState, Field, LinkButton, Skeleton } from "@/components/ui";
import { CoverageRing, PersonAvatar, daysUntil, fmtDay } from "../../shared/bits";
import type { Employee } from "../../shared/types";
import type { OrgProfile, PlanUsage } from "../types";
import { handoverKeys, useOverview, useTeamsSetup, handover } from "../api";
import { useTitle } from "../orgs";

const STATUS: Record<Employee["status"], { label: string; cls: string }> = {
  not_started: { label: "Not started", cls: "bg-[#F4F0EE] text-ink-muted" },
  reading: { label: "Reading", cls: "bg-brand-50 text-brand-800" },
  read: { label: "Read, not interviewed", cls: "bg-maybe-bg text-[#7A4D0C]" },
  interviewing: { label: "In conversation", cls: "bg-brand-50 text-brand-800" },
  captured: { label: "Captured", cls: "bg-sure-bg text-sure" },
};

export default function Overview() {
  const q = useOverview();
  const me = useMe().data;
  useTitle("Overview");
  const [invite, setInvite] = useState(false);
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const leaving = (d?.people ?? []).filter((p) => !p.leaving_on || (daysUntil(p.leaving_on) ?? -1) >= 0).filter((p) => p.leaving_on || p.status !== "captured")
    .sort((a, b) => (a.leaving_on ?? "9999").localeCompare(b.leaving_on ?? "9999"));
  const leavingIds = new Set(leaving.map((p) => p.id));
  const left = (d?.people ?? []).filter((p) => !leavingIds.has(p.id));
  const invitedIds = new Set((d?.invites ?? []).map((i) => i.eid).filter(Boolean));
  const pending = (d?.invites ?? []).filter((i) => !i.accepted);
  const empty = !!d && !d.people.length && !d.invites.length;
  const packs = (d?.people ?? []).filter((p) => p.counts.cards > 0).length;
  const cards = (d?.people ?? []).reduce((t, p) => t + p.counts.cards, 0);

  return (
    <div>
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[13px] text-ink-muted">{d?.org.name ?? me?.org.name ?? " "}</p>
          <h1 className="mt-1 text-[34px] font-normal leading-tight text-ink sm:text-[40px]">{empty ? `Welcome${me ? `, ${me.user.name.split(" ")[0]}` : ""}` : "Overview"}</h1>
          <p className="mt-1 max-w-[60ch] text-[14.5px] text-ink-muted">
            {empty
              ? "Clone Flow is ready. When someone gives notice, invite them here. They get one private conversation; what they know lands in your knowledge base."
              : "Everyone leaving gets one private conversation with Clone Flow. What they know stays here for whoever comes next."}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <LinkButton to="/setup" variant="secondary" size="lg" icon={<Sparkles className="h-[18px] w-[18px]" />}>Add people by chat</LinkButton>
          <Button size="lg" icon={<UserPlus className="h-[18px] w-[18px]" />} onClick={() => setInvite(true)}>Invite someone who's leaving</Button>
        </div>
      </header>

      {d?.org.profile?.summary && <CompanyCard name={d.org.name} profile={d.org.profile} />}

      {d && <FirstRun hasPeople={d.people.length > 0 || d.invites.length > 0} onInvite={() => setInvite(true)} />}

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-8">
          <section aria-labelledby="h-departing">
            <h2 id="h-departing" className="mb-3 font-sans text-[14px] font-semibold text-ink">
              People leaving {d && leaving.length > 0 && <span className="tnum font-normal text-ink-muted">{leaving.length}</span>}
            </h2>
            {!d ? (
              <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[88px] rounded-2xl" />)}</div>
            ) : leaving.length ? (
              <ul className="space-y-3">{leaving.map((p) => <PersonRow key={p.id} p={p} invited={invitedIds.has(p.id) && pending.some((i) => i.eid === p.id)} />)}</ul>
            ) : (
              <div className="flex flex-col items-center rounded-2xl border border-dashed border-line-strong bg-white/60 px-6 py-12 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700"><UserPlus className="h-5 w-5" /></span>
                <h3 className="mt-4 font-sans text-[16px] font-semibold text-ink">Nobody is leaving right now</h3>
                <p className="mt-1.5 max-w-[46ch] text-[14px] text-ink-muted">
                  When someone hands in their notice, invite them. Their conversation takes about 20 minutes, and their progress shows up here.
                </p>
                <Button className="mt-5" variant="secondary" icon={<UserPlus className="h-4 w-4" />} onClick={() => setInvite(true)}>Invite someone who's leaving</Button>
              </div>
            )}
          </section>

          {pending.length > 0 && (
            <section>
              <h2 className="mb-1 font-sans text-[14px] font-semibold text-ink">Invitations not opened yet <span className="tnum font-normal text-ink-muted">{pending.length}</span></h2>
              <p className="mb-3 text-[12.5px] text-ink-muted">Resend the link if they can't find it.</p>
              <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
                {pending.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <PersonAvatar name={i.name || i.email} size={30} />
                    <div className="min-w-0 flex-1 leading-tight">
                      <div className="truncate text-[14px] font-medium text-ink">{i.name || i.email}</div>
                      <div className="truncate text-[12.5px] text-ink-muted">{i.email} · sent {fmtDay(i.created_at)}</div>
                    </div>
                    <a href={mailtoFor({ name: i.name || "", email: i.email, link: i.link, org: d?.org.name ?? "", from: me?.user.name ?? "" })}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] font-medium text-ink-soft hover:border-line-strong hover:text-ink">
                      <Mail className="h-3.5 w-3.5" /> Email
                    </a>
                    <CopyLink link={i.link} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {left.length > 0 && (
            <section>
              <h2 className="mb-3 font-sans text-[14px] font-semibold text-ink">Handovers finished <span className="tnum font-normal text-ink-muted">{left.length}</span></h2>
              <p className="-mt-2 mb-3 text-[12.5px] text-ink-muted">Their knowledge stays. Anyone can ask about their work in Teams or in Ask Clone Flow.</p>
              <ul className="space-y-3">{left.map((p) => <PersonRow key={p.id} p={p} quiet />)}</ul>
            </section>
          )}
        </div>

        <aside className="space-y-4">
          {d?.plan && <PlanCard plan={d.plan} allowance={d.ai_allowance} />}
          <Link to="/admin/knowledge" className="card flex items-center justify-between p-5 transition-colors hover:border-line-strong">
            <div>
              <div className="flex items-center gap-2 text-[14px] font-semibold text-ink"><BookOpen className="h-4 w-4 text-brand-700" /> Knowledge base</div>
              <div className="mt-0.5 text-[12.5px] text-ink-muted">{packs ? `${packs} ${packs === 1 ? "pack" : "packs"} · ${cards} cards` : "Fills up as handovers finish"}</div>
            </div>
            <ChevronRight className="h-4 w-4 text-ink-faint" />
          </Link>
          <div className="card p-5">
            <div className="flex items-center gap-2 text-[14px] font-semibold text-ink"><MessageCircleQuestion className="h-4 w-4 text-brand-700" /> Questions nobody could answer</div>
            <p className="mt-1 text-[12.5px] text-ink-muted">Asked in Teams or Ask Clone Flow, not covered yet. Good topics for the next handover.</p>
            {!d ? (
              <Skeleton className="mt-4 h-20" />
            ) : d.unanswered.length ? (
              <ul className="mt-3 space-y-2">
                {d.unanswered.map((u, i) => {
                  const q = typeof u === "string" ? u : u.question;
                  return (
                    <li key={`${i}-${q}`} className="rounded-lg bg-paper px-3 py-2 text-[13.5px] leading-snug text-ink-soft">{q}</li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-3 text-[13.5px] text-ink-muted">None so far.</p>
            )}
          </div>

        </aside>
      </div>
      <InviteDialog open={invite} onClose={() => setInvite(false)} org={d?.org.name ?? me?.org.name ?? ""} from={me?.user.name ?? ""} />
    </div>
  );
}

/* ------------------------------------------------------------------ what the setup assistant learned */
function CompanyCard({ name, profile }: { name: string; profile: OrgProfile }) {
  const chips = (label: string, items?: string[] | null) =>
    items?.length ? (
      <div>
        <div className="text-[12px] font-medium text-ink-muted">{label}</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {items.slice(0, 6).map((i) => <span key={i} className="rounded-full bg-brand-50 px-2.5 py-0.5 text-[12.5px] font-medium text-brand-800">{i}</span>)}
        </div>
      </div>
    ) : null;
  return (
    <section className="card mb-8 grid gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]" aria-label={`About ${name}`}>
      <div>
        <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-700">Tailored to {name}</div>
        <p className="mt-2 text-[15px] leading-relaxed text-ink">{profile.summary}</p>
        <Link to="/setup" className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-brand-700 hover:underline">
          Update with the assistant <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <div className="space-y-4">
        {chips("Every interview focuses on", profile.critical_areas)}
        {chips("Where your people work", profile.tools)}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ plan and trial */
function PlanCard({ plan, allowance }: { plan: PlanUsage; allowance?: { cap_usd: number; spent_usd: number; reached: boolean } }) {
  const usedPct = Math.min(100, Math.round((plan.used / Math.max(plan.employees, 1)) * 100));
  const aiPct = allowance && allowance.cap_usd > 0 ? Math.min(100, Math.round((allowance.spent_usd / allowance.cap_usd) * 100)) : null;
  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between">
        <div className="text-[14px] font-semibold text-ink">{plan.name} plan</div>
        <Link to="/admin/settings" className="text-[12.5px] font-medium text-brand-700 hover:underline">Plans</Link>
      </div>
      <div className="mt-3 flex items-baseline justify-between text-[12.5px]">
        <span className="text-ink-soft">People leaving</span>
        <span className="tnum text-ink-muted">{plan.used} of {plan.employees}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-brand-50" aria-hidden>
        <div className={cn("h-full rounded-full", plan.left === 0 ? "bg-[#9B1C1C]" : "bg-brand-700")} style={{ width: `${usedPct}%` }} />
      </div>
      {aiPct !== null && (
        <>
          <div className="mt-3 flex items-baseline justify-between text-[12.5px]">
            <span className="text-ink-soft">Free trial</span>
            <span className="tnum text-ink-muted">{aiPct}% used</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-brand-50" role="progressbar" aria-valuenow={aiPct} aria-valuemin={0} aria-valuemax={100} aria-label="Trial used">
            <div className={cn("h-full rounded-full", allowance?.reached ? "bg-[#9B1C1C]" : "bg-brand-700")} style={{ width: `${aiPct}%` }} />
          </div>
        </>
      )}
      <p className="mt-3 text-[12.5px] leading-snug text-ink-muted">
        {allowance?.reached || plan.left === 0 ? (
          <>You've reached the {allowance?.reached ? "trial limit" : "plan limit"}. <a className="font-medium text-brand-700 hover:underline" href="mailto:hello@datellx.com?subject=Clone%20Flow%20plan">Contact us</a> to keep going.</>
        ) : (
          `${plan.left} more ${plan.left === 1 ? "person" : "people"} on this plan.`
        )}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ first run */
const DISMISS = "cf.firstrun.dismissed";
const readFlag = (k: string) => {
  try {
    return localStorage.getItem(k) === "1";
  } catch {
    return false;
  }
};
const writeFlag = (k: string) => {
  try {
    localStorage.setItem(k, "1");
  } catch {
    /* storage blocked */
  }
};

function FirstRun({ hasPeople, onInvite }: { hasPeople: boolean; onInvite: () => void }) {
  const teams = useTeamsSetup();
  const [dismissed, setDismissed] = useState(() => readFlag(DISMISS));
  const items = [
    { done: hasPeople, title: "Invite the first person who's leaving", body: "They get a private link to a 20-minute conversation.", action: <Button size="sm" onClick={onInvite}>Invite</Button> },
    { done: !!teams.data?.configured, title: "Connect Microsoft Teams", body: "So everyone can ask @Clone Flow in a channel.", action: <LinkButton to="/admin/teams" size="sm" variant="secondary">Connect</LinkButton> },
  ];
  const done = items.filter((i) => i.done).length;
  if (dismissed || done === items.length) return null;
  return (
    <section className="card mb-8 overflow-hidden" aria-labelledby="h-firstrun">
      <div className="flex items-center gap-4 border-b border-line px-5 py-4 sm:px-6">
        <div className="min-w-0 flex-1">
          <h2 id="h-firstrun" className="font-sans text-[15px] font-semibold text-ink">Get set up</h2>
          <p className="text-[12.5px] text-ink-muted">{done} of {items.length} done</p>
        </div>
        <div className="hidden h-1.5 w-40 overflow-hidden rounded-full bg-brand-50 sm:block" aria-hidden>
          <div className="h-full rounded-full bg-brand-700 transition-all" style={{ width: `${(done / items.length) * 100}%` }} />
        </div>
        <button onClick={() => { writeFlag(DISMISS); setDismissed(true); }} className="rounded-lg p-1.5 text-ink-muted hover:bg-paper hover:text-ink" aria-label="Hide the setup checklist">
          <X className="h-4 w-4" />
        </button>
      </div>
      <ol className="divide-y divide-line">
        {items.map((it, i) => (
          <li key={it.title} className="flex items-center gap-4 px-5 py-4 sm:px-6">
            <span className={cn("tnum flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12.5px] font-semibold", it.done ? "bg-sure-bg text-sure" : "bg-paper text-ink-soft ring-1 ring-inset ring-line-strong")}>
              {it.done ? <Check className="h-4 w-4" /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className={cn("text-[14.5px] font-medium", it.done ? "text-ink-muted line-through decoration-ink-faint" : "text-ink")}>{it.title}</div>
              <div className="text-[12.5px] text-ink-muted">{it.body}</div>
            </div>
            {!it.done && <div className="shrink-0">{it.action}</div>}
          </li>
        ))}
      </ol>
    </section>
  );
}

function PersonRow({ p, quiet, invited }: { p: Employee; quiet?: boolean; invited?: boolean }) {
  const days = daysUntil(p.leaving_on);
  const st = invited && p.status === "not_started" ? { label: "Invited", cls: "bg-paper text-ink-muted ring-1 ring-inset ring-line" } : STATUS[p.status] ?? STATUS.not_started;
  return (
    <li>
      <Link
        to={`/admin/people/${p.id}`}
        className={cn("group flex items-center gap-4 rounded-2xl border border-line bg-white px-4 py-4 shadow-card transition-colors hover:border-line-strong sm:px-5", quiet && "shadow-none")}
      >
        <PersonAvatar name={p.name} color={p.avatar_color} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="text-[15.5px] font-semibold text-ink">{p.name}</span>
            <span className={cn("rounded-full px-2 py-0.5 text-[12px] font-medium", st.cls)}>{st.label}</span>
          </div>
          <div className="mt-0.5 truncate text-[13px] text-ink-muted">
            {p.title}
            {p.leaving_on && (
              <>
                {" · "}
                <span className={cn(!quiet && days !== null && days <= 30 && "font-medium text-brand-700")}>
                  {days !== null && days < 0 ? `Left ${fmtDay(p.leaving_on, { year: true })}` : `Leaving ${fmtDay(p.leaving_on)}${days !== null ? ` · ${days} days` : ""}`}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="hidden text-right text-[12.5px] leading-tight text-ink-muted sm:block">
          <div className="tnum text-[14px] font-medium text-ink">{p.counts.cards}</div>cards
        </div>
        <CoverageRing value={p.coverage} size={52} stroke={4.5} compact />
        <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5" />
      </Link>
    </li>
  );
}

function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() =>
        navigator.clipboard?.writeText(link).then(
          () => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          },
          () => toast.error("Couldn't copy. Select the link and copy it yourself."),
        )
      }
      className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] font-medium text-ink-soft hover:border-line-strong hover:text-ink"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-sure" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy link"}
    </button>
  );
}

function mailtoFor({ name, email, link, org, from }: { name: string; email: string; link: string; org: string; from: string }) {
  const first = name.trim().split(/\s+/)[0] || "there";
  const subject = `Your handover with Clone Flow${org ? ` at ${org}` : ""}`;
  const body = [
    `Hi ${first},`,
    "",
    "Before you go, I'd like you to hand over what you know with Clone Flow. It's one conversation of about 20 minutes: you connect your work email and Teams, and it asks only about the things that were never written down. Personal messages are set aside and never read.",
    "",
    `Start here: ${link}`,
    "",
    "Thank you,",
    from,
  ].join("\n");
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function InviteDialog({ open, onClose, org, from }: { open: boolean; onClose: () => void; org: string; from: string }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: "", email: "", title: "", leaving_on: "", focus: "" });
  const [loading, setLoading] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [emailed, setEmailed] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const close = () => {
    onClose();
    window.setTimeout(() => {
      setF({ name: "", email: "", title: "", leaving_on: "", focus: "" });
      setLink(null);
      setErr(null);
    }, 250);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    try {
      const r = await handover.invite({ name: f.name.trim(), email: f.email.trim(), title: f.title.trim() || undefined, leaving_on: f.leaving_on || undefined, focus: f.focus.trim() || undefined });
      setLink(r.link);
      setEmailed(!!r.emailed);
      qc.invalidateQueries({ queryKey: handoverKeys.overview });
      qc.invalidateQueries({ queryKey: ["kb", "employees"] });
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setLoading(false);
    }
  };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const first = f.name.trim().split(/\s+/)[0];
  return (
    <Dialog
      open={open}
      onClose={close}
      title={link ? `${first ? `${first}'s` : "Their"} invitation is ready` : "Invite someone who's leaving"}
      description={
        link
          ? emailed
            ? `We emailed the invitation to ${f.email || "them"}. You can also send this link yourself.`
            : "Send it however you like. It opens their private handover conversation in the browser."
          : "They get one private conversation with Clone Flow. You'll see their knowledge pack as it's saved."
      }
    >
      {link ? (
        <div className="pb-3">
          <div className="flex items-center gap-2 rounded-xl border border-line bg-paper p-2 pl-3">
            <code className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink">{link}</code>
            <CopyLink link={link} />
          </div>
          <ul className="mt-5 space-y-2.5 text-[13.5px] text-ink-soft">
            {["They choose a password and start the conversation.", "They connect Outlook and Teams; personal messages are set aside.", "Their knowledge pack appears in your knowledge base as it's saved."].map((t, i) => (
              <li key={t} className="flex gap-2.5"><span className="tnum flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[11px] font-semibold text-brand-800">{i + 1}</span>{t}</li>
            ))}
          </ul>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={close}>Done</Button>
            <a href={mailtoFor({ name: f.name, email: f.email, link, org, from })} className="inline-flex h-10 items-center justify-center gap-2 rounded-[10px] bg-brand-700 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-800">
              <Mail className="h-4 w-4" /> Email it to {first || "them"}
            </a>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4 pb-3">
          <Field label="Name" htmlFor="inv-name">
            <input id="inv-name" className="input" value={f.name} onChange={set("name")} required autoComplete="off" />
          </Field>
          <Field label="Work email" htmlFor="inv-email">
            <input id="inv-email" type="email" className="input" value={f.email} onChange={set("email")} required autoComplete="off" placeholder="name@company.com" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Title" htmlFor="inv-title">
              <input id="inv-title" className="input" value={f.title} onChange={set("title")} placeholder="Optional" />
            </Field>
            <Field label="Last day" htmlFor="inv-date">
              <input id="inv-date" type="date" className="input" value={f.leaving_on} onChange={set("leaving_on")} />
            </Field>
          </div>
          <Field label="What should we make sure to capture?" htmlFor="inv-focus" hint="Optional. Clone Flow brings it up in their conversation.">
            <textarea id="inv-focus" rows={2} className="input !h-auto py-2" value={f.focus} onChange={(e) => setF({ ...f, focus: e.target.value })}
              placeholder="e.g. the supplier contracts and how month-end close works" />
          </Field>
          {err && <p role="alert" className="rounded-lg border border-[#F0D5D5] bg-[#FFF8F8] px-3 py-2 text-sm text-[#9B1C1C]">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={close}>Cancel</Button>
            <Button type="submit" loading={loading}>Create invitation link</Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
