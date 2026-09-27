import { Link } from "@tanstack/react-router";
import type { Project, Session } from "@/lib/ade/types";
import { useAde } from "@/lib/ade/store";
import { summarizeChecks } from "./ChecksList";

export function PreviewPane({
  project,
  session,
}: {
  project: Project;
  session?: Session | undefined;
}) {
  const { state, process } = useAde();
  const dev = state.processes.find((p) => p.projectId === project.id);
  const running = dev?.status === "running" && dev.port > 0;
  const starting = dev?.status === "starting";
  const checks = session ? summarizeChecks(session.checks) : null;
  const added = session?.changes.reduce((n, c) => n + c.added, 0) ?? 0;
  const removed = session?.changes.reduce((n, c) => n + c.removed, 0) ?? 0;
  return (
    <aside
      className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col bg-panel"
      aria-label="Preview"
    >
      <div className="flex h-9 items-center justify-between border-b border-line px-3">
        <span className="label-mono">Preview</span>
        <span className="font-mono text-[10px] text-dim">
          {running ? `127.0.0.1:${dev?.port}` : starting ? "starting…" : "offline"}
        </span>
      </div>
      <div className="p-3">
        {running && dev ? (
          <div className="overflow-hidden rounded-md bg-white outline-1 -outline-offset-1 outline-ink/10">
            <iframe
              title={`Live preview of ${project.name}`}
              src={`http://127.0.0.1:${dev.port}`}
              className="block aspect-[4/3] w-full border-0 bg-white"
              sandbox="allow-scripts allow-forms allow-same-origin"
            />
          </div>
        ) : (
          <div className="grid aspect-[4/3] w-full place-items-center rounded-md bg-ink/[0.04] outline-1 -outline-offset-1 outline-ink/5">
            <div className="text-center">
              <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-dim">
                {!dev
                  ? "No dev script detected"
                  : starting
                    ? "Dev server starting"
                    : dev.port === 0
                      ? "Dev script detected"
                      : "Dev server stopped"}
              </div>
              {dev &&
                (starting ? (
                  <button
                    onClick={() => process(dev.id, "stop")}
                    className="btn-quiet mt-3 px-3 py-1.5 text-[12px]"
                  >
                    Stop
                  </button>
                ) : (
                  <button
                    onClick={() => process(dev.id, "start")}
                    className="btn-amber mt-3 px-3 py-1.5 text-[12px]"
                  >
                    Start {dev.name.toLowerCase()}
                  </button>
                ))}
            </div>
          </div>
        )}
      </div>
      <div className="mt-1 px-4 pb-4">
        <div className="font-display text-lg tracking-wide">{project.name}</div>
        <p className="mt-1 text-[12px] leading-snug text-dim">
          {running
            ? "Live iframe from the project's local development server."
            : !dev
              ? "No package.json dev script was detected for this folder."
              : starting
                ? "The dev script is booting; the live preview appears once its port accepts connections."
                : dev.port === 0
                  ? "Start the dev script to see a live preview."
                  : "Start the configured local dev script to see a live preview."}
        </p>
        {running && dev && (
          <div className="mt-2 flex gap-2">
            <a
              href={`http://127.0.0.1:${dev.port}`}
              target="_blank"
              rel="noreferrer"
              className="btn-quiet px-3 py-1.5 text-[12px]"
            >
              Open in browser
            </a>
            <Link to="/processes" className="btn-quiet px-3 py-1.5 text-[12px]">
              Output
            </Link>
          </div>
        )}
      </div>
      <div className="mt-auto border-t border-line">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
          <span className="label-mono">Details</span>
          <span className="ml-auto font-mono text-[10px] text-dim">
            {session ? "this task" : "project"}
          </span>
        </div>
        <div className="flex justify-between px-3 py-2 font-mono text-[10px] text-dim">
          <span>Checks</span>
          <span className={checks?.verified ? "text-teal" : ""}>{checks ? checks.text : "—"}</span>
        </div>
        <div className="flex justify-between px-3 py-2 font-mono text-[10px] text-dim">
          <span>Working tree diff</span>
          <span>{session ? `+${added} / −${removed}` : "—"}</span>
        </div>
        <div className="flex justify-between px-3 py-2 font-mono text-[10px] text-dim">
          <span>Agent output</span>
          <span>{session ? `${session.logs.length} lines` : "—"}</span>
        </div>
      </div>
    </aside>
  );
}
