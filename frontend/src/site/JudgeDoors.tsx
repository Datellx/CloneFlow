// Two one-click doors for hackathon judges (and anyone evaluating Clone Flow), no account needed:
// a view-only tour of a real finished handover, and a private demo workspace where you are the one being interviewed.
import { useState } from "react";
import { ArrowRight, Compass, Loader2, MessagesSquare } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { request } from "@/lib/api";
import { cn } from "@/lib/format";

type Info = { tour: boolean; tour_org: string | null; try: boolean };

export function JudgeDoors({ className, compact }: { className?: string; compact?: boolean }) {
  const info = useQuery({ queryKey: ["demo-info"], queryFn: () => request<Info>("/demo/info"), staleTime: 60_000, retry: false });
  const [busy, setBusy] = useState<"tour" | "try" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  if (!info.data || (!info.data.tour && !info.data.try)) return null;

  const go = async (kind: "tour" | "try") => {
    setErr(null);
    setBusy(kind);
    try {
      const r = await request<{ next: string }>(`/demo/${kind}`, { method: "POST", json: kind === "try" ? { name } : {} });
      window.location.assign(r.next);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby="judges" className={cn("w-full max-w-[880px] rounded-[22px] border border-line bg-white p-5 text-left shadow-card sm:p-6", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="judges" className="font-sans text-[12.5px] font-semibold uppercase tracking-[0.14em] text-brand-700">
          Meta AI Hackathon judges · try it now, no account
        </h2>
        {!compact && <span className="text-[12.5px] text-ink-muted">Live product, live Meta models</span>}
      </div>
      <div className={cn("mt-4 grid gap-3", !compact && "sm:grid-cols-2")}>
        {info.data.tour && (
          <div className="flex flex-col rounded-2xl bg-paper p-4 ring-1 ring-inset ring-line">
            <div className="flex items-center gap-2 text-[15px] font-medium text-ink"><Compass className="h-4 w-4 text-brand-700" /> Tour a finished handover</div>
            <p className="mt-1.5 flex-1 text-[13.5px] leading-relaxed text-ink-muted">
              {info.data.tour_org}: Maya Lee's knowledge, captured from her Gmail, Outlook and Teams, her screen share and her
              robot-arm video (SAM 3.1). Open any card's proof, and ask a question the way her successor does in Teams. View-only.
            </p>
            <button type="button" onClick={() => go("tour")} disabled={!!busy}
              className="mt-3 inline-flex h-10 items-center justify-center gap-2 rounded-full bg-brand-700 px-5 text-[14px] font-medium text-white transition-colors hover:bg-brand-800 disabled:opacity-60">
              {busy === "tour" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Start the tour <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        )}
        {info.data.try && (
          <div className="flex flex-col rounded-2xl bg-paper p-4 ring-1 ring-inset ring-line">
            <div className="flex items-center gap-2 text-[15px] font-medium text-ink"><MessagesSquare className="h-4 w-4 text-brand-700" /> Be the one leaving</div>
            <p className="mt-1.5 flex-1 text-[13.5px] leading-relaxed text-ink-muted">
              A private workspace just for you. Tell Clone Flow about your job; it asks what only you know. Talk or type, share your
              screen, or upload a video of a hands-on task.
            </p>
            <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); go("try"); }}>
              <label htmlFor="judge-name" className="sr-only">Your first name</label>
              <input id="judge-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your first name" maxLength={60}
                className="h-10 min-w-0 flex-1 rounded-full border border-line bg-white px-4 text-[14px] text-ink outline-none focus:border-brand-300" />
              <button type="submit" disabled={!!busy}
                className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full bg-white px-4 text-[14px] font-medium text-ink ring-1 ring-inset ring-line-strong transition-colors hover:ring-ink-faint disabled:opacity-60">
                {busy === "try" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Try it yourself
              </button>
            </form>
          </div>
        )}
      </div>
      {err && <p role="alert" className="mt-3 text-[13px] text-[#8E1F1F]">{err}</p>}
    </section>
  );
}
