import { useEffect, useMemo, useRef } from "react";
import { formatSessionLogs } from "@/lib/ade/formatLogs.mjs";

const TONE_CLASS: Record<string, string> = {
  info: "text-dim",
  tool: "text-ink",
  error: "text-danger",
  output: "text-dim",
  system: "text-ink",
};

export function ActivityLogs({ lines }: { lines: string[] }) {
  const rows = useMemo(() => formatSessionLogs(lines), [lines]);
  const listRef = useRef<HTMLUListElement>(null);
  const endRef = useRef<HTMLLIElement>(null);
  // Follow new events only while the reader is already near the bottom.
  const stickToBottomRef = useRef(true);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    endRef.current?.scrollIntoView({ block: "end" });
  }, [rows.length, lines.length]);

  if (!lines.length) {
    return <p className="text-[13px] text-dim">No CLI output yet.</p>;
  }

  if (!rows.length) {
    return <p className="text-[13px] text-dim">No activity events yet.</p>;
  }

  return (
    <div className="space-y-2">
      <p className="text-[12px] text-dim">
        {rows.length} event{rows.length === 1 ? "" : "s"}
      </p>
      <ul
        ref={listRef}
        onScroll={onScroll}
        className="max-h-[min(70vh,36rem)] space-y-1 overflow-y-auto overscroll-contain rounded-md border border-line bg-paper p-2"
      >
        {rows.map((row, index) => (
          <li key={`${index}-${row.title}`} className="rounded-md px-3 py-2.5">
            <div
              className={`text-[14px] leading-snug font-medium ${TONE_CLASS[row.tone] ?? "text-ink"}`}
            >
              {row.tone === "tool" ? "▸ " : row.tone === "error" ? "⚠ " : ""}
              {row.title}
            </div>
            {row.body ? (
              <div className="mt-1 font-mono text-[13px] leading-relaxed text-dim [overflow-wrap:anywhere]">
                {row.body}
              </div>
            ) : null}
          </li>
        ))}
        <li ref={endRef} aria-hidden className="m-0 h-0 list-none p-0" />
      </ul>
    </div>
  );
}
