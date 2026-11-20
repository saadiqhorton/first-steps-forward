import { useEffect, useRef, useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { agentModels, optionCapabilities } from "@/lib/ade/store";
import type { Agent } from "@/lib/ade/types";
import type { AgentSelection } from "./AgentPicker";

const PRESETS_KEY = "ade-agent-presets";
type Preset = { id: string; name: string; selection: AgentSelection };

function readPresets(): Preset[] {
  try {
    const data: unknown = JSON.parse(window.localStorage.getItem(PRESETS_KEY) ?? "[]");
    if (!Array.isArray(data)) return [];
    return data
      .filter((item): item is Preset => {
        const selection = item?.selection;
        return (
          typeof item?.id === "string" &&
          typeof item?.name === "string" &&
          typeof selection?.agentId === "string" &&
          typeof selection?.model === "string" &&
          typeof selection?.effort === "string" &&
          typeof selection?.speed === "string" &&
          [
            "build",
            "plan",
            "manual",
            "auto",
            "deny",
            "approve",
            "full",
            "dont-ask",
            "bypass",
          ].includes(selection?.permission)
        );
      })
      .slice(0, 30);
  } catch {
    return [];
  }
}

export function AgentPresets({
  value,
  agents,
  agentLocked,
  onApply,
}: {
  value: AgentSelection;
  agents: Agent[];
  agentLocked?: string;
  onApply: (selection: AgentSelection) => void;
}) {
  const [presets, setPresets] = useState(readPresets);
  const [selected, setSelected] = useState("");
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [applying, setApplying] = useState(false);
  const applyRevision = useRef(0);
  useEffect(() => {
    applyRevision.current += 1;
    setApplying(false);
  }, [value.agentId, value.model, value.effort, value.speed, value.permission]);
  useEffect(
    () => () => {
      applyRevision.current += 1;
    },
    [],
  );

  function persist(next: Preset[]) {
    try {
      window.localStorage.setItem(PRESETS_KEY, JSON.stringify(next));
      setPresets(next);
      setError("");
      return true;
    } catch {
      setError("Could not save presets in this browser.");
      return false;
    }
  }
  function save(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    if (presets.length >= 30) {
      setError("Remove a preset before adding another.");
      return;
    }
    if (presets.some((preset) => preset.name.toLowerCase() === trimmed.toLowerCase())) {
      setError("A preset with that name already exists.");
      return;
    }
    const id =
      globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    if (persist([...presets, { id, name: trimmed, selection: { ...value } }])) {
      setName("");
      setNaming(false);
      setSelected(id);
    }
  }
  async function apply(id: string) {
    if (!id) return;
    const preset = presets.find((item) => item.id === id);
    if (!preset) return;
    if (agentLocked && preset.selection.agentId !== value.agentId) {
      setError("The agent cannot be changed during this task.");
      return;
    }
    if (!agents.some((agent) => agent.id === preset.selection.agentId)) {
      setError("This preset's agent is no longer available.");
      return;
    }
    const revision = ++applyRevision.current;
    setApplying(true);
    setError("");
    try {
      const { selection } = preset;
      const [models, caps] = await Promise.all([
        agentModels(selection.agentId),
        optionCapabilities(selection.agentId, selection.model || undefined),
      ]);
      if (revision !== applyRevision.current) return;
      if (
        selection.model &&
        models.available &&
        models.completeCatalog &&
        !models.models?.some((model) => model.id === selection.model)
      ) {
        setError("This preset's model is no longer offered by the agent.");
        return;
      }
      if (
        (selection.effort && !caps.efforts.includes(selection.effort)) ||
        (selection.speed && !caps.speeds.includes(selection.speed)) ||
        !caps.permissions.includes(selection.permission)
      ) {
        setError("This preset contains options the agent no longer offers.");
        return;
      }
      onApply(selection);
    } catch (reason) {
      if (revision === applyRevision.current)
        setError(reason instanceof Error ? reason.message : "Could not apply this preset.");
    } finally {
      if (revision === applyRevision.current) setApplying(false);
    }
  }

  return (
    <div className="min-w-[720px] border-t border-line px-3 py-2">
      <div className="flex items-center justify-end gap-2">
        {presets.length > 0 && (
          <>
            <label htmlFor="agent-preset" className="text-caption text-dim">
              Saved presets
            </label>
            <select
              id="agent-preset"
              value={selected}
              disabled={applying}
              onChange={(event) => setSelected(event.target.value)}
              className="max-w-48 rounded-lg border border-line bg-panel px-2 py-1 text-caption"
            >
              <option value="">Choose a preset</option>
              {presets.map((preset) => (
                <option
                  key={preset.id}
                  value={preset.id}
                  disabled={!!agentLocked && preset.selection.agentId !== value.agentId}
                >
                  {preset.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!selected || applying}
              onClick={() => void apply(selected)}
              className="btn-quiet px-2 py-1 text-caption disabled:opacity-40"
            >
              {applying ? "Applying…" : "Apply"}
            </button>
            <button
              type="button"
              aria-label="Delete selected preset"
              disabled={!selected || applying}
              onClick={() => {
                if (persist(presets.filter((preset) => preset.id !== selected))) setSelected("");
              }}
              className="btn-quiet p-1.5 disabled:opacity-40"
            >
              <Trash2 className="size-3.5" aria-hidden />
            </button>
          </>
        )}
        {!naming && (
          <button
            type="button"
            onClick={() => {
              setNaming(true);
              setError("");
            }}
            className="btn-quiet flex items-center gap-1 px-2 py-1 text-caption"
          >
            <Plus className="size-3" aria-hidden />
            Save as preset
          </button>
        )}
        {naming && (
          <form onSubmit={save} className="flex items-center gap-2">
            <label htmlFor="agent-preset-name" className="sr-only">
              Preset name
            </label>
            <input
              id="agent-preset-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={60}
              placeholder="Preset name"
              className="w-36 rounded-lg border border-line bg-panel px-2 py-1 text-caption"
              autoFocus
            />
            <button
              type="submit"
              disabled={!name.trim()}
              className="btn-amber px-2 py-1 text-caption disabled:opacity-40"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setNaming(false);
                setError("");
              }}
              className="btn-quiet px-2 py-1 text-caption"
            >
              Cancel
            </button>
          </form>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-1 text-right text-caption text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
