import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { SignInDialog } from "@/components/ade/SignInDialog";
import type { Agent } from "@/lib/ade/types";
import { useActiveProject, useAde } from "@/lib/ade/store";

export const Route = createFileRoute("/agents")({
  head: () => ({
    meta: [
      { title: "Agents & accounts — ADE" },
      { name: "description", content: "See which coding agents are installed, sign in with a guided flow, and set the default agent per project." },
      { property: "og:title", content: "Agents & accounts — ADE" },
      { property: "og:description", content: "Codex, OpenCode, and Pi Agent — bring the agents you already use." },
    ],
  }),
  component: Agents,
});

function Agents() {
  const { state, signOut, setDefaultAgent } = useAde();
  const project = useActiveProject();
  const [signing, setSigning] = useState<Agent | null>(null);

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="px-7 pt-6 pb-4">
        <div className="label-mono">Detected on this machine</div>
        <h1 className="mt-1 font-display text-[44px] leading-[0.9] tracking-wide">Agents & accounts</h1>
        <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-dim">
          ADE coordinates coding agents you already have. Sign-in happens through each agent's own flow; credentials live in your system keychain and never in a project. Model providers may charge for usage — ADE itself is free.
        </p>
      </div>
      <div className="space-y-3 px-7 pb-8">
        {state.agents.map((a, i) => {
          const isDefault = project.defaultAgent === a.id;
          return (
            <div key={a.id} className="card-panel p-4 animate-rise" style={{ animationDelay: `${i * 70}ms` }}>
              <div className="flex items-start gap-4">
                <div className="grid size-10 shrink-0 place-items-center rounded-md bg-ink font-display text-lg text-paper">{a.short.slice(0, 2)}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-semibold">{a.name}</span>
                    {a.version && <span className="font-mono text-[10px] text-dim">v{a.version}</span>}
                    <span
                      className={`ml-1 rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] ${
                        !a.installed ? "bg-ink/[0.06] text-dim" : a.signedIn ? "bg-teal/15 text-teal-deep" : "bg-amber/15 text-amber-deep"
                      }`}
                    >
                      {!a.installed ? "Not installed" : a.signedIn ? "Signed in" : "Sign-in needed"}
                    </span>
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] text-dim">{a.signedIn ? a.account : a.authMethod}</div>
                  <p className="mt-2 text-[12px] leading-relaxed text-dim">{a.authNote}</p>
                  {!a.installed && (
                    <pre className="mt-2 inline-block rounded bg-ink px-3 py-1.5 font-mono text-[11px] text-paper">{a.installHint}</pre>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  {a.installed && !a.signedIn && (
                    <button onClick={() => setSigning(a)} className="btn-amber px-3 py-1.5 text-[12px]">
                      Sign in
                    </button>
                  )}
                  {a.signedIn && (
                    <button onClick={() => signOut(a.id)} className="btn-quiet px-3 py-1.5 text-[12px]">
                      Sign out
                    </button>
                  )}
                  {a.installed && a.signedIn && (
                    <button
                      onClick={() => setDefaultAgent(project.id, a.id)}
                      disabled={isDefault}
                      className="btn-quiet px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em]"
                    >
                      {isDefault ? `Default for ${project.name}` : `Make default for ${project.name}`}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        <div className="card-panel p-4 text-[12px] leading-relaxed text-dim">
          <span className="font-semibold text-ink">Claude Code</span> support is planned for a later release, pending a supported sign-in path. Manual API-key entry is never the default: if a provider has no OAuth or device flow, ADE explains that first and offers key entry as an optional last resort.
        </div>
      </div>
      {signing && <SignInDialog agent={signing} onClose={() => setSigning(null)} />}
    </main>
  );
}
