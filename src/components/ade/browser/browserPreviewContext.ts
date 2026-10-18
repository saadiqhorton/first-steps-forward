import { createContext, useContext } from "react";
import type { BrowserStatus } from "@/lib/ade/browser/api";
import type {
  BrowserStreamControl,
  BrowserStreamNav,
  BrowserStreamPointer,
  BrowserStreamStatus,
  BrowserStreamViewport,
  ClientMessage,
} from "@/lib/ade/browser/browserStream";

/** Where the browser preview is shown: docked in the right pane, floating, or hidden. */
export type BrowserPlace = "dock" | "float" | "hidden";

/** Which view the Computer tab shows. */
export type BrowserView = "browser" | "desktop";

/** Free position of the floating player, relative to the main content area. */
export interface BrowserMiniPlayerState {
  readonly width: number | null;
  readonly position: { readonly x: number; readonly y: number } | null;
}

export interface BrowserPreviewValue {
  readonly projectId: string | null;
  /** Latest availability answer for the active project, or null until the first one. */
  readonly status: BrowserStatus | null;
  readonly statusError: string | null;
  readonly streamStatus: BrowserStreamStatus | "idle";
  readonly streamError: string | null;
  readonly nav: BrowserStreamNav | null;
  readonly viewport: BrowserStreamViewport | null;
  readonly pointer: BrowserStreamPointer | null;
  /** Who drives the page. Null until the first control answer. */
  readonly control: BrowserStreamControl | null;
  readonly hasFrame: boolean;
  /** The one registered canvas that frames are painted into. */
  readonly canvas: HTMLCanvasElement | null;
  readonly place: BrowserPlace;
  readonly setPlace: (place: BrowserPlace) => void;
  readonly view: BrowserView;
  readonly setView: (view: BrowserView) => void;
  readonly mini: BrowserMiniPlayerState;
  readonly setMini: (next: BrowserMiniPlayerState) => void;
  readonly attachCanvas: (canvas: HTMLCanvasElement) => void;
  readonly releaseCanvas: (canvas: HTMLCanvasElement) => void;
  /** Size of the docked surface in CSS px. Sent to the server now and on every open. */
  readonly requestViewportSize: (size: BrowserStreamViewport) => void;
  /** Sends a client message over the stream. False when it was not sent. */
  readonly send: (message: ClientMessage) => boolean;
  /** Take or hand back control of the shared agent computer. Errors are kept in actionError. */
  readonly changeControl: (action: "take" | "release") => Promise<boolean>;
  readonly actionError: string | null;
  readonly reconnect: () => void;
}

export const BrowserPreviewContext = createContext<BrowserPreviewValue | null>(null);

export function useBrowserPreview(): BrowserPreviewValue {
  const value = useContext(BrowserPreviewContext);
  if (!value) throw new Error("useBrowserPreview must be used within BrowserPreviewProvider");
  return value;
}
