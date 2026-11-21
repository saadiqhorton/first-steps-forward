import { Check, Download, LoaderCircle, RotateCcw, Wrench } from "lucide-react";
import {
  startSetup,
  useCustomizeAction,
  type CustomizeSetup,
  type SetupStep,
} from "@/lib/ade/customizeApi";

const STEPS: { id: SetupStep; label: string }[] = [
  { id: "copy", label: "Copy ADE's source into your private copy" },
  { id: "install", label: "Download build tools" },
  { id: "save", label: "Save the starting point" },
];

const SETUP_FACTS = [
  "Copies ADE's source into your ADE folder",
  "Downloads build tools once, about 0.7 GB",
  "Your projects are not touched",
];

/** First visit, running setup, and a failed setup with Retry. */
export function SetupPanel({ setup }: { setup: CustomizeSetup }) {
  const start = useCustomizeAction(() => startSetup());
  const running = setup.status === "running" || start.isPending;
  const current = STEPS.findIndex((step) => step.id === setup.step);
  const startError = start.error instanceof Error ? start.error.message : null;

  return (
    <section className="card-panel w-full max-w-2xl p-6">
      <span className="grid size-10 place-items-center rounded-lg border border-line bg-paper text-dim">
        <Wrench className="size-4" strokeWidth={1.5} aria-hidden />
      </span>
      <h2 className="mt-4 text-base font-medium text-ink">Make ADE work the way you do</h2>
      <p className="mt-2 text-ui leading-5 text-[color:var(--text-secondary)]">
        Describe a feature, a tool or a behavior change and an agent builds it in a private copy of
        ADE. You try it first, and keep it only if you like it. Colors and layout stay as designed.
      </p>

      {setup.status === "none" && (
        <>
          <h3 className="label-section mt-5">What setup does, once</h3>
          <ul className="mt-2 space-y-1.5 text-ui leading-5 text-[color:var(--text-secondary)]">
            {SETUP_FACTS.map((fact) => (
              <li key={fact} className="flex items-start gap-2.5">
                <Check className="mt-0.5 size-4 shrink-0 text-dim" strokeWidth={1.5} aria-hidden />
                <span className="min-w-0">{fact}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => start.mutate(undefined)}
            disabled={start.isPending}
            className="btn-amber mt-5 inline-flex items-center gap-2 px-4 py-2 text-ui"
          >
            <Download className="size-4" strokeWidth={1.5} aria-hidden />
            {start.isPending ? "Starting…" : "Set up customization"}
          </button>
          <p className="mt-2 text-xs text-dim">It takes a few minutes.</p>
        </>
      )}

      {(running || (setup.status === "failed" && current >= 0)) && setup.status !== "none" && (
        <ol className="mt-5 space-y-3" aria-label="Setup steps">
          {STEPS.map((step, index) => {
            const done = index < current;
            const active = index === current;
            const failed = setup.status === "failed" && active;
            return (
              <li key={step.id} className="flex items-start gap-3">
                <span className="mt-0.5 grid size-4 shrink-0 place-items-center" aria-hidden>
                  {done ? (
                    <Check className="size-4 text-teal" strokeWidth={1.5} />
                  ) : failed ? (
                    <span className="size-2 rounded-full bg-danger" />
                  ) : active && running ? (
                    <LoaderCircle className="size-4 animate-spin text-teal" strokeWidth={1.5} />
                  ) : (
                    <span className="size-2 rounded-full bg-line" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`text-ui ${done || active ? "text-ink" : "text-dim"}`}>
                    {step.label}
                    {failed && <span className="text-danger"> · stopped here</span>}
                    <span className="sr-only">
                      {done ? " (done)" : active && !failed ? " (running)" : ""}
                    </span>
                  </p>
                  {active && running && setup.progress && (
                    <div className="mt-2 max-w-md">
                      <div className="h-1 overflow-hidden rounded-full bg-ink/[0.08]">
                        {setup.progress.total ? (
                          <div
                            className="h-full rounded-full bg-teal transition-[width]"
                            style={{
                              width: `${Math.min(100, (setup.progress.done / setup.progress.total) * 100)}%`,
                            }}
                          />
                        ) : (
                          <div className="h-full w-1/3 animate-pulse-soft rounded-full bg-teal" />
                        )}
                      </div>
                      <p className="mt-1 truncate font-mono text-xs text-dim">
                        {setup.progress.label}
                      </p>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {setup.status === "failed" && (
        <div className="mt-5 rounded-md border border-danger/30 bg-danger/5 px-4 py-3" role="alert">
          <p className="text-ui font-medium text-ink">Setup stopped</p>
          {setup.error && (
            <pre className="mt-2 max-h-48 overflow-auto font-mono text-xs leading-5 whitespace-pre-wrap text-[color:var(--text-secondary)]">
              {setup.error}
            </pre>
          )}
          <button
            type="button"
            onClick={() => start.mutate(undefined)}
            disabled={start.isPending}
            className="btn-quiet mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium"
          >
            <RotateCcw className="size-3.5" strokeWidth={1.5} aria-hidden />
            Retry
          </button>
        </div>
      )}

      {startError && (
        <p className="mt-3 text-xs text-danger" role="alert">
          {startError}
        </p>
      )}
    </section>
  );
}
