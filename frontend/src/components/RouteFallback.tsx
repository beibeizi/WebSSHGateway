import { useApp } from "../context/AppContextCore";

export function RouteFallback() {
  const { isDark } = useApp();

  return (
    <div className={`flex min-h-screen items-center justify-center text-sm ${isDark ? "bg-slate-950 text-slate-300" : "bg-gray-100 text-slate-600"}`}>
      加载中... / Loading...
    </div>
  );
}
