import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";

/**
 * The browser's real pathname.
 *
 * The production SPA shell is prerendered at `/`, so during hydration the
 * router state can still report `/` even while the router has already matched
 * the requested route. Reading `window.location` after the first render (and
 * again whenever the matched routes change) gives the shell the right path
 * without introducing a server/client hydration mismatch.
 */
export function useAppPathname(): string {
  const routed = useRouterState({
    select: (state) => state.resolvedLocation?.pathname ?? state.location.pathname,
  });
  const routeKey = useRouterState({
    select: (state) => state.matches.map((match) => match.pathname).join("|"),
  });
  const [path, setPath] = useState(routed);
  useEffect(() => {
    const sync = () => setPath(window.location.pathname);
    sync();
    // The router may restore the requested URL just after hydration; re-read
    // once the first frame has settled so the shell does not stay on `/`.
    const timer = window.setTimeout(sync, 60);
    window.addEventListener("popstate", sync);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("popstate", sync);
    };
  }, [routeKey]);
  return path;
}
