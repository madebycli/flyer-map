export type AppearancePreference = "system" | "light" | "dark";
export type ResolvedAppearance = "light" | "dark";

const STORAGE_KEY = "verteil-flyer:appearance";
const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

export function isAppearancePreference(value: unknown): value is AppearancePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function loadAppearancePreference(): AppearancePreference {
  if (typeof window === "undefined") return "system";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isAppearancePreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

export function saveAppearancePreference(preference: AppearancePreference) {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, preference);
    return true;
  } catch {
    return false;
  }
}

export function resolveAppearance(
  preference: AppearancePreference,
  systemPrefersDark: boolean,
): ResolvedAppearance {
  if (preference === "dark") return "dark";
  if (preference === "light") return "light";
  return systemPrefersDark ? "dark" : "light";
}

export function applyAppearanceToDocument(appearance: ResolvedAppearance) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.appearance = appearance;
  document.documentElement.style.colorScheme = appearance;
}

export function systemPrefersDark() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(SYSTEM_DARK_QUERY).matches;
}

export function applyAppearancePreference(preference: AppearancePreference) {
  const appearance = resolveAppearance(preference, systemPrefersDark());
  applyAppearanceToDocument(appearance);
  return appearance;
}

export function initializeAppearance() {
  const applyStoredPreference = () => applyAppearancePreference(loadAppearancePreference());
  applyStoredPreference();

  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => undefined;
  }

  const media = window.matchMedia(SYSTEM_DARK_QUERY);
  const handleSystemAppearanceChange = () => {
    if (loadAppearancePreference() === "system") applyStoredPreference();
  };
  media.addEventListener("change", handleSystemAppearanceChange);
  return () => media.removeEventListener("change", handleSystemAppearanceChange);
}
