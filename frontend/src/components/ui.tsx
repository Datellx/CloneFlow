import { forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/format";

/* ---------------------------------------------------------------- Button */
type Variant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
type Size = "sm" | "md" | "lg";
const variants: Record<Variant, string> = {
  primary:
    "bg-brand-700 text-white hover:bg-brand-800 active:bg-brand-900 shadow-[inset_0_1px_0_rgba(255,255,255,.12),0_1px_2px_rgba(48,9,20,.2)] disabled:bg-brand-300",
  secondary: "bg-white text-ink border border-line-strong hover:border-ink-faint hover:bg-[#FDFBFA] disabled:text-ink-faint",
  ghost: "text-ink-soft hover:bg-brand-50 hover:text-brand-800 disabled:text-ink-faint",
  subtle: "bg-brand-50 text-brand-800 hover:bg-brand-100 disabled:opacity-60",
  danger: "bg-[#9B1C1C] text-white hover:bg-[#7F1616] disabled:opacity-50",
};
const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-lg",
  md: "h-10 px-4 text-sm gap-2 rounded-[10px]",
  lg: "h-12 px-6 text-[15px] gap-2 rounded-xl",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-colors duration-150 disabled:cursor-not-allowed",
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function LinkButton({
  to, variant = "primary", size = "md", className, children, icon,
}: { to: string; variant?: Variant; size?: Size; className?: string; children: ReactNode; icon?: ReactNode }) {
  return (
    <Link
      to={to}
      className={cn("inline-flex items-center justify-center whitespace-nowrap font-medium transition-colors", variants[variant], sizes[size], className)}
    >
      {icon}
      {children}
    </Link>
  );
}

/* ---------------------------------------------------------------- Badge */

/* --------------------------------------------------------------- Avatar */

/* ------------------------------------------------------------- Skeleton */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} />;
}

/* ----------------------------------------------------------- EmptyState */
export function EmptyState({
  icon, title, children, action, className,
}: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-14 text-center", className)}>
      {icon && <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">{icon}</div>}
      <h3 className="text-xl font-medium text-ink">{title}</h3>
      {children && <div className="mt-2 max-w-md text-sm text-ink-muted">{children}</div>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="card flex flex-col items-start gap-3 border-[#F0D5D5] bg-[#FFFBFB] p-5">
      <p className="text-sm font-medium text-[#9B1C1C]">This section didn't load.</p>
      <p className="text-sm text-ink-muted">{error instanceof Error ? error.message : "Something went wrong."}</p>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- Dialog */
export function Dialog({
  open, onClose, title, description, children, footer, size = "md",
}: { open: boolean; onClose: () => void; title: string; description?: ReactNode; children?: ReactNode; footer?: ReactNode; size?: "sm" | "md" | "lg" }) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  // Keep the latest onClose without re-running the open effect: callers often pass a new function every
  // render, and re-running it would steal focus back to the first field on every keystroke.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    document.addEventListener("keydown", onKey);
    const t = window.setTimeout(() => {
      if (ref.current?.contains(document.activeElement)) return; // the person is already typing in the dialog
      const el = ref.current?.querySelector<HTMLElement>("input,textarea,select,button[data-autofocus]") ?? ref.current;
      el?.focus();
    }, 30);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open]);
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
          <motion.div
            className="absolute inset-0 bg-[#2A0E17]/30 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-labelledby={id}
            tabIndex={-1}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className={cn(
              "relative max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-line bg-white shadow-lift outline-none sm:rounded-2xl",
              size === "sm" && "sm:max-w-md",
              size === "md" && "sm:max-w-lg",
              size === "lg" && "sm:max-w-2xl",
            )}
          >
            <div className="flex items-start justify-between gap-4 px-6 pb-2 pt-5">
              <div>
                <h2 id={id} className="text-[22px] font-medium leading-tight text-ink">{title}</h2>
                {description && <div className="mt-1.5 text-sm text-ink-muted">{description}</div>}
              </div>
              <button onClick={onClose} className="-mr-2 rounded-lg p-1.5 text-ink-muted hover:bg-paper hover:text-ink" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
            {children && <div className="px-6 py-3">{children}</div>}
            {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-paper/60 px-6 py-4">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/* --------------------------------------------------------------- Drawer */
export function Drawer({
  open, onClose, title, children, footer, width = 560,
}: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-40">
          <motion.div className="absolute inset-0 bg-[#2A0E17]/20" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside
            role="dialog"
            aria-modal="true"
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="absolute inset-y-0 right-0 flex w-full flex-col border-l border-line bg-white shadow-lift"
            style={{ maxWidth: width }}
          >
            <div className="flex items-start justify-between gap-3 border-b border-line px-6 py-4">
              <div className="min-w-0 flex-1">{title}</div>
              <button onClick={onClose} className="-mr-2 rounded-lg p-1.5 text-ink-muted hover:bg-paper hover:text-ink" aria-label="Close panel">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="scroll-thin flex-1 overflow-y-auto px-6 py-5">{children}</div>
            {footer && <div className="border-t border-line bg-paper/70 px-6 py-3.5">{footer}</div>}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/* --------------------------------------------------------------- Tooltip */

/* -------------------------------------------------------- Section header */

/* ------------------------------------------------------- Readiness ring */

/* --------------------------------------------------------------- Tabs */

/* --------------------------------------------------------- Progress bar */

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}
