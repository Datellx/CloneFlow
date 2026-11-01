import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { ArrowUp, Briefcase, CalendarClock, Copy, Loader2, MessageCircleQuestion, Mic, Square, TriangleAlert, UserRound, CircleDot } from "lucide-react";
import { api, ApiError, mediaUrl } from "@/lib/api";
import { cn } from "@/lib/format";
import { useRecorder } from "@/lib/voice";
import { Button, EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { useBriefing, useEmployee, knowledge } from "../api";
import { Orb } from "../Orb";
import { PersonAvatar, ProofChip, VerifiedBadge, firstName, fmtClock } from "../bits";
import { ProofModal } from "../viewers";
import type { AskAnswer, Briefing, Card, Proof } from "../types";

type Mode = "takeover" | "question";
type Msg = { kind: "user"; text: string; id: string } | { kind: "bot"; answer: AskAnswer; id: string } | { kind: "pending"; id: string };

const SUGGESTED = [
  "What torque for the servo horn screws?",
  "How do I do the Monday recalibration?",
  "Who do I contact for a servo RMA?",
  "What's left on the Gripper knowledge firmware?",
  "How did she negotiate servo pricing?",
];

function BotAvatar({ size = 34 }: { size?: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center overflow-visible rounded-full bg-brand-50" style={{ width: size, height: size }}>
      <Orb size={size * 1.05} state="idle" />
    </span>
  );
}

export function AskView({
  eid, picker, orgName, fill, interviewHref,
}: { eid: number | null; picker?: ReactNode; orgName?: string; fill?: boolean; interviewHref?: string | null }) {
  const emp = useEmployee(eid ?? 0);
  const [params, setParams] = useSearchParams();
  const mode: Mode = eid === null || params.get("mode") === "question" ? "question" : "takeover";
  const setMode = (m: Mode) => {
    const next = new URLSearchParams(params);
    next.set("mode", m);
    setParams(next, { replace: true });
  };
  const history = useQuery({ queryKey: ["kb", "asks", eid], queryFn: () => knowledge.asks(eid!), enabled: !!eid });
  useEffect(() => {
    // A new target starts a new conversation.
    setMsgs([]);
    setSeeded(false);
  }, [eid]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [seeded, setSeeded] = useState(false);
  const [text, setText] = useState("");
  const [proof, setProof] = useState<Proof | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const recorder = useRecorder();
  const [transcribing, setTranscribing] = useState(false);
  const name = eid === null ? "" : emp.data ? firstName(emp.data.name) : "";

  useEffect(() => {
    if (seeded || !history.data || !eid) return;
    setMsgs(history.data.flatMap((a) => [{ kind: "user" as const, text: a.question, id: `u${a.id}` }, { kind: "bot" as const, answer: a, id: `b${a.id}` }]));
    setSeeded(true);
  }, [history.data, seeded]);

  const lastId = msgs[msgs.length - 1]?.id;
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    // The briefing reads top-down; the chat follows the newest message.
    requestAnimationFrame(() => el.scrollTo({ top: mode === "takeover" ? 0 : el.scrollHeight, behavior: "smooth" }));
  }, [lastId, mode]);

  const ask = async (question: string) => {
    const qtext = question.trim();
    if (!qtext) return;
    if (mode !== "question") setMode("question");
    const pid = `p${Date.now()}`;
    setMsgs((m) => [...m, { kind: "user", text: qtext, id: `u${pid}` }, { kind: "pending", id: pid }]);
    setText("");
    try {
      const a = await knowledge.ask({ eid, question: qtext, mode: "question" });
      setMsgs((m) => m.map((x) => (x.id === pid ? { kind: "bot", answer: a, id: `b${a.id}` } : x)));
    } catch (e) {
      setMsgs((m) => m.filter((x) => x.id !== pid));
      toast.error((e as Error).message);
    }
  };

  const toggleMic = async () => {
    if (recorder.state === "recording") {
      const blob = await recorder.stop();
      recorder.reset();
      if (!blob || blob.size < 800) return;
      setTranscribing(true);
      try {
        const r = await api.transcribe(blob);
        setText(r.text);
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setTranscribing(false);
      }
    } else {
      const ok = await recorder.start();
      if (!ok && recorder.error) toast.error(recorder.error);
    }
  };

  const verifiedCount = emp.data?.counts.verified_cards ?? 0;
  const everyone = eid === null;

  return (
    <div className={cn("flex flex-col", fill ? "h-full min-h-0" : "min-h-screen lg:h-screen lg:min-h-0")}>
      {/* header */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-3 border-b border-line bg-white px-5 py-3 lg:px-7">
        <BotAvatar size={40} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex items-center gap-2">
            <h1 className="font-sans text-[15px] font-semibold text-ink">Ask Clone Flow</h1>
            <span className="hidden rounded bg-paper px-1.5 py-px text-[11px] font-medium text-ink-muted ring-1 ring-inset ring-line sm:inline">Bot</span>
          </div>
          <div className="truncate text-[12.5px] text-ink-muted">
            {everyone
              ? `Everyone's knowledge${orgName ? ` at ${orgName}` : ""} · every captured pack, with proof`
              : emp.data ? `${emp.data.name}'s knowledge · ${emp.data.counts.cards} cards, ${verifiedCount} verified in the exit interview` : " "}
          </div>
        </div>
        {picker}
        {!everyone && (
        <div role="tablist" className="inline-flex rounded-xl bg-paper p-1 ring-1 ring-inset ring-line">
          {([
            ["takeover", "Handover briefing", Briefcase],
            ["question", "I have a question", MessageCircleQuestion],
          ] as const).map(([k, label, I]) => (
            <button
              key={k}
              role="tab"
              aria-selected={mode === k}
              onClick={() => setMode(k)}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-[13.5px] font-medium transition-colors",
                mode === k ? "bg-white text-brand-800 shadow-card ring-1 ring-line" : "text-ink-muted hover:text-ink",
              )}
            >
              <I className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
        )}
      </div>

      {/* stream */}
      <div ref={scroller} className="scroll-thin min-h-0 flex-1 overflow-y-auto bg-[#F7F4F3]">
        <div className="mx-auto w-full max-w-[880px] px-4 py-6 sm:px-6">
          {mode === "takeover" ? (
            <BriefingView eid={eid!} name={name} onOpen={setProof} interviewHref={interviewHref === undefined ? `/app/e/${eid}/interview` : interviewHref} />
          ) : (
            <>
              <BotRow>
                <div className="rounded-2xl rounded-tl-md border border-line bg-white px-4 py-3 text-[15px] text-ink shadow-card">
                  {everyone
                    ? "Ask me anything your colleagues knew, including people who have left. I answer from every knowledge pack and show where each answer came from. If nobody covered it, I'll say so and tell you who to ask. In Microsoft Teams, type @Clone Flow and your question."
                    : `Ask me anything ${name} knew. I answer from their email, chat, files, recordings and exit interview, and I show you where each answer came from. If it was never covered, I'll say so and tell you who to ask.`}
                </div>
              </BotRow>
              {history.isLoading && <Skeleton className="ml-12 mt-4 h-24 w-2/3 rounded-2xl" />}
              {msgs.map((m) =>
                m.kind === "user" ? (
                  <motion.div key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-5 flex justify-end">
                    <div className="max-w-[80%] rounded-2xl rounded-tr-md bg-brand-700 px-4 py-2.5 text-[15px] text-white shadow-card">{m.text}</div>
                  </motion.div>
                ) : m.kind === "pending" ? (
                  <BotRow key={m.id}>
                    <div className="inline-flex items-center gap-1.5 rounded-2xl rounded-tl-md border border-line bg-white px-4 py-3 shadow-card" aria-label="Clone Flow is answering">
                      {[0, 1, 2].map((i) => <span key={i} className="h-2 w-2 animate-bounce rounded-full bg-brand-300" style={{ animationDelay: `${i * 120}ms` }} />)}
                    </div>
                  </BotRow>
                ) : (
                  <BotRow key={m.id}>
                    <AnswerBubble a={m.answer} name={name || "the team"} onOpen={setProof} />
                  </BotRow>
                ),
              )}
            </>
          )}
        </div>
      </div>

      {/* composer */}
      <div className="shrink-0 border-t border-line bg-white px-4 pb-4 pt-3 sm:px-6">
        <div className="mx-auto w-full max-w-[880px]">
          {(mode === "question" && msgs.length === 0) || mode === "takeover" ? (
            <div className="no-scrollbar mb-2.5 flex gap-2 overflow-x-auto">
              {SUGGESTED.map((s) => (
                <button key={s} onClick={() => ask(s)} className="shrink-0 rounded-full border border-line bg-paper px-3 py-1.5 text-[13px] text-ink-soft hover:border-brand-200 hover:bg-brand-50 hover:text-brand-800">
                  {s}
                </button>
              ))}
            </div>
          ) : null}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              ask(text);
            }}
            className="flex items-center gap-2 rounded-2xl border border-line-strong bg-white p-1.5 pl-4 focus-within:border-brand-600 focus-within:shadow-ring"
          >
            {recorder.state === "recording" ? (
              <div className="flex h-9 flex-1 items-center gap-[3px]" aria-label="Listening">
                {recorder.levels.map((l, i) => <span key={i} className="flex-1 rounded-full bg-brand-600" style={{ height: `${12 + l * 88}%`, opacity: 0.35 + l * 0.65 }} />)}
                <span className="tnum ml-2 text-xs text-ink-muted">{fmtClock(recorder.elapsed)}</span>
              </div>
            ) : (
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={transcribing ? "Transcribing…" : everyone ? "Ask the company…" : `Ask about ${name || "their"}'s work…`}
                disabled={transcribing}
                className="h-9 min-w-0 flex-1 bg-transparent text-[15px] text-ink placeholder:text-ink-faint focus:outline-none"
              />
            )}
            <button
              type="button"
              onClick={toggleMic}
              className={cn("flex h-9 w-9 items-center justify-center rounded-xl transition-colors", recorder.state === "recording" ? "bg-brand-700 text-white" : "text-ink-muted hover:bg-paper hover:text-ink")}
              aria-label={recorder.state === "recording" ? "Stop and transcribe" : "Ask by voice"}
            >
              {transcribing ? <Loader2 className="h-4 w-4 animate-spin" /> : recorder.state === "recording" ? <Square className="h-3.5 w-3.5 fill-current" /> : <Mic className="h-[18px] w-[18px]" />}
            </button>
            <Button type="submit" size="sm" className="!h-9 !w-9 !p-0" disabled={!text.trim()} aria-label="Send">
              <ArrowUp className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </div>
      <ProofModal eid={eid ?? 0} proof={proof} onClose={() => setProof(null)} />
    </div>
  );
}

function BotRow({ children }: { children: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-5 flex items-start gap-3">
      <BotAvatar />
      <div className="min-w-0 flex-1">
        <div className="mb-1 text-xs font-medium text-ink-muted">Clone Flow</div>
        {children}
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ answer */
function AnswerBubble({ a, name, onOpen }: { a: AskAnswer; name: string; onOpen: (p: Proof) => void }) {
  if (!a.known) {
    return (
      <div className="max-w-[640px] rounded-2xl rounded-tl-md border border-line bg-white px-4 py-3.5 shadow-card">
        <p className="text-[15px] text-ink">
          I don't know this. {name} never covered it in email, chat, files or the exit interview, so I won't guess.
        </p>
        {a.ask_person && <AskPerson person={a.ask_person} question={a.question} lead="Ask" />}
      </div>
    );
  }
  const media = a.images.map((u, i) => ({ u, proof: a.proofs.find((p) => p.frame_url === u) ?? ({ kind: "screen", ref: `img-${i}`, label: "Keyframe", frame_url: u } as Proof) }));
  return (
    <div className="max-w-[720px] overflow-hidden rounded-2xl rounded-tl-md border border-line bg-white shadow-card">
      <div className="px-4 pb-3 pt-3.5">
        <div className="flex items-start gap-3">
          <p className="min-w-0 flex-1 text-[15px] leading-relaxed text-ink">{a.answer}</p>
          {a.verified && <VerifiedBadge className="mt-0.5 shrink-0" label={name === "the team" ? "Verified" : `Verified by ${name}`} />}
        </div>
        {a.steps.length > 0 && (
          <ol className="mt-3 space-y-2">
            {a.steps.map((s, i) => (
              <li key={i} className="flex gap-3 text-[14.5px] leading-snug text-ink-soft">
                <span className="tnum mt-px flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-brand-50 text-[12px] font-semibold text-brand-800">{i + 1}</span>
                <span className="pt-0.5">{s}</span>
              </li>
            ))}
          </ol>
        )}
        {media.length > 0 && (
          <div className="mt-3 flex gap-2">
            {media.map(({ u, proof }) => (
              <button key={u} onClick={() => onOpen(proof)} className="group relative w-[260px] overflow-hidden rounded-xl border border-line">
                <img src={mediaUrl(u)} alt={proof.label} className="aspect-video w-full object-cover transition-transform group-hover:scale-[1.02]" />
                {proof.timestamp_s != null && (
                  <span className="tnum absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white">▶ {fmtClock(proof.timestamp_s)}</span>
                )}
              </button>
            ))}
          </div>
        )}
        {a.ask_person && <AskPerson person={a.ask_person} question={a.question} lead="Also ask" />}
      </div>
      {a.proofs.length > 0 && (
        <div className="border-t border-line bg-paper/60 px-4 py-2.5">
          <div className="mb-1.5 text-xs font-medium text-ink-muted">Proof</div>
          <div className="flex flex-wrap gap-1.5">
            {a.proofs.map((p, i) => <ProofChip key={i} proof={p} onOpen={onOpen} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function AskPerson({ person, question, lead }: { person: { name: string; why: string }; question: string; lead: string }) {
  return (
    <div className="mt-3 flex items-center gap-3 rounded-xl border border-line bg-paper/60 px-3.5 py-3">
      <PersonAvatar name={person.name} size={36} />
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium text-ink">{lead} {person.name}</div>
        <div className="text-[13px] text-ink-muted">{person.why}</div>
      </div>
      <Button
        size="sm"
        variant="secondary"
        icon={<Copy className="h-3.5 w-3.5" />}
        onClick={() => {
          navigator.clipboard?.writeText(question).then(
            () => toast.success(`Question copied. Paste it to ${firstName(person.name)}.`),
            () => toast.error("Couldn't copy. Select the question and copy it yourself."),
          );
        }}
      >
        Copy question
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ briefing */
const STATUS_TONE: Record<string, string> = {
  Running: "bg-sure-bg text-sure",
  Unfinished: "bg-[#FBEDEC] text-[#9B1C1C]",
  Deciding: "bg-maybe-bg text-[#7A4D0C]",
};

function BriefingView({ eid, name, onOpen, interviewHref }: { eid: number; name: string; onOpen: (p: Proof) => void; interviewHref?: string | null }) {
  const b = useBriefing(eid);
  const nav = useNavigate();
  if (b.isLoading)
    return (
      <BotRow>
        <div className="space-y-3 rounded-2xl border border-line bg-white p-6"><Skeleton className="h-7 w-1/2" /><Skeleton className="h-24" /><Skeleton className="h-40" /></div>
      </BotRow>
    );
  if (b.error) {
    if (b.error instanceof ApiError && b.error.status === 404)
      return (
        <EmptyState
          className="rounded-2xl border border-dashed border-line-strong bg-white"
          icon={<CalendarClock className="h-5 w-5" />}
          title="The Day-1 briefing isn't ready yet"
          action={interviewHref ? <Button onClick={() => nav(interviewHref)}>Go to the interview</Button> : undefined}
        >
          It's written once, when {name}'s exit conversation finishes. You can still ask questions now.
        </EmptyState>
      );
    return <ErrorState error={b.error} onRetry={() => b.refetch()} />;
  }
  const d = b.data as Briefing;
  return (
    <>
      <BotRow>
        <div className="rounded-2xl rounded-tl-md border border-line bg-white px-4 py-3 text-[15px] text-ink shadow-card">
          Welcome. Here's what {name} handled, what's still open, and the five things that break first if nobody picks them up. Tap any proof to see where it came from.
        </div>
      </BotRow>
      <BotRow>
        <article className="overflow-hidden rounded-2xl rounded-tl-md border border-line bg-white shadow-card">
          <header className="border-b border-line px-6 pb-4 pt-5">
            <h2 className="text-[26px] font-normal leading-tight text-ink">Day 1 in {name}'s role</h2>
            <p className="mt-1 text-[13.5px] text-ink-muted">{plural(d.projects.length, "project")} · {plural(d.open_tasks.length, "open task")} · {plural(d.contacts.length, "key contact")} · {plural(d.routines.length, "weekly routine")}</p>
          </header>

          <Section title="5 things that will break if ignored" icon={<TriangleAlert className="h-4 w-4 text-brand-700" />}>
            <ol className="space-y-3">
              {d.will_break.map((w, i) => (
                <li key={i} className="flex gap-3.5">
                  <span className="tnum mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-700 text-[12px] font-semibold text-white">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-semibold text-ink">{w.title}</div>
                    <div className="mt-0.5 text-[14px] text-ink-soft">{w.why}</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">{w.sources.map((p, j) => <ProofChip key={j} proof={p} onOpen={onOpen} />)}</div>
                  </div>
                </li>
              ))}
            </ol>
          </Section>

          <Section title={`${name}'s projects`} icon={<Briefcase className="h-4 w-4 text-brand-700" />}>
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
              {d.projects.map((p) => (
                <li key={p.name} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                  <div className="w-56 shrink-0 text-[14.5px] font-medium text-ink">{p.name}</div>
                  <span className={cn("w-fit shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", STATUS_TONE[p.status] ?? "bg-brand-50 text-brand-800")}>{p.status}</span>
                  <div className="min-w-0 flex-1 text-[13.5px] text-ink-muted">{p.note}</div>
                </li>
              ))}
            </ul>
          </Section>

          <div className="grid border-t border-line md:grid-cols-2">
            <Section title="Open tasks" icon={<CircleDot className="h-4 w-4 text-brand-700" />} flush>
              <CardList cards={d.open_tasks} onOpen={onOpen} />
            </Section>
            <Section title="Key contacts" icon={<UserRound className="h-4 w-4 text-brand-700" />} flush className="md:border-l md:border-line">
              <CardList cards={d.contacts} onOpen={onOpen} person />
            </Section>
          </div>
          <Section title="Weekly routines" icon={<CalendarClock className="h-4 w-4 text-brand-700" />}>
            <CardList cards={d.routines} onOpen={onOpen} />
          </Section>
        </article>
      </BotRow>
    </>
  );
}

function Section({ title, icon, children, flush, className }: { title: string; icon: ReactNode; children: ReactNode; flush?: boolean; className?: string }) {
  return (
    <section className={cn("px-6 py-5", !flush && "border-t border-line first-of-type:border-0", className)}>
      <h3 className="mb-3.5 flex items-center gap-2 font-sans text-[14.5px] font-semibold text-ink">{icon}{title}</h3>
      {children}
    </section>
  );
}

function CardList({ cards, onOpen, person }: { cards: Card[]; onOpen: (p: Proof) => void; person?: boolean }) {
  if (!cards.length) return <p className="text-[13.5px] text-ink-muted">None found.</p>;
  return (
    <ul className="space-y-4">
      {cards.map((c) => (
        <li key={c.id} className="flex gap-3">
          {person && <PersonAvatar name={c.title.split(",")[0]} size={30} />}
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <span className="min-w-0 flex-1 text-[14.5px] font-medium leading-snug text-ink">{c.title}</span>
              {c.status === "verified_in_interview" && <VerifiedBadge className="shrink-0" />}
            </div>
            <p className="mt-0.5 text-[13.5px] leading-snug text-ink-muted">{c.body}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {c.sources.filter((s) => s.kind !== "interview").slice(0, 2).map((p, i) => <ProofChip key={i} proof={p} onOpen={onOpen} />)}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
