import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { qk } from "./api";
import type { Me } from "./types";

/** Where each person lands: admins in the console (after the setup conversation), people leaving in their handover. */
export function homeFor(me: Me) {
  return me.home ?? (me.user.role === "admin" ? "/admin" : "/session");
}

/** After sign-in / sign-up / join: forget the previous account's data and go home (or to ?next=). */
export function useAfterAuth() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [params] = useSearchParams();
  return (me: Me) => {
    // keep the invitation the join page is still showing
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "invite" });
    qc.setQueryData(qk.me, me);
    const next = params.get("next");
    nav(next && /^\/(admin|session|ask|setup)(\/|\?|$)/.test(next) ? next : homeFor(me), { replace: true });
  };
}
