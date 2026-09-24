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
  if (failed) return { text: `${failed} failed · ${passed} passed`, verified: false };
  return { text: `${passed} passed${notRun ? ` · ${notRun} not run` : ""}`, verified: failed === 0 && passed > 0 };
}

export function ChecksList({ checks }: { checks: Check[] }) {
  if (!checks.length) return <p className="text-[12px] text-dim">Checks haven't run yet.</p>;
  const s = summarizeChecks(checks);
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 font-mono text-[11px] text-dim">
        <span>{s.text}</span>
        <span className={`ml-auto rounded px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] ${s.verified ? "bg-teal/15 text-teal-deep" : "bg-amber/15 text-amber-deep"}`}>
          {s.verified ? "Verified by checks" : "Not fully verified"}
        </span>
      </div>
      <ul className="card-panel divide-y divide-line">
        {checks.map((c) => {
          const st = STYLE[c.status];
          return (
            <li key={c.name} className="flex items-center gap-3 px-3 py-2">
              <span className={`w-5 font-mono text-[12px] ${st.cls}`} aria-hidden>{st.glyph}</span>
              <span className="text-[13px]">{c.name}</span>
              <span className="ml-auto text-right">
                <span className={`block text-[11px] font-semibold ${st.cls}`}>{st.label}</span>
                <span className="block font-mono text-[10px] text-dim">{c.detail}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
