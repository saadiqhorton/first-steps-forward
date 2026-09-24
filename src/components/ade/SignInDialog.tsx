import { useEffect, useState } from "react";
import type { Agent } from "@/lib/ade/types";
import { useAde } from "@/lib/ade/store";

export function SignInDialog({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const { signIn } = useAde();
  const [phase, setPhase] = useState<"intro" | "code" | "waiting" | "done">("intro");
  const code = "HKQP-4M2Z";

  useEffect(() => {
    if (phase !== "waiting") return;
    const t = setTimeout(() => {
      signIn(agent.id, "jordan@willowandco.shop");
      setPhase("done");
    }, 2200);
    return () => clearTimeout(t);
  }, [phase, agent.id, signIn]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4" role="dialog" aria-modal aria-labelledby="signin-title">
      <div className="w-full max-w-md rounded-lg bg-panel p-6 ring-1 ring-ink/10 animate-rise">
        <div className="label-mono">Sign in</div>
        <h2 id="signin-title" className="mt-1 font-display text-3xl tracking-wide">
          {agent.name}
        </h2>

        {phase === "intro" && (
          <>
            <p className="mt-3 text-[13px] leading-relaxed">
              Method: <span className="font-medium">{agent.authMethod}</span>. {agent.authNote}
            </p>
            <p className="mt-2 text-[12px] leading-relaxed text-dim">
              What {agent.short} receives: your prompts, the files it reads in the selected project, and the account you sign in with. ADE itself sends nothing anywhere.
            </p>
            <div className="mt-5 flex gap-2">
              <button className="btn-amber px-4 py-2 text-[13px]" onClick={() => setPhase("code")} autoFocus>
                Continue in browser
              </button>
              <button className="btn-quiet px-4 py-2 text-[13px]" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}

        {phase === "code" && (
          <>
            <p className="mt-3 text-[13px] leading-relaxed">
              A browser tab has opened. Enter this code when asked, then come back here.
            </p>
            <div className="mt-4 rounded-md bg-ink px-4 py-4 text-center font-mono text-2xl tracking-[0.3em] text-paper">{code}</div>
            <div className="mt-5 flex gap-2">
              <button className="btn-amber px-4 py-2 text-[13px]" onClick={() => setPhase("waiting")}>
                I've entered the code
              </button>
              <button className="btn-quiet px-4 py-2 text-[13px]" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}

        {phase === "waiting" && (
          <p className="mt-4 flex items-center gap-2 text-[13px]">
            <span className="size-2 rounded-full bg-teal animate-pulse-soft" aria-hidden /> Waiting for {agent.short} to confirm…
          </p>
        )}

        {phase === "done" && (
          <>
            <p className="mt-3 text-[13px] leading-relaxed">
              Signed in as <span className="font-medium">jordan@willowandco.shop</span>. The token is stored in your system keychain, not in any project file.
            </p>
            <button className="btn-amber mt-5 px-4 py-2 text-[13px]" onClick={onClose} autoFocus>
              Done
            </button>
          </>
        )}
      </div>
    </div>
  );
}
