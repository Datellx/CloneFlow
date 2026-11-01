// /download — the desktop apps (Mac and Windows) when published, otherwise "coming soon". Plus /privacy and /terms.
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Globe, Laptop, LogIn, Monitor } from "lucide-react";
import { useStatus } from "@/lib/api";
import { useTitle } from "../app/orgs";
import { Eyebrow, MarketingFrame } from "./Marketing";

export default function DownloadPage() {
  useTitle("Desktop apps");
  const dl = useStatus().data?.download;
  const ready = !!(dl?.mac || dl?.windows);
  return (
    <MarketingFrame>
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute left-1/2 top-[-300px] h-[700px] w-[1100px] -translate-x-1/2 rounded-full opacity-60" style={{ background: "radial-gradient(closest-side, rgba(236,198,208,0.6), rgba(251,248,247,0))" }} aria-hidden />
        <div className="relative mx-auto grid max-w-[1200px] items-center gap-12 px-4 pb-24 pt-12 sm:px-8 sm:pt-20 lg:grid-cols-[1fr_420px]">
          <div>
            <Eyebrow>Desktop apps</Eyebrow>
            <h1 className="mt-3 text-balance text-[42px] font-normal leading-[1.05] tracking-[-0.02em] text-ink sm:text-[60px]">
              {ready ? "Clone Flow for Mac and Windows." : "Mac and Windows apps are coming soon."}
            </h1>
            <p className="mt-4 max-w-[46ch] text-[17px] leading-relaxed text-ink-muted">
              {ready
                ? "Your organization's Clone Flow in its own window, with screen sharing and the microphone built in. Invitation links open straight in the app."
                : "Everything works in your browser today: the handover conversation, screen sharing, uploads, the phone walk and the knowledge base."}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link to="/signup" className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-brand-700 px-7 text-[15.5px] font-medium text-white shadow-[0_10px_28px_-10px_rgba(122,30,58,.7)] transition-colors hover:bg-brand-800">
                Create your organization <ArrowRight className="h-4 w-4" />
              </Link>
              <Link to="/login" className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-white px-6 text-[15.5px] font-medium text-ink ring-1 ring-inset ring-line-strong hover:ring-ink-faint">
                <LogIn className="h-4 w-4" /> Sign in to your organization
              </Link>
            </div>
          </div>
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="card p-6 sm:p-7">
            <ul className="space-y-4">
              <Row icon={<Globe className="h-4 w-4" />} title="Web" note="Available now in Chrome, Edge, Safari and Firefox" live />
              <Row icon={<Laptop className="h-4 w-4" />} title="Mac" note={dl?.mac ? "macOS 12 or later, Apple silicon and Intel" : "Coming soon"} href={dl?.mac} />
              <Row icon={<Monitor className="h-4 w-4" />} title="Windows" note={dl?.windows ? "Windows 10 and 11" : "Coming soon"} href={dl?.windows} />
            </ul>
          </motion.div>
        </div>
      </section>
    </MarketingFrame>
  );
}

function Row({ icon, title, note, live, href }: { icon: ReactNode; title: string; note: string; live?: boolean; href?: string | null }) {
  return (
    <li className="flex items-center gap-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-700">{icon}</span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block text-[15px] font-semibold text-ink">{title}</span>
        <span className="block text-[13px] text-ink-muted">{note}</span>
      </span>
      {href ? (
        <a href={href} className="rounded-full bg-brand-700 px-3.5 py-1.5 text-[12.5px] font-medium text-white hover:bg-brand-800">Download</a>
      ) : (
        <span className={live ? "rounded-full bg-sure-bg px-2.5 py-1 text-[12px] font-medium text-sure" : "rounded-full bg-paper px-2.5 py-1 text-[12px] font-medium text-ink-muted ring-1 ring-inset ring-line"}>
          {live ? "Available" : "Soon"}
        </span>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ legal placeholders */
function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  useTitle(title);
  return (
    <MarketingFrame>
      <article className="mx-auto max-w-[720px] px-4 pb-24 pt-12 sm:px-8 sm:pt-16">
        <h1 className="text-[40px] font-normal leading-tight text-ink sm:text-[48px]">{title}</h1>
        <p className="mt-2 text-[13.5px] text-ink-muted">Last updated {updated}</p>
        <div className="mt-8 space-y-5 text-[15.5px] leading-relaxed text-ink-soft [&_h2]:mt-9 [&_h2]:font-sans [&_h2]:text-[17px] [&_h2]:font-semibold [&_h2]:text-ink">{children}</div>
      </article>
    </MarketingFrame>
  );
}

export function PrivacyPage() {
  return (
    <LegalPage title="Privacy" updated="October 29, 2026">
      <p>Clone Flow is operated by Datellx LLC, Madison, Wisconsin. This summary explains how we handle data. The full policy is provided with your order form.</p>
      <h2>What we process</h2>
      <p>Only the sources the person leaving chooses to connect (for example Outlook, Teams or GitHub), plus what they say, show or upload in their handover conversation.</p>
      <h2>Personal messages</h2>
      <p>Messages that look personal are recognised in code and set aside before any AI step. They are never sent to an AI model and never shown to the organization.</p>
      <h2>Who owns the knowledge</h2>
      <p>Your organization does. It is stored in your organization's knowledge base, is not used to train models, and can be deleted by an owner at any time.</p>
      <h2>Contact</h2>
      <p>Questions: <a className="font-medium text-brand-700 hover:underline" href="mailto:hello@datellx.com">hello@datellx.com</a></p>
    </LegalPage>
  );
}

export function TermsPage() {
  return (
    <LegalPage title="Terms" updated="October 29, 2026">
      <p>These summary terms apply to Clone Flow, a service of Datellx LLC. Your signed order form and the full terms of service take precedence.</p>
      <h2>Your account</h2>
      <p>The person who creates an organization is its owner and is responsible for who they invite. Invitations are personal and should not be shared.</p>
      <h2>Acceptable use</h2>
      <p>Connect only accounts you are allowed to share with your employer. Do not upload content you do not have the right to share.</p>
      <h2>Billing</h2>
      <p>Founding customer pricing is fixed for the first twelve months of your subscription.</p>
    </LegalPage>
  );
}
