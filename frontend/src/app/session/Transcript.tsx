import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { FileText, Film, Image as ImageIcon, MonitorUp } from "lucide-react";
import { mediaUrl } from "@/lib/api";
import { cn } from "@/lib/format";
import { Orb } from "../../shared/Orb";
import { GapBadge, ProofChip, fmtTime } from "../../shared/bits";
import type { Card, Proof } from "../../shared/types";
import type { EvidencePayload, Msg, Provider, ReadingPayload, SummaryPayload, UploadPayload, WalkPayload } from "../types";
import { CardPill, ProviderTile, ReadingCounters } from "./parts";
import { PrivacyButton } from "./Privacy";

export function Transcript({
  messages, pending, providers, onConnect, connectBusy, onOpen, liveReadingId, className, connectTiles = true, onPrivacy,
}: {
  onPrivacy?: () => void;
  connectTiles?: boolean;
  messages: Msg[];
  pending: string | null;
  providers: Provider[] | null;
  onConnect: (p: Provider) => void;
  connectBusy: string | null;
  onOpen: (p: Proof) => void;
  liveReadingId: string | number | null;
  className?: string;
}) {
  const end = useRef<HTMLDivElement>(null);
  const last = messages[messages.length - 1]?.id;
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [last, pending, messages.length]);
  const lastConnect = [...messages].reverse().find((m) => m.kind === "connect")?.id;
  return (
    <div className={cn("scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-5", className)} aria-live="polite">
      {!messages.length && !pending && <p className="px-2 pt-10 text-center text-[13px] text-ink-faint">Your conversation will appear here.</p>}
      <div className="space-y-3.5">
        {messages.map((m) => (
          <Row key={m.id} m={m}>
            <Rich m={m} tiles={connectTiles} providers={m.id === lastConnect ? providers : null} onConnect={onConnect} connectBusy={connectBusy} onOpen={onOpen} live={m.id === liveReadingId} onPrivacy={onPrivacy} />
          </Row>
        ))}
        {pending && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 0.7, y: 0 }} className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-700 px-3.5 py-2 text-[14px] text-white">{pending}</div>
          </motion.div>
        )}
      </div>
      <div ref={end} />
    </div>
  );
}

function Row({ m, children }: { m: Msg; children: React.ReactNode }) {
  if (m.role === "system")
    return (
      <div className="flex justify-center">
        <span className="rounded-full bg-white px-3 py-1 text-[12px] text-ink-muted ring-1 ring-inset ring-line">{m.text}</span>
      </div>
    );
  if (m.role === "user")
    return (
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-end">
        {m.kind === "upload" ? children : <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-brand-700 px-3.5 py-2 text-[14px] leading-snug text-white">{m.text}</div>}
        <span className="mt-1 text-[11px] text-ink-faint">{fmtTime(m.at)}</span>
      </motion.div>
    );
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex items-start gap-2">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center" aria-hidden>
        <Orb size={26} state="idle" />
      </span>
      <div className="min-w-0 flex-1">
        {m.text?.trim() ? (
          <div className="rounded-2xl rounded-tl-md border border-line bg-white px-3.5 py-2 text-[14px] leading-snug text-ink shadow-card">{m.text}</div>
        ) : null}
        {children}
      </div>
    </motion.div>
  );
}

function Rich({
  m, providers, onConnect, connectBusy, onOpen, live, tiles, onPrivacy,
}: { m: Msg; tiles: boolean; providers: Provider[] | null; onConnect: (p: Provider) => void; connectBusy: string | null; onOpen: (p: Proof) => void; live: boolean; onPrivacy?: () => void }) {
  switch (m.kind) {
    case "connect": {
      const list = providers ?? ((m.payload as { providers?: Provider[] })?.providers || []);
      if (!tiles) return null;
      return (
        <div className="mt-2 space-y-2">
          {list.filter((p) => p.key !== "files").map((p) => <ProviderTile key={p.key} p={p} compact onConnect={onConnect} busy={connectBusy === p.key} />)}
        </div>
      );
    }
    case "reading": {
      const p = m.payload as ReadingPayload | undefined;
      if (!p?.counters) return null;
      return (
        <div className="mt-2 rounded-2xl border border-line bg-white p-3">
          <ReadingCounters p={p} live={live} compact />
          {onPrivacy && <div className="mt-2 flex justify-center"><PrivacyButton compact onClick={onPrivacy} /></div>}
        </div>
      );
    }
    case "evidence": {
      const p = m.payload as EvidencePayload | undefined;
      if (!p) return null;
      return (
        <div className="mt-2 space-y-1.5">
          <GapBadge type={p.gap_type} className="!text-[11.5px]" />
          <div className="flex flex-wrap gap-1.5">
            {(p.sources || []).map((s, i) => <ProofChip key={i} proof={s} onOpen={onOpen} className="!text-[12px]" />)}
          </div>
        </div>
      );
    }
    case "cards": {
      const cards = (m.payload as { cards?: Card[] })?.cards || [];
      return (
        <div className="mt-2 space-y-1.5">
          {cards.map((c) => <CardPill key={c.id} card={c} />)}
        </div>
      );
    }
    case "upload": {
      const p = m.payload as UploadPayload | undefined;
      return (
        <div className="flex max-w-[85%] flex-col items-end gap-1.5">
          {(p?.files || []).map((f, i) => {
            const I = p?.screen ? MonitorUp : /^image\//.test(f.type) ? ImageIcon : /^video\//.test(f.type) ? Film : FileText;
            return (
              <span key={i} className="inline-flex max-w-full items-center gap-2 rounded-xl bg-brand-700 px-3 py-2 text-[13.5px] text-white">
                <I className="h-4 w-4 shrink-0 opacity-80" /> <span className="truncate">{f.name}</span>
              </span>
            );
          })}
        </div>
      );
    }
    case "walk": {
      const p = m.payload as WalkPayload | undefined;
      if (!p?.items?.length) return null;
      return (
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {p.items.slice(0, 6).map((f) => (
            <img key={f.seq} src={mediaUrl(f.frame_url)} alt={f.label} className="aspect-[4/3] w-full rounded-lg border border-line bg-[#1d1f24] object-cover" />
          ))}
        </div>
      );
    }
    case "summary": {
      const s = m.payload as SummaryPayload | undefined;
      if (!s) return null;
      return (
        <div className="mt-2 flex items-center gap-3 rounded-2xl border border-[#CFE5D8] bg-sure-bg/60 px-3.5 py-2.5 text-[13.5px] text-[#24573E]">
          <span className="font-display text-[22px] leading-none text-ink">{s.coverage_before}% → {s.coverage_after}%</span>
          <span>{s.cards ?? 0} cards, {s.verified ?? 0} in your words</span>
        </div>
      );
    }
    default:
      return null;
  }
}
