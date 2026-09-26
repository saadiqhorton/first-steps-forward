import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { timeAgo, useActiveProject, useAde } from "@/lib/ade/store";

export const Route = createFileRoute("/processes")({
  head: () => ({
    meta: [
      { title: "Processes — ADE" },
      {
        name: "description",
        content: "Start, stop, and inspect the local dev servers and watchers for each project.",
      },
      { property: "og:title", content: "Processes — ADE" },
      { property: "og:description", content: "Every local process, named by project and purpose." },
    ],
  }),
  component: Processes,
});

function Processes() {
  const { state, process } = useAde();
  const active = useActiveProject();
  const [open, setOpen] = useState<string | null>(
    state.processes.find((p) => p.projectId === active.id)?.id ?? null,
  );
  const grouped = state.projects.map((p) => ({
    project: p,
    procs: state.processes.filter((x) => x.projectId === p.id),
  }));

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="px-7 pt-6 pb-4">
        <div className="label-mono">This machine</div>
        <h1 className="mt-1 font-display text-[44px] leading-[0.9] tracking-wide">Processes</h1>
        <p className="mt-1 text-[12px] text-dim">
          ADE passes a loopback host and port to the project's dev script. Check its output: a
          custom script can ignore those options. ADE never runs a production deployment.
        </p>
      </div>
      <div className="space-y-6 px-7 pb-8">
        {grouped.map(({ project, procs }) => (
          <section key={project.id} aria-labelledby={`proc-${project.id}`}>
            <div id={`proc-${project.id}`} className="label-mono mb-2">
              {project.name} · {project.path}
            </div>
            <div className="card-panel divide-y divide-line">
              {procs.map((p) => {
                const running = p.status === "running";
                const isOpen = open === p.id;
                return (
                  <div key={p.id}>
                    <div className="flex items-center gap-3 px-4 py-3">
                      <span
                        className={`size-2 rounded-full ${running ? "bg-teal animate-pulse-soft" : "bg-dim"}`}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium">
                          {p.name}{" "}
                          <span className="ml-1 font-mono text-[10px] font-normal text-dim">
                            {running ? "running" : "stopped"}
                          </span>
                        </div>
                        <div className="font-mono text-[10px] text-dim">
                          {p.command}
                          {running && p.port
                            ? ` · http://127.0.0.1:${p.port} · up ${timeAgo(state.now, p.startedAt).replace(" ago", "")}`
                            : ""}
                        </div>
                      </div>
                      {running && p.port > 0 && (
                        <a
                          href={`http://127.0.0.1:${p.port}`}
                          target="_blank"
                          rel="noreferrer"
                          className="btn-quiet px-3 py-1.5 text-[12px]"
                        >
                          Open
                        </a>
                      )}
                      <button
                        onClick={() => setOpen(isOpen ? null : p.id)}
                        className="btn-quiet px-3 py-1.5 text-[12px]"
                        aria-expanded={isOpen}
                      >
                        Output
                      </button>
                      {running ? (
                        <button
                          onClick={() => process(p.id, "stop")}
                          className="btn-quiet px-3 py-1.5 text-[12px]"
                        >
                          Stop
                        </button>
                      ) : (
                        <button
                          onClick={() => process(p.id, "start")}
                          className="btn-amber px-3 py-1.5 text-[12px]"
                        >
                          Start
                        </button>
                      )}
                    </div>
                    {isOpen && (
                      <pre className="max-h-56 overflow-y-auto bg-ink px-4 py-3 font-mono text-[11px] leading-relaxed text-paper/80">
                        {p.output.length ? p.output.join("\n") : "No output yet."}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
