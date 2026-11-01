// Accounts: create an organization (admins), two-step sign-in by email, and the invitation page (people leaving).
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, BadgeCheck, Building2, Check, Clock, Eye, EyeOff, MessagesSquare, ShieldCheck, UserPlus } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/format";
import { Logo } from "@/components/domain";
import { Button } from "@/components/ui";
import { isCloudApp, isDesktopShell } from "@/lib/desktop";
import { useAfterAuth } from "@/lib/home";
import { Orb } from "../shared/Orb";
import { useTitle } from "../app/orgs";

/* ------------------------------------------------------------------ bits */
function Input({ id, label, hint, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { id: string; label: string; hint?: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <input id={id} className="input" {...rest} />
      {hint && <p className="mt-1.5 text-[12.5px] text-ink-muted">{hint}</p>}
    </div>
  );
}

function PasswordField({ id, label = "Password", value, onChange, autoComplete, hint, inputRef }: {
  id: string; label?: string; value: string; onChange: (v: string) => void; autoComplete: string; hint?: ReactNode; inputRef?: React.Ref<HTMLInputElement>;
}) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <div className="relative">
        <input ref={inputRef} id={id} type={show ? "text" : "password"} className="input pr-11" value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} required minLength={8} />
        <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-ink-muted hover:text-ink" aria-label={show ? "Hide password" : "Show password"}>
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {hint && <p className="mt-1.5 text-[12.5px] text-ink-muted">{hint}</p>}
    </div>
  );
}

function FormError({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return <p role="alert" className="rounded-lg border border-[#F0D5D5] bg-[#FFF8F8] px-3 py-2 text-sm text-[#9B1C1C]">{msg}</p>;
}

/** Microsoft's four squares, drawn neutrally in grey so it reads as "Microsoft account", not a logo lockup. */
function MsMark() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden>
      <rect x="1" y="1" width="6.4" height="6.4" fill="#F25022" /><rect x="8.6" y="1" width="6.4" height="6.4" fill="#7FBA00" />
      <rect x="1" y="8.6" width="6.4" height="6.4" fill="#00A4EF" /><rect x="8.6" y="8.6" width="6.4" height="6.4" fill="#FFB900" />
    </svg>
  );
}

const inApp = () => isCloudApp() || isDesktopShell();

/** Centered card on paper; the logo goes home (or to sign-in inside the Mac app). */
function CardFrame({ children, footer, wide }: { children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-paper">
      <div className="relative">
        <div className="pointer-events-none absolute left-1/2 top-[-360px] h-[640px] w-[1000px] -translate-x-1/2 rounded-full opacity-60" style={{ background: "radial-gradient(closest-side, rgba(236,198,208,0.55), rgba(251,248,247,0))" }} aria-hidden />
        <header className="relative mx-auto flex h-16 max-w-[1200px] items-center px-4 sm:px-8">
          <Logo to={inApp() ? "/login" : "/"} />
        </header>
      </div>
      <main className="relative flex flex-1 items-start justify-center px-4 pb-16 pt-4 sm:items-center sm:pt-0">
        <div className={cn("w-full", wide ? "max-w-[460px]" : "max-w-[420px]")}>
          {children}
          {footer && <div className="mt-6 text-center text-[14px] text-ink-muted">{footer}</div>}
        </div>
      </main>
    </div>
  );
}

/* =================================================================== /signup */
export function Signup() {
  useTitle("Create your organization");
  const [f, setF] = useState({ org_name: "", name: "", email: "", password: "" });
  const [agree, setAgree] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const after = useAfterAuth();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!agree) return setErr("Please accept the terms to continue.");
    setErr(null);
    setLoading(true);
    try {
      const me = await api.signup({ org_name: f.org_name.trim(), name: f.name.trim(), email: f.email.trim(), password: f.password });
      toast.success(`${me.org.name} is ready`);
      after(me);
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setLoading(false);
    }
  };
  const next = [
    { icon: UserPlus, title: "Invite the person who's leaving", body: "They get a private link." },
    { icon: MessagesSquare, title: "They have one conversation", body: "About 20 minutes, in the browser." },
    { icon: BadgeCheck, title: "Everyone asks, with proof", body: "In Microsoft Teams or on the web." },
  ];
  return (
    <div className="grid min-h-[100dvh] bg-paper lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      {/* brand panel */}
      <aside className="relative hidden overflow-hidden bg-brand-950 text-white lg:flex lg:flex-col">
        <div className="pointer-events-none absolute -left-40 -top-40 h-[560px] w-[560px] rounded-full opacity-50" style={{ background: "radial-gradient(closest-side, rgba(174,68,99,0.55), rgba(48,9,20,0))" }} aria-hidden />
        <div className="relative px-12 pt-8"><Logo to={inApp() ? "/login" : "/"} light /></div>
        <div className="relative flex flex-1 flex-col justify-center px-12 pb-16">
          <h2 className="max-w-[16ch] text-[40px] font-normal leading-[1.08]">When people leave, their knowledge stays.</h2>
          <ol className="mt-10 space-y-6">
            {next.map((s, i) => (
              <li key={s.title} className="flex gap-4">
                <span className="tnum flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-[13px] font-semibold ring-1 ring-inset ring-white/20">{i + 1}</span>
                <div>
                  <div className="text-[15.5px] font-semibold">{s.title}</div>
                  <div className="mt-0.5 text-[14px] text-white/65">{s.body}</div>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-12 flex items-center gap-2 text-[13px] text-white/60"><ShieldCheck className="h-4 w-4 text-brand-300" /> Personal messages are set aside before any AI step.</div>
        </div>
      </aside>

      {/* form */}
      <div className="flex flex-col">
        <header className="flex h-16 items-center justify-between px-4 sm:px-8 lg:justify-end">
          <span className="lg:hidden"><Logo to={inApp() ? "/login" : "/"} /></span>
          <span className="text-[14px] text-ink-muted">Already set up? <Link to="/login" className="font-medium text-brand-700 hover:underline">Sign in to your organization</Link></span>
        </header>
        <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-6 sm:items-center sm:pt-0">
          <div className="w-full max-w-[440px]">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100"><Building2 className="h-5 w-5" /></span>
            <p className="mt-5 text-[12.5px] font-semibold uppercase tracking-[0.14em] text-brand-700">For admins and owners</p>
            <h1 className="mt-2 text-[34px] font-normal leading-tight text-ink sm:text-[38px]">Create your organization</h1>
            <p className="mt-2 text-[15px] text-ink-muted">You'll be the admin. Invite the first person who's leaving right after. Leaving and got an invitation? Open the link in your email instead.</p>
            <form onSubmit={submit} className="mt-8 space-y-4">
              <Input id="org" label="Organization name" value={f.org_name} onChange={set("org_name")} placeholder="Acme Manufacturing" autoComplete="organization" required />
              <div className="grid gap-4 sm:grid-cols-2">
                <Input id="name" label="Your name" value={f.name} onChange={set("name")} autoComplete="name" required />
                <Input id="email" label="Work email" type="email" value={f.email} onChange={set("email")} placeholder="you@company.com" autoComplete="email" required />
              </div>
              <PasswordField id="password" value={f.password} onChange={(v) => setF({ ...f, password: v })} autoComplete="new-password" hint="At least 8 characters." />
              <label className="flex cursor-pointer items-start gap-2.5 pt-1 text-[13.5px] leading-snug text-ink-soft">
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[#7A1E3A]" />
                <span>I agree to the <Link to="/terms" target="_blank" className="font-medium text-brand-700 hover:underline">Terms</Link> and <Link to="/privacy" target="_blank" className="font-medium text-brand-700 hover:underline">Privacy</Link> summary.</span>
              </label>
              <FormError msg={err} />
              <Button type="submit" size="lg" className="w-full !rounded-full" loading={loading}>
                Create organization {!loading && <ArrowRight className="h-4 w-4" />}
              </Button>
            </form>
          </div>
        </main>
      </div>
    </div>
  );
}

/* =================================================================== /login */
type Found = { org_name: string | null; microsoft: boolean };

export function Login() {
  useTitle("Sign in to your organization");
  const [params, setParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [missing, setMissing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const pw = useRef<HTMLInputElement>(null);
  const after = useAfterAuth();

  // Errors handed back by a provider redirect (?error=…) are shown once.
  useEffect(() => {
    const e = params.get("error");
    if (e) {
      setErr(e);
      const p = new URLSearchParams(params);
      p.delete("error");
      setParams(p, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (found) window.setTimeout(() => pw.current?.focus(), 30);
  }, [found]);

  const lookup = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMissing(false);
    setLoading(true);
    try {
      const r = await api.lookup(email.trim());
      if (r.found) setFound({ org_name: r.org_name, microsoft: r.microsoft });
      else setMissing(true);
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setLoading(false);
    }
  };
  const login = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      after(await api.login({ email: email.trim(), password }));
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setLoading(false);
    }
  };
  const back = () => {
    setFound(null);
    setPassword("");
    setErr(null);
  };
  const next = params.get("next");
  const msHref = `/api/auth/microsoft/start?email=${encodeURIComponent(email.trim())}${next ? `&next=${encodeURIComponent(next)}` : ""}`;

  return (
    <CardFrame
      footer={!found && (
        <div className="space-y-2">
          <div>Admin setting up Clone Flow? <Link to="/signup" className="font-medium text-brand-700 hover:underline">Create your organization</Link></div>
          <div className="text-[13px]">Leaving your company? Use the invitation link your admin sent you.</div>
        </div>
      )}
    >
      <div className="card px-6 pb-7 pt-8 sm:px-9">
        {!found ? (
          <>
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100"><Building2 className="h-5 w-5" /></span>
            <h1 className="mt-5 text-[30px] font-normal leading-tight text-ink">Sign in to your organization</h1>
            <p className="mt-2 text-[15px] text-ink-muted">For admins and invited employees. Enter your work email and we'll find your organization.</p>
            <form onSubmit={lookup} className="mt-7 space-y-4">
              <Input id="email" label="Work email" type="email" value={email} onChange={(e) => { setEmail(e.target.value); setMissing(false); }} placeholder="you@company.com" autoComplete="email" autoFocus required />
              {missing && (
                <div role="status" className="rounded-xl border border-line bg-paper px-4 py-3 text-[13.5px] leading-relaxed text-ink-soft">
                  <span className="font-medium text-ink">No organization uses this email yet.</span> If you're leaving, ask your admin for an invitation. If you're the admin,{" "}
                  <Link to="/signup" className="font-medium text-brand-700 hover:underline">create your organization</Link>.
                </div>
              )}
              <FormError msg={err} />
              <Button type="submit" size="lg" className="w-full !rounded-full" loading={loading}>Continue</Button>
            </form>
          </>
        ) : (
          <>
            <button onClick={back} className="-ml-1 inline-flex items-center gap-1 rounded-md px-1 text-[13px] font-medium text-ink-muted hover:text-ink">
              <ArrowLeft className="h-3.5 w-3.5" /> {email}
            </button>
            <h1 className="mt-3 text-balance text-[30px] font-normal leading-tight text-ink">Sign in to {found.org_name || "your organization"}</h1>
            {found.microsoft && (
              <>
                <a href={msHref} className="mt-6 flex h-12 w-full items-center justify-center gap-2.5 rounded-full border border-line-strong bg-white text-[15px] font-medium text-ink transition-colors hover:border-ink-faint">
                  <MsMark /> Continue with Microsoft
                </a>
                <div className="my-5 flex items-center gap-3 text-[12px] text-ink-faint"><span className="h-px flex-1 bg-line" /> or use your password <span className="h-px flex-1 bg-line" /></div>
              </>
            )}
            <form onSubmit={login} className={cn("space-y-4", !found.microsoft && "mt-7")}>
              <input type="email" value={email} autoComplete="username" readOnly hidden />
              <PasswordField id="password" value={password} onChange={setPassword} autoComplete="current-password" inputRef={pw} />
              <FormError msg={err} />
              <Button type="submit" size="lg" className="w-full !rounded-full" loading={loading}>Sign in</Button>
            </form>
          </>
        )}
      </div>
    </CardFrame>
  );
}

/* =================================================================== /join/:code */
export function Join() {
  const { code = "" } = useParams();
  const info = useQuery({ queryKey: ["invite", code], queryFn: () => api.inviteInfo(code), retry: false,
    staleTime: Infinity, refetchOnWindowFocus: false, refetchOnReconnect: false });
  const [f, setF] = useState({ name: "", email: "", password: "" });
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const after = useAfterAuth();
  useTitle(info.data ? `Join ${info.data.org_name}` : "Your invitation");
  useEffect(() => {
    if (info.data) setF((x) => ({ ...x, name: x.name || info.data!.name || "", email: x.email || info.data!.email || "" }));
  }, [info.data]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      after(await api.join({ invite_code: code, name: f.name.trim(), email: f.email.trim(), password: f.password }));
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (info.isLoading)
    return <CardFrame><div className="flex justify-center py-20"><Orb size={96} state="thinking" /></div></CardFrame>;
  if (info.isError || !info.data)
    return (
      <CardFrame footer={<>Already joined? <Link to="/login" className="font-medium text-brand-700 hover:underline">Sign in</Link></>}>
        <div className="card flex flex-col items-center px-6 py-10 text-center sm:px-9">
          <Orb size={92} state="idle" />
          <h1 className="mt-5 text-[26px] font-normal leading-snug text-ink">This invitation link isn't valid any more.</h1>
          <p className="mt-2 text-[14.5px] text-ink-muted">Ask whoever sent it for a new one.</p>
        </div>
      </CardFrame>
    );

  const d = info.data;
  const first = (d.name || f.name).trim().split(/\s+/)[0];
  return (
    <CardFrame wide footer={<>Already have an account? <Link to="/login" className="font-medium text-brand-700 hover:underline">Sign in</Link></>}>
      <div className="card overflow-hidden">
        <div className="flex flex-col items-center bg-[linear-gradient(180deg,#FBF2F4_0%,#FFFFFF_100%)] px-6 pb-2 pt-8 text-center sm:px-9">
          <Orb size={92} state="idle" />
          <p className="mt-4 text-[13.5px] font-medium text-brand-800">{d.inviter ? `${d.inviter} at ${d.org_name} invited you` : `${d.org_name} invited you`}</p>
          <h1 className="mt-2 text-balance text-[28px] font-normal leading-tight text-ink sm:text-[32px]">{first ? `Hi ${first}. ` : ""}Let's hand over what you know.</h1>
          <p className="mt-2.5 max-w-[38ch] text-[14.5px] leading-relaxed text-ink-muted">
            A 20-minute conversation with Clone Flow, so the people who stay can keep doing what you did.
          </p>
          <ul className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-[12.5px] text-ink-soft">
            <li className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 text-ink-muted" /> About 20 minutes</li>
            <li className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-sure" /> Personal messages stay private</li>
          </ul>
        </div>
        <form onSubmit={submit} className="space-y-4 px-6 pb-7 pt-6 sm:px-9">
          <Input id="name" label="Your name" value={f.name} onChange={set("name")} autoComplete="name" required />
          <Input id="email" label="Work email" type="email" value={f.email} onChange={set("email")} autoComplete="email" required hint={d.email ? "The address your invitation was sent to." : undefined} />
          <PasswordField id="password" label="Choose a password" value={f.password} onChange={(v) => setF({ ...f, password: v })} autoComplete="new-password" hint="At least 8 characters, so you can come back to finish." />
          <FormError msg={err} />
          <Button type="submit" size="lg" className="w-full !rounded-full" loading={loading}>
            Start my handover {!loading && <ArrowRight className="h-4 w-4" />}
          </Button>
        </form>
      </div>
      <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-[12.5px] text-ink-faint">
        <Check className="h-3.5 w-3.5" /> When you finish, what you share goes to {d.org_name}'s knowledge base.
      </p>
    </CardFrame>
  );
}
