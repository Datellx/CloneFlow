// Handover and console types (docs/API.md).
import type { Plan } from "@/lib/types";
import type { Card, Employee, GapType, Proof, Question, Run, SourceCard } from "../shared/types";

type Stage = "welcome" | "intro" | "connect" | "reading" | "interview" | "open" | "done";
type MsgKind = "text" | "connect" | "reading" | "evidence" | "cards" | "upload" | "summary" | "walk";

export interface Provider {
  /** microsoft (first), gmail, github. */
  key: "microsoft" | "gmail" | "github" | "files" | "demo";
  label: string;
  connected: boolean;
  configured: boolean;
  start_url?: string | null;
  note?: string;
  /** Connected account, e.g. dana@contoso.onmicrosoft.com. */
  account?: string | null;
  status?: "connected" | "importing" | "done" | "error" | null;
  /** Live import counts, e.g. {emails, chats, files} or {repos, prs, docs}. */
  counts?: Record<string, number>;
  /** Connected with the organization's demo data rather than a real account. */
  demo?: boolean;
  error?: string | null;
}

export interface ReadingPayload {
  counters: { emails: number; chats: number; files: number };
  personal_skipped: number;
  noise_skipped: number;
  done?: boolean;
}
export interface EvidencePayload { sources: Proof[]; gap_type: GapType | null; index?: number; total?: number }
export interface UploadPayload { files: { name: string; size: number; type: string }[]; screen?: boolean }
export interface SummaryPayload {
  processes: number; contacts: number; open_tasks: number; locations: number;
  coverage_before: number; coverage_after: number; cards?: number; verified?: number;
}
export interface WalkPayload { items?: { seq: number; frame_url: string; label: string; transcript: string }[]; url?: string; qr_svg?: string }

export interface Msg {
  id: string | number;
  role: "avatar" | "user" | "system";
  text: string;
  at: string;
  kind: MsgKind;
  payload?: unknown;
}

export type Action =
  | { type: "connect"; providers: Provider[] }
  | { type: "start_reading"; label?: string }
  | { type: "answer" }
  | { type: "add"; modes: ("screen" | "upload" | "phone")[] }
  | { type: "skip" }
  | { type: "skip_connect"; label?: string }
  | { type: "finish"; label?: string }
  | { type: "start" };

export interface Session {
  eid: number;
  name: string;
  first_name: string;
  company: string;
  stage: Stage;
  messages: Msg[];
  actions: Action[];
  question: Question | null;
  coverage: number;
  coverage_before: number | null;
  progress: { asked: number; total: number };
  run: Run | null;
  sources: SourceCard[];
  cards_recent: Card[];
  ai_enabled: boolean;
}

export interface SessionReply { messages: Msg[]; session: Session }

interface AdminInvite { id: number; email: string; name?: string; link: string; created_at: string; accepted: boolean; eid?: number }
export interface OrgProfile {
  summary?: string | null;
  industry?: string | null;
  why?: string | null;
  critical_areas?: string[] | null;
  teams?: string[] | null;
  tools?: string[] | null;
  vocabulary?: string[] | null;
  done?: boolean;
}
export interface PlanUsage extends Plan { used: number; left: number }

export interface AdminOverview {
  org: { id: number; name: string; profile: OrgProfile };
  plan: PlanUsage;
  people: Employee[];
  invites: AdminInvite[];
  ai_allowance?: { cap_usd: number; spent_usd: number; left_usd: number | null; reached: boolean };
  unanswered: ({ eid: number | null; name: string; question: string } | string)[];
}

/** The admin's setup assistant (GET /setup, POST /setup/message). */
export interface SetupMsg {
  id: number;
  role: "assistant" | "user";
  text: string;
  payload: { invites?: { name: string; email: string; link: string; eid: number }[]; problem?: boolean; done?: boolean } | null;
  at: string | null;
}
export interface SetupState {
  org: string;
  done: boolean;
  profile: OrgProfile;
  messages: SetupMsg[];
  plan: PlanUsage;
  ai_ready: boolean;
}
export interface SetupReply { messages: SetupMsg[]; done: boolean; profile: OrgProfile; plan: PlanUsage }

/** Microsoft Teams outgoing webhook ("@Clone Flow …" in a channel). */
export interface TeamsSetup { webhook_url: string; configured: boolean; bot_name: string }
