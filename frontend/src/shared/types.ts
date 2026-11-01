// Knowledge types (docs/API.md).

type EmployeeStatus = "not_started" | "reading" | "read" | "interviewing" | "captured";
export interface Employee {
  id: number;
  name: string;
  title: string;
  team: string;
  years: number | null;
  started_on: string | null;
  leaving_on: string | null;
  avatar_color: string;
  coverage: number;
  status: EmployeeStatus;
  counts: {
    emails: number; chats: number; files: number; screen: number; floor: number;
    cards: number; verified_cards: number; gaps_open: number;
  };
}
interface Profile {
  started_on: string | null;
  roles: { title: string; from: string; to: string | null }[];
  summary: string;
  projects: { id: string | number; name: string; years: string; cards: number }[];
}
export type EmployeeDetail = Employee & { profile: Profile | null };

type SourceKindV2 = "email" | "chat" | "files" | "screen" | "floor";
export interface SourceCard {
  kind: SourceKindV2;
  label: string;
  connected: boolean;
  consent: boolean;
  counts: { items: number; threads?: number; excluded: number };
  connected_at: string | null;
  provider: string | null;
}

interface MailItem {
  id: string;
  thread_id: string;
  folder: string;
  subject: string;
  from_name: string;
  from_email: string;
  to: string[];
  sent_at: string;
  snippet: string;
  unread: boolean;
  excluded: boolean;
  is_noise: boolean;
}
export type MailDetail = MailItem & { body_text: string; thread: (MailItem & { body_text: string })[] };
export interface MailList { folders: { name: string; count: number }[]; total: number; items: MailItem[] }

export interface ChatChannel { id: string; name: string; kind: "channel" | "dm"; members: string[]; count: number }
export interface ChatMsg {
  id: string;
  channel_id: string;
  thread_id: string | null;
  author: string;
  sent_at: string;
  text: string;
  reactions: { emoji: string; count: number }[];
  reply_count: number;
}

type FileKind = "folder" | "doc" | "sheet" | "pdf" | "image" | "video" | "text" | "other";
export interface FileNode {
  id: string;
  name: string;
  path: string;
  kind: FileKind;
  size: number;
  modified_at: string;
  children?: FileNode[];
}
export type FileDetail = FileNode & {
  preview: { type: "text" | "table" | "image" | "video" | "none"; text?: string; rows?: string[][]; url?: string };
};

export type CardType = "process" | "decision" | "system" | "contact" | "location" | "open_task" | "routine" | "fact";
type ProofKind = "email" | "chat" | "file" | "screen" | "floor" | "interview";
export interface Proof {
  kind: ProofKind;
  ref: string;
  label: string;
  timestamp_s?: number;
  frame_url?: string;
  quote?: string;
}
export interface Card {
  id: string | number;
  type: CardType;
  title: string;
  body: string;
  steps: string[];
  project: string | null;
  sources: Proof[];
  confidence: number;
  status: "inferred" | "verified_in_interview" | "contradicted";
  owner: number;
  related_people: string[];
  related_projects: string[];
  created_at: string;
  updated_at: string;
}

type RunStage = "filter" | "extract" | "link" | "gaps" | "done";
type RunCounters = {
  read: number; filtered_out: number; emails: number; chats: number; files: number; projects: number;
  processes: number; systems: number; people: number; decisions: number; open_tasks: number; routines: number;
  locations: number; facts: number; contacts: number;
};
export interface Run {
  id: number | string;
  status: "running" | "done" | "failed";
  stage: RunStage;
  progress: number;
  counters: RunCounters;
  coverage: number;
  gaps: number;
  started_at: string;
  finished_at: string | null;
}

export type GapType = "missing_why" | "contradiction" | "unfinished_task" | "undocumented_step" | "who_to_contact";
interface Answer { transcript: string; mode: "voice" | "text" | "screen" | "floor"; cards: Card[]; at: string }
export interface Question {
  id: number | string;
  index: number;
  kind: "about_you" | "gap";
  gap_type: GapType | null;
  text: string;
  evidence: Proof[];
  status: "open" | "answered" | "skipped";
  answer: Answer | null;
}
export interface WalkStart { token: string; url: string; qr_svg: string }
export interface WalkInfo { employee_name: string; question: Question | null; status: string }
export interface WalkFeedItem { seq: number; frame_url: string; label: string; transcript: string; at: string }

export interface Briefing {
  projects: { name: string; status: string; note: string }[];
  open_tasks: Card[];
  contacts: Card[];
  routines: Card[];
  will_break: { title: string; why: string; sources: Proof[] }[];
}
export interface AskAnswer {
  id: number | string;
  question: string;
  known: boolean;
  answer: string;
  steps: string[];
  cards: Card[];
  proofs: Proof[];
  verified: boolean;
  ask_person: { name: string; why: string } | null;
  images: string[];
  cached: boolean;
}

export interface KnowledgeMap {
  people: { eid: number; name: string; title: string; coverage: number; status: string; leaving_on: string | null }[];
  areas: string[];
  cells: { eid: number; area: string; cards: number; verified: number; sole_holder: boolean; captured: boolean }[];
  at_risk: { area: string; holder: string; captured: boolean }[];
  orphaned_tasks: Card[];
}
