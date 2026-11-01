// Account and system types (docs/API.md). Knowledge types live in shared/types.ts, handover types in app/types.ts.

export interface Plan {
  key: "starter" | "growth" | "pro";
  name: string;
  employees: number;
  free: boolean;
  blurb: string;
}

export interface SystemStatus {
  llm_provider: "meta" | "mock";
  model: string;
  tts_provider: "browser" | "openai" | "elevenlabs";
  version: string;
  ai_enabled?: boolean;
  product?: boolean;
  flags?: Record<string, boolean>;
  plans?: Plan[];
  /** Desktop app installers; a platform listed in coming_soon has no installer yet. */
  download?: { mac: string | null; windows: string | null; coming_soon: ("mac" | "windows")[] };
  /** Sign-in provider: Supabase (url + public anon key) or the built-in one. */
  auth?: { provider: "supabase" | "local"; url?: string; anon_key?: string };
}

type OrgRole = "admin" | "member";
export interface Me {
  user: { id: number; name: string; email: string; role: OrgRole; initials: string };
  org: { id: number; name: string; slug: string; created_at: string; plan?: Plan; set_up?: boolean };
  owned_clone_ids: number[];
  /** Where to land after sign-in. */
  home?: "/session" | "/admin" | "/ask" | "/setup";
  is_admin?: boolean;
}
