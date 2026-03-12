import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useApp } from "../context/AppContext";

type ProtectedRouteProps = {
  children: React.ReactNode;
};

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated } = useApp();
  const location = useLocation();

  if (!isAuthenticated) {
    // 保存当前路径，登录后可以跳转回来
    return <Navigate to="/" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

export function PublicRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated } = useApp();
  const location = useLocation();

  if (isAuthenticated) {
    // 已登录用户访问登录页，跳转到会话管理
    const from = (location.state as { from?: Location })?.from?.pathname || "/sessions";
    return <Navigate to={from} replace />;
  }

  return <>{children}</>;
}
