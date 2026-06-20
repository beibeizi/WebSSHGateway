import React from "react";
import type { GlobalSystemSettings } from "../lib/api";
import type { AppLanguage } from "../lib/i18n";

export type Theme = "dark" | "light";
export type NetworkProfile = "good" | "degraded" | "poor";
export type WeakNetworkProfile = Exclude<NetworkProfile, "good">;

export type UserInfo = {
  id: string;
  token: string;
} | null;

export type AppContextType = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => void;
  toggleLanguage: () => void;
  isDark: boolean;
  user: UserInfo;
  setUser: (user: UserInfo) => void;
  logout: () => void;
  isAuthenticated: boolean;
  networkProfile: NetworkProfile;
  networkLatency: number | null;
  networkAverageLatency: number | null;
  networkJitter: number;
  networkPingErrorStreak: number;
  reportNetworkHint: (profile: WeakNetworkProfile, ttlMs?: number) => void;
  clearNetworkHint: () => void;
  systemSettings: GlobalSystemSettings | null;
  systemSettingsLoading: boolean;
  refreshSystemSettings: () => Promise<GlobalSystemSettings | null>;
  applySystemSettings: (settings: GlobalSystemSettings) => void;
};

export const AppContext = React.createContext<AppContextType | null>(null);

export function useApp() {
  const context = React.useContext(AppContext);
  if (!context) {
    throw new Error("useApp must be used within AppProvider");
  }
  return context;
}
