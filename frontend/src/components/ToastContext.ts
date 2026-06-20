import React from "react";

export type Toast = {
  id: string;
  message: string;
};

export type ToastContextValue = {
  toasts: Toast[];
  push: (message: string) => void;
  dismiss: (id: string) => void;
};

export const ToastContext = React.createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) {
    throw new Error("ToastProvider missing");
  }
  return ctx;
}
