// Adapted from T3 Code (https://github.com/pingdotgg/t3code): apps/web/src/components/preview/AgentBrowserCursor.tsx (AgentCursorMark).
// Copyright (c) 2026 T3 Tools Inc. MIT License; see THIRD_PARTY_NOTICES.md.

import { useEffect, useState } from "react";
import {
  AGENT_CURSOR_ACTIVE_MS,
  agentBrowserCursorOpacity,
  type BrowserCursorController,
} from "@/lib/ade/browser/agentCursorLogic.mjs";
import type { BrowserStreamPointer, BrowserStreamViewport } from "@/lib/ade/browser/browserStream";

/**
 * Where the pointer event lands on the canvas box, in CSS px. The frame is drawn
 * object-fit contain, so the letterbox bars are added around it.
 */
function placeCursor(
  pointer: BrowserStreamPointer,
  canvas: HTMLCanvasElement,
  viewport: BrowserStreamViewport,
): { left: number; top: number } | null {
  if (canvas.width < 1 || canvas.height < 1 || viewport.width < 1 || viewport.height < 1) {
    return null;
  }
  const box = { width: canvas.clientWidth, height: canvas.clientHeight };
  const fit = Math.min(box.width / canvas.width, box.height / canvas.height);
  const width = canvas.width * fit;
  const height = canvas.height * fit;
  return {
    left: (box.width - width) / 2 + (pointer.x * width) / viewport.width,
    top: (box.height - height) / 2 + (pointer.y * height) / viewport.height,
  };
}

/** The agent's pointer over the page. It fades to a faint mark once it has been still. */
export function AgentCursor({
  pointer,
  canvas,
  viewport,
  controller,
}: {
  pointer: BrowserStreamPointer;
  canvas: HTMLCanvasElement;
  viewport: BrowserStreamViewport;
  controller: BrowserCursorController;
}) {
  const { phase, sequence } = pointer;
  const [inactiveSequence, setInactiveSequence] = useState<number | null>(null);
  const active = inactiveSequence !== sequence;

  useEffect(() => {
    const timeout = window.setTimeout(() => setInactiveSequence(sequence), AGENT_CURSOR_ACTIVE_MS);
    return () => window.clearTimeout(timeout);
  }, [sequence]);

  const place = placeCursor(pointer, canvas, viewport);
  if (!place) return null;

  return (
    <div
      className="pointer-events-none absolute top-0 left-0 z-[3] transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none"
      style={{
        opacity: agentBrowserCursorOpacity(active, controller),
        transform: `translate3d(${place.left}px, ${place.top}px, 0)`,
      }}
      aria-hidden="true"
      data-agent-browser-cursor
    >
      <div className="-translate-x-[3px] -translate-y-[2px]">
        {phase === "click" ? (
          <span
            key={sequence}
            className="absolute top-0.5 left-0.5 size-4 rounded-full bg-teal/25 motion-safe:animate-ping motion-reduce:hidden"
            style={{ animationIterationCount: 1, animationDuration: "500ms" }}
          />
        ) : null}
        <div className="flex items-start gap-0.5">
          <svg viewBox="0 0 18 20" className="block size-[18px] overflow-visible" aria-hidden>
            <path
              d="M2 1.5 L2 15.5 L5.8 12.2 L8.4 18 L10.9 16.9 L8.3 11.2 L13.6 11.2 Z"
              className="fill-teal stroke-paper"
              strokeWidth={1.2}
              strokeLinejoin="round"
            />
          </svg>
          <span className="mt-3 rounded-full bg-teal px-1.5 py-0.5 text-2xs leading-none font-semibold whitespace-nowrap text-paper">
            Agent
          </span>
        </div>
      </div>
    </div>
  );
}
