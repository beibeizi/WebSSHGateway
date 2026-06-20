import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { clearAuthStorage, getStoredToken } from "../lib/api";
import { isTokenExpired } from "../lib/auth";

type RequireAuthProps = {
  children: ReactNode;
};

export function RequireAuth({ children }: RequireAuthProps) {
  const location = useLocation();
  const token = getStoredToken();

  if (!token || isTokenExpired(token)) {
    clearAuthStorage();
    return <Navigate to="/" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
