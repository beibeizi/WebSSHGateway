export type AppLanguage = "zh-CN" | "en-US";

export const DEFAULT_LANGUAGE: AppLanguage = "zh-CN";
export const LANGUAGE_STORAGE_KEY = "app_language";

export function normalizeLanguage(value: string | null | undefined): AppLanguage {
  if (!value) {
    return DEFAULT_LANGUAGE;
  }
  const normalized = value.toLowerCase();
  if (normalized.startsWith("en")) {
    return "en-US";
  }
  return "zh-CN";
}

export function getStoredLanguage(): AppLanguage {
  try {
    return normalizeLanguage(localStorage.getItem(LANGUAGE_STORAGE_KEY));
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

export function saveLanguage(language: AppLanguage): void {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
}

