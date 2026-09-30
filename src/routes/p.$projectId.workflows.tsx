import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Play, Search } from "lucide-react";
import { WorkflowBrowseCard } from "@/components/ade/workflows/WorkflowBrowseCard";
import { WorkflowDetailsPane } from "@/components/ade/workflows/WorkflowDetailsPane";
import { WorkflowEditor } from "@/components/ade/workflows/WorkflowEditor";
import {
  filterWorkflows,
  groupWorkflows,
  type WorkflowFilter,
} from "@/components/ade/workflows/workflowFilters.mjs";
import { deleteWorkflow, listWorkflows } from "@/lib/ade/store";
import type { Workflow } from "@/lib/ade/types";

type WorkflowsSearch = {
  new?: boolean;
};

const FILTERS: { id: WorkflowFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "builtin", label: "Built-in" },
  { id: "yours", label: "Yours" },
];

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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<WorkflowFilter>("all");
  const [query, setQuery] = useState("");

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
      setSelectedId(null);
      void navigate({
        to: "/p/$projectId/workflows",
        params: { projectId },
        search: {},
        replace: true,
      });
    }
  }, [search.new, navigate, projectId]);

  const filtered = useMemo(
    () => filterWorkflows(workflows, filter, query) as Workflow[],
    [workflows, filter, query],
  );
  const grouped = useMemo(
    () =>
      groupWorkflows(filtered) as {
        builtIn: Workflow[];
        yours: Workflow[];
      },
    [filtered],
  );

  const selected = useMemo(
    () => (selectedId ? (workflows.find((w) => w.id === selectedId) ?? null) : null),
    [workflows, selectedId],
  );

  const closeEditor = () => setEditor(null);

  const onDelete = async (workflow: Workflow) => {
    if (workflow.builtIn) return;
    if (!window.confirm(`Delete workflow “${workflow.name}”? This cannot be undone.`)) return;
    try {
      await deleteWorkflow(workflow.id);
      if (editor !== "new" && editor?.id === workflow.id) setEditor(null);
      if (selectedId === workflow.id) setSelectedId(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const showPane = editor !== null || selected !== null;
  const emptyResults = !loading && filtered.length === 0;

  return (
    <main className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-7 py-8">
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid size-10 place-items-center rounded-lg bg-amber/20" aria-hidden>
              <Play className="size-4 text-amber-deep" />
            </div>
            <div>
              <div className="label-mono">Project</div>
              <h1 className="mt-1 font-display text-[44px] leading-[0.9] tracking-wide">
                Workflows
              </h1>
            </div>
          </div>
          <p className="mt-3 text-[13px] text-dim">
            Reusable prompts that prefill the start screen. They never auto-send.
          </p>

          {error ? (
            <p className="mt-6 rounded bg-danger/10 p-3 text-[12px] text-danger">{error}</p>
          ) : null}

          <div className="mt-6 flex flex-wrap gap-1" role="tablist" aria-label="Workflow filters">
            {FILTERS.map((f) => {
              const active = filter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFilter(f.id)}
                  className={`inline-flex items-center rounded-md px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors ${
                    active
                      ? "bg-ink/[0.08] font-medium text-ink"
                      : "text-dim hover:bg-ink/[0.04] hover:text-ink"
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>

          <div className="relative mt-4">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-dim"
              aria-hidden
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              aria-label="Search workflows"
              className="w-full rounded-md border border-line bg-paper py-2 pr-3 pl-9 text-[13px] text-ink placeholder:text-dim focus-visible:outline-2 focus-visible:outline-amber"
            />
          </div>

          <div className="mt-8 space-y-8">
            {loading ? <p className="text-[13px] text-dim">Loading workflows…</p> : null}

            {emptyResults ? (
              <p className="text-[13px] text-dim">
                {workflows.length === 0 ? "No workflows yet." : "No workflows match this filter."}
              </p>
            ) : null}

            {grouped.builtIn.length > 0 ? (
              <section>
                <h2 className="label-mono">Built-in</h2>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {grouped.builtIn.map((workflow) => (
                    <WorkflowBrowseCard
                      key={workflow.id}
                      workflow={workflow}
                      selected={selectedId === workflow.id && editor === null}
                      projectId={projectId}
                      onSelect={(w) => {
                        setEditor(null);
                        setSelectedId(w.id);
                      }}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {grouped.yours.length > 0 ? (
              <section>
                <h2 className="label-mono">Yours</h2>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {grouped.yours.map((workflow) => (
                    <WorkflowBrowseCard
                      key={workflow.id}
                      workflow={workflow}
                      selected={selectedId === workflow.id && editor === null}
                      projectId={projectId}
                      onSelect={(w) => {
                        setEditor(null);
                        setSelectedId(w.id);
                      }}
                    />
                  ))}
                </div>
              </section>
            ) : null}
          </div>

          <div className="mt-10 pb-4">
            <button
              type="button"
              onClick={() => {
                setSelectedId(null);
                setEditor("new");
              }}
              className="btn-amber px-4 py-2 text-[13px]"
            >
              + New workflow
            </button>
          </div>
        </div>
      </div>

      {showPane ? (
        <div className="flex h-full min-h-0 w-full min-w-[20rem] max-w-md shrink-0 flex-col border-l border-line bg-panel">
          {editor !== null ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <WorkflowEditor
                key={
                  editor === "new"
                    ? "new"
                    : editor.id
                      ? `edit-${editor.id}`
                      : `draft-${editor.name}`
                }
                initial={editor === "new" ? null : editor}
                onSaved={async (saved) => {
                  closeEditor();
                  setSelectedId(saved.id);
                  await refresh();
                }}
                onCancel={closeEditor}
              />
            </div>
          ) : selected ? (
            <WorkflowDetailsPane
              workflow={selected}
              projectId={projectId}
              onClose={() => setSelectedId(null)}
              onEdit={(w) => setEditor(w)}
              onDelete={(w) => void onDelete(w)}
            />
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
