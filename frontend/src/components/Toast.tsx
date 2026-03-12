import React, { useMemo } from "react";

export type Toast = {
  id: string;
  message: string;
};

export type ToastContextValue = {
  toasts: Toast[];
  push: (message: string) => void;
  dismiss: (id: string) => void;
};

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  const createId = React.useCallback(() => {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }, []);

  const push = React.useCallback(
    (message: string) => {
      const toast = { id: createId(), message };
      setToasts((prev) => [...prev, toast]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((item) => item.id !== toast.id));
      }, 4000);
    },
    [createId]
  );

  const dismiss = React.useCallback(
    (id: string) => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    },
    []
  );

  const value = useMemo<ToastContextValue>(() => ({ toasts, push, dismiss }), [toasts, push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed right-6 top-6 z-50 space-y-2">
        {toasts.map((toast) => (
          <div key={toast.id} className="rounded-md bg-slate-800 px-4 py-3 text-sm text-slate-100 shadow">
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) {
    throw new Error("ToastProvider missing");
  }
  return ctx;
}
