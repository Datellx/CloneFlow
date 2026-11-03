// /contact — talk to the Clone Flow team (Datellx LLC). Every message is stored and sent to hello@datellx.com.
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowRight, CheckCircle2, Loader2, Mail, MapPin } from "lucide-react";
import { request } from "@/lib/api";
import { useTitle } from "../app/orgs";
import { Eyebrow, MarketingFrame } from "./Marketing";

const TOPICS: [string, string][] = [
  ["demo", "Book a demo"],
  ["pricing", "Plans and pricing"],
  ["security", "Security and IT"],
  ["support", "Support"],
  ["other", "Something else"],
];

export default function ContactPage() {
  useTitle("Contact");
  const [params] = useSearchParams();
  const initial = TOPICS.some(([k]) => k === params.get("topic")) ? params.get("topic")! : "demo";
  const [f, setF] = useState({ name: "", email: "", company: "", topic: initial, message: "", website: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF((v) => ({ ...v, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await request("/contact", { method: "POST", json: f });
      setSent(true);
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <MarketingFrame>
      <section className="mx-auto grid max-w-[1100px] gap-10 px-4 pb-24 pt-12 sm:px-8 sm:pt-16 lg:grid-cols-[1fr_1.15fr] lg:gap-16">
        <div>
          <Eyebrow>Contact</Eyebrow>
          <h1 className="mt-3 text-balance text-[40px] font-normal leading-[1.08] text-ink sm:text-[52px]">Talk to the people who build Clone Flow.</h1>
          <p className="mt-5 max-w-[46ch] text-[16.5px] leading-relaxed text-ink-muted">
            A demo for your team, a plan for more people, single sign-on, your own cloud, or a security review. We answer within one business day.
          </p>
          <ul className="mt-8 space-y-4 text-[15px] text-ink-soft">
            <li className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-brand-700 ring-1 ring-inset ring-line"><Mail className="h-4 w-4" /></span>
              <a className="font-medium text-brand-700 hover:underline" href="mailto:hello@datellx.com">hello@datellx.com</a>
            </li>
            <li className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-brand-700 ring-1 ring-inset ring-line"><MapPin className="h-4 w-4" /></span>
              Datellx LLC · Madison, Wisconsin
            </li>
          </ul>
        </div>

        <div className="card px-6 pb-7 pt-7 sm:px-8">
          {sent ? (
            <div role="status" className="flex flex-col items-center py-10 text-center">
              <CheckCircle2 className="h-10 w-10 text-sure" />
              <h2 className="mt-4 text-[26px] font-normal text-ink">Thanks, {f.name.split(" ")[0] || "we got it"}.</h2>
              <p className="mt-2 max-w-[36ch] text-[15px] text-ink-muted">We'll reply to {f.email} within one business day.</p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4" noValidate={false}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="c-name" className="label">Your name</label>
                  <input id="c-name" className="input" value={f.name} onChange={set("name")} autoComplete="name" required maxLength={200} />
                </div>
                <div>
                  <label htmlFor="c-email" className="label">Work email</label>
                  <input id="c-email" type="email" className="input" value={f.email} onChange={set("email")} autoComplete="email" required maxLength={320} />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="c-company" className="label">Company <span className="font-normal text-ink-faint">(optional)</span></label>
                  <input id="c-company" className="input" value={f.company} onChange={set("company")} autoComplete="organization" maxLength={200} />
                </div>
                <div>
                  <label htmlFor="c-topic" className="label">What's it about?</label>
                  <select id="c-topic" className="input" value={f.topic} onChange={set("topic")}>
                    {TOPICS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="c-msg" className="label">Message</label>
                <textarea id="c-msg" className="input min-h-[140px] py-3" value={f.message} onChange={set("message")} required maxLength={5000}
                  placeholder="How many people leave a year, which tools you use, what you'd like to see." />
              </div>
              {/* left empty by people */}
              <input tabIndex={-1} autoComplete="off" aria-hidden className="hidden" value={f.website} onChange={set("website")} name="website" />
              {err && <p role="alert" className="text-[13.5px] text-[#8E1F1F]">{err}</p>}
              <button type="submit" disabled={busy}
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand-700 text-[15.5px] font-medium text-white transition-colors hover:bg-brand-800 disabled:opacity-60">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Send message {!busy && <ArrowRight className="h-4 w-4" />}
              </button>
              <p className="text-center text-[12.5px] text-ink-faint">We use your details only to reply to you.</p>
            </form>
          )}
        </div>
      </section>
    </MarketingFrame>
  );
}
