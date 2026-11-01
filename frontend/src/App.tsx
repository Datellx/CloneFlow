import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { configureTts } from "./lib/voice";
import { useMe, useStatus } from "./lib/api";
import { isCloudApp } from "./lib/desktop";
import { homeFor } from "./lib/home";
import Landing from "./site/Landing";
import { Join, Login, Signup } from "./site/Auth";
import DownloadPage, { PrivacyPage, TermsPage } from "./site/Download";
import NotFound from "./site/NotFound";
import Walk from "./shared/routes/Walk";
import SessionPage from "./app/Session";
import Setup from "./app/Setup";
import AdminShell from "./app/admin/AdminShell";
import Overview from "./app/admin/Overview";
import KnowledgeBase from "./app/admin/KnowledgeBase";
import Pack from "./app/admin/Pack";
import Teams from "./app/admin/Teams";
import Settings from "./app/admin/Settings";
import { AdminAsk, AskPage } from "./app/admin/AskPages";

const KnowledgeMap = lazy(() => import("./shared/routes/Map"));

function Splash() {
  return (
    <div className="titlebar-drag flex min-h-screen items-center justify-center bg-paper text-ink-muted">
      <Loader2 className="h-5 w-5 animate-spin" aria-label="Loading" />
    </div>
  );
}

/** "/": the marketing page in a browser; straight into the product in the desktop app. */
function Home() {
  if (!isCloudApp()) return <Landing />;
  return <AppHome />;
}
function AppHome() {
  const me = useMe();
  if (me.isLoading) return <Splash />;
  return <Navigate to={me.data ? homeFor(me.data) : "/login"} replace />;
}

function Lazy({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="flex h-64 items-center justify-center text-ink-muted"><Loader2 className="h-5 w-5 animate-spin" /></div>}>
      {children}
    </Suspense>
  );
}

export default function App() {
  const status = useStatus();
  useEffect(() => {
    // Skip the server read-aloud request when the server says it only has the browser voice.
    if (status.data?.tts_provider) configureTts(status.data.tts_provider);
  }, [status.data?.tts_provider]);
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/join/:code" element={<Join />} />
      <Route path="/download" element={<DownloadPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/walk/:token" element={<Walk />} />
      <Route path="/setup" element={<Setup />} />
      <Route path="/session" element={<SessionPage />} />
      <Route path="/ask" element={<AskPage />} />
      <Route path="/admin" element={<AdminShell />}>
        <Route index element={<Overview />} />
        <Route path="knowledge" element={<KnowledgeBase />} />
        <Route path="people/:eid" element={<Pack />} />
        <Route path="map" element={<Lazy><KnowledgeMap personHref={(eid: number) => `/admin/people/${eid}`} /></Lazy>} />
        <Route path="ask" element={<AdminAsk />} />
        <Route path="teams" element={<Teams />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
