import { useQuery } from "@tanstack/react-query";
import { fileNameFor, postBig, request } from "@/lib/api";
import type { Employee } from "../shared/types";
import type { WalkFeedItem, WalkStart } from "../shared/types";
import type * as T from "./types";

const get = <R,>(p: string) => request<R>(p);
const post = <R,>(p: string, json?: unknown) => request<R>(p, { method: "POST", json: json ?? {} });
const postForm = <R,>(p: string, form: FormData) => request<R>(p, { method: "POST", body: form });

export const handover = {
  session: () => get<T.Session>("/me/session"),
  start: () => post<T.Session>("/me/session/start"),
  message: (p: { text?: string; audio?: Blob }) => {
    if (p.text && !p.audio) return post<T.SessionReply>("/me/session/message", { text: p.text });
    const f = new FormData();
    if (p.text) f.append("text", p.text);
    if (p.audio) f.append("audio", p.audio, fileNameFor(p.audio, "answer", "audio"));
    return postForm<T.SessionReply>("/me/session/message", f);
  },
  skip: () => post<T.SessionReply>("/me/session/skip"),
  read: () => post<T.SessionReply>("/me/session/read"),
  finish: () => post<T.SessionReply>("/me/session/finish"),
  upload: (files: File[], note?: string) => {
    const f = new FormData();
    files.forEach((file) => f.append("files", file, file.name));
    if (note) f.append("note", note);
    return postBig<T.SessionReply>("/me/session/upload", f);
  },
  screen: (video: Blob, narration?: string) => {
    const f = new FormData();
    f.append("video", video, fileNameFor(video, "screen", "video"));
    if (narration) f.append("narration", narration);
    return postBig<T.SessionReply>("/me/session/screen", f);
  },
  walk: () => post<WalkStart>("/me/session/walk"),
  walkFeed: (after: number) => get<{ items: WalkFeedItem[]; done?: boolean }>(`/me/session/walk/feed?after=${after}`),

  providers: () => get<T.Provider[]>("/connect/providers"),

  overview: () => get<T.AdminOverview>("/admin/overview"),
  invite: (b: { name: string; email: string; title?: string; team?: string; leaving_on?: string; focus?: string }) =>
    post<{ employee: Employee; link: string; emailed?: boolean }>("/admin/invite", b),
  setup: () => get<T.SetupState>("/setup"),
  setupMessage: (text: string) => post<T.SetupReply>("/setup/message", { text }),
  setupFinish: (skipped = false) => post<{ ok: boolean }>("/setup/finish", { skipped }),
  teams: () => get<T.TeamsSetup>("/admin/teams"),
  saveTeams: (secret: string) => post<T.TeamsSetup>("/admin/teams", { secret }),
};

export const handoverKeys = {
  session: ["handover", "session"] as const,
  overview: ["handover", "overview"] as const,
  teams: ["handover", "teams"] as const,
  setup: ["handover", "setup"] as const,
};

export const useSetup = () => useQuery({ queryKey: handoverKeys.setup, queryFn: handover.setup });

export const useSession = () =>
  useQuery({
    queryKey: handoverKeys.session,
    queryFn: handover.session,
    // Poll while reading, and while a connected account is still importing (live counts on its tile).
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) return false;
      if (d.stage === "reading") return 1000;
      const c = d.actions.find((a) => a.type === "connect") as { providers?: T.Provider[] } | undefined;
      return c?.providers?.some((p) => p.status === "importing") ? 1000 : false;
    },
  });
export const useOverview = () => useQuery({ queryKey: handoverKeys.overview, queryFn: handover.overview, refetchInterval: 10_000 });
export const useTeamsSetup = () => useQuery({ queryKey: handoverKeys.teams, queryFn: handover.teams });
