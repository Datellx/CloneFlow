import { useQuery } from "@tanstack/react-query";
import type * as T from "./types";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function parseError(res: Response): Promise<ApiError> {
  let detail = `Request failed (${res.status})`;
  try {
    const body = await res.json();
    if (typeof body?.detail === "string") detail = body.detail;
    else if (Array.isArray(body?.detail) && body.detail[0]?.msg) detail = body.detail[0].msg;
  } catch {
    /* not json */
  }
  if (res.status === 0 || res.status >= 502) detail = detail || "The Clone Flow server is not reachable right now.";
  return new ApiError(res.status, detail);
}

export async function request<R>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<R> {
  const { json, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      credentials: "include",
      ...rest,
      headers: json !== undefined ? { "Content-Type": "application/json", ...(headers || {}) } : headers,
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new ApiError(0, "Can't reach the Clone Flow server. Check your connection and try again.");
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as R;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return (await res.json()) as R;
  return (await res.blob()) as unknown as R;
}

/** Large uploads (videos, screen recordings) may go straight to the engine when the website's proxy would refuse
 *  them: the server hands out a short-lived token and the engine's address (GET /me/upload-token). */
export async function postBig<R>(path: string, form: FormData): Promise<R> {
  let size = 0;
  form.forEach((v) => {
    if (v instanceof Blob) size += v.size;
  });
  if (size < 4 * 1024 * 1024) return request<R>(path, { method: "POST", body: form });
  let direct: { token: string | null; base: string | null } = { token: null, base: null };
  try {
    direct = await request<typeof direct>("/me/upload-token");
  } catch {
    /* older engine: upload as usual */
  }
  if (!direct.base || !direct.token) return request<R>(path, { method: "POST", body: form });
  let res: Response;
  try {
    res = await fetch(`${direct.base}/api${path}`, { method: "POST", body: form, headers: { "X-CF-Upload": direct.token } });
  } catch {
    throw new ApiError(0, "Can't reach the Clone Flow server. Check your connection and try again.");
  }
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as R;
}

const get = <R,>(p: string) => request<R>(p);
const post = <R,>(p: string, json?: unknown) => request<R>(p, { method: "POST", json: json ?? {} });
const postForm = <R,>(p: string, form: FormData) => request<R>(p, { method: "POST", body: form });


/* ----------------------------------------------------------------- raw API */
export const api = {
  status: () => get<T.SystemStatus>("/system/status"),
  me: () => get<T.Me>("/auth/me"),
  signup: (b: { org_name: string; name: string; email: string; password: string }) => post<T.Me>("/auth/signup", b),
  login: (b: { email: string; password: string }) => post<T.Me>("/auth/login", b),
  join: (b: { invite_code: string; name: string; email: string; password: string }) => post<T.Me>("/auth/join", b),
  logout: () => post<{ ok: true }>("/auth/logout"),
  inviteInfo: (code: string) =>
    get<{ org_name: string; email: string; role: string; kind?: "handover" | "colleague"; name: string; title: string; leaving_on: string | null; inviter: string | null }>(
      `/auth/invite/${encodeURIComponent(code)}`,
    ),
  lookup: (email: string) => post<{ found: boolean; org_name: string | null; microsoft: boolean }>("/auth/lookup", { email }),
  transcribe: (audio: Blob) => {
    const f = new FormData();
    f.append("audio", audio, fileNameFor(audio, "speech", "audio"));
    return postForm<{ text: string }>("/voice/transcribe", f);
  },
};

/**
 * Upload filename whose extension matches the blob's real container, so the server's
 * ffmpeg step picks the right demuxer. Safari's MediaRecorder produces MP4
 * (audio/mp4 -> .m4a, video/mp4 -> .mp4); Chrome and Firefox produce WebM or Ogg.
 */
export function fileNameFor(blob: Blob, base: string, kind: "audio" | "video") {
  const mime = (blob.type || "").toLowerCase();
  let ext: string;
  if (mime.includes("mp4") || mime.includes("aac") || mime.includes("m4a")) ext = kind === "audio" ? "m4a" : "mp4";
  else if (mime.includes("quicktime")) ext = "mov";
  else if (mime.includes("ogg") || mime.includes("opus") && !mime.includes("webm")) ext = "ogg";
  else if (mime.includes("wav")) ext = "wav";
  else if (mime.includes("mpeg")) ext = kind === "audio" ? "mp3" : "mpg";
  else if (mime.includes("webm")) ext = "webm";
  else ext = isSafari() ? (kind === "audio" ? "m4a" : "mp4") : "webm";
  return `${base}.${ext}`;
}

function isSafari() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg|Android/.test(ua);
}

/** Resolve a media URL returned by the API (may be absolute path or relative media path). */
export function mediaUrl(u: string | null | undefined): string | undefined {
  if (!u) return undefined;
  if (/^(https?:|data:|blob:|\/)/.test(u)) return u;
  return `/api/media/${u}`;
}

/* --------------------------------------------------------------- query keys */
export const qk = {
  status: ["status"] as const,
  me: ["me"] as const,
};

/* -------------------------------------------------------------------- hooks */
export const useStatus = () =>
  useQuery({ queryKey: qk.status, queryFn: api.status, staleTime: 60_000, retry: 1 });
export const useMe = () =>
  useQuery({ queryKey: qk.me, queryFn: api.me, retry: false, staleTime: 60_000 });
