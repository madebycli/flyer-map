export type UiThemePreference = "dark" | "light" | "system";
export type ResolvedUiTheme = "dark" | "light";

const STORAGE_KEY = "flyer-map.ui-theme";
const CHANGE_EVENT = "flyer-map-ui-theme-change";
let mediaQuery: MediaQueryList | null = null;
let mediaListenerInstalled = false;

export function loadUiThemePreference(): UiThemePreference {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (value === "dark" || value === "light" || value === "system") return value;
  } catch {
    // Storage can be blocked. Dark remains the product default.
  }
  return "dark";
}

export function resolveUiTheme(preference: UiThemePreference): ResolvedUiTheme {
  if (preference === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return preference;
}

export function applyUiTheme(preference: UiThemePreference = loadUiThemePreference()) {
  const resolved = resolveUiTheme(preference);
  const root = document.documentElement;
  root.dataset.uiThemePreference = preference;
  root.dataset.uiTheme = resolved;
  root.style.colorScheme = resolved;
  return resolved;
}

export function saveUiThemePreference(preference: UiThemePreference) {
  try {
    window.localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Keep the in-memory/document choice even when storage is unavailable.
  }
  applyUiTheme(preference);
  window.dispatchEvent(new CustomEvent<UiThemePreference>(CHANGE_EVENT, { detail: preference }));
}

export function subscribeUiThemePreference(listener: (preference: UiThemePreference) => void) {
  const onChange = (event: Event) => {
    const preference = (event as CustomEvent<UiThemePreference>).detail;
    if (preference) listener(preference);
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

export function installUiTheme() {
  applyUiTheme();
  if (mediaListenerInstalled) return;
  mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const onSystemThemeChange = () => {
    if (loadUiThemePreference() === "system") applyUiTheme("system");
  };
  mediaQuery.addEventListener("change", onSystemThemeChange);
  mediaListenerInstalled = true;
}
