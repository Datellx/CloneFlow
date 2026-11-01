// Sign-in, one API for the pages: Supabase Auth when the server has it configured (verified emails, password
// resets, invitation emails), otherwise the built-in email + password sign-in. After Supabase signs someone in,
// the token is exchanged once for a Clone Flow session (POST /api/auth/session).
import type { SupabaseClient } from "@supabase/supabase-js";
import { api, request } from "./api";
import type { Me } from "./types";

let client: SupabaseClient | null = null;
let checked: Promise<SupabaseClient | null> | null = null;

/** The Supabase client, or null when the server uses built-in sign-in. */
export function supabase(): Promise<SupabaseClient | null> {
  if (!checked) {
    checked = api.status().then(async (s) => {
      const a = s.auth;
      if (a?.provider === "supabase" && a.url && a.anon_key) {
        const { createClient } = await import("@supabase/supabase-js"); // loaded only when Supabase is in use
        client = createClient(a.url, a.anon_key, {
          auth: { flowType: "implicit", detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
        });
      }
      return client;
    }).catch(() => null);
  }
  return checked;
}

const origin = () => window.location.origin;

export async function exchange(accessToken: string, extra: { org_name?: string; name?: string; invite_code?: string } = {}) {
  return request<Me>("/auth/session", { method: "POST", json: { access_token: accessToken, ...extra } });
}

export type SignUpResult = { me: Me } | { checkEmail: true } | { exists: true };

/** Admin creates the organization. With Supabase: a confirmation email first (unless the project auto-confirms). */
export async function signUpOrg(p: { org_name: string; name: string; email: string; password: string }): Promise<SignUpResult> {
  const sb = await supabase();
  if (!sb) return { me: await api.signup(p) };
  const { data, error } = await sb.auth.signUp({
    email: p.email, password: p.password,
    options: { emailRedirectTo: `${origin()}/auth/callback`, data: { name: p.name, org_name: p.org_name } },
  });
  if (error) throw new Error(friendly(error.message));
  if (data.user && (data.user.identities?.length ?? 0) === 0) return { exists: true };
  if (data.session) return { me: await exchange(data.session.access_token, { org_name: p.org_name, name: p.name }) };
  return { checkEmail: true };
}

/** The person leaving accepts an invitation. */
export async function signUpInvite(p: { invite_code: string; name: string; email: string; password: string }): Promise<SignUpResult> {
  const sb = await supabase();
  if (!sb) return { me: await api.join(p) };
  // Arrived from the invitation email: already signed in with Supabase — just choose a password.
  const { data: cur } = await sb.auth.getSession();
  if (cur.session && cur.session.user.email?.toLowerCase() === p.email.toLowerCase()) {
    const { error } = await sb.auth.updateUser({ password: p.password, data: { name: p.name } });
    if (error) throw new Error(friendly(error.message));
    return { me: await exchange(cur.session.access_token, { invite_code: p.invite_code, name: p.name }) };
  }
  const { data, error } = await sb.auth.signUp({
    email: p.email, password: p.password,
    options: { emailRedirectTo: `${origin()}/auth/callback`, data: { name: p.name, invite_code: p.invite_code } },
  });
  if (error) throw new Error(friendly(error.message));
  if (data.user && (data.user.identities?.length ?? 0) === 0) return { exists: true };
  if (data.session) return { me: await exchange(data.session.access_token, { invite_code: p.invite_code, name: p.name }) };
  return { checkEmail: true };
}

export async function signIn(email: string, password: string): Promise<Me> {
  const sb = await supabase();
  if (!sb) return api.login({ email, password });
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(friendly(error.message));
  return exchange(data.session.access_token);
}

export async function resendConfirmation(email: string) {
  const sb = await supabase();
  if (!sb) return;
  const { error } = await sb.auth.resend({ type: "signup", email, options: { emailRedirectTo: `${origin()}/auth/callback` } });
  if (error) throw new Error(friendly(error.message));
}

/** "Forgot password?" — Supabase emails a link to /auth/reset. */
export async function sendPasswordReset(email: string): Promise<boolean> {
  const sb = await supabase();
  if (!sb) return false;
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${origin()}/auth/reset` });
  if (error) throw new Error(friendly(error.message));
  return true;
}

export async function signOutEverywhere() {
  const sb = await supabase();
  if (sb) await sb.auth.signOut().catch(() => undefined);
  await api.logout().catch(() => undefined);
}

/** Wait for the session that Supabase reads from an email link (#access_token=… in the address). */
export async function sessionFromLink(timeoutMs = 4000) {
  const sb = await supabase();
  if (!sb) return null;
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const err = hash.get("error_description");
  if (err) throw new Error(friendly(err.replace(/\+/g, " ")));
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { data } = await sb.auth.getSession();
    if (data.session) return data.session;
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}

function friendly(msg: string) {
  const m = msg.toLowerCase();
  if (m.includes("invalid login credentials")) return "That email and password don't match.";
  if (m.includes("email not confirmed")) return "Please confirm your email first — check your inbox for our link.";
  if (m.includes("rate limit") || m.includes("too many")) return "Too many attempts. Please wait a minute and try again.";
  if (m.includes("expired") || m.includes("invalid")) return "This link has expired. Request a new one.";
  if (m.includes("password should be")) return "Use a password of at least 8 characters.";
  return msg;
}
