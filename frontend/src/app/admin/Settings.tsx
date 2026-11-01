// /admin/settings — the organization, its plan (Starter is free; Growth and Pro through us), and the desktop apps.
import { Link } from "react-router-dom";
import { Check, ChevronRight, Laptop, Monitor, Sparkles } from "lucide-react";
import { useMe, useStatus } from "@/lib/api";
import { cn } from "@/lib/format";
import { Skeleton } from "@/components/ui";
import { useOverview } from "../api";
import { useTitle } from "../orgs";

export default function Settings() {
  useTitle("Settings & plan");
  const me = useMe().data;
  const status = useStatus().data;
  const ov = useOverview().data;
  const plans = status?.plans ?? [];
  const current = ov?.plan?.key ?? me?.org.plan?.key ?? "starter";
  const dl = status?.download;

  return (
    <div className="max-w-[960px]">
      <h1 className="text-[34px] font-normal leading-tight text-ink sm:text-[40px]">Settings & plan</h1>
      <p className="mt-1 text-[14.5px] text-ink-muted">Your organization, your plan and the desktop apps.</p>

      <section className="card mt-8 divide-y divide-line" aria-label="Organization">
        {[
          ["Organization", me?.org.name],
          ["Admin", me ? `${me.user.name} · ${me.user.email}` : ""],
          ["Created", me ? new Date(me.org.created_at).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }) : ""],
        ].map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-4 px-5 py-3.5 text-sm sm:px-6">
            <span className="text-ink-muted">{k}</span>
            <span className="text-right font-medium text-ink">{v || <Skeleton className="h-4 w-32" />}</span>
          </div>
        ))}
        <Link to="/setup" className="flex items-center justify-between gap-4 px-5 py-3.5 text-sm transition-colors hover:bg-paper sm:px-6">
          <span className="inline-flex items-center gap-2 text-ink"><Sparkles className="h-4 w-4 text-brand-700" /> What Clone Flow knows about {me?.org.name ?? "you"}</span>
          <span className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-700">Talk to the setup assistant <ChevronRight className="h-3.5 w-3.5" /></span>
        </Link>
      </section>

      <h2 className="mt-10 font-sans text-[15px] font-semibold text-ink">Plans</h2>
      <p className="mt-1 text-[13.5px] text-ink-muted">Plans differ by how many people leaving you can hand over. Everything else is included.</p>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {plans.map((p) => {
          const on = p.key === current;
          return (
            <div key={p.key} className={cn("relative flex flex-col rounded-[18px] border p-5", on ? "border-brand-700 bg-paper shadow-[0_0_0_4px_rgba(122,30,58,0.08)]" : "border-line bg-white")}>
              {on && <span className="absolute -top-3 left-5 rounded-full bg-brand-700 px-2.5 py-0.5 text-[11.5px] font-semibold text-white">Your plan</span>}
              <div className="text-[16px] font-semibold text-ink">{p.name}</div>
              <div className="mt-0.5 text-[13px] text-ink-muted">{p.blurb}</div>
              <div className="mt-4 flex items-baseline gap-1.5">
                <span className="tnum font-display text-[34px] leading-none text-ink">{p.employees}</span>
                <span className="text-[13px] text-ink-muted">people leaving</span>
              </div>
              <ul className="mt-4 flex-1 space-y-2 text-[13.5px] text-ink-soft">
                {["Handover conversation, screen share, uploads, phone walk", "Knowledge base and Ask", "@Clone Flow in Microsoft Teams"].map((f) => (
                  <li key={f} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" /> {f}</li>
                ))}
              </ul>
              <div className="mt-5">
                {on ? (
                  <span className="text-[13px] font-medium text-ink-muted">{p.free ? "Free" : "Active"}{ov?.plan && on ? ` · ${ov.plan.used} of ${ov.plan.employees} used` : ""}</span>
                ) : (
                  <a href={`mailto:hello@datellx.com?subject=${encodeURIComponent(`Clone Flow ${p.name} plan for ${me?.org.name ?? ""}`)}`}
                    className="inline-flex h-10 w-full items-center justify-center rounded-full bg-white text-[14px] font-medium text-ink ring-1 ring-inset ring-line-strong hover:ring-ink-faint">
                    Contact us
                  </a>
                )}
              </div>
            </div>
          );
        })}
        {!plans.length && [0, 1, 2].map((i) => <Skeleton key={i} className="h-[280px] rounded-[18px]" />)}
      </div>

      <h2 className="mt-10 font-sans text-[15px] font-semibold text-ink">Desktop apps</h2>
      <p className="mt-1 text-[13.5px] text-ink-muted">Clone Flow works in any browser. The apps open it in its own window, with screen sharing and the microphone built in.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <AppRow icon={<Laptop className="h-4 w-4" />} name="Mac" href={dl?.mac ?? null} />
        <AppRow icon={<Monitor className="h-4 w-4" />} name="Windows" href={dl?.windows ?? null} />
      </div>
    </div>
  );
}

function AppRow({ icon, name, href }: { icon: React.ReactNode; name: string; href: string | null }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3.5">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-700">{icon}</span>
      <span className="flex-1 text-[14.5px] font-medium text-ink">Clone Flow for {name}</span>
      {href ? (
        <a href={href} className="rounded-full bg-brand-700 px-4 py-1.5 text-[13px] font-medium text-white hover:bg-brand-800">Download</a>
      ) : (
        <span className="rounded-full bg-paper px-3 py-1 text-[12.5px] font-medium text-ink-muted ring-1 ring-inset ring-line">Coming soon</span>
      )}
    </div>
  );
}
