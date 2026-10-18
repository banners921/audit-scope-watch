import { useEffect, useLayoutEffect, useState } from "react";

const STORAGE_KEY = "as_theme";
export type Theme = "light" | "dark";

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const saved = window.localStorage.getItem(STORAGE_KEY) as Theme | null;
  if (saved === "light" || saved === "dark") return saved;
  // Default to dark (existing aesthetic)
  return "dark";
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.classList.toggle("dark", theme === "dark");
}

// Set on first import so initial paint matches saved preference
applyTheme(getInitialTheme());

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    applyTheme(theme);
    try { window.localStorage.setItem(STORAGE_KEY, theme); } catch {}
  }, [theme]);

  const toggle = () => setThemeState((t) => (t === "dark" ? "light" : "dark"));
  return { theme, setTheme: setThemeState, toggle };
}

// The public marketing pages are always dark, whatever theme the visitor saved
// in the app. Applied before paint (no light flash); the saved theme comes
// back when they navigate into the app.
export function useForceDarkTheme() {
  useLayoutEffect(() => {
    applyTheme("dark");
    return () => applyTheme(getInitialTheme());
  }, []);
}
