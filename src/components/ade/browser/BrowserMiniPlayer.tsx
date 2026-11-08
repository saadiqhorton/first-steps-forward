// Adapted from T3 Code (https://github.com/pingdotgg/t3code): apps/web/src/components/preview/ThreadPreviewMiniPlayer.tsx (MiniPlayerShell).
// Copyright (c) 2026 T3 Tools Inc. MIT License; see THIRD_PARTY_NOTICES.md.

import { PanelRight, PictureInPicture2, Square, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  clampMiniPlayerPosition,
  MINI_PLAYER_CORNER_RADIUS,
  MINI_PLAYER_Z_INDEX,
  resizeMiniPlayer,
  resolveMiniPlayerFrame,
  type MiniPlayerFrame,
  type MiniPlayerResizeDirection,
} from "@/lib/ade/browser/miniPlayerLayout.mjs";
import { DEFAULT_VIEWPORT } from "@/shared/browser-contract.mjs";
import {
  openBrowserPictureInPicture,
  supportsBrowserPictureInPicture,
} from "@/lib/ade/browser/pictureInPicture.mjs";
import type { RightDock } from "../rightPaneTypes";
import { useShell } from "../shellContext";
import { BrowserSurface } from "./BrowserSurface";
import { useBrowserPreviewFrame, useBrowserPreviewState } from "./browserPreviewContext";
import { useBrowserMiniPlayer, useBrowserPlacement } from "./browserPresentationContext";

/** Pointer travel that still counts as a tap rather than a drag. */
const TAP_SLOP_PX = 6;
/** Source aspect ratio until the page has reported its viewport. */
const FALLBACK_SOURCE = DEFAULT_VIEWPORT;

interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

interface Gesture {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly startX: number;
  readonly startY: number;
  readonly frame: MiniPlayerFrame;
  readonly direction: MiniPlayerResizeDirection | null;
  moved: boolean;
}

const HANDLES: ReadonlyArray<{ direction: MiniPlayerResizeDirection; className: string }> = [
  { direction: "north", className: "top-0 left-4 right-4 h-2 cursor-ns-resize" },
  { direction: "south", className: "bottom-0 left-4 right-4 h-2 cursor-ns-resize" },
  { direction: "east", className: "top-4 right-0 bottom-4 w-2 cursor-ew-resize" },
  { direction: "west", className: "top-4 bottom-4 left-0 w-2 cursor-ew-resize" },
  { direction: "northwest", className: "top-0 left-0 size-4 cursor-nwse-resize" },
  { direction: "southeast", className: "right-0 bottom-0 size-4 cursor-nwse-resize" },
  { direction: "northeast", className: "top-0 right-0 size-4 cursor-nesw-resize" },
  { direction: "southwest", className: "bottom-0 left-0 size-4 cursor-nesw-resize" },
];

const ICON_BUTTON =
  "grid size-7 shrink-0 place-items-center rounded-full text-dim hover:bg-ink/[0.05] hover:text-ink focus-visible:outline-2 focus-visible:outline-amber";

/** The main content area, which the floating player is kept inside. */
function useShellBox(layoutKey: RightDock): Box | null {
  const [box, setBox] = useState<Box | null>(null);
  useEffect(() => {
    const measure = () => {
      const main = document.getElementById("shell-main");
      if (!main) {
        setBox({ left: 0, top: 0, width: window.innerWidth, height: window.innerHeight });
        return;
      }
      const rect = main.getBoundingClientRect();
      setBox({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    };
    measure();
    // The main panel is remounted when the dock moves, so observe it again on each change.
    const main = document.getElementById("shell-main");
    const observer = new ResizeObserver(measure);
    if (main) observer.observe(main);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [layoutKey]);
  return box;
}

/**
 * The floating browser: a chromeless tile over the main content. Only the status dot starts a
 * drag, the dot reveals the controls on hover or tap, and the edges and corners resize it.
 */
export function BrowserMiniPlayer({ dock }: { dock: RightDock }) {
  const { projectId, place } = useBrowserPlacement();
  if (!projectId || place !== "float") return null;
  return <FloatingBrowser key={projectId} dock={dock} />;
}

function FloatingBrowser({ dock }: { dock: RightDock }) {
  const preview = useBrowserPreviewState();
  const frameState = useBrowserPreviewFrame();
  const { mini, setMini } = useBrowserMiniPlayer();
  const { setPlace } = useBrowserPlacement();
  const shell = useShell();
  const { control } = preview;
  const { viewport, canvas } = frameState;
  const box = useShellBox(dock);
  const gestureRef = useRef<Gesture | null>(null);
  const [pillOpen, setPillOpen] = useState(false);

  if (!box) return null;

  const source = viewport ?? FALLBACK_SOURCE;
  const container = { width: box.width, height: box.height };
  const frame = resolveMiniPlayerFrame({
    width: mini.width,
    position: mini.position,
    source,
    container,
  });
  const controlling = control?.controller === "you";

  const beginGesture = (
    event: PointerEvent<HTMLElement>,
    direction: MiniPlayerResizeDirection | null,
  ) => {
    if (event.button !== 0) return;
    gestureRef.current = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      frame,
      direction,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const moveGesture = (event: PointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const delta = { x: event.clientX - gesture.startX, y: event.clientY - gesture.startY };
    if (!gesture.moved && Math.hypot(delta.x, delta.y) < TAP_SLOP_PX) return;
    gesture.moved = true;
    if (gesture.direction === null) {
      setMini({
        width: mini.width,
        position: clampMiniPlayerPosition(
          { x: gesture.frame.x + delta.x, y: gesture.frame.y + delta.y },
          container,
          gesture.frame,
        ),
      });
      return;
    }
    const next = resizeMiniPlayer({
      start: gesture.frame,
      direction: gesture.direction,
      delta,
      source,
      container,
    });
    setMini({ width: next.width, position: { x: next.x, y: next.y } });
  };

  const endGesture = (event: PointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    // Touch has no hover, so a tap on the dot toggles the controls instead.
    if (
      event.type === "pointerup" &&
      gesture.direction === null &&
      gesture.pointerType === "touch" &&
      !gesture.moved
    ) {
      setPillOpen((open) => !open);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    setPillOpen((open) => !open);
  };

  const dockToPane = () => {
    setPlace("dock");
    shell.selectTab("computer");
  };

  return (
    <section
      aria-label="Agent browser, floating"
      className="fixed flex select-none flex-col overflow-hidden bg-surface-muted ring-1 ring-line ring-inset shadow-lg"
      style={{
        left: box.left + frame.x,
        top: box.top + frame.y,
        width: frame.width,
        height: frame.height,
        borderRadius: MINI_PLAYER_CORNER_RADIUS,
        zIndex: MINI_PLAYER_Z_INDEX,
      }}
    >
      <BrowserSurface mode="float" className="min-h-0 flex-1" />

      <div
        className="group absolute top-2.5 right-2.5 z-[49] flex items-center gap-1.5"
        data-pill-open={pillOpen ? "" : undefined}
      >
        <div
          role="toolbar"
          aria-label="Floating browser controls"
          className="pointer-events-none flex items-center gap-0.5 rounded-full bg-panel/90 p-0.5 opacity-0 ring-1 ring-line ring-inset shadow-lg backdrop-blur-xl transition-opacity duration-150 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 group-data-[pill-open]:pointer-events-auto group-data-[pill-open]:opacity-100 motion-reduce:transition-none"
        >
          {preview.capture.recording ? (
            <button
              type="button"
              aria-label="Stop recording"
              title="Stop recording"
              onClick={() => {
                preview.capture.stopRecording();
                dockToPane();
              }}
              className={`${ICON_BUTTON} text-danger`}
            >
              <Square className="size-3.5" fill="currentColor" aria-hidden />
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Pop out window"
            title="Pop out window"
            disabled={!canvas || !supportsBrowserPictureInPicture()}
            onClick={() => {
              if (!canvas) return;
              void openBrowserPictureInPicture(canvas, "ADE browser").catch(() => undefined);
            }}
            className={`${ICON_BUTTON} disabled:opacity-40`}
          >
            <PictureInPicture2 className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Dock to pane"
            title="Dock to pane"
            onClick={dockToPane}
            className={ICON_BUTTON}
          >
            <PanelRight className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Close floating browser"
            title="Close"
            onClick={() => setPlace("hidden")}
            className={ICON_BUTTON}
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
        <div
          role="button"
          tabIndex={0}
          aria-label="Drag window, or press for controls"
          aria-expanded={pillOpen}
          onPointerDown={(event) => beginGesture(event, null)}
          onPointerMove={moveGesture}
          onPointerUp={endGesture}
          onPointerCancel={endGesture}
          onKeyDown={handleKey}
          className="grid size-3.5 cursor-grab touch-none place-items-center active:cursor-grabbing [@media(pointer:coarse)]:size-8"
        >
          <span
            aria-hidden
            className={`size-2 rounded-full ring-1 ring-paper/70 ring-inset shadow-sm transition-opacity duration-150 group-hover:opacity-0 group-data-[pill-open]:opacity-0 motion-reduce:transition-none ${controlling ? "bg-amber" : "bg-teal"}`}
          />
        </div>
      </div>

      {HANDLES.map(({ direction, className }) => (
        <div
          key={direction}
          role="presentation"
          data-mini-resize={direction}
          className={`absolute z-[49] touch-none ${className}`}
          onPointerDown={(event) => beginGesture(event, direction)}
          onPointerMove={moveGesture}
          onPointerUp={endGesture}
          onPointerCancel={endGesture}
        />
      ))}
    </section>
  );
}
