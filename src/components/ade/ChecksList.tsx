import type { Check, CheckStatus } from "@/lib/ade/types";

const STYLE: Record<CheckStatus, { label: string; cls: string; glyph: string }> = {
  passed: { label: "Passed", cls: "text-teal", glyph: "✓" },
  failed: { label: "Failed", cls: "text-danger", glyph: "×" },
  skipped: { label: "Skipped", cls: "text-dim", glyph: "–" },
  not_run: { label: "Not run", cls: "text-amber-deep", glyph: "○" },
};

export function summarizeChecks(checks: Check[]) {
  if (!checks.length) return { text: "No checks yet", verified: false };
  const failed = checks.filter((c) => c.status === "failed").length;
  const passed = checks.filter((c) => c.status === "passed").length;
  const notRun = checks.filter((c) => c.status === "not_run").length;
  const skipped = checks.filter((c) => c.status === "skipped").length;
  const text = `${passed} passed${failed ? ` · ${failed} failed` : ""}${notRun ? ` · ${notRun} not run` : ""}${skipped ? ` · ${skipped} skipped` : ""}`;
  return {
    text,
    verified: failed === 0 && notRun === 0 && skipped === 0 && passed > 0,
  };
}

export function ChecksList({ checks }: { checks: Check[] }) {
  if (!checks.length)
    return <p className="text-(length:--text-xs) text-dim">Checks haven't run yet.</p>;
  const s = summarizeChecks(checks);
  const sharedSkipDetail =
    checks.length > 1 &&
    checks.every((c) => c.status === "skipped") &&
    checks.every((c) => c.detail === checks[0]?.detail)
      ? checks[0]?.detail
      : null;

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 font-mono text-caption text-dim">
        <span>{s.text}</span>
        <span
          className={`ml-auto rounded-sm px-1.5 py-0.5 text-caption ${s.verified ? "bg-teal/15 text-teal-deep" : "bg-amber/15 text-amber-deep"}`}
        >
          {s.verified ? "Verified by checks" : "Not fully verified"}
        </span>
      </div>
      {sharedSkipDetail ? (
        <p className="mb-2 rounded-lg border border-line bg-paper px-3 py-2 text-ui leading-relaxed text-dim">
          {sharedSkipDetail}
        </p>
      ) : null}
      <ul className="card-panel divide-y divide-line">
        {checks.map((c) => {
          const st = STYLE[c.status];
          return (
            <li key={c.name} className="flex items-center gap-3 px-3 py-2">
              <span className={`w-5 font-mono text-(length:--text-xs) ${st.cls}`} aria-hidden>
                {st.glyph}
              </span>
              <span className="text-ui">{c.name}</span>
              <span className="ml-auto text-right">
                <span className={`block text-caption font-medium ${st.cls}`}>{st.label}</span>
                {!sharedSkipDetail && c.detail ? (
                  <span className="block max-w-[520px] whitespace-pre-wrap break-words font-mono text-caption leading-snug text-dim">
                    {c.detail}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
