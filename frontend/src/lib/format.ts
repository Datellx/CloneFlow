import { clsx, type ClassValue } from "clsx";

export const cn = (...v: ClassValue[]) => clsx(v);

export function daysUntil(date: string | null | undefined): number | null {
  if (!date) return null;
  const d = new Date(date + (date.length === 10 ? "T00:00:00" : ""));
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - now.getTime()) / 86_400_000);
}

export const pct = (x: number | null | undefined, digits = 0) =>
  x === null || x === undefined ? "–" : `${(x * 100).toFixed(digits)}%`;

export const firstName = (full: string | null | undefined) => (full || "").trim().split(/\s+/)[0] || "the expert";
