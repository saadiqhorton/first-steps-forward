import { memo, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { AnimatePresence } from "motion/react";
import { MotionItem } from "@/components/ade/motion";
import { SessionMessage } from "@/components/ade/SessionMessage";
import type { Message } from "@/lib/ade/types";

/** Messages shown at once when a conversation opens, and added per step while the page is idle. */
const FIRST = 24;
const STEP = 12;
/** A reader this close to the top (px) gets the rest faster. */
const NEAR_TOP = 2000;
const FAST_STEP = 48;

const whenIdle = (run: () => void) => {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(run, { timeout: 500 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(run, 50);
  return () => window.clearTimeout(id);
};

/**
 * The messages of a conversation. Memoized so log lines and typing leave it alone. The newest
 * show at once and older ones fill in above while nothing else is happening, so a long
 * conversation opens as fast as a short one. Give it a `key` per conversation.
 */
export const SessionThread = memo(function SessionThread({
  messages,
  agentName,
  projectId,
}: {
  messages: Message[];
  agentName?: string | undefined;
  projectId: string;
}) {
  const [hidden, setHidden] = useState(() => Math.max(0, messages.length - FIRST));
  const topRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hidden) return undefined;
    return whenIdle(() => {
      const scroller = topRef.current?.parentElement;
      // Rows appear above what is being read, so the distance to the end stays the same.
      const fromEnd = scroller ? scroller.scrollHeight - scroller.scrollTop : 0;
      const step = scroller && scroller.scrollTop < NEAR_TOP ? FAST_STEP : STEP;
      flushSync(() => setHidden((count) => Math.max(0, count - step)));
      if (scroller) scroller.scrollTop = scroller.scrollHeight - fromEnd;
    });
  }, [hidden]);

  return (
    <>
      <div ref={topRef} hidden />
      <AnimatePresence initial={false}>
        {messages.slice(hidden).map((message) => (
          <MotionItem key={message.id} layout={false} enter={hidden === 0}>
            <SessionMessage message={message} agentName={agentName} projectId={projectId} />
          </MotionItem>
        ))}
      </AnimatePresence>
    </>
  );
});
