import { Link } from "react-router-dom";
import { cn } from "@/lib/format";

/* -------------------------------------------------------------- Logo */
export function Logo({ to = "/", light = false, className }: { to?: string; light?: boolean; className?: string }) {
  return (
    <Link to={to} className={cn("group inline-flex items-center gap-2.5", className)} aria-label="Clone Flow home">
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="8" fill={light ? "#fff" : "#7A1E3A"} />
        <path d="M10 9.5h7a5 5 0 0 1 0 10h-3.5M10 9.5v13" stroke={light ? "#7A1E3A" : "#fff"} strokeWidth="2.4" fill="none" strokeLinecap="round" />
        <circle cx="22" cy="22.5" r="2" fill={light ? "#C96B85" : "#F3C9D4"} />
      </svg>
      <span className={cn("font-display text-[21px] font-medium tracking-tight", light ? "text-white" : "text-ink")}>Clone Flow</span>
    </Link>
  );
}
