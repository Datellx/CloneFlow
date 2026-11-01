import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { BookOpen, Grid3x3, LayoutDashboard, LogOut, Menu, MessagesSquare, Mic, Settings, Sparkles, Webhook, X } from "lucide-react";
import { ApiError, useMe } from "@/lib/api";
import { cn } from "@/lib/format";
import { Logo } from "@/components/domain";
import { PersonAvatar } from "../../shared/bits";
import { Orb } from "../../shared/Orb";
import { signInPath, useSignOut } from "../orgs";

/** The company console: calm, a left sidebar, nothing the person leaving ever sees. */
export default function AdminShell() {
  const me = useMe();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [loc.pathname]);
  const fullBleed = /^\/admin\/ask/.test(loc.pathname);

  if (me.isLoading)
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <Orb size={88} state="thinking" />
      </div>
    );
  if (me.error) {
    if (me.error instanceof ApiError && me.error.status === 401) return <Navigate to={signInPath(loc.pathname + loc.search)} replace />;
    return <div className="flex min-h-screen items-center justify-center bg-paper p-6 text-ink-muted">{(me.error as Error).message}</div>;
  }
  const m = me.data!;
  const isAdmin = m.is_admin ?? m.user.role === "admin";
  if (!isAdmin) return <Navigate to={m.home ?? "/session"} replace />;

  return (
    <div className="min-h-screen bg-paper">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">Skip to content</a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[240px] border-r border-line bg-white lg:block">
        <Nav />
      </aside>
      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <motion.div className="absolute inset-0 bg-[#2A0E17]/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} />
            <motion.aside className="absolute inset-y-0 left-0 w-[272px] max-w-[85vw] bg-white" initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }} transition={{ duration: 0.2, ease: "easeOut" }}>
              <Nav onClose={() => setOpen(false)} />
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
      <div className="lg:pl-[240px]">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-white/90 px-4 backdrop-blur lg:hidden">
          <button onClick={() => setOpen(true)} className="-ml-1 rounded-lg p-2 text-ink-soft hover:bg-paper" aria-label="Open navigation">
            <Menu className="h-5 w-5" />
          </button>
          <Logo to="/admin" />
          <span className="w-9" />
        </header>
        <main id="main" className={cn(fullBleed ? "h-[calc(100dvh-56px)] lg:h-[100dvh]" : "mx-auto w-full max-w-[1180px] px-4 pb-20 pt-8 sm:px-8 lg:px-10 lg:pt-10")}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function Nav({ onClose }: { onClose?: () => void }) {
  const me = useMe().data!;
  const pack = /^\/admin\/people\//.test(useLocation().pathname); // a pack lives in the knowledge base
  const item = ({ isActive }: { isActive: boolean }) =>
    cn(
      "flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] font-medium transition-colors",
      isActive ? "bg-brand-50 text-brand-800" : "text-ink-soft hover:bg-paper hover:text-ink",
    );
  const icon = "h-[18px] w-[18px] shrink-0";
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-5 pb-2 pt-5">
        <Logo to="/admin" />
        {onClose && (
          <button onClick={onClose} className="rounded-lg p-1.5 text-ink-muted hover:bg-paper" aria-label="Close navigation">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>
      <div className="px-5 pb-4 text-[12.5px] text-ink-muted">{me.org.name}</div>
      <nav className="flex-1 space-y-0.5 px-3" aria-label="Console">
        <NavLink to="/admin" end className={item}><LayoutDashboard className={icon} /> Overview</NavLink>
        <NavLink to="/admin/knowledge" className={({ isActive }) => item({ isActive: isActive || pack })}><BookOpen className={icon} /> Knowledge base</NavLink>
        <NavLink to="/admin/map" className={item}><Grid3x3 className={icon} /> Knowledge map</NavLink>
        <NavLink to="/admin/ask" className={item}><MessagesSquare className={icon} /> Ask Clone Flow</NavLink>
        <NavLink to="/admin/teams" className={item}><Webhook className={icon} /> Teams</NavLink>
        <NavLink to="/setup" className={item}><Sparkles className={icon} /> Setup assistant</NavLink>
        <NavLink to="/admin/settings" className={item}><Settings className={icon} /> Settings & plan</NavLink>
        {me.owned_clone_ids.length > 0 && (
          <Link to="/session" className={item({ isActive: false })}><Mic className={icon} /> My handover</Link>
        )}
      </nav>
      <UserMenu />
    </div>
  );
}

function UserMenu() {
  const me = useMe().data!;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const signOutTo = useSignOut();
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const signOut = () => signOutTo(me.org.slug);
  return (
    <div ref={ref} className="relative border-t border-line p-3">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-paper">
        <PersonAvatar name={me.user.name} size={28} color="#C96B85" />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[13px] font-medium text-ink">{me.user.name}</div>
          <div className="truncate text-[11.5px] text-ink-muted">{me.user.email}</div>
        </div>
      </button>
      {open && (
        <div className="absolute bottom-full left-3 right-3 mb-1 overflow-hidden rounded-xl border border-line bg-white py-1 shadow-lift">
          <button onClick={signOut} className="flex w-full items-center gap-2.5 px-3 py-2 text-sm hover:bg-paper">
            <LogOut className="h-4 w-4 text-ink-muted" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
