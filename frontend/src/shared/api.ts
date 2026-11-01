import { useQuery } from "@tanstack/react-query";
import { fileNameFor, request } from "@/lib/api";
import type * as T from "./types";

const get = <R,>(p: string) => request<R>(p);
const post = <R,>(p: string, json?: unknown) => request<R>(p, { method: "POST", json: json ?? {} });
const postForm = <R,>(p: string, form: FormData) => request<R>(p, { method: "POST", body: form });

function qs(params: Record<string, string | number | undefined | null>) {
  const s = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  });
  const str = s.toString();
  return str ? `?${str}` : "";
}

export const knowledge = {
  employees: () => get<T.Employee[]>("/employees"),
  employee: (eid: number) => get<T.EmployeeDetail>(`/employees/${eid}`),
  mail: (eid: number, p: { folder?: string; q?: string; offset?: number; limit?: number }) =>
    get<T.MailList>(`/employees/${eid}/mail${qs(p)}`),
  mailItem: (id: string) => get<T.MailDetail>(`/mail/${encodeURIComponent(id)}`),
  chat: (eid: number) => get<{ channels: T.ChatChannel[] }>(`/employees/${eid}/chat`),
  channel: (cid: string) => get<{ items: T.ChatMsg[] }>(`/chat/channels/${encodeURIComponent(cid)}${qs({ limit: 200 })}`),
  files: (eid: number) => get<{ tree: T.FileNode[] }>(`/employees/${eid}/files`),
  file: (id: string) => get<T.FileDetail>(`/files/${encodeURIComponent(id)}`),
  exclude: (kind: "mail" | "chat" | "file", id: string, excluded: boolean) =>
    post<{ ok: boolean }>(`/items/${kind}/${encodeURIComponent(id)}/exclude`, { excluded }),
  cards: (eid: number, p: { type?: string; project?: string; status?: string; q?: string } = {}) =>
    get<T.Card[]>(`/employees/${eid}/cards${qs(p)}`),
  walk: (token: string) => get<T.WalkInfo>(`/walk/${encodeURIComponent(token)}`),
  walkFrame: (token: string, frame: Blob, t: number, transcript_chunk?: string) => {
    const f = new FormData();
    f.append("frame", frame, `frame-${t}.jpg`);
    f.append("t", String(t));
    if (transcript_chunk) f.append("transcript_chunk", transcript_chunk);
    return postForm<{ kept: boolean }>(`/walk/${encodeURIComponent(token)}/frames`, f);
  },
  walkAudio: (token: string, audio: Blob) => {
    const f = new FormData();
    f.append("audio", audio, fileNameFor(audio, "walk", "audio"));
    return postForm<{ transcript: string }>(`/walk/${encodeURIComponent(token)}/audio`, f);
  },
  walkFinish: (token: string) => post<{ new_cards: T.Card[] }>(`/walk/${encodeURIComponent(token)}/finish`),
  briefing: (eid: number) => get<T.Briefing>(`/employees/${eid}/briefing`),
  ask: (b: { eid: number | null; question: string; mode: "question" | "takeover" }) => post<T.AskAnswer>("/ask", b),
  asks: (eid: number) => get<T.AskAnswer[]>(`/employees/${eid}/asks`),
  map: () => get<T.KnowledgeMap>("/map"),
};

const knowledgeKeys = {
  employees: ["kb", "employees"] as const,
  employee: (eid: number) => ["kb", "employee", eid] as const,
  sources: (eid: number) => ["kb", "employee", eid, "sources"] as const,
  interview: (eid: number) => ["kb", "employee", eid, "interview"] as const,
  cards: (eid: number) => ["kb", "employee", eid, "cards"] as const,
  briefing: (eid: number) => ["kb", "employee", eid, "briefing"] as const,
  cost: ["kb", "cost"] as const,
  map: ["kb", "map"] as const,
};

export const useEmployees = () => useQuery({ queryKey: knowledgeKeys.employees, queryFn: knowledge.employees });
export const useEmployee = (eid: number) =>
  useQuery({ queryKey: knowledgeKeys.employee(eid), queryFn: () => knowledge.employee(eid), enabled: !!eid });
export const useCards = (eid: number) => useQuery({ queryKey: knowledgeKeys.cards(eid), queryFn: () => knowledge.cards(eid) });
export const useBriefing = (eid: number) =>
  useQuery({ queryKey: knowledgeKeys.briefing(eid), queryFn: () => knowledge.briefing(eid), retry: false });
export const useMap = () => useQuery({ queryKey: knowledgeKeys.map, queryFn: knowledge.map });
