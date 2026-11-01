// v4 marketing chrome: header, footer and the frame shared by the landing, /download and the legal pages.
import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Menu, X } from "lucide-react";
import { Logo } from "@/components/domain";
import { cn } from "@/lib/format";

const NAV: { label: string; to: string }[] = [
  { label: "How it works", to: "/#how" },
  { label: "For IT & security", to: "/#security" },
  { label: "Pricing", to: "/#pricing" },
];

/** Scroll to the hash after navigation (react-router doesn't). */
function useHashScroll() {
  const loc = useLocation();
  useEffect(() => {
    if (!loc.hash) {
      window.scrollTo(0, 0);
      return;
    }
    const t = window.setTimeout(() => document.getElementById(loc.hash.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" }), 40);
    return () => window.clearTimeout(t);
  }, [loc.pathname, loc.hash]);
}

function MarketingHeader() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname, loc.hash]);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  const nav = NAV;
  return (
    <header className={cn("sticky top-0 z-40 transition-colors", scrolled || open ? "border-b border-line/80 bg-paper/85 backdrop-blur-md" : "border-b border-transparent")}>
      <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-6 px-4 sm:px-8">
        <Logo />
        <nav className="hidden items-center gap-1 lg:flex" aria-label="Main">
          {nav.map((n) => (
            <Link key={n.to} to={n.to} className="rounded-lg px-3 py-2 text-[14px] font-medium text-ink-soft transition-colors hover:bg-white hover:text-ink">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <Link to="/login" className="rounded-lg px-3 py-2 text-[14px] font-medium text-ink-soft hover:bg-white hover:text-ink">Sign in</Link>
          <Link
            to="/signup"
            className="hidden h-10 items-center rounded-full bg-brand-700 px-5 text-[14px] font-medium text-white shadow-[0_8px_20px_-10px_rgba(122,30,58,.7)] transition-colors hover:bg-brand-800 sm:inline-flex"
          >
            Create your organization
          </Link>
          <button onClick={() => setOpen((v) => !v)} className="rounded-lg p-2 text-ink-soft hover:bg-white lg:hidden" aria-expanded={open} aria-label={open ? "Close menu" : "Open menu"}>
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
      <AnimatePresence>
        {open && (
          <motion.nav
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden lg:hidden"
            aria-label="Main"
          >
            <div className="mx-auto max-w-[1200px] space-y-0.5 px-4 pb-4 sm:px-8">
              {nav.map((n) => (
                <Link key={n.to} to={n.to} className="block rounded-lg px-3 py-2.5 text-[15px] font-medium text-ink-soft hover:bg-white hover:text-ink">{n.label}</Link>
              ))}
              <Link to="/signup" className="mt-2 flex h-11 items-center justify-center rounded-full bg-brand-700 text-[15px] font-medium text-white sm:hidden">Create your organization</Link>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}

function MarketingFooter() {
  return (
    <footer className="border-t border-line bg-white">
      <div className="mx-auto grid max-w-[1200px] gap-10 px-4 py-12 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-3 max-w-[30ch] text-[13.5px] leading-relaxed text-ink-muted">
            Keeps what people know when they leave. Made by Datellx LLC in Madison, Wisconsin.
          </p>
        </div>
        <FooterCol title="Product" links={[["How it works", "/#how"], ["Pricing", "/#pricing"], ["Desktop apps", "/download"]]} />
        <FooterCol title="Trust" links={[["For IT & security", "/#security"], ["Privacy", "/privacy"], ["Terms", "/terms"]]} />
        <FooterCol title="Account" links={[["Create your organization", "/signup"], ["Sign in to your organization", "/login"]]} />
      </div>
      <div className="border-t border-line">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-1 px-4 py-5 text-[12.5px] text-ink-faint sm:flex-row sm:justify-between sm:px-8">
          <span>© {new Date().getFullYear()} Datellx LLC · Madison, WI</span>
          <span>Microsoft, Teams and Outlook are trademarks of Microsoft Corporation.</span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <div className="text-[13px] font-semibold text-ink">{title}</div>
      <ul className="mt-3 space-y-2">
        {links.map(([l, to]) => (
          <li key={to}><Link to={to} className="text-[13.5px] text-ink-muted hover:text-ink">{l}</Link></li>
        ))}
      </ul>
    </div>
  );
}

export function MarketingFrame({ children }: { children: ReactNode }) {
  useHashScroll();
  return (
    <div className="min-h-[100dvh] bg-paper">
      <MarketingHeader />
      {children}
      <MarketingFooter />
    </div>
  );
}

/** Section heading used across the marketing pages. */
export function Eyebrow({ children, light }: { children: ReactNode; light?: boolean }) {
  return <div className={cn("text-[12.5px] font-semibold uppercase tracking-[0.14em]", light ? "text-brand-200" : "text-brand-700")}>{children}</div>;
}
