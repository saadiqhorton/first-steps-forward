import { useCallback, useEffect, useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { WorkflowEditor } from "@/components/ade/workflows/WorkflowEditor";
import { deleteWorkflow, listWorkflows } from "@/lib/ade/store";
import type { Workflow } from "@/lib/ade/types";

type WorkflowsSearch = {
  new?: boolean;
};

export const Route = createFileRoute("/p/$projectId/workflows")({
  head: () => ({ meta: [{ title: "Workflows — ADE" }] }),
  validateSearch: (search: Record<string, unknown>): WorkflowsSearch => {
    const raw = search["new"];
    const isNew = raw === true || raw === "true" || raw === "1" || raw === 1 ? true : undefined;
    return isNew ? { new: true } : {};
  },
  component: WorkflowsPage,
});

function WorkflowsPage() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<Workflow | "new" | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const list = await listWorkflows();
      setWorkflows(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (search.new) {
      setEditor("new");
      void navigate({
        to: "/p/$projectId/workflows",
        params: { projectId },
        search: {},
        replace: true,
      });
    }
  }, [search.new, navigate, projectId]);

  const closeEditor = () => setEditor(null);

  const onDelete = async (workflow: Workflow) => {
    if (workflow.builtIn) return;
    if (!window.confirm(`Delete workflow “${workflow.name}”? This cannot be undone.`)) return;
    try {
      await deleteWorkflow(workflow.id);
      if (editor !== "new" && editor?.id === workflow.id) setEditor(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const duplicate = (workflow: Workflow) => {
    setEditor({
      ...workflow,
      id: "",
      builtIn: false,
      name: `${workflow.name} (copy)`,
    });
  };

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-7 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="label-mono">Project</div>
            <h1 className="mt-1 font-display text-[44px] leading-[0.9] tracking-wide">Workflows</h1>
            <p className="mt-3 text-[13px] text-dim">
              Reusable prompts that prefill the start screen. They never auto-send.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setEditor("new")}
            className="btn-amber px-4 py-2 text-[13px]"
          >
            + New workflow
          </button>
        </div>

        {error ? (
          <p className="mt-6 rounded bg-danger/10 p-3 text-[12px] text-danger">{error}</p>
        ) : null}

        {editor !== null && (
          <div className="mt-8">
            <WorkflowEditor
              key={
                editor === "new" ? "new" : editor.id ? `edit-${editor.id}` : `dup-${editor.name}`
              }
              initial={editor === "new" ? null : editor}
              onSaved={async () => {
                closeEditor();
                await refresh();
              }}
              onCancel={closeEditor}
            />
          </div>
        )}

        <div className="mt-8 space-y-3">
          {loading && <p className="text-[13px] text-dim">Loading workflows…</p>}
          {!loading && workflows.length === 0 && (
            <p className="text-[13px] text-dim">No workflows yet.</p>
          )}
          {workflows.map((workflow) => (
            <article key={workflow.id} className="card-panel p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-[15px] font-semibold">{workflow.name}</h2>
                    {workflow.builtIn ? (
                      <span className="label-mono rounded bg-ink/5 px-2 py-0.5 normal-case tracking-normal">
                        Built-in
                      </span>
                    ) : null}
                  </div>
                  {workflow.description ? (
                    <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-dim">
                      {workflow.description}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    to="/p/$projectId/conversations"
                    params={{ projectId }}
                    search={{ workflow: workflow.id } as never}
                    className="btn-amber px-3 py-1.5 text-[12px]"
                  >
                    Use
                  </Link>
                  {workflow.builtIn ? (
                    <button
                      type="button"
                      onClick={() => duplicate(workflow)}
                      className="btn-quiet px-3 py-1.5 text-[12px]"
                    >
                      Duplicate
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setEditor(workflow)}
                        className="btn-quiet px-3 py-1.5 text-[12px]"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void onDelete(workflow)}
                        className="btn-quiet px-3 py-1.5 text-[12px]"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}
