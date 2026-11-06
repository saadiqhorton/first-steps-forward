import { createContext, useContext } from "react";

export type BrowserPlace = "dock" | "float" | "hidden";

export interface BrowserMiniPlayerState {
  readonly width: number | null;
  readonly position: { readonly x: number; readonly y: number } | null;
}

export interface BrowserPlacementValue {
  readonly projectId: string | null;
  readonly place: BrowserPlace;
  readonly setPlace: (place: BrowserPlace) => void;
}

export interface BrowserMiniPlayerValue {
  readonly mini: BrowserMiniPlayerState;
  readonly setMini: (next: BrowserMiniPlayerState) => void;
}

export const BrowserPlacementContext = createContext<BrowserPlacementValue | null>(null);
export const BrowserMiniPlayerContext = createContext<BrowserMiniPlayerValue | null>(null);

export function useBrowserPlacement(): BrowserPlacementValue {
  const value = useContext(BrowserPlacementContext);
  if (!value) throw new Error("useBrowserPlacement must be used within BrowserPlacementProvider");
  return value;
}

export function useBrowserMiniPlayer(): BrowserMiniPlayerValue {
  const value = useContext(BrowserMiniPlayerContext);
  if (!value) throw new Error("useBrowserMiniPlayer must be used within BrowserPlacementProvider");
  return value;
}
