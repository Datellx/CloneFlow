import { useState, type FormEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BadgeCheck, Check, Copy, MoreHorizontal, Paperclip } from "lucide-react";
import { useMe } from "@/lib/api";
import { cn } from "@/lib/format";
import { Button, ErrorState, Skeleton } from "@/components/ui";
import { Orb } from "../../shared/Orb";
import { handoverKeys, useTeamsSetup, handover } from "../api";
import { useTitle } from "../orgs";

/** Admin → Teams: connect an outgoing webhook so people can type "@Clone Flow …" in a channel. */
export default function Teams() {
  useTitle("Teams");
  const me = useMe().data;
  const q = useTeamsSetup();
  const qc = useQueryClient();
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const d = q.data;
  const bot = d?.bot_name || "Clone Flow";
  const org = me?.org.name ?? "your company";

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const s = secret.trim();
    if (!s) return;
    setSaving(true);
    setErr(null);
    try {
      const next = await handover.saveTeams(s);
      qc.setQueryData(handoverKeys.teams, next);
      setSecret("");
      setReplacing(false);
      toast.success("Teams is connected");
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  return (
    <div>
      <header className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[13px] text-ink-muted">{org}</p>
          <h1 className="mt-1 text-[34px] font-normal leading-tight text-ink sm:text-[40px]">Microsoft Teams</h1>
          <p className="mt-1 max-w-[62ch] text-[14.5px] text-ink-muted">
            Let anyone at {org} ask what departing colleagues knew, right in a Teams channel. It takes about two minutes, once.
          </p>
        </div>
        {d ? <StatusPill on={d.configured} /> : <Skeleton className="h-8 w-36 rounded-full" />}
      </header>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_400px]">
        <ol className="card divide-y divide-line overflow-hidden">
          <Step n={1} title="Open the team" art={<ArtManage />}>
            In Teams, find the team where people should ask. Choose <K>⋯</K> next to its name, then <K>Manage team</K>.
          </Step>
          <Step n={2} title="Create an outgoing webhook" art={<ArtApps />}>
            Open the <K>Apps</K> tab and choose <K>Create an outgoing webhook</K>.
          </Step>
          <Step n={3} title="Name it and paste this callback URL" art={<ArtForm bot={bot} />}>
            <p>
              Name: <K>{bot}</K>. Description: anything, for example “Answers from departing colleagues' knowledge”.
            </p>
            <div className="mt-3">
              <div className="mb-1.5 text-[12.5px] font-medium text-ink">Callback URL</div>
              {d ? <CopyField value={d.webhook_url} /> : <Skeleton className="h-11 w-full rounded-xl" />}
            </div>
          </Step>
          <Step n={4} title="Paste the security token here" art={<ArtToken />}>
            <p>When you choose <K>Create</K>, Teams shows a security token once. Copy it and paste it here, so {bot} can check that each message really comes from your team.</p>
            {d?.configured && !replacing ? (
              <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-sure-bg px-3.5 py-3 text-[13.5px] text-sure">
                <Check className="h-4 w-4" /> Token saved.
                <button onClick={() => setReplacing(true)} className="ml-auto text-[13px] font-medium text-ink-soft underline decoration-line-strong underline-offset-2 hover:text-ink">
                  Replace token
                </button>
              </div>
            ) : (
              <form onSubmit={save} className="mt-3 flex flex-col gap-2 sm:flex-row">
                <label htmlFor="teams-secret" className="sr-only">Security token</label>
                <input
                  id="teams-secret"
                  className="input min-w-0 flex-1 font-mono text-[13.5px]"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder="Paste the security token"
                  autoComplete="off"
                  spellCheck={false}
                />
                <Button type="submit" loading={saving} disabled={!secret.trim()} className="shrink-0">Save token</Button>
              </form>
            )}
            {err && <p role="alert" className="mt-2 rounded-lg border border-[#F0D5D5] bg-[#FFF8F8] px-3 py-2 text-[13px] text-[#9B1C1C]">{err}</p>}
          </Step>
          <Step n={5} title="Ask in any channel of that team" last>
            Type <K>@{bot}</K> and a question, for example <span className="text-ink">“@{bot} where are the spare servo horns?”</span> It answers in the thread, with where the answer came from.
          </Step>
        </ol>

        <aside className="xl:sticky xl:top-8 xl:self-start">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-sans text-[14px] font-semibold text-ink">How an answer looks in Teams</h2>
            <span className="text-[12px] text-ink-faint">Preview</span>
          </div>
          <ChannelPreview bot={bot} />
          <p className="mt-3 text-[12.5px] leading-relaxed text-ink-muted">
            Answers come only from knowledge packs in {org}. If nobody covered a question, {bot} says so and suggests who to ask, and the question shows up under “Questions nobody could answer” on People.
          </p>
        </aside>
      </div>
    </div>
  );
}

function StatusPill({ on }: { on: boolean }) {
  return (
    <span className={cn("inline-flex h-8 shrink-0 items-center gap-2 self-start rounded-full px-3.5 text-[13px] font-medium sm:self-auto", on ? "bg-sure-bg text-sure" : "bg-[#F4F0EE] text-ink-muted")}>
      <span className={cn("h-2 w-2 rounded-full", on ? "bg-sure" : "bg-ink-faint")} />
      {on ? "Connected to Teams" : "Not set up yet"}
    </span>
  );
}

function K({ children }: { children: ReactNode }) {
  return <span className="whitespace-nowrap rounded-md bg-paper px-1.5 py-0.5 text-[13px] font-medium text-ink ring-1 ring-inset ring-line">{children}</span>;
}

function Step({ n, title, art, children, last }: { n: number; title: string; art?: ReactNode; children: ReactNode; last?: boolean }) {
  return (
    <li className="flex gap-4 px-5 py-5 sm:px-6">
      <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold", last ? "bg-brand-700 text-white" : "bg-brand-50 text-brand-800")}>{n}</span>
      <div className="min-w-0 flex-1">
        <h3 className="font-sans text-[15px] font-semibold text-ink">{title}</h3>
        <div className="mt-1 flex flex-col gap-4 md:flex-row md:items-start">
          <div className="min-w-0 flex-1 text-[14px] leading-relaxed text-ink-soft">{children}</div>
          {art && <div className="hidden w-[208px] shrink-0 md:block" aria-hidden>{art}</div>}
        </div>
      </div>
    </li>
  );
}

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    navigator.clipboard?.writeText(value).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      },
      () => toast.error("Couldn't copy. Select the URL and copy it yourself."),
    );
  return (
    <div className="flex items-center gap-2 rounded-xl border border-line bg-paper p-1.5 pl-3">
      <code className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink" title={value}>{value}</code>
      <button
        onClick={copy}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12.5px] font-medium text-ink-soft hover:border-line-strong hover:text-ink"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-sure" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ small step illustrations (our own styling) */
function Mini({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("overflow-hidden rounded-xl border border-line bg-[#FAF8F8] p-2.5 text-[10.5px] leading-tight text-ink-soft", className)}>{children}</div>;
}
function ArtManage() {
  return (
    <Mini>
      <div className="mb-1.5 text-[9.5px] font-semibold uppercase tracking-wide text-ink-faint">Your teams</div>
      <div className="flex items-center gap-1.5 rounded-md bg-white px-1.5 py-1 ring-1 ring-line">
        <span className="h-4 w-4 rounded bg-brand-700" />
        <span className="flex-1 font-medium text-ink">Production</span>
        <MoreHorizontal className="h-3 w-3 text-ink" />
      </div>
      <div className="ml-auto mt-1 w-[120px] rounded-md bg-white py-1 shadow-lift ring-1 ring-line">
        <div className="px-2 py-0.5 text-ink-faint">Add channel</div>
        <div className="bg-brand-50 px-2 py-0.5 font-medium text-brand-800">Manage team</div>
        <div className="px-2 py-0.5 text-ink-faint">Leave team</div>
      </div>
    </Mini>
  );
}
function ArtApps() {
  return (
    <Mini>
      <div className="flex gap-3 border-b border-line pb-1 text-ink-faint">
        <span>Members</span>
        <span>Channels</span>
        <span className="-mb-[5px] border-b-2 border-brand-700 pb-[3px] font-medium text-ink">Apps</span>
      </div>
      <div className="mt-2.5 space-y-1.5">
        <div className="h-2 w-3/4 rounded bg-line" />
        <div className="h-2 w-1/2 rounded bg-line" />
      </div>
      <div className="mt-2.5 inline-flex rounded-md bg-brand-700 px-2 py-1 font-medium text-white">Create an outgoing webhook</div>
    </Mini>
  );
}
function ArtForm({ bot }: { bot: string }) {
  return (
    <Mini className="space-y-1.5">
      <div>
        <div className="text-ink-faint">Name</div>
        <div className="mt-0.5 rounded bg-white px-1.5 py-1 font-medium text-ink ring-1 ring-line">{bot}</div>
      </div>
      <div>
        <div className="text-ink-faint">Callback URL</div>
        <div className="mt-0.5 truncate rounded bg-white px-1.5 py-1 font-mono text-[9.5px] text-ink ring-1 ring-brand-300">https://…/teams/webhook</div>
      </div>
      <div className="flex justify-end">
        <span className="rounded bg-brand-700 px-2 py-0.5 font-medium text-white">Create</span>
      </div>
    </Mini>
  );
}
function ArtToken() {
  return (
    <Mini>
      <div className="font-medium text-ink">Security token</div>
      <div className="mt-1 text-ink-faint">Copy it now. It won't be shown again.</div>
      <div className="mt-2 flex items-center gap-1.5 rounded bg-white px-1.5 py-1 ring-1 ring-line">
        <span className="flex-1 truncate font-mono text-[9.5px] text-ink">q8Zr…•••••••••••••=</span>
        <Copy className="h-3 w-3 text-brand-700" />
      </div>
    </Mini>
  );
}

/* ------------------------------------------------------------------ channel preview */
function ChannelPreview({ bot }: { bot: string }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-card">
      <div className="flex items-center gap-2 border-b border-line bg-[#FAF8F8] px-4 py-2.5">
        <span className="text-[13px] font-semibold text-ink"># general</span>
        <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-ink-muted ring-1 ring-inset ring-line">Preview</span>
      </div>
      <div className="space-y-4 px-4 py-4">
        <div className="flex gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#3F5C4A] text-[11.5px] font-semibold text-white">TM</span>
          <div className="min-w-0">
            <div className="text-[12.5px]"><span className="font-semibold text-ink">A teammate</span> <span className="text-ink-faint">9:14 AM</span></div>
            <p className="mt-0.5 text-[13.5px] text-ink">
              <span className="rounded bg-brand-50 px-1 font-medium text-brand-800">@{bot}</span> where are the spare servo horns?
            </p>
          </div>
        </div>
        <div className="ml-[42px] border-l-2 border-line pl-3">
          <div className="flex gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-visible rounded-full bg-brand-50">
              <Orb size={32} state="idle" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[12.5px]">
                <span className="font-semibold text-ink">{bot}</span>
                <span className="rounded bg-paper px-1 py-px text-[10.5px] font-medium text-ink-muted ring-1 ring-inset ring-line">Bot</span>
                <span className="text-ink-faint">9:14 AM</span>
              </div>
              <p className="mt-1 text-[13.5px] leading-relaxed text-ink">
                In the Line 2 parts cage, bin C4 on the top shelf. Spares are reordered from Kaihong when fewer than 20 are left.
              </p>
              <div className="mt-2 flex items-center gap-1.5 text-[12px] text-sure">
                <BadgeCheck className="h-3.5 w-3.5" /> From a captured handover, in the person's own words
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {["Floor walk, 0:42", "#purchasing, Sep 12"].map((s) => (
                  <span key={s} className="inline-flex items-center gap-1 rounded-md bg-paper px-1.5 py-0.5 text-[11.5px] text-ink-soft ring-1 ring-inset ring-line">
                    <Paperclip className="h-3 w-3 text-ink-faint" /> {s}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
