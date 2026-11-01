import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useLocation, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import {
  ArrowUp, Building2, ChevronRight, Keyboard, Loader2, LogOut, MessageSquareText, Mic, MonitorUp, PanelRightClose,
  PanelRightOpen, Plus, SkipForward, Smartphone, Square, Upload, Volume2, VolumeX, X,
} from "lucide-react";
import { ApiError, useMe } from "@/lib/api";
import { cn } from "@/lib/format";
import { stop as stopSpeech, useRecorder } from "@/lib/voice";
import { Logo } from "@/components/domain";
import { Button } from "@/components/ui";
import { Orb, type OrbState } from "../shared/Orb";
import { CoverageRing, GapBadge, ProofChip, fmtClock } from "../shared/bits";
import { ProofModal } from "../shared/viewers";
import { Caption, useInterviewer, useScreenRecorder } from "../shared/voiceHooks";
import type { Proof, WalkFeedItem, WalkStart } from "../shared/types";
import { handoverKeys, useSession, handover } from "./api";
import { signInPath, useSignOut, useTitle } from "./orgs";
import { useSpeechInput } from "./useSpeechInput";
import { Transcript } from "./session/Transcript";
import { ProviderTile, ReadingCounters, SavedStack, SummaryCard, WalkSheet } from "./session/parts";
import { PrivacyButton, PrivacySheet } from "./session/Privacy";
import type { Action, Msg, Provider, ReadingPayload, Session, SessionReply, SummaryPayload } from "./types";

type Mode = "idle" | "talk" | "type" | "sending" | "screen";

const PROVIDER_NAME: Record<string, string> = { gmail: "Gmail", microsoft: "Microsoft 365", github: "GitHub" };

function useMedia(q: string) {
  const [m, setM] = useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return m;
}
function has<T extends Action["type"]>(s: Session | undefined, t: T): Extract<Action, { type: T }> | undefined {
  return s?.actions.find((a) => a.type === t) as Extract<Action, { type: T }> | undefined;
}

/* ===================================================================== page */
export default function SessionPage() {
  const me = useMe();
  const loc = useLocation();
  if (me.isLoading) return <Splash />;
  if (me.error instanceof ApiError && me.error.status === 401)
    return <Navigate to={signInPath(loc.pathname)} replace />;
  if (me.error) return <Splash error={(me.error as Error).message} onRetry={() => me.refetch()} />;
  return <SessionScreen />;
}

function Splash({ error, onRetry }: { error?: string; onRetry?: () => void }) {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-paper px-6 text-center">
      <Orb size={96} state={error ? "idle" : "thinking"} />
      {error ? (
        <>
          <p className="max-w-sm text-ink-muted">{error}</p>
          {onRetry && <Button variant="secondary" onClick={onRetry}>Try again</Button>}
        </>
      ) : (
        <span className="sr-only">Loading</span>
      )}
    </div>
  );
}

function SessionScreen() {
  const me = useMe().data!;
  const sq = useSession();
  const s = sq.data;
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const ai = useInterviewer();
  useTitle("Your handover");
  const recorder = useRecorder();
  const speech = useSpeechInput();
  const screen = useScreenRecorder();
  const wide = useMedia("(min-width: 1024px)");
  const short = useMedia("(max-height: 820px)");

  const [mode, setMode] = useState<Mode>("idle");
  const modeRef = useRef<Mode>("idle");
  modeRef.current = mode;
  const [text, setText] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [panel, setPanel] = useState(true); // desktop transcript
  const [sheet, setSheet] = useState(false); // phone transcript
  const [unread, setUnread] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [proof, setProof] = useState<Proof | null>(null);
  const [drag, setDrag] = useState(false);
  const [walk, setWalk] = useState<WalkStart | null>(null);
  const [walkOpen, setWalkOpen] = useState(false);
  const [walkFeed, setWalkFeed] = useState<WalkFeedItem[]>([]);
  const [walkDone, setWalkDone] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const setSession = useCallback((next: Session) => qc.setQueryData(handoverKeys.session, next), [qc]);
  const apply = useCallback((r: SessionReply) => setSession(r.session), [setSession]);

  /* ------------------------------------------------ speak each new avatar line */
  const seen = useRef<Set<string | number> | null>(null);
  const queue = useRef<string[]>([]);
  const running = useRef(false);
  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    while (queue.current.length) {
      const t = queue.current.shift()!;
      await ai.say(t);
    }
    running.current = false;
  }, [ai]);
  const hush = useCallback(() => {
    queue.current = [];
    ai.interrupt();
  }, [ai]);

  const greeting = s ? `Hi ${s.first_name}. I'm Clone Flow. Let's make sure what you know stays here after you leave. It takes about twenty minutes, and you can talk or type.` : "";
  useEffect(() => {
    if (!s) return;
    const avatar = s.messages.filter((m) => m.role === "avatar");
    if (seen.current === null) {
      seen.current = new Set(avatar.map((m) => m.id));
      const lastTalk = [...avatar].reverse().find((m) => m.kind !== "cards");
      if (lastTalk) ai.setCaption(lastTalk.text);
      else if (s.stage === "welcome") ai.say(greeting, { silent: true });
      return;
    }
    const fresh = avatar.filter((m) => !seen.current!.has(m.id));
    if (!fresh.length) return;
    fresh.forEach((m) => seen.current!.add(m.id));
    const lines = fresh.filter((m) => m.kind !== "cards").map((m) => m.text);
    if (!sheet && !wide) setUnread((u) => u + fresh.length);
    if (lines.length) {
      queue.current.push(...lines);
      pump();
    }
  }, [s?.messages]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ------------------------------------------------ back from OAuth */
  useEffect(() => {
    const c = params.get("connected");
    if (!c) return;
    toast.success(`${PROVIDER_NAME[c] ?? c} connected`);
    qc.invalidateQueries({ queryKey: handoverKeys.session });
    params.delete("connected");
    setParams(params, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ------------------------------------------------ actions */
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const begin = () => run("start", async () => {
    hush();
    setSession(await handover.start());
  });
  const send = async (payload: { text?: string; audio?: Blob }, shown?: string) => {
    setMode("sending");
    setPending(shown ?? payload.text ?? "…");
    ai.setOrb("thinking");
    try {
      apply(await handover.message(payload));
      setText("");
    } catch (e) {
      toast.error((e as Error).message);
      ai.setOrb("idle");
    } finally {
      setPending(null);
      setMode("idle");
    }
  };
  const sendText = () => {
    const t = text.trim();
    if (!t) return;
    hush();
    send({ text: t });
  };

  const startTalk = async () => {
    hush();
    stopSpeech();
    setMode("talk");
    const ok = await recorder.start();
    if (!ok) {
      setMode("idle");
      toast.error(recorder.error || "Couldn't start the microphone. You can type instead.");
      return;
    }
    speech.start();
  };
  const stopTalk = async () => {
    if (modeRef.current !== "talk") return;
    setMode("sending");
    const [blob, said] = await Promise.all([recorder.stop(), speech.stop()]);
    recorder.reset();
    if (said) return send({ text: said });
    if (blob && blob.size > 800) return send({ audio: blob }, "…");
    setMode("idle");
    toast.error("I didn't catch that. Try again, or type it.");
  };
  const cancelTalk = () => {
    speech.cancel();
    recorder.reset();
    setMode("idle");
  };
  // Hold to talk, or tap to toggle.
  const press = useRef({ at: 0, ignoreClick: false });
  const micDown = () => {
    if (modeRef.current !== "idle") return;
    press.current = { at: Date.now(), ignoreClick: true };
    startTalk();
  };
  const micUp = () => {
    if (press.current.ignoreClick && Date.now() - press.current.at > 600 && modeRef.current === "talk") stopTalk();
  };
  const micClick = () => {
    if (press.current.ignoreClick) {
      press.current.ignoreClick = false;
      return;
    }
    if (modeRef.current === "idle") startTalk();
    else if (modeRef.current === "talk") stopTalk();
  };

  const skip = () => run("skip", async () => {
    hush();
    apply(await handover.skip());
  });
  const startReading = () => run("read", async () => {
    hush();
    apply(await handover.read());
  });
  const finish = () => run("finish", async () => {
    hush();
    apply(await handover.finish());
  });

  const canAdd = !!has(s, "add") || !!has(s, "connect");
  const upload = (files: File[]) => {
    if (!files.length) return;
    if (!canAdd) {
      toast("You can share files once we get going.");
      return;
    }
    setAddOpen(false);
    run("upload", async () => {
      hush();
      setPending(files.length === 1 ? `Sharing ${files[0].name}…` : `Sharing ${files.length} files…`);
      ai.setOrb("thinking");
      try {
        apply(await handover.upload(files));
      } finally {
        setPending(null);
      }
    });
  };

  const startScreen = async () => {
    setAddOpen(false);
    hush();
    const err = await screen.start();
    if (err) return toast.error(err);
    setMode("screen");
  };
  const stopScreen = async () => {
    const blob = await screen.stop();
    setMode("idle");
    if (!blob || !blob.size) return toast.error("Nothing was recorded. Try sharing your screen again.");
    run("screen", async () => {
      setPending("Shared my screen");
      ai.setOrb("thinking");
      try {
        apply(await handover.screen(blob));
      } finally {
        setPending(null);
      }
    });
  };
  const cancelScreen = () => {
    screen.cancel();
    setMode("idle");
  };

  const startWalk = () => {
    setAddOpen(false);
    setWalk(null);
    setWalkFeed([]);
    setWalkDone(false);
    setWalkOpen(true);
    handover.walk().then(setWalk).catch((e) => {
      setWalkOpen(false);
      toast.error((e as Error).message);
    });
  };
  useEffect(() => {
    if (!walkOpen || !walk) return;
    let alive = true;
    let after = 0;
    let t = 0;
    const tick = async () => {
      try {
        const f = await handover.walkFeed(after);
        if (!alive) return;
        if (f.items.length) {
          after = Math.max(after, ...f.items.map((i) => i.seq));
          setWalkFeed((prev) => [...f.items.slice().reverse(), ...prev]);
        }
        if (f.done) {
          setWalkDone(true);
          qc.invalidateQueries({ queryKey: handoverKeys.session });
          t = window.setTimeout(() => alive && setWalkOpen(false), 1800);
          return;
        }
      } catch {
        /* keep polling */
      }
      if (alive) t = window.setTimeout(tick, 1000);
    };
    t = window.setTimeout(tick, 500);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [walkOpen, walk, qc]);

  const connect = (p: Provider) => {
    if (p.configured && p.start_url) {
      setBusy(p.key);
      window.location.assign(p.start_url);
      return;
    }
    // A source the server hasn't set up yet is not available.
    toast(`${PROVIDER_NAME[p.key] ?? p.label} isn't available yet. Ask your administrator.`);
  };

  const signOutTo = useSignOut(hush);
  const signOut = () => signOutTo(me.org.slug);

  /* ------------------------------------------------ drag and drop anywhere */
  useEffect(() => {
    let depth = 0;
    const isFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types || []).includes("Files");
    const enter = (e: DragEvent) => {
      if (!isFiles(e)) return;
      e.preventDefault();
      depth++;
      setDrag(true);
    };
    const over = (e: DragEvent) => isFiles(e) && e.preventDefault();
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDrag(false);
    };
    const drop = (e: DragEvent) => {
      if (!isFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDrag(false);
      uploadRef.current(Array.from(e.dataTransfer?.files || []));
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);
  const uploadRef = useRef(upload);
  uploadRef.current = upload;

  /* ------------------------------------------------ derived */
  const readingMsg = useMemo(() => (s ? [...s.messages].reverse().find((m) => m.kind === "reading") : undefined), [s]);
  const summaryMsg = useMemo(() => (s ? [...s.messages].reverse().find((m) => m.kind === "summary") : undefined), [s]);
  const connectAction = has(s, "connect");
  // Files go through "Show me → Upload" and folders/PDM through "Share screen", so a Files tile is never shown.
  const providers = connectAction?.providers.filter((p) => p.key !== "files") ?? null;

  if (sq.error) {
    if (sq.error instanceof ApiError && sq.error.status === 401) return <Navigate to={signInPath("/session")} replace />;
    return <Splash error={(sq.error as Error).message} onRetry={() => sq.refetch()} />;
  }
  if (!s) return <Splash />;

  const stage = s.stage;
  const orbState: OrbState =
    mode === "talk" || mode === "screen" ? "listening" : mode === "sending" || busy === "upload" || busy === "screen" ? "thinking" : stage === "reading" && ai.orb !== "speaking" ? "thinking" : ai.orb;
  // The avatar is always the main thing, but it makes room when the stage has something to show.
  const busyStage = stage === "connect" || stage === "done" || stage === "reading";
  const orbSize = wide ? (busyStage ? (short ? 120 : 148) : short ? 168 : 216) : busyStage ? 104 : 136;
  const capLen = ai.caption.length;
  const q = s.question;
  const showProgress = stage === "interview" && s.progress.total > 0;
  const answer = !!has(s, "answer");
  const transcriptProps = {
    messages: s.messages, pending, providers, onConnect: connect, connectBusy: busy, onOpen: setProof, connectTiles: !wide,
    liveReadingId: stage === "reading" ? readingMsg?.id ?? null : null,
    onPrivacy: () => setPrivacy(true),
  };

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-paper">
      {/* --------------------------------------------------------- top bar */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line/70 bg-paper/80 px-4 backdrop-blur sm:px-6">
        <Logo to="/session" />
        <div className="ml-auto flex items-center gap-1">
          {me.is_admin && (
            <Link to="/admin" className="mr-1 hidden items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-ink-soft hover:bg-white hover:text-ink sm:inline-flex">
              <Building2 className="h-4 w-4" /> Company console
            </Link>
          )}
          <span className="mr-2 hidden text-[13.5px] text-ink-muted sm:inline">{s.name}</span>
          {!wide && (
            <button
              onClick={() => {
                setSheet(true);
                setUnread(0);
              }}
              className="relative rounded-lg p-2 text-ink-soft hover:bg-white"
              aria-label="Open conversation"
            >
              <MessageSquareText className="h-5 w-5" />
              {unread > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-brand-600" />}
            </button>
          )}
          <button onClick={ai.toggleMute} className="rounded-lg p-2 text-ink-soft hover:bg-white" aria-pressed={ai.muted} aria-label={ai.muted ? "Turn voice on" : "Turn voice off"} title={ai.muted ? "Voice off" : "Voice on"}>
            {ai.muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </button>
          <button onClick={signOut} className="rounded-lg p-2 text-ink-soft hover:bg-white" aria-label="Sign out" title="Sign out">
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {/* --------------------------------------------------------- stage */}
        <main className="relative flex min-w-0 flex-1 flex-col">
          {showProgress && (
            <div className="absolute inset-x-0 top-0 h-[3px] bg-brand-100/70" aria-hidden>
              <motion.div className="h-full bg-brand-700" initial={false} animate={{ width: `${(s.progress.asked / s.progress.total) * 100}%` }} transition={{ duration: 0.8, ease: "easeOut" }} />
            </div>
          )}
          {["interview", "open"].includes(stage) && (
            <div className="absolute right-4 top-4 z-10 flex flex-col items-center sm:right-6 sm:top-5">
              <CoverageBadge value={s.coverage} size={wide ? 68 : 52} />
            </div>
          )}
          <StageBackdrop stage={stage} />

          <div className="scroll-thin relative min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col items-center justify-center px-5 pb-6 pt-10 text-center">
              <Orb state={orbState} level={recorder.level} pulse={ai.pulse} size={orbSize} />

              <div className={cn("flex min-h-[28px] items-center justify-center gap-2", short ? "mt-3" : "mt-5")}>
                {stage === "interview" && q?.gap_type && <GapBadge type={q.gap_type} />}
                {showProgress && <span className="tnum text-[12.5px] text-ink-muted">{Math.min(s.progress.asked + 1, s.progress.total)} of {s.progress.total}</span>}
                {stage === "reading" && <span className="text-[12.5px] font-medium text-brand-700">Reading your work</span>}
              </div>

              <div aria-live="polite" className="w-full">
                <Caption
                  text={ai.caption}
                  spoken={ai.spoken}
                  className={cn(
                    "mx-auto mt-2 max-w-[30ch] text-balance font-display leading-[1.3] text-ink",
                    wide ? (capLen > 150 || short ? "text-[24px]" : "text-[29px]") : capLen > 150 ? "text-[19px]" : "text-[21px]",
                  )}
                />
              </div>

              {mode === "talk" && (speech.interim || recorder.state === "recording") && (
                <p className="mt-3 max-w-[48ch] text-[14px] italic text-ink-muted">{speech.interim ? `“${speech.interim}”` : "Listening…"}</p>
              )}

              {/* context under the caption */}
              <div className={cn("flex w-full flex-col items-center", short ? "mt-5" : "mt-7")}>
                {stage === "welcome" && (
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }} className="flex flex-col items-center gap-3">
                    <Button size="lg" onClick={begin} loading={busy === "start"} className="!h-14 !rounded-full !px-9 !text-[16px]">Let's begin</Button>
                    <span className="text-[13px] text-ink-muted">Talk or type. Nobody else sees this conversation.</span>
                  </motion.div>
                )}
                {stage === "connect" && providers && (
                  <div className={cn("grid w-full gap-3", wide ? (providers.length >= 3 ? "max-w-[780px] grid-cols-3" : "max-w-[540px] grid-cols-2") : "max-w-[520px] grid-cols-1 gap-2")}>
                    {providers.map((p) => <ProviderTile key={p.key} p={p} onConnect={connect} busy={busy === p.key} vertical={wide} compact={!wide} />)}
                  </div>
                )}
                {stage === "reading" && readingMsg?.payload ? (
                  <>
                    <ReadingCounters p={readingMsg.payload as ReadingPayload} live />
                    <PrivacyButton onClick={() => setPrivacy(true)} className="mt-4" />
                  </>
                ) : null}
                {stage === "interview" && q && q.evidence.length > 0 && (
                  <div className="flex max-w-[620px] flex-wrap justify-center gap-2">
                    {q.evidence.map((e, i) => (
                      <motion.div key={`${q.id}-${i}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + i * 0.08 }}>
                        <ProofChip proof={e} onOpen={setProof} className="!py-1.5 !text-[13px] shadow-card" />
                      </motion.div>
                    ))}
                  </div>
                )}
                {stage === "done" && summaryMsg?.payload ? <SummaryCard s={summaryMsg.payload as SummaryPayload} /> : null}
                {stage === "done" && readingMsg && <PrivacyButton onClick={() => setPrivacy(true)} className="mt-5" />}
                {stage === "done" && <p className="mt-5 text-[13px] text-ink-muted">You can close this page. Thank you.</p>}
              </div>
            </div>
          </div>

          {/* saved cards, desktop corner */}
          {wide && ["interview", "open"].includes(stage) && (
            <div className="absolute bottom-5 left-6 hidden xl:block">
              <SavedStack cards={s.cards_recent} />
            </div>
          )}

          {/* --------------------------------------------------------- dock */}
          {stage !== "welcome" && stage !== "done" && (
            <div className="relative shrink-0 px-4 pb-5 pt-2 sm:pb-7">
              <Dock
                s={s}
                mode={mode}
                busy={busy}
                text={text}
                setText={setText}
                answer={answer}
                addOpen={addOpen}
                setAddOpen={setAddOpen}
                levels={recorder.levels}
                elapsed={recorder.elapsed}
                screenElapsed={screen.elapsed}
                onType={() => {
                  hush();
                  setMode("type");
                }}
                onCloseType={() => setMode("idle")}
                onSend={sendText}
                mic={{ down: micDown, up: micUp, click: micClick }}
                onCancelTalk={cancelTalk}
                onSkip={skip}
                onRead={startReading}
                onFinish={finish}
                onScreen={startScreen}
                onStopScreen={stopScreen}
                onCancelScreen={cancelScreen}
                onUpload={() => fileInput.current?.click()}
                onPhone={startWalk}
              />
            </div>
          )}
          {mode === "screen" && screen.stream && <ScreenPip stream={screen.stream} />}
        </main>

        {/* --------------------------------------------------------- transcript */}
        {wide && (
          <aside
            className={cn("flex shrink-0 flex-col border-l border-line bg-[#F7F3F2] transition-[width] duration-300", panel ? "w-[380px] xl:w-[400px]" : "w-14")}
            aria-label="Conversation"
          >
            <div className={cn("flex h-12 shrink-0 items-center border-b border-line/70", panel ? "justify-between px-4" : "justify-center")}>
              {panel && <h2 className="font-sans text-[13.5px] font-semibold text-ink">Conversation</h2>}
              <button onClick={() => setPanel((v) => !v)} className="rounded-lg p-1.5 text-ink-muted hover:bg-white hover:text-ink" aria-label={panel ? "Hide conversation" : "Show conversation"}>
                {panel ? <PanelRightClose className="h-[18px] w-[18px]" /> : <PanelRightOpen className="h-[18px] w-[18px]" />}
              </button>
            </div>
            {panel && <Transcript {...transcriptProps} />}
          </aside>
        )}
      </div>

      {/* phone transcript sheet */}
      <AnimatePresence>
        {!wide && sheet && (
          <div className="fixed inset-0 z-40">
            <motion.div className="absolute inset-0 bg-[#2A0E17]/25" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSheet(false)} />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Conversation"
              className="absolute inset-x-0 bottom-0 flex h-[86dvh] flex-col rounded-t-3xl bg-[#F7F3F2] shadow-lift"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 34 }}
            >
              <div className="flex h-12 shrink-0 items-center justify-between border-b border-line/70 px-4">
                <h2 className="font-sans text-[14px] font-semibold text-ink">Conversation</h2>
                <button onClick={() => setSheet(false)} className="rounded-lg p-1.5 text-ink-muted hover:bg-white" aria-label="Close conversation">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <Transcript {...transcriptProps} />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* drop overlay */}
      <AnimatePresence>
        {drag && (
          <motion.div
            className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-brand-950/30 p-6 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-white/80 bg-white/90 px-12 py-10 text-center shadow-lift">
              <Upload className="h-7 w-7 text-brand-700" />
              <div className="font-display text-[24px] text-ink">{canAdd ? "Drop to share with Clone Flow" : "You can share files once we get going"}</div>
              <div className="text-[13px] text-ink-muted">Documents, images and videos</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <input
        ref={fileInput}
        type="file"
        multiple
        accept="image/*,video/*,.pdf,.doc,.docx,.txt,.md,.csv,.xlsx,.pptx"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          upload(Array.from(e.target.files || []));
          e.target.value = "";
        }}
      />
      <PrivacySheet open={privacy} onClose={() => setPrivacy(false)} />
      <WalkSheet open={walkOpen} onClose={() => setWalkOpen(false)} walk={walk} feed={walkFeed} done={walkDone} />
      <ProofModal eid={s.eid} proof={proof} onClose={() => setProof(null)} />
    </div>
  );
}

/* ===================================================================== coverage */
function CoverageBadge({ value, size }: { value: number; size: number }) {
  const prev = useRef(value);
  const [bump, setBump] = useState(0);
  useEffect(() => {
    if (value > prev.current) setBump((b) => b + 1);
    prev.current = value;
  }, [value]);
  return (
    <div className="relative flex flex-col items-center">
      <AnimatePresence>
        {bump > 0 && (
          <motion.span
            key={bump}
            className="absolute rounded-full border-2 border-brand-400"
            style={{ width: size, height: size }}
            initial={{ scale: 1, opacity: 0.7 }}
            animate={{ scale: 1.45, opacity: 0 }}
            transition={{ duration: 1.1, ease: "easeOut" }}
          />
        )}
      </AnimatePresence>
      <div className="rounded-full bg-white/80 shadow-card backdrop-blur">
        <CoverageRing value={value} size={size} stroke={size > 60 ? 5.5 : 4.5} compact />
      </div>
      <span className="mt-1 text-[11px] font-medium text-ink-muted">captured</span>
    </div>
  );
}

/** A slow, soft wash behind the avatar that warms up as the conversation moves on. */
function StageBackdrop({ stage }: { stage: Session["stage"] }) {
  const warm = stage === "reading" ? 0.55 : stage === "done" ? 0.75 : stage === "welcome" ? 0.25 : 0.4;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div className="absolute left-1/2 top-[38%] h-[760px] w-[760px] -translate-x-1/2 -translate-y-1/2">
        <motion.div
          className="h-full w-full rounded-full"
          style={{ background: "radial-gradient(closest-side, rgba(222,157,174,0.5), rgba(251,248,247,0))" }}
          animate={{ opacity: warm, scale: [1, 1.05, 1] }}
          transition={{ opacity: { duration: 1.2 }, scale: { duration: 9, repeat: Infinity, ease: "easeInOut" } }}
        />
      </div>
    </div>
  );
}

/* ===================================================================== dock */
function Dock(p: {
  s: Session; mode: Mode; busy: string | null; text: string; setText: (t: string) => void; answer: boolean;
  addOpen: boolean; setAddOpen: (v: boolean) => void; levels: number[]; elapsed: number; screenElapsed: number;
  onType: () => void; onCloseType: () => void; onSend: () => void; mic: { down: () => void; up: () => void; click: () => void };
  onCancelTalk: () => void; onSkip: () => void; onRead: () => void; onFinish: () => void;
  onScreen: () => void; onStopScreen: () => void; onCancelScreen: () => void; onUpload: () => void; onPhone: () => void;
}) {
  const { s, mode } = p;
  const add = has(s, "add");
  const skip = has(s, "skip");
  const read = has(s, "start_reading");
  const skipConnect = has(s, "skip_connect");
  const fin = has(s, "finish");
  const addRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!p.addOpen) return;
    const h = (e: MouseEvent) => addRef.current && !addRef.current.contains(e.target as Node) && p.setAddOpen(false);
    const k = (e: KeyboardEvent) => e.key === "Escape" && p.setAddOpen(false);
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", k);
    return () => {
      document.removeEventListener("mousedown", h);
      document.removeEventListener("keydown", k);
    };
  }, [p.addOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  if (s.stage === "reading")
    return (
      <div className="flex justify-center">
        <span className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[13px] text-ink-muted shadow-card ring-1 ring-line">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-700" /> This takes a few seconds
        </span>
      </div>
    );

  if (mode === "screen")
    return (
      <div className="mx-auto flex w-full max-w-[560px] items-center gap-3 rounded-full border border-brand-200 bg-white py-2 pl-5 pr-2 shadow-lift">
        <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#E5484D] opacity-60" /><span className="relative h-2.5 w-2.5 rounded-full bg-[#E5484D]" /></span>
        <span className="min-w-0 flex-1 truncate text-left text-[14px] text-ink">Recording your screen <span className="tnum text-ink-muted">{fmtClock(p.screenElapsed)}</span></span>
        <button onClick={p.onCancelScreen} className="rounded-full px-3 py-2 text-[13px] font-medium text-ink-muted hover:text-ink">Cancel</button>
        <Button onClick={p.onStopScreen} className="!rounded-full" icon={<Square className="h-3.5 w-3.5 fill-current" />}>Stop and send</Button>
      </div>
    );

  if (mode === "type")
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          p.onSend();
        }}
        className="mx-auto flex w-full max-w-[640px] items-end gap-2 rounded-[26px] border border-line-strong bg-white p-1.5 pl-2 shadow-lift focus-within:border-brand-600"
      >
        <button type="button" onClick={p.onCloseType} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-paper hover:text-ink" aria-label="Close typing">
          <X className="h-5 w-5" />
        </button>
        <textarea
          autoFocus
          rows={1}
          value={p.text}
          onChange={(e) => p.setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              p.onSend();
            }
            if (e.key === "Escape") p.onCloseType();
          }}
          placeholder="Type your answer…"
          aria-label="Your answer"
          className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent py-2 text-[15.5px] text-ink placeholder:text-ink-faint focus:outline-none"
        />
        <Button type="submit" disabled={!p.text.trim()} className="!h-10 !w-10 shrink-0 !rounded-full !p-0" aria-label="Send">
          <ArrowUp className="h-[18px] w-[18px]" />
        </Button>
      </form>
    );

  const talking = mode === "talk";
  const sending = mode === "sending" || p.busy === "upload" || p.busy === "screen";
  const round = "flex flex-col items-center gap-1.5";
  const ghost = "flex h-12 w-12 items-center justify-center rounded-full bg-white text-ink-soft shadow-card ring-1 ring-line transition-colors hover:text-brand-800 hover:ring-brand-200 disabled:opacity-50";
  const lbl = "text-[11.5px] font-medium text-ink-muted";

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col items-center gap-4">
      {(read || skipConnect) && !talking && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {read && (
            <Button size="lg" onClick={p.onRead} loading={p.busy === "read"} className="!rounded-full !px-7" icon={<ChevronRight className="h-4 w-4" />}>
              {read.label || "Start reading"}
            </Button>
          )}
          {skipConnect && (
            <button
              onClick={p.onSkip}
              disabled={sending || p.busy === "skip"}
              className="inline-flex h-11 items-center gap-1.5 rounded-full px-5 text-[14px] font-medium text-brand-800 ring-1 ring-brand-200 transition-colors hover:bg-brand-50 disabled:opacity-60"
            >
              {p.busy === "skip" && <Loader2 className="h-4 w-4 animate-spin" />}
              {skipConnect.label || "Skip — I'll show you instead"}
            </button>
          )}
        </div>
      )}
      <div className="flex items-end justify-center gap-5 sm:gap-7">
        {talking ? (
          <div className={round}>
            <button onClick={p.onCancelTalk} className={ghost} aria-label="Cancel recording"><X className="h-5 w-5" /></button>
            <span className={lbl}>Cancel</span>
          </div>
        ) : (
          p.answer && (
            <div className={round}>
              <button onClick={p.onType} disabled={sending} className={ghost} aria-label="Type instead"><Keyboard className="h-5 w-5" /></button>
              <span className={lbl}>Type</span>
            </div>
          )
        )}

        {p.answer && (
          <div className={round}>
            <div className="relative">
              {talking && (
                <div className="pointer-events-none absolute left-1/2 top-1/2 flex h-10 w-[220px] -translate-x-1/2 -translate-y-[calc(50%+58px)] items-center gap-[3px]" aria-hidden>
                  {p.levels.slice(-28).map((l, i) => (
                    <span key={i} className="flex-1 rounded-full bg-brand-600" style={{ height: `${12 + l * 88}%`, opacity: 0.3 + l * 0.7 }} />
                  ))}
                </div>
              )}
              <button
                onPointerDown={p.mic.down}
                onPointerUp={p.mic.up}
                onClick={p.mic.click}
                disabled={sending}
                aria-label={talking ? "Stop and send" : "Talk (tap, or hold to talk)"}
                aria-pressed={talking}
                className={cn(
                  "relative flex h-[72px] w-[72px] touch-none select-none items-center justify-center rounded-full text-white transition-all duration-200",
                  talking ? "scale-105 bg-brand-800 shadow-[0_0_0_10px_rgba(122,30,58,0.12)]" : "bg-brand-700 shadow-[0_10px_28px_-10px_rgba(122,30,58,.75)] hover:bg-brand-800",
                  sending && "opacity-80",
                )}
              >
                {sending ? <Loader2 className="h-6 w-6 animate-spin" /> : talking ? <Square className="h-5 w-5 fill-current" /> : <Mic className="h-7 w-7" />}
              </button>
            </div>
            <span className={cn(lbl, talking && "tnum text-brand-700")}>{talking ? `Done · ${fmtClock(p.elapsed)}` : sending ? "Saving" : "Talk"}</span>
          </div>
        )}

        {!talking && add && (
          <div className={round} ref={addRef}>
            <div className="relative">
              <button onClick={() => p.setAddOpen(!p.addOpen)} disabled={sending} className={ghost} aria-label="Show me something" aria-expanded={p.addOpen} aria-haspopup="menu">
                <Plus className={cn("h-5 w-5 transition-transform", p.addOpen && "rotate-45")} />
              </button>
              <AnimatePresence>
                {p.addOpen && (
                  <motion.div
                    role="menu"
                    initial={{ opacity: 0, y: 8, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 6, scale: 0.97 }}
                    transition={{ duration: 0.15 }}
                    className="absolute bottom-[calc(100%+12px)] left-1/2 z-30 w-[244px] -translate-x-1/2 overflow-hidden rounded-2xl border border-line bg-white p-1.5 text-left shadow-lift"
                  >
                    {add.modes.includes("screen") && <AddItem icon={MonitorUp} label="Share screen" hint="Show me how you do it" onClick={p.onScreen} />}
                    {add.modes.includes("upload") && <AddItem icon={Upload} label="Upload" hint="Files, photos or videos" onClick={p.onUpload} />}
                    {add.modes.includes("phone") && <AddItem icon={Smartphone} label="Use your phone" hint="Walk me around the floor" onClick={p.onPhone} />}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <span className={lbl}>Show me</span>
          </div>
        )}

        {!talking && skip && (
          <div className={round}>
            <button onClick={p.onSkip} disabled={sending || p.busy === "skip"} className={ghost} aria-label="Skip this question"><SkipForward className="h-5 w-5" /></button>
            <span className={lbl}>Skip</span>
          </div>
        )}

        {!talking && fin && (
          <div className={round}>
            <button onClick={p.onFinish} disabled={sending || p.busy === "finish"} className={cn(ghost, "w-auto px-5 text-[14px] font-medium text-brand-800")}>
              {p.busy === "finish" ? <Loader2 className="h-4 w-4 animate-spin" /> : fin.label || "I'm done"}
            </button>
            <span className={lbl}>Finish</span>
          </div>
        )}
      </div>
    </div>
  );
}

function AddItem({ icon: I, label, hint, onClick }: { icon: typeof Mic; label: string; hint: string; onClick: () => void }) {
  return (
    <button role="menuitem" onClick={onClick} className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 hover:bg-paper">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700"><I className="h-[18px] w-[18px]" /></span>
      <span className="leading-tight">
        <span className="block text-[14px] font-medium text-ink">{label}</span>
        <span className="block text-[12px] text-ink-muted">{hint}</span>
      </span>
    </button>
  );
}

function ScreenPip({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="absolute bottom-28 right-5 z-20 w-[240px] overflow-hidden rounded-xl border border-line bg-[#141416] shadow-lift sm:w-[300px]">
      <video ref={ref} autoPlay muted playsInline className="aspect-video w-full object-contain" />
      <span className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white">
        <span className="h-1.5 w-1.5 rounded-full bg-[#E5484D]" /> I'm watching
      </span>
    </motion.div>
  );
}

export type { Msg };
