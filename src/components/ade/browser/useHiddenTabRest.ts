import { useEffect, useRef, useState } from "react";

/** How long the tab is hidden before the preview lets go of the agent browser. */
const HIDDEN_MS = 60_000;

/**
 * True once this tab has been hidden for a minute and nothing needs the preview, so a tab left
 * in the background does not count as someone watching the agent browser. `needed` is asked when
 * the time is up, and again each minute while it says yes. False as soon as the tab is shown.
 */
export function useHiddenTabRest(needed: () => boolean, hiddenMs = HIDDEN_MS) {
  const [resting, setResting] = useState(false);
  const neededRef = useRef(needed);
  neededRef.current = needed;
  useEffect(() => {
    let timer: number | undefined;
    const wait = () => {
      timer = window.setTimeout(() => {
        if (neededRef.current()) wait();
        else setResting(true);
      }, hiddenMs);
    };
    const onChange = () => {
      window.clearTimeout(timer);
      if (document.hidden) wait();
      else setResting(false);
    };
    document.addEventListener("visibilitychange", onChange);
    if (document.hidden) wait();
    return () => {
      document.removeEventListener("visibilitychange", onChange);
      window.clearTimeout(timer);
    };
  }, [hiddenMs]);
  return resting;
}
