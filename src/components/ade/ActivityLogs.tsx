import { useMemo, useState } from "react";
import { formatSessionLogs } from "@/lib/ade/formatLogs.mjs";

const TONE_CLASS: Record<string, string> = {
  info: "text-dim",
  tool: "text-ink",
  error: "text-danger",
  output: "text-dim",
  system: "text-ink",
};

export function ActivityLogs({ lines }: { lines: string[] }) {
  const [showRaw, setShowRaw] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const rows = useMemo(() => formatSessionLogs(lines), [lines]);

  if (!lines.length) {
    return <p className="text-[12px] text-dim">No CLI output yet.</p>;
  }

  if (showRaw) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-dim">
            {lines.length} raw line{lines.length === 1 ? "" : "s"}
          </p>
          <button
            type="button"
            onClick={() => setShowRaw(false)}
            className="btn-quiet px-2 py-1 text-[11px]"
          >
            Summarized view
          </button>
        </div>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-paper px-3 py-2 font-mono text-[10.5px] leading-relaxed text-ink/80 [overflow-wrap:anywhere]">
          {lines.join("\n")}
        </pre>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-dim">
          {rows.length} event{rows.length === 1 ? "" : "s"}
          {rows.length !== lines.length ? ` · ${lines.length} raw lines` : ""}
        </p>
        <button
          type="button"
          onClick={() => setShowRaw(true)}
          className="btn-quiet px-2 py-1 text-[11px]"
        >
          Raw log
        </button>
      </div>
      <ul className="max-h-80 space-y-1 overflow-y-auto rounded-md border border-line bg-paper p-1.5">
        {rows.map((row, index) => {
          const open = expanded === index;
          const canExpand = !!(row.body || (row.raw && row.raw !== row.title));
          return (
            <li key={`${index}-${row.title}`}>
              <button
                type="button"
                disabled={!canExpand}
                onClick={() => setExpanded(open ? null : index)}
                className={`flex w-full flex-col gap-0.5 rounded-md px-2.5 py-1.5 text-left ${
                  canExpand ? "hover:bg-ink/[0.04]" : ""
                } ${open ? "bg-ink/[0.04]" : ""}`}
              >
                <span
                  className={`text-[12px] leading-snug font-medium ${TONE_CLASS[row.tone] ?? "text-ink"}`}
                >
                  {row.tone === "tool" ? "▸ " : row.tone === "error" ? "⚠ " : ""}
                  {row.title}
                </span>
                {row.body && !open ? (
                  <span className="line-clamp-2 font-mono text-[10.5px] leading-relaxed text-dim">
                    {row.body}
                  </span>
                ) : null}
                {open ? (
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[10.5px] leading-relaxed text-dim [overflow-wrap:anywhere]">
                    {row.body || row.raw}
                  </pre>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
