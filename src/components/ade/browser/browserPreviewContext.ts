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

export interface BrowserPreviewStateValue {
  readonly projectId: string | null;
  /** Latest availability answer for the active project, or null until the first one. */
  readonly status: BrowserStatus | null;
  readonly statusError: string | null;
  readonly streamStatus: BrowserStreamStatus | "idle";
  readonly streamError: string | null;
  readonly nav: BrowserStreamNav | null;
  /** Who drives the page. Null until the first control answer. */
  readonly control: BrowserStreamControl | null;
  /** Sends a client message over the stream. False when it was not sent. */
  readonly send: (message: ClientMessage) => boolean;
  /** Take or hand back control of the shared agent browser. Errors are kept in actionError. */
  readonly changeControl: (action: "take" | "release") => Promise<boolean>;
  /**
   * Uploads `files` and answers the page's open file picker with them, taking control first if
   * needed. No files closes the picker. Errors are kept in actionError.
   */
  readonly answerFileChooser: (chooserId: string, files: readonly File[]) => Promise<boolean>;
  readonly actionError: string | null;
  readonly reconnect: () => void;
}

export interface BrowserPreviewFrameValue {
  readonly viewport: BrowserStreamViewport | null;
  readonly pointer: BrowserStreamPointer | null;
  readonly hasFrame: boolean;
  /** The one registered canvas that frames are painted into. */
  readonly canvas: HTMLCanvasElement | null;
  readonly attachCanvas: (canvas: HTMLCanvasElement) => void;
  readonly releaseCanvas: (canvas: HTMLCanvasElement) => void;
}

export const BrowserPreviewStateContext = createContext<BrowserPreviewStateValue | null>(null);
export const BrowserPreviewFrameContext = createContext<BrowserPreviewFrameValue | null>(null);

export function useBrowserPreviewState(): BrowserPreviewStateValue {
  const value = useContext(BrowserPreviewStateContext);
  if (!value) throw new Error("useBrowserPreviewState must be used within BrowserPreviewProvider");
  return value;
}

export function useBrowserPreviewFrame(): BrowserPreviewFrameValue {
  const value = useContext(BrowserPreviewFrameContext);
  if (!value) throw new Error("useBrowserPreviewFrame must be used within BrowserPreviewProvider");
  return value;
}
