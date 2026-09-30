import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Check } from "lucide-react";
import { REASON_TEXT } from "@/components/ade/ModelPicker";
import { SignInDialog } from "@/components/ade/SignInDialog";
import { HarnessDialog } from "@/components/ade/HarnessDialog";
import { agentModels, optionCapabilities, useAde } from "@/lib/ade/store";
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

function permissionLabel(p: Permission) {
  return p === "plan" ? "Plan" : "Build";
}

function agentStatus(agent: Agent): {
  kind: "ready" | "signin" | "install" | "update" | "other-update";
  label: string;
} {
  if (!agent.installed || agent.installMethod === "missing") {
    return { kind: "install", label: "Install" };
  }
  if (agent.updateAvailable && agent.installMethod === "npm") {
    return {
      kind: "update",
      label: agent.latestVersion ? `Update to ${agent.latestVersion}` : "Update",
    };
  }
  if (agent.updateAvailable && agent.installMethod === "other") {
    return { kind: "other-update", label: "Installed outside npm" };
  }
  if (!agent.signedIn) {
    return { kind: "signin", label: "Sign in" };
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
  const modelPart = sel.model || "Model default";
  const effortPart = sel.effort || "Model default";
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
      onClick={onClick}
      onFocus={onFocus}
      className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] leading-snug ${
        selected ? "bg-amber/10" : "hover:bg-ink/5"
      } ${disabled ? "cursor-not-allowed text-dim opacity-60" : ""}`}
    >
      <span className="mt-0.5 grid size-3.5 shrink-0 place-items-center">
        {selected ? <Check className="size-3.5 text-amber-deep" aria-hidden /> : null}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );
}

/**
 * Multi-column agent / model / effort / speed / permission picker. Parent
 * owns selection state; this panel only calls onChange / onClose. Not wired
 * into Composer yet (Task 9).
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
  const { state } = useAde();
  const panelRef = useRef<HTMLDivElement>(null);
  const [models, setModels] = useState<AgentModelsResult | null>(null);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [caps, setCaps] = useState<OptionCapabilities | null>(null);
  const [showOther, setShowOther] = useState(false);
  const [otherText, setOtherText] = useState("");
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
    setModelsLoading(true);
    setModels(null);
    setShowOther(false);
    setOtherText("");
    agentModels(value.agentId)
      .then((r) => !cancelled && setModels(r))
      .catch(
        (e) =>
          !cancelled &&
          setModels({
            available: false,
            reason: "cli-failed",
            hint: e instanceof Error ? e.message : String(e),
          }),
      )
      .finally(() => !cancelled && setModelsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [value.agentId]);

  useEffect(() => {
    let cancelled = false;
    setCaps(null);
    optionCapabilities(value.agentId, value.model || undefined)
      .then((c) => !cancelled && setCaps(c))
      .catch(() => !cancelled && setCaps(null));
    return () => {
      cancelled = true;
    };
  }, [value.agentId, value.model]);

  useEffect(() => {
    const listed = !!models?.models?.some((m) => m.id === value.model);
    if (value.model && models?.available && !listed) {
      setShowOther(true);
      setOtherText(value.model);
    }
  }, [models, value.model]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const listedModels = useMemo(() => models?.models ?? [], [models]);
  const modelRows = useMemo(() => {
    const rows: { id: string; label: string }[] = [{ id: "", label: "Model default" }];
    for (const m of listedModels) {
      rows.push({
        id: m.id,
        label: m.label && m.label !== m.id ? `${m.label} — ${m.id}` : m.id,
      });
    }
    rows.push({ id: OTHER, label: "Other model id…" });
    return rows;
  }, [listedModels]);

  const effortRows = useMemo(() => {
    const efforts = caps?.efforts ?? [];
    return [
      {
        id: "",
        label: "Model default",
        disabled: efforts.length === 0,
        note: caps?.effortNote ?? "",
      },
      ...efforts.map((id) => ({ id, label: id, disabled: false, note: "" })),
    ];
  }, [caps]);

  const speedRows = useMemo(() => {
    const speeds = caps?.speeds ?? [];
    return [
      {
        id: "",
        label: "Standard",
        disabled: speeds.length === 0,
        note: caps?.speedNote ?? "",
      },
      ...speeds.map((id) => ({ id, label: id, disabled: false, note: "" })),
    ];
  }, [caps]);

  const permissionRows = useMemo(() => {
    const permissions = caps?.permissions ?? (["build", "plan"] as Permission[]);
    return permissions.map((id) => ({
      id,
      label: permissionLabel(id),
      disabled: false,
    }));
  }, [caps]);

  const selectAgent = (agentId: AgentId) => {
    if (agentLocked) return;
    if (agentId === value.agentId) return;
    onChange({
      agentId,
      model: "",
      effort: "",
      speed: "",
      permission: "build",
    });
  };

  const selectModel = (model: string) => {
    if (model === OTHER) {
      setShowOther(true);
      onChange({
        ...value,
        model: (otherText || value.model).trim(),
        effort: "",
        speed: "",
      });
      return;
    }
    setShowOther(false);
    onChange({ ...value, model, effort: "", speed: "" });
  };

  const selectEffort = (effort: string) => {
    onChange({ ...value, effort });
  };

  const selectSpeed = (speed: string) => {
    onChange({ ...value, speed });
  };

  const selectPermission = (permission: Permission) => {
    onChange({ ...value, permission });
    if (closeAfter) onClose();
  };

  const columnItems = (col: Column): string[] => {
    if (col === "agent") return state.agents.map((a) => a.id);
    if (col === "model") return modelRows.map((r) => r.id);
    if (col === "effort") return effortRows.map((r) => r.id);
    if (col === "speed") return speedRows.map((r) => r.id);
    return permissionRows.map((r) => r.id);
  };

  const selectedId = (col: Column): string => {
    if (col === "agent") return value.agentId;
    if (col === "model")
      return showOther || (value.model && !listedModels.some((m) => m.id === value.model))
        ? OTHER
        : value.model;
    if (col === "effort") return value.effort;
    if (col === "speed") return value.speed;
    return value.permission;
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

  const focusColumnRow = (col: Column, preferredId?: string) => {
    const items = columnItems(col);
    if (!items.length) {
      setFocusCol(col);
      setFocusRow(0);
      return;
    }
    let idx = preferredId !== undefined ? items.indexOf(preferredId) : -1;
    if (idx < 0) idx = Math.max(0, items.indexOf(selectedId(col)));
    if (idx < 0) idx = 0;
    setFocusCol(col);
    setFocusRow(idx);
    queueMicrotask(() => rowRefs.current[col]?.[idx]?.focus());
  };

  const onPanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const tag = (event.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (event.key === "Tab") {
      event.preventDefault();
      const idx = COLUMNS.indexOf(focusCol);
      const nextIdx = event.shiftKey
        ? (idx - 1 + COLUMNS.length) % COLUMNS.length
        : (idx + 1) % COLUMNS.length;
      const next = COLUMNS[nextIdx] ?? "agent";
      focusColumnRow(next);
      return;
    }
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

  return (
    <>
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Agent picker"
        tabIndex={-1}
        onKeyDown={onPanelKeyDown}
        className="card-panel w-[min(880px,100%)] shadow-lg outline-none"
      >
        <div className="grid grid-cols-5 gap-px border-b border-line bg-line">
          {(["Agent", "Model", "Effort", "Speed", "Permissions"] as const).map((heading, i) => (
            <div key={heading} className="bg-panel px-3 py-2">
              <div className="label-mono">{heading}</div>
              {COLUMNS[i] === focusCol ? <span className="sr-only">Focused column</span> : null}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-5 gap-px bg-line">
          {/* Agent */}
          <div
            className="max-h-72 overflow-y-auto bg-panel p-1.5"
            onFocusCapture={() => setFocusCol("agent")}
          >
            {agentLocked && (
              <p className="mb-1 rounded-md bg-amber/10 px-2 py-1.5 text-[11px] leading-snug">
                {agentLocked}
              </p>
            )}
            {state.agents.map((agent, i) => {
              const status = agentStatus(agent);
              const selected = value.agentId === agent.id;
              const locked = !!agentLocked;
              return (
                <div
                  key={agent.id}
                  className={`mb-0.5 rounded-md px-2 py-1.5 text-[12.5px] leading-snug ${
                    selected ? "bg-amber/10" : "hover:bg-ink/5"
                  } ${locked ? "opacity-60" : ""}`}
                >
                  <button
                    type="button"
                    ref={setRowRef("agent", i)}
                    disabled={locked}
                    onFocus={() => {
                      setFocusCol("agent");
                      setFocusRow(i);
                    }}
                    onClick={() => selectAgent(agent.id)}
                    className={`flex w-full items-start gap-2 text-left ${
                      locked ? "cursor-not-allowed" : ""
                    }`}
                  >
                    <span className="mt-0.5 grid size-3.5 shrink-0 place-items-center">
                      {selected ? <Check className="size-3.5 text-amber-deep" aria-hidden /> : null}
                    </span>
                    <span className="min-w-0 flex-1 font-medium">{agent.name}</span>
                  </button>
                  <div className="ml-[22px] mt-0.5 font-mono text-[10px] text-dim">
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
                  </div>
                </div>
              );
            })}
            <div className="mb-0.5 rounded-md px-2 py-1.5 text-[12.5px] leading-snug text-dim opacity-60">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 grid size-3.5 shrink-0 place-items-center" />
                <span className="font-medium">Claude Code</span>
              </div>
              <div className="ml-[22px] mt-0.5 font-mono text-[10px]">Coming later</div>
            </div>
          </div>

          {/* Model */}
          <div
            className="max-h-72 overflow-y-auto bg-panel p-1.5"
            onFocusCapture={() => setFocusCol("model")}
          >
            {modelsLoading ? (
              <p className="px-2 py-1.5 font-mono text-[11px] text-dim">Reading model list…</p>
            ) : models?.available ? (
              <>
                {modelRows.map((row, i) => (
                  <RowButton
                    key={row.id || "default"}
                    selected={
                      row.id === OTHER ? modelManual : !modelManual && value.model === row.id
                    }
                    rowRef={setRowRef("model", i)}
                    onFocus={() => {
                      setFocusCol("model");
                      setFocusRow(i);
                    }}
                    onClick={() => selectModel(row.id)}
                  >
                    {row.label}
                  </RowButton>
                ))}
                {modelManual && (
                  <input
                    id={otherId}
                    value={otherText || value.model}
                    onChange={(e) => {
                      setOtherText(e.target.value);
                      onChange({
                        ...value,
                        model: e.target.value.trim(),
                        effort: "",
                        speed: "",
                      });
                    }}
                    maxLength={256}
                    placeholder="e.g. provider/model-id"
                    className="mt-1 w-full rounded-md border border-line bg-panel px-2 py-1.5 font-mono text-[11px] placeholder:text-dim/70"
                  />
                )}
                {models.source === "bundled" && (
                  <p className="mt-1 px-2 font-mono text-[10px] text-dim">
                    Offline bundled catalog — may omit newer models.
                  </p>
                )}
              </>
            ) : (
              <>
                <input
                  id={otherId}
                  value={otherText || value.model}
                  onChange={(e) => {
                    setOtherText(e.target.value);
                    onChange({
                      ...value,
                      model: e.target.value.trim(),
                      effort: "",
                      speed: "",
                    });
                  }}
                  maxLength={256}
                  placeholder="e.g. provider/model-id"
                  className="w-full rounded-md border border-line bg-panel px-2 py-1.5 font-mono text-[11px] placeholder:text-dim/70"
                />
                <p className="mt-2 rounded-md bg-amber/10 px-2 py-1.5 text-[11px] leading-relaxed">
                  <span className="font-medium">
                    {REASON_TEXT[models?.reason ?? ""] ?? "Model listing is unavailable."}
                  </span>{" "}
                  {models?.hint ??
                    "You can enter a model id manually; availability depends on your account."}
                </p>
              </>
            )}
          </div>

          {/* Effort */}
          <div
            className="max-h-72 overflow-y-auto bg-panel p-1.5"
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
              <p className="mt-1 px-2 font-mono text-[10px] leading-snug text-dim">
                {caps.effortNote}
              </p>
            ) : null}
          </div>

          {/* Speed */}
          <div
            className="max-h-72 overflow-y-auto bg-panel p-1.5"
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
              <p className="mt-1 px-2 font-mono text-[10px] leading-snug text-dim">
                {caps.speedNote}
              </p>
            ) : null}
          </div>

          {/* Permissions */}
          <div
            className="max-h-72 overflow-y-auto bg-panel p-1.5"
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

        <div className="flex items-start gap-4 border-t border-line px-3 py-2.5">
          <p className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-dim">{note}</p>
          <label className="flex shrink-0 items-center gap-2 text-[11.5px] text-dim">
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
