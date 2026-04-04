import React from "react";
import { clearAuthStorage, getStoredToken, getSystemSettings, GlobalSystemSettings, pingServer } from "../lib/api";
import { AppLanguage, getStoredLanguage, LANGUAGE_STORAGE_KEY, saveLanguage } from "../lib/i18n";

type Theme = "dark" | "light";
export type NetworkProfile = "good" | "degraded" | "poor";
type WeakNetworkProfile = Exclude<NetworkProfile, "good">;

type UserInfo = {
  id: string;
  token: string;
} | null;

type NetworkHint = {
  profile: WeakNetworkProfile;
  expiresAt: number;
} | null;

const NETWORK_PROFILE_RANK: Record<NetworkProfile, number> = {
  good: 0,
  degraded: 1,
  poor: 2,
};

function pickWorseProfile(a: NetworkProfile, b: NetworkProfile): NetworkProfile {
  return NETWORK_PROFILE_RANK[a] >= NETWORK_PROFILE_RANK[b] ? a : b;
}

type AppContextType = {
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

const AppContext = React.createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>(() => {
    return (localStorage.getItem("theme") as Theme) || "dark";
  });
  const [language, setLanguageState] = React.useState<AppLanguage>(() => getStoredLanguage());

  const [user, setUser] = React.useState<UserInfo>(() => {
    const token = getStoredToken();
    const userId = localStorage.getItem("user_id") || sessionStorage.getItem("user_id");
    if (token && userId) {
      return { id: userId, token };
    }
    return null;
  });

  const [networkLatency, setNetworkLatency] = React.useState<number | null>(null);
  const [networkLatencySamples, setNetworkLatencySamples] = React.useState<number[]>([]);
  const [networkPingErrorStreak, setNetworkPingErrorStreak] = React.useState(0);
  const [networkHint, setNetworkHint] = React.useState<NetworkHint>(null);
  const [systemSettings, setSystemSettings] = React.useState<GlobalSystemSettings | null>(null);
  const [systemSettingsLoading, setSystemSettingsLoading] = React.useState(false);
  const pingInFlightRef = React.useRef(false);

  const networkAverageLatency = React.useMemo(() => {
    if (networkLatencySamples.length === 0) return null;
    return Math.round(networkLatencySamples.reduce((sum, value) => sum + value, 0) / networkLatencySamples.length);
  }, [networkLatencySamples]);

  const networkJitter = React.useMemo(() => {
    if (networkLatencySamples.length < 2) return 0;
    return Math.max(...networkLatencySamples) - Math.min(...networkLatencySamples);
  }, [networkLatencySamples]);

  const baseNetworkProfile = React.useMemo<NetworkProfile>(() => {
    if (networkPingErrorStreak >= 2) {
      return "poor";
    }
    if (networkAverageLatency !== null && (networkAverageLatency >= 900 || networkJitter >= 600)) {
      return "poor";
    }
    if (networkPingErrorStreak >= 1) {
      return "degraded";
    }
    if (networkAverageLatency !== null && (networkAverageLatency >= 350 || networkJitter >= 250)) {
      return "degraded";
    }
    return "good";
  }, [networkAverageLatency, networkJitter, networkPingErrorStreak]);

  const networkProfile = React.useMemo<NetworkProfile>(() => {
    if (!networkHint) {
      return baseNetworkProfile;
    }
    if (Date.now() > networkHint.expiresAt) {
      return baseNetworkProfile;
    }
    return pickWorseProfile(baseNetworkProfile, networkHint.profile);
  }, [baseNetworkProfile, networkHint]);

  const networkPingIntervalMs =
    networkProfile === "poor" ? 25000 : networkProfile === "degraded" ? 15000 : 10000;

  const setTheme = React.useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem("theme", newTheme);
  }, []);

  const setLanguage = React.useCallback((nextLanguage: AppLanguage) => {
    setLanguageState(nextLanguage);
    saveLanguage(nextLanguage);
  }, []);

  const toggleTheme = React.useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  const toggleLanguage = React.useCallback(() => {
    setLanguage(language === "zh-CN" ? "en-US" : "zh-CN");
  }, [language, setLanguage]);

  const logout = React.useCallback(() => {
    clearAuthStorage();
    setUser(null);
    window.location.href = "/";
  }, []);

  const reportNetworkHint = React.useCallback((profile: WeakNetworkProfile, ttlMs: number = 20000) => {
    const expiresAt = Date.now() + Math.max(1000, ttlMs);
    setNetworkHint((prev) => {
      if (!prev) {
        return { profile, expiresAt };
      }
      return {
        profile: pickWorseProfile(prev.profile, profile) as WeakNetworkProfile,
        expiresAt: Math.max(prev.expiresAt, expiresAt),
      };
    });
  }, []);

  const clearNetworkHint = React.useCallback(() => {
    setNetworkHint(null);
  }, []);

  const applySystemSettings = React.useCallback((settings: GlobalSystemSettings) => {
    setSystemSettings(settings);
  }, []);

  const refreshSystemSettings = React.useCallback(async () => {
    if (!getStoredToken()) {
      setSystemSettings(null);
      setSystemSettingsLoading(false);
      return null;
    }

    setSystemSettingsLoading(true);
    try {
      const settings = await getSystemSettings();
      setSystemSettings(settings);
      return settings;
    } catch (error) {
      console.warn("failed to load system settings", error);
      return null;
    } finally {
      setSystemSettingsLoading(false);
    }
  }, []);

  // 监听 localStorage 变化（跨标签页同步）
  React.useEffect(() => {
    if (!localStorage.getItem(LANGUAGE_STORAGE_KEY)) {
      saveLanguage(language);
    }
  }, [language]);

  React.useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === "theme" && e.newValue) {
        setThemeState(e.newValue as Theme);
      }
      if (e.key === LANGUAGE_STORAGE_KEY) {
        setLanguageState(getStoredLanguage());
      }
      if (e.key === "token" && !e.newValue) {
        setUser(null);
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  React.useEffect(() => {
    if (!networkHint) return;
    const remain = networkHint.expiresAt - Date.now();
    if (remain <= 0) {
      setNetworkHint(null);
      return;
    }
    const timer = window.setTimeout(() => setNetworkHint(null), remain);
    return () => clearTimeout(timer);
  }, [networkHint]);

  React.useEffect(() => {
    if (!user) {
      setNetworkLatency(null);
      setNetworkLatencySamples([]);
      setNetworkPingErrorStreak(0);
      setNetworkHint(null);
      setSystemSettings(null);
      setSystemSettingsLoading(false);
      pingInFlightRef.current = false;
      return;
    }

    let cancelled = false;
    let timer: number | null = null;

    const scheduleNext = () => {
      if (cancelled) return;
      timer = window.setTimeout(run, networkPingIntervalMs);
    };

    const run = async () => {
      if (pingInFlightRef.current) {
        scheduleNext();
        return;
      }
      pingInFlightRef.current = true;
      try {
        const ms = await pingServer();
        setNetworkLatency(ms);
        setNetworkPingErrorStreak(0);
        setNetworkLatencySamples((prev) => [...prev.slice(-7), ms]);
      } catch {
        setNetworkLatency(null);
        setNetworkPingErrorStreak((prev) => Math.min(prev + 1, 5));
      } finally {
        pingInFlightRef.current = false;
        scheduleNext();
      }
    };

    run();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [user?.id, networkPingIntervalMs]);

  React.useEffect(() => {
    if (!user) {
      return;
    }
    void refreshSystemSettings();
  }, [user?.id, refreshSystemSettings]);

  const value: AppContextType = {
    theme,
    setTheme,
    toggleTheme,
    language,
    setLanguage,
    toggleLanguage,
    isDark: theme === "dark",
    user,
    setUser,
    logout,
    isAuthenticated: !!user,
    networkProfile,
    networkLatency,
    networkAverageLatency,
    networkJitter,
    networkPingErrorStreak,
    reportNetworkHint,
    clearNetworkHint,
    systemSettings,
    systemSettingsLoading,
    refreshSystemSettings,
    applySystemSettings,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = React.useContext(AppContext);
  if (!context) {
    throw new Error("useApp must be used within AppProvider");
  }
  return context;
}
