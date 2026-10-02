import { useCallback, useEffect, useState } from "react";
import type { Theme } from "@/components/arc/theme-switch/theme-switch";

export const THEME_KEY = "ade-theme";

/** Runs in <head> before first paint so a stored or system dark theme never flashes light. */
export const themeInitScript = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t}catch(e){}})()`;

function storedTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

/** The first render is always "light" so server and client markup match; the real theme arrives after mount. */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    setThemeState(
      document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light",
    );
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const followSystem = () => {
      if (storedTheme()) return;
      const next = systemTheme();
      applyTheme(next);
      setThemeState(next);
    };
    media.addEventListener("change", followSystem);
    return () => media.removeEventListener("change", followSystem);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // Private windows can refuse storage; the choice still applies for this visit.
    }
    setThemeState(next);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || !document.startViewTransition) {
      applyTheme(next);
      return;
    }
    const root = document.documentElement;
    root.setAttribute("data-theme-transition", "rise");
    const transition = document.startViewTransition(() => applyTheme(next));
    void transition.finished.finally(() => {
      root.removeAttribute("data-theme-transition");
    });
  }, []);

  return { theme, setTheme };
}
