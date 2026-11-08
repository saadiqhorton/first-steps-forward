import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  BrowserMiniPlayerContext,
  BrowserPlacementContext,
  type BrowserMiniPlayerState,
  type BrowserPlace,
} from "./browserPresentationContext";

const EMPTY_MINI: BrowserMiniPlayerState = { width: null, position: null };

export function BrowserPresentationProvider({
  projectId,
  children,
}: {
  projectId: string | null;
  children: ReactNode;
}) {
  const [place, setPlace] = useState<BrowserPlace>("dock");
  const [visible, setVisible] = useState(true);
  const [minis, setMinis] = useState<Record<string, BrowserMiniPlayerState>>({});
  const mini = (projectId !== null && minis[projectId]) || EMPTY_MINI;
  const setMini = useCallback(
    (next: BrowserMiniPlayerState) => {
      if (!projectId) return;
      setMinis((current) => ({ ...current, [projectId]: next }));
    },
    [projectId],
  );
  const placement = useMemo(
    () => ({ projectId, place, setPlace, visible, setVisible }),
    [projectId, place, visible],
  );
  const miniValue = useMemo(() => ({ mini, setMini }), [mini, setMini]);

  return (
    <BrowserPlacementContext.Provider value={placement}>
      <BrowserMiniPlayerContext.Provider value={miniValue}>
        {children}
      </BrowserMiniPlayerContext.Provider>
    </BrowserPlacementContext.Provider>
  );
}
