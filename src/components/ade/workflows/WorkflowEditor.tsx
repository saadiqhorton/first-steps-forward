import { useState } from "react";
import { saveWorkflow, useAde } from "@/lib/ade/store";
import type { AgentId, Permission, Workflow } from "@/lib/ade/types";

export type WorkflowDraft = {
  id?: string;
  name: string;
  description: string;
  prompt: string;
  agentId?: AgentId;
  permission?: Permission;
};

function toDraft(workflow?: Workflow | null): WorkflowDraft {
  if (!workflow) {
    return { name: "", description: "", prompt: "" };
  }
  return {
    ...(workflow.id && !workflow.builtIn ? { id: workflow.id } : {}),
    name: workflow.name,
    description: workflow.description,
    prompt: workflow.prompt,
    ...(workflow.agentId ? { agentId: workflow.agentId } : {}),
    ...(workflow.permission ? { permission: workflow.permission } : {}),
  };
}

export function WorkflowEditor({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: Workflow | null;
  onSaved: (workflow: Workflow) => void;
  onCancel: () => void;
}) {
  const { state } = useAde();
  const [draft, setDraft] = useState<WorkflowDraft>(() => toDraft(initial));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const editing = !!draft.id;
  const fromBuiltIn = !!initial?.builtIn;

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const payload: Parameters<typeof saveWorkflow>[0] = {
        name: draft.name,
        description: draft.description,
        prompt: draft.prompt,
        ...(draft.id ? { id: draft.id } : {}),
        ...(draft.agentId ? { agentId: draft.agentId } : {}),
        ...(draft.permission ? { permission: draft.permission } : {}),
      };
      const saved = await saveWorkflow(payload);
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="card-panel space-y-4 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h2 className="text-base font-medium">
        {editing ? "Edit workflow" : fromBuiltIn ? "Customize workflow" : "New workflow"}
      </h2>
      {fromBuiltIn && !editing ? (
        <p className="text-[12px] text-dim">
          Saving creates your own copy under Yours. The built-in stays unchanged.
        </p>
      ) : null}

      <div>
        <label className="label-mono block" htmlFor="wf-name">
          Name
        </label>
        <input
          id="wf-name"
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          maxLength={80}
          required
          className="mt-2 w-full rounded-md border border-line bg-paper px-3 py-2 text-[13px]"
        />
      </div>

      <div>
        <label className="label-mono block" htmlFor="wf-description">
          Description
        </label>
        <input
          id="wf-description"
          value={draft.description}
          onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
          maxLength={200}
          className="mt-2 w-full rounded-md border border-line bg-paper px-3 py-2 text-[13px]"
        />
      </div>

      <div>
        <label className="label-mono block" htmlFor="wf-prompt">
          Prompt
        </label>
        <textarea
          id="wf-prompt"
          value={draft.prompt}
          onChange={(e) => setDraft((d) => ({ ...d, prompt: e.target.value }))}
          rows={8}
          required
          className="mt-2 w-full resize-y rounded-md border border-line bg-paper px-3 py-2 font-mono text-[12px] leading-relaxed"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label-mono block" htmlFor="wf-agent">
            Agent (optional)
          </label>
          <select
            id="wf-agent"
            value={draft.agentId ?? ""}
            onChange={(e) => {
              const value = e.target.value;
              setDraft((d) => {
                if (!value) {
                  const next = { ...d };
                  delete next.agentId;
                  return next;
                }
                return { ...d, agentId: value as AgentId };
              });
            }}
            className="mt-2 w-full rounded-md border border-line bg-paper px-3 py-2 text-[13px]"
          >
            <option value="">Any / default</option>
            {state.agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label-mono block" htmlFor="wf-permission">
            Permission (optional)
          </label>
          <select
            id="wf-permission"
            value={draft.permission ?? ""}
            onChange={(e) => {
              const value = e.target.value;
              setDraft((d) => {
                if (!value) {
                  const next = { ...d };
                  delete next.permission;
                  return next;
                }
                return { ...d, permission: value as Permission };
              });
            }}
            className="mt-2 w-full rounded-md border border-line bg-paper px-3 py-2 text-[13px]"
          >
            <option value="">Default</option>
            <option value="build">Build</option>
            <option value="plan">Plan</option>
          </select>
        </div>
      </div>

      {error ? <p className="rounded bg-danger/10 p-3 text-[12px] text-danger">{error}</p> : null}

      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="btn-amber px-4 py-2 text-[13px]">
          {busy ? "Saving…" : editing ? "Save changes" : "Create workflow"}
        </button>
        <button type="button" onClick={onCancel} className="btn-quiet px-4 py-2 text-[13px]">
          Cancel
        </button>
      </div>
    </form>
  );
}
