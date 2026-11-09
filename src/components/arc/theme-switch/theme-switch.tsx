// @ts-nocheck -- vendored Arc source; it targets standard strict mode, not this repo's extra index and optional-property flags.
"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import type { Theme } from "@/lib/theme";
import { Button } from "../button/button";
import styles from "./theme-switch.module.css";

export type ThemeSwitchVariant = "reveal" | "eclipse" | "split" | "rise";
export type { Theme };

export interface ThemeSwitchProps {
  theme: Theme;
  variant?: ThemeSwitchVariant;
  onThemeChange: (next: Theme, variant: ThemeSwitchVariant, trigger: HTMLElement) => void;
  label?: string;
  iconOnly?: boolean;
}

/** A stored preference usually reaches the theme prop just after hydration. That correction swaps the icon in place;
 *  only changes after the first painted frames animate, so a page that loads in dark mode never spins its switches. */
function useSettled() {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => setSettled(true)); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, []);
  return settled;
}

/** Both icons stay mounted and stacked, and the active one fades in. The swap runs on
 *  the same short clock as the page's own settle, so one click reads as one event;
 *  a spring or a blur here would outlive the change it describes. */
function ThemeIcon({ theme }: { theme: Theme }) {
  return (
    <>
      <Sun className={styles.icon} data-on={theme === "light"} aria-hidden="true" size={15} strokeWidth={1.9} />
      <Moon className={styles.icon} data-on={theme === "dark"} aria-hidden="true" size={15} strokeWidth={1.9} />
    </>
  );
}

export function ThemeSwitch({ theme, onThemeChange, label, iconOnly = false, variant = "reveal" }: ThemeSwitchProps) {
  const settled = useSettled();
  const next = theme === "light" ? "dark" : "light";
  const classes = [styles.themeSwitch, iconOnly ? styles.iconOnly : "", settled ? styles.settled : ""].join(" ");

  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      className={classes}
      data-theme={theme}
      aria-label={label ?? `Switch to ${next} mode`}
      aria-pressed={theme === "dark"}
      onClick={event => onThemeChange(next, variant, event.currentTarget)}
    >
      <span className={styles.iconWrap}><ThemeIcon theme={theme} /></span>
      {!iconOnly && <span className={styles.label}>Switch theme</span>}
    </Button>
  );
}

export default ThemeSwitch;
