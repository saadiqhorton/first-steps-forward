import { memo, useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { SessionMessage } from "@/components/ade/SessionMessage";
import type { Message } from "@/lib/ade/types";

/** Messages on the page when a conversation opens, and added each time the reader nears the top. */
const FIRST = 40;
const STEP = 40;
/** How far above the visible messages the next ones are added (px). */
const AHEAD = 1200;

/**
 * The messages of a conversation. Memoized so log lines and typing leave it alone. Only the newest
 * are on the page; scrolling up adds the older ones before the reader reaches them, and find in
 * page (Ctrl/Cmd+F) adds them all. Give it a `key` per conversation.
 */
export const SessionThread = memo(function SessionThread({
  messages,
  agentName,
  projectId,
  running = false,
}: {
  messages: Message[];
  agentName?: string | undefined;
  projectId: string;
  /** A turn is being written: its reply is the last agent message. */
  running?: boolean;
}) {
  const [hidden, setHidden] = useState(() => Math.max(0, messages.length - FIRST));
  // Messages that arrive while the conversation is open rise in; those already there do not.
  const [present] = useState(() => messages.length);
  const topRef = useRef<HTMLDivElement>(null);

  /** Rows appear above what is being read, so the distance to the end stays the same. */
  const reveal = useCallback((count: number) => {
    const scroller = topRef.current?.parentElement;
    const fromEnd = scroller ? scroller.scrollHeight - scroller.scrollTop : 0;
    flushSync(() => setHidden((value) => Math.max(0, value - count)));
    if (scroller) scroller.scrollTop = scroller.scrollHeight - fromEnd;
  }, []);

  useEffect(() => {
    const top = topRef.current;
    if (!hidden || !top?.parentElement) return undefined;
    // Observed anew after each step: one that is still near the top must report again.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) reveal(STEP);
      },
      { root: top.parentElement, rootMargin: `${AHEAD}px 0px 0px 0px` },
    );
    observer.observe(top);
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") reveal(Infinity);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [hidden, reveal]);

  const last = messages.length - 1;
  return (
    <>
      {hidden > 0 && <div ref={topRef} aria-hidden className="h-px" />}
      {messages.slice(hidden).map((message, offset) => {
        const index = hidden + offset;
        return (
          <div key={message.id} className={index >= present ? "animate-rise" : undefined}>
            <SessionMessage
              message={message}
              agentName={agentName}
              projectId={projectId}
              streaming={running && index === last && message.role === "agent"}
            />
          </div>
        );
      })}
    </>
  );
});
