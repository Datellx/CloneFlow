import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import {
  ChevronDown, ChevronRight, EyeOff, File, FileSpreadsheet, FileText, FileVideo, Hash, Image as ImageIcon,
  Loader2, Mail, MessageSquare, Mic, Play, Smartphone, Undo2, X } from "lucide-react";
import { mediaUrl } from "@/lib/api";
import { cn } from "@/lib/format";
import { Button, ErrorState, Skeleton } from "@/components/ui";
import { knowledge } from "./api";
import { DataTable, Markdown, PersonAvatar, fmtClock, fmtDay, fmtTime, proofLabel } from "./bits";
import type { ChatMsg, FileDetail, MailDetail, Proof } from "./types";

/* =================================================================== sheet */
function Sheet({
  open, onClose, title, subtitle, icon, children, actions,
}: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; icon?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-stretch justify-center p-0 sm:p-5 lg:p-7">
          <motion.div className="absolute inset-0 bg-[#2A0E17]/25 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, y: 16, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.99 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="relative flex w-full max-w-[1320px] flex-col overflow-hidden bg-white shadow-lift sm:rounded-2xl sm:border sm:border-line"
          >
            <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-4 sm:px-5">
              {icon}
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate text-[15px] font-semibold text-ink">{title}</div>
                {subtitle && <div className="truncate text-[12.5px] text-ink-muted">{subtitle}</div>}
              </div>
              {actions}
              <button onClick={onClose} className="-mr-1 rounded-lg p-1.5 text-ink-muted hover:bg-paper hover:text-ink" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/* =================================================================== mailbox */

function splitQuoted(body: string) {
  const lines = body.split("\n");
  const i = lines.findIndex((l) => /^>/.test(l) || /^On .+wrote:$/.test(l.trim()));
  if (i < 0) return { main: body, quoted: "" };
  return { main: lines.slice(0, i).join("\n").trimEnd(), quoted: lines.slice(i).join("\n") };
}

function MailBody({ text }: { text: string }) {
  const { main, quoted } = splitQuoted(text);
  const [show, setShow] = useState(false);
  return (
    <div className="text-[14.5px] leading-[1.65] text-ink-soft">
      <div className="whitespace-pre-wrap">{main}</div>
      {quoted && (
        <div className="mt-3">
          <button onClick={() => setShow((v) => !v)} className="inline-flex items-center gap-1 rounded-md bg-paper px-2 py-0.5 text-xs font-medium text-ink-muted hover:text-ink" aria-expanded={show}>
            {show ? "Hide quoted text" : "Show quoted text"} <span aria-hidden>···</span>
          </button>
          {show && <div className="mt-2 whitespace-pre-wrap border-l-2 border-line pl-3 text-[13.5px] text-ink-muted">{quoted.replace(/^> ?/gm, "")}</div>}
        </div>
      )}
    </div>
  );
}

function ExcludeButton({ kind, id, excluded, onChange }: { kind: "mail" | "chat" | "file"; id: string; excluded: boolean; onChange: (v: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const go = async () => {
    setBusy(true);
    try {
      await knowledge.exclude(kind, id, !excluded);
      onChange(!excluded);
      qc.invalidateQueries({ queryKey: ["kb"] });
      toast.success(excluded ? "Included again. Clone Flow can read this." : "Excluded. Clone Flow will never read this.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button size="sm" variant={excluded ? "subtle" : "secondary"} loading={busy} onClick={go} icon={excluded ? <Undo2 className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}>
      {excluded ? "Include again" : "Exclude from Clone Flow"}
    </Button>
  );
}

function MailReader({ id, compact }: { id: string; compact?: boolean }) {
  const q = useQuery({ queryKey: ["kb", "mailItem", id], queryFn: () => knowledge.mailItem(id) });
  const [excluded, setExcluded] = useState<boolean | null>(null);
  useEffect(() => setExcluded(null), [id]);
  if (q.isLoading)
    return (
      <div className="space-y-3 p-8">
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="mt-6 h-24 w-full" />
      </div>
    );
  if (q.error) return <div className="p-6"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>;
  const m = q.data as MailDetail & { noise_tag?: string | null };
  const ex = excluded ?? m.excluded;
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className={cn("mx-auto max-w-[760px]", compact ? "px-5 py-5" : "px-8 py-7")}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className={cn("font-normal leading-tight text-ink", compact ? "text-[21px]" : "text-[25px]")}>{m.subject}</h2>
          {!compact && <ExcludeButton kind="mail" id={m.id} excluded={ex} onChange={setExcluded} />}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          <span>{m.folder.replace("Projects/", "Projects › ")}</span>
          {m.thread.length > 1 && <span>· {m.thread.length} messages</span>}
          {m.is_noise && <span className="rounded-md bg-[#F1ECEA] px-1.5 py-0.5 font-medium">Filtered: {m.noise_tag || "notification"}. Never sent to AI.</span>}
          {ex && <span className="rounded-md bg-[#F1ECEA] px-1.5 py-0.5 font-medium">Excluded. Never sent to AI.</span>}
        </div>
        <div className="mt-5 space-y-4">
          {m.thread.map((t) => (
            <article key={t.id} className={cn("rounded-xl border p-4", t.id === m.id ? "border-line-strong bg-white" : "border-line bg-paper/50")}>
              <header className="mb-3 flex items-center gap-3">
                <PersonAvatar name={t.from_name} size={34} />
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="truncate text-[14px] font-medium text-ink">
                    {t.from_name} <span className="font-normal text-ink-muted">&lt;{t.from_email}&gt;</span>
                  </div>
                  <div className="truncate text-xs text-ink-muted">to {t.to.join(", ")}</div>
                </div>
                <time className="tnum shrink-0 text-xs text-ink-faint">{fmtDay(t.sent_at, { year: true })}, {fmtTime(t.sent_at)}</time>
              </header>
              <MailBody text={t.body_text} />
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

/* =================================================================== chat */
function ChatViewer({ eid, initialChannel, highlight }: { eid: number; initialChannel?: string; highlight?: string }) {
  const ch = useQuery({ queryKey: ["kb", "chat", eid], queryFn: () => knowledge.chat(eid) });
  const [sel, setSel] = useState<string | null>(initialChannel ?? null);
  useEffect(() => {
    if (!sel && ch.data?.channels.length) setSel(ch.data.channels[0].id);
  }, [ch.data, sel]);
  const channels = ch.data?.channels ?? [];
  const cur = channels.find((c) => c.id === sel);
  return (
    <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)]">
      <div className="scroll-thin hidden min-h-0 overflow-y-auto border-r border-line bg-[#F7F4F3] p-2 md:block">
        {ch.isLoading && <div className="space-y-2 p-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-7" />)}</div>}
        {(["channel", "dm"] as const).map((k) => (
          <div key={k} className="mb-3">
            <div className="px-2.5 pb-1 pt-2 text-xs font-medium text-ink-muted">{k === "channel" ? "Channels" : "Direct messages"}</div>
            {channels.filter((c) => c.kind === k).map((c) => (
              <button
                key={c.id}
                onClick={() => setSel(c.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13.5px]",
                  sel === c.id ? "bg-white font-medium text-ink shadow-card ring-1 ring-line" : "text-ink-soft hover:bg-white/70",
                )}
              >
                {k === "channel" ? <Hash className="h-4 w-4 text-ink-muted" /> : <PersonAvatar name={c.name} size={20} />}
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="tnum text-xs text-ink-faint">{c.count}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="flex min-h-0 flex-col">
        {cur && (
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-5">
            {cur.kind === "channel" ? <Hash className="h-4 w-4 text-ink-muted" /> : <PersonAvatar name={cur.name} size={22} />}
            <span className="text-[14.5px] font-semibold text-ink">{cur.name}</span>
            <span className="truncate text-xs text-ink-muted">{cur.members.join(", ")}</span>
          </div>
        )}
        {sel && <ChannelStream cid={sel} highlight={highlight} />}
      </div>
    </div>
  );
}

function ChannelStream({ cid, highlight }: { cid: string; highlight?: string }) {
  const q = useQuery({ queryKey: ["kb", "channel", cid], queryFn: () => knowledge.channel(cid) });
  const [openThreads, setOpenThreads] = useState<Record<string, boolean>>({});
  const items = q.data?.items ?? [];
  const roots = items.filter((m) => !m.thread_id);
  const replies = (id: string) => items.filter((m) => m.thread_id === id);
  useEffect(() => {
    if (!highlight) return;
    const hit = items.find((m) => m.id === highlight);
    if (hit?.thread_id) setOpenThreads((s) => ({ ...s, [hit.thread_id!]: true }));
    setTimeout(() => document.getElementById(`msg-${highlight}`)?.scrollIntoView({ block: "center" }), 60);
  }, [highlight, q.data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (q.isLoading) return <div className="space-y-4 p-6">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>;
  if (q.error) return <div className="p-6"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>;
  let lastDay = "";
  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 py-3 sm:px-4">
      {roots.map((m) => {
        const day = fmtDay(m.sent_at, { year: true });
        const showDay = day !== lastDay;
        lastDay = day;
        const rs = replies(m.id);
        const open = openThreads[m.id];
        return (
          <div key={m.id}>
            {showDay && (
              <div className="my-3 flex items-center gap-3 px-3 text-xs font-medium text-ink-faint">
                <span className="h-px flex-1 bg-line" /> {day} <span className="h-px flex-1 bg-line" />
              </div>
            )}
            <ChatMessage m={m} highlight={highlight === m.id} />
            {(m.reply_count > 0 || rs.length > 0) && (
              <div className="ml-[60px]">
                <button
                  onClick={() => setOpenThreads((s) => ({ ...s, [m.id]: !open }))}
                  className="mb-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12.5px] font-medium text-brand-700 hover:bg-brand-50"
                  aria-expanded={!!open}
                >
                  {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  {Math.max(m.reply_count, rs.length)} {Math.max(m.reply_count, rs.length) === 1 ? "reply" : "replies"}
                </button>
                {open && <div className="border-l-2 border-line pl-2">{rs.map((r) => <ChatMessage key={r.id} m={r} small highlight={highlight === r.id} />)}</div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ChatMessage({ m, small, highlight }: { m: ChatMsg & { excluded?: boolean }; small?: boolean; highlight?: boolean }) {
  const [ex, setEx] = useState(!!m.excluded);
  return (
    <div id={`msg-${m.id}`} className={cn("group relative flex gap-3 rounded-xl px-3 py-2 hover:bg-paper", highlight && "bg-maybe-bg ring-1 ring-[#F1DDB8] hover:bg-maybe-bg", ex && "opacity-55")}>
      <PersonAvatar name={m.author} size={small ? 28 : 36} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[13.5px] font-semibold text-ink">{m.author}</span>
          <time className="text-xs text-ink-faint">{fmtTime(m.sent_at)}</time>
          {ex && <span className="text-[11px] font-medium text-ink-muted">Excluded</span>}
        </div>
        <p className="mt-0.5 whitespace-pre-wrap text-[14.5px] leading-relaxed text-ink-soft">{m.text}</p>
        {m.reactions.length > 0 && (
          <div className="mt-1.5 flex gap-1.5">
            {m.reactions.map((r) => (
              <span key={r.emoji} className="inline-flex items-center gap-1 rounded-full border border-line bg-white px-2 py-0.5 text-xs">
                <span>{r.emoji}</span> <span className="tnum text-ink-muted">{r.count}</span>
              </span>
            ))}
          </div>
        )}
      </div>
      <button
        onClick={async () => {
          try {
            await knowledge.exclude("chat", m.id, !ex);
            setEx(!ex);
            toast.success(ex ? "Included again." : "Excluded. Clone Flow will never read this message.");
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
        className="absolute right-2 top-2 hidden items-center gap-1 rounded-md border border-line bg-white px-2 py-1 text-xs font-medium text-ink-muted shadow-card hover:text-ink group-hover:inline-flex group-focus-within:inline-flex"
      >
        {ex ? <Undo2 className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />} {ex ? "Include" : "Exclude"}
      </button>
    </div>
  );
}

/* =================================================================== files */
const FILE_ICON: Record<string, typeof File> = { doc: FileText, text: FileText, sheet: FileSpreadsheet, pdf: File, image: ImageIcon, video: FileVideo, other: File };

function fmtSize(b: number) {
  if (b > 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  if (b > 1e3) return `${Math.round(b / 1e3)} KB`;
  return `${b} B`;
}

function FilePreview({ id, compact, highlight }: { id: string; compact?: boolean; highlight?: string }) {
  const q = useQuery({ queryKey: ["kb", "file", id], queryFn: () => knowledge.file(id) });
  const [ex, setEx] = useState<boolean | null>(null);
  useEffect(() => setEx(null), [id]);
  if (q.isLoading) return <div className="space-y-3 p-8"><Skeleton className="h-6 w-1/3" /><Skeleton className="h-40 w-full" /></div>;
  if (q.error) return <div className="p-6"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>;
  const f = q.data as FileDetail & { excluded?: boolean };
  const I = FILE_ICON[f.kind] ?? File;
  const excluded = ex ?? !!f.excluded;
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className={cn("mx-auto max-w-[820px]", compact ? "px-5 py-5" : "px-8 py-6")}>
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-paper text-ink-muted ring-1 ring-line"><I className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[15px] font-semibold text-ink">{f.name}</div>
            <div className="truncate text-xs text-ink-muted">{f.path.split("/").slice(0, -1).join(" › ")} · {fmtSize(f.size)} · edited {fmtDay(f.modified_at, { year: true })}</div>
          </div>
          {!compact && (
            <ExcludeButton kind="file" id={f.id} excluded={excluded} onChange={setEx} />
          )}
        </div>
        {f.preview.type === "text" && <Markdown text={f.preview.text || ""} />}
        {f.preview.type === "table" && <DataTable rows={f.preview.rows || []} highlight={highlight} />}
        {f.preview.type === "image" && <img src={mediaUrl(f.preview.url)} alt={f.name} className="w-full rounded-xl border border-line" />}
        {f.preview.type === "video" && <video src={mediaUrl(f.preview.url)} controls playsInline className="w-full rounded-xl border border-line bg-black" />}
        {f.preview.type === "none" && (
          <div className="rounded-xl border border-dashed border-line-strong bg-paper/60 px-6 py-12 text-center text-sm text-ink-muted">
            There's no preview for this file type yet. Clone Flow still reads its text.
          </div>
        )}
      </div>
    </div>
  );
}

/* =================================================================== evidence excerpt */
/** A compact rendering of one piece of proof, styled like the viewer it came from. */
function EvidenceExcerpt({ proof, onOpen, tall }: { proof: Proof; onOpen?: (p: Proof) => void; tall?: boolean }) {
  const open = onOpen ? () => onOpen(proof) : undefined;
  const wrap = (children: ReactNode, cls?: string) =>
    open ? (
      <button type="button" onClick={open} className={cn("block w-full text-left transition-shadow hover:shadow-lift focus-visible:shadow-lift", cls)}>
        {children}
      </button>
    ) : (
      <div className={cls}>{children}</div>
    );
  if (proof.kind === "screen" || proof.kind === "floor") {
    return wrap(
      <>
        <div className={cn("relative overflow-hidden bg-[#1d1f24]", tall ? "aspect-video" : "aspect-[16/8]")}>
          {proof.frame_url && <img src={mediaUrl(proof.frame_url)} alt="" className="h-full w-full object-cover" />}
          <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white backdrop-blur">
            {proof.kind === "screen" ? <Play className="h-3 w-3 fill-current" /> : <Smartphone className="h-3 w-3" />}
            {proof.kind === "screen" ? "Screen recording" : "Floor walk"}
            {proof.timestamp_s != null && <span className="tnum">· {fmtClock(proof.timestamp_s)}</span>}
          </span>
        </div>
        {proof.quote && <div className="px-4 py-3 text-[13.5px] text-ink-soft">{proof.quote}</div>}
      </>,
      "overflow-hidden rounded-xl border border-line bg-white",
    );
  }
  if (proof.kind === "interview") {
    return (
      <div className="rounded-xl border border-[#CFE5D8] bg-sure-bg/60 px-4 py-3">
        <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-sure"><Mic className="h-3.5 w-3.5" /> Verified in exit interview</div>
        {proof.quote && <p className="prose-quote text-[16px] leading-snug text-ink">“{proof.quote}”</p>}
      </div>
    );
  }
  const head =
    proof.kind === "email" ? { icon: Mail, kind: "Email" } : proof.kind === "chat" ? { icon: MessageSquare, kind: "Chat" } : { icon: FileText, kind: "File" };
  const H = head.icon;
  return wrap(
    <>
      <div className="flex items-center gap-2 border-b border-line bg-paper/60 px-4 py-2">
        <H className="h-3.5 w-3.5 text-ink-muted" />
        <span className="text-xs font-medium text-ink-muted">{head.kind}</span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{proof.label}</span>
        {open && <span className="shrink-0 text-xs font-medium text-brand-700">Open</span>}
      </div>
      <div className="px-4 py-3">
        {proof.quote ? (
          proof.kind === "file" ? (
            <code className="block whitespace-pre-wrap rounded-lg bg-[#F6F2F1] px-3 py-2 font-mono text-[12.5px] leading-relaxed text-ink">{proof.quote}</code>
          ) : (
            <p className="text-[14px] leading-relaxed text-ink-soft">“{proof.quote}”</p>
          )
        ) : (
          <p className="text-[13.5px] text-ink-muted">Open to see the full {head.kind.toLowerCase()}.</p>
        )}
      </div>
    </>,
    "overflow-hidden rounded-xl border border-line bg-white",
  );
}

/* =================================================================== proof modal */
export function ProofModal({ eid, proof, onClose }: { eid: number; proof: Proof | null; onClose: () => void }) {
  const p = proof;
  const media = p && (p.kind === "screen" || p.kind === "floor");
  const chatChannel = useQuery({
    queryKey: ["kb", "chat-find", p?.ref],
    enabled: !!p && p.kind === "chat" && !!eid,
    retry: false,
    queryFn: async () => {
      const { channels } = await knowledge.chat(eid);
      for (const c of channels) {
        const { items } = await knowledge.channel(c.id);
        if (items.some((m) => m.id === p!.ref)) return c.id;
      }
      return channels[0]?.id ?? null;
    },
  });
  return (
    <Sheet
      open={!!p}
      onClose={onClose}
      title={p ? proofLabel(p) : ""}
      subtitle={p ? { email: "Email", chat: "Chat", file: "File", screen: "Screen recording", floor: "Floor walk", interview: "Exit interview" }[p.kind] : ""}
    >
      {p?.kind === "email" && <MailReader id={p.ref} />}
      {p?.kind === "file" && <FilePreview id={p.ref} highlight={p.quote?.split(" · ")[0]} />}
      {p?.kind === "chat" &&
        (chatChannel.data ? (
          <ChatViewer eid={eid} initialChannel={chatChannel.data} highlight={p.ref} />
        ) : chatChannel.isError || !eid ? (
          <div className="mx-auto max-w-xl p-10"><EvidenceExcerpt proof={p} /></div>
        ) : (
          <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-ink-muted" /></div>
        ))}
      {media && p && <ClipPlayer proof={p} />}
      {p?.kind === "interview" && (
        <div className="mx-auto max-w-xl p-10"><EvidenceExcerpt proof={p} /></div>
      )}
    </Sheet>
  );
}

function ClipPlayer({ proof }: { proof: Proof }) {
  const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(proof.ref);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-[#141416] p-6">
      {isVideo ? (
        <video
          src={mediaUrl(proof.ref)}
          controls
          playsInline
          autoPlay
          className="max-h-full w-full max-w-5xl rounded-xl"
          onLoadedMetadata={(e) => {
            if (proof.timestamp_s != null) e.currentTarget.currentTime = proof.timestamp_s;
          }}
        />
      ) : (
        proof.frame_url && <img src={mediaUrl(proof.frame_url)} alt={proof.label} className="max-h-[calc(100%-60px)] max-w-5xl rounded-xl object-contain" />
      )}
      <div className="flex items-center gap-3 text-sm text-white/80">
        {proof.timestamp_s != null && (
          <span className="tnum inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 font-medium text-white">
            <Play className="h-3.5 w-3.5 fill-current" /> {fmtClock(proof.timestamp_s)}
          </span>
        )}
        <span>{proof.quote || proof.label}</span>
        {!isVideo && <span className="text-white/50">Keyframe from the recording</span>}
      </div>
    </div>
  );
}
