import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import App from "./App";
import { ApiError } from "./lib/api";
import "./lib/desktop";
import "./styles/index.css";

// Mark the document when running inside the Mac app so CSS can reserve room for the window controls.
if (window.cloneflowDesktop?.isDesktop) document.documentElement.classList.add("desktop");
// The desktop app (a window around the website) reserves a strip for the window controls.
if (window.cloneflowApp?.isApp) document.documentElement.classList.add("cloud-app");

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
        <Toaster
          position="bottom-right"
          toastOptions={{
            className: "!rounded-xl !border-line !font-sans !shadow-lift",
            style: { fontFamily: '"Geist Variable", system-ui, sans-serif' },
          }}
        />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
