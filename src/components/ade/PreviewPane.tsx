import { Link } from "@tanstack/react-router";
import previewImg from "@/assets/preview-storefront.jpg";
import type { Project, Session } from "@/lib/ade/types";
import { useAde } from "@/lib/ade/store";
import { summarizeChecks } from "./ChecksList";

export function PreviewPane({ project, session }: { project: Project; session?: Session }) {
  const { state, process } = useAde();
  const dev = state.processes.find((p) => p.projectId === project.id && p.port > 0);
  const running = dev?.status === "running";
  const checks = session ? summarizeChecks(session.checks) : null;
  const added = session?.changes.reduce((n, c) => n + c.added, 0) ?? 0;
  const removed = session?.changes.reduce((n, c) => n + c.removed, 0) ?? 0;

  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-l border-line bg-panel" aria-label="Preview">
      <div className="flex h-9 items-center justify-between border-b border-line px-3">
        <span className="label-mono">Preview</span>
        <span className="font-mono text-[10px] text-dim">{running ? `localhost:${dev?.port}` : "offline"}</span>
      </div>
      <div className="p-3">
        {running ? (
          <div className="overflow-hidden rounded-md outline-1 -outline-offset-1 outline-ink/10">
            <img
              src={previewImg}
              alt={`Local preview of ${project.name}`}
              width={1440}
              height={1088}
              className="block aspect-[4/3] w-full object-cover object-top"
            />
          </div>
        ) : (
          <div className="grid aspect-[4/3] w-full place-items-center rounded-md bg-ink/[0.04] outline-1 -outline-offset-1 outline-ink/5">
            <div className="text-center">
              <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-dim">Dev server stopped</div>
              {dev && (
                <button onClick={() => process(dev.id, "start")} className="btn-amber mt-3 px-3 py-1.5 text-[12px]">
                  Start {dev.name.toLowerCase()}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="mt-1 px-4 pb-4">
        <div className="font-display text-lg tracking-wide">{project.name}</div>
        <p className="mt-1 text-[12px] leading-snug text-dim">
          {running
            ? "This is your local copy on this machine. Nothing here is visible to users until you deploy."
            : "Start the dev server to see the project here."}
        </p>
        {running && (
          <div className="mt-2 flex gap-2">
            <a
              href={`http://localhost:${dev?.port}`}
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
          <span className="ml-auto font-mono text-[10px] text-dim">{session ? "this session" : "select a session"}</span>
        </div>
        <div className="flex justify-between px-3 py-2 font-mono text-[10px] text-dim">
          <span>Checks</span>
          <span className={checks?.verified ? "text-teal" : ""}>{checks ? checks.text : "—"}</span>
        </div>
        <div className="flex justify-between px-3 py-2 font-mono text-[10px] text-dim">
          <span>Diff</span>
          <span>{session ? `+${added} / −${removed}` : "—"}</span>
        </div>
        <div className="flex justify-between px-3 py-2 font-mono text-[10px] text-dim">
          <span>Logs</span>
          <span>{session ? `${session.logs.length} lines` : "—"}</span>
        </div>
      </div>
    </aside>
  );
}
