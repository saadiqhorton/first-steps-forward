// @ts-nocheck -- vendored Arc source; it targets standard strict mode, not this repo's extra index and optional-property flags.
// Changed from Arc: the sweep is a CSS transform animation, so it runs on the compositor. Arc repaints a
// gradient from JavaScript on every frame, which costs more than the rest of a working conversation.
"use client";
import { useSyncExternalStore } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { motionTokens } from "../motion-tokens";
import styles from "./text-shimmer.module.css";
const subscribeHydration = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

/**
 * A calm light sweep across a short status line, such as "Thinking" or "Generating summary", to show that work is ongoing.
 * The band uses the current text color over a muted base. When `active` turns false the band glides off and the text settles to solid.
 * A changed label rises in place. The component sets `aria-busy`; announce completion from your own live region.
 */
export interface TextShimmerProps {
  /** The status text. Keep it to one short line. */
  children: string;
  /** Sweep while work is ongoing. Defaults to true. */
  active?: boolean;
  /** Seconds for one sweep across the text. Defaults to 1.8. */
  duration?: number;
  as?: "span" | "p" | "div" | "h2" | "h3" | "h4";
  className?: string;
  id?: string;
}
export function TextShimmer({ children, active = true, duration = 1.8, as = "span", className, id }: TextShimmerProps) {
  const prefersReduced = useReducedMotion();
  const hydrated = useSyncExternalStore(subscribeHydration, clientSnapshot, serverSnapshot);
  const reduced = Boolean(hydrated && prefersReduced);
  const Tag = as;
  return <Tag id={id} className={[styles.shimmer, className].filter(Boolean).join(" ")} data-state={active ? "active" : "idle"} aria-busy={active || undefined} style={{ "--ts-duration": `${duration * 1.32}s` }}>
    <span className={styles.stage}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={children} className={styles.label}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: "0.3em", filter: `blur(${motionTokens.blur.soft}px)` }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, y: "0em", filter: "blur(0px)" }}
          exit={reduced ? { opacity: 0, transition: { duration: motionTokens.duration.instant } } : { opacity: 0, y: "-0.24em", filter: `blur(${motionTokens.blur.subtle}px)`, transition: { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.standard] } }}
          transition={{ duration: reduced ? motionTokens.duration.instant : motionTokens.duration.standard, ease: [...motionTokens.ease.enter] }}>
          <span className={styles.base}>{children}</span>
          {/* The highlight draws its text from an attribute, so it is never read, selected or copied twice. */}
          {!reduced && <span className={styles.band} aria-hidden="true"><span className={styles.lit} data-text={children} /></span>}
        </motion.span>
      </AnimatePresence>
    </span>
  </Tag>;
}

export default TextShimmer;
