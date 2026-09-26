import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { SignInDialog } from "@/components/ade/SignInDialog";
import type { Agent } from "@/lib/ade/types";
import { useActiveProject, useAde } from "@/lib/ade/store";

export const Route = createFileRoute("/agents")({
  head: () => ({ meta: [{ title: "Agents — ADE" }] }),
  component: Agents,
});
function Agents() {
  const { state, setDefaultAgent } = useAde();
  const project = useActiveProject();
  const [signing, setSigning] = useState<Agent | null>(null);
  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="px-7 pt-6 pb-4">
        <div className="label-mono">Local CLI detection</div>
        <h1 className="mt-1 font-display text-[44px] leading-[0.9]">Agents & accounts</h1>
        <p className="mt-2 max-w-2xl text-[12px] leading-relaxed text-dim">
          ADE starts the installed agent CLIs in the selected project. Sign-in belongs to each agent
          and stays in its user-level credential store. ADE never stores provider tokens. Model
          usage may have provider costs.
        </p>
      </div>
      <div className="space-y-3 px-7 pb-8">
        {state.agents.map((a, i) => (
          <section
            key={a.id}
            className="card-panel p-4 animate-rise"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <div className="flex items-start gap-4">
              <div className="grid size-10 shrink-0 place-items-center rounded-md bg-ink font-display text-lg text-paper">
                {a.short.slice(0, 2)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-[14px]">{a.name}</strong>
                  {a.version && <span className="font-mono text-[10px] text-dim">{a.version}</span>}
                  <span
                    className={`rounded px-1.5 py-0.5 font-mono text-[9px] uppercase ${!a.installed ? "bg-ink/5 text-dim" : a.signedIn ? "bg-teal/15 text-teal-deep" : "bg-amber/15 text-amber-deep"}`}
                  >
                    {!a.installed ? "Not installed" : a.signedIn ? "Ready" : "Sign-in needed"}
                  </span>
                </div>
                <p className="mt-1 text-[12px] text-dim">{a.authMethod}</p>
                {a.providers && a.providers.length > 0 && (
                  <p className="mt-1 text-[12px]">
                    <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-dim">
                      Connected providers:{" "}
                    </span>
                    {a.providers.join(", ")}
                  </p>
                )}
                <p className="mt-2 text-[12px] leading-relaxed text-dim">{a.authNote}</p>
                {!a.installed && (
                  <a
                    href={a.installHint.match(/https?:\/\/\S+/)?.[0]}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-block text-[12px] text-teal underline"
                  >
                    Installation instructions
                  </a>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                {a.installed && !a.signedIn && (
                  <button
                    onClick={() => setSigning(a)}
                    className="btn-amber px-3 py-1.5 text-[12px]"
                  >
                    Set up
                  </button>
                )}
                {a.installed && a.signedIn && project.id && (
                  <button
                    onClick={() => setDefaultAgent(project.id, a.id)}
                    disabled={project.defaultAgent === a.id}
                    className="btn-quiet px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide"
                  >
                    {project.defaultAgent === a.id ? `Default · ${project.name}` : `Make default`}
                  </button>
                )}
              </div>
            </div>
          </section>
        ))}
        <div className="card-panel p-4 text-[12px] leading-relaxed text-dim">
          <strong className="text-ink">Sign-in limitations are explicit:</strong> Codex offers a
          browser/device sign-in that ADE can start. OpenCode's interactive provider selector and
          Pi's `/login` require their own terminal UI; ADE does not fake these flows. Claude Code is
          deferred.
        </div>
      </div>
      {signing && <SignInDialog agent={signing} onClose={() => setSigning(null)} />}
    </main>
  );
}
