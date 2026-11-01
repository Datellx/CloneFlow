// Sign-in helpers shared by the app: where signed-out people go, sign out, page titles.
import { useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

/** Where a signed-out visitor goes (one sign-in page; the email finds the organization). */
export function signInPath(next?: string) {
  const q = next && next !== "/" ? `?next=${encodeURIComponent(next)}` : "";
  return `/login${q}`;
}

/** Sign out and return to the organization's sign-in page. */
export function useSignOut(before?: () => void) {
  const qc = useQueryClient();
  const nav = useNavigate();
  return useCallback(
    async (_slug?: string | null) => {
      before?.();
      try {
        await api.logout();
      } catch {
        /* already signed out */
      }
      qc.clear();
      nav("/login", { replace: true });
    },
    [qc, nav, before],
  );
}

/** Consistent browser-tab titles: "Page · Clone Flow". */
export function useTitle(title?: string | null) {
  useEffect(() => {
    document.title = title ? `${title} · Clone Flow` : "Clone Flow";
  }, [title]);
}

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
