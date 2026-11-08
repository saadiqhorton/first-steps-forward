import { createContext, useContext } from "react";
import type {
  BrowserStatus,
  InspectedBrowserElement,
  BrowserAnnotationStyleChange,
} from "@/lib/ade/browser/api";
import type {
  BrowserStreamControl,
  BrowserStreamNav,
  BrowserStreamPointer,
  BrowserStreamStatus,
  BrowserStreamViewport,
  BrowserTabs,
  BrowserDownload,
  ClientMessage,
} from "@/lib/ade/browser/browserStream";
import type { BrowserCaptureDraft } from "./useBrowserCapture";

export type BrowserAnnotationMode = "off" | "element" | "region" | "draw" | "erase";
export interface BrowserAnnotationOrigin {
  readonly projectId: string;
  readonly sessionId: string;
  readonly tabId: string | null;
  readonly pageUrl: string;
}
export interface BrowserAnnotationDraft {
  readonly id: string;
  readonly origin: BrowserAnnotationOrigin;
  readonly file: File;
  readonly detail: File | null;
  readonly elements: readonly InspectedBrowserElement[];
  readonly targets: string;
  readonly styleChanges: readonly BrowserAnnotationStyleChange[];
  readonly comment?: string;
}

export interface BrowserPreviewStateValue {
  readonly projectId: string | null;
  readonly sessionId: string | null;
  /** Latest availability answer for the active project, or null until the first one. */
  readonly status: BrowserStatus | null;
  readonly statusError: string | null;
  readonly streamStatus: BrowserStreamStatus | "idle";
  readonly streamError: string | null;
  readonly nav: BrowserStreamNav | null;
  readonly tabs: BrowserTabs | null;
  readonly downloads: readonly BrowserDownload[];
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
  readonly deviceToolbar: boolean;
  readonly setDeviceToolbar: (visible: boolean) => void;
  /** The page viewport follows the pane instead of a fixed device size. */
  readonly fillViewport: boolean;
  readonly setFillViewport: (fill: boolean) => void;
  readonly deviceAspectRatio: number | null;
  readonly setDeviceAspectRatio: (ratio: number | null) => void;
  readonly annotationMode: BrowserAnnotationMode;
  readonly setAnnotationMode: (mode: BrowserAnnotationMode) => void;
  readonly annotationOrigin: BrowserAnnotationOrigin | null;
  readonly setAnnotationOrigin: (origin: BrowserAnnotationOrigin | null) => void;
  readonly pendingAnnotations: readonly BrowserAnnotationDraft[];
  readonly addPendingAnnotation: (draft: BrowserAnnotationDraft) => void;
  readonly dismissPendingAnnotation: (id: string) => void;
  readonly capture: {
    readonly recording: boolean;
    readonly recordingTabs: readonly string[];
    readonly drafts: readonly BrowserCaptureDraft[];
    readonly dismissDraft: (id: string) => void;
    readonly error: string | null;
    readonly setError: (error: string | null) => void;
    readonly screenshot: (sessionId: string, pageUrl: string) => void;
    readonly startRecording: (sessionId: string, pageUrl: string) => void;
    readonly stopRecording: () => void;
    readonly recordPointer: (pointer: {
      x: number;
      y: number;
      width: number;
      height: number;
      source: "agent" | "human";
      tabId?: string | null;
      phase?: "move" | "click" | "down";
    }) => void;
  };
}

export interface BrowserPreviewFrameValue {
  readonly viewport: BrowserStreamViewport | null;
  readonly pointer: BrowserStreamPointer | null;
  /** Latest answer for a touch probe: whether that page point accepts text input. */
  readonly probe: { readonly x: number; readonly y: number; readonly editable: boolean } | null;
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
