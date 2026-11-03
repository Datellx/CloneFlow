// v4 "/" — the marketing homepage. Concise and confident: hero + video, how it works, features, IT & security, pricing.
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight, BadgeCheck, Check, CircleHelp, KeyRound, Laptop, LogIn, Lock, Mail, MessagesSquare, MonitorUp, Paperclip,
  ScanEye, ShieldCheck, Smartphone, Unplug, UserPlus, Users,
} from "lucide-react";
import { cn } from "@/lib/format";
import { useStatus } from "@/lib/api";
import { Orb } from "../shared/Orb";
import { HeroVideo, DemoReel } from "./HeroReel";
import { useTitle } from "../app/orgs";
import { Eyebrow, MarketingFrame } from "./Marketing";

const rise = { initial: { opacity: 0, y: 14 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: "-60px" }, transition: { duration: 0.5, ease: [0.2, 0.8, 0.2, 1] } } as const;

export default function Landing() {
  useTitle(null);
  return (
    <MarketingFrame>
      <Hero />
      <HowItWorks />
      <Features />
      <Security />
      <Pricing />
      <FinalCta />
    </MarketingFrame>
  );
}

/* ================================================================== hero */
function PrimaryCta({ children = "Create your organization", className }: { children?: ReactNode; className?: string }) {
  return (
    <Link
      to="/signup"
      className={cn("inline-flex h-12 items-center justify-center gap-2 rounded-full bg-brand-700 px-7 text-[15.5px] font-medium text-white shadow-[0_10px_28px_-10px_rgba(122,30,58,.7)] transition-colors hover:bg-brand-800", className)}
    >
      {children} <ArrowRight className="h-4 w-4" />
    </Link>
  );
}
function SignInCta({ light, className }: { light?: boolean; className?: string }) {
  return (
    <Link
      to="/login"
      className={cn(
        "inline-flex h-12 items-center justify-center gap-2 rounded-full px-6 text-[15.5px] font-medium transition-colors",
        light ? "bg-white/10 text-white ring-1 ring-inset ring-white/25 hover:bg-white/15" : "bg-white text-ink ring-1 ring-inset ring-line-strong hover:ring-ink-faint",
        className,
      )}
    >
      <LogIn className="h-4 w-4" /> Sign in to your organization
    </Link>
  );
}

function ComingSoon({ light }: { light?: boolean }) {
  const dl = useStatus().data?.download;
  const ready = !!(dl?.mac || dl?.windows);
  return (
    <p className={cn("mt-4 inline-flex items-center gap-1.5 text-[13px]", light ? "text-white/70" : "text-ink-muted")}>
      <Laptop className="h-3.5 w-3.5" /> Works in any browser.{" "}
      {ready ? (
        <Link to="/download" className={cn("font-medium underline-offset-2 hover:underline", light ? "text-white" : "text-brand-700")}>Get the desktop app</Link>
      ) : (
        "Desktop apps for Mac and Windows are coming soon."
      )}
    </p>
  );
}

function Hero() {
  const [failed, setFailed] = useState(false);
  return (
    <section className="relative overflow-hidden">
      <div
        className="pointer-events-none absolute left-1/2 top-[-320px] h-[820px] w-[1200px] -translate-x-1/2 rounded-full opacity-70"
        style={{ background: "radial-gradient(closest-side, rgba(236,198,208,0.6), rgba(251,248,247,0))" }}
        aria-hidden
      />
      <div className="relative mx-auto flex max-w-[1200px] flex-col items-center px-4 pb-20 pt-10 text-center sm:px-8 sm:pt-16">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
          className="inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-1.5 text-[12.5px] font-medium text-ink-soft ring-1 ring-inset ring-line">
          <span className="h-1.5 w-1.5 rounded-full bg-brand-600" /> Knowledge handover for Microsoft 365 teams
        </motion.div>
        <motion.h1
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.05 }}
          className="mt-5 max-w-[16ch] text-balance text-[42px] font-normal leading-[1.03] tracking-[-0.025em] text-ink sm:text-[64px] lg:text-[72px]"
        >
          When people leave, their knowledge stays.
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.12 }}
          className="mt-5 max-w-[52ch] text-balance text-[17px] leading-relaxed text-ink-muted sm:text-[19px]"
        >
          One conversation with the person who's leaving. Answers with proof for everyone who stays, right in Microsoft Teams.
        </motion.p>
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.18 }}
          className="mt-8 flex w-full flex-col items-stretch justify-center gap-3 sm:w-auto sm:flex-row sm:items-center">
          <PrimaryCta />
          <SignInCta />
        </motion.div>
        <ComingSoon />
        <motion.ul initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }}
          className="mt-6 flex flex-wrap justify-center gap-x-5 gap-y-2 text-[13px] text-ink-muted">
          {["Personal stays private", "Proof on every answer", "Set up in five minutes"].map((t) => (
            <li key={t} className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-sure" /> {t}</li>
          ))}
        </motion.ul>

        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.8, delay: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
          className="mt-12 w-full max-w-[1120px] overflow-hidden rounded-[18px] border border-line bg-[#141416] shadow-[0_40px_80px_-40px_rgba(48,9,20,.35),0_2px_6px_rgba(48,9,20,.05)] sm:rounded-[26px]"
        >
          <div className="relative aspect-video w-full">{failed ? <DemoReel /> : <HeroVideo onFail={() => setFailed(true)} />}</div>
        </motion.div>
      </div>
    </section>
  );
}

/* ========================================================== how it works */
function HowItWorks() {
  const steps = [
    {
      n: "1", title: "Tell Clone Flow about your company",
      body: "A two-minute chat shapes your console around what you do. Then invite the person who's leaving: they get a private link.",
      art: <InviteVignette />,
    },
    {
      n: "2", title: "They have one conversation",
      body: "They connect Outlook and Teams. Clone Flow sets personal mail aside, reads the work, and asks only about what was never written down. They can show their screen or walk the floor with their phone.",
      art: <ConversationVignette />,
    },
    {
      n: "3", title: "Everyone asks in Teams, with proof",
      body: "Colleagues type @Clone Flow in any channel. Every answer shows where it came from, in the person's own words.",
      art: <TeamsVignette />,
    },
  ];
  return (
    <section id="how" className="scroll-mt-20 border-t border-line bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-[1200px] px-4 sm:px-8">
        <motion.div {...rise} className="max-w-[640px]">
          <Eyebrow>How it works</Eyebrow>
          <h2 className="mt-3 text-balance text-[34px] font-normal leading-[1.1] text-ink sm:text-[46px]">A handover in three steps, not three weeks.</h2>
        </motion.div>
        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {steps.map((s, i) => (
            <motion.article key={s.n} {...rise} transition={{ ...rise.transition, delay: i * 0.08 }} className="flex flex-col overflow-hidden rounded-[20px] border border-line bg-paper">
              <div className="relative flex h-[260px] items-center justify-center overflow-hidden border-b border-line bg-[linear-gradient(180deg,#FBF2F4_0%,#FBF8F7_100%)] px-5">{s.art}</div>
              <div className="p-6">
                <div className="flex items-center gap-3">
                  <span className="tnum flex h-7 w-7 items-center justify-center rounded-full bg-brand-700 text-[13px] font-semibold text-white">{s.n}</span>
                  <h3 className="font-sans text-[17px] font-semibold leading-snug text-ink">{s.title}</h3>
                </div>
                <p className="mt-3 text-[14.5px] leading-relaxed text-ink-muted">{s.body}</p>
              </div>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}

function InviteVignette() {
  return (
    <div className="w-full max-w-[300px] rounded-2xl border border-line bg-white p-4 text-left shadow-lift" aria-hidden>
      <div className="flex items-center gap-2 text-[13px] font-semibold text-ink"><UserPlus className="h-4 w-4 text-brand-700" /> Invite someone who's leaving</div>
      <div className="mt-3 space-y-2">
        {[["Name", "Sam Rivera"], ["Role", "Line 2 lead"], ["Last day", "Nov 20"]].map(([l, v]) => (
          <div key={l} className="flex items-center justify-between rounded-lg border border-line px-2.5 py-1.5 text-[12px]">
            <span className="text-ink-muted">{l}</span><span className="font-medium text-ink">{v}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2 rounded-lg bg-paper p-1.5 pl-2.5 ring-1 ring-inset ring-line">
        <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-soft">cloneflow.app/join/7KQ2</code>
        <span className="inline-flex items-center gap-1 rounded-md bg-sure-bg px-2 py-1 text-[11px] font-medium text-sure"><Check className="h-3 w-3" /> Copied</span>
      </div>
    </div>
  );
}

function ConversationVignette() {
  return (
    <div className="flex w-full max-w-[310px] flex-col items-center" aria-hidden>
      <Orb size={78} state="speaking" />
      <p className="mt-2 max-w-[28ch] text-center font-display text-[15px] leading-snug text-ink">
        You re-run the wrist calibration every Monday. Nothing I read says why.
      </p>
      <div className="mt-3 grid w-full grid-cols-2 gap-2">
        {["Outlook & Teams", "GitHub"].map((n) => (
          <div key={n} className="flex items-center gap-1.5 rounded-xl border border-[#CFE5D8] bg-white px-2.5 py-1.5 text-[11.5px] font-medium text-ink">
            <Check className="h-3 w-3 shrink-0 text-sure" /> <span className="truncate">{n}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex w-full items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11px] text-ink-soft ring-1 ring-inset ring-line">
          <ShieldCheck className="h-3 w-3 text-sure" /> 23 personal, never read
        </span>
        <span className="flex gap-1">
          {[MonitorUp, Smartphone, Paperclip].map((I, i) => (
            <span key={i} className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-brand-700 ring-1 ring-inset ring-line"><I className="h-3 w-3" /></span>
          ))}
        </span>
      </div>
    </div>
  );
}

function TeamsVignette() {
  return (
    <div className="w-full max-w-[310px] rounded-2xl border border-line bg-white p-3.5 text-left shadow-lift" aria-hidden>
      <div className="flex gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#4A5A7A] text-[10px] font-semibold text-white">JL</span>
        <p className="text-[12px] leading-snug text-ink">
          <span className="rounded bg-brand-50 px-1 font-medium text-brand-800">@Clone Flow</span> why do we recalibrate on Mondays?
        </p>
      </div>
      <div className="ml-3.5 mt-2.5 border-l-2 border-line pl-3">
        <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-ink">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-50"><Orb size={20} state="idle" /></span> Clone Flow
        </div>
        <p className="mt-1 text-[12px] leading-snug text-ink-soft">The shop heat is off over the weekend, so the wrist servos drift 1–2°. Recalibrate before first shift.</p>
        <div className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-sure"><BadgeCheck className="h-3 w-3" /> In Sam's own words</div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {["Exit conversation", "Email, Sep 28"].map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-md bg-paper px-1.5 py-0.5 text-[10.5px] text-ink-soft ring-1 ring-inset ring-line"><Paperclip className="h-2.5 w-2.5" /> {t}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ============================================================== features */
function Features() {
  const items = [
    { icon: ShieldCheck, title: "Personal stays private", body: "Personal mail and chats are recognised and masked in code before any AI step. Nobody at the company sees them." },
    { icon: BadgeCheck, title: "Proof on every answer", body: "Each answer links to the email, chat, file or video moment it came from." },
    { icon: ScanEye, title: "Learns from screen, video and phone", body: "Computer vision turns a screen share or a phone walk of the floor into steps and locations." },
    { icon: CircleHelp, title: "Says “I don't know”", body: "When nothing captured covers a question, it says so and names who might know. It never guesses." },
    { icon: MessagesSquare, title: "Works in Microsoft Teams", body: "Colleagues ask @Clone Flow in any channel. No new tool to learn." },
  ];
  return (
    <section className="relative overflow-hidden bg-brand-950 py-20 text-white sm:py-28">
      <div className="pointer-events-none absolute -right-40 -top-40 h-[520px] w-[520px] rounded-full opacity-40" style={{ background: "radial-gradient(closest-side, rgba(174,68,99,0.55), rgba(48,9,20,0))" }} aria-hidden />
      <div className="relative mx-auto max-w-[1200px] px-4 sm:px-8">
        <motion.div {...rise} className="max-w-[640px]">
          <Eyebrow light>Why teams trust it</Eyebrow>
          <h2 className="mt-3 text-balance text-[34px] font-normal leading-[1.1] sm:text-[46px]">Built for the knowledge nobody wrote down.</h2>
        </motion.div>
        <div className="mt-12 grid gap-px overflow-hidden rounded-[20px] bg-white/10 sm:grid-cols-2 lg:grid-cols-5">
          {items.map((f, i) => (
            <motion.div key={f.title} {...rise} transition={{ ...rise.transition, delay: i * 0.05 }} className="bg-brand-950 p-6">
              <f.icon className="h-6 w-6 text-brand-300" aria-hidden />
              <h3 className="mt-4 font-sans text-[16px] font-semibold leading-snug">{f.title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-white/65">{f.body}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================== security */
function Security() {
  const points = [
    { icon: Lock, title: "Data stays with your organization", body: "Captured knowledge lives in your organization's knowledge base. It is never used to train models." },
    { icon: KeyRound, title: "Consent per source", body: "The person leaving chooses what to connect: Outlook, Teams, OneDrive, GitHub. Nothing is read before they say so." },
    { icon: ShieldCheck, title: "Personal never reaches the AI", body: "Personal mail, newsletters and notifications are set aside in code first. Only work knowledge is read." },
    { icon: Unplug, title: "Revocable connections", body: "Read-only access, revoked when the handover finishes or whenever you choose." },
    { icon: Users, title: "Owner controls", body: "Only owners see the console. People leaving see only their own conversation." },
  ];
  return (
    <section id="security" className="scroll-mt-20 py-20 sm:py-28">
      <div className="mx-auto grid max-w-[1200px] items-center gap-12 px-4 sm:px-8 lg:grid-cols-[1fr_minmax(0,460px)] lg:gap-16">
        <div>
          <motion.div {...rise}>
            <Eyebrow>For IT & security</Eyebrow>
            <h2 className="mt-3 max-w-[18ch] text-balance text-[34px] font-normal leading-[1.1] text-ink sm:text-[46px]">Your data, your rules.</h2>
          </motion.div>
          <ul className="mt-10 grid gap-x-8 gap-y-7 sm:grid-cols-2">
            {points.map((p, i) => (
              <motion.li key={p.title} {...rise} transition={{ ...rise.transition, delay: i * 0.05 }} className="flex gap-3.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100"><p.icon className="h-[18px] w-[18px]" /></span>
                <div>
                  <h3 className="font-sans text-[15px] font-semibold text-ink">{p.title}</h3>
                  <p className="mt-1 text-[14px] leading-relaxed text-ink-muted">{p.body}</p>
                </div>
              </motion.li>
            ))}
          </ul>
        </div>
        <motion.div {...rise}><ControlsVignette /></motion.div>
      </div>
    </section>
  );
}

function ControlsVignette() {
  const sources = [["Outlook mail", true], ["Teams chats", true], ["OneDrive files", true], ["GitHub", false]] as const;
  const sorted = [["Work, read for knowledge", 1077, "bg-brand-600"], ["Newsletters & notifications, skipped", 412, "bg-brand-300"],
    ["Personal, set aside and never read", 23, "bg-sure"]] as const;
  const maxN = 1077;
  return (
    <div className="rounded-[22px] border border-line bg-white p-5 shadow-lift sm:p-6" aria-hidden>
      <div className="flex items-center justify-between">
        <div className="text-[14px] font-semibold text-ink">Sources</div>
        <span className="text-[12px] text-ink-muted">Chosen by the person leaving</span>
      </div>
      <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
        {sources.map(([n, on]) => (
          <li key={n} className="flex items-center justify-between px-3.5 py-2.5 text-[13.5px]">
            <span className="text-ink">{n}</span>
            <span className={cn("relative h-5 w-9 rounded-full transition-colors", on ? "bg-brand-700" : "bg-line-strong")}>
              <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm", on ? "left-[18px]" : "left-0.5")} />
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-6 flex items-baseline justify-between">
        <div className="text-[14px] font-semibold text-ink">Before anything is read</div>
        <span className="text-[12px] text-ink-muted">Sorted in code</span>
      </div>
      <ul className="mt-3 space-y-2.5">
        {sorted.map(([n, v, tone]) => (
          <li key={n}>
            <div className="flex justify-between text-[12.5px]"><span className="text-ink-soft">{n}</span><span className="tnum text-ink-muted">{v.toLocaleString()}</span></div>
            <div className="mt-1 h-1.5 rounded-full bg-brand-50"><div className={cn("h-full rounded-full", tone)} style={{ width: `${(v / maxN) * 100}%` }} /></div>
          </li>
        ))}
      </ul>
      <div className="mt-6 flex items-center justify-between rounded-xl bg-paper px-3.5 py-3 ring-1 ring-inset ring-line">
        <span className="inline-flex items-center gap-2 text-[13px] text-ink-soft"><Mail className="h-4 w-4 text-ink-muted" /> Microsoft 365 · read-only</span>
        <span className="rounded-lg px-2.5 py-1 text-[12.5px] font-medium text-[#9B1C1C] ring-1 ring-inset ring-[#F0D5D5]">Revoke</span>
      </div>
    </div>
  );
}

/* =============================================================== pricing */
function Pricing() {
  const plans = [
    { name: "Starter", people: "3", blurb: "Free. For your first handovers.", cta: <PrimaryCta className="w-full">Start free</PrimaryCta> },
    { name: "Growth", people: "25", blurb: "For teams with regular turnover.", featured: true, cta: <ContactCta plan="Growth" /> },
    { name: "Pro", people: "100", blurb: "For larger organizations and rollouts.", cta: <ContactCta plan="Pro" /> },
  ];
  const included = ["Guided handover conversation", "Microsoft 365, Gmail and GitHub", "Screen share, uploads and phone walk",
    "Personal mail set aside before any AI", "Knowledge base with proof on every answer", "@Clone Flow in Microsoft Teams"];
  return (
    <section id="pricing" className="scroll-mt-20 border-t border-line bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-[1200px] px-4 sm:px-8">
        <motion.div {...rise} className="mx-auto max-w-[640px] text-center">
          <Eyebrow>Plans</Eyebrow>
          <h2 className="mt-3 text-balance text-[34px] font-normal leading-tight text-ink sm:text-[46px]">Start free. Grow when people move on.</h2>
          <p className="mt-4 text-[16px] text-ink-muted">Plans differ only by how many people leaving you can hand over.</p>
        </motion.div>
        <div className="mt-12 grid gap-5 lg:grid-cols-3">
          {plans.map((p, i) => (
            <motion.div key={p.name} {...rise} transition={{ ...rise.transition, delay: i * 0.06 }}
              className={cn("relative flex flex-col rounded-[22px] border p-6 sm:p-7", p.featured ? "border-brand-700 bg-paper shadow-[0_0_0_4px_rgba(122,30,58,0.08)]" : "border-line bg-white")}>
              {p.featured && <span className="absolute -top-3 left-6 rounded-full bg-brand-700 px-3 py-1 text-[11.5px] font-semibold text-white">Most popular</span>}
              <h3 className="font-sans text-[16px] font-semibold text-ink">{p.name}</h3>
              <p className="mt-1 text-[13.5px] text-ink-muted">{p.blurb}</p>
              <div className="mt-5 flex items-baseline gap-2">
                <span className="tnum font-display text-[42px] leading-none text-ink">{p.people}</span>
                <span className="text-[13.5px] text-ink-muted">people leaving</span>
              </div>
              <ul className="mt-6 flex-1 space-y-2.5">
                {included.map((f) => <li key={f} className="flex gap-2.5 text-[14px] text-ink-soft"><Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" /> {f}</li>)}
              </ul>
              <div className="mt-7">{p.cta}</div>
            </motion.div>
          ))}
        </div>
        <p className="mt-6 text-center text-[13px] text-ink-muted">
          Need more, single sign-on or your own cloud? <a className="font-medium text-brand-700 hover:underline" href="mailto:hello@datellx.com?subject=Clone%20Flow">Talk to us</a>.
        </p>
      </div>
    </section>
  );
}

function ContactCta({ plan }: { plan: string }) {
  return (
    <a href={`mailto:hello@datellx.com?subject=${encodeURIComponent(`Clone Flow ${plan}`)}`}
      className="inline-flex h-12 w-full items-center justify-center rounded-full bg-white text-[15.5px] font-medium text-ink ring-1 ring-inset ring-line-strong transition-colors hover:ring-ink-faint">
      Contact us
    </a>
  );
}

/* ============================================================= final CTA */
function FinalCta() {
  return (
    <section className="px-4 py-20 sm:px-8 sm:py-24">
      <motion.div {...rise} className="relative mx-auto max-w-[1100px] overflow-hidden rounded-[28px] bg-brand-800 px-6 py-14 text-center text-white sm:px-12 sm:py-16">
        <div className="pointer-events-none absolute left-1/2 top-[-60%] h-[420px] w-[820px] -translate-x-1/2 rounded-full opacity-50" style={{ background: "radial-gradient(closest-side, rgba(222,157,174,0.55), rgba(101,26,49,0))" }} aria-hidden />
        <div className="relative">
          <h2 className="mx-auto max-w-[20ch] text-balance text-[32px] font-normal leading-[1.1] sm:text-[44px]">Someone gave notice? Start their handover today.</h2>
          <p className="mx-auto mt-4 max-w-[44ch] text-[16px] text-white/75">Create your organization in a minute and send the first invite.</p>
          <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
            <Link to="/signup" className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-white px-7 text-[15.5px] font-medium text-brand-800 transition-colors hover:bg-brand-50">
              Create your organization <ArrowRight className="h-4 w-4" />
            </Link>
            <SignInCta light />
          </div>
          <ComingSoon light />
        </div>
      </motion.div>
    </section>
  );
}
