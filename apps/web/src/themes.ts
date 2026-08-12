/**
 * UI theme registry — three complete visual languages over the same
 * functional stack. Themes are pure CSS (class on <html>), so every
 * feature works identically in all three.
 */

export type ThemeId = "default" | "neon" | "glass" | "holo";

export interface ThemeInfo {
  id: ThemeId;
  name: string;
  tagline: string;
  /** CSS class applied to <html>. */
  className: string;
}

export const THEMES: ThemeInfo[] = [
  { id: "default", name: "Core", tagline: "baseline dark", className: "theme-default" },
  { id: "neon", name: "NEON", tagline: "synthwave pulse", className: "theme-neon" },
  { id: "glass", name: "GLASS", tagline: "aurora frost", className: "theme-glass" },
  { id: "holo", name: "HOLO", tagline: "terminal x", className: "theme-holo" },
];

const STORAGE_KEY = "pi-control.theme";

export function getStoredTheme(): ThemeId {
  const value = localStorage.getItem(STORAGE_KEY);
  return THEMES.some((t) => t.id === value) ? (value as ThemeId) : "default";
}

export function applyTheme(themeId: ThemeId): void {
  const root = document.documentElement;
  for (const theme of THEMES) {
    root.classList.toggle(theme.className, theme.id === themeId);
  }
  root.setAttribute("data-theme", themeId);
  localStorage.setItem(STORAGE_KEY, themeId);
}

export function currentTheme(): ThemeId {
  return (document.documentElement.getAttribute("data-theme") as ThemeId | null) ?? "default";
}

/** Initialize once at startup. */
export function initTheme(): void {
  applyTheme(getStoredTheme());
}
