import { useMemo, useState } from "react";
import "@/components/ade/processes/processes.css";
import { Globe, Loader2, Play, Terminal } from "lucide-react";
import { requestPreviewOpen } from "@/lib/ade/browser/openInPreview.mjs";
import { requestProcessesOpen } from "@/lib/ade/openProcesses.mjs";
import { startProcess } from "@/lib/ade/processesApi";
import type { LocalProcess } from "@/lib/ade/types";
import { useAde, useAdeState } from "@/lib/ade/store";
import { warnUser } from "@/lib/ade/userNotices";

/** The command without its framework flags: `npm run dev`, `node --test --watch`. */
function shortCommand(command: string) {
  const words = command.trim().split(/\s+/);
  const separator = words.findIndex((word) => word === "--");
  const base = separator > 0 ? words.slice(0, separator) : words;
  return base.slice(0, 3).join(" ");
}

function tone(status: LocalProcess["status"]) {
  if (status === "running") return "bg-teal";
  if (status === "unverified") return "bg-amber";
  if (status === "failed") return "bg-danger";
  if (status === "starting" || status === "stopping") return "bg-amber";
  return "bg-dim";
}

/**
 * The process an agent left running, in the conversation that started it. The command
 * runs it again when it has exited; the address opens the site in ADE's browser.
 */
export function ConversationProcesses({ sessionId }: { sessionId: string }) {
  const allProcesses = useAdeState((state) => state.processes);
  const { refresh } = useAde();
  const [starting, setStarting] = useState<string | null>(null);
  const processes = useMemo(
    () => allProcesses.filter((proc) => proc.sessionId === sessionId),
    [allProcesses, sessionId],
  );

  if (!processes.length) return null;

  const run = async (proc: LocalProcess) => {
    if (proc.status === "running" || proc.status === "unverified") {
      requestProcessesOpen();
      return;
    }
    if (starting === proc.id) return;
    setStarting(proc.id);
    try {
      const started = await startProcess(proc.id);
      await refresh();
      if (started.status === "running" && started.port) {
        requestPreviewOpen(`http://127.0.0.1:${started.port}/`);
      }
    } catch (error) {
      void warnUser(error instanceof Error ? error.message : String(error), "Couldn't start it");
    } finally {
      setStarting(null);
    }
  };

  return (
    <div
      className="flex flex-wrap items-center gap-2 pt-1"
      aria-label="Processes from this conversation"
    >
      {processes.map((proc) => {
        const busy =
          starting === proc.id || proc.status === "starting" || proc.status === "stopping";
        const running = proc.status === "running";
        const live = running || proc.status === "unverified";
        const address = running && proc.port ? `http://127.0.0.1:${proc.port}/` : null;
        const command = shortCommand(proc.command);
        const label = busy
          ? `Starting ${proc.name}`
          : running
            ? `Open ${proc.name} in Processes`
            : proc.status === "unverified"
              ? `Check ${proc.name} in Processes`
              : `Run ${proc.command}`;
        return (
          <div key={proc.id} className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => void run(proc)}
              disabled={busy}
              title={label}
              aria-label={label}
              className="process-key inline-flex h-8 max-w-full items-center gap-2 pl-2 pr-3 text-[11.5px] text-ink disabled:opacity-60"
            >
              <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${tone(proc.status)}`} />
              {busy ? (
                <Loader2
                  className="size-3.5 shrink-0 animate-spin"
                  strokeWidth={1.75}
                  aria-hidden
                />
              ) : live ? (
                <Terminal className="size-3.5 shrink-0 text-dim" strokeWidth={1.75} aria-hidden />
              ) : (
                <Play className="size-3.5 shrink-0 text-dim" strokeWidth={1.75} aria-hidden />
              )}
              <span className="max-w-[18ch] truncate font-mono tracking-normal">{command}</span>
            </button>
            {address ? (
              <button
                type="button"
                onClick={() => requestPreviewOpen(address)}
                title={`Open ${address}`}
                aria-label={`Open ${address}`}
                className="inline-flex h-8 max-w-[24ch] items-center gap-2 rounded-lg px-1.5 font-mono text-[11.5px] text-dim transition-colors hover:bg-ink/[0.04] hover:text-ink"
              >
                <Globe className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
                <span className="truncate tracking-normal">
                  {address.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                </span>
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
