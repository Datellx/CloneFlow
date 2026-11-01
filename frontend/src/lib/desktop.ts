
/** Bridge exposed by the Electron preload. Undefined in a normal browser. */
type PermissionState = "granted" | "denied" | "not-determined" | "restricted" | string;
interface DesktopInfo {
  version: string;
  dataDir: string;
  logDir: string;
  hasMetaKey: boolean;
  hasHfToken: boolean;
  mode: "standard" | "contributor";
  keyHint: string | null;
  ttsProvider: string;
  aiEnabled?: boolean;
}
interface CloneflowDesktop {
  isDesktop: true;
  info(): Promise<DesktopInfo>;
  updateSettings(p: {
    metaKey?: string;
    hfToken?: string;
    mode?: "standard" | "contributor";
    ttsProvider?: string;
    ttsKey?: string;
    aiEnabled?: boolean;
  }): Promise<{ ok: boolean; error?: string }>;
  openDataFolder(): Promise<void>;
  openLogs(): Promise<void>;
  chooseFolder(): Promise<string | null>;
  permissions(): Promise<{ microphone: PermissionState; screen: PermissionState }>;
  askMicrophone(): Promise<boolean>;
  openPrivacySettings(pane: "screen" | "microphone"): Promise<void>;
}

declare global {
  interface Window {
    cloneflowDesktop?: CloneflowDesktop;
  }
}

export function getDesktop(): CloneflowDesktop | null {
  if (typeof window === "undefined") return null;
  const d = window.cloneflowDesktop;
  return d && d.isDesktop ? d : null;
}

export const isDesktopShell = () => !!getDesktop();

/**
 * In the desktop app, make sure macOS lets us use the microphone.
 * Returns "ok" when recording may proceed, or "denied" when the user must change System Settings.
 * In a browser this always returns "ok" and the browser's own prompt handles it.
 */
export async function ensureMicrophone(): Promise<"ok" | "denied"> {
  const d = getDesktop();
  if (!d) return "ok";
  try {
    const p = await d.permissions();
    if (p.microphone === "granted") return "ok";
    if (p.microphone === "denied" || p.microphone === "restricted") return "denied";
    return (await d.askMicrophone()) ? "ok" : "denied";
  } catch {
    return "ok";
  }
}

/**
 * The Clone Flow desktop app (desktop/) — a window around the website.
 * It sets window.cloneflowApp.isApp; window.cloneflowDesktop is the older local-engine app.
 */
declare global {
  interface Window {
    cloneflowApp?: { isApp?: boolean };
  }
}
export function isCloudApp() {
  return typeof window !== "undefined" && window.cloneflowApp?.isApp === true;
}
