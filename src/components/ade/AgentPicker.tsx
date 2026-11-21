import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Check, RefreshCw, Search } from "lucide-react";
import { REASON_TEXT } from "@/components/ade/ModelPicker";
import { SignInDialog } from "@/components/ade/SignInDialog";
import { HarnessDialog } from "@/components/ade/HarnessDialog";
import { AgentLogo } from "@/components/ade/AgentLogo";
import { AgentPresets } from "@/components/ade/AgentPresets";
import { agentModels, optionCapabilities, useAdeState } from "@/lib/ade/store";
import { readLastModel, resolveModelForAgent, writeLastModel } from "@/lib/ade/lastModels";
import { request } from "@/lib/ade/api";
import type {
  Agent,
  AgentId,
  AgentModelsResult,
  OptionCapabilities,
  Permission,
} from "@/lib/ade/types";

const CLOSE_AFTER_KEY = "ade-picker-close-after";
const OTHER = "__other__";
const COLUMNS = ["agent", "model", "effort", "speed", "permission"] as const;
type Column = (typeof COLUMNS)[number];

export interface AgentSelection {
  agentId: AgentId;
  model: string;
  effort: string;
  speed: string;
  permission: Permission;
}

function readCloseAfter(): boolean {
  try {
    return window.localStorage.getItem(CLOSE_AFTER_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCloseAfter(value: boolean) {
  try {
    window.localStorage.setItem(CLOSE_AFTER_KEY, value ? "1" : "0");
  } catch {
    /* ignore quota / private mode */
  }
}

function agentStatus(agent: Agent): {
  kind: "ready" | "signin" | "install" | "update" | "other-update";
  label: string;
} {
  if (!agent.installed || agent.installMethod === "missing") {
    return { kind: "install", label: "Install" };
  }
  if (
    agent.updateAvailable &&
    (agent.installMethod === "npm" ||
      agent.installMethod === "brew" ||
      agent.installMethod === "mise")
  ) {
    return {
      kind: "update",
      label: agent.latestVersion ? `Update to ${agent.latestVersion}` : "Update",
    };
  }
  if (agent.updateAvailable && agent.installMethod === "other") {
    return {
      kind: "other-update",
      label: `Update${agent.latestVersion ? ` ${agent.latestVersion}` : ""} available · managed outside npm`,
    };
  }
  if (!agent.signedIn) {
    return { kind: "signin", label: agent.id === "opencode" ? "Sign in (optional)" : "Sign in" };
  }
  return { kind: "ready", label: "Ready" };
}

/** Chip label for the composer agent button. */
export function agentChipLabel(
  sel: AgentSelection,
  agents: Agent[],
): { title: string; subtitle: string } {
  const agent = agents.find((a) => a.id === sel.agentId);
  const title = agent?.name ?? sel.agentId;
  const modelPart = sel.model.trim() || "Default model";
  const effortPart = sel.effort.trim() || "Default";
  return { title, subtitle: `${modelPart} · ${effortPart}` };
}

function RowButton({
  selected,
  disabled,
  title,
  onClick,
  onFocus,
  children,
  rowRef,
}: {
  selected: boolean;
  disabled?: boolean;
  title?: string | undefined;
  onClick: () => void;
  onFocus?: () => void;
  children: React.ReactNode;
  rowRef?: (el: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      type="button"
      ref={rowRef}
      {...(title ? { title } : {})}
      disabled={disabled}
      aria-pressed={selected}
      onClick={onClick}
      onFocus={onFocus}
      className={`flex w-full items-start gap-2 rounded-lg px-2 py-[5px] text-left text-ui leading-snug ${
        selected ? "bg-amber/10" : "hover:bg-ink/5"
      } ${disabled ? "cursor-not-allowed text-dim opacity-60" : ""}`}
    >
      <span className="min-w-0 flex-1">{children}</span>
      {selected && <Check className="mt-0.5 size-3.5 shrink-0 text-amber-deep" aria-hidden />}
    </button>
  );
}

/**
 * Multi-column agent / model / effort / speed / permission picker. Parent
 * owns selection state; this panel calls onChange / onClose.
 */
export function AgentPicker({
  value,
  onChange,
  onClose,
  agentLocked,
}: {
  value: AgentSelection;
  onChange: (next: AgentSelection) => void;
  onClose: () => void;
  agentLocked?: string;
}) {
  const agents = useAdeState((state) => state.agents);
  const agentVersion = agents.find((agent) => agent.id === value.agentId)?.version;
  const panelRef = useRef<HTMLDivElement>(null);
  // Tagged with its agent: right after a switch, the previous agent's list
  // must never be read as the new agent's.
  const [loaded, setLoaded] = useState<{
    agentId: AgentId;
    version: string | undefined;
    result: AgentModelsResult;
  } | null>(null);
  const models =
    loaded?.agentId === value.agentId && loaded.version === agentVersion ? loaded.result : null;
  const modelsLoading = !models;
  const [caps, setCaps] = useState<OptionCapabilities | null>(null);
  const [showOther, setShowOther] = useState(false);
  const [otherText, setOtherText] = useState("");
  const [modelQuery, setModelQuery] = useState("");
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateError, setUpdateError] = useState("");
  const [closeAfter, setCloseAfter] = useState(readCloseAfter);
  const [focusCol, setFocusCol] = useState<Column>("agent");
  const [focusRow, setFocusRow] = useState(0);
  const [signing, setSigning] = useState<Agent | null>(null);
  const [harness, setHarness] = useState<{ agentId: AgentId; kind: "install" | "update" } | null>(
    null,
  );
  const otherId = useId();
  const rowRefs = useRef<Partial<Record<Column, (HTMLButtonElement | null)[]>>>({});

  useEffect(() => {
    let cancelled = false;
    const agentId = value.agentId;
    const version = agentVersion;
    setShowOther(false);
    setOtherText("");
    setModelQuery("");
    agentModels(agentId)
      .then((result) => !cancelled && setLoaded({ agentId, version, result }))
      .catch(
        (e) =>
          !cancelled &&
          setLoaded({
            agentId,
            version,
            result: {
              available: false,
              reason: "cli-failed",
              hint: e instanceof Error ? e.message : String(e),
            },
          }),
      );
    return () => {
      cancelled = true;
    };
  }, [value.agentId, agentVersion]);

  useEffect(() => {
    let cancelled = false;
    setCaps(null);
    optionCapabilities(value.agentId, value.model || undefined)
      .then((c) => !cancelled && setCaps(c))
      .catch(() => !cancelled && setCaps(null));
    return () => {
      cancelled = true;
    };
  }, [value.agentId, value.model, agentVersion]);

  useEffect(() => {
    if (!models?.available) {
      setOtherText(value.model);
      return;
    }
    if (!value.model) return;
    const ids = (models.models ?? []).map((m) => m.id);
    if (ids.includes(value.model)) return;
    if (models.completeCatalog) {
      // The agent's own list is all it accepts: an id outside it (say, one
      // remembered from another agent) would only fail the turn.
      const resolved = resolveModelForAgent(value.agentId, ids, "", true);
      if (resolved !== value.model) onChange({ ...value, model: resolved, effort: "", speed: "" });
      return;
    }
    setShowOther(true);
    setOtherText(value.model);
  }, [models, onChange, value]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || signing || harness) return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, signing, harness]);

  const listedModels = useMemo(() => models?.models ?? [], [models]);
  const modelRows = useMemo(() => {
    const rows: { id: string; label: string }[] = [{ id: "", label: "Default (recommended)" }];
    for (const m of listedModels) {
      rows.push({
        id: m.id,
        label: m.label || m.id,
      });
    }
    // A complete catalog is all the agent accepts; free-form ids would only fail the turn.
    if (!models?.completeCatalog) rows.push({ id: OTHER, label: "Other model id…" });
    return rows;
  }, [listedModels, models?.completeCatalog]);

  const filteredModelRows = useMemo(() => {
    const q = modelQuery.trim().toLowerCase();
    if (!q) return modelRows;
    const matched = modelRows.filter(
      (row) =>
        row.id !== OTHER &&
        (row.id.toLowerCase().includes(q) || row.label.toLowerCase().includes(q)),
    );
    const other = modelRows.find((row) => row.id === OTHER);
    return other ? [...matched, other] : matched;
  }, [modelRows, modelQuery]);

  const effortRows = useMemo(() => {
    const efforts = caps?.efforts ?? [];
    return [
      {
        id: "",
        label: "Model default",
        disabled: false,
        note: caps?.effortNote ?? "",
      },
      ...efforts.map((id) => ({
        id,
        label: id === "xhigh" ? "Extra high" : id.charAt(0).toUpperCase() + id.slice(1),
        disabled: false,
        note: "",
      })),
    ];
  }, [caps]);

  const speedRows = useMemo(() => {
    const speeds = caps?.speeds ?? [];
    return [
      {
        id: "",
        label: "Standard",
        disabled: false,
        note: caps?.speedNote ?? "",
      },
      ...speeds.map((id) => ({
        id,
        label: id.charAt(0).toUpperCase() + id.slice(1),
        disabled: false,
        note: "",
      })),
    ];
  }, [caps]);

  const permissionRows = useMemo(() => {
    const permissions = caps?.permissions ?? (["build", "plan"] as Permission[]);
    return permissions.map((id) => ({
      id,
      label:
        caps?.permissionLabels?.[id] ??
        (
          {
            build: "Build",
            plan: "Plan",
            manual: "Manual",
            auto: "Auto",
            deny: "Deny",
            approve: "Approve for me",
            full: "Full access",
            "dont-ask": "Don't ask",
            bypass: "Bypass permissions",
          } as const
        )[id],
      disabled: false,
    }));
  }, [caps]);

  const selectAgent = (agentId: AgentId) => {
    if (agentLocked) return;
    if (agentId === value.agentId) return;
    onChange({
      agentId,
      model: readLastModel(agentId) ?? "",
      effort: "",
      speed: "",
      permission: "build",
    });
    if (closeAfter) onClose();
  };

  const selectModel = (model: string) => {
    if (model === OTHER) {
      setShowOther(true);
      const next = otherText.trim();
      if (next) writeLastModel(value.agentId, next);
      onChange({
        ...value,
        model: next,
        effort: "",
        speed: "",
      });
      return;
    }
    writeLastModel(value.agentId, model);
    setShowOther(false);
    onChange({ ...value, model, effort: "", speed: "" });
    if (closeAfter) onClose();
  };

  const selectEffort = (effort: string) => {
    onChange({ ...value, effort });
    if (closeAfter) onClose();
  };

  const selectSpeed = (speed: string) => {
    onChange({ ...value, speed });
    if (closeAfter) onClose();
  };

  const selectPermission = (permission: Permission) => {
    onChange({ ...value, permission });
    if (closeAfter) onClose();
  };

  const columnItems = (col: Column): string[] => {
    if (col === "agent") return agents.map((a) => a.id);
    if (col === "model") return filteredModelRows.map((r) => r.id);
    if (col === "effort") return effortRows.map((r) => r.id);
    if (col === "speed") return speedRows.map((r) => r.id);
    return permissionRows.map((r) => r.id);
  };

  const activate = (col: Column, id: string) => {
    if (col === "agent") selectAgent(id as AgentId);
    else if (col === "model") selectModel(id);
    else if (col === "effort") selectEffort(id);
    else if (col === "speed") selectSpeed(id);
    else selectPermission(id as Permission);
  };

  const rowDisabled = (col: Column, index: number) => {
    if (col === "agent") return !!agentLocked;
    if (col === "effort") return !!effortRows[index]?.disabled;
    if (col === "speed") return !!speedRows[index]?.disabled;
    return false;
  };

  const onPanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (!rowRefs.current[focusCol]?.includes(target as HTMLButtonElement)) return;
    if (event.key === "Enter" || event.key === " ") {
      const items = columnItems(focusCol);
      const id = items[focusRow];
      if (id === undefined || rowDisabled(focusCol, focusRow)) return;
      event.preventDefault();
      activate(focusCol, id);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = columnItems(focusCol);
    if (!items.length) return;
    const step = event.key === "ArrowDown" ? 1 : -1;
    let nextIdx = focusRow;
    for (let attempt = 1; attempt <= items.length; attempt++) {
      const candidate = focusRow + step * attempt;
      if (candidate < 0 || candidate >= items.length) break;
      if (focusCol === "effort" && effortRows[candidate]?.disabled) continue;
      if (focusCol === "speed" && speedRows[candidate]?.disabled) continue;
      nextIdx = candidate;
      break;
    }
    if (nextIdx === focusRow) return;
    setFocusRow(nextIdx);
    queueMicrotask(() => rowRefs.current[focusCol]?.[nextIdx]?.focus());
  };

  const setRowRef = (col: Column, index: number) => (el: HTMLButtonElement | null) => {
    if (!rowRefs.current[col]) rowRefs.current[col] = [];
    rowRefs.current[col]![index] = el;
  };

  const note = caps?.permissionNotes?.[value.permission] ?? "";
  const modelManual =
    showOther || (!!value.model && !listedModels.some((m) => m.id === value.model));
  const pickerGrid =
    "grid min-w-[720px] grid-cols-[minmax(10rem,1.3fr)_minmax(14rem,1.3fr)_minmax(7rem,.7fr)_minmax(6rem,.7fr)_minmax(8rem,1fr)] gap-px bg-line";

  return (
    <>
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Agent picker"
        tabIndex={-1}
        onKeyDown={onPanelKeyDown}
        className="card-panel w-[min(1080px,100%)] overflow-x-auto shadow-lg outline-none"
      >
        <div className={`${pickerGrid} border-b border-line`}>
          {(["Agent", "Model", "Effort", "Speed", "Permissions"] as const).map((heading, i) => (
            <div key={heading} className="bg-panel px-3 py-2">
              <div className="label-mono">{heading}</div>
              {COLUMNS[i] === focusCol ? <span className="sr-only">Focused column</span> : null}
            </div>
          ))}
        </div>

        <div className={`${pickerGrid} max-h-[min(24rem,calc(100vh-7rem))] overflow-hidden`}>
          {/* Agent */}
          <div
            className="min-h-0 overflow-y-auto bg-panel p-1.5"
            onFocusCapture={() => setFocusCol("agent")}
          >
            {agentLocked && (
              <p className="mb-1 rounded-lg bg-amber/10 px-2 py-1.5 text-caption leading-snug">
                {agentLocked}
              </p>
            )}
            {agents.map((agent, i) => {
              const status = agentStatus(agent);
              const selected = value.agentId === agent.id;
              const locked = !!agentLocked;
              return (
                <div
                  key={agent.id}
                  className={`mb-0.5 rounded-lg px-2 py-1.5 text-ui leading-snug ${
                    selected ? "bg-amber/10" : "hover:bg-ink/5"
                  } ${locked ? "opacity-60" : ""}`}
                >
                  <button
                    type="button"
                    ref={setRowRef("agent", i)}
                    disabled={locked}
                    aria-pressed={selected}
                    onFocus={() => {
                      setFocusCol("agent");
                      setFocusRow(i);
                    }}
                    onClick={() => selectAgent(agent.id)}
                    className={`flex w-full items-start gap-2 text-left ${
                      locked ? "cursor-not-allowed" : ""
                    }`}
                  >
                    <AgentLogo agent={agent} />
                    <span className="min-w-0 flex-1 font-medium">{agent.name}</span>
                    {agent.version && <span className="text-2xs text-dim">{agent.version}</span>}
                    {selected && (
                      <Check className="size-3.5 shrink-0 text-amber-deep" aria-hidden />
                    )}
                  </button>
                  {status.kind !== "ready" && (
                    <div className="ml-[22px] mt-0.5 font-mono text-2xs text-dim">
                      {status.kind === "signin" ? (
                        <button
                          type="button"
                          className="text-teal underline"
                          onClick={() => setSigning(agent)}
                        >
                          {status.label}
                        </button>
                      ) : status.kind === "install" ? (
                        <button
                          type="button"
                          className="text-teal underline"
                          onClick={() => setHarness({ agentId: agent.id, kind: "install" })}
                        >
                          {status.label}
                        </button>
                      ) : status.kind === "update" ? (
                        <button
                          type="button"
                          className="text-teal underline"
                          onClick={() => setHarness({ agentId: agent.id, kind: "update" })}
                        >
                          {status.label}
                        </button>
                      ) : (
                        status.label
                      )}
                      {agent.installed && !agent.signedIn && status.kind !== "signin" && (
                        <button
                          type="button"
                          className="ml-2 text-teal underline"
                          onClick={() => setSigning(agent)}
                        >
                          Sign in
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Model */}
          <div
            className="flex min-h-0 flex-col bg-panel"
            onFocusCapture={() => setFocusCol("model")}
          >
            {modelsLoading ? (
              <p className="px-3 py-2 font-mono text-caption text-dim">Reading model list…</p>
            ) : models?.available ? (
              <>
                <div className="shrink-0 border-b border-line p-1.5">
                  <label className="relative block">
                    <span className="sr-only">Search models</span>
                    <Search
                      className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-dim"
                      aria-hidden
                    />
                    <input
                      type="search"
                      value={modelQuery}
                      onChange={(e) => setModelQuery(e.target.value)}
                      placeholder="Search models"
                      className="w-full rounded-lg border border-line bg-paper py-1.5 pr-2 pl-8 font-mono text-caption placeholder:text-dim/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber/50"
                    />
                  </label>
                </div>
                <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-1.5">
                  {filteredModelRows.filter((row) => row.id !== OTHER).length === 0 &&
                  modelQuery.trim() ? (
                    <p className="px-2 py-1.5 font-mono text-caption text-dim">No models match.</p>
                  ) : null}
                  {filteredModelRows.map((row, i) => (
                    <RowButton
                      key={row.id || "default"}
                      selected={
                        row.id === OTHER ? modelManual : !modelManual && value.model === row.id
                      }
                      title={row.id && row.id !== OTHER ? row.id : undefined}
                      rowRef={setRowRef("model", i)}
                      onFocus={() => {
                        setFocusCol("model");
                        setFocusRow(i);
                      }}
                      onClick={() => selectModel(row.id)}
                    >
                      <span className="[overflow-wrap:anywhere]">{row.label}</span>
                    </RowButton>
                  ))}
                  {modelManual && (
                    <input
                      id={otherId}
                      aria-label="Custom model ID"
                      value={otherText}
                      onChange={(e) => {
                        const next = e.target.value;
                        setOtherText(next);
                        const trimmed = next.trim();
                        if (trimmed) writeLastModel(value.agentId, trimmed);
                        onChange({
                          ...value,
                          model: trimmed,
                          effort: "",
                          speed: "",
                        });
                      }}
                      maxLength={256}
                      placeholder="e.g. provider/model-id"
                      className="mt-1 w-full rounded-lg border border-line bg-paper px-2 py-1.5 font-mono text-caption placeholder:text-dim/70"
                    />
                  )}
                  {models.source === "bundled" && (
                    <p className="mt-1 px-2 font-mono text-2xs text-dim">
                      Offline bundled catalog — may omit newer models.
                    </p>
                  )}
                  {models.completeCatalog && (
                    <p className="mt-1 px-2 font-mono text-2xs text-dim">
                      The models this agent reports offering.
                    </p>
                  )}
                </div>
              </>
            ) : (
              <div className="overflow-y-auto p-1.5">
                <input
                  id={otherId}
                  aria-label="Custom model ID"
                  value={otherText}
                  onChange={(e) => {
                    const next = e.target.value;
                    setOtherText(next);
                    const trimmed = next.trim();
                    if (trimmed) writeLastModel(value.agentId, trimmed);
                    onChange({
                      ...value,
                      model: trimmed,
                      effort: "",
                      speed: "",
                    });
                  }}
                  maxLength={256}
                  placeholder="e.g. provider/model-id"
                  className="w-full rounded-lg border border-line bg-paper px-2 py-1.5 font-mono text-caption placeholder:text-dim/70"
                />
                <p className="mt-2 rounded-lg bg-amber/10 px-2 py-1.5 text-caption leading-relaxed">
                  <span className="font-medium">
                    {REASON_TEXT[models?.reason ?? ""] ?? "Model listing is unavailable."}
                  </span>{" "}
                  {models?.hint ??
                    "You can enter a model id manually; availability depends on your account."}
                </p>
              </div>
            )}
          </div>

          {/* Effort */}
          <div
            className="min-h-0 overflow-y-auto bg-panel p-1.5"
            onFocusCapture={() => setFocusCol("effort")}
          >
            {effortRows.map((row, i) => (
              <RowButton
                key={row.id || "default"}
                selected={value.effort === row.id}
                disabled={row.disabled}
                title={row.disabled ? row.note || caps?.effortNote || undefined : undefined}
                rowRef={setRowRef("effort", i)}
                onFocus={() => {
                  setFocusCol("effort");
                  setFocusRow(i);
                }}
                onClick={() => {
                  if (!row.disabled) selectEffort(row.id);
                }}
              >
                {row.label}
              </RowButton>
            ))}
            {caps?.effortNote ? (
              <p className="mt-1 px-2 font-mono text-2xs leading-snug text-dim">
                {caps.effortNote}
              </p>
            ) : null}
          </div>

          {/* Speed */}
          <div
            className="min-h-0 overflow-y-auto bg-panel p-1.5"
            onFocusCapture={() => setFocusCol("speed")}
          >
            {speedRows.map((row, i) => (
              <RowButton
                key={row.id || "default"}
                selected={value.speed === row.id}
                disabled={row.disabled}
                title={row.disabled ? row.note || caps?.speedNote || undefined : undefined}
                rowRef={setRowRef("speed", i)}
                onFocus={() => {
                  setFocusCol("speed");
                  setFocusRow(i);
                }}
                onClick={() => {
                  if (!row.disabled) selectSpeed(row.id);
                }}
              >
                {row.label}
              </RowButton>
            ))}
            {caps?.speedNote ? (
              <p className="mt-1 px-2 font-mono text-2xs leading-snug text-dim">{caps.speedNote}</p>
            ) : null}
          </div>

          {/* Permissions */}
          <div
            className="min-h-0 overflow-y-auto bg-panel p-1.5"
            onFocusCapture={() => setFocusCol("permission")}
          >
            {permissionRows.map((row, i) => (
              <RowButton
                key={row.id}
                selected={value.permission === row.id}
                disabled={row.disabled}
                rowRef={setRowRef("permission", i)}
                onFocus={() => {
                  setFocusCol("permission");
                  setFocusRow(i);
                }}
                onClick={() => selectPermission(row.id)}
              >
                {row.label}
              </RowButton>
            ))}
          </div>
        </div>

        <AgentPresets
          value={value}
          agents={agents}
          {...(agentLocked ? { agentLocked } : {})}
          onApply={(selection) => {
            writeLastModel(selection.agentId, selection.model);
            setShowOther(false);
            onChange(selection);
            if (closeAfter) onClose();
          }}
        />
        <div className="flex min-w-[720px] items-start gap-4 border-t border-line px-3 py-2.5">
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-dim">{updateError || note}</p>
          <button
            type="button"
            disabled={checkingUpdates}
            onClick={() => {
              setCheckingUpdates(true);
              setUpdateError("");
              void request<{ failed: string[] }>("/api/agents/check-updates", "POST")
                .then((result) => {
                  if (result.failed.length)
                    setUpdateError(
                      `Could not check updates for ${result.failed.join(", ")}. Try again.`,
                    );
                })
                .catch((error) =>
                  setUpdateError(error instanceof Error ? error.message : String(error)),
                )
                .finally(() => setCheckingUpdates(false));
            }}
            className="flex shrink-0 items-center gap-1 text-(length:--text-xs) text-dim hover:text-ink disabled:opacity-50"
          >
            <RefreshCw className={`size-3 ${checkingUpdates ? "animate-spin" : ""}`} aria-hidden />
            {checkingUpdates ? "Checking…" : "Check for updates"}
          </button>
          <label className="flex shrink-0 items-center gap-2 text-(length:--text-xs) text-dim">
            <input
              type="checkbox"
              checked={closeAfter}
              onChange={(e) => {
                const next = e.target.checked;
                setCloseAfter(next);
                writeCloseAfter(next);
              }}
              className="size-3.5 accent-[var(--amber)]"
            />
            Close after selection
          </label>
        </div>
      </div>

      {signing && <SignInDialog agent={signing} onClose={() => setSigning(null)} />}
      {harness && (
        <HarnessDialog
          agentId={harness.agentId}
          kind={harness.kind}
          onClose={() => setHarness(null)}
        />
      )}
    </>
  );
}
