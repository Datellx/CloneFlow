import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation, useSearchParams } from "react-router-dom";
import { Building2, ChevronDown, LogOut, Mic, Users } from "lucide-react";
import { ApiError, useMe } from "@/lib/api";
import { cn } from "@/lib/format";
import { Logo } from "@/components/domain";
import { ErrorState } from "@/components/ui";
import { useEmployees } from "../../shared/api";
import { PersonAvatar } from "../../shared/bits";
import { Orb } from "../../shared/Orb";
import { AskView } from "../../shared/routes/Ask";
import type { Employee } from "../../shared/types";
import { signInPath, useSignOut, useTitle } from "../orgs";

/* ------------------------------------------------------------------ target picker */
/** "Everyone" (eid null) or one person's pack. */
function TargetPicker({ eid, people, onChange }: { eid: number | null; people: Employee[]; onChange: (eid: number | null) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const cur = people.find((p) => p.id === eid);
  const withPacks = people.filter((p) => p.counts.cards > 0);
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Who to ask"
        className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-white pl-2 pr-3 text-[13.5px] font-medium text-ink hover:border-line-strong"
      >
        {cur ? <PersonAvatar name={cur.name} color={cur.avatar_color} size={26} /> : <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-brand-50 text-brand-700"><Users className="h-3.5 w-3.5" /></span>}
        <span className="max-w-[160px] truncate">{cur ? cur.name : "Everyone"}</span>
        <ChevronDown className="h-4 w-4 text-ink-faint" />
      </button>
      {open && (
        <div role="listbox" className="absolute right-0 top-full z-40 mt-1.5 max-h-[60vh] w-[280px] overflow-y-auto rounded-xl border border-line bg-white py-1 shadow-lift">
          <Option active={eid === null} onClick={() => { onChange(null); setOpen(false); }} icon={<span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-50 text-brand-700"><Users className="h-4 w-4" /></span>} title="Everyone" sub="Every captured pack" />
          <div className="px-3 pb-1 pt-2 text-[11.5px] font-medium text-ink-muted">One person's knowledge</div>
          {withPacks.map((p) => (
            <Option key={p.id} active={eid === p.id} onClick={() => { onChange(p.id); setOpen(false); }} icon={<PersonAvatar name={p.name} color={p.avatar_color} size={28} />} title={p.name} sub={`${p.title} · ${p.counts.cards} cards`} />
          ))}
        </div>
      )}
    </div>
  );
}
function Option({ active, onClick, icon, title, sub }: { active: boolean; onClick: () => void; icon: React.ReactNode; title: string; sub: string }) {
  return (
    <button role="option" aria-selected={active} onClick={onClick} className={cn("flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-paper", active && "bg-brand-50/60")}>
      {icon}
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-[13.5px] font-medium text-ink">{title}</span>
        <span className="block truncate text-[11.5px] text-ink-muted">{sub}</span>
      </span>
    </button>
  );
}

function useTarget() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("eid");
  const eid = raw ? Number(raw) || null : null;
  const set = (next: number | null, mode?: "takeover" | "question") => {
    const p = new URLSearchParams();
    if (next) p.set("eid", String(next));
    if (next) p.set("mode", mode ?? "question");
    setParams(p, { replace: true });
  };
  return [eid, set] as const;
}

/* ------------------------------------------------------------------ admin: Ask Clone */
export function AdminAsk() {
  const me = useMe().data;
  useTitle("Ask Clone Flow");
  const emps = useEmployees();
  const [eid, setEid] = useTarget();
  return (
    <AskView
      eid={eid}
      fill
      orgName={me?.org.name}
      interviewHref={null}
      picker={<TargetPicker eid={eid} people={emps.data ?? []} onChange={(e) => setEid(e)} />}
    />
  );
}

/* ------------------------------------------------------------------ /ask: any colleague in the organization */
export function AskPage() {
  const me = useMe();
  const loc = useLocation();
  const emps = useEmployees();
  const [eid, setEid] = useTarget();
  const signOutTo = useSignOut();
  useTitle(me.data ? `Ask Clone Flow · ${me.data.org.name}` : "Ask Clone Flow");
  if (me.isLoading)
    return <div className="flex min-h-screen items-center justify-center bg-paper"><Orb size={88} state="thinking" /></div>;
  if (me.error instanceof ApiError && me.error.status === 401) return <Navigate to={signInPath(loc.pathname + loc.search)} replace />;
  if (me.error) return <div className="p-8"><ErrorState error={me.error} onRetry={() => me.refetch()} /></div>;
  const m = me.data!;
  const people = emps.data ?? [];
  const signOut = () => signOutTo(m.org.slug);
  return (
    <div className="flex h-[100dvh] flex-col bg-paper">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-white px-4 sm:px-6">
        <Logo to="/ask" />
        <span className="ml-1 hidden h-5 w-px bg-line sm:block" aria-hidden />
        <span className="hidden truncate text-[13.5px] font-medium text-ink-soft sm:block">{m.org.name}</span>
        <div className="ml-auto flex items-center gap-1">
          {m.is_admin && (
            <Link to="/admin" className="hidden items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-ink-soft hover:bg-paper sm:inline-flex"><Building2 className="h-4 w-4" /> Company console</Link>
          )}
          {m.owned_clone_ids.length > 0 && (
            <Link to="/session" className="hidden items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-ink-soft hover:bg-paper sm:inline-flex"><Mic className="h-4 w-4" /> My handover</Link>
          )}
          <span className="mx-2 hidden text-[13.5px] text-ink-muted sm:inline">{m.user.name}</span>
          <button onClick={signOut} className="rounded-lg p-2 text-ink-soft hover:bg-paper" aria-label="Sign out" title="Sign out"><LogOut className="h-5 w-5" /></button>
        </div>
      </header>
      <div className="min-h-0 flex-1">
        <AskView
          eid={eid}
          fill
          orgName={m.org.name}
          interviewHref={null}
          picker={<TargetPicker eid={eid} people={people} onChange={(e) => setEid(e)} />}
        />
      </div>
    </div>
  );
}
