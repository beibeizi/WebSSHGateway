import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { RequireAuth } from "./components/RequireAuth";
import { RouteFallback } from "./components/RouteFallback";
import { ToastProvider } from "./components/Toast";
import { AppProvider } from "./context/AppContext";
import { Login } from "./pages/Login";
import "./index.css";

const ForcePasswordChange = React.lazy(() =>
  import("./pages/ForcePasswordChange").then((module) => ({ default: module.ForcePasswordChange }))
);
const Sessions = React.lazy(() =>
  import("./pages/Sessions").then((module) => ({ default: module.Sessions }))
);
const SystemLogsPage = React.lazy(() =>
  import("./pages/SystemLogs").then((module) => ({ default: module.SystemLogsPage }))
);
const SystemSettingsPage = React.lazy(() =>
  import("./pages/SystemSettings").then((module) => ({ default: module.SystemSettingsPage }))
);
const TerminalPage = React.lazy(() =>
  import("./pages/Terminal").then((module) => ({ default: module.TerminalPage }))
);

const root = document.getElementById("root");

if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <AppProvider>
        <ToastProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Login />} />
              <Route
                path="/force-password"
                element={
                  <RequireAuth>
                    <React.Suspense fallback={<RouteFallback />}>
                      <ForcePasswordChange />
                    </React.Suspense>
                  </RequireAuth>
                }
              />
              <Route
                path="/sessions"
                element={
                  <RequireAuth>
                    <React.Suspense fallback={<RouteFallback />}>
                      <Sessions />
                    </React.Suspense>
                  </RequireAuth>
                }
              />
              <Route
                path="/settings"
                element={
                  <RequireAuth>
                    <React.Suspense fallback={<RouteFallback />}>
                      <SystemSettingsPage />
                    </React.Suspense>
                  </RequireAuth>
                }
              />
              <Route
                path="/logs"
                element={
                  <RequireAuth>
                    <React.Suspense fallback={<RouteFallback />}>
                      <SystemLogsPage />
                    </React.Suspense>
                  </RequireAuth>
                }
              />
              <Route
                path="/terminal/:sessionId"
                element={
                  <RequireAuth>
                    <React.Suspense fallback={<RouteFallback />}>
                      <TerminalPage />
                    </React.Suspense>
                  </RequireAuth>
                }
              />
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </AppProvider>
    </React.StrictMode>
  );
}
