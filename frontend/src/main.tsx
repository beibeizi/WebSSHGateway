import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ToastProvider } from "./components/Toast";
import { AppProvider } from "./context/AppContext";
import { clearAuthStorage, getStoredToken } from "./lib/api";
import { isTokenExpired } from "./lib/auth";
import { ForcePasswordChange } from "./pages/ForcePasswordChange";
import { Login } from "./pages/Login";
import { Sessions } from "./pages/Sessions";
import { TerminalPage } from "./pages/Terminal";
import "./index.css";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const token = getStoredToken();
  if (!token || isTokenExpired(token)) {
    clearAuthStorage();
    return <Navigate to="/" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}

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
                    <ForcePasswordChange />
                  </RequireAuth>
                }
              />
              <Route
                path="/sessions"
                element={
                  <RequireAuth>
                    <Sessions />
                  </RequireAuth>
                }
              />
              <Route
                path="/terminal/:sessionId"
                element={
                  <RequireAuth>
                    <TerminalPage />
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
