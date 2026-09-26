import { useEffect, useState } from "react";
import type { Agent } from "@/lib/ade/types";
import { useAde } from "@/lib/ade/store";

export function SignInDialog({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const { signIn, refresh } = useAde();
  const [output, setOutput] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (!started) return;
    const timer = window.setInterval(async () => {
      try {
        const status = await fetch(`/api/agents/${agent.id}/login`).then((r) => r.json());
        setOutput(status.output ?? "");
        setRunning(!!status.running);
        if (status.agent?.signedIn) {
          await refresh();
          setRunning(false);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [started, agent.id, refresh]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const begin = async () => {
    try {
      setStarted(true);
      setRunning(true);
      const result = await signIn(agent.id);
      setOutput(result.output ?? "");
      setRunning(!!result.running);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRunning(false);
    }
  };
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="signin-title"
    >
      <div className="w-full max-w-lg rounded-lg bg-panel p-6 ring-1 ring-ink/10 animate-rise">
        <div className="label-mono">Agent-owned authentication</div>
        <h2 id="signin-title" className="mt-1 font-display text-3xl tracking-wide">
          {agent.name}
        </h2>
        <p className="mt-3 text-[13px] leading-relaxed">{agent.authNote}</p>
        <p className="mt-2 text-[12px] leading-relaxed text-dim">
          ADE does not receive or store credentials. Provider/model usage may be billed by your
          provider.
        </p>
        {agent.id === "codex" ? (
          <>
            {output && (
              <pre className="mt-4 max-h-40 overflow-auto rounded bg-ink p-3 font-mono text-[11px] text-paper">
                {output}
              </pre>
            )}
            {running && (
              <p className="mt-3 text-[12px] text-teal">
                Waiting for Codex device sign-in… finish in the browser opened by Codex.
              </p>
            )}
          </>
        ) : (
          <div className="mt-4 rounded-md bg-amber/10 p-3 text-[12px] leading-relaxed">
            <p>
              {agent.id === "opencode"
                ? "OpenCode's provider selector requires an interactive terminal. ADE cannot safely fake or capture its OAuth login."
                : "Pi currently exposes sign-in through /login in its interactive TUI; it has no supported device-login command for ADE to launch."}
            </p>
            <p className="mt-2 font-mono">
              {agent.id === "opencode" ? "opencode auth login" : "pi  →  /login"}
            </p>
          </div>
        )}
        {error && <p className="mt-3 text-[12px] text-danger">{error}</p>}
        <div className="mt-5 flex gap-2">
          {agent.id === "codex" && !started && (
            <button className="btn-amber px-4 py-2 text-[13px]" onClick={begin}>
              Start device sign-in
            </button>
          )}
          <button className="btn-quiet ml-auto px-4 py-2 text-[13px]" onClick={onClose}>
            {agent.id === "codex" && running ? "Close (continues)" : "Done"}
          </button>
        </div>
      </div>
    </div>
  );
}
