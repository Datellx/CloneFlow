// /setup — the admin's setup conversation (right after "Create your organization"). The assistant asks about the
// organization; the panel on the right fills in as it learns, and people mentioned in the chat get invitations.
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { ArrowRight, ArrowUp, Check, Copy, Loader2, Mic, Square, Volume2, VolumeX } from "lucide-react";
import { ApiError, qk, useMe } from "@/lib/api";
import { cn } from "@/lib/format";
import { Logo } from "@/components/domain";
import { Button } from "@/components/ui";
import { Orb } from "../shared/Orb";
import { Caption, useInterviewer } from "../shared/voiceHooks";
import { handover, handoverKeys, useSetup } from "./api";
import { useTitle } from "./orgs";
import { useSpeechInput } from "./useSpeechInput";
import type { OrgProfile, PlanUsage, SetupMsg, SetupState } from "./types";

export default function Setup() {
  useTitle("Set up your organization");
  const me = useMe();
  const q = useSetup();
  if (me.isLoading || q.isLoading) return <Center><Loader2 className="h-5 w-5 animate-spin text-ink-muted" /></Center>;
  if (!me.data) return <Navigate to="/login?next=/setup" replace />;
  if (!me.data.is_admin) return <Navigate to={me.data.home ?? "/session"} replace />;
  if (q.error || !q.data) return <Center><p className="text-ink-muted">{(q.error as Error)?.message ?? "Couldn't load setup."}</p></Center>;
  return <SetupChat initial={q.data} first={me.data.user.name.split(" ")[0]} />;
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-paper">{children}</div>;
}

function SetupChat({ initial, first }: { initial: SetupState; first: string }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const ai = useInterviewer();
  const speech = useSpeechInput();
  const [msgs, setMsgs] = useState<SetupMsg[]>(initial.messages);
  const [profile, setProfile] = useState<OrgProfile>(initial.profile);
  const [plan, setPlan] = useState<PlanUsage>(initial.plan);
  const [done, setDone] = useState(initial.done);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const lastAssistant = useMemo(() => [...msgs].reverse().find((m) => m.role === "assistant" && !m.payload?.invites), [msgs]);
  // The assistant's newest words are the caption under the orb; everything before (and invitations) is history.
  const history = useMemo(() => {
    const lastUser = msgs.map((m) => m.role).lastIndexOf("user");
    if (lastUser < 0) return [];
    return [...msgs.slice(0, lastUser + 1), ...msgs.slice(lastUser + 1).filter((m) => m.payload?.invites || m.payload?.problem)];
  }, [msgs]);
  const invites = useMemo(() => msgs.flatMap((m) => m.payload?.invites ?? []), [msgs]);

  // Speak the newest assistant line (the greeting is two lines: say both).
  const spokenId = useRef<number | null>(null);
  useEffect(() => {
    if (!lastAssistant || spokenId.current === lastAssistant.id) return;
    const first = spokenId.current === null;
    spokenId.current = lastAssistant.id;
    const lines = first ? msgs.filter((m) => m.role === "assistant").slice(-2).map((m) => m.text).join(" ") : lastAssistant.text;
    void ai.say(lines);
  }, [lastAssistant]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs.length]);

  const send = async (raw: string) => {
    const t = raw.trim();
    if (!t || busy) return;
    ai.interrupt();
    setBusy(true);
    setText("");
    const temp: SetupMsg = { id: -Date.now(), role: "user", text: t, payload: null, at: null };
    setMsgs((m) => [...m, temp]);
    try {
      const r = await handover.setupMessage(t);
      setMsgs((m) => [...m.filter((x) => x.id !== temp.id), { ...temp, id: temp.id }, ...r.messages.filter((x) => x.role !== "user")]);
      setProfile(r.profile);
      setPlan(r.plan);
      setDone(r.done);
      qc.invalidateQueries({ queryKey: handoverKeys.overview });
    } catch (e) {
      setMsgs((m) => m.filter((x) => x.id !== temp.id));
      setText(t);
      toast.error(e instanceof ApiError ? e.message : "That didn't go through. Try again.");
    } finally {
      setBusy(false);
      window.setTimeout(() => inputRef.current?.focus(), 30);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send(text);
  };
  const toggleMic = async () => {
    if (!listening) {
      ai.interrupt();
      speech.start();
      setListening(true);
      return;
    }
    setListening(false);
    const said = await speech.stop();
    if (said) void send(said);
    else toast("I didn't catch that. Try again or type it.");
  };
  const finish = async (skipped = false) => {
    try {
      await handover.setupFinish(skipped);
    } catch {
      /* the console opens either way */
    }
    qc.invalidateQueries({ queryKey: qk.me });
    qc.invalidateQueries({ queryKey: handoverKeys.overview });
    nav("/admin", { replace: true });
  };

  return (
    <div className="flex h-[100dvh] flex-col bg-paper">
      <header className="titlebar-drag flex h-16 shrink-0 items-center gap-3 px-4 sm:px-6">
        <Logo to="/admin" />
        <span className="hidden text-[13px] text-ink-muted sm:inline">· Setting up {initial.org}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={ai.toggleMute} className="rounded-lg p-2 text-ink-soft hover:bg-white" aria-pressed={ai.muted} aria-label={ai.muted ? "Turn voice on" : "Turn voice off"}>
            {ai.muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </button>
          {!done && (
            <button onClick={() => finish(true)} className="rounded-lg px-3 py-2 text-[13.5px] font-medium text-ink-muted hover:bg-white hover:text-ink">
              Skip for now
            </button>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex w-full max-w-[680px] flex-col items-center px-5 pb-6 pt-6 text-center sm:pt-10">
              <Orb state={busy ? "thinking" : listening ? "listening" : ai.orb} pulse={ai.pulse} size={124} />
              <div aria-live="polite" className="w-full">
                <Caption text={ai.caption || lastAssistant?.text || ""} spoken={ai.caption ? ai.spoken : Infinity}
                  className="mx-auto mt-4 max-w-[32ch] text-balance font-display text-[23px] leading-[1.3] text-ink sm:text-[26px]" />
              </div>
              {listening && <p className="mt-3 text-[14px] italic text-ink-muted">{speech.interim ? `“${speech.interim}”` : "Listening…"}</p>}

              <ol className="mt-8 w-full space-y-3 text-left">
                {history.filter((m) => m.text).map((m) => <Bubble key={m.id} m={m} />)}
                {busy && <li className="flex"><span className="rounded-2xl bg-white px-4 py-2.5 text-[14px] text-ink-muted shadow-card ring-1 ring-line"><Loader2 className="inline h-3.5 w-3.5 animate-spin" /> Thinking</span></li>}
              </ol>
              <div ref={endRef} />

              <AnimatePresence>
                {done && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-6 flex flex-col items-center gap-2">
                    <Button size="lg" onClick={() => finish(false)} className="!rounded-full !px-8" icon={<ArrowRight className="h-4 w-4" />}>
                      Open my console
                    </Button>
                    <span className="text-[12.5px] text-ink-muted">You can talk to me again any time from the console.</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <form onSubmit={submit} className="shrink-0 px-4 pb-5 pt-2 sm:pb-7">
            <div className="mx-auto flex w-full max-w-[640px] items-end gap-2 rounded-[26px] border border-line-strong bg-white p-1.5 pl-4 shadow-lift focus-within:border-brand-600">
              <textarea
                ref={inputRef}
                rows={1}
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send(text);
                  }
                }}
                placeholder={done ? "Add someone who's leaving, or tell me more…" : `Reply to Clone Flow, ${first}…`}
                aria-label="Your reply"
                className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent py-2 text-[15.5px] text-ink placeholder:text-ink-faint focus:outline-none"
              />
              {speech.supported && (
                <button type="button" onClick={toggleMic} disabled={busy}
                  className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors", listening ? "bg-brand-800 text-white" : "text-ink-soft hover:bg-paper")}
                  aria-label={listening ? "Stop and send" : "Talk"} aria-pressed={listening}>
                  {listening ? <Square className="h-4 w-4 fill-current" /> : <Mic className="h-5 w-5" />}
                </button>
              )}
              <Button type="submit" disabled={!text.trim() || busy} className="!h-10 !w-10 shrink-0 !rounded-full !p-0" aria-label="Send">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-[18px] w-[18px]" />}
              </Button>
            </div>
            {!initial.ai_ready && <p className="mt-2 text-center text-[12.5px] text-ink-muted">The assistant is offline right now. You can skip and set things up from the console.</p>}
          </form>
        </main>

        <PortalPanel org={initial.org} profile={profile} plan={plan} invites={invites} />
      </div>
    </div>
  );
}

function Bubble({ m }: { m: SetupMsg }) {
  const mine = m.role === "user";
  return (
    <li className={cn("flex", mine && "justify-end")}>
      <div className={cn("max-w-[85%] rounded-2xl px-4 py-2.5 text-[14.5px] leading-relaxed",
        mine ? "bg-brand-700 text-white" : m.payload?.problem ? "bg-[#FFF8F8] text-[#9B1C1C] ring-1 ring-[#F0D5D5]" : "bg-white text-ink shadow-card ring-1 ring-line")}>
        {m.text}
        {m.payload?.invites?.map((i) => <InviteLink key={i.link} name={i.name} link={i.link} />)}
      </div>
    </li>
  );
}

function InviteLink({ name, link }: { name: string; link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2 flex items-center gap-2 rounded-lg bg-paper p-1.5 pl-2.5 ring-1 ring-inset ring-line">
      <span className="shrink-0 text-[12px] font-medium text-ink">{name}</span>
      <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-soft">{link}</code>
      <button type="button" onClick={async () => {
        try {
          await navigator.clipboard.writeText(link);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        } catch {
          toast("Copy the link from the box.");
        }
      }} className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-[11.5px] font-medium text-ink ring-1 ring-line hover:ring-ink-faint">
        {copied ? <Check className="h-3 w-3 text-sure" /> : <Copy className="h-3 w-3" />} {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/** "Your Clone Flow": the organization's portal, filling in as the assistant learns. */
function PortalPanel({ org, profile, plan, invites }: { org: string; profile: OrgProfile; plan: PlanUsage; invites: { name: string; email: string }[] }) {
  const rows: { label: string; value: React.ReactNode; done: boolean }[] = [
    { label: "What you do", value: profile.summary, done: !!profile.summary },
    { label: "Knowledge to keep", value: <Chips items={profile.critical_areas} />, done: !!profile.critical_areas?.length },
    { label: "Teams with know-how", value: <Chips items={profile.teams} />, done: !!profile.teams?.length },
    { label: "Where people work", value: <Chips items={profile.tools} />, done: !!profile.tools?.length },
    { label: "People leaving", value: invites.length ? <Chips items={invites.map((i) => i.name)} /> : null, done: invites.length > 0 },
  ];
  const n = rows.filter((r) => r.done).length;
  return (
    <aside className="scroll-thin hidden w-[360px] shrink-0 overflow-y-auto border-l border-line bg-white/70 p-6 lg:block">
      <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-700">Your Clone Flow</div>
      <h2 className="mt-1 font-display text-[24px] leading-tight text-ink">{org}</h2>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-brand-50" aria-hidden>
        <motion.div className="h-full rounded-full bg-brand-700" animate={{ width: `${(n / rows.length) * 100}%` }} transition={{ duration: 0.6 }} />
      </div>
      <ul className="mt-6 space-y-5">
        {rows.map((r) => (
          <li key={r.label} className="flex gap-3">
            <span className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full", r.done ? "bg-sure-bg text-sure" : "bg-paper ring-1 ring-inset ring-line-strong")}>
              {r.done && <Check className="h-3 w-3" />}
            </span>
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-ink">{r.label}</div>
              <div className="mt-1 text-[13px] leading-relaxed text-ink-soft">{r.value || <span className="text-ink-faint">Not yet</span>}</div>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-8 rounded-xl bg-paper p-4 ring-1 ring-inset ring-line">
        <div className="flex items-baseline justify-between">
          <span className="text-[13px] font-semibold text-ink">{plan.name} plan</span>
          <span className="tnum text-[12.5px] text-ink-muted">{plan.used} of {plan.employees} people</span>
        </div>
        <p className="mt-1 text-[12.5px] text-ink-muted">{plan.free ? "Free. " : ""}Each person leaving gets one private handover conversation.</p>
      </div>
    </aside>
  );
}

function Chips({ items }: { items?: string[] | null }) {
  if (!items?.length) return null;
  return (
    <span className="flex flex-wrap gap-1.5">
      {items.map((i) => <span key={i} className="rounded-full bg-brand-50 px-2.5 py-0.5 text-[12px] font-medium text-brand-800">{i}</span>)}
    </span>
  );
}
