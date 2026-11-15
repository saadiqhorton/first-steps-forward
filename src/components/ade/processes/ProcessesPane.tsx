import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDown,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Loader2,
  Search,
  Square,
  Terminal,
  WrapText,
} from "lucide-react";
import { requestPreviewOpen } from "@/lib/ade/browser/openInPreview.mjs";
import {
  acknowledgeProcess,
  stopAllProcesses,
  stopProcess,
  type ProcessRecord,
} from "@/lib/ade/processesApi";
import { processOutputQuery, processesQuery } from "@/lib/ade/queries";
import { useAdeState } from "@/lib/ade/store";
import { sessionTitle } from "@/lib/ade/sessionTitle";
import { askConfirm, warnUser } from "@/lib/ade/userNotices";

const STATUS: Record<ProcessRecord["status"], { label: string; dot: string; text: string }> = {
  running: { label: "Running", dot: "bg-teal", text: "text-teal" },
  starting: { label: "Starting…", dot: "bg-amber", text: "text-dim" },
  stopping: { label: "Stop requested…", dot: "bg-amber", text: "text-dim" },
  unverified: { label: "Needs checking", dot: "bg-amber", text: "text-amber-deep" },
  failed: { label: "Couldn't stop", dot: "bg-danger", text: "text-danger" },
  stopped: { label: "Stopped", dot: "bg-dim", text: "text-dim" },
};

function addressOf(proc: ProcessRecord) {
  return proc.address && proc.status !== "stopped" ? proc.address : null;
}

function Dot({ proc }: { proc: ProcessRecord }) {
  return (
    <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${STATUS[proc.status].dot}`} />
  );
}

/** The selected process's log, with a follow that pauses when you scroll back. */
function ProcessOutput({ proc, active }: { proc: ProcessRecord; active: boolean }) {
  const query = useQuery({ ...processOutputQuery(proc.id), enabled: active });
  const [wrap, setWrap] = useState(true);
  const [follow, setFollow] = useState(true);
  const ref = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    setFollow(true);
  }, [proc.id]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !follow) return;
    el.scrollTop = el.scrollHeight;
  }, [query.data, follow]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 12;
    if (!atBottom && follow) setFollow(false);
    else if (atBottom && !follow) setFollow(true);
  };

  const lines = query.data?.lines ?? [];

  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex items-center gap-2 pb-1.5">
        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-normal text-dim">
          <Terminal className="size-3.5" strokeWidth={1.75} aria-hidden />
          {follow ? "Following log" : "Scrolled back"}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {!follow ? (
            <button
              type="button"
              onClick={() => {
                setFollow(true);
                const el = ref.current;
                if (el) el.scrollTop = el.scrollHeight;
              }}
              className="inline-flex h-6 items-center gap-1 rounded-md border border-amber/45 bg-amber/[0.08] px-1.5 text-[11px] text-amber-deep transition-colors hover:bg-amber/[0.12]"
            >
              <ArrowDown className="size-3" strokeWidth={1.75} aria-hidden />
              Follow latest
            </button>
          ) : null}
          <button
            type="button"
            aria-pressed={wrap}
            onClick={() => setWrap((value) => !value)}
            className={`inline-flex h-6 items-center gap-1 rounded-md border px-1.5 text-[11px] transition-colors ${
              wrap
                ? "border-line bg-surface-muted text-ink"
                : "border-transparent text-dim hover:bg-ink/[0.04] hover:text-ink"
            }`}
          >
            <WrapText className="size-3" strokeWidth={1.75} aria-hidden />
            Wrap lines
          </button>
        </div>
      </div>
      <pre
        ref={ref}
        onScroll={onScroll}
        tabIndex={0}
        aria-label={`Output of ${proc.name}`}
        className={`h-[184px] overflow-auto rounded-lg bg-deck px-3 py-2 font-mono text-[11px] leading-[1.6] tracking-normal text-deck-foreground outline-none focus-visible:ring-2 focus-visible:ring-amber ${
          wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"
        }`}
      >
        {lines.length
          ? lines.map((line, index) => (
              <div
                key={line.n}
                className={index === lines.length - 1 ? "-ml-2 border-l-2 border-amber pl-2" : ""}
              >
                {line.text || " "}
              </div>
            ))
          : query.isPending
            ? "Loading output…"
            : "No output recorded yet"}
      </pre>
      <div className="flex justify-between gap-2 pt-1.5 font-mono text-[10.5px] tabular-nums text-dim">
        <span>{query.data?.total ?? 0} lines</span>
        {query.isError ? <span>Output is unavailable</span> : null}
      </div>
    </div>
  );
}

function ExpandedProcess({
  proc,
  active,
  onChanged,
}: {
  proc: ProcessRecord;
  active: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<"stop" | "ack" | null>(null);
  const [copied, setCopied] = useState(false);
  const address = addressOf(proc);
  const meta = STATUS[proc.status];

  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      void warnUser("ADE could not copy the address to the clipboard.");
    }
  };

  const stop = async () => {
    setBusy("stop");
    try {
      await stopProcess(proc.id);
      onChanged();
    } catch (error) {
      void warnUser(error instanceof Error ? error.message : String(error), "Couldn't stop");
    } finally {
      setBusy(null);
    }
  };

  const acknowledge = async () => {
    setBusy("ack");
    try {
      await acknowledgeProcess(proc.id);
      onChanged();
    } catch (error) {
      void warnUser(
        error instanceof Error ? error.message : String(error),
        "Couldn't mark it good",
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-2 border-t border-line/70 px-2 pb-2 pl-6 pt-2">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {address ? (
          <button
            type="button"
            onClick={copy}
            title="Copy address"
            className="inline-flex h-6 min-w-0 items-center gap-1.5 rounded-md border border-line bg-paper px-1.5 font-mono text-[11px] tracking-normal hover:border-amber"
          >
            <span className="truncate">
              {address.replace(/^https?:\/\//, "").replace(/\/$/, "")}
            </span>
            {copied ? (
              <Check className="size-3 shrink-0 text-teal" strokeWidth={1.75} aria-hidden />
            ) : (
              <Copy className="size-3 shrink-0 text-dim" strokeWidth={1.75} aria-hidden />
            )}
          </button>
        ) : (
          <span className="font-mono text-[11px] text-dim">No website</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            disabled={!address || proc.status !== "running"}
            onClick={() => address && requestPreviewOpen(address)}
            className="btn-quiet inline-flex h-6 items-center gap-1 px-2 text-[11px] disabled:opacity-50"
          >
            Open
            <ExternalLink className="size-3" strokeWidth={1.75} aria-hidden />
          </button>
          <button
            type="button"
            onClick={stop}
            disabled={busy === "stop" || proc.status === "stopping"}
            className="btn-quiet inline-flex h-6 items-center gap-1 px-2 text-[11px] disabled:opacity-60"
          >
            {busy === "stop" || proc.status === "stopping" ? (
              <Loader2 className="size-3 animate-spin" strokeWidth={1.75} aria-hidden />
            ) : (
              <Square className="size-3" strokeWidth={1.75} aria-hidden />
            )}
            {proc.status === "stopping"
              ? "Stopping…"
              : proc.status === "failed"
                ? "Retry stop"
                : "Stop"}
          </button>
        </div>
      </div>

      {proc.status === "unverified" ? (
        <div className="flex items-center justify-between gap-2 rounded-md border-l-2 border-amber bg-surface-muted px-2 py-1.5 text-[11px] text-dim">
          <span>ADE can't confirm this is still running</span>
          <button
            type="button"
            onClick={acknowledge}
            disabled={busy === "ack"}
            className="shrink-0 text-[11px] font-medium text-ink hover:text-amber-deep"
          >
            Mark as good
          </button>
        </div>
      ) : null}

      {proc.status === "failed" ? (
        <div className="flex items-start gap-1.5 rounded-md border-l-2 border-danger bg-surface-muted px-2 py-1.5 text-[11px] text-danger">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" strokeWidth={1.75} aria-hidden />
          <span>{proc.stopError ?? "ADE could not stop this process"}</span>
        </div>
      ) : null}

      <div className="flex min-w-0 items-center gap-1.5 font-mono text-[10.5px] text-dim">
        <span className={meta.text}>{meta.label}</span>
        <span aria-hidden>·</span>
        <span className="truncate">{proc.command}</span>
        <span aria-hidden>·</span>
        <span>{proc.cwd === "." ? "project root" : proc.cwd}</span>
      </div>

      <ProcessOutput proc={proc} active={active} />
    </div>
  );
}

/**
 * Processes in the right pane: the conversation that started each one, its log,
 * and the controls to open or stop it, without leaving the conversation.
 */
export function ProcessesPane({
  projectId,
  active = true,
}: {
  projectId: string;
  active?: boolean;
}) {
  const sessions = useAdeState((state) => state.sessions);
  const query = useQuery({ ...processesQuery(projectId), enabled: active });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const autoSelected = useRef(false);
  const [search, setSearch] = useState("");
  const [stoppingAll, setStoppingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const processes = useMemo(
    () => (query.data?.processes ?? []).filter((proc) => proc.status !== "stopped"),
    [query.data],
  );
  const checks = processes.filter((proc) => proc.status === "unverified").length;
  const groups = useMemo(() => {
    const term = search.trim().toLowerCase();
    const shown = processes.filter((proc) => {
      if (!term) return true;
      return [proc.name, proc.command, proc.address ?? ""].join(" ").toLowerCase().includes(term);
    });
    const bySession = new Map<string, ProcessRecord[]>();
    for (const proc of shown) {
      const key = proc.sessionId ?? "";
      bySession.set(key, [...(bySession.get(key) ?? []), proc]);
    }
    return [...bySession.entries()]
      .map(([sessionId, items]) => ({
        sessionId,
        items: [...items].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0)),
      }))
      .sort(
        (a, b) =>
          Math.max(...b.items.map((item) => item.startedAt ?? 0)) -
          Math.max(...a.items.map((item) => item.startedAt ?? 0)),
      );
  }, [processes, search]);

  useEffect(() => {
    if (autoSelected.current || !processes.length) return;
    autoSelected.current = true;
    setSelectedId(processes[0]!.id);
  }, [processes]);

  useEffect(() => {
    if (selectedId && !processes.some((proc) => proc.id === selectedId)) setSelectedId(null);
  }, [processes, selectedId]);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(timer);
  }, [error]);

  const refresh = () => void query.refetch();

  const markAllGood = async () => {
    try {
      await Promise.all(
        processes
          .filter((proc) => proc.status === "unverified")
          .map((proc) => acknowledgeProcess(proc.id)),
      );
      refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const stopAll = async () => {
    if (!processes.length) return;
    const confirmed = await askConfirm({
      title: "Stop all processes?",
      description: `${processes.length} ${
        processes.length === 1 ? "process" : "processes"
      } will stop: ${processes.map((proc) => proc.name).join(", ")}. The conversations that started them keep running.`,
      confirmLabel: `Stop ${processes.length} ${processes.length === 1 ? "process" : "processes"}`,
      cancelLabel: "Cancel",
    });
    if (!confirmed) return;
    setStoppingAll(true);
    try {
      const result = await stopAllProcesses(projectId);
      refresh();
      if (result.failed.length) {
        setError(
          `${result.failed.length} ${result.failed.length === 1 ? "process" : "processes"} could not stop: ${result.failed.map((item) => item.name).join(", ")}`,
        );
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setStoppingAll(false);
    }
  };

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-panel">
      <div className="shrink-0 px-3 pb-2 pt-3">
        <label className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-paper px-2 text-dim focus-within:border-amber">
          <Search className="size-3.5" strokeWidth={1.75} aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search"
            aria-label="Search processes"
            className="min-w-0 flex-1 bg-transparent py-1.5 text-[12px] tracking-normal text-ink outline-none placeholder:text-dim"
          />
        </label>
      </div>

      {checks > 0 ? (
        <div className="mx-2 mb-1 flex items-center gap-2 border-b border-line px-1.5 pb-2 text-[11.5px] text-dim">
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-amber" />
          <span>
            {checks === 1 ? "1 process needs checking" : `${checks} processes need checking`}
          </span>
          <button
            type="button"
            onClick={markAllGood}
            className="ml-auto shrink-0 text-[11px] text-ink transition-colors hover:text-amber-deep"
          >
            Mark all as good
          </button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {query.isPending ? (
          <p className="px-2 py-3 text-[12px] text-dim">Loading processes…</p>
        ) : query.isError ? (
          <p className="px-2 py-3 text-[12px] text-danger">
            {query.error instanceof Error ? query.error.message : "Processes are unavailable"}
          </p>
        ) : !processes.length ? (
          <div className="grid justify-items-center gap-2 px-4 py-10 text-center text-dim">
            <span className="grid size-9 place-items-center rounded-lg border border-line bg-paper">
              <Terminal className="size-4" strokeWidth={1.75} aria-hidden />
            </span>
            <h2 className="font-display text-[14px] font-medium text-ink">Nothing running yet</h2>
            <p className="max-w-[28ch] text-[12px] leading-relaxed">
              When an agent starts a server or a watcher, it appears here with its output and a Stop
              button.
            </p>
          </div>
        ) : !groups.length ? (
          <p className="px-2 py-3 text-[12px] text-dim">No processes match “{search}”</p>
        ) : (
          groups.map((group, groupIndex) => {
            const conversation = sessions.find((session) => session.id === group.sessionId);
            return (
              <section
                key={group.sessionId || "outside"}
                aria-label="Processes by conversation"
                className={groupIndex > 0 ? "mt-2 border-t border-line/70 pt-2" : ""}
              >
                <div className="flex min-w-0 items-baseline gap-2 px-2 pb-1 pt-2 text-[11.5px] text-dim">
                  <span className="min-w-0 truncate font-medium">
                    {conversation
                      ? sessionTitle(conversation.displayRequest ?? conversation.request)
                      : "Started outside a conversation"}
                  </span>
                  <span className="ml-auto shrink-0 font-mono text-[10.5px] capitalize tracking-normal">
                    {conversation ? conversation.agentId : "ADE"}
                  </span>
                </div>
                {group.items.map((proc) => {
                  const expanded = proc.id === selectedId;
                  const address = addressOf(proc);
                  return (
                    <div
                      key={proc.id}
                      className={`rounded-lg transition-colors ${expanded ? "bg-ink/[0.04]" : "hover:bg-ink/[0.03]"}`}
                    >
                      <div className="flex min-h-12 items-stretch">
                        <button
                          type="button"
                          onClick={() => setSelectedId(expanded ? null : proc.id)}
                          aria-expanded={expanded}
                          className="flex min-w-0 flex-1 items-start gap-2 rounded-lg px-2 py-2 text-left"
                        >
                          <span className="grid h-5 shrink-0 place-items-center">
                            <Dot proc={proc} />
                          </span>
                          <span className="grid min-w-0 flex-1 gap-0.5">
                            <span className="truncate text-[12.5px] font-medium leading-[18px] tracking-normal">
                              {proc.name}
                            </span>
                            <span className="flex min-w-0 items-center justify-between gap-2 font-mono text-[10.5px] leading-4 tracking-normal text-dim">
                              <span className="truncate">
                                {address
                                  ? address.replace(/^https?:\/\//, "").replace(/\/$/, "")
                                  : "No website"}
                              </span>
                              {proc.status !== "running" ? (
                                <span
                                  className={`shrink-0 text-[10.5px] ${STATUS[proc.status].text}`}
                                >
                                  {STATUS[proc.status].label}
                                </span>
                              ) : null}
                            </span>
                          </span>
                          <ChevronRight
                            className={`mt-0.5 size-3.5 shrink-0 text-dim transition-transform ${
                              expanded ? "rotate-90" : ""
                            }`}
                            strokeWidth={1.75}
                            aria-hidden
                          />
                        </button>
                        {address && proc.status === "running" ? (
                          <button
                            type="button"
                            onClick={() => requestPreviewOpen(address)}
                            aria-label={`Open ${address}`}
                            title={`Open ${address}`}
                            className="my-auto mr-1 grid size-7 shrink-0 place-items-center rounded-md text-dim transition-colors hover:bg-ink/[0.06] hover:text-ink"
                          >
                            <ExternalLink className="size-3.5" strokeWidth={1.75} aria-hidden />
                          </button>
                        ) : null}
                      </div>
                      {expanded ? (
                        <ExpandedProcess proc={proc} active={active} onChanged={refresh} />
                      ) : null}
                    </div>
                  );
                })}
              </section>
            );
          })
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-line px-3 py-2">
        <span className="font-mono text-[10.5px] tabular-nums text-dim">
          {processes.length} in this project
        </span>
        <button
          type="button"
          onClick={stopAll}
          disabled={!processes.length || stoppingAll}
          className="text-[11px] text-dim transition-colors hover:text-ink disabled:opacity-50"
        >
          {stoppingAll ? "Stopping…" : "Stop all"}
        </button>
      </div>

      {error ? (
        <div
          role="status"
          className="pointer-events-none absolute bottom-10 left-2 right-2 z-20 flex items-center gap-1.5 rounded-md border border-danger/40 bg-surface-raised px-2 py-1.5 text-[11px] text-danger shadow-lg"
        >
          <AlertTriangle className="size-3 shrink-0" strokeWidth={1.75} aria-hidden />
          {error}
        </div>
      ) : null}
    </div>
  );
}
