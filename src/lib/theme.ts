import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

export const THEME_KEY = "ade-theme";

/** Runs in <head> before first paint so a stored or system dark theme never flashes light. */
export const themeInitScript = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t}catch(e){}})()`;

/** Runs in <head> too: pages that take the whole window hide the right pane from the first paint. */
export const shellInitScript = `(function(){var p=location.pathname;if(p==="/"||(/^\\/workspace(\\/|$)/.test(p)&&!/^\\/workspace\\/assistant(\\/|$)/.test(p))||/^\\/p\\/[^/]+\\/(workflows|skills|processes)(\\/|$)/.test(p))document.documentElement.dataset.shellBoot="full"})()`;

/** The veil never starts fully transparent: frame one already carries most of the change. */
const VEIL_START = 0.35;
/** Toggling faster than this shortens (or skips) the veil, so a deliberate double-click stays instant. */
const VEIL_DECAY_MS = 180;

let veil: HTMLDivElement | null = null;
let lastToggleAt = 0;

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

function prefersReducedMotion(): boolean {
  return (
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    window.matchMedia("(prefers-contrast: more)").matches
  );
}

/**
 * One fixed, pointer-inert wash of the outgoing background, kept in the top layer
 * so it covers dialogs and scrims too. This is a flat colour, never a document
 * snapshot: the theme itself is already applied underneath it.
 */
function themeVeil(): HTMLDivElement | null {
  if (veil?.isConnected) return veil;
  const element = document.createElement("div");
  element.className = "theme-veil";
  element.setAttribute("aria-hidden", "true");
  document.body.append(element);

  // A manual popover sits above z-indexed dialogs. Where the API is missing (or
  // refuses to show) the CSS keeps it as an ordinary fixed layer.
  if (typeof element.showPopover === "function") {
    element.setAttribute("popover", "manual");
    try {
      element.showPopover();
    } catch {
      element.removeAttribute("popover");
    }
  }

  veil = element;
  return element;
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

    // Another window changed the theme: follow it, but never animate. A background
    // tab has no frames to animate on, so a transition there would only stall.
    const followStorage = (event: StorageEvent) => {
      if (event.key !== THEME_KEY) return;
      if (event.storageArea && event.storageArea !== window.localStorage) return;
      const next: Theme = event.newValue === "dark" ? "dark" : "light";
      applyTheme(next);
      setThemeState(next);
    };
    window.addEventListener("storage", followStorage);

    return () => {
      media.removeEventListener("change", followSystem);
      window.removeEventListener("storage", followStorage);
    };
  }, []);

  const setTheme = useCallback((next: Theme) => {
    const root = document.documentElement;
    if (root.getAttribute("data-theme") === next) {
      setThemeState(next);
      return;
    }

    // Read the outgoing palette before the attribute changes; this is the colour
    // the veil is made of.
    const outgoing = getComputedStyle(root).getPropertyValue("--background").trim();
    const reduced = prefersReducedMotion();

    // Commit the theme first. Everything below this point is decoration and
    // cannot delay the flip or leave the document stuck in a transitional state.
    root.setAttribute("data-theme-switching", "");
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // Private windows can refuse storage; the choice still applies for this visit.
    }
    applyTheme(next);
    setThemeState(next);

    // Two frames: one for the flip, one for the paint that settles every element.
    // The stylesheet zeroes transition durations only while this attribute is set,
    // so the 150ms colour wash neither runs under the veil nor leaves the theme
    // looking half-applied.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        root.removeAttribute("data-theme-switching");
      });
    });

    if (reduced) {
      if (veil) {
        veil.getAnimations().forEach((animation) => animation.cancel());
        veil.style.opacity = "0";
      }
      return;
    }

    const now = performance.now();
    const sinceLast = lastToggleAt ? now - lastToggleAt : Number.POSITIVE_INFINITY;
    lastToggleAt = now;

    // Light is the direction that hurts, so brightening gets longer than darkening.
    const base = next === "light" ? 160 : 120;
    const duration = sinceLast >= VEIL_DECAY_MS ? base : Math.max(0, base - sinceLast);
    if (!duration || !outgoing) return;

    const element = themeVeil();
    if (!element) return;

    // Retarget from wherever the previous veil is, so fast toggles never jump.
    const current = Number.parseFloat(getComputedStyle(element).opacity) || 0;
    const from = Math.min(1, Math.max(current, VEIL_START));
    element.style.background = outgoing;
    element.getAnimations().forEach((animation) => animation.cancel());
    void element
      .animate([{ opacity: from }, { opacity: 0 }], {
        duration,
        easing: "cubic-bezier(.22,1,.36,1)",
        fill: "none",
      })
      .finished.catch(() => {
        // Cancelled by a newer toggle; the newer animation owns the element.
      });
  }, []);

  return { theme, setTheme };
}
