// Resize behavior follows T3 Code's BrowserViewportResizeHandles and browserViewportLayout.
// Copyright (c) 2026 T3 Tools Inc. MIT License; see THIRD_PARTY_NOTICES.md.
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { adjustBrowserSettings } from "@/lib/ade/browser/api";
import type { BrowserStreamViewport } from "@/lib/ade/browser/browserStream";
import { VIEWPORT_LIMITS, clampViewport } from "@/shared/browser-contract.mjs";

type Direction = "west" | "east" | "south" | "southwest" | "southeast";
type Size = { width: number; height: number };
type Gesture = {
  pointerId: number;
  direction: Direction;
  x: number;
  y: number;
  initial: Size;
  scale: number;
  tabId: string | null;
};

const { minWidth, maxWidth, minHeight, maxHeight } = VIEWPORT_LIMITS;
const MAX_AREA = maxWidth * maxHeight;

function resizeAtRatio(desired: number, ratio: number, axis: "width" | "height"): Size {
  if (axis === "width") {
    const minimum = Math.ceil(Math.max(minWidth, minHeight * ratio));
    const maximum = Math.floor(
      Math.min(maxWidth, maxHeight * ratio, Math.sqrt(MAX_AREA * ratio)),
    );
    let width = Math.min(maximum, Math.max(minimum, Math.round(desired)));
    let height = Math.round(width / ratio);
    while (width * height > MAX_AREA && width > minimum) height = Math.round(--width / ratio);
    return { width, height };
  }
  const minimum = Math.ceil(Math.max(minHeight, minWidth / ratio));
  const maximum = Math.floor(
    Math.min(maxHeight, maxWidth / ratio, Math.sqrt(MAX_AREA / ratio)),
  );
  let height = Math.min(maximum, Math.max(minimum, Math.round(desired)));
  let width = Math.round(height * ratio);
  while (width * height > MAX_AREA && height > minimum) width = Math.round(--height * ratio);
  return { width, height };
}

/** Handles sit on the visible image, even when the streamed viewport is scaled to fit. */
export function BrowserViewportHandles({
  stage,
  viewport,
  projectId,
  sessionId,
  tabId,
  aspectRatio,
}: {
  stage: HTMLElement;
  viewport: BrowserStreamViewport;
  projectId: string;
  sessionId: string | null;
  tabId: string | null;
  aspectRatio: number | null;
}) {
  const [container, setContainer] = useState<Size>({
    width: stage.clientWidth,
    height: stage.clientHeight,
  });
  const [preview, setPreview] = useState<Size | null>(null);
  const [error, setError] = useState("");
  const gesture = useRef<Gesture | null>(null);
  const tabRef = useRef(tabId);
  tabRef.current = tabId;
  useEffect(() => {
    const measure = () => setContainer({ width: stage.clientWidth, height: stage.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [stage]);
  useEffect(() => {
    gesture.current = null;
    setPreview(null);
    setError("");
  }, [projectId, sessionId, tabId]);

  const scale = Math.min(container.width / viewport.width, container.height / viewport.height);
  if (!(scale > 0)) return null;
  const width = viewport.width * scale;
  const height = viewport.height * scale;
  const left = (container.width - width) / 2;
  const top = (container.height - height) / 2;

  const resize = (initial: Size, direction: Direction, dx: number, dy: number): Size => {
    const horizontal = direction.includes("east") ? dx : direction.includes("west") ? -dx : 0;
    const vertical = direction.includes("south") ? dy : 0;
    const desiredWidth = initial.width + horizontal;
    const desiredHeight = initial.height + vertical;
    if (aspectRatio && Number.isFinite(aspectRatio) && aspectRatio > 0) {
      const controlsWidth = horizontal !== 0 || direction === "east" || direction === "west";
      const controlsHeight = vertical !== 0 || direction === "south";
      const axis =
        controlsWidth && !controlsHeight
          ? "width"
          : controlsHeight && !controlsWidth
            ? "height"
            : Math.abs(horizontal) / initial.width >= Math.abs(vertical) / initial.height
              ? "width"
              : "height";
      return resizeAtRatio(axis === "width" ? desiredWidth : desiredHeight, aspectRatio, axis);
    }
    let { width, height } = clampViewport({ width: desiredWidth, height: desiredHeight });
    if (width * height > MAX_AREA) {
      if (Math.abs(horizontal) >= Math.abs(vertical)) width = Math.floor(MAX_AREA / height);
      else height = Math.floor(MAX_AREA / width);
    }
    return { width, height };
  };
  const commit = (next: Size, targetTab: string | null) => {
    void adjustBrowserSettings(projectId, { viewport: next }, targetTab ?? undefined, sessionId)
      .then(() => {
        if (tabRef.current === targetTab) setError("");
      })
      .catch((cause: unknown) => {
        if (tabRef.current === targetTab)
          setError(cause instanceof Error ? cause.message : "Could not resize the viewport.");
      });
  };
  const down = (direction: Direction, event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = {
      pointerId: event.pointerId,
      direction,
      x: event.clientX,
      y: event.clientY,
      initial: viewport,
      scale,
      tabId,
    };
    setPreview(viewport);
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    setPreview(
      resize(
        current.initial,
        current.direction,
        (event.clientX - current.x) / current.scale,
        (event.clientY - current.y) / current.scale,
      ),
    );
  };
  const end = (event: PointerEvent<HTMLButtonElement>) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    gesture.current = null;
    setPreview(null);
    if (event.type === "pointerup" && current.tabId === tabRef.current)
      commit(
        resize(
          current.initial,
          current.direction,
          (event.clientX - current.x) / current.scale,
          (event.clientY - current.y) / current.scale,
        ),
        current.tabId,
      );
  };
  const key = (direction: Direction, event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? 10 : 1;
    const dx = event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
    const dy = event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0;
    if (!dx && !dy) return;
    event.preventDefault();
    commit(resize(viewport, direction, dx, dy), tabId);
  };
  const button = (direction: Direction, label: string, style: CSSProperties, cursor: string) => (
    <button
      key={direction}
      type="button"
      aria-label={`${label}. Use arrow keys to resize.`}
      title={label}
      className={`absolute z-20 grid size-6 touch-none place-items-center rounded bg-panel/80 text-dim shadow ring-1 ring-line hover:text-ink focus-visible:outline-2 focus-visible:outline-amber ${cursor}`}
      style={style}
      onPointerDown={(event) => down(direction, event)}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={(event) => key(direction, event)}
    >
      <span aria-hidden>
        {direction === "south" ? "═" : direction === "east" || direction === "west" ? "‖" : "⌟"}
      </span>
    </button>
  );
  const edge = (value: number, max: number) => Math.max(0, Math.min(max - 24, value - 12));
  return (
    <>
      {button(
        "west",
        "Resize viewport from left",
        { left: edge(left, container.width), top: edge(top + height / 2, container.height) },
        "cursor-ew-resize",
      )}
      {button(
        "east",
        "Resize viewport from right",
        {
          left: edge(left + width, container.width),
          top: edge(top + height / 2, container.height),
        },
        "cursor-ew-resize",
      )}
      {button(
        "south",
        "Resize viewport from bottom",
        {
          left: edge(left + width / 2, container.width),
          top: edge(top + height, container.height),
        },
        "cursor-ns-resize",
      )}
      {button(
        "southwest",
        "Resize viewport from bottom left",
        { left: edge(left, container.width), top: edge(top + height, container.height) },
        "cursor-nesw-resize",
      )}
      {button(
        "southeast",
        "Resize viewport from bottom right",
        { left: edge(left + width, container.width), top: edge(top + height, container.height) },
        "cursor-nwse-resize",
      )}
      {preview ? (
        <div className="pointer-events-none absolute top-3 left-1/2 z-30 -translate-x-1/2 rounded bg-panel px-2 py-1 text-xs shadow">
          {preview.width} × {preview.height}
        </div>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="absolute bottom-2 left-2 z-30 rounded bg-panel p-2 text-xs text-danger"
        >
          {error}
        </div>
      ) : null}
    </>
  );
}
